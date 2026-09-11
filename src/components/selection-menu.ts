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

import "./selection-menu.scss";

import { placeNear } from "./floating";
import { attachDismissal } from "./floating-dismiss";

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
  /** Right edge of the text field, so the bar can pull in rather than overhang it. */
  boundaryRight?: number;
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
  const { actions, boundaryRight, doc = document, selection } = options;
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

  placeNear(menu, rect, doc.defaultView, { boundaryRight });
  doc.body.appendChild(menu);

  let live = true;
  const remove = (): void => {
    if (!live) return;
    live = false;
    detach();
    menu.remove();
  };

  const detach = attachDismissal({ doc, element: menu, onDismiss: remove });

  return remove;
}
