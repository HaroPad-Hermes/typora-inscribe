import { describe, expect, it } from "vitest";

import {
  caretLinePrefix,
  caretLineSuffix,
  describeStructuralRefusal,
  isInsideTableCell,
  structuralVerdict,
} from "./structure";
import type { StructuralReason } from "./structure";

const TABLE = [
  "| word     | meaning       |",
  "| -------- | ------------- |",
  '| "sent"   | "sentence" or "sent" |',
  '| "para"   | "paragraph"   |',
  "",
].join("\n");

/**
 * Split the table at `caret` (a character offset) into pre/post cursor text.
 *
 * @param doc - The document to split.
 * @param caret - Character offset of the caret.
 * @returns The markdown before and after the caret.
 */
function at(doc: string, caret: number): { pre: string; post: string } {
  return { post: doc.slice(caret), pre: doc.slice(0, caret) };
}

/**
 * Offset of the first line containing `needle`.
 *
 * @param needle - Text to find.
 * @returns Its character offset in the table fixture.
 */
const offsetOf = (needle: string): number => TABLE.indexOf(needle);

describe("caretLinePrefix / caretLineSuffix", () => {
  it("split the caret's line at the caret", () => {
    const { post, pre } = at(TABLE, offsetOf('| "sent"   | "sent') + 11);
    expect(caretLinePrefix(pre)).toBe('| "sent"   ');
    expect(caretLineSuffix(post)).toBe('| "sentence" or "sent" |');
  });
});

describe("isInsideTableCell", () => {
  it("recognises a body row (separator above)", () => {
    const { post, pre } = at(TABLE, offsetOf('| "sent"   | "sent') + 11);
    expect(isInsideTableCell(pre, post)).toBe(true);
  });

  it("recognises the header row, whose separator is BELOW it", () => {
    const { post, pre } = at(TABLE, offsetOf("| word     | meaning") + 8);
    expect(isInsideTableCell(pre, post)).toBe(true);
  });

  it("recognises a row several lines into the table", () => {
    const { post, pre } = at(TABLE, offsetOf('| "para"   | "para') + 8);
    expect(isInsideTableCell(pre, post)).toBe(true);
  });

  it("does not treat prose containing a pipe as a row", () => {
    const doc = "Use a | pipe in prose\nstill prose here\n";
    const { post, pre } = at(doc, 20);
    expect(isInsideTableCell(pre, post)).toBe(false);
  });

  it("does not treat a heading or plain line as a row", () => {
    const doc = "# Inline Autocomplete\n\nSome text\n";
    const { post, pre } = at(doc, doc.length - 1);
    expect(isInsideTableCell(pre, post)).toBe(false);
  });
});

describe("structuralVerdict", () => {
  const cell = at(TABLE, offsetOf('| "sent"   | "sent') + 11);

  it("refuses the live data-loss case: a multi-line fill inside a cell", () => {
    // Verbatim shape from the live run that lost a cell's content.
    const candidate = ' | "sentence" |\r\n| "para" | "paragraph" |\r\n| "word" | "word"';
    expect(structuralVerdict(cell.pre, cell.post, candidate)).toEqual({
      ok: false,
      reason: "table-cell-newline",
    });
  });

  it("refuses an unescaped pipe inside a cell, which would open a column", () => {
    expect(structuralVerdict(cell.pre, cell.post, ' "sentence" | "extra"')).toEqual({
      ok: false,
      reason: "table-cell-pipe",
    });
  });

  it("allows a single-line, pipe-free fill inside a cell", () => {
    expect(structuralVerdict(cell.pre, cell.post, '"sentence"')).toEqual({ ok: true });
  });

  it("allows an escaped pipe inside a cell", () => {
    expect(structuralVerdict(cell.pre, cell.post, '"either \\| or"')).toEqual({ ok: true });
  });

  it("refuses a multi-line fill at a heading", () => {
    const doc = "# Inline Autocomplete\n\nbody\n";
    expect(structuralVerdict("# ", doc.slice(2), "Title\nmore\nmore")).toEqual({
      ok: false,
      reason: "heading-multiline",
    });
  });

  it("allows a single-line fill at a heading", () => {
    expect(structuralVerdict("# ", "Inline Autocomplete\n", "Autocomplete")).toEqual({ ok: true });
  });

  it("leaves ordinary paragraphs alone — multi-line fills are legal there", () => {
    expect(structuralVerdict("Some prose ", "continues here\n", "and a\nsecond line")).toEqual({
      ok: true,
    });
  });
});

describe("describeStructuralRefusal", () => {
  const reasons: StructuralReason[] = [
    "heading-multiline",
    "table-cell-newline",
    "table-cell-pipe",
  ];

  it("names every refusal distinctly and says it was refused", () => {
    const messages = reasons.map(describeStructuralRefusal);
    expect(messages.every((m) => m.includes("refused"))).toBe(true);
    expect(new Set(messages).size).toBe(reasons.length);
  });
});
