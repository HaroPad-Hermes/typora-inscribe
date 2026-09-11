import { describe, expect, it } from "vitest";

import { cleanReplacement, describeEditRefusal, offsetAt, planEdit } from "./edit-plan";

const range = (sl: number, sc: number, el: number, ec: number) => ({
  start: { line: sl, character: sc },
  end: { line: el, character: ec },
});

describe("offsetAt", () => {
  it("locates a position on the first line and on a later one", () => {
    expect(offsetAt("one\ntwo\nthree", { line: 0, character: 2 })).toBe(2);
    expect(offsetAt("one\ntwo\nthree", { line: 1, character: 2 })).toBe(6);
  });

  it("counts CRLF as one line ending", () => {
    expect(offsetAt("one\r\ntwo", { line: 1, character: 0 }, "\r\n")).toBe(5);
  });

  it("clamps a character past the end of its line instead of returning nonsense", () => {
    // The tracker overshoots by one at end-of-line; a clamped offset is a
    // recoverable position, an unclamped one is a corrupted slice.
    expect(offsetAt("one\ntwo", { line: 1, character: 99 })).toBe(7);
  });

  it("returns -1 for a line the document does not have", () => {
    expect(offsetAt("one", { line: 9, character: 0 })).toBe(-1);
  });
});

describe("cleanReplacement", () => {
  it("leaves plain prose alone", () => {
    expect(cleanReplacement("  the cat sat  ")).toBe("the cat sat");
  });

  it("strips a fence that wraps the whole answer, language token and all", () => {
    expect(cleanReplacement("```markdown\nthe cat sat\n```")).toBe("the cat sat");
    expect(cleanReplacement("~~~\nthe cat sat\n~~~")).toBe("the cat sat");
  });

  it("keeps a fence that is part of the answer rather than around it", () => {
    const answer = "Here\n\n```\ncode\n```\n\nand more";
    expect(cleanReplacement(answer)).toBe(answer);
  });
});

describe("planEdit", () => {
  const markdown = "one\nthe cat sat on the mat\nthree\n";
  const passage = "the cat sat on the mat";
  const span = range(1, 0, 1, passage.length);

  it("produces the whole document with the passage replaced", () => {
    const result = planEdit({ markdown, range: span, passage, answer: "the cat sat." });
    expect(result.ok).toBe(true);
    expect(result.ok && result.plan.after).toBe("one\nthe cat sat.\nthree\n");
    expect(result.ok && result.plan.before).toBe(passage);
  });

  it("accepts a multi-line answer in a paragraph", () => {
    const result = planEdit({ markdown, range: span, passage, answer: "the cat\nsat" });
    expect(result.ok && result.plan.after).toBe("one\nthe cat\nsat\nthree\n");
  });

  it("refuses an empty answer, before touching the document", () => {
    expect(planEdit({ markdown, range: span, passage, answer: "   " })).toEqual({
      ok: false,
      reason: "empty-output",
    });
    expect(planEdit({ markdown, range: span, passage, answer: "```\n```" })).toEqual({
      ok: false,
      reason: "empty-output",
    });
  });

  it("refuses an answer that changes nothing", () => {
    expect(planEdit({ markdown, range: span, passage, answer: passage })).toEqual({
      ok: false,
      reason: "unchanged",
    });
  });

  it("refuses a range the document cannot hold, which would otherwise throw", () => {
    // `replaceTextByRange` asserts its own line lookup, so an unvalidated range
    // is a crash inside the edit path, not a no-op.
    expect(planEdit({ markdown, range: range(9, 0, 9, 1), passage, answer: "x" })).toEqual({
      ok: false,
      reason: "range-out-of-document",
    });
  });

  it("refuses a line break inside a table cell — that rewrites the table", () => {
    const table = "| a | b |\n| - | - |\n| one | two |\n";
    const cell = range(2, 2, 2, 5);
    expect(planEdit({ markdown: table, range: cell, passage: "one", answer: "a\nb" })).toEqual({
      ok: false,
      reason: "table-cell-newline",
    });
    expect(planEdit({ markdown: table, range: cell, passage: "one", answer: "a | b" })).toEqual({
      ok: false,
      reason: "table-cell-pipe",
    });
  });

  it("allows a pipe-free single-line answer in a table cell", () => {
    const table = "| a | b |\n| - | - |\n| one | two |\n";
    expect(
      planEdit({ markdown: table, range: range(2, 2, 2, 5), passage: "one", answer: "uno" }).ok,
    ).toBe(true);
  });

  it("refuses a multi-line answer at a heading", () => {
    const heading = "# Title here\n\nbody\n";
    expect(
      planEdit({
        markdown: heading,
        range: range(0, 2, 0, 12),
        passage: "Title here",
        answer: "New title\nand more",
      }),
    ).toEqual({ ok: false, reason: "heading-multiline" });
  });
});

describe("describeEditRefusal", () => {
  it("names every refusal distinctly, including the structural ones", () => {
    const reasons = [
      "empty-output",
      "unchanged",
      "range-out-of-document",
      "heading-multiline",
      "table-cell-newline",
      "table-cell-pipe",
    ] as const;
    const messages = reasons.map(describeEditRefusal);
    expect(new Set(messages).size).toBe(reasons.length);
    expect(messages.every((m) => m.length > 0)).toBe(true);
  });
});
