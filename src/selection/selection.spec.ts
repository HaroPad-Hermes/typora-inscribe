import { describe, expect, it } from "vitest";

import {
  MAX_SELECTION_CHARS,
  describeRefusal,
  readSelection,
  selectionSignature,
} from "./selection";
import type { SelectionRect, SelectionRefusal } from "./selection";

/**
 * Render `html` into the document body and select a slice of the text inside
 * `selector`.
 *
 * @param html - Body HTML. Pass a `#write` container unless testing its absence.
 * @param selector - Selector for the element whose text is selected.
 * @param start - Offset in characters into that element's text.
 * @param end - End offset; defaults to the end of the element's text.
 * @returns The writing-area element (when present) and the live selection.
 */
function selectIn(
  html: string,
  selector: string,
  start = 0,
  end?: number,
): { write: Element | null; selection: Selection } {
  const doc = window.document;
  doc.body.innerHTML = html;
  const write = doc.getElementById("write");
  const target = doc.querySelector(selector)!;
  const textNode = target.firstChild!;
  const full = textNode.textContent ?? "";

  const range = doc.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, end ?? full.length);

  const selection = doc.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return { write, selection };
}

const RECT: SelectionRect = { left: 120, top: 240, width: 60, height: 18 };

describe("readSelection", () => {
  it("refuses when the window exposes no selection", () => {
    const result = readSelection({ writingArea: null, selection: null });
    expect(result).toEqual({ ok: false, reason: "no-selection-api" });
  });

  it("refuses a collapsed caret — a caret is not a selection", () => {
    const { selection, write } = selectIn(`<div id="write"><p>Hello world</p></div>`, "p", 3, 3);
    const result = readSelection({ writingArea: write, selection });
    expect(result).toEqual({ ok: false, reason: "collapsed" });
  });

  it("reads the selected text, its rect and its owning block", () => {
    const { selection, write } = selectIn(
      `<div id="write"><p>Hello <em>brave world</em></p></div>`,
      "em",
    );
    const result = readSelection({ writingArea: write, selection, getRect: () => RECT });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.selection.text).toBe("brave world");
    expect(result.selection.rect).toEqual(RECT);
    // The <em> is nested; the owning top-level block is the <p>.
    expect(result.selection.block?.tagName).toBe("P");
  });

  it("still reads a selection with no measurable rect, so the caller can fall back", () => {
    const { selection, write } = selectIn(`<div id="write"><p>Hello world</p></div>`, "p");
    const result = readSelection({ writingArea: write, selection, getRect: () => null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.selection.rect).toEqual({ left: 0, top: 0, width: 0, height: 0 });
  });

  it("refuses a selection outside the writing area", () => {
    const { selection, write } = selectIn(
      `<div id="write"><p>Document</p></div><div id="sidebar"><p>Chrome</p></div>`,
      "#sidebar p",
    );
    const result = readSelection({ writingArea: write, selection });
    expect(result).toEqual({ ok: false, reason: "outside-writing-area" });
  });

  it("refuses when there is no writing area at all", () => {
    const { selection } = selectIn(`<div id="not-the-editor"><p>Hello</p></div>`, "p");
    const result = readSelection({ writingArea: null, selection });
    expect(result).toEqual({ ok: false, reason: "outside-writing-area" });
  });

  it("refuses a selection inside Inscribe's own UI even when nested in the editor", () => {
    const { selection, write } = selectIn(
      `<div id="write"><p>Document</p><div id="copilot-chat-panel"><p>Answer text</p></div></div>`,
      "#copilot-chat-panel p",
    );
    const result = readSelection({ writingArea: write, selection });
    expect(result).toEqual({ ok: false, reason: "inside-inscribe-ui" });
  });

  it("refuses a whitespace-only selection", () => {
    const { selection, write } = selectIn(`<div id="write"><p>   </p></div>`, "p");
    const result = readSelection({ writingArea: write, selection });
    expect(result).toEqual({ ok: false, reason: "empty-text" });
  });

  it("refuses a selection longer than the cap", () => {
    const long = "a".repeat(MAX_SELECTION_CHARS + 1);
    const { selection, write } = selectIn(`<div id="write"><p>${long}</p></div>`, "p");
    const result = readSelection({ writingArea: write, selection });
    expect(result).toEqual({ ok: false, reason: "too-long" });
  });

  it("accepts a selection exactly at the cap", () => {
    const atCap = "a".repeat(MAX_SELECTION_CHARS);
    const { selection, write } = selectIn(`<div id="write"><p>${atCap}</p></div>`, "p");
    const result = readSelection({ writingArea: write, selection, getRect: () => RECT });
    expect(result.ok).toBe(true);
  });

  it("measures the range itself when no rect source is injected, falling back to zero", () => {
    const { selection, write } = selectIn(`<div id="write"><p>Hello world</p></div>`, "p");
    const result = readSelection({ selection, writingArea: write });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // happy-dom lays nothing out, so this exercises the default measurement
    // returning null and the zero-rect fallback that keeps the read usable.
    expect(result.selection.rect).toEqual({ left: 0, top: 0, width: 0, height: 0 });
  });
});

describe("selectionSignature", () => {
  const base = { text: "brave world", rect: RECT, block: null };

  it("is stable for the same selection", () => {
    expect(selectionSignature(base)).toBe(selectionSignature({ ...base }));
  });

  it("changes when the selection moves, so the menu follows it", () => {
    const moved = { ...base, rect: { ...RECT, left: 400 } };
    expect(selectionSignature(base)).not.toBe(selectionSignature(moved));
  });

  it("changes when the selected text changes", () => {
    expect(selectionSignature(base)).not.toBe(selectionSignature({ ...base, text: "other text" }));
  });
});

describe("describeRefusal", () => {
  const reasons: SelectionRefusal[] = [
    "no-selection-api",
    "collapsed",
    "outside-writing-area",
    "inside-inscribe-ui",
    "empty-text",
    "too-long",
  ];

  it("explains every refusal distinctly", () => {
    const messages = reasons.map(describeRefusal);
    expect(messages.every((m) => m.length > 0)).toBe(true);
    expect(new Set(messages).size).toBe(reasons.length);
  });
});
