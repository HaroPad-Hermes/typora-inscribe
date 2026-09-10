/**
 * The floating action menu for a text selection.
 *
 * Typora has no selection-menu primitive, so this is a `position: fixed`
 * element anchored to the selection's rect — the same family of placement the
 * inline ghost and the suggestion panel use. Absolute positioning inside the
 * editor's scroll container was tried for the ghost and failed (the container
 * is not the offset parent Typora's layout suggests), so this does not repeat
 * that mistake.
 *
 * Two properties are load-bearing:
 *   - the menu is dismissed on scroll rather than repositioned, because a menu
 *     that silently drifts away from the text it acts on is worse than no menu;
 *   - a button's `mousedown` is defaulted away, so opening the menu does not
 *     collapse the selection the action is about to act on.
 *
 * The menu is registered in `INSCRIBE_UI_SELECTOR`, so selecting its own label
 * never reads back as a document selection.
 */

import type { SelectedText } from "../selection/selection";

/** Vertical gap between the selection and the menu. */
const MENU_GAP = 6;
/** Keep this far from the viewport edges. */
const EDGE_MARGIN = 8;
/** Used before layout exists (and in tests, where nothing is laid out). */
const FALLBACK_WIDTH = 200;
const FALLBACK_HEIGHT = 32;

export const SELECTION_MENU_CLASS = "inscribe-selection-menu";

export interface SelectionMenuAction {
  /** Stable identifier, used for the button's `data-action`. */
  id: string;
  /** Button label. */
  label: string;
  /** Called with the selection the menu was opened for. */
  onSelect: (selection: SelectedText) => void;
}

export interface AttachSelectionMenuOptions {
  /** The selection to act on; its rect anchors the menu. */
  selection: SelectedText;
  /** Actions to offer, in display order. */
  actions: SelectionMenuAction[];
  /** Document to attach to. Defaults to the global document. */
  doc?: Document;
}

/**
 * Position the menu against the selection, above it when there is room.
 *
 * @param menu - The menu element.
 * @param rect - The selection's rect in viewport coordinates.
 * @param view - The window, for viewport bounds.
 */
function placeMenu(menu: HTMLElement, rect: SelectedText["rect"], view: Window | null): void {
  const width = menu.offsetWidth || FALLBACK_WIDTH;
  const height = menu.offsetHeight || FALLBACK_HEIGHT;
  const viewportWidth = view?.innerWidth ?? 0;

  const maxLeft = Math.max(EDGE_MARGIN, viewportWidth - width - EDGE_MARGIN);
  const left = viewportWidth > 0 ? Math.min(Math.max(rect.left, EDGE_MARGIN), maxLeft) : rect.left;

  const above = rect.top - height - MENU_GAP;
  const top = above < EDGE_MARGIN ? rect.top + rect.height + MENU_GAP : above;

  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
}

/**
 * Show the action menu for a selection.
 *
 * @param options - The selection, the actions to offer and an optional document.
 * @returns A function that removes the menu and its listeners, or null when the
 *   selection has no measurable rect to anchor to (the caller decides whether
 *   that is worth logging).
 */
export function attachSelectionMenu(options: AttachSelectionMenuOptions): (() => void) | null {
  const { actions, doc = document, selection } = options;
  const { rect } = selection;

  // A selection with no box cannot be anchored to; fail to "no menu" rather
  // than pinning the menu to the corner of the window.
  if (rect.width === 0 && rect.height === 0) return null;

  const menu = doc.createElement("div");
  menu.className = SELECTION_MENU_CLASS;
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Inscribe");

  for (const action of actions) {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = `${SELECTION_MENU_CLASS}-action`;
    button.dataset.action = action.id;
    button.textContent = action.label;
    // Keep the selection alive: without this the click collapses it before
    // `onSelect` can read it.
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener("click", () => {
      remove();
      action.onSelect(selection);
    });
    menu.appendChild(button);
  }

  menu.style.position = "fixed";
  placeMenu(menu, rect, doc.defaultView);
  doc.body.appendChild(menu);

  let live = true;
  const onKeyDown = (event: Event): void => {
    if (!(event instanceof KeyboardEvent)) return;
    const isEscape = event.key === "Escape";
    // Same save-safety rule as the ghost: never leave plugin UI up across a save.
    const isSave = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s";
    if (isEscape || isSave) remove();
  };
  const onPointerDown = (event: Event): void => {
    const target = event.target;
    if (target instanceof Node && menu.contains(target)) return;
    remove();
  };
  const remove = (): void => {
    if (!live) return;
    live = false;
    doc.removeEventListener("keydown", onKeyDown, true);
    doc.removeEventListener("mousedown", onPointerDown, true);
    doc.defaultView?.removeEventListener("scroll", remove, true);
    doc.defaultView?.removeEventListener("blur", remove);
    menu.remove();
  };

  doc.addEventListener("keydown", onKeyDown, true);
  doc.addEventListener("mousedown", onPointerDown, true);
  doc.defaultView?.addEventListener("scroll", remove, true);
  doc.defaultView?.addEventListener("blur", remove);

  return remove;
}
