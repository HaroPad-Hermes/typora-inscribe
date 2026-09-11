import { describe, expect, it } from "vitest";

import { replaceTextByRange } from "./tools";

/**
 * Build a range from two `line,character` pairs.
 *
 * @param sl - Start line.
 * @param sc - Start character.
 * @param el - End line.
 * @param ec - End character.
 * @returns The range.
 */
const range = (sl: number, sc: number, el: number, ec: number) => ({
  start: { line: sl, character: sc },
  end: { line: el, character: ec },
});

describe("replaceTextByRange", () => {
  it("replaces inside one line", () => {
    expect(replaceTextByRange("the cat sat", range(0, 4, 0, 7), "dog")).toBe("the dog sat");
  });

  it("inserts when the range is empty", () => {
    // The caret case: an empty range at a caret is an insert, which is what the
    // completion path relies on (it computes this string then diffs it).
    expect(replaceTextByRange("the  sat", range(0, 4, 0, 4), "cat")).toBe("the cat sat");
  });

  it("deletes when the replacement is empty", () => {
    expect(replaceTextByRange("the cat sat", range(0, 3, 0, 7), "")).toBe("the sat");
  });

  it("replaces a whole line", () => {
    expect(replaceTextByRange("one\ntwo\nthree", range(1, 0, 1, 3), "TWO")).toBe("one\nTWO\nthree");
  });

  it("replaces across two lines, keeping the tail of the last", () => {
    expect(replaceTextByRange("one\ntwo\nthree", range(0, 2, 1, 2), "X")).toBe("onXo\nthree");
  });

  it("replaces a span that swallows whole lines in the middle", () => {
    expect(replaceTextByRange("a\nb\nc\nd", range(0, 1, 3, 1), "Z")).toBe("aZ");
  });

  it("joins with CRLF when asked for CRLF", () => {
    // The caller picks the EOL from Typora's own setting, so a replacement in a
    // CRLF document must not silently convert the file to LF.
    expect(replaceTextByRange("one\r\ntwo", range(0, 0, 0, 3), "ONE", "\r\n")).toBe("ONE\r\ntwo");
  });

  it("keeps the rest of a CRLF document intact", () => {
    const out = replaceTextByRange("one\r\ntwo\r\nthree", range(1, 0, 1, 3), "TWO", "\r\n");
    expect(out).toBe("one\r\nTWO\r\nthree");
    expect(out.split("\r\n")).toHaveLength(3);
  });

  it("returns the text unchanged when the replacement equals what was there", () => {
    expect(replaceTextByRange("one\ntwo", range(0, 0, 0, 3), "one")).toBe("one\ntwo");
  });

  it("throws on a line past the end of the document", () => {
    // Recorded, not endorsed: the function asserts its own line lookup, so an
    // out-of-range range throws rather than corrupting the document. Any caller
    // that computes a range from the editor must validate it first.
    expect(() => replaceTextByRange("a\nb", range(5, 0, 6, 0), "x")).toThrow();
  });
});
