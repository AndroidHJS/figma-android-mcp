/**
 * Single source of truth for the absolute-positioning policy, both platforms.
 *
 * History: the `android-layout` skill said "never translate Figma absolute
 * coordinates to Modifier.offset" while the get_figma_data layoutHints said
 * "ALWAYS use Modifier.offset for absolutely positioned children — NEVER
 * Column + Spacer". Both rules reached the LLM in the same context and it
 * picked one at random. This module replaces both with one precedence ladder.
 *
 * The English and Chinese renderings below MUST express the same ladder.
 * If you change one, change the other in the same commit — that is the whole
 * point of co-locating them.
 *
 * The ladder, canonically:
 *   1. regionHints entry covers the parent → rebuild with suggested containers.
 *   2. Children non-overlapping and ordered along one axis → Column/Row with
 *      gaps computed from coordinate deltas (exact, not approximations).
 *   3. Child edge-anchored or centered (constraint MAX/center) → Box + align + padding.
 *   4. Anything else (overlap / scatter, no inferable structure) → Box + offset
 *      as a faithful fallback. A guessed structure hurts fidelity more than offset.
 *   5. Animated displacement → the only valid use of lambda-form offset.
 */

/** English rendering, emitted in `layoutHints` for the Compose platform. */
export const COMPOSE_ABSOLUTE_POSITIONING_HINT = `ABSOLUTE POSITIONING (parent layout mode "none"): follow this precedence strictly, top to bottom. (1) If a regionHints entry covers the parent, rebuild the structure with the suggested containers (Column/Row/Box); when the hint lists \`attachments\`, nest each attached element inside its host's Box, aligned per the attachment's \`anchor\`/\`insets\` — never position it independently from the region root. (2) Else if the children do not overlap and are ordered along one axis, use Column/Row with gaps computed from coordinate deltas (gap = next.y − prev.y − prev.height) via Spacer or Arrangement.spacedBy — deltas are exact values, not approximations. (3) If a child's layout carries server-inferred anchor fields — \`anchorAlignment\` + \`anchorMargin\` — translate them verbatim: Box + Modifier.align(Alignment.<anchorAlignment>).padding(<anchorMargin>); do NOT re-derive the position from raw coordinates. Same for explicit horizontalConstraint/verticalConstraint values. (4) Otherwise — overlapping or scattered children with no anchor data and no inferable structure — use Box + Modifier.offset(x = offset.x, y = offset.y); a faithful coordinate fallback beats a guessed structure. Do NOT force Column + Spacer onto level-4 layouts. (5) Lambda-form Modifier.offset {} is reserved for animation-driven displacement.`;

/** Chinese rendering, interpolated into the `android-layout` skill content. */
export const COMPOSE_OFFSET_RULES_ZH = `### 绝对定位与 .offset() 使用准则（Compose 专属）

父容器无 \`layout\`/Row/Column 字段（mode "none"）、子节点带 offset 坐标时，**按以下优先级逐级判断，不可跳级**：

1. **regionHints 命中该父容器** → 按 hints 推荐的容器（Column/Row/Box）还原结构。若 hint 带 \`attachments\`（小元素附着大元素，如头像+角标），附着元素必须嵌进宿主的 Box 内、按 \`anchor\`/\`insets\` 对齐，**禁止**把它当独立散点从区域根上定位。
2. **子元素无重叠且沿单轴有序** → \`Column\`/\`Row\` + \`Spacer\` / \`Arrangement.spacedBy()\`，间距用相邻坐标差**精确计算**（gap = 下一个.y − 上一个.y − 上一个.height），这是精确值不是估算。
   - ❌ \`Box(modifier = Modifier.offset(y = 100.dp)) { ... }\` — 用 offset 表达本可结构化的顺序间距
   - ✅ \`Column { A(); Spacer(Modifier.height(gap.dp)); B() }\`
3. **数据已带服务端推断的锚点字段**（Compose：\`anchorAlignment\` + \`anchorMargin\`；传统 View：\`layoutGravity\` + \`layout_margin*\`）→ **按字段直译**，禁止自己再从坐标推位置：
   - ✅ \`Image(Modifier.align(Alignment.BottomEnd).padding(end = 8.dp, bottom = 6.dp))\`（anchorAlignment: BottomEnd）
   - 显式 constraint（end/bottom/center）同理直译为 \`align\` + \`padding\`。
4. **其余情况**（重叠、散点、无锚点数据且推不出结构）→ \`Box\` + \`Modifier.offset(x, y)\` 兜底，忠实保留设计坐标。**此时禁止**硬凑 Column + Spacer 去近似——结构猜错比 offset 更伤还原度。
5. **动画位移** → 唯一允许 lambda 形式 offset 的场景：

\`\`\`kotlin
val offsetY by animateFloatAsState(...)
Modifier.offset { IntOffset(0, offsetY.roundToInt()) }
\`\`\`

（传统 View 平台在其规则集中有对应的 margin 定位阶梯，此处不重复。）`;

