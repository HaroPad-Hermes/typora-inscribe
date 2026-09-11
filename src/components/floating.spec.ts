import { afterEach, describe, expect, it } from "vitest";

import { placeNear } from "./floating";

/**
 * A surface with no layout, so the fallbacks (260x34) apply.
 *
 * @returns The element, already in the document.
 */
function surface(): HTMLElement {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return element;
}

const anchor = (left: number, top: number, width = 40) => ({ left, top, width, height: 20 });

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
    expect(element.style.top).toBe(`${top - 34 - 10}px`);
  });

  it("pulls in by HALF the overflow past the field edge, not the whole way", () => {
    const element = surface();
    // Overhang = 100 + 260 - (250 - 8) = 118, so the bar shifts left by 59.
    placeNear(element, anchor(100, 200), document.defaultView, { boundaryRight: 250 });
    expect(element.style.left).toBe("41px");
  });

  it("leaves the left edge alone when there is no overhang", () => {
    const element = surface();
    placeNear(element, anchor(100, 200), document.defaultView, { boundaryRight: 900 });
    expect(element.style.left).toBe("100px");
  });

  it("centres on the selection when asked", () => {
    const element = surface();
    placeNear(element, anchor(100, 200, 400), document.defaultView, { placement: "centered" });
    // 100 + 200 - 130
    expect(element.style.left).toBe("170px");
  });

  it("anchors a multi-line selection to the text field edge in smart mode", () => {
    const element = surface();
    placeNear(element, anchor(300, 200, 400), document.defaultView, {
      contentLeft: 120,
      multiLine: true,
      placement: "smart",
    });
    expect(element.style.left).toBe("120px");
  });

  it("honours the preferred side", () => {
    const element = surface();
    placeNear(element, anchor(100, 400), document.defaultView, { side: "above" });
    expect(element.style.top).toBe("356px"); // 400 - 34 - 10
  });
});
