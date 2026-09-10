import { describe, expect, it } from "vitest";

import { deriveCaretFromDomSelection } from "./caret";
import { isSeparatorRow, mapTableBlock, sourceOffsetFor, splitRow, stripMarkers } from "./table";

/**
 * First text node inside an element, so a cell containing markup can still take
 * a caret offset.
 *
 * @param el - Element to search.
 * @returns The first text node, or the element itself when it has none.
 */
function firstTextNode(el: Element): Node {
  const walker = el.ownerDocument.createTreeWalker(el, 4 /* SHOW_TEXT */, null);
  return walker.nextNode() ?? el;
}

/**
 * Render `html` into a `#write` container and place a collapsed caret inside the
 * text node of `selector` at `offset` rendered characters.
 *
 * @param html - Inner HTML for the editor's writing area.
 * @param selector - Selector for the cell to place the caret in.
 * @param offset - Caret offset in characters within the target's text.
 * @returns The writing area, the live selection and the target element.
 */
function placeCaret(
  html: string,
  selector: string,
  offset: number,
): { write: Element; selection: Selection; target: Element } {
  const doc = window.document;
  doc.body.innerHTML = `<div id="write">${html}</div>`;
  const write = doc.getElementById("write")!;
  const target = write.querySelector(selector)!;
  const textNode = firstTextNode(target);
  const range = doc.createRange();
  range.setStart(textNode, offset);
  range.collapse(true);
  const selection = doc.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return { selection, target, write };
}

/**
 * Derive a caret for a fixture, returning both the result and the trace.
 *
 * @param markdown - Document markdown the DOM is meant to render.
 * @param html - Inner HTML for the writing area.
 * @param selector - Cell to place the caret in.
 * @param offset - Rendered-character offset for the caret.
 * @returns The derived position, the trace lines, and the markdown lines.
 */
function derive(
  markdown: string,
  html: string,
  selector: string,
  offset: number,
): { result: { line: number; character: number } | null; trace: string[]; lines: string[] } {
  const { selection, write } = placeCaret(html, selector, offset);
  const trace: string[] = [];
  const result = deriveCaretFromDomSelection({
    log: (m) => trace.push(m),
    markdown,
    selection,
    writingArea: write,
  });
  return { lines: markdown.split("\n"), result, trace };
}

const RATCHET_TABLE = [
  "Intro",
  "",
  "| Metric | Target |",
  "|--------|--------|",
  "| Build  | clean  |",
  "",
  "Outro",
].join("\n");

const RATCHET_HTML =
  "<p>Intro</p>" +
  '<figure class="md-table-fig"><table><thead><tr><th>Metric</th><th>Target</th></tr></thead>' +
  "<tbody><tr><td>Build</td><td>clean</td></tr></tbody></table></figure>" +
  "<p>Outro</p>";

describe("splitRow", () => {
  it("splits a simple row and records each cell's offset", () => {
    const cells = splitRow("| Build  | clean  |");
    expect(cells.map((c) => c.text)).toEqual([" Build  ", " clean  "]);
    expect(cells[1]!.start).toBe(10);
  });

  it("does not split on an escaped pipe — the CONSTRAINTS.md Suppressions row", () => {
    // Token text is deliberately NOT a real lint directive: this repo's
    // suppression ratchet counts those strings anywhere under src/, and a test
    // fixture is not a suppression. The STRUCTURE (a code span holding escaped
    // pipes) is what is under test, and it mirrors CONSTRAINTS.md.
    const row = "| Suppressions | 25 | `rg -c 'alpha\\|bravo\\|charlie' src/` |";
    expect(splitRow(row)).toHaveLength(3);
  });

  it("does not split on a pipe inside a code span", () => {
    // Two cells, not three: the inner pipe belongs to the code span.
    expect(splitRow("| a | `x | y` |")).toHaveLength(2);
  });
});

describe("isSeparatorRow", () => {
  it("recognises a delimiter row", () => {
    expect(isSeparatorRow("|--------|:------:|")).toBe(true);
    expect(isSeparatorRow("|---|---|")).toBe(true);
  });

  it("rejects content rows", () => {
    expect(isSeparatorRow("| Build  | clean  |")).toBe(false);
    expect(isSeparatorRow("plain text")).toBe(false);
  });
});

describe("stripMarkers / sourceOffsetFor", () => {
  it("strips emphasis, code spans and escapes to rendered text", () => {
    expect(stripMarkers("**Bold** and `code`")).toBe("Bold and code");
    expect(stripMarkers("a \\| b")).toBe("a | b");
    expect(stripMarkers("[label](https://example.com)")).toBe("label");
  });

  it("maps rendered characters past a code span and an escape", () => {
    expect(sourceOffsetFor("`a\\|b`", 2)).toBe(4);
  });

  it("maps rendered characters past emphasis markers", () => {
    expect(sourceOffsetFor("**Bold** cell", 4)).toBe(6);
  });
});

