import { afterEach, describe, expect, it, vi } from "vitest";

import type { SelectionAction } from "../selection/actions";
import { SELECTION_PRESETS } from "../selection/actions";

import { SELECTION_MENU_CLASS, attachSelectionMenu } from "./selection-menu";

const RECT = { left: 100, top: 200, width: 80, height: 18 };
const SELECTION = { text: "the cat sat", rect: RECT, block: null };

const PRESETS: SelectionAction[] = [
  { id: "rephrase", glyph: "↻", label: "Rephrase", short: "Rephrase", instruction: "Rephrase it." },
  {
    id: "shorten",
    glyph: "↓",
    label: "Shorten a lot",
    short: "Shorten",
    instruction: "Shorten it.",
  },
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
    // The reference's lucide icon in the bar, the full name on hover.
    expect(buttons[0]!.querySelector("svg")).not.toBeNull();
    expect(buttons[0]!.title).toBe("Rephrase");
    expect(bar()!.querySelector(`.${SELECTION_MENU_CLASS}-input`)).not.toBeNull();
    expect(bar()!.querySelector("[data-role='thinking'] svg")).not.toBeNull();
    expect(bar()!.querySelectorAll(`.${SELECTION_MENU_CLASS}-divider`)).toHaveLength(2);
  });

  it("runs the preset's instruction and KEEPS the bar up while the model works", () => {
    // It is the only thing on screen saying a request is in flight; the caller
    // takes it down once there is a result to show.
    const { onRun } = attach();
    bar()!.querySelector<HTMLButtonElement>("[data-action='shorten']")!.click();
    expect(onRun).toHaveBeenCalledWith("Shorten it.", false);
    expect(bar()).not.toBeNull();
    expect(bar()!.className).toContain("busy");
    expect(bar()!.querySelector<HTMLButtonElement>("[data-action='rephrase']")!.disabled).toBe(
      true,
    );
  });

  it("runs what the user typed and keeps the bar up", () => {
    const { onRun } = attach();
    const input = bar()!.querySelector<HTMLInputElement>(`.${SELECTION_MENU_CLASS}-input`)!;
    input.value = "make it sound Swedish";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(onRun).toHaveBeenCalledWith("make it sound Swedish", false);
    expect(bar()).not.toBeNull();
  });

  it("refuses a second run while one is in flight", () => {
    const { onRun } = attach();
    bar()!.querySelector<HTMLButtonElement>("[data-action='shorten']")!.click();
    bar()!.querySelector<HTMLButtonElement>("[data-action='rephrase']")!.click();
    expect(onRun).toHaveBeenCalledTimes(1);
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

  it("draws nothing over the selection until something takes focus", () => {
    // The native highlight is still on screen while the bar opens; a second
    // overlay on top of it is just noise.
    const domRange = {
      getClientRects: () => [{ height: 18, left: 10, top: 20, width: 100 }],
    } as unknown as Range;
    attach({ domRange });
    expect(document.querySelector(".inscribe-selection-mirror")).toBeNull();

    const input = bar()!.querySelector<HTMLInputElement>(`.${SELECTION_MENU_CLASS}-input`)!;
    input.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(document.querySelector(".inscribe-selection-mirror")).not.toBeNull();
  });

  it("takes the stand-in away with the bar", () => {
    const domRange = {
      getClientRects: () => [{ height: 18, left: 10, top: 20, width: 100 }],
    } as unknown as Range;
    const { remove: removeBar } = attach({ domRange });
    bar()!
      .querySelector<HTMLInputElement>(`.${SELECTION_MENU_CLASS}-input`)!
      .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(document.querySelector(".inscribe-selection-mirror")).not.toBeNull();
    removeBar!.remove();
    expect(document.querySelector(".inscribe-selection-mirror")).toBeNull();
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
