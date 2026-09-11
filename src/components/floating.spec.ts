import { afterEach, describe, expect, it } from "vitest";

import { placeNear } from "./floating";

/**
 * A surface with no layout, so the fallbacks (200x32) apply.
 *
 * @returns The element, already in the document.
 */
function surface(): HTMLElement {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return element;
}

const anchor = (left: number, top: number) => ({ left, top, width: 40, height: 20 });

afterEach(() => {
  document.body.innerHTML = "";
});

describe("placeNear", () => {
  it("sits below the anchor, with the default 10px gap", () => {
    const element = surface();
    placeNear(element, anchor(100, 200), document.defaultView);
    expect(element.style.top).toBe("230px");
    expect(element.style.left).toBe("100px");
    expect(element.style.position).toBe("fixed");
  });

  it("flips above when below would leave the viewport", () => {
    const view = document.defaultView!;
    const element = surface();
    const top = view.innerHeight - 40;
    placeNear(element, anchor(100, top), view);
    // Above = anchor top - surface height - gap.
    expect(element.style.top).toBe(`${top - 32 - 10}px`);
  });

  it("pulls in by HALF the overflow past the field edge, not the whole way", () => {
    const element = surface();
    // Overhang = 100 + 200 - (250 - 8) = 58, so the bar shifts left by 29.
    placeNear(element, anchor(100, 200), document.defaultView, { boundaryRight: 250 });
    expect(element.style.left).toBe("71px");
  });

  it("leaves the left edge alone when there is no overhang", () => {
    const element = surface();
    placeNear(element, anchor(100, 200), document.defaultView, { boundaryRight: 900 });
    expect(element.style.left).toBe("100px");
  });
});
