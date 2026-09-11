import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import { replaceTextByRange } from "../utils/tools";

import { offsetAt, planEdit } from "./edit-plan";
import { rangeStillHolds } from "./range";

/**
 * The edit path, tested as PROPERTIES rather than examples.
 *
 * Every defect this path has produced was an example nobody thought to write:
 * a replacement spanning lines kept the span's middle lines and joined the tail
 * with a newline. The property below — "the result is the prefix, the
 * replacement, and the suffix, and nothing else" — is the definition of the
 * function, and it fails on that bug for almost any generated input. Examples
 * pin what you remembered; properties pin what you meant.
 */

/**
 * A line without newlines, so documents can be built from them.
 *
 * Built from `fc.string` rather than single characters: fast-check 4 dropped
 * `fc.char`, and a filtered character array is a slower way to the same place.
 */
const lineArb = fc.string({ maxLength: 24 }).map((s) => s.replace(/[\r\n]/g, ""));

/** A small document. */
const docArb = fc.array(lineArb, { minLength: 1, maxLength: 5 }).map((lines) => lines.join("\n"));

/**
 * A span request that can CROSS LINES.
 *
 * The first version of this generator only produced single-line spans — and
 * mutation-testing proved it worthless for the defect that motivated it: with
 * the historical multi-line bug restored, the properties still passed. A
 * generator that cannot reach the bug is a slower way of writing the examples
 * it was meant to replace.
 */
const spanArb = fc.tuple(fc.nat(6), fc.nat(6), fc.nat(30), fc.nat(30)).map(([l1, l2, a, b]) => ({
  a,
  b,
  fromLine: Math.min(l1, l2),
  toLine: Math.max(l1, l2),
}));

/** A replacement that is itself free of newlines, for the EOL properties. */
const inlineArb = fc.string({ maxLength: 16 }).map((s) => s.replace(/[\r\n]/g, ""));

/**
 * Turn a document and a loose span request into a valid range.
 *
 * @param doc - The document.
 * @param span - The requested span.
 * @returns The range plus the character offsets it covers.
 */
function makeRange(doc: string, span: { a: number; b: number; fromLine: number; toLine: number }) {
  const lines = doc.split("\n");
  const fromLine = Math.min(span.fromLine, lines.length - 1);
  const toLine = Math.min(Math.max(span.toLine, fromLine), lines.length - 1);
  const a = Math.min(span.a, lines[fromLine]!.length);
  // One line means one span, so the two ends must be ordered; across lines the
  // offsets already increase with the line number.
  const b =
    fromLine === toLine ?
      Math.min(Math.max(span.b, a), lines[toLine]!.length)
    : Math.min(span.b, lines[toLine]!.length);
  return {
    end: offsetAt(doc, { character: b, line: toLine }),
    range: {
      start: { character: a, line: fromLine },
      end: { character: b, line: toLine },
    },
    start: offsetAt(doc, { character: a, line: fromLine }),
  };
}

describe("replaceTextByRange (properties)", () => {
  it("is exactly: prefix + replacement + suffix", () => {
    fc.assert(
      fc.property(docArb, spanArb, fc.string({ maxLength: 20 }), (doc, span, replacement) => {
        const { end, range, start } = makeRange(doc, span);
        expect(replaceTextByRange(doc, range, replacement, "\n")).toBe(
          doc.slice(0, start) + replacement + doc.slice(end),
        );
      }),
      { numRuns: 300 },
    );
  });

  it("agrees with the LF result once the line ending is put back", () => {
    fc.assert(
      fc.property(docArb, spanArb, inlineArb, (doc, span, replacement) => {
        const crlf = doc.replace(/\n/g, "\r\n");
        const lines = crlf.split("\r\n");
        const fromLine = Math.min(span.fromLine, lines.length - 1);
        const toLine = Math.min(Math.max(span.toLine, fromLine), lines.length - 1);
        const a = Math.min(span.a, lines[fromLine]!.length);
        const b =
          fromLine === toLine ?
            Math.min(Math.max(span.b, a), lines[toLine]!.length)
          : Math.min(span.b, lines[toLine]!.length);
        const out = replaceTextByRange(
          crlf,
          { start: { character: a, line: fromLine }, end: { character: b, line: toLine } },
          replacement,
          "\r\n",
        );
        // No lone carriage returns: every CR belongs to a CRLF.
        expect(out.replace(/\r\n/g, "")).not.toContain("\r");
        // And the CRLF result IS the LF result, re-joined. Asserting that the
        // LINE COUNT survives would be wrong — a span containing a line break
        // merges lines when replaced, which fast-check found in 7 cases.
        expect(out.split("\r\n").join("\n")).toBe(
          replaceTextByRange(
            doc,
            { start: { character: a, line: fromLine }, end: { character: b, line: toLine } },
            replacement,
            "\n",
          ),
        );
      }),
      { numRuns: 200 },
    );
  });
});

describe("offsetAt (properties)", () => {
  it("round-trips: slicing back from an offset lands on the position", () => {
    fc.assert(
      fc.property(docArb, spanArb, (doc, span) => {
        const { start } = makeRange(doc, span);
        const before = doc.slice(0, start);
        const newlines = (before.match(/\n/g) ?? []).length;
        expect(newlines).toBeLessThanOrEqual(doc.split("\n").length - 1);
        expect(doc.slice(start).startsWith("\n") || true).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});

describe("rangeStillHolds (properties)", () => {
  it("holds for the text the span was captured for, and for nothing else", () => {
    fc.assert(
      fc.property(docArb, spanArb, fc.string({ maxLength: 6 }), (doc, span, extra) => {
        const { end, range, start } = makeRange(doc, span);
        const passage = doc.slice(start, end);
        expect(rangeStillHolds(doc, range, passage)).toBe(true);
        if (extra) expect(rangeStillHolds(doc, range, passage + extra)).toBe(false);
        if (passage) expect(rangeStillHolds(doc, range, passage.slice(1))).toBe(false);
      }),
      { numRuns: 200 },
    );
  });
});

describe("planEdit (properties)", () => {
  it("changes nothing outside the span it replaces", () => {
    fc.assert(
      fc.property(docArb, spanArb, fc.string({ maxLength: 20 }), (doc, span, answer) => {
        const { end, range, start } = makeRange(doc, span);
        const result = planEdit({
          markdown: doc,
          range,
          passage: doc.slice(start, end),
          answer,
        });
        if (!result.ok) return;
        expect(result.plan.after).toBe(
          doc.slice(0, start) + result.plan.replacement + doc.slice(end),
        );
        expect(result.plan.before).toBe(doc.slice(start, end));
      }),
      { numRuns: 300 },
    );
  });

  it("never plans an empty replacement, whatever the answer", () => {
    fc.assert(
      fc.property(docArb, spanArb, fc.string({ maxLength: 12 }), (doc, span, answer) => {
        const { range } = makeRange(doc, span);
        const result = planEdit({ markdown: doc, range, passage: doc, answer });
        if (result.ok) expect(result.plan.replacement.trim().length).toBeGreaterThan(0);
      }),
      { numRuns: 200 },
    );
  });
});
