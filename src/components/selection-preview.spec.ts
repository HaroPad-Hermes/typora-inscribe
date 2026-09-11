import { afterEach, describe, expect, it, vi } from "vitest";

import { EDIT_PREVIEW_CLASS, attachEditPreview } from "./selection-preview";

const rect = { left: 100, top: 200, width: 40, height: 20 };

/**
 * The panel currently in the document, if any.
 *
 * @returns The panel element, or null.
 */
const panel = (): HTMLElement | null => document.querySelector(`.${EDIT_PREVIEW_CLASS}`);

/**
 * Attach a preview with spies.
 *
 * @param overrides - Options to override.
 * @returns The remover and the accept spy.
 */
function attach(overrides: Record<string, unknown> = {}) {
  const onAccept = vi.fn();
  const remove = attachEditPreview({
    rect,
    title: "Rewrite",
    passage: "the cat sat",
    replacement: "the cat sat down",
    onAccept,
    ...overrides,
  });
  return { onAccept, remove };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("attachEditPreview", () => {
  it("shows what would be removed and what would replace it", () => {
    attach();
    expect(panel()?.querySelector(`.${EDIT_PREVIEW_CLASS}-before`)?.textContent).toBe(
      "the cat sat",
    );
    expect(panel()?.querySelector(`.${EDIT_PREVIEW_CLASS}-after`)?.textContent).toBe(
      "the cat sat down",
    );
  });

  it("applies nothing until Accept", () => {
    const { onAccept } = attach();
    panel()!.querySelector<HTMLButtonElement>("[data-role='cancel']")!.click();
    expect(onAccept).not.toHaveBeenCalled();
    expect(panel()).toBeNull();
  });

  it("accepts once, and closes the panel first", () => {
    // The panel is removed BEFORE the handler runs: the handler reloads the
    // document, and plugin UI must not be in flight across that.
    const removed: boolean[] = [];
    const mine = vi.fn(() => removed.push(panel() === null));
    attach({ onAccept: mine });
    panel()!.querySelector<HTMLButtonElement>("[data-role='accept']")!.click();
    expect(mine).toHaveBeenCalledTimes(1);
    expect(removed).toEqual([true]);
  });

  it("dismisses on Escape without accepting", () => {
    const { onAccept } = attach();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(panel()).toBeNull();
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("dismisses on a save, so nothing overlaps the document being written", () => {
    const { onAccept } = attach();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true }));
    expect(panel()).toBeNull();
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("dismisses on an outside click but not on one inside itself", () => {
    attach();
    const inside = panel()!.querySelector(`.${EDIT_PREVIEW_CLASS}-after`)!;
    inside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(panel()).not.toBeNull();

    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(panel()).toBeNull();
  });

  it("dismisses on scroll of its own window", () => {
    // The harness owns two Window objects, so the event must go on
    // `document.defaultView` — the one the module listens to.
    attach();
    document.defaultView!.dispatchEvent(new Event("scroll"));
    expect(panel()).toBeNull();
  });

  it("refuses an anchor with no measurable rect rather than pinning to a corner", () => {
    const remove = attachEditPreview({
      rect: { left: 0, top: 0, width: 0, height: 0 },
      title: "Rewrite",
      passage: "a",
      replacement: "b",
      onAccept: vi.fn(),
    });
    expect(remove).toBeNull();
    expect(panel()).toBeNull();
  });

  it("removes its listeners when the caller tears it down", () => {
    const { remove } = attach();
    remove!();
    expect(panel()).toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(panel()).toBeNull();
  });
});
