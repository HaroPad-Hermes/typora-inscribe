/**
 * Reading the user's live text selection out of Typora's preview DOM.
 *
 * Shared foundation for two planned features: the selection-edit menu and
 * selection-context plumbing. Both need the same three things — the selected
 * text, where it sits on screen so a menu can be anchored to it, and a refusal
 * that says WHY there is no selection. Returning an empty string for "nothing
 * selected" would make a menu that never appears indistinguishable from a
 * selection that was silently dropped, so every rejection is named.
 *
 * Inputs are injected (`writingArea`, `selection`, `getRect`) exactly the way
 * `deriveCaretFromDomSelection` takes its own, so the logic is exercisable in
 * happy-dom without a real editor.
 */

/**
 * Surfaces owned by this plugin. A selection inside one of these is the user
 * selecting our own UI text — never document text.
 */
export const INSCRIBE_UI_SELECTOR = [
  "#copilot-chat-panel",
  ".inscribe-toggle-cluster",
  ".inscribe-settings",
  ".inscribe-ghost",
  ".inscribe-selection-menu",
  ".inscribe-selection-preview",
].join(", ");

/** Selections longer than this are refused rather than sent to a model. */
export const MAX_SELECTION_CHARS = 8000;

export interface SelectionRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SelectedText {
  /** The selected text exactly as rendered, untrimmed. */
  text: string;
  /** Viewport coordinates of the selection, for anchoring a menu to it. */
  rect: SelectionRect;
  /** The top-level block the selection starts in, when one can be found. */
  block: Element | null;
}

export type SelectionRefusal =
  | "no-selection-api"
  | "collapsed"
  | "outside-writing-area"
  | "inside-inscribe-ui"
  | "empty-text"
  | "too-long";

export type SelectionReadResult =
  | { ok: true; selection: SelectedText }
  | { ok: false; reason: SelectionRefusal };

export interface ReadSelectionOptions {
  /** The editor's `#write` container. */
  writingArea: Element | null;
  /** Live selection — pass `window.getSelection()`. */
  selection: Selection | null;
  /** Rect source, for tests. Defaults to the range's own client rect. */
  getRect?: (range: Range) => SelectionRect | null;
}

const NO_RECT: SelectionRect = { left: 0, top: 0, width: 0, height: 0 };

/**
 * Measure a range in viewport coordinates.
 *
 * @param range - The selected range.
 * @returns The rect, or null when the range has no measurable box.
 */
const measureRange = (range: Range): SelectionRect | null => {
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
};

/**
 * Walk up from `element` to the child of `writingArea` that contains it.
 *
 * @param element - A node inside the writing area.
 * @param writingArea - The editor's top-level content container.
 * @returns The owning top-level block, or null when there is none.
 */
const topBlockOf = (element: Element, writingArea: Element): Element | null => {
  let node: Element = element;
  let parent = node.parentElement;
  while (parent && parent !== writingArea) {
    node = parent;
    parent = parent.parentElement;
  }
  return parent === writingArea ? node : null;
};

/**
 * The refusals, phrased for a diagnostic log line.
 */
const REFUSAL_MESSAGES: Record<SelectionRefusal, string> = {
  "no-selection-api": "this window exposes no selection API",
  collapsed: "the caret is collapsed — nothing is selected",
  "outside-writing-area": "the selection is not inside the document body",
  "inside-inscribe-ui": "the selection is inside Inscribe's own UI",
  "empty-text": "the selection is whitespace only",
  "too-long": `the selection is longer than ${MAX_SELECTION_CHARS} characters`,
};

/**
 * Read the live selection, or name the reason there is none.
 *
 * A selection inside Inscribe's own UI is refused before the writing-area
 * containment check, so selecting chat text never reads as a document
 * selection even when the panel is nested in the editor.
 *
 * @param options - Writing area, live selection and an optional rect source.
 * @returns The selected text and its rect, or the reason it was refused.
 */
export function readSelection(options: ReadSelectionOptions): SelectionReadResult {
  const { getRect = measureRange, selection, writingArea } = options;

  if (!selection) return { ok: false, reason: "no-selection-api" };
  if (selection.rangeCount === 0 || selection.isCollapsed)
    return { ok: false, reason: "collapsed" };

  const range = selection.getRangeAt(0);
  const anchor = range.commonAncestorContainer;
  const element = anchor.nodeType === 1 ? (anchor as Element) : anchor.parentElement;

  if (!element) return { ok: false, reason: "outside-writing-area" };
  if (element.closest(INSCRIBE_UI_SELECTOR)) return { ok: false, reason: "inside-inscribe-ui" };
  if (!writingArea?.contains(element)) return { ok: false, reason: "outside-writing-area" };

  const text = selection.toString();
  if (!text.trim()) return { ok: false, reason: "empty-text" };
  if (text.length > MAX_SELECTION_CHARS) return { ok: false, reason: "too-long" };

  return {
    ok: true,
    selection: { text, rect: getRect(range) ?? NO_RECT, block: topBlockOf(element, writingArea) },
  };
}

/**
 * A short identity for a selection.
 *
 * `mouseup` and `selectionchange` both fire for one drag, so the menu wiring
 * needs to recognise the selection it is already showing. Comparing text alone
 * is not enough: selecting the same words in a different place must move the
 * menu rather than be ignored.
 *
 * @param selection - A selection returned by {@linkcode readSelection}.
 * @returns A key that is equal for the same selection and different otherwise.
 */
export function selectionSignature(selection: SelectedText): string {
  const { left, top } = selection.rect;
  return `${left},${top}:${selection.text.length}:${selection.text.slice(0, 32)}`;
}

/**
 * Turn a refusal into a log-ready sentence.
 *
 * @param reason - A refusal from {@linkcode readSelection}.
 * @returns A human-readable explanation of the refusal.
 */
export function describeRefusal(reason: SelectionRefusal): string {
  return REFUSAL_MESSAGES[reason];
}