/** Chinese self-check line for `.offset(` audits, shared by both skills. */
export const COMPOSE_OFFSET_SELF_CHECK_ZH = `搜 \`.offset(\` → 核对是否落在定位准则第 4/5 级（重叠散点兜底 或 动画驱动）；若数据带 anchorAlignment/anchorMargin（第 3 级），改 align + padding 直译；若子元素实际无重叠且单轴有序（第 2 级），改 Column/Row + 坐标差间距`;

/**
 * Views rendering of the same 5-level ladder. Levels 1-3 mirror Compose
 * one-to-one; level 4 differs because Views have no offset concept — the
 * faithful fallback is FrameLayout + layout_marginStart/Top, which is also
 * why margins-as-positioning must never leak into levels 1-3.
 */

/** English rendering, emitted in `layoutHints` for the views platform. */
export const VIEWS_ABSOLUTE_POSITIONING_HINT = `ABSOLUTE POSITIONING (parent layout mode "none"): follow this precedence strictly, top to bottom. (1) If a regionHints entry covers the parent, rebuild the structure with the suggested containers (viewsContainer/viewsOrientation); when the hint lists \`attachments\`, nest each attached element inside its host's FrameLayout, positioned per the attachment's \`anchor\`/\`insets\` — never position it independently from the region root. (2) Else if the children do not overlap and are ordered along one axis, use LinearLayout(vertical/horizontal) with inter-child margins computed from coordinate deltas (margin = next.y − prev.y − prev.height) — deltas are exact values, not approximations. (3) If a child's layout carries server-inferred anchor fields — \`layoutGravity\` + \`layout_margin*\` — translate them verbatim: android:layout_gravity plus exactly those margins inside a FrameLayout; do NOT re-derive the position from raw coordinates. Same for explicit layout_constraintHorizontal/Vertical values. (4) Otherwise — overlapping or scattered children with no anchor data and no inferable structure — use FrameLayout + layout_marginStart/layout_marginTop as a faithful coordinate fallback; Views have no offset equivalent, and a guessed structure hurts fidelity more than margin positioning. Do NOT force LinearLayout onto level-4 layouts. (5) Animated displacement belongs in code (ObjectAnimator / View.setTranslationX/Y), never baked into static layout margins.`;

/** Chinese rendering, interpolated into the `android-layout` skill content. */
export const VIEWS_OFFSET_RULES_ZH = `### 绝对定位与 margin 定位使用准则（传统 View 专属）

父容器无 \`orientation\` 字段（mode "none"）、子节点带 margin 坐标时，**按以下优先级逐级判断，不可跳级**：

1. **regionHints 命中该父容器** → 按 hints 推荐的容器（viewsContainer/viewsOrientation）还原结构。若 hint 带 \`attachments\`（小元素附着大元素，如头像+角标），附着元素必须嵌进宿主的 FrameLayout 内、按 \`anchor\`/\`insets\` 定位，**禁止**把它当独立散点从区域根上定位。
2. **子元素无重叠且沿单轴有序** → \`LinearLayout(vertical/horizontal)\`，子元素间距用相邻坐标差**精确计算**（margin = 下一个.y − 上一个.y − 上一个.height），这是精确值不是估算。
   - ❌ FrameLayout 里每个子 View 各自 \`layout_marginTop="100dp"\` — 用绝对 margin 表达本可结构化的顺序间距
   - ✅ \`LinearLayout(vertical)\` + 子元素 \`layout_marginTop="<坐标差>dp"\`
3. **数据已带服务端推断的锚点字段**（\`layoutGravity\` + \`layout_margin*\`）→ 在 FrameLayout 内**按字段直译** \`android:layout_gravity\` + 对应 margin，禁止自己再从坐标推位置。显式 \`layout_constraintHorizontal/Vertical\`（end/bottom/center）同理直译为 \`layout_gravity\` + \`layout_marginEnd/Bottom\`。
4. **其余情况**（重叠、散点、无锚点数据且推不出结构）→ \`FrameLayout\` + \`layout_marginStart/Top\` 兜底，忠实保留设计坐标。View 没有 offset 等价物，这是平台约束；**此时禁止**硬凑 LinearLayout 去近似——结构猜错比 margin 定位更伤还原度。
5. **动画位移** → 写在代码里（\`ObjectAnimator\` / \`translationX/Y\`），禁止把动画终态烘焙进静态布局的 margin。`;

/** Chinese self-check line for FrameLayout-margin audits in views output. */
export const VIEWS_SELF_CHECK_ZH = `搜 FrameLayout 直接子 View 的 \`layout_marginStart/Top\` 大数值定位 → 核对是否落在定位准则第 4 级（重叠散点兜底）；若数据带 layoutGravity（第 3 级），改 layout_gravity + margin 直译；若子元素实际无重叠且单轴有序（第 2 级），改 LinearLayout + 坐标差间距`;
