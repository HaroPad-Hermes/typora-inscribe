import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SelectedText, SelectionRect } from "../selection/selection";

import { SELECTION_MENU_CLASS, attachSelectionMenu } from "./selection-menu";

/**
 * A selection with the given rect; the text is irrelevant to placement.
 *
 * @param rect - The rect the menu should anchor to.
 * @returns A selection carrying that rect.
 */
function selectionAt(rect: SelectionRect): SelectedText {
  return { block: null, rect, text: "brave world" };
}

const CENTRED = selectionAt({ height: 18, left: 100, top: 200, width: 80 });

/**
 * Two actions, so ordering and wiring can both be asserted.
 *
 * @param spy - Sink for the action that gets chosen.
 * @returns The action list.
 */
function actions(spy: (s: SelectedText) => void = () => {}) {
  return [
    { id: "explain", label: "Explain", onSelect: spy },
    { id: "rewrite", label: "Rewrite", onSelect: spy },
  ];
}

/**
 * The window the document actually belongs to.
 *
 * The test harness installs a second `Window` over the global `window`, so
 * `document.defaultView !== window` here. Production has one window; this keeps
 * the spec dispatching on the one the menu listened to.
 *
 * @returns The document's own window.
 */
const ownerWindow = (): Window => document.defaultView!;

const menuIn = (): HTMLElement | null => document.querySelector(`.${SELECTION_MENU_CLASS}`);

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("attachSelectionMenu", () => {
  it("offers one button per action, in order", () => {
    attachSelectionMenu({ actions: actions(), selection: CENTRED });
    const buttons = Array.from(document.querySelectorAll(`.${SELECTION_MENU_CLASS}-action`));
    expect(buttons.map((b) => b.textContent)).toEqual(["Explain", "Rewrite"]);
    expect(buttons.map((b) => (b as HTMLElement).dataset.action)).toEqual(["explain", "rewrite"]);
  });

  it("refuses to attach when the selection has no measurable box", () => {
    const detach = attachSelectionMenu({
      actions: actions(),
      selection: selectionAt({ height: 0, left: 0, top: 0, width: 0 }),
    });
    expect(detach).toBeNull();
    expect(menuIn()).toBeNull();
  });

  it("anchors above the selection when there is room", () => {
    attachSelectionMenu({ actions: actions(), selection: CENTRED });
    const menu = menuIn()!;
    expect(menu.style.top).toBe("162px"); // 200 - 32 (fallback height) - 6
    expect(menu.style.top < `${CENTRED.rect.top}px`).toBe(true);
  });

  it("flips below the selection when the top edge has no room", () => {
    attachSelectionMenu({
      actions: actions(),
      selection: selectionAt({ height: 18, left: 60, top: 2, width: 80 }),
    });
    // 2 + 18 + 6 — below rather than clamped onto the selection itself.
    expect(menuIn()!.style.top).toBe("26px");
  });

  it("clamps to the left margin instead of overflowing the viewport", () => {
    attachSelectionMenu({
      actions: actions(),
      selection: selectionAt({ height: 18, left: 0, top: 200, width: 80 }),
    });
    expect(menuIn()!.style.left).toBe("8px");
  });

  it("clamps to the right edge instead of overflowing the viewport", () => {
    attachSelectionMenu({
      actions: actions(),
      selection: selectionAt({ height: 18, left: 5000, top: 200, width: 80 }),
    });
    // 1024 (happy-dom's default width) - 200 (fallback) - 8
    expect(menuIn()!.style.left).toBe("816px");
  });

  it("runs the action for the selection it was opened for, then closes", () => {
    const spy = vi.fn();
    attachSelectionMenu({ actions: actions(spy), selection: CENTRED });
    document.querySelector<HTMLButtonElement>('[data-action="rewrite"]')!.click();
    expect(spy).toHaveBeenCalledExactlyOnceWith(CENTRED);
    expect(menuIn()).toBeNull();
  });

  it("keeps the selection alive by defaulting the button's mousedown away", () => {
    attachSelectionMenu({ actions: actions(), selection: CENTRED });
    const button = document.querySelector<HTMLButtonElement>(`[data-action="explain"]`)!;
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(menuIn()).not.toBeNull();
  });

  it("closes on Escape", () => {
    attachSelectionMenu({ actions: actions(), selection: CENTRED });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(menuIn()).toBeNull();
  });

  it("closes on a save, so plugin UI is never up across Ctrl+S", () => {
    attachSelectionMenu({ actions: actions(), selection: CENTRED });
    document.dispatchEvent(new KeyboardEvent("keydown", { ctrlKey: true, key: "s" }));
    expect(menuIn()).toBeNull();
  });

  it("closes on a mousedown outside it", () => {
    attachSelectionMenu({ actions: actions(), selection: CENTRED });
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(menuIn()).toBeNull();
  });

  it("closes on scroll rather than drifting away from the text it acts on", () => {
    attachSelectionMenu({ actions: actions(), selection: CENTRED });
    ownerWindow().dispatchEvent(new Event("scroll"));
    expect(menuIn()).toBeNull();
  });

  it("closes on window blur", () => {
    attachSelectionMenu({ actions: actions(), selection: CENTRED });
    ownerWindow().dispatchEvent(new Event("blur"));
    expect(menuIn()).toBeNull();
  });

  it("detaches idempotently and leaves no listeners behind", () => {
    const detach = attachSelectionMenu({ actions: actions(), selection: CENTRED })!;
    detach();
    expect(menuIn()).toBeNull();
    expect(() => detach()).not.toThrow();
    // A second Escape must not throw once the listeners are gone.
    expect(() =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    ).not.toThrow();
  });
});
