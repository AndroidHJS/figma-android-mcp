import type { Skill } from "./types.js";

export const builtInSkills: Skill[] = [
  {
    name: "responsive-width",
    title: "宽度响应式规则（强制）",
    description: "Figma 固定 dp 宽度 → Android 响应式宽度的翻译规则，禁止字面翻译固定宽度",
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

## 写完后自检（强制，单端各跑一次）

- Compose：搜 \\\`Modifier\\.(width|size)\\(\\s*\\d+(?:\\.\\d+)?\\.dp\\\`，逐处核对是否落在白名单
- View：grep \\\`layout_width="\\d+dp"\\\`，逐处核对是否落在白名单

不落白名单的，必须按上面表格重写。
`,
  },
];
