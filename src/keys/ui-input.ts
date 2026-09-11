/**
 * Which focused elements the trigger hotkey must not steal keys from.
 *
 * The guard exists so that typing in the chat box, the settings fields or the
 * file search never fires a completion. It was written as a raw tag check
 * (INPUT / TEXTAREA / SELECT), and that also matched the hidden textarea a
 * CodeMirror instance holds focus in — and a Typora code fence, and source
 * mode, are both CodeMirror. The trigger then returned BEFORE its own
 * diagnostic line, so the feature was silently dead in every code fence with
 * nothing in the log to say why.
 *
 * The distinction this encodes: a textarea is not necessarily a UI field — it
 * may be the editor itself. The editor is the one inside `.CodeMirror`.
 */

const UI_INPUT_TAGS = new Set(["INPUT", "SELECT", "TEXTAREA"]);

/** CodeMirror keeps focus in a hidden textarea; that textarea IS the editor. */
const EDITOR_FOCUS_SELECTOR = ".CodeMirror";

/**
 * True when the focused element is a UI field rather than the editor.
 *
 * @param element - The focused element, normally `document.activeElement`.
 * @returns Whether the trigger hotkey should ignore this keystroke.
 */
export const isUiInputTarget = (element: Element | null): boolean => {
  if (!element) return false;
  if (!UI_INPUT_TAGS.has(element.tagName)) return false;
  return element.closest(EDITOR_FOCUS_SELECTOR) === null;
};
