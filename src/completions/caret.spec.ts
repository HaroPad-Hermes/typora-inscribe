import { describe, expect, it } from "vitest";

import {
  deriveCaretFromDomSelection,
  noCaretReason,
  trackedRefusal,
  validTrackedCaret,
} from "./caret";

/**
 * Collect derivation trace lines so a failure is diagnosable from the test output.
 *
 * @returns A log sink and the array it appends to.
 */
function makeLog(): { log: (m: string) => void; lines: string[] } {
  const lines: string[] = [];
  return { log: (m: string) => lines.push(m), lines };
}

/**
 * Render `html` into a `#write` container and place a collapsed caret inside
 * `selector` at `offset` (characters into that element's rendered text).
 *
 * @param html - Inner HTML for the editor's writing area.
 * @param selector - Selector for the element to place the caret in.
 * @param offset - Caret offset in characters within the target's text.
 * @returns The writing-area element and the live selection.
 */
function placeCaret(
  html: string,
  selector: string,
  offset: number,
): { write: Element; selection: Selection } {
  const doc = window.document;
  doc.body.innerHTML = `<div id="write">${html}</div>`;
  const write = doc.getElementById("write")!;
  const target = write.querySelector(selector)!;
  const textNode = target.firstChild!;
  const range = doc.createRange();
  range.setStart(textNode, offset);
  range.collapse(true);
  const selection = doc.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return { write, selection };
}

/**
 * Place the caret at a node boundary inside `selector` (element anchor).
 *
 * @param html - Inner HTML for the editor's writing area.
 * @param selector - Selector for the element to place the caret in.
 * @returns The writing-area element and the live selection.
 */
function placeCaretElementBoundary(
  html: string,
  selector: string,
): { write: Element; selection: Selection } {
  const doc = window.document;
  doc.body.innerHTML = `<div id="write">${html}</div>`;
  const write = doc.getElementById("write")!;
  const target = write.querySelector(selector)!;
  const range = doc.createRange();
  range.setStart(target, target.childNodes.length);
  range.collapse(true);
  const selection = doc.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return { write, selection };
}

describe("deriveCaretFromDomSelection — single-line blocks", () => {
  it("maps a mid-paragraph text-node caret to {line, character}", () => {
    const { selection, write } = placeCaret("<p>Hello world</p>", "p", 5);
    const result = deriveCaretFromDomSelection({
      writingArea: write,
      selection,
      markdown: "Hello world",
    });
    expect(result).toEqual({ line: 0, character: 5 });
  });

  it("adds the heading marker length back to the rendered offset", () => {
    // "# Title" renders as <h1>Title</h1> — the "# " is CSS, not DOM text.
    const { selection, write } = placeCaret("<h1>Title</h1>", "h1", 5);
    const result = deriveCaretFromDomSelection({
      writingArea: write,
      selection,
      markdown: "# Title",
    });
    expect(result).toEqual({ line: 0, character: 7 });
  });

  it("adds the bullet length back for a list item", () => {
    // "- item one" renders as <ul><li>item one</li></ul>; "- " is CSS.
    const { selection, write } = placeCaret("<ul><li>item one</li></ul>", "li", 8);
    const result = deriveCaretFromDomSelection({
      writingArea: write,
      selection,
      markdown: "- item one",
    });
    expect(result).toEqual({ line: 0, character: 10 });
  });

  it("handles an element anchor at the end of a line (click at line end)", () => {
    const { selection, write } = placeCaretElementBoundary("<p>Hello world</p>", "p");
    const result = deriveCaretFromDomSelection({
      writingArea: write,
      selection,
      markdown: "Hello world",
    });
    expect(result).toEqual({ line: 0, character: 11 });
  });

  it("matches blocks sequentially so a repeated line resolves to the right one", () => {
    const { selection, write } = placeCaret("<p>same</p><p>same</p>", "p:nth-of-type(2)", 4);
    const result = deriveCaretFromDomSelection({
      writingArea: write,
      selection,
      markdown: "same\n\nsame",
    });
    expect(result).toEqual({ line: 2, character: 4 });
  });

  it("returns null when the caret is outside the writing area", () => {
    const { write } = placeCaret("<p>Hello</p>", "p", 5);
    const doc = window.document;
    const outside = doc.createElement("div");
    outside.textContent = "elsewhere";
    doc.body.appendChild(outside);
    const range = doc.createRange();
    range.setStart(outside.firstChild!, 1);
    range.collapse(true);
    const selection = doc.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const { lines, log } = makeLog();
    const result = deriveCaretFromDomSelection({
      writingArea: write,
      selection,
      markdown: "Hello",
      log,
    });
    expect(result).toBeNull();
    expect(lines.join("\n")).toContain("anchor outside writingArea");
  });
});

