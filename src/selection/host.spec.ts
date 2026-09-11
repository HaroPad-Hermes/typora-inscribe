import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { attachSelectionActions } from "./host";

/**
 * `patches/typora` defines `Files` with `Object.defineProperty` and no
 * `configurable`, so the global cannot be replaced — only its members can.
 */
const files = Files as unknown as {
  editor: unknown;
  reloadContent: (markdown: string, options?: unknown) => void;
  useCRLF: boolean;
};

/** What the fake editor recorded. */
interface Recorder {
  applied: string | null;
  reloads: number;
}

/**
 * A fake `Files` whose editor is real DOM and whose writes are recorded.
 *
 * The bundle gets these globals from Typora; a spec has to plant them, which is
 * also the only way to drive the flow end to end without an editor or a request.
 *
 * @param markdown - The document the fake editor reports.
 * @param recorder - Where to record applies.
 */
function fakeFiles(markdown: string, recorder: Recorder): void {
  const writingArea = document.getElementById("write")!;
  files.useCRLF = false;
  files.editor = {
    writingArea,
    getMarkdown: () => markdown,
    refocus: vi.fn(),
    sourceView: { gotoLine: vi.fn() },
  };
  files.reloadContent = (next: string) => {
    recorder.applied = next;
    recorder.reloads += 1;
  };
}

/**
 * Select `start..end` characters inside `selector`.
 *
 * @param selector - Element holding the text.
 * @param start - Start offset.
 * @param end - End offset.
 */
function select(selector: string, start: number, end: number): void {
  const node = document.querySelector(selector)!.firstChild!;
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  // The harness owns two Window objects and `document.defaultView !== window`,
  // so put the range on both: the module reads `window.getSelection()`.
  for (const selection of [document.getSelection(), window.getSelection()]) {
    if (!selection) continue;
    selection.removeAllRanges();
    selection.addRange(range);
  }
}

const ANSWER = "the cat sat down.";

beforeAll(() => {
  // The harness owns two Window objects and the module reads the global one,
  // which holds no selection. Point it at the document's.
  window.getSelection = () => document.getSelection();
  // happy-dom lays nothing out, so every range measures 0x0 — and the menu
  // correctly refuses an unmeasurable anchor. Stub the measurement rather than
  // weaken the refusal.
  Range.prototype.getBoundingClientRect = () =>
    ({
      left: 100,
      top: 200,
      width: 40,
      height: 20,
      right: 140,
      bottom: 220,
      x: 100,
      y: 200,
      toJSON: () => ({}),
    }) as DOMRect;
});