describe("mapTableBlock", () => {
  it("refuses a figure whose cells are not table cells, and says why", () => {
    const doc = window.document;
    doc.body.innerHTML = '<div id="write"><figure><div><span>Metric</span></div></figure></div>';
    const figure = doc.querySelector("figure")!;
    const trace: string[] = [];
    const mapping = mapTableBlock({
      anchor: doc.querySelector("span")!.firstChild,
      anchorOffset: 0,
      figure,
      fromLine: 0,
      lines: ["| Metric |", "|--------|"],
      trace: (m) => trace.push(m),
    });
    expect(mapping.caret).toBeNull();
    expect(mapping.reason).toContain("not inside a cell");
    // The source span is still reported, so the caller can advance past it.
    expect(mapping.lineCount).toBe(2);
  });
});

describe("deriveCaretFromDomSelection — tables", () => {
  it("maps a caret mid-cell to the prefix the model would receive", () => {
    const { lines, result } = derive(RATCHET_TABLE, RATCHET_HTML, "tbody tr td:nth-of-type(2)", 3);
    expect(result).not.toBeNull();
    expect(result!.line).toBe(4);
    expect(lines[result!.line]!.slice(0, result!.character)).toBe("| Build  | cle");
  });

  it("maps a caret in a header cell", () => {
    const { lines, result } = derive(RATCHET_TABLE, RATCHET_HTML, "thead th:nth-of-type(1)", 3);
    expect(result).not.toBeNull();
    expect(result!.line).toBe(2);
    expect(lines[result!.line]!.slice(0, result!.character)).toBe("| Met");
  });

  it("keeps the caret correct on a row containing escaped pipes", () => {
    // Token text is deliberately not a real lint directive — see the note in the
    // splitRow suite. The structure under test mirrors CONSTRAINTS.md.
    const markdown = [
      "| Metric | Count | Command |",
      "|--------|-------|---------|",
      "| Rows   | 25    | `rg -c 'alpha-bravo\\|charlie-delta' src/` |",
      "",
      "After",
    ].join("\n");
    const html =
      "<figure><table><thead><tr><th>Metric</th><th>Count</th><th>Command</th></tr></thead>" +
      "<tbody><tr><td>Rows</td><td>25</td>" +
      "<td>rg -c 'alpha-bravo|charlie-delta' src/</td></tr></tbody></table></figure>" +
      "<p>After</p>";
    const { lines, result } = derive(markdown, html, "tbody tr td:nth-of-type(3)", 18);
    expect(result).not.toBeNull();
    expect(result!.line).toBe(2);
    // Rendered offset 18 is just past "alpha-bravo"; the source must agree even
    // though the source reaches the same point through `\|` escapes and a
    // code span, both of which the rendered text does not contain.
    expect(lines[result!.line]!.slice(0, result!.character)).toMatch(/alpha-bravo$/);
    expect(lines[result!.line]!.slice(0, result!.character)).not.toContain("charlie");
  });

  it("maps a caret inside a cell that renders inline markup", () => {
    const markdown = ["| A | B |", "|---|---|", "| x | **Bold** cell |"].join("\n");
    const html =
      "<figure><table><thead><tr><th>A</th><th>B</th></tr></thead>" +
      "<tbody><tr><td>x</td><td><strong>Bold</strong> cell</td></tr></tbody></table></figure>";
    const { lines, result } = derive(markdown, html, "tbody tr td:nth-of-type(2)", 4);
    expect(result).not.toBeNull();
    // The source index after `d` is 12 — mid-markup, which is what a caret
    // sitting at the end of the bold span means.
    expect(lines[result!.line]!.slice(0, result!.character)).toBe("| x | **Bold");
  });

  it("still maps markup that the renderer left in the cell text", () => {
    const markdown = ["| A | B |", "|---|---|", "| x | **Bold** cell |"].join("\n");
    const html =
      "<figure><table><thead><tr><th>A</th><th>B</th></tr></thead>" +
      "<tbody><tr><td>x</td><td>**Bold** cell</td></tr></tbody></table></figure>";
    const { lines, result } = derive(markdown, html, "tbody tr td:nth-of-type(2)", 6);
    expect(result).not.toBeNull();
    // Marker-retaining render must produce the SAME source prefix as the
    // marker-stripping one above — that equivalence is the point of counting
    // plain characters on both sides.
    expect(lines[result!.line]!.slice(0, result!.character)).toBe("| x | **Bold");
  });

  it("refuses rather than guessing when the row count disagrees", () => {
    // Two rendered rows, one source row: the DOM is not what the markdown says.
    const markdown = ["| A | B |", "|---|---|", "| 1 | 2 |"].join("\n");
    const html =
      "<figure><table><tbody><tr><td>1</td><td>2</td></tr><tr><td>9</td><td>9</td></tr>" +
      "</tbody></table></figure>";
    const { result, trace } = derive(markdown, html, "tbody tr:nth-of-type(2) td", 1);
    expect(result).toBeNull();
    expect(trace.join("\n")).toMatch(/NO-MATCH|disagree/i);
  });

  it("keeps mapping the paragraph after a table (no line drift)", () => {
    const { lines, result } = derive(RATCHET_TABLE, RATCHET_HTML, "p:nth-of-type(2)", 2);
    expect(result).not.toBeNull();
    expect(result!.line).toBe(6);
    expect(lines[result!.line]!.slice(0, result!.character)).toBe("Ou");
  });
});