describe("deriveCaretFromDomSelection — multi-line blocks (code fences)", () => {
  // A fenced code block renders as a single <pre> whose text is several lines,
  // so it can never equal one markdown line. Before the multi-line matcher this
  // returned null and the caller silently fell back to a STALE tracker — the
  // "coherent completion of the wrong prefix" bug. See CONSTRAINTS.md P0.3.
  const markdown = ["Intro", "", "```js", "const a = 1;", "const b = 2;", "```", "", "Outro"].join(
    "\n",
  );
  const html = "<p>Intro</p><pre>const a = 1;\nconst b = 2;</pre><p>Outro</p>";

  it("derives the caret line inside a fenced code block", () => {
    const { selection, write } = placeCaret(html, "pre", 12);
    const result = deriveCaretFromDomSelection({
      writingArea: write,
      selection,
      markdown,
    });
    expect(result).toEqual({ line: 3, character: 12 });
  });

  it("derives the caret on the second line of a fenced code block", () => {
    const { selection, write } = placeCaret(html, "pre", 25);
    const result = deriveCaretFromDomSelection({
      writingArea: write,
      selection,
      markdown,
    });
    expect(result).toEqual({ line: 4, character: 12 });
  });
});

describe("preview exclusion (an undismissed ghost must not corrupt the derivation)", () => {
  it("derives the same caret whether or not its own ghost sits in the block", () => {
    const markdown = "-  Add tests for mid-wordX\n";
    const withGhost = placeCaret(
      `<ul><li>Add tests for mid-wordX<span class="inscribe-ghost">X</span></li></ul>`,
      "li",
      22,
    );
    const derivedWithGhost = deriveCaretFromDomSelection({
      writingArea: withGhost.write,
      selection: withGhost.selection,
      markdown,
    });

    // Re-render only AFTER reading the first result: placeCaret rewrites the body
    // and moves the live selection out from under it.
    const plain = placeCaret(`<ul><li>Add tests for mid-wordX</li></ul>`, "li", 22);
    const derivedWithoutGhost = deriveCaretFromDomSelection({
      writingArea: plain.write,
      selection: plain.selection,
      markdown,
    });

    expect(derivedWithGhost).not.toBeNull();
    expect(derivedWithGhost).toEqual(derivedWithoutGhost);
  });
});

describe("blocks whose rendered text hides its own line separators", () => {
  it("refuses the caret instead of reporting a confident wrong one", () => {
    const markdown = [
      "Intro",
      "",
      "```js",
      "def add(a, b): return a + b",
      "function multiply(a, b) {",
      "```",
      "",
      "Outro",
    ].join("\n");
    // Typora renders a fence's indentation and breaks via CSS, so the block text
    // arrives without them and its line structure is not recoverable.
    const html =
      "<p>Intro</p><pre><span>def add(a, b): return a + b</span><span>function multiply(a, b) {</span></pre><p>Outro</p>";
    const { selection, write } = placeCaret(html, "pre span", 10);
    const log = makeLog();
    const result = deriveCaretFromDomSelection({
      writingArea: write,
      selection,
      markdown,
      log: log.log,
    });

    expect(result).toBeNull();
    expect(log.lines.join("\n")).toContain("no rendered line separators");
  });
});

describe("validTrackedCaret", () => {
  const markdown = "line one\nline two\n";

  it("passes a position the document can hold", () => {
    const position = { character: 4, line: 0 };
    expect(validTrackedCaret(position, markdown)).toEqual(position);
  });

  it("allows the exact end of a line", () => {
    const position = { character: 8, line: 1 };
    expect(validTrackedCaret(position, markdown)).toEqual(position);
  });

  it("refuses the off-by-one overshoot the tracker produces at end of line", () => {
    expect(validTrackedCaret({ character: 9, line: 1 }, markdown)).toBeNull();
  });

  it("refuses a line past the end of the document", () => {
    expect(validTrackedCaret({ character: 0, line: 7 }, markdown)).toBeNull();
  });

  it("passes null through", () => {
    expect(validTrackedCaret(null, markdown)).toBeNull();
  });
});

/** Fixture for the tracked-caret refusal tests: two 8-character lines. */
const trackedLines = "line one\nline two\n";

describe("trackedRefusal", () => {
  it("names a tracker that never saw an edit", () => {
    expect(trackedRefusal(null, trackedLines)).toBe("never-tracked");
  });

  it("names a position the document cannot hold", () => {
    expect(trackedRefusal({ character: 27, line: 1 }, trackedLines)).toBe("out-of-range");
    expect(trackedRefusal({ character: 0, line: 99 }, trackedLines)).toBe("out-of-range");
  });

  it("is null for a position the document can hold", () => {
    expect(trackedRefusal({ character: 8, line: 1 }, trackedLines)).toBeNull();
  });
});

describe("noCaretReason", () => {
  it("does not report a rejected position as a missing tracker", () => {
    // One message for both cases made the log say "tracker null" about a
    // position that did exist, which is the wrong lead to debug from.
    const rejected = noCaretReason({ character: 27, line: 1 }, trackedLines);
    const missing = noCaretReason(null, trackedLines);
    expect(rejected).not.toBe(missing);
    expect(rejected).toContain("past the end");
    expect(missing).toContain("never saw an edit");
  });

  it("says so when the position was usable, rather than blaming the derivation", () => {
    expect(noCaretReason({ character: 8, line: 1 }, trackedLines)).toContain("unexpected");
  });
});
