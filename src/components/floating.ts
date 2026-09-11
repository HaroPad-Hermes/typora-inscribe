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
const DEFAULT_GAP = 10;
/** Keep this far from the viewport edges. */
const DEFAULT_MARGIN = 8;
/** Used before layout exists, and in tests where nothing is laid out. */
const FALLBACK_WIDTH = 200;
const FALLBACK_HEIGHT = 32;

export interface PlacementOptions {
  /** Vertical distance from the anchor. Defaults to 10. */
  gap?: number;
  /** Minimum distance from the viewport edges. Defaults to 8. */
  margin?: number;
  /** Sit under the anchor, flipping above only when below does not fit. Defaults to true. */
  preferBelow?: boolean;
  /**
   * Right edge of the text field the anchor lives in.
   *
   * The surface shifts left by HALF the distance it would overhang this edge,
   * rather than being clamped hard against it: a menu that jumps a whole width
   * at the boundary reads as a glitch, and half the overflow keeps it visually
   * attached to the text it acts on.
   */
  boundaryRight?: number;
}
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
  options: PlacementOptions = {},
): void {
  const { boundaryRight, gap = DEFAULT_GAP, margin = DEFAULT_MARGIN, preferBelow = true } = options;
  const width = element.offsetWidth || FALLBACK_WIDTH;
  const height = element.offsetHeight || FALLBACK_HEIGHT;
  const viewportWidth = view?.innerWidth ?? 0;
  const viewportHeight = view?.innerHeight ?? 0;

  // Horizontal: pull in by half the overflow past the field edge, then keep the
  // result inside the viewport. Never a hard jump to the margin.
  const limit =
    viewportWidth > 0 ?
      Math.min(boundaryRight ?? viewportWidth, viewportWidth) - margin
    : Number.POSITIVE_INFINITY;
  const overflow = rect.left + width - limit;
  const pulled = overflow > 0 ? rect.left - overflow / 2 : rect.left;
  const maxLeft = viewportWidth > 0 ? Math.max(margin, viewportWidth - width - margin) : pulled;
  const left = viewportWidth > 0 ? Math.min(Math.max(pulled, margin), maxLeft) : pulled;

  // Vertical: below by default, above when below does not fit, and whichever side
  // has room when neither does perfectly.
  const below = rect.top + rect.height + gap;
  const above = rect.top - height - gap;
  const fitsBelow = viewportHeight === 0 || below + height + margin <= viewportHeight;
  const fitsAbove = above >= margin;
  const top =
    preferBelow ?
      fitsBelow || !fitsAbove ?
        below
      : above
    : fitsAbove || !fitsBelow ? above
    : below;

  element.style.position = "fixed";
  element.style.left = `${Math.round(left)}px`;
  element.style.top = `${Math.round(top)}px`;
}
