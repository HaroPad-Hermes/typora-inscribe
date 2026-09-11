/**
 * The accept/reject panel for a proposed edit.
 *
 * The model's answer is shown against the passage it would replace, and nothing
 * reaches the document until Accept. That is the whole point of the surface: an
 * edit is not applied because a model returned text, it is applied because the
 * person looking at it said so.
 *
 * Placement and dismissal are the selection menu's (`floating.ts`,
 * `floating-dismiss.ts`), and the panel is registered in
 * `INSCRIBE_UI_SELECTOR` so selecting its own label never reads back as a
 * document selection. Buttons default their `mousedown` away so clicking one
 * cannot collapse the selection the edit was measured against.
 */

import "./selection-preview.scss";

import type { AnchorRect } from "./floating";
import { placeNear } from "./floating";
import { attachDismissal } from "./floating-dismiss";

export const EDIT_PREVIEW_CLASS = "inscribe-selection-preview";

export interface EditPreviewOptions {
  /** The selection's rect, for anchoring. */
  rect: AnchorRect;
  /** What the panel is doing, shown as its heading. */
  title: string;
  /** The passage that would be replaced. */
  passage: string;
  /** The text that would replace it. */
  replacement: string;
  /** Called when the edit is accepted, after the panel is gone. */
  onAccept: () => void;
  /** Document to attach to. Defaults to the global document. */
  doc?: Document;
  /** Right edge of the text field, so the panel can pull in rather than overhang it. */
  boundaryRight?: number;
}

/**
 * Show a proposed edit for a passage.
 *
 * @param options - Rect, heading, the two texts and the accept handler.
 * @returns A function that removes the panel, or null when the anchor has no
 *   measurable rect (the caller decides whether that is worth logging).
 */
export function attachEditPreview(options: EditPreviewOptions): (() => void) | null {
  const { boundaryRight, doc = document, onAccept, passage, rect, replacement, title } = options;

  // Anchorless means unanchored: pinning this to the window corner would assert
  // a selection that cannot be seen.
  if (rect.width === 0 && rect.height === 0) return null;

  const panel = doc.createElement("div");
  panel.className = EDIT_PREVIEW_CLASS;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", `Inscribe: ${title}`);

  const build = (className: string, text: string): HTMLElement => {
    const div = doc.createElement("div");
    div.className = `${EDIT_PREVIEW_CLASS}-${className}`;
    div.textContent = text;
    return div;
  };

  const heading = build("title", title);
  const before = build("before", passage);
  const after = build("after", replacement);

  const actions = doc.createElement("div");
  actions.className = `${EDIT_PREVIEW_CLASS}-actions`;

  let live = true;
  const remove = (): void => {
    if (!live) return;
    live = false;
    detach();
    panel.remove();
  };

  const accept = doc.createElement("button");
  accept.type = "button";
  accept.className = `${EDIT_PREVIEW_CLASS}-accept`;
  accept.dataset.role = "accept";
  accept.textContent = "Accept";

  const cancel = doc.createElement("button");
  cancel.type = "button";
  cancel.className = `${EDIT_PREVIEW_CLASS}-cancel`;
  cancel.dataset.role = "cancel";
  cancel.textContent = "Cancel";

  for (const button of [accept, cancel]) {
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
  }
  accept.addEventListener("click", () => {
    remove();
    onAccept();
  });
  cancel.addEventListener("click", remove);
  actions.append(accept, cancel);

  panel.append(heading, before, after, actions);
  placeNear(panel, rect, doc.defaultView, { boundaryRight });
  doc.body.appendChild(panel);

  const detach = attachDismissal({ doc, element: panel, onDismiss: remove });

  return remove;
}
