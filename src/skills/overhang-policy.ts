/**
 * Overhang policy — children that visibly extend past their parent's or
 * host's edge. Counterpart of detectEdgeStraddle (anchor-inference.ts) and
 * the anchorOverhang mapper fields: if detection or field shapes change,
 * update BOTH renderings here in the same commit.
 *
 * Data markers the LLM may encounter:
 *   - regionHints attachment with role "straddle" + `overhang` — a child
 *     riding across its host's edge (dialog banner / gift illustration).
 *   - `anchorOverhang` on a child's layout — anchor inference found the
 *     child poking past the parent edge (insets were negative).
 *   - `clipsContent: false` on a parent layout — overflow is VISIBLE by
 *     design. Absent = Figma default = clipped = the overflow is invisible
 *     and must NOT be restored.
 *
 * Canonical restore — the "transparent root" restructure:
 *   1. Root container TRANSPARENT, sized host + overhang.
 *   2. Host child offset inward by the overhang (top/bottom margin-padding).
 *   3. Rider declared AFTER the host so it draws on top, anchored per data.
 * Negative paddings/margins and clip-disabling hacks are forbidden: Compose
 * padding crashes on negatives; Views clipChildren chains silently break
 * when any ancestor is missed.
 */

/** English rendering, emitted in `layoutHints` for the Compose platform. */
export const OVERHANG_HINT_COMPOSE = `OVERHANG (child visibly extends past its host's edge — regionHints attachment role "straddle" with \`overhang\`, or layout field \`anchorOverhang\`): restore with the transparent-root restructure. Wrap host + rider in a Box sized host-height + overhang; give the HOST Modifier.padding(top = overhang) (bottom for bottom-side overhang); declare the RIDER after the host, aligned per its anchor data. Do NOT use negative padding (it crashes) and do NOT rely on Modifier.offset with negative values unless the entire parent chain is guaranteed clip-free. Dialogs: presentation "bottomSheet" → ModalBottomSheet(containerColor = Color.Transparent) with the visible white panel as an inner child; "centerDialog" → Dialog with a transparent root (the default Surface shape would clip the rider). If the rider's image asset was not downloaded, render the solid-color placeholder block at the exact straddle position — never drop the rider. Parents WITHOUT \`clipsContent: false\` clip overflow by design: keep it clipped (Modifier.clip(shape)) instead of restoring what the design hides.`;

/** English rendering, emitted in `layoutHints` for the views platform. */
export const OVERHANG_HINT_VIEWS = `OVERHANG (child visibly extends past its host's edge — regionHints attachment role "straddle" with \`overhang\`, or layout field \`anchorOverhang\`): restore with the transparent-root restructure. Wrap host + rider in a transparent FrameLayout sized host-height + overhang; give the HOST android:layout_marginTop = overhang (marginBottom for bottom-side overhang); declare the RIDER after the host so it draws on top, positioned per its anchor data. Do NOT use negative layout_margin values and do NOT chain android:clipChildren="false" through ancestors — both break silently. Dialogs: presentation "bottomSheet" → BottomSheetDialog with a transparent bottomSheetStyle background, the visible white panel being an inner child; "centerDialog" → Dialog theme with android:windowBackground = transparent (the default window background clips the rider). If the rider's image asset was not downloaded, render the solid-color placeholder <View> at the exact straddle position — never drop the rider. Parents WITHOUT \`clipsContent: false\` clip overflow by design — Android Views clip by default, so literal translation already matches; do not restore what the design hides.`;

/** Chinese rules section, interpolated into the android-layout skill. */
export const OVERHANG_RULES_ZH = `## 越界元素规则（弹窗 banner / 骑跨插画，强制）

数据中出现以下任一标记时，说明子元素**可见地**越出宿主边缘（典型：弹窗顶部骑跨的 banner、礼盒插画）：

- regionHints 的 attachment 带 \`role: "straddle"\` + \`overhang\`（越出量，精确 dp）
- 子节点 layout 带 \`anchorOverhang\` 字段
- 父容器 layout 带 \`clipsContent: false\`（不裁剪，越界可见是设计意图）

**标准还原法——透明根重构（两端同构）**：

1. 用**透明**根容器包住宿主+骑跨元素，高度 = 宿主高 + overhang
2. 宿主下移 overhang（<!--compose-->Compose: \`Modifier.padding(top = overhang)\`<!--/compose--><!--views-->View: \`layout_marginTop\`<!--/views-->）
3. 骑跨元素声明在宿主**之后**（后声明者在上层），按其 anchor/insets 定位

**禁止项**：

- ❌ 负 padding（Compose 直接崩溃）/ 负 margin（View 默认被 clipChildren 裁掉）
- ❌ 沿祖先链层层设 \`clipChildren="false"\`——漏一层就静默失效
- ❌ 骑跨元素的图片资源没下载就把元素整个丢弃 → ✅ 在骑跨位置画同尺寸主色占位块

**弹窗容器必须透明化**（否则自带的圆角白底会把越界部分裁掉）：

<!--compose-->
- \`presentation: "bottomSheet"\` → \`ModalBottomSheet(containerColor = Color.Transparent)\`，可见白底由内部子元素承担。
- \`presentation: "centerDialog"\` → \`Dialog\` 根容器透明（默认 Surface 形状会裁剪）。
<!--/compose-->
<!--views-->
- \`presentation: "bottomSheet"\` → \`BottomSheetDialog\` 的 bottomSheetStyle 背景设透明，可见白底由内部子元素承担。
- \`presentation: "centerDialog"\` → 弹窗主题 \`android:windowBackground\` 设透明。
<!--/views-->

**clipsContent 门控**：父容器 layout **没有** \`clipsContent: false\` 时，越界部分在设计中本来就被裁掉（如卡片角落露一半的装饰圆）——**禁止**"好心"还原它。<!--views-->View 默认裁剪行为已与设计一致，字面翻译即可。<!--/views--><!--compose-->Compose 需补 \`Modifier.clip(shape)\` 保持裁剪。<!--/compose-->`;

/** Chinese self-check lines for overhang audits, both platforms. */
export const OVERHANG_SELF_CHECK_COMPOSE_ZH = `搜 \`padding\\([^)]*-\\d\` 与 \`offset\\([^)]*-\\d\` → 负 padding 必删；负 offset 仅当父链确定不裁剪才允许，否则改透明根重构。数据带 straddle/anchorOverhang 时核对弹窗容器是否已透明化`;

export const OVERHANG_SELF_CHECK_VIEWS_ZH = `搜 \`layout_margin\\w*="-\` → 负 margin 必删，改透明根重构；搜 \`clipChildren\` → 不允许靠它实现越界。数据带 straddle/anchorOverhang 时核对 BottomSheetDialog/Dialog 背景是否已透明化`;
