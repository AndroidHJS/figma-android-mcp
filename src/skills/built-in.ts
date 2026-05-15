import type { Skill } from "./types.js";

export const builtInSkills: Skill[] = [
  {
    name: "android-layout",
    title: "Android 布局翻译规则（强制）",
    description: "Figma 设计 → Android 布局代码的强制翻译约束，含宽度响应式与未下载资源占位规则",
    category: "layout",
    content: `# 宽度响应式规则（强制，不允许偏离）

Figma 数据里所有节点宽度都是固定 dp，**禁止字面翻译**。Android 设备宽度跨度大（320dp ~ 600dp+），字面翻译会在非基线设备上裁切或偏左堆积。

## 翻译规则

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

### Column/Row + Spacer 伪装绝对定位（Compose 专属，高发）

当父容器 mode 为 \`"none"\`（非 AutoLayout），子元素的偏移数据是精确的绝对坐标（\`offset.x\` / \`offset.y\`），却被塞进 Column/Row 用 Spacer 间距来"逼近"。

- ❌ parent mode="none" 的子元素塞进 Column，用 \`Spacer(height = N.dp)\` 模拟 \`marginTop\`
- ✅ 用 Box + \`Modifier.offset(x = Xdp, y = Ydp)\`，offset 值直接取自节点的 offset.x / offset.y 字段。绝对坐标不用"近似"。

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

## 写完后自检（强制，单端各跑一次）

- Compose：搜 \\\`Modifier\\.(width|size)\\(\\s*\\d+(?:\\.\\d+)?\\.dp\\\`，逐处核对是否落在白名单
- Compose 额外检查：
  - 搜 \`ContentScale\.Fit\` → 全部核对，Figma 切图应使用 \`ContentScale.FillBounds\`
  - 搜 \`FontWeight\.SemiBold\` → 核对是否应为 \`FontWeight.Bold\`
  - 搜 \`endX\\s*=\\s*[01]?\\.\\d+f\` → 除 0f 和 1f 外需有 gradientTransform 数据支撑
  - 搜 \`Column.*\\n.*Spacer\` 模式 → 若父容器 mode="none"，应改为 \`Box\` + \`Modifier.offset()\`
- View：grep \\\`layout_width="\\d+dp"\\\`，逐处核对是否落在白名单

不落白名单的，必须按上面表格重写。
`,
  },
];