beforeAll(() => {
  // happy-dom lays nothing out, so every range measures 0x0 — and the menu
  // correctly refuses an unmeasurable anchor. Stub the measurement rather than
  // weaken the refusal.
  Range.prototype.getBoundingClientRect = () =>
    ({
      left: 100,
      top: 200,
      width: 40,
      height: 20,
      right: 140,
      bottom: 220,
      x: 100,
      y: 200,
      toJSON: () => ({}),
    }) as DOMRect;
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("attachSelectionActions (end to end, fake editor)", () => {
  it("offers the menu, previews the answer, and only writes on Accept", async () => {
    const recorder: Recorder = { applied: null, reloads: 0 };
    // The body first: the fake editor reads its writing area from the document.
    document.body.innerHTML = `<div id="write"><p>the cat sat on the mat</p></div>`;
    fakeFiles("the cat sat on the mat\n", recorder);

    const detach = attachSelectionActions({ generate: () => Promise.resolve(ANSWER) });
    select("p", 0, 7); // "the cat"
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

    // The bar is debounced (350ms) so it never chases the drag.
    await vi.waitFor(
      () => {
        expect(document.querySelector(".inscribe-selection-menu")).not.toBeNull();
      },
      { timeout: 2000 },
    );
    const menu = document.querySelector(".inscribe-selection-menu")!;
    const rewrite = menu.querySelector<HTMLButtonElement>("[data-action='rephrase']");
    expect(rewrite).not.toBeNull();

    // Nothing is written while the model is answering, or before consent.
    rewrite!.click();
    expect(recorder.reloads).toBe(0);

    await vi.waitFor(() => {
      expect(document.querySelector(".inscribe-selection-preview")).not.toBeNull();
    });
    expect(recorder.reloads).toBe(0);
    expect(document.querySelector(".inscribe-selection-preview-after")?.textContent).toBe(ANSWER);

    document
      .querySelector<HTMLButtonElement>(".inscribe-selection-preview [data-role='accept']")!
      .click();
    expect(recorder.reloads).toBe(1);
    // The space after "cat" is NOT part of the selection, so it survives.
    expect(recorder.applied).toBe("the cat sat down. sat on the mat\n");
    detach();
  });

  it("changes nothing when the preview is cancelled", async () => {
    const recorder: Recorder = { applied: null, reloads: 0 };
    // The body first: the fake editor reads its writing area from the document.
    document.body.innerHTML = `<div id="write"><p>the cat sat on the mat</p></div>`;
    fakeFiles("the cat sat on the mat\n", recorder);

    const detach = attachSelectionActions({ generate: () => Promise.resolve(ANSWER) });
    select("p", 0, 7);
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    await vi.waitFor(
      () => {
        expect(document.querySelector("[data-action='rephrase']")).not.toBeNull();
      },
      { timeout: 2000 },
    );
    document.querySelector<HTMLButtonElement>("[data-action='rephrase']")!.click();
    await vi.waitFor(() => {
      expect(document.querySelector(".inscribe-selection-preview")).not.toBeNull();
    });

    document
      .querySelector<HTMLButtonElement>(".inscribe-selection-preview [data-role='cancel']")!
      .click();
    expect(recorder.applied).toBeNull();
    expect(recorder.reloads).toBe(0);
    detach();
  });

  it("survives a click that collapses the selection, and still edits the captured span", async () => {
    // The live report: clicking the bar's own field collapses the document
    // selection (Typora's live-preview selection IS the DOM selection), the bar
    // retired itself, and nothing on screen said what would be replaced. The
    // harness has to collapse it by hand — happy-dom has no focus semantics.
    const recorder: Recorder = { applied: null, reloads: 0 };
    document.body.innerHTML = `<div id="write"><p>the cat sat on the mat</p></div>`;
    fakeFiles("the cat sat on the mat\n", recorder);
    const detach = attachSelectionActions({ generate: () => Promise.resolve(ANSWER) });

    select("p", 0, 7);
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    await vi.waitFor(
      () => {
        expect(document.querySelector(".inscribe-selection-menu")).not.toBeNull();
      },
      { timeout: 2000 },
    );

    for (const selection of [document.getSelection(), window.getSelection()]) {
      selection?.removeAllRanges();
    }
    document.dispatchEvent(new Event("selectionchange"));
    await new Promise((resolve) => setTimeout(resolve, 450));

    // The bar survives a collapse it caused itself...
    expect(document.querySelector(".inscribe-selection-menu")).not.toBeNull();

    document.querySelector<HTMLButtonElement>("[data-action='rephrase']")!.click();
    await vi.waitFor(
      () => {
        expect(document.querySelector(".inscribe-selection-preview")).not.toBeNull();
      },
      { timeout: 2000 },
    );
    document
      .querySelector<HTMLButtonElement>(".inscribe-selection-preview [data-role='accept']")!
      .click();

    // ...and the edit lands on the span captured when it opened, not on a
    // selection that no longer exists.
    expect(recorder.applied).toBe("the cat sat down. sat on the mat\n");
    detach();
  });

  it("refuses a selection it cannot map instead of guessing a range", async () => {
    // A fence's caret lives in CodeMirror, so this is the refusal the fence path
    // produces — and the whole point is that no preview and no write follow.
    const recorder: Recorder = { applied: null, reloads: 0 };
    document.body.innerHTML = `<div id="write"><div class="CodeMirror"><p>def add</p></div></div>`;
    fakeFiles("x\n", recorder);

    const detach = attachSelectionActions({ generate: () => Promise.resolve(ANSWER) });
    select("p", 0, 3);
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    await vi.waitFor(
      () => {
        expect(document.querySelector("[data-action='rephrase']")).not.toBeNull();
      },
      { timeout: 2000 },
    );
    document.querySelector<HTMLButtonElement>("[data-action='rephrase']")!.click();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(document.querySelector(".inscribe-selection-preview")).toBeNull();
    expect(recorder.reloads).toBe(0);
    detach();
  });
});
