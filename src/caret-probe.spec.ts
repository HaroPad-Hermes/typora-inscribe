import { afterEach, describe, expect, it } from "vitest";

import { attachCaretProbe } from "./caret-probe";

let detach: (() => void) | undefined;

afterEach(() => {
  detach?.();
  detach = undefined;
  Files.editor = undefined;
});

/**
 * Point the `Files` global at a stub editor.
 *
 * `Files` itself cannot be replaced: `patches/typora` defines it with
 * `Object.defineProperty(global, "Files", { value })`, i.e. non-writable and
 * non-configurable, exactly as Typora does. The stub is therefore planted on
 * the constructor's `editor` slot — the same slot Typora fills in production.
 *
 * @param writingArea - Element exposed as `Files.editor.writingArea`.
 * @param markdown - Markdown the stub editor reports.
 */
const stubEditor = (writingArea: Element | undefined, markdown: string): void => {
  Files.useCRLF = false;
  Files.editor = {
    getMarkdown: () => markdown,
    writingArea,
  } as unknown as Typora.Editor;
};

/**
 * Render `html` into a `#write` container and leave the caret at the end of
 * `selector`'s text.
 *
 * The range is anchored INSIDE a text node on purpose: an element-boundary
 * range does not survive happy-dom's selection round-trip, and the derivation
 * would then see no caret at all — a harness artifact that reads as a bug.
 *
 * @param html - Inner HTML for the writing area.
 * @param selector - Selector for the element to place the caret in.
 * @returns The writing-area element.
 */
const caretAtEndOf = (html: string, selector: string): Element => {
  const doc = window.document;
  doc.body.innerHTML = `<div id="write">${html}</div>`;
  const write = doc.getElementById("write")!;
  const target = write.querySelector(selector)!;
  const textNode = target.firstChild as Text;
  const range = doc.createRange();
  range.setStart(textNode, textNode.textContent.length);
  range.collapse(true);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return write;
};

/**
 * Attach a probe whose output is captured instead of written to the log file.
 *
 * @returns The lines the probe logged, and a press helper.
 */
const attachCapturing = (): { lines: string[]; press: (event: KeyboardEvent) => void } => {
  const lines: string[] = [];
  detach = attachCaretProbe((message) => lines.push(message));
  lines.length = 0; // drop the attach line so assertions see only the probe
  return {
    lines,
    press: (event: KeyboardEvent) => {
      document.dispatchEvent(event);
    },
  };
};

/**
 * The probe's own summary lines, excluding the derivation's TRACE output — the
 * same sink receives both, and the TRACE lines are the detail behind a refusal.
 *
 * @param lines - Everything the sink received.
 * @returns Only the `[caret-probe]` summary lines.
 */
const summaries = (lines: string[]): string[] =>
  lines.filter((l) => l.startsWith("[caret-probe] "));

describe("attachCaretProbe", () => {
  it("logs the derived caret and its context on F8", () => {
    const write = caretAtEndOf("<p>Hello world</p>", "p");
    stubEditor(write, "Hello world");
    const { lines, press } = attachCapturing();

    press(new KeyboardEvent("keydown", { key: "F8" }));

    const summary = summaries(lines);
    expect(summary).toHaveLength(1);
    expect(summary[0]).toContain('derived={"line":0,"character":11}');
    expect(summary[0]).toContain('ctx="Hello world\u2402"');
    expect(summary[0]).toContain("mdLen=11");
    // The derivation's own trace rides along, which is what makes a refusal
    // diagnosable from a single keypress.
    expect(lines.some((l) => l.includes("RESULT line=0 char=11"))).toBe(true);
  });

  it("logs a null derivation rather than inventing a position", () => {
    // No caret at all, so the derivation must refuse instead of guessing.
    const write = caretAtEndOf("<p>Hello world</p>", "p");
    window.getSelection()?.removeAllRanges();
    stubEditor(write, "Hello world");
    const { lines, press } = attachCapturing();

    press(new KeyboardEvent("keydown", { key: "F8" }));

    const summary = summaries(lines);
    expect(summary).toHaveLength(1);
    expect(summary[0]).toContain("derived=null");
    expect(summary[0]).not.toContain("ctx=");
    // The reason is in the trace, not left implicit.
    expect(lines.some((l) => l.includes("selection bad"))).toBe(true);
  });

  it("names the refusal when there is no editor to probe", () => {
    stubEditor(undefined, "");
    const { lines, press } = attachCapturing();

    press(new KeyboardEvent("keydown", { key: "F8" }));

    expect(summaries(lines)).toEqual(["[caret-probe] no editor/writingArea — nothing to probe"]);
  });

  it("ignores F8 with a modifier held, so it cannot shadow a real shortcut", () => {
    const write = caretAtEndOf("<p>Hello world</p>", "p");
    stubEditor(write, "Hello world");
    const { lines, press } = attachCapturing();

    press(new KeyboardEvent("keydown", { key: "F8", ctrlKey: true }));
    press(new KeyboardEvent("keydown", { key: "F8", shiftKey: true }));

    expect(lines).toEqual([]);
  });

  it("ignores other keys", () => {
    const write = caretAtEndOf("<p>Hello world</p>", "p");
    stubEditor(write, "Hello world");
    const { lines, press } = attachCapturing();

    press(new KeyboardEvent("keydown", { key: "F7" }));
    press(new KeyboardEvent("keydown", { key: "8" }));

    expect(lines).toEqual([]);
  });

  it("stops probing once detached", () => {
    const write = caretAtEndOf("<p>Hello world</p>", "p");
    stubEditor(write, "Hello world");
    const { lines, press } = attachCapturing();

    detach?.();
    detach = undefined;
    press(new KeyboardEvent("keydown", { key: "F8" }));

    expect(lines).toEqual([]);
  });
});
