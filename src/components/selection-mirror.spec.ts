import { afterEach, describe, expect, it } from "vitest";

import { SELECTION_MIRROR_CLASS, attachSelectionMirror } from "./selection-mirror";

/**
 * A fake range reporting the given rects.
 *
 * happy-dom lays nothing out, so the geometry has to be supplied.
 *
 * @param rects - The rects the range should report.
 * @returns A range-shaped stub.
 */
const fakeRange = (rects: Partial<DOMRect>[]): Range =>
  ({ getClientRects: () => rects }) as unknown as Range;

const layers = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>(`.${SELECTION_MIRROR_CLASS}`));

afterEach(() => {
  document.body.innerHTML = "";
});

describe("attachSelectionMirror", () => {
  it("draws one overlay per line of the selection", () => {
    // A single box would swallow the paragraphs a multi-line selection spans.
    const remove = attachSelectionMirror(
      fakeRange([
        { left: 10, top: 20, width: 100, height: 18 },
        { left: 10, top: 38, width: 60, height: 18 },
      ]),
    );
    expect(layers()).toHaveLength(2);
    expect(layers()[0]!.style.left).toBe("10px");
    expect(layers()[1]!.style.top).toBe("38px");
    remove();
  });

  it("ignores rects with no area", () => {
    attachSelectionMirror(
      fakeRange([
        { left: 0, top: 0, width: 0, height: 0 },
        { left: 5, top: 5, width: 20, height: 10 },
      ]),
    );
    expect(layers()).toHaveLength(1);
  });

  it("removes every overlay on teardown", () => {
    const remove = attachSelectionMirror(fakeRange([{ left: 1, top: 1, width: 4, height: 4 }]));
    expect(layers()).toHaveLength(1);
    remove();
    expect(layers()).toHaveLength(0);
  });

  it("draws nothing when the range reports nothing", () => {
    const remove = attachSelectionMirror(fakeRange([]));
    expect(layers()).toHaveLength(0);
    remove();
  });
});
