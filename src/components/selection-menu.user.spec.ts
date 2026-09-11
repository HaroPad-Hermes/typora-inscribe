import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SelectionAction } from "../selection/actions";

import { SELECTION_MENU_CLASS, attachSelectionMenu } from "./selection-menu";

/**
 * The bar driven by REAL event sequences.
 *
 * The other spec fires single events by hand, which is why three interaction
 * defects reached the user: a hand-fired `mousedown` says nothing about the
 * pointerdown → mousedown → focus → mouseup → click order a browser actually
 * sends, and nothing at all about focus. `user-event` sends the sequence, so a
 * listener that only works when events arrive in the order this file's author
 * imagined now fails.
 */

const SELECTION = {
  text: "the cat sat",
  rect: { left: 100, top: 200, width: 80, height: 18 },
  block: null,
};

const PRESETS: SelectionAction[] = [
  {
    id: "rephrase",
    icon: "wand-2",
    glyph: "↻",
    label: "Rephrase",
    short: "Rephrase",
    instruction: "Rephrase it.",
  },
];

const bar = (): HTMLElement | null => document.querySelector(`.${SELECTION_MENU_CLASS}`);

afterEach(() => {
  document.body.innerHTML = "";
});

describe("attachSelectionMenu (real event sequences)", () => {
  it("runs a preset on a real click and keeps the bar up", async () => {
    const onRun = vi.fn();
    attachSelectionMenu({ selection: SELECTION, presets: PRESETS, onRun });
    const user = userEvent.setup();
    await user.click(bar()!.querySelector<HTMLButtonElement>("[data-action='rephrase']")!);
    expect(onRun).toHaveBeenCalledWith("Rephrase it.", false);
    expect(bar()).not.toBeNull();
  });

  it("runs a typed instruction on Enter, with the field focused by the click", async () => {
    const onRun = vi.fn();
    attachSelectionMenu({ selection: SELECTION, presets: PRESETS, onRun });
    const user = userEvent.setup();
    const input = bar()!.querySelector<HTMLInputElement>(`.${SELECTION_MENU_CLASS}-input`)!;
    await user.click(input);
    expect(document.activeElement).toBe(input);
    await user.keyboard("make it shorter{Enter}");
    expect(onRun).toHaveBeenCalledWith("make it shorter", false);
  });

  it("dismisses on a real click outside, and not on one inside", async () => {
    attachSelectionMenu({ selection: SELECTION, presets: PRESETS, onRun: vi.fn() });
    const user = userEvent.setup();

    await user.click(bar()!.querySelector(`.${SELECTION_MENU_CLASS}-divider`)!);
    expect(bar()).not.toBeNull();

    await user.click(document.body);
    expect(bar()).toBeNull();
  });

  it("dismisses on a real Escape", async () => {
    attachSelectionMenu({ selection: SELECTION, presets: PRESETS, onRun: vi.fn() });
    const user = userEvent.setup();
    await user.keyboard("{Escape}");
    expect(bar()).toBeNull();
  });

  it("does not run a second action while one is in flight", async () => {
    const onRun = vi.fn();
    attachSelectionMenu({ selection: SELECTION, presets: PRESETS, onRun });
    const user = userEvent.setup();
    const button = bar()!.querySelector<HTMLButtonElement>("[data-action='rephrase']")!;
    await user.click(button);
    await user.click(button);
    expect(onRun).toHaveBeenCalledTimes(1);
  });
});
