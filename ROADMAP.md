# figma-android-mcp 路线图

## 项目定位

`figma-android-mcp` 是从 [Figma-Context-MCP](https://github.com/GLips/Figma-Context-MCP) fork 的 Android 特化版本。核心差异是输出 Android 原生布局术语（Jetpack Compose 和 XML Views），并支持按 Android density bucket（mipmap-xhdpi / mipmap-xxhdpi 等）下载图片资源。

---

## 已完成的特性 ✅

### Android 平台输出

- [x] `--output-platform compose` — 输出 Compose 布局字段（`arrangement`, `alignment`, `spacing`, `width`, `height`）
- [x] `--output-platform views` — 输出传统 Views 布局字段（`orientation`, `gravity`, `layout_width`, `layout_height`）
- [x] `--design-density` — 设计稿密度配置，控制 dp/sp 单位转换（auto / mdpi / xhdpi / xxhdpi）

### 图片处理

- [x] 多 density bucket 下载（`mipmap-{density}/` 子目录）
- [x] 图片内容哈希去重
- [x] 裁剪变换（cropTransform）处理
- [x] GIF 导出支持
- [x] 图片填充下载
- [x] `localPath` 路径安全校验

### 布局处理

- [x] 自动布局推断（`inferAutoLayoutFromPositions`）— 从绝对定位子节点推断 flex 排列
- [x] 布局提示生成（`layoutHints`）— 推荐 `fillMaxWidth()`、`fillMaxSize()` 等
- [x] 固定尺寸转 fillMax 转换（`convertFixedChildrenToFillMax`）— 居中固定宽度子元素转响应式

### 样式 & 文本

- [x] 富文本渲染（混合格式化：粗体、斜体、删除线、链接、颜色覆盖）
- [x] CSS 渐变（线性、径向、角度、菱形）
- [x] 阴影效果（drop shadow、inner shadow → box-shadow / text-shadow）
- [x] 模糊效果（layer blur、background blur）
- [x] 边框样式（颜色、宽度、虚线）

### 组件

- [x] 组件属性提取（INSTANCE / COMPONENT / COMPONENT_SET）
- [x] VARIANT 类型节点及其选项列表
- [x] 组件属性引用（property references）

### 基础设施

- [x] stdio 和 StreamableHTTP 双传输模式
- [x] HTTP 代理支持（`--proxy`）
- [x] 结构化错误消息（403 / 429 含 LLM 可用的排查指引）
- [x] PostHog 遥测（含密钥脱敏）
- [x] 请求级认证（`X-Figma-Token` HTTP header）
- [x] `fetch` 子命令 — 直接输出简化数据到 stdout
- [x] 输出体积分级压缩 — >300KB 时依次执行无损压缩 / 重复子树折叠 + 长文本截断 / 装饰节点细节截断（`compact-design.ts`，详见 `docs/plan-output-size-limit.md`）
- [x] 设计密度请求级作用域 — dp/sp 换算 divisor 改为 AsyncLocalStorage 请求级 + 按 fileKey 注册表，修复 HTTP 并发互相污染；显式 `--design-density` 不再被自动检测覆盖
- [x] 定位规则单一来源 — `positioning-policy.ts` 统一 skill 与 layoutHints 的 offset 使用准则（5 级优先级阶梯），消除规则互相矛盾

---

## 待开发 📋

### 组件 & 实例（高优先级）

- [ ] **实例覆盖值** — INSTANCE 节点只返回被覆盖的属性，隐藏未被覆盖的子节点
- [ ] **Slot 子节点** — 正确处理 INSTANCE 中的 slot 类型子节点
- [ ] **组件提取专用工具** — `get_figma_components` 工具，获取完整组件/组件集的设计数据

### 布局

- [ ] **Figma Grid 布局** — 支持 Figma 新的 grid 自动布局（flex 已有，grid 尚未支持）
- [ ] **Flexbox wrap 检测** — 自动检测换行并转换为合适的布局模式
- [ ] **文本溢出处理** — auto width / auto height / fixed width + truncate 的映射

### 样式

- [ ] **命名样式提取** — 通过 `/v1/styles/:key` 端点导出 Figma 命名样式名称
- [ ] **混合文本样式** — 单节点内多个 text style override 的完整支持
- [ ] **渐变 CSS 语法校验** — 确认所有渐变类型输出正确的 CSS 语法

### 图片 & 资源

- [ ] **复杂遮罩导出** — 复杂 mask 形状和变换的正确处理
- [ ] **SVG 图标识别** — Frame 内全为 VECTOR 时，下载整帧为 SVG
- [ ] **图片填充/矢量提升** — 将深层图片填充和矢量提升到 top level

### 变量 & Token

- [ ] **非企业版变量推断** — 将 variable deduction 移植给非 Enterprise 用户
- [ ] **设计 Token 导出** — 以标准格式导出设计 token

### 原型 & 交互

- [ ] **交互数据提取** — hover / click 等操作
- [ ] **动画 / 过渡数据**

---

## 技术债务 🧹

- [ ] 图片下载代码清理（`mcp.ts` 中标注的部分）
- [ ] `convertAlign` 函数重构（`layout.ts`）
- [ ] 各 service 的错误处理统一

---

## 测试 📊

### 当前覆盖

| 模块 | 测试文件 | 用例数 |
|------|---------|--------|
| 平台映射 (Compose / Views) | `platform-mapper.test.ts` | 66 |
| 富文本 | `rich-text.test.ts` | 40 |
| Tree Walker | `tree-walker.test.ts` | 34 |
| 布局对齐 | `layout-alignment.test.ts` | 32 |
| 路径校验 | `path-validation.test.ts` | 25 |
| Fill-max 转换 | `layout-fillmax.test.ts` | 18 |
| 布局推断 | `layout-inference.test.ts` | 15 |
| 配置 | `config.test.ts` | 14 |
| 序列化 | `serialization.test.ts` | 8 |
| 错误元数据 | `error-meta.test.ts` | 4 |
| 图片处理 | `image-processing.test.ts` | 4 |
| HTTP Header 认证 | `http-header-auth.test.ts` | 3 |
| 校验拒绝捕获 | `validation-reject.test.ts` | 3 |
| 服务端集成 | `server.test.ts` | 11 |
| stdio 传输 | `stdio.test.ts` | 2 |
| 遥测脱敏 | `telemetry-redaction.test.ts` | 1 |
| 性能基准 | `benchmark.test.ts` | 1 |
| 集成测试 | `integration.test.ts` | 1 (跳过) |

### 待补充

- [ ] 集成测试：用 Mock Figma API 替代真实 API 调用
- [ ] E2E 测试：通过 MCP Server 输出验证 LLM 编码助手的实现效果
- [ ] transformer 层单元测试（当前通过上层测试间接覆盖）

---

## 不纳入范围

以下内容明确不在此项目范围（来自上游 CONTRIBUTING.md 的哲学）：

- 图片编辑 / 处理（仅做裁剪和格式转换，不做滤镜、压缩等操作）
- CMS 同步
- 代码生成（项目只输出简化的设计数据，代码生成由 AI agent 完成）
- 第三方平台集成

---

*路线图会随实际开发进度持续更新。最后更新：2026 年 5 月*
