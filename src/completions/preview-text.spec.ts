import { describe, expect, it } from "vitest";

import {
  PREVIEW_CLASS,
  isInsidePreview,
  isUnrenderedNode,
  textWalkerWithoutPreview,
  textWithoutPreview,
} from "./preview-text";

/**
 * Render the given writing area HTML.
 *
 * @param inner - Inner HTML for the writing area.
 * @returns The writing-area element.
 */
function write(inner: string): Element {
  document.body.innerHTML = `<div id="write">${inner}</div>`;
  return document.getElementById("write")!;
}

describe("textWithoutPreview", () => {
  it("reads plain block text unchanged", () => {
    expect(textWithoutPreview(write(`<p>Hello world</p>`).firstElementChild!)).toBe("Hello world");
  });

  it("drops the preview from the block it is attached to", () => {
    const block = write(
      `<p>Add tests for mid-word<span class="${PREVIEW_CLASS}">X</span></p>`,
    ).firstElementChild!;
    // The live failure: markdown has one X, the DOM had two, and no markdown
    // line could match the block — so the caret derivation refused.
    expect(textWithoutPreview(block)).toBe("Add tests for mid-word");
  });

  it("keeps text that follows the preview", () => {
    const block = write(
      `<p>Add <span class="${PREVIEW_CLASS}">ghosted</span> tests</p>`,
    ).firstElementChild!;
    expect(textWithoutPreview(block)).toBe("Add  tests");
  });

  it("ignores previews nested deeper than one level", () => {
    const block = write(
      `<p>A<span><em>B</em><span class="${PREVIEW_CLASS}">GHOST</span></span>C</p>`,
    ).firstElementChild!;
    expect(textWithoutPreview(block)).toBe("ABC");
  });
});

describe("isInsidePreview", () => {
  it("is false for ordinary document nodes", () => {
    const block = write(`<p>Hello</p>`).firstElementChild!;
    expect(isInsidePreview(block)).toBe(false);
    expect(isInsidePreview(null)).toBe(false);
  });

  it("is true for the preview element and its text nodes", () => {
    const block = write(`<p>x<span class="${PREVIEW_CLASS}">ghost</span></p>`).firstElementChild!;
    const ghost = block.querySelector(`.${PREVIEW_CLASS}`)!;
    expect(isInsidePreview(ghost)).toBe(true);
    expect(isInsidePreview(ghost.firstChild)).toBe(true);
  });
});

describe("textWalkerWithoutPreview", () => {
  it("yields text outside the preview but not inside it", () => {
    const block = write(
      `<p>kept<span class="${PREVIEW_CLASS}">ghost</span>also kept</p>`,
    ).firstElementChild!;
    const walker = textWalkerWithoutPreview(document, block);
    const seen: string[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) seen.push(n.textContent ?? "");
    expect(seen.join("")).toBe("keptalso kept");
  });

  it("must agree with textWithoutPreview, or offsets are computed against a different string", () => {
    const block = write(
      `<p>A<span class="${PREVIEW_CLASS}">ghost</span><span style="display: none">hidden</span>` +
        `<textarea>x</textarea>B</p>`,
    ).firstElementChild!;
    const walker = textWalkerWithoutPreview(document, block);
    let walked = "";
    for (let n = walker.nextNode(); n; n = walker.nextNode()) walked += n.textContent ?? "";
    // The caller accumulates the walker while the matcher compares this string;
    // if the two rules drift, every derived offset is wrong by the difference.
    expect(walked).toBe(textWithoutPreview(block));
  });
});

describe("unrendered subtrees (the phantom-token class)", () => {
  it("does not read a form control, whose content is a value and not text", () => {
    const block = write(`<pre>def add(a, b)<textarea>x</textarea></pre>`).firstElementChild!;
    // Live failure: a fence's textContent began "x def add(...)" — a token in no
    // markdown line and in no accessibility tree, which kept the block unmapped.
    expect(block.textContent).toContain("x");
    expect(textWithoutPreview(block)).toBe("def add(a, b)");
  });

  it("does not read an inline-hidden subtree", () => {
    const block = write(
      `<p>Kept<span style="display: none">gone</span><span style="visibility: hidden">also gone</span></p>`,
    ).firstElementChild!;
    expect(block.textContent).toContain("gone");
    expect(textWithoutPreview(block)).toBe("Kept");
  });

  it("does not read a subtree hidden by the hidden attribute", () => {
    const block = write(`<p>Kept<span hidden>x</span></p>`).firstElementChild!;
    expect(textWithoutPreview(block)).toBe("Kept");
  });

  it("never skips the root: the caret's block is rendered by definition", () => {
    const block = write(`<p hidden>Still read</p>`).firstElementChild!;
    expect(textWithoutPreview(block)).toBe("Still read");
  });
});

describe("isUnrenderedNode", () => {
  it("is false for ordinary elements and text nodes", () => {
    const block = write(`<p>Hello</p>`).firstElementChild!;
    expect(isUnrenderedNode(block)).toBe(false);
    expect(isUnrenderedNode(block.firstChild)).toBe(false);
    expect(isUnrenderedNode(null)).toBe(false);
  });

  it("skips a text node whose hidden ancestor is more than one level up", () => {
    const block = write(
      `<p>Kept<span style="display: none"><em>deep <b>gone</b></em></span></p>`,
    ).firstElementChild!;
    const walker = textWalkerWithoutPreview(document, block);
    const seen: string[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) seen.push(n.textContent ?? "");
    expect(seen.join("")).toBe("Kept");
  });

  it("treats a node whose computed style throws as rendered", () => {
    // A detached node has no computed style. Dropping its text would silently
    // shorten the string the matcher compares, so the failure mode is "keep".
    const view = document.defaultView!;
    const original = view.getComputedStyle.bind(view);
    const block = write(`<p>Kept<span class="throwing">x</span></p>`).firstElementChild!;
    const widget = block.querySelector(".throwing")!;
    view.getComputedStyle = (element: Element) => {
      if (element === widget) throw new Error("detached node");
      return original(element);
    };
    try {
      expect(textWithoutPreview(block)).toBe("Keptx");
    } finally {
      view.getComputedStyle = original;
    }
  });

  it("is true where a stylesheet rule hides the element, not just an inline style", () => {
    const view = document.defaultView!;
    const original = view.getComputedStyle.bind(view);
    const block = write(`<p>Kept<span class="CodeMirror-measure">x</span></p>`).firstElementChild!;
    const widget = block.querySelector(".CodeMirror-measure")!;
    view.getComputedStyle = ((element: Element) =>
      element === widget ?
        ({ display: "block", visibility: "hidden" } as CSSStyleDeclaration)
      : original(element)) as typeof view.getComputedStyle;
    try {
      expect(textWithoutPreview(block)).toBe("Kept");
    } finally {
      view.getComputedStyle = original;
    }
  });
});
