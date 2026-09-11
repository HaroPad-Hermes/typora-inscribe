import { describe, expect, it } from "vitest";

import { describeRangeRefusal, orderEndpoints, selectionRange } from "./range";

/**
 * Render a document and select `start..end` characters inside `selector`.
 *
 * The range must be anchored in a TEXT node: an element-boundary range does not
 * survive happy-dom's selection round-trip and the module then sees "collapsed".
 *
 * @param html - Inner HTML for the editor's writing area.
 * @param selector - Selector for the element holding the selection.
 * @param start - Selection start, in characters.
 * @param end - Selection end, in characters.
 * @returns The writing area and the live selection.
 */
function select(
  html: string,
  selector: string,
  start: number,
  end: number,
): { write: Element; selection: Selection } {
  const doc = window.document;
  doc.body.innerHTML = `<div id="write">${html}</div>`;
  const write = doc.getElementById("write")!;
  const node = write.querySelector(selector)!.firstChild!;
  const range = doc.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const selection = doc.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return { write, selection };
}

describe("selectionRange", () => {
  it("maps a selection inside one paragraph to markdown endpoints", () => {
    const markdown = "the cat sat on the mat\n";
    const { selection, write } = select(`<p>the cat sat on the mat</p>`, "p", 4, 7);
    const result = selectionRange({ writingArea: write, selection, markdown });
    expect(result).toEqual({
      ok: true,
      range: { start: { line: 0, character: 4 }, end: { line: 0, character: 7 } },
      start: { line: 0, character: 4 },
      end: { line: 0, character: 7 },
    });
  });

  it("maps the endpoints of a selection spanning two blocks", () => {
    const markdown = "one\ntwo\n";
    const { selection, write } = select(`<p>one</p><p>two</p>`, "p:last-of-type", 0, 3);
    // Anchored in the second block: the walk must still reach it, and must not
    // match the first block's text instead.
    const result = selectionRange({ writingArea: write, selection, markdown });
    expect(result.ok && result.range).toEqual({
      start: { line: 1, character: 0 },
      end: { line: 1, character: 3 },
    });
  });

  it("refuses when the selection changed since the caller looked", () => {
    const { selection, write } = select(`<p>the cat sat</p>`, "p", 4, 7);
    const result = selectionRange({
      writingArea: write,
      selection,
      markdown: "the cat sat\n",
      expectedText: "something else entirely",
    });
    expect(result).toEqual({ ok: false, reason: "selection-changed" });
  });

  it("accepts when the snapshot matches", () => {
    const { selection, write } = select(`<p>the cat sat</p>`, "p", 4, 7);
    const result = selectionRange({
      writingArea: write,
      selection,
      markdown: "the cat sat\n",
      expectedText: "cat",
    });
    expect(result.ok).toBe(true);
  });

  it("refuses a collapsed selection and a missing one, by name", () => {
    const { selection, write } = select(`<p>the cat sat</p>`, "p", 4, 4);
    expect(selectionRange({ writingArea: write, selection, markdown: "the cat sat\n" })).toEqual({
      ok: false,
      reason: "collapsed",
    });
    expect(selectionRange({ writingArea: write, selection: null, markdown: "" })).toEqual({
      ok: false,
      reason: "no-selection",
    });
  });

  it("refuses an endpoint inside CodeMirror rather than guessing a range", () => {
    // A code fence and source mode both hold their caret in CodeMirror, so a
    // selection there is honestly unmappable — the fence path needs the
    // CodeMirror anchor, not an approximate range.
    const { selection, write } = select(
      `<div class="CodeMirror"><p>def add(a, b)</p></div>`,
      "p",
      4,
      7,
    );
    expect(selectionRange({ writingArea: write, selection, markdown: "x\n" })).toEqual({
      ok: false,
      reason: "start-unmappable",
    });
  });
});

describe("orderEndpoints", () => {
  it("puts a backwards selection in document order", () => {
    // Dragging right-to-left reports anchor AFTER focus; every consumer needs the
    // span, and `replaceTextByRange` would silently drop the text on a swapped
    // range. happy-dom cannot build a backwards selection, so this is where it is
    // pinned.
    const later = { line: 3, character: 1 };
    const earlier = { line: 1, character: 9 };
    expect(orderEndpoints(later, earlier)).toEqual([earlier, later]);
  });

  it("orders within one line and keeps an equal pair stable", () => {
    expect(orderEndpoints({ line: 2, character: 8 }, { line: 2, character: 3 })).toEqual([
      { line: 2, character: 3 },
      { line: 2, character: 8 },
    ]);
    const same = { line: 0, character: 0 };
    expect(orderEndpoints(same, { ...same })).toEqual([same, same]);
  });
});

describe("describeRangeRefusal", () => {
  it("names every refusal distinctly", () => {
    const reasons = [
      "no-selection",
      "collapsed",
      "selection-changed",
      "start-unmappable",
      "end-unmappable",
      "empty-range",
    ] as const;
    const messages = reasons.map(describeRangeRefusal);
    expect(new Set(messages).size).toBe(reasons.length);
    expect(messages.every((m) => m.length > 0)).toBe(true);
  });
});
