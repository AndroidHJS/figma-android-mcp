# Plan: 解决 get_figma_data 输出过大问题

> **状态：已实现（2026-06）**
> 实现位于 `src/services/compact-design.ts`（三阶段压缩）与 `src/services/get-figma-data.ts` 的 `serializeWithSizeLimit()`（编排，阈值 300KB）。
> 与原方案的差异：
> 1. 1b（渐变转图像）与 1d（特效矩形转图像）未实现——与 layoutHints 的 GRADIENT 规则（教 LLM 用 Brush 还原渐变）方向冲突，需先统一策略再做；
> 2. 第二步顺序调整为「先截断长文本、后折叠重复子树」，使折叠节点的 `texts` 数组携带的是已截断内容；
> 3. `_repeatOf` / `_truncated` 字段只存在于序列化时的克隆树上，未污染 `SimplifiedNode` 类型——压缩是序列化层关注点；
> 4. 压缩说明通过输出中的 `_compressionNotes` 字段告知 LLM，而非工具描述。
> 测试见 `src/tests/compact-design.test.ts`。

## 现状

`get_figma_data` MCP 工具将 Figma 设计数据简化后序列化为单个 YAML 字符串返回。当设计较复杂时，输出可能超过 MCP tool result 的 token 上限，导致结果被截存到文件而 LLM 无法读取。

### 实际案例

Figma node `980:3716`（产品列表页面）：

| 指标 | 值 |
|------|-----|
| 简化后 YAML 输出 | **622 KB** |
| 总节点数 | 140 个 |
| 唯一全局样式 | 145 个（其中 45 个仅使用 1 次） |
| 平均每节点字节数 | ~4.4 KB |

节点类型分布：TEXT 49、FRAME 39、IMAGE-PNG 23、RECTANGLE 23、GRADIENT_LINEAR 10、GRADIENT_RADIAL 5、INSTANCE 5、GROUP 1

### 根因

**不是节点太多，而是每个节点的序列化过于冗余。** 622KB / 140 nodes = 每节点 ~4.4KB，大量默认值、空字段、复杂渐变/效果定义被完整序列化。

Figma REST API 的 `/files` 和 `/files/{key}/nodes` 端点不支持文档内容分页（无 page/page_size/cursor），单次调用必然返回完整子树。

---

## 约束

1. **不能丢失控件** — 用于 UI 代码还原场景，LLM 必须知道全部节点的存在（id/name/type）
2. **Figma API 不支持分页** — 只能拿到全量数据后在本地处理
3. **不动 MCP 协议层** — 问题在 tool result 总大小，拆成多个 content block 不能绕过总量上限
4. **不引入新 MCP tool** — 遵循 Unix philosophy，保持工具简单

---

## 方案：三步渐进式压缩

### 第一步：无损压缩（不丢失任何控件信息）

#### 1a. 去除默认值/空值字段

在序列化前新增 `compactDesign()`，递归遍历 `SimplifiedDesign`，移除：

- `null` / `undefined` 字段
- 恒等值：`opacity: 1`、`borderRadius: "0dp 0dp 0dp 0dp"`、`strokeWeight: "0dp"`
- 空数组：`strokes: []`、`effects: []`、`children: []`
- 空字符串值

#### 1b. 复杂渐变转为图像引用

`GRADIENT_LINEAR`（10 个）和 `GRADIENT_RADIAL`（5 个）的 fill 定义包含大量色标数据（每色标 = 颜色 + 透明度 + 位置），对代码生成无实际价值 — LLM 无法用 Compose/View 精确还原复杂渐变。

- 对使用渐变 fill 的节点，移除 `fills` 中的详细渐变定义
- 加入 `imageAssets`（如尚未在列表中），`reason` 标注含渐变
- 纯色 fill（`#RRGGBB`）不变

#### 1c. 单次使用的样式内联

`globalVars.styles` 中 45 个样式仅被引用 1 次。将这些样式定义从 globalVars 移到引用节点内，省去 globalVars 中的 key 定义行。

#### 1d. 复合效果的 RECTANGLE 归类为图像

部分 RECTANGLE 可能带复杂阴影/模糊效果，这些效果无法用代码表达。若节点含 `boxShadow`、`backdrop-blur`、`layer-blur` 等效果且尺寸固定，归入 IMAGE-PNG 作为图像资源。

#### 预计第一步后：622KB → ~500KB

---

### 第二步：结构压缩（仍不丢控件）

如果第一步后仍超阈值：

#### 2a. 折叠重复子树

检测同一 parent 下结构相同的连续兄弟节点（相同 type + 相同 layout 引用），仅保留第一个完整实例，后续替换为引用标记：

```yaml
- id: 980:3740
  name: 产品卡片 1
  type: FRAME
  layout: layout_CARD
  children: [...]      # 完整展开

- id: 980:3741
  _repeatOf: 980:3740  # 结构同 980:3740，省略 children/layout
  name: 产品卡片 2
  text: 消费贷          # 仅保留差异字段
```

LLM 基于第一个实例的结构 + 每个实例的差异化字段即可生成代码。

#### 2b. 超长文本截断

TEXT 节点中 text 超过 200 字符的，截断到 200 字符，追加 `... [truncated]`。

#### 预计第二步后：~300-400KB

---

### 第三步：智能截断（最后手段）

如果前两步后仍超阈值，按优先级保留细节：

| 优先级 | 节点类型 | 处理方式 |
|--------|----------|----------|
| 最高 | 顶层 frame（depth 0-1） | 完整保留 |
| 高 | 容器 frame / 组件实例 / text | 完整保留 |
| 低 | IMAGE-PNG / 纯装饰 RECTANGLE | 仅保留 id/name/type，省略 fills/layout/styles，加 `_truncated: true` |

所有节点仍然在树中可见（id/name/type 不丢），细节丢失的节点标记 `_truncated: true`。

顶层输出插入警告：

```
⚠️ OUTPUT TRUNCATED: 原始 ~{size}KB。
截断的节点已标记 _truncated: true，如需详情请对该 nodeId 单独调用 get_figma_data。
```

---

## 涉及文件

| 文件 | 改动 |
|------|------|
| `src/services/get-figma-data.ts` | 体积检查 + 三步压缩编排 |
| `src/services/compact-design.ts` | **新文件** — `compactDesign()`（去默认值、渐变→图片、内联单次样式） |
| `src/services/detect-repeats.ts` | **新文件** — `detectAndCollapseRepeats()`（折叠重复子树） |
| `src/extractors/types.ts` | 新增 `_repeatOf`、`_truncated` 可选元数据字段 |
| `src/mcp/tools/get-figma-data-tool.ts` | 截断时生成警告文本 |

---

## 不采用：纯深度截断

深度截断（depth=2/3）直接砍掉深层控件，LLM 完全不知道被截断节点的存在。对于 UI 还原场景不可接受，用户反馈会遗漏控件。

---

## 验证

1. 对 `980:3716` 调用，确认输出 ≤ 300KB
2. 全部 140 个节点的 `id`/`name`/`type` 都在输出中出现（不丢控件清单）
3. `imageAssets` 包含被归类为图像的渐变/特效节点
4. 被截断细节的节点标记 `_truncated: true`，顶层有截断警告
5. 对简单设计（<300KB），输出与原版完全一致
6. `pnpm test` 全部通过
