import { describe, expect, it } from "vitest";

import { isUiInputTarget } from "./ui-input";

/**
 * Build a document and return the element matching `selector`.
 *
 * @param html - Body HTML.
 * @param selector - Selector for the element under test.
 * @returns The matched element.
 */
function element(html: string, selector: string): Element {
  document.body.innerHTML = html;
  return document.querySelector(selector)!;
}

describe("isUiInputTarget", () => {
  it("ignores a null active element", () => {
    expect(isUiInputTarget(null)).toBe(false);
  });

  it("treats a plain element as the document, not a UI field", () => {
    expect(isUiInputTarget(element(`<div id="write"><p>x</p></div>`, "#write"))).toBe(false);
  });

  it("treats a chat textarea as a UI field", () => {
    const field = element(`<div id="copilot-chat-panel"><textarea id="c"></textarea></div>`, "#c");
    expect(isUiInputTarget(field)).toBe(true);
  });

  it("treats the file-search input as a UI field", () => {
    expect(isUiInputTarget(element(`<input id="s">`, "#s"))).toBe(true);
  });

  it("treats a select as a UI field", () => {
    expect(isUiInputTarget(element(`<select id="m"></select>`, "#m"))).toBe(true);
  });

  it("treats a CodeMirror textarea as the editor, so fences are not dead", () => {
    const field = element(
      `<div class="CodeMirror"><div class="CodeMirror-scroll"><textarea id="cm"></textarea></div></div>`,
      "#cm",
    );
    expect(isUiInputTarget(field)).toBe(false);
  });

  it("keeps the UI guard for a textarea that is not CodeMirror, even beside one", () => {
    const field = element(
      `<div class="CodeMirror"><textarea id="cm"></textarea></div><textarea id="ui"></textarea>`,
      "#ui",
    );
    expect(isUiInputTarget(field)).toBe(true);
  });
});
