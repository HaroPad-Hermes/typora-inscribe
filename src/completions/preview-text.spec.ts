import { describe, expect, it } from "vitest";

import {
  PREVIEW_CLASS,
  isInsidePreview,
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
});
