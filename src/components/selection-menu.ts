/**
 * The floating action bar for a selection.
 *
 * The shape is the reference implementation's (`obsidian-inscribe`'s selection
 * bar): the preset operations, a divider, an "Ask AI anything…" field, another
 * divider, and a thinking toggle at the end. An action either runs a preset's
 * instruction or the text the user typed, and the toggle decides whether that
 * one request is allowed to reason.
 *
 * Deliberately opaque. A translucent backdrop lets the document read through the
 * buttons, which makes the bar look broken and its labels unreadable over bold
 * or coloured text.
 *
 * Three rules the bar has to keep, all of them from the reference and all of
 * them load-bearing:
 *   - the bar's own `mousedown` is defaulted away, or clicking a button collapses
 *     the selection the action is about to read;
 *   - the text field stops propagation, so typing in it never reaches the editor;
 *   - Escape and a click outside dismiss it (see `attachDismissal`).
 */

import type { SelectionAction } from "../selection/actions";
import type { SelectedText } from "../selection/selection";

import type { PlacementOptions } from "./floating";
import { placeNear } from "./floating";
import { attachDismissal } from "./floating-dismiss";
import { iconSvg } from "./selection-icons";
import type { SelectionIconName } from "./selection-icons";
import { attachSelectionMirror } from "./selection-mirror";

import "./selection-menu.scss";

export const SELECTION_MENU_CLASS = "inscribe-selection-menu";

/** What the caller needs to steer an open bar. */
export interface SelectionMenuHandle {
  /** Take the bar down. Safe to call twice. */
  remove: () => void;
  /** Mark it busy while the model works, and idle again when it answers. */
  setBusy: (busy: boolean) => void;
}

export interface SelectionMenuOptions {
  /** The selection to act on; its rect anchors the bar. */
  selection: SelectedText;
  /** The preset operations to offer, in display order. */
  presets: SelectionAction[];
  /** Called with the instruction (a preset's, or one the user typed) and the thinking state. */
  onRun: (instruction: string, thinking: boolean) => void;
  /** Initial thinking state; the toggle flips it per invocation. */
  thinking?: boolean;
  /** Geometry, from settings. */
  place?: PlacementOptions;
  /**
   * The DOM range the selection occupied, captured while it was live.
   *
   * Clicking this bar's field collapses that selection, so the range is the
   * only thing left that can say what is being replaced — the bar mirrors it
   * for as long as it is open.
   */
  domRange?: Range;
  /** Document to attach to. Defaults to the global document. */
  doc?: Document;
}

/**
 * Show the action bar for a selection.
 *
 * @param options - Selection, presets, the run handler and geometry.
 * @returns A handle for the bar, or null when the selection has no measurable
 *   rect to anchor to.
 */
export function attachSelectionMenu(options: SelectionMenuOptions): SelectionMenuHandle | null {
  const { doc = document, domRange, onRun, place, presets, selection, thinking = false } = options;
  const { rect } = selection;

  // A selection with no box cannot be anchored to; fail to "no menu" rather
  // than pinning the bar to the corner of the window.
  if (rect.width === 0 && rect.height === 0) return null;

  const menu = doc.createElement("div");
  menu.className = SELECTION_MENU_CLASS;
  menu.setAttribute("role", "toolbar");
  menu.setAttribute("aria-label", "Inscribe");
  // Keep the selection alive: without this a click collapses it before the
  // action can read it.
  menu.addEventListener("mousedown", (event) => event.preventDefault());

  // Drawn ONLY once something takes focus away from the document — in practice
  // the field, which is the moment the browser's own highlight dies. Drawing it
  // at open time put a second overlay on top of the live native selection, which
  // is distracting and says nothing the highlight did not already say.
  let mirror: (() => void) | null = null;
  const showMirror = (): void => {
    if (!mirror && domRange) mirror = attachSelectionMirror(domRange, doc);
  };

  let live = true;
  let busy = false;
  const remove = (): void => {
    if (!live) return;
    live = false;
    detach();
    mirror?.();
    menu.remove();
  };
  const setBusy = (next: boolean): void => {
    busy = next;
    menu.classList.toggle(`${SELECTION_MENU_CLASS}-busy`, next);
    for (const control of Array.from(menu.querySelectorAll("button, input"))) {
      (control as HTMLButtonElement | HTMLInputElement).disabled = next;
    }
  };

  // One state for the bar: the toggle and every run read the same value.
  let wantsThinking = thinking;
  const run = (instruction: string): void => {
    // The bar stays up while the model works — it is the only thing on screen
    // saying a request is in flight — and the caller takes it down when there is
    // a result to show. Re-running is blocked by the busy state, not by absence.
    if (busy) return;
    setBusy(true);
    onRun(instruction, wantsThinking);
  };

  const divider = (): HTMLElement => {
    const span = doc.createElement("span");
    span.className = `${SELECTION_MENU_CLASS}-divider`;
    return span;
  };

  for (const preset of presets) {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = `${SELECTION_MENU_CLASS}-action`;
    button.dataset.action = preset.id;
    // The reference implementation's icon, with the full label on hover — six
    // words made the bar wide enough to cover the text it acts on.
    button.append(iconSvg(doc, preset.icon as SelectionIconName));
    button.title = preset.label;
    button.addEventListener("click", () => run(preset.instruction));
    menu.append(button);
  }

  menu.append(divider());

  const input = doc.createElement("input");
  input.type = "text";
  input.className = `${SELECTION_MENU_CLASS}-input`;
  input.placeholder = "Ask AI anything…";
  input.addEventListener("mousedown", (event) => {
    event.stopPropagation();
    // mousedown precedes focus, so the stand-in is up before the highlight
    // disappears rather than a frame after it.
    showMirror();
  });
  input.addEventListener("focus", showMirror);
  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter" && input.value.trim()) run(input.value.trim());
    if (event.key === "Escape") remove();
  });
  menu.append(input);

  menu.append(divider());

  const think = doc.createElement("button");
  think.type = "button";
  think.className = `${SELECTION_MENU_CLASS}-action ${SELECTION_MENU_CLASS}-think`;
  think.dataset.role = "thinking";
  think.append(iconSvg(doc, "brain"));
  const label = (): void => {
    think.classList.toggle(`${SELECTION_MENU_CLASS}-think-on`, wantsThinking);
    think.title =
      wantsThinking ?
        "Thinking ON: this request may reason before answering (slower, and a long passage can exhaust the budget)"
      : "Thinking OFF: answer directly (recommended for DeepSeek V4 Flash)";
  };
  label();
  think.addEventListener("click", () => {
    wantsThinking = !wantsThinking;
    label();
  });
  menu.append(think);

  placeNear(menu, rect, doc.defaultView, place);
  doc.body.appendChild(menu);
  // The field is deliberately NOT focused. In Typora's live preview the
  // document selection IS the DOM selection, so focusing anything else
  // collapses it, which fires `selectionchange` and reads as "the user moved
  // the caret" — the bar then retired itself a moment after appearing. The
  // reference implementation does not focus its field either; the user clicks
  // it, and by then the range has already been captured.

  const detach = attachDismissal({ doc, element: menu, onDismiss: remove });

  return { remove, setBusy };
}
