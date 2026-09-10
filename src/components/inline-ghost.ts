/**
 * Inline ghost text for live preview.
 *
 * Typora has no ghost-text primitive, so this renders the completion the same
 * way the source-mode prototype does — `insertCompletionTextToCodeMirror` puts
 * the text into the buffer and marks the range `text-gray font-italic`. Here the
 * completion is inserted INTO the document as a dimmed, non-editable span and
 * taken back out again when the user dismisses it.
 *
 * The property that matters: because the ghost is real text in the flow, the
 * paragraph REFLOWS around it, so nothing is ever hidden. The out-of-document
 * suggestion panel had to be painted on top of the prose, which occluded
 * whatever sat underneath it.
 *
 * Safety — the caller must treat the ghost as disposable:
 *   - it is never part of `state.markdown`;
 *   - accept removes the ghost and then runs the normal insert path, so the
 *     accepted text is written by that path and not by this module;
 *   - the span is torn down on Escape, on window blur, and on Ctrl/Cmd+S, in
 *     the capture phase, so a preview can never be saved into the user's file.
 */

/** Dim enough to read as a preview, bright enough to read. */
export const GHOST_OPACITY = "0.45";

export interface InlineGhostOptions {
  /** Called when the user dismisses the ghost without accepting it. */
  onDismiss?: () => void;
}

/**
 * Insert `text` at the caret as ghost text.
 *
 * @param text - The completion to preview.
 * @param options - Dismissal callback.
 * @returns A function that removes the ghost; safe to call more than once.
 */
export const attachInlineGhost = (text: string, options: InlineGhostOptions = {}): (() => void) => {
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
  if (!range) return () => {};

  // Collapse first so a non-collapsed selection cannot be split by the ghost.
  // A plain caret is already collapsed, so this is a no-op for the common case.
  range.collapse(true);

  const ghost = document.createElement("span");
  ghost.className = "inscribe-ghost";
  // Keeps the caret out of the preview, so typing and accepting behave as
  // though it were not there.
  ghost.setAttribute("contenteditable", "false");
  ghost.style.opacity = GHOST_OPACITY;
  ghost.textContent = text;

  let live = true;
  let dismissGuard: (event: Event) => void = () => {};

  const remove = (): void => {
    if (!live) return;
    live = false;
    window.removeEventListener("keydown", dismissGuard, true);
    window.removeEventListener("blur", dismissGuard);
    ghost.remove();
  };

  dismissGuard = (event: Event): void => {
    if (!live) return;
    if (event.type === "blur") {
      remove();
      options.onDismiss?.();
      return;
    }
    if (!(event instanceof KeyboardEvent)) return;
    const isEscape = event.key === "Escape";
    // A save with the ghost still inserted would write the preview into the
    // user's file, so drop it first and let the save go ahead.
    const isSave = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s";
    if (!isEscape && !isSave) return;
    remove();
    options.onDismiss?.();
  };

  window.addEventListener("keydown", dismissGuard, true);
  window.addEventListener("blur", dismissGuard);

  try {
    range.insertNode(ghost);
  } catch {
    // The caret can disappear between reading the selection and inserting
    // (Typora re-renders aggressively). A failed preview must not break the
    // trigger, so fail to "no preview" rather than throwing.
    remove();
  }

  return remove;
};
