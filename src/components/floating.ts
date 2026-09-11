/**
 * Placement shared by the plugin's floating surfaces.
 *
 * The geometry is the reference implementation's (`obsidian-inscribe`'s
 * selection bar): a horizontal anchor chosen by mode, a side that flips only
 * when the preferred one has no room, and — when pull-in is on — a soft shift
 * left by HALF the overhang past the text field's edge instead of a hard clamp.
 * A bar that jumps its whole width at the boundary reads as a glitch; half the
 * overflow keeps it visually attached to the text it acts on.
 *
 * The selection menu and the edit preview share this, so a geometry fix cannot
 * land on one surface and miss the other.
 */

export interface AnchorRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where the surface's left edge sits relative to the selection. */
export type MenuPlacement = "smart" | "centered" | "first";
/** Which side of the selection it prefers. */
export type MenuSide = "below" | "above";

export interface PlacementOptions {
  /** Vertical distance from the anchor. */
  gap?: number;
  /** Minimum distance from the edges. */
  margin?: number;
  /** Horizontal anchor mode. Defaults to "smart". */
  placement?: MenuPlacement;
  /** Left edge of the text field, for the "smart" mode on multi-line selections. */
  contentLeft?: number;
  /** Whether the selection covers more than one visual line. */
  multiLine?: boolean;
  /** Preferred side. Defaults to "below". */
  side?: MenuSide;
  /** Shift left by half the overhang past `boundaryRight`. Defaults to true. */
  pullIn?: boolean;
  /** Right edge of the text field. */
  boundaryRight?: number;
}

/** Used before layout exists, and in tests where nothing is laid out. */
const FALLBACK_WIDTH = 260;
const FALLBACK_HEIGHT = 34;

/**
 * Resolve the surface's preferred left edge.
 *
 * @param placement - The chosen mode.
 * @param rect - The anchor's rect.
 * @param contentLeft - The text field's left edge.
 * @param multiLine - Whether the selection spans more than one line.
 * @param menuWidth - The surface's width.
 * @param margin - The minimum edge margin.
 * @returns The left edge before clamping.
 */
export function resolveMenuLeft(
  placement: MenuPlacement,
  rect: AnchorRect,
  contentLeft: number,
  multiLine: boolean,
  menuWidth: number,
  margin: number,
): number {
  if (placement === "centered") return rect.left + rect.width / 2 - menuWidth / 2;
  if (placement === "first") return rect.left;
  // smart: hug the first character on one line, the field's edge on many — a
  // multi-line selection's leftmost character is not where the eye expects a bar.
  return multiLine ? contentLeft : rect.left;
}

/**
 * Position a floating element against an anchor rect, in viewport coordinates.
 *
 * @param element - The floating element to place.
 * @param rect - The anchor's rect.
 * @param view - The window, for viewport bounds. Null is tolerated (tests).
 * @param options - Geometry options; defaults mirror the reference settings.
 */
export function placeNear(
  element: HTMLElement,
  rect: AnchorRect,
  view: Window | null,
  options: PlacementOptions = {},
): void {
  const {
    boundaryRight,
    contentLeft = rect.left,
    gap = 10,
    margin = 8,
    multiLine = false,
    placement = "smart",
    pullIn = true,
    side = "below",
  } = options;

  const width = element.offsetWidth || FALLBACK_WIDTH;
  const height = element.offsetHeight || FALLBACK_HEIGHT;
  const viewportWidth = view?.innerWidth ?? 0;
  const viewportHeight = view?.innerHeight ?? 0;

  let left = resolveMenuLeft(placement, rect, contentLeft, multiLine, width, margin);
  if (pullIn) {
    const limit = (boundaryRight ?? viewportWidth) - margin;
    const overflow = left + width - limit;
    if (overflow > 0) left -= overflow / 2;
  }
  left = Math.max(margin, left);
  if (viewportWidth > 0) left = Math.min(left, Math.max(margin, viewportWidth - width - margin));

  const below = rect.top + rect.height + gap;
  const above = rect.top - height - gap;
  const fitsBelow = viewportHeight === 0 || below + height + margin <= viewportHeight;
  const fitsAbove = above >= margin;
  const top =
    side === "above" ?
      fitsAbove || !fitsBelow ?
        above
      : below
    : fitsBelow || !fitsAbove ? below
    : above;

  element.style.position = "fixed";
  element.style.left = `${Math.round(left)}px`;
  element.style.top = `${Math.round(Math.max(margin, top))}px`;
}
