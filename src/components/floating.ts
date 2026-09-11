/**
 * Placement shared by the plugin's floating surfaces.
 *
 * The selection menu and the edit preview both anchor to a rect in a document
 * that scrolls under them, so both need the same two decisions: keep the
 * surface inside the viewport, and prefer the space above the anchor. Keeping
 * one implementation means a fix to the geometry cannot land on one surface and
 * miss the other.
 *
 * Anchoring is `position: fixed` against the rect. Absolute positioning inside
 * the editor's scroll container was tried for the inline ghost and failed (the
 * container is not the offset parent Typora's layout suggests), so nothing here
 * retries it.
 */

export interface AnchorRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Vertical gap between the anchor and the surface. */
const DEFAULT_GAP = 6;
/** Keep this far from the viewport edges. */
const DEFAULT_MARGIN = 8;
/** Used before layout exists, and in tests where nothing is laid out. */
const FALLBACK_WIDTH = 200;
const FALLBACK_HEIGHT = 32;

/**
 * Position `element` against `rect`, above it when there is room.
 *
 * @param element - The floating element to place.
 * @param rect - The anchor's rect, in viewport coordinates.
 * @param view - The window, for viewport bounds. Null is tolerated (tests).
 * @param gap - Vertical distance from the anchor. Defaults to 6.
 * @param margin - Minimum distance from the viewport edges. Defaults to 8.
 */
export function placeNear(
  element: HTMLElement,
  rect: AnchorRect,
  view: Window | null,
  gap = DEFAULT_GAP,
  margin = DEFAULT_MARGIN,
): void {
  const width = element.offsetWidth || FALLBACK_WIDTH;
  const height = element.offsetHeight || FALLBACK_HEIGHT;
  const viewportWidth = view?.innerWidth ?? 0;

  const maxLeft = Math.max(margin, viewportWidth - width - margin);
  const left = viewportWidth > 0 ? Math.min(Math.max(rect.left, margin), maxLeft) : rect.left;

  const above = rect.top - height - gap;
  const top = above < margin ? rect.top + rect.height + gap : above;

  element.style.position = "fixed";
  element.style.left = `${Math.round(left)}px`;
  element.style.top = `${Math.round(top)}px`;
}
