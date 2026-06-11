import type { Skill } from "./types.js";
import {
  COMPOSE_OFFSET_RULES_ZH,
  COMPOSE_OFFSET_SELF_CHECK_ZH,
  VIEWS_OFFSET_RULES_ZH,
  VIEWS_SELF_CHECK_ZH,
} from "./positioning-policy.js";
import { OVERLAY_RULES_ZH } from "./overlay-policy.js";
import {
  OVERHANG_RULES_ZH,
  OVERHANG_SELF_CHECK_COMPOSE_ZH,
  OVERHANG_SELF_CHECK_VIEWS_ZH,
} from "./overhang-policy.js";

export const builtInSkills: Skill[] = [
  {
    name: "android-layout",
    title: "Android 布局规则（强制）",
    description: "Figma 设计 → Android 布局代码的强制约束，含宽度响应式与未下载资源占位规则",
    category: "layout",
    instructions: "生成 Android 布局代码（Compose 或传统 View）时触发。强制执行 Figma 到 Android 的布局约束：宽度响应式、纯色占位、反模式检测。在写完任何 XML/Compose 布局代码前必须调用此技能。",
    triggers: ["宽度响应式", "响应式布局"],
    content: `# 宽度响应式规则（强制，不允许偏离）

Figma 数据里所有节点宽度都是固定 dp，**禁止字面翻译**。Android 设备宽度跨度大（320dp ~ 600dp+），字面翻译会在非基线设备上裁切或偏左堆积。

## 布局规则

| 场景判定 | 原则 | Compose | 传统 View |
|---------|------|---------|----------|
| 容器宽度 ≥ 屏宽 × 0.85 | 撑满父级 + 水平边距 | \`Modifier.fillMaxWidth().padding(horizontal = N.dp)\` | \`width=match_parent\` + \`marginHorizontal=Ndp\` |
| 横向布局里"吃满剩余空间"的子元素 | 弹性占位 | \`Modifier.weight(1f)\`（Row/RowScope 内） | \`width=0dp\` + \`layout_weight=1\` |
| 靠右边缘锚定的元素 | 右锚 + 右边距 | \`Modifier.align(Alignment.CenterEnd).padding(end = N.dp)\`（Box 内） | \`gravity=end\` + \`marginEnd=Ndp\` |
| 文本宽度 | 内容驱动 | 不指定 / \`wrapContentWidth()\` | \`width=wrap_content\` |
| 真·固定尺寸资源 ✅ | 保持设计 dp | \`Modifier.size(W.dp, H.dp)\` | \`layout_width/height="Wdp"\` |

## 固定 dp 宽度白名单（仅三类允许）

1. 图标，且尺寸 ≤ 48dp
2. 插画 / 设计师签发的整图切图（已下载的资源）
3. 用户在对话中明确确认过的特殊宽度组件

## 禁止项

- ❌ 给接近屏宽的容器写固定 dp（如卡片、按钮、输入框、段落文本块）
- ❌ 用 \`marginStart = (设计基线宽 − 内容宽) / 2\` 来"假装居中"
- ❌ 横向布局里写"按设计稿剩余空间算出的固定 dp"（如 \\\`width=225dp\\\` 让它"刚好"填满）

## 纯色占位（auto-detected 节点未下载时的处理规则，强制）

当一个 auto-detected 节点没下载，**禁止**使用以下方式去"重画"它：

- ❌ \`Icon(imageVector = Icons.Default.X, ...)\` 或自己拼 \`ImageVector\`
- ❌ \`Canvas { drawCircle(...) }\` 或任何 \`Canvas\` 绘制
- ❌ \`Brush.linearGradient\` / \`Brush.radialGradient\` 还原渐变
- ❌ XML \`<shape>\` / \`<gradient>\` / \`VectorDrawable\`

**正确做法**：取该节点的主色（fills 里的第一种纯色），或邻近父容器的背景色，画一个同尺寸的色块占位：

- Compose：\`Box(Modifier.size(<W>.dp, <H>.dp).background(Color(0xFF...)))\`
- 传统 View：\`<View android:layout_width="<W>dp" android:layout_height="<H>dp" android:background="#..."/>\`

可以加一行注释标明 \`// 待替换：figma 节点 <nodeId> 的实际图像\` 便于后续手动补资源。

## 常见反模式（禁止）

以下是 Figma 还原中反复出现的错误模式。每次生成代码前自查一遍：

### 摊平到 FrameLayout / Box

多个无重叠的视觉区域用硬编码间隔摊平到一个容器。

- ❌ 多个区域堆在单个 FrameLayout / Box 里靠 margin/padding 推开
- View → ✅ 用 \`LinearLayout(vertical)\` 包裹各区域，区域之间自然排列
- Compose → ✅ 用 \`Column\` 包裹各区域，间距用 \`Spacer\` 或 \`Arrangement.spacedBy()\`

### 对齐与偏移矛盾

- View：\`layout_gravity="center_horizontal"\` 和 \`layout_marginStart\` 同时使用 → ✅ 二选一：居中用 gravity，靠左用 margin
- Compose：\`Modifier.align(Alignment.CenterHorizontally)\` 和 \`padding(start=...)\` 同时控制水平位置 → ✅ 二选一：居中用 align，靠左用 \`padding(start=...)\`

### 子元素超出父容器

子元素尺寸大于父容器（如 344dp 的图片放在 150dp 的容器里）

View → ✅ 父容器高度至少等于最大子 View 的 bottom 坐标，或用 wrap_content
Compose → ✅ 父容器不设固定高度，用默认 wrapContentHeight() 或 IntrinsicSize

### CheckBox 用 src 设图标（View 专属）

- ❌ \`android:src\` 给 CheckBox 设自定义图标 → ✅ 用 \`android:button="@drawable/selector_xxx"\` 状态列表 drawable
- Compose → ✅ 用带状态的自定义 Composable

### 硬编码容器总高度

用固定 dp 值锁定容器高度。

- View：\`layout_height="1361dp"\` → ✅ 用 \`wrap_content\`，ScrollView 自动处理滚动
- Compose：\`Modifier.height(1361.dp)\` → ✅ 去掉固定高度，\`LazyColumn\` / \`verticalScroll\` 自动处理

### 跳过嵌套容器

看到 Figma 的 FRAME 节点，直接把子元素提升到顶层。

- View → ✅ 每个 FRAME/GROUP 考虑对应一个 \`LinearLayout\` / \`FrameLayout\`
- Compose → ✅ 每个 FRAME/GROUP 考虑对应一个 \`Column\` / \`Row\` / \`Box\`

### Compose 用 absoluteOffset 模拟间距

- ❌ 在 Column/Row 子项上用 \`Modifier.absoluteOffset()\` 推开元素 → ✅ 用 \`Arrangement.spacedBy()\` 统一控制，或在子项之间插入 \`Spacer\`

${COMPOSE_OFFSET_RULES_ZH}

${VIEWS_OFFSET_RULES_ZH}

${OVERLAY_RULES_ZH}

${OVERHANG_RULES_ZH}

### android:elevation 替代 boxShadow（View 专属，高发）

boxShadow 是 CSS box-shadow 语法（offsetX offsetY blur spread color），必须转为 \`<layer-list>\` drawable（\`<shape>\` 阴影层）。负 Y 偏移（如 \`0dp -3dp ...\`）表示阴影向上投——elevation 完全无法表达。

- ❌ \`android:elevation="4dp"\` 模拟 boxShadow
- ✅ \`<layer-list>\` drawable；不确定怎么转换时宁可跳过阴影，也不要用 elevation

### 空 View + layout_weight 表达固定间距（View 专属）

0dp + weight 占位 View **仅允许**用于 space-between 分布（布局数据带 \`mainAxisArrangement: "spaceBetween"\`）。

- ❌ 用空 View + \`layout_weight="1"\` 表达设计稿里的固定间距 → ✅ 固定间距用子元素 margin
- 使用 weight 时必须核对：对应轴尺寸为 0dp、直接父容器是 LinearLayout、orientation 与 weight 轴一致

### layout_gravity 用在不支持的父容器（View 专属）

\`layout_gravity\` 的语义取决于直接父容器：FrameLayout 内任意方向生效；LinearLayout 内**仅垂直于 orientation 的轴**生效（horizontal 里控制不了水平位置）；其他容器直接忽略。

- ❌ \`LinearLayout(horizontal)\` 子元素用 \`layout_gravity="end"\` 想靠右（无效）
- ✅ 先确认直接父容器类型；需要任意方向锚定时用 FrameLayout 包裹

### ConstraintLayout 过度使用（View 专属）

仅 3 种场景允许使用 ConstraintLayout：① 布局数据带 \`layout_constraint*\` 字段；② 3+ 子元素的 space-between 链（\`spread_inside\`）；③ 确实存在多向复杂约束。

- ❌ 单个子元素套 ConstraintLayout 只为居中/右锚 → ✅ FrameLayout + \`layout_gravity\`
- ❌ 单轴顺序排列套 ConstraintLayout → ✅ LinearLayout

### ContentScale.Fit 误用到 Figma 切图（Compose 专属，高发）

对已下载的 Figma PNG 切图使用 ContentScale.Fit。

- ❌ \`Image(painter, Modifier.size(W.dp, H.dp), contentScale = ContentScale.Fit)\`
- ✅ \`ContentScale.FillBounds\` — Figma 切图是渲染好的 PNG，需填满目标尺寸（对应 View 的 \`scaleType="fitXY"\`）

### FontWeight.SemiBold 替代 Bold（Compose 专属）

设计稿标注 bold 时使用 SemiBold(600)。

- ❌ textStyle 含 "bold" → \`FontWeight.SemiBold\`
- ✅ textStyle 含 "bold" → \`FontWeight.Bold\` (weight = 700)

### Brush.horizontalGradient endX 无依据压缩（Compose 专属）

无 Figma gradientTransform 数据时将 endX 设为 0.44f 或其它非 1f 的值。

- ❌ \`Brush.horizontalGradient(..., endX = 0.44f)\` 无 transform 数据支撑
- ✅ 未提供 gradientTransform 数据时，默认使用 \`startX = 0f, endX = 1f\`（全宽渐变）

### Canvas drawCircle 替代径向渐变填充（Compose 专属，高发）

Figma GRADIENT_RADIAL 填充的矩形/圆角矩形节点，被错误转为 Canvas + drawCircle。

- ❌ \`Canvas(modifier) { drawCircle(color, radius, center) }\` 或 \`drawCircle(brush = Brush.radialGradient(...))\`
- ✅ 渐变是形状的 FILL：\`Box(Modifier.size(W.dp, H.dp).background(Brush.radialGradient(...), shape = RoundedCornerShape(N.dp)))\`

### radialGradient 的 CSS "circle" 关键词误读

Figma 输出的 CSS 字符串含 \`radial-gradient(circle at 50% 50%, ...)\`——这里的 "circle" 指渐变色在元素内呈圆形扩散（gradient spread shape），不是让你画一个圆。

- ❌ 看到 \`circle\` → \`Canvas { drawCircle(...) }\`
- ✅ 忽略 CSS 字符串里的 shape 关键词；按节点的 width/height/cornerRadius 建 Box，用 \`Brush.radialGradient(...)\` 做 background

## 文本还原规则（强制）

textStyle 数据按以下规则直译，禁止自行换算、省略或"看起来差不多"：

### 固定行高（textStyle 带 \`lineHeight: Nsp\`）

Android 默认的字体内边距让文本实际占高 ≠ Figma 的行高盒，多行文本逐行累积偏差：

- Compose → \`lineHeight = N.sp\` 必须同时配 \`platformStyle = PlatformTextStyle(includeFontPadding = false)\` 与 \`lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None)\`
- View → \`android:lineHeight="Nsp"\`（API 28+）+ \`android:includeFontPadding="false"\`
- lineHeight 为 \`150%\` 形式时 → fontSize × 1.5 得到 sp 值后按上面处理
- textStyle **没有** lineHeight（设计用 auto 行高）→ 不要设置行高，跟随字体默认

### letterSpacing（数据已是 em，直接照抄）

- Compose → \`letterSpacing = N.em\`（不是 \`.sp\`）
- View → \`android:letterSpacing="N"\`（该属性本身就是 em 倍数，照抄数值、不带单位）
- ❌ 禁止把 em 数值当 sp/dp 使用，禁止再做任何单位换算

### 文本截断（textStyle 带 \`textTruncation: ENDING\`）

- Compose → \`maxLines = N\` + \`overflow = TextOverflow.Ellipsis\`
- View → \`android:maxLines="N"\` + \`android:ellipsize="end"\`
- 数据无 \`maxLines\` 字段时按节点高度 ÷ 行高估算行数，单行高度的节点用 1
- 反向同样成立：textStyle **没有** textTruncation 的文本，禁止擅自加 maxLines / ellipsize

## 写完后自检（强制，单端各跑一次）

- Compose：搜 \\\`Modifier\\.(width|size)\\(\\s*\\d+(?:\\.\\d+)?\\.dp\\\`，逐处核对是否落在白名单
- Compose 额外检查：
  - 搜 \`ContentScale\.Fit\` → 全部核对，Figma 切图应使用 \`ContentScale.FillBounds\`
  - 搜 \`FontWeight\.SemiBold\` → 核对是否应为 \`FontWeight.Bold\`
  - 搜 \`endX\\s*=\\s*[01]?\\.\\d+f\` → 除 0f 和 1f 外需有 gradientTransform 数据支撑
  - ${COMPOSE_OFFSET_SELF_CHECK_ZH}
  - 搜 \`drawCircle\` → 全部核实：节点是否是 GRADIENT_RADIAL fill？是 → 改为 Box + Modifier.background(Brush.radialGradient(...))。仅当节点本身就是圆形矢量路径时才保留 drawCircle。
  - ${OVERHANG_SELF_CHECK_COMPOSE_ZH}
  - 搜 \`lineHeight\\s*=\` → 每处核对是否同时设置了 \`PlatformTextStyle(includeFontPadding = false)\` 与 \`LineHeightStyle\`
- View：grep \\\`layout_width="\\d+dp"\\\`，逐处核对是否落在白名单
- View 额外检查：
  - 搜 \`android:elevation\` → 全部替换为 \`<layer-list>\` drawable 实现（或删掉阴影）；elevation 禁止用于还原 boxShadow
  - 搜 \`layout_weight="1"\` → 逐处核对：对应轴是否 0dp、直接父容器是否 LinearLayout、orientation 是否与 weight 轴一致、用途是否 space-between/fill（固定间距改 margin）
  - 搜 \`layout_gravity\` → 核对直接父容器：FrameLayout 任意方向有效；LinearLayout 仅垂直于 orientation 的轴有效；其他容器无效，需改写
  - 搜 \`app:layout_constraint\` → 核对布局数据是否确实含 \`layout_constraintHorizontal/Vertical\` 字段，或属于 3+ 子元素 space-between 链；都不是 → 改 FrameLayout/LinearLayout
  - ${VIEWS_SELF_CHECK_ZH}
  - ${OVERHANG_SELF_CHECK_VIEWS_ZH}
  - grep \`android:lineHeight\` → 每处核对是否同时设置了 \`android:includeFontPadding="false"\`

不落白名单的，必须按上面表格重写。
`,
  },
  {
    name: "figma-android-mcp-skill",
    title: "Figma → Android 还原流程",
    description: "当用户提出\"需要效果图对比\"或\"提高还原度\"时触发。流程：解析 Figma URL → 询问是否效果图对比 → 获取设计数据 → 分两组处理 imageAssets 并询问下载策略 → 下载资源 → 对照效果图做视觉校验并按规范生成 Compose / 传统 View 代码。仅当用户明确要求效果图对比或高还原度时才调用此技能。",
    category: "workflow",
    instructions: "当用户提出\"效果图对比\"、\"效果图对比\"或\"高还原度\"时触发。流程包含 7 步：解析输入 → 检查模型图片支持 → 询问效果图对比 → 获取设计数据 → 分组并下载图片资源 → 对照效果图生成代码。",
    triggers: ["效果图对比", "效果图对比", "设计稿高还原"],
    content: `# figma-android-mcp-skill

这个 skill 标准化"Figma → Android 代码"的还原流程。**严格按以下步骤执行**，不要省略问询、不要替用户做选择。

## 触发后的执行步骤

### 步骤 1：解析输入

用户的 prompt 里通常会带：

- 完整 Figma URL：\`https://www.figma.com/(file|design)/<fileKey>/...?node-id=<nodeId>\`
- 或简写：\`fileKey\` 或 \`fileKey:nodeId\` 字面量

从中抽取 \`fileKey\`（必需，纯字母数字）和 \`nodeId\`（可选）。如果两者都没拿到，停止并向用户索要。

\`nodeId\` 在 URL 里通常是 \`1234-5678\` 形式（连字符），后续传给 MCP 时 MCP 会自己把 \`-\` 转 \`:\`，所以原样传过去即可。

### 步骤 1.5：检查当前模型是否支持图片

自省：你能否处理/查看图片（image input / multimodal）？

- **如果不支持图片输入**：输出一句话 \`当前模型不支持图片输入，跳过效果图，直接使用设计数据生成代码。\`，设 \`needPreview = false\`，**跳过步骤 2**，直奔步骤 3。
- **如果支持图片输入**：继续步骤 2，正常询问用户。

### 步骤 2：问"是否需要效果图对比"

调用 **AskUserQuestion** 工具，问题如下：

- question: \`这一份还原需要效果图对比吗？\`
- header: \`效果图对比\`
- options:
  - label: \`不需要\`，description: \`跳过效果图。\`
  - label: \`需要（推荐做 UI 还原时开启）\`，description: \`获取设计稿。AI 在生成代码时会对照效果图做视觉校验和修正，提升像素级还原度。增加约 1-2 秒耗时。\`

把用户选择记为 \`needPreview: boolean\`。

### 步骤 3：调用 \`get_figma_node\`

调用 MCP 工具 \`get_figma_node\`，传：

\`\`\`json
{
  "fileKey": "<解析出的 fileKey>",
  "nodeId": "<nodeId，必填>",
  "includePreview": <needPreview>
}
\`\`\`

从响应里拿到 \`imageAssets\` 数组和设计数据。

**如果 \`needPreview === true\`**：

- **FRAME / COMPONENT 节点**：MCP 响应中除了设计数据文本，还包含一张**内联渲染的 PNG 效果图**（跟在设计数据文本块后面）。
- **SECTION 节点（多状态/多页面）**：MCP 响应中包含 N 张效果图，每张前有标签 \`--- 帧 <frameId> 效果图 ---\`，各图对应一个直接子 Frame。

你能看到这些效果图。在后续步骤 7 生成代码前，先观察效果图中的整体布局、元素位置、颜色分布和文字区域——这些视觉信息是结构化数据无法完全传达的。

### 步骤 4：按 \`category\` 把资源分两组

\`\`\`ts
const exportAssets = imageAssets.filter(a => a.category === "export-tagged");
const otherAssets = imageAssets.filter(a => a.category === "auto-detected");
\`\`\`

**不要**自己解析 \`reason\` 字符串去判断分组。\`category\` 字段是 MCP 暴露的稳定接口，\`reason\` 是实现细节。

把分组结果简短报给用户，**每组最多列前 5 条**避免刷屏：

\`\`\`
本次拿到 N 个资源节点：
- 设计师 Export 标记（必下）：K 个 — 例如 icon_back.png / icon_close.png / ...
- 自动识别（vector / image fill，可选）：M 个 — 例如 bg_card.png / illus_hero.png / ...
\`\`\`

若 \`imageAssets\` 为空，跳到步骤 7。

### 步骤 5：问"资源下载策略"

调用 **AskUserQuestion** 工具，问题如下：

- question: \`这些资源怎么处理？\`
- header: \`下载策略\`
- options:
  - label: \`仅下载 Export 标记的\`，description: \`auto-detected 那批（vector / image fill）不下载，代码里用纯色占位。最贴合"只发设计师签发资源"的做法。\`
  - label: \`全部下载\`，description: \`两类都下，代码里直接按 PNG 文件名引用。保底完整。\`

把用户选择记为 \`onlyExportTagged: boolean\`（"仅下载 Export"对应 \`true\`）。

### 步骤 6：调用 \`download_figma_images\`

调用 MCP 工具 \`download_figma_images\`，传：

\`\`\`json
{
  "fileKey": "<同上>",
  "localPath": "<Android 项目的 res 目录相对路径，例如 app/src/main/res>",
  "densities": ["xhdpi", "xxhdpi"],
  "onlyExportTagged": <用户选择>,
  "nodes": [
    {
      "nodeId": "<imageAssets[i].nodeId>",
      "fileName": "<imageAssets[i].suggestedFileName>",
      "category": "<imageAssets[i].category>"
    }
  ]
}
\`\`\`

**注意**：

- \`nodes\` 数组里**保留每个节点的 \`category\`**——MCP 端根据这个字段配合 \`onlyExportTagged\` 自动过滤。
- 不需要自己在 skill 端过滤；把所有 \`imageAssets\` 翻译成 \`nodes\` 一次性传过去就行。
- \`localPath\` 如果用户没说过，问一次；常见值是 \`app/src/main/res\`。

### 步骤 7：生成 Android 代码

按以下顺序写代码：

#### 若 \`needPreview === true\`：生成前先做视觉分析

**多帧处理（SECTION 节点）**：若响应中包含多张效果图，每张前有标签 \`--- 帧 <frameId> 效果图 ---\`，各图对应一个 Frame 状态。按以下顺序处理：先完整读取所有效果图建立页面/状态的整体认知，再为每个 Frame 状态分别做下方的视觉分析，最后生成对应状态的代码。

**文件拆分（强制）**：若响应头部包含 \`文件拆分计划\`，必须按清单生成多个独立文件——每个页面组一个 Screen 文件、每个对话框一个 Dialog 文件（同一弹窗的多个状态共用一个文件）。每帧 \`metadata.suggestedFile\` 标明该帧数据归属哪个文件。**禁止**把所有页面和弹窗写进同一个文件；弹窗 UI 本体不写进页面文件，页面只持有显示/隐藏逻辑。建议文件名保留了设计稿原始中文名，落地时按项目惯例翻译为英文并放入合适目录。无 \`文件拆分计划\`（单页面多状态）时保持单文件 + sealed class，不要擅自拆分。

在写任何代码之前，**必须先把效果图按视觉边界划分成独立区域**。不要跳过这一步——这是决定容器嵌套结构的依据。

##### 分区域规则

1. 找到效果图中的**明显视觉分隔线**（色块边界、间距突变、背景变化）
2. 从上到下把页面切成独立区域（如：顶栏区 → Banner 区 → 步骤区 → 产品列表区 → 订单区）
3. 对**每个区域**回答以下问题：

\`\`\`
区域名称: ___________
边界: 从 ___ 到 ___ (大概的纵向范围)
与上一区域的关系: □ 独立分隔  □ 叠加覆盖
区域内元素有重叠吗: □ 有重叠  □ 无重叠
如果是无重叠: □ 横向排列  □ 纵向排列
子元素相对位置:
  - 元素A: (左/中/右) (上/中/下)
  - 元素B: (左/中/右) (上/中/下)
  - ...
\`\`\`

4. 区域的"有无重叠"判断直接决定容器类型：
   - **有重叠** → 必须用 \`FrameLayout\`（子元素需要绝对定位来叠加）
   - **无重叠** → 用 \`LinearLayout\`(vertical/horizontal) 或 \`ConstraintLayout\`，**禁止**用 FrameLayout + 硬编码 marginTop/marginStart 来间隔

然后结合设计数据的 \`layoutHints\`、\`layout\`、\`arrangement\`、\`alignment\` 字段，用效果图做**交叉验证**。冲突时：排版以效果图为准；外观/文本属性以 Figma 导出数据为准。

#### 容器选择规则（强制）

在写 XML/Compose 骨架代码之前，必须根据视觉分析的结果选择容器。**这是还原度的核心决策点。**

| 区域子元素关系 | View 容器 | Compose 容器 | 定位方式 |
|-------------|---------|-------------|---------|
| 有重叠（一个盖住另一个的一部分） | \`FrameLayout\` | \`Box\` | View: \`layout_marginStart\`/\`layout_marginTop\` 绝对定位；Compose: \`Modifier.align(Alignment.Xxx).padding(start/top/end/bottom = N.dp)\` |
| 无重叠，纵向排列 | \`LinearLayout(vertical)\` | \`Column\` | 子元素自然流式排列，间距用子元素 margin/Spacer 控制 |
| 无重叠，横向排列 | \`LinearLayout(horizontal)\` | \`Row\` | 子元素自然流式排列，元素间距用子元素 margin/Spacer 控制 |
| 无重叠，复杂约束 | \`ConstraintLayout\` | \`ConstraintLayout\` (Compose) | 约束定位 |

**禁令 1**：禁止把**无重叠、可流式排列**的元素用绝对坐标摊平到一个 FrameLayout 里。
**禁令 2**：禁止用固定 1361dp 高度硬编码容器——用 \`wrap_content\` 让内容自然撑开。
**禁令 3**：禁止同时使用 \`layout_gravity="center_horizontal"\` 和 \`layout_marginStart\`——二者互相矛盾。

非重叠元素使用 marginTop/marginStart 把应该由容器管理的布局责任推给了硬编码数值，是还原度差的头号原因。

##### 容器嵌套原则

- 页面的**顶层**应该用 \`LinearLayout(vertical)\` 包裹各视觉区域（区域之间无覆盖），而非把所有区域摊平到 \`FrameLayout\`
- 只有**区域内**的元素确实有叠加关系时，才在该区域用 \`FrameLayout\`
- 嵌套层次控制在 3-4 层以内，不要为了"完全还原 Figma 层级树"而无脑套娃

**写完后自检（强制，单端各跑一次）：**

1. **大容器宽度检查**——搜 \`width.*\\d{3,}\\.dp\` 或 \`layout_width="\\d{3,}dp"\`：
   宽度 ≥ 300dp 的非白名单容器 → 改为 \`fillMaxWidth().padding(horizontal = N.dp)\` 或 \`match_parent\` + \`marginHorizontal\`。

2. **横向弹性检查**——确认 Row / LinearLayout(horizontal) 内的"吃满剩余空间"子元素：
   必须用 \`Modifier.weight(1f)\` 或 \`width=0dp\` + \`layout_weight=1\`，**不能**用"按设计稿剩余空间推算出的固定 dp"。

3. **右锚检查**——确认靠右元素：
   必须用 \`Alignment.End\` / \`gravity=end\` + \`padding(end = N.dp)\` / \`marginEnd=Ndp\`，**不能**用 \`marginStart = (设计宽 − 内容宽)\` 推算偏移量。

4. **禁止项排查**：
   - 搜 \`marginStart\` 值 > 100dp 的 → 确认不是"假装居中"，应改为 \`gravity=center_horizontal\` / \`Alignment.CenterHorizontally\`。
   - 搜 \`layout_gravity="center_horizontal"\` 同时存在 \`layout_marginStart\` → 删除 marginStart，二选一。

5. **Compose 专属检查（强制）**：
   - 搜 \`ContentScale\\.Fit\` → 全部核实：Figma 下载的 PNG 切图必须用 \`ContentScale.FillBounds\`，仅网络/资源图片可用 Fit。
   - 搜 \`FontWeight\\.SemiBold\` → 核实文本样式：若设计数据标注 bold / fontWeight 700，改为 \`FontWeight.Bold\`。
   - 搜 \`endX\\s*=\\s*0?\\.\\d+f\` → 除 0f 和 1f 外必须有 Figma gradientTransform 数据支撑，否则改回 1f。
   - ${COMPOSE_OFFSET_SELF_CHECK_ZH}。

6. **View 专属检查（强制）**：
   - 搜 \`android:elevation\` → boxShadow 必须用 \`<layer-list>\` drawable，不会转换就跳过阴影。
   - ${VIEWS_SELF_CHECK_ZH}。

1. **排版**：根据 \`layout\` / \`arrangement\` / \`alignment\` / \`spacing\` / \`width\` / \`height\`（或传统 View 的 \`orientation\` / \`gravity\` / \`layout_width\` / \`layout_height\`）搭骨架。优先用 get_figma_data 返回的 \`layoutHints\` 决定 Column/Row/Box 还是 ConstraintLayout。**对照效果图确认容器嵌套层次和排列方向与视觉一致，若效果图与数据矛盾，以效果图为准。**
2. **外观**：fills（含颜色 hex）、strokes、cornerRadius、effects（阴影 / 模糊）。**以 Figma 导出数据为准**——颜色值、描边粗细、圆角半径、阴影参数都是精确数值，效果图可能因渲染/压缩产生偏差。
3. **文本**：内容、字体、字号（sp）、字重、颜色、行高。**以 Figma 导出数据为准**——这些是精确的结构化属性，效果图可能因渲染产生偏差。
4. **组件状态**：variants 直接映射为 sealed class / enum 状态参数。


#### 资源处理（**严格按此**，禁止偏离）

| 节点类型 | 用户选了"全部下载" | 用户选了"仅下载 Export" |
|---------|---------------------|--------------------------|
| \`category: "export-tagged"\` | 已下载，按文件名直接引用资源（\`R.mipmap.icon_back\` / \`painterResource(R.mipmap.icon_back)\`） | 同上，已下载，按文件名直接引用 |
| \`category: "auto-detected"\` | 已下载，按文件名直接引用资源 | **未下载**——用纯色占位 |

#### "纯色占位"的具体写法

当一个 auto-detected 节点没下载，**禁止**使用以下方式去"重画"它：

- ❌ \`Icon(imageVector = Icons.Default.X, ...)\` 或自己拼 \`ImageVector\`
- ❌ \`Canvas { drawCircle(...) }\` 或任何 \`Canvas\` 绘制
- ❌ \`Brush.linearGradient\` / \`Brush.radialGradient\` 还原渐变
- ❌ XML \`<shape>\` / \`<gradient>\` / \`VectorDrawable\`

**正确做法**：取该节点的主色（fills 里的第一种纯色），或邻近父容器的背景色，画一个同尺寸的色块占位：

- Compose：\`Box(Modifier.size(<W>.dp, <H>.dp).background(Color(0xFF...)))\`
- 传统 View：\`<View android:layout_width="<W>dp" android:layout_height="<H>dp" android:background="#..."/>\`

可以加一行注释标明 \`// 待替换：figma 节点 <nodeId> 的实际图像\` 便于后续手动补资源。

#### 若 \`needPreview === true\`：生成后自检并修正

代码写完后，**你自己**对照效果图逐项过一遍已生成的代码。**逐项检查、逐项打勾**，不要跳过：

1. **z-order**：顶层元素声明顺序是否和效果图视觉层级一致（后声明的在上面）？有无被意外覆盖的元素？
2. **裁剪**：有没有子元素尺寸超过父容器导致被裁剪？父容器高度是否 ≥ 最大子元素的 bottom 坐标？
3. **重叠**：有没有非预期的元素重叠（本应分开的独立区域互相覆盖）？
4. **间距**：margin、padding、spacing 是否与效果图中的视觉间距匹配？有没有"挤在一起"或"太松散"的偏差？
5. **颜色**：背景色、文字色、描边色是否与效果图中对应位置的颜色一致？（以 Figma 数据为准）
6. **字体**：各文本节点的字号（sp）、字重、行高是否与效果图的视觉层级吻合？（以 Figma 数据为准）
7. **对齐**：文字和图标在容器内的对齐方向（左/中/右，上/中/下）是否与效果图一致？

**发现偏差就直接改代码**，不要输出"建议修改"——你就是代码的作者，直接修正。修正完后再交付最终代码。

#### 若 \`needPreview === false\`

跳过以上自检，直接交付代码。

## 错误兜底

- 用户拒答任一 AskUserQuestion → 终止 skill，不要替用户选默认
- \`get_figma_data\` 报 403 / 401 → 提示用户检查 FIGMA_API_KEY 或文件权限，不要继续
- \`download_figma_images\` 报错 → 把错误原文给用户，**不要**降级到"用代码画图"——这违反上面的资源处理规则
- \`imageAssets\` 为空 → 跳过下载策略提问与下载步骤，直接进入步骤 7
- 当前模型不支持图片输入 → 步骤 1.5 已兜底，跳过步骤 2，\`needPreview = false\`，正常走纯数据路径。不要报错

## 备忘

- 单位规则：\`get_figma_data\` 输出的尺寸已是 dp，字号是 sp，letterSpacing 是 em（直接照抄），颜色是 hex/rgba
- \`nodeId\` 形如 \`I5666:180910;1:10515;1:10336\` 是嵌套实例链，整体当一个 ID 传，**不要**自己拆分号
- \`MCP 工具名\` 在 Claude Code 里可能带命名空间前缀（\`mcp__<别名>__get_figma_data\`），调用时按当前环境实际名字调即可，不要硬编码
`,
  },
];
