import { afterEach, describe, expect, it, vi } from "vitest";

import type { SelectionAction } from "../selection/actions";
import { SELECTION_PRESETS } from "../selection/actions";

import { SELECTION_MENU_CLASS, attachSelectionMenu } from "./selection-menu";

const RECT = { left: 100, top: 200, width: 80, height: 18 };
const SELECTION = { text: "the cat sat", rect: RECT, block: null };

const PRESETS: SelectionAction[] = [
  { id: "rephrase", label: "Rephrase", short: "Rephrase", instruction: "Rephrase it." },
  { id: "shorten", label: "Shorten a lot", short: "Shorten", instruction: "Shorten it." },
];

/**
 * The bar currently in the document, if any.
 *
 * @returns The bar element, or null.
 */
const bar = (): HTMLElement | null => document.querySelector(`.${SELECTION_MENU_CLASS}`);

/**
 * Attach a bar over the presets, with a spy for the run handler.
 *
 * @param overrides - Options to override.
 * @returns The remover and the spy.
 */
function attach(overrides: Record<string, unknown> = {}) {
  const onRun = vi.fn();
  const remove = attachSelectionMenu({
    selection: SELECTION,
    presets: PRESETS,
    onRun,
    ...overrides,
  });
  return { onRun, remove };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("attachSelectionMenu", () => {
  it("offers a button per preset, an ask field and a thinking toggle", () => {
    attach();
    const buttons = Array.from(bar()!.querySelectorAll(`.${SELECTION_MENU_CLASS}-action`));
    expect(buttons.map((b) => b.getAttribute("data-action"))).toEqual([
      "rephrase",
      "shorten",
      null,
    ]);
    expect(buttons[0]!.textContent).toBe("Rephrase");
    expect(buttons[0]!.title).toBe("Rephrase");
    expect(bar()!.querySelector(`.${SELECTION_MENU_CLASS}-input`)).not.toBeNull();
    expect(bar()!.querySelector("[data-role='thinking']")).not.toBeNull();
    expect(bar()!.querySelectorAll(`.${SELECTION_MENU_CLASS}-divider`)).toHaveLength(2);
  });

  it("runs the preset's instruction, then closes", () => {
    const { onRun } = attach();
    bar()!.querySelector<HTMLButtonElement>("[data-action='shorten']")!.click();
    expect(onRun).toHaveBeenCalledWith("Shorten it.", false);
    expect(bar()).toBeNull();
  });

  it("runs what the user typed, then closes", () => {
    const { onRun } = attach();
    const input = bar()!.querySelector<HTMLInputElement>(`.${SELECTION_MENU_CLASS}-input`)!;
    input.value = "make it sound Swedish";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(onRun).toHaveBeenCalledWith("make it sound Swedish", false);
    expect(bar()).toBeNull();
  });

  it("ignores an empty ask", () => {
    const { onRun } = attach();
    const input = bar()!.querySelector<HTMLInputElement>(`.${SELECTION_MENU_CLASS}-input`)!;
    input.value = "   ";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(onRun).not.toHaveBeenCalled();
    expect(bar()).not.toBeNull();
  });

  it("passes the thinking toggle's state to the run", () => {
    const { onRun } = attach({ thinking: false });
    const think = bar()!.querySelector<HTMLButtonElement>("[data-role='thinking']")!;
    expect(think.title).toContain("OFF");
    think.click();
    expect(think.title).toContain("ON");
    bar()!.querySelector<HTMLButtonElement>("[data-action='rephrase']")!.click();
    expect(onRun).toHaveBeenCalledWith("Rephrase it.", true);
  });

  it("starts the toggle where the setting is, so its state is never a lie", () => {
    attach({ thinking: true });
    expect(bar()!.querySelector("[data-role='thinking']")!.className).toContain("think-on");
  });

  it("defaults the bar's own mousedown away, keeping the selection alive", () => {
    attach();
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    bar()!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("dismisses on Escape, on a save, and on a click outside", () => {
    attach();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(bar()).toBeNull();

    attach();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true }));
    expect(bar()).toBeNull();

    attach();
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(bar()).toBeNull();
  });

  it("refuses an anchor with no measurable rect rather than pinning to a corner", () => {
    const remove = attachSelectionMenu({
      selection: { ...SELECTION, rect: { left: 0, top: 0, width: 0, height: 0 } },
      presets: PRESETS,
      onRun: vi.fn(),
    });
    expect(remove).toBeNull();
  });

  it("offers the shipping preset list", () => {
    expect(SELECTION_PRESETS.map((preset) => preset.id)).toEqual([
      "rephrase",
      "shorten",
      "expand",
      "formal",
      "grammar",
      "latex",
    ]);
  });
});
