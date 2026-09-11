/**
 * The dismissal rules every floating surface obeys.
 *
 * A surface that outlives its reason for existing acts on text the user has
 * moved away from, so all four dismissals are required rather than optional:
 * Escape, a save (nothing may sit over the document across Ctrl+S), a scroll (a
 * surface that drifts off its anchor is worse than one that closes), and a
 * click outside. Sharing one implementation is what keeps the second surface
 * from quietly having three of the four.
 */

export interface DismissalOptions {
  /** The floating element. A mousedown INSIDE it does not dismiss. */
  element: Element;
  /** What to run when the surface must go. Called at most once. */
  onDismiss: () => void;
  /** Document to listen on. Defaults to the global document. */
  doc?: Document;
}

/**
 * Attach the dismissal rules to a floating surface.
 *
 * @param options - The element, what to run on dismissal, and a document.
 * @returns A function that detaches every listener.
 */
export function attachDismissal(options: DismissalOptions): () => void {
  const { doc = document, element, onDismiss } = options;
  let live = true;

  const onKeyDown = (event: Event): void => {
    if (!(event instanceof KeyboardEvent)) return;
    const isEscape = event.key === "Escape";
    const isSave = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s";
    if (isEscape || isSave) dismiss();
  };
  const onMouseDown = (event: Event): void => {
    const target = event.target;
    if (target instanceof Node && element.contains(target)) return;
    dismiss();
  };

  const detach = (): void => {
    doc.removeEventListener("keydown", onKeyDown, true);
    doc.removeEventListener("mousedown", onMouseDown, true);
    doc.defaultView?.removeEventListener("scroll", dismiss, true);
    doc.defaultView?.removeEventListener("blur", dismiss);
  };

  const dismiss = (): void => {
    if (!live) return;
    live = false;
    detach();
    onDismiss();
  };

  doc.addEventListener("keydown", onKeyDown, true);
  doc.addEventListener("mousedown", onMouseDown, true);
  doc.defaultView?.addEventListener("scroll", dismiss, true);
  doc.defaultView?.addEventListener("blur", dismiss);

  return detach;
}
