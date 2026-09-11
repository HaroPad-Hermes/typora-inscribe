/**
 * A visual stand-in for a selection the DOM no longer holds.
 *
 * In Typora clicking the bar's own field collapses the document selection, so
 * the highlight disappears the moment the bar is used — and then nothing on
 * screen says WHAT would be replaced. The reference implementation hits the same
 * wall and solves it by re-drawing the selection itself while its menu is open,
 * which is the right shape of answer here too.
 *
 * Drawing it as an overlay rather than by adding decoration inside the document:
 * the document's nodes are never touched, so there is nothing to save, nothing
 * to tear down from the content, and no chance of the plugin's own UI ending up
 * in the file. `pointer-events: none` keeps the overlay from being selectable
 * or clickable at all.
 *
 * One element per client rect, so a selection spanning several lines is drawn as
 * several lines rather than one box swallowing the paragraphs between them.
 */

export const SELECTION_MIRROR_CLASS = "inscribe-selection-mirror";

/**
 * Draw an overlay over the client rects a range reports.
 *
 * @param range - The range to mirror, captured while the selection was live.
 * @param doc - Document to draw into. Defaults to the global document.
 * @returns A function that removes every overlay it drew.
 */
export function attachSelectionMirror(range: Range, doc: Document = document): () => void {
  const rects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0 && rect.height > 0,
  );

  const layers = rects.map((rect) => {
    const layer = doc.createElement("div");
    layer.className = SELECTION_MIRROR_CLASS;
    layer.style.position = "fixed";
    layer.style.left = `${rect.left}px`;
    layer.style.top = `${rect.top}px`;
    layer.style.width = `${rect.width}px`;
    layer.style.height = `${rect.height}px`;
    doc.body.appendChild(layer);
    return layer;
  });

  return () => {
    for (const layer of layers) layer.remove();
    layers.length = 0;
  };
}
