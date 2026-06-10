/**
 * Prompt text for overlay semantics (toasts / dialogs detected in static
 * designs). Counterpart of overlay-detection.ts — if detection behavior
 * changes, update BOTH renderings here in the same commit.
 */

/** English note emitted alongside the `overlays` output section. */
export const OVERLAY_OUTPUT_NOTE = `These nodes are TRANSIENT overlays painted into the static design — they are NOT permanent page content. kind=toast: implement as a triggered toast/snackbar (Compose: SnackbarHost, or a state-gated Box + LaunchedEffect auto-dismiss; Views: Toast/Snackbar API); take colors/radius/text styling from the node's design data but do NOT place it in the static layout. kind=dialog: implement as a Dialog or ModalBottomSheet per \`presentation\`, state-controlled; apply \`scrim\` as the scrim color. Nodes listed in \`strippedBackdrop\` were REMOVED from this output — they are a dimmed copy of another page that marks where the dialog pops up; never re-render them. confidence=medium entries are heuristic — confirm with the user if the context is ambiguous.`;

/** Chinese rules section, interpolated into the android-layout skill. */
export const OVERLAY_RULES_ZH = `## 瞬态浮层规则（toast / 弹窗，强制）

输出中带 \`overlays\` 区块或节点带 \`overlayRole\` 字段时，这些是设计师画进静态稿的**瞬态 UI**，禁止当成常驻页面内容还原：

- **toast**：事件触发显示、自动消失。Compose 用 \`SnackbarHost\` 或状态门控的 \`Box\` + \`LaunchedEffect\` 延时关闭；传统 View 用 \`Toast\`/\`Snackbar\` API。样式（背景色、圆角、图标、文案）照常取自节点设计数据，但**禁止**写进静态布局树。
- **dialog**：按 \`presentation\` 实现——\`bottomSheet\` → \`ModalBottomSheet\`；\`centerDialog\` → \`Dialog\`，显隐由状态控制，遮罩色用 \`scrim\` 值。
- \`strippedBackdrop\` 列出的节点已从输出中移除——那是压暗的**其他页面副本**，只用来标记弹窗弹在哪个页面之上，**禁止**重新实现它们。
- \`confidence: medium\` 的条目是启发式判定，语义存疑时先和用户确认一句再写代码。`;
