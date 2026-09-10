import { describe, expect, it, vi } from "vitest";

import { GHOST_OPACITY, attachInlineGhost } from "./inline-ghost";

/**
 * Render `html` and leave the caret at the very end of the `id` element's text.
 *
 * The range must be anchored INSIDE the text node at a character offset; an
 * element-boundary range (`selectNodeContents` + collapse) does not survive
 * happy-dom's selection round-trip and the module sees no caret at all.
 *
 * @param html - Markup to place in the document body.
 * @param id - Id of the element the caret should sit inside.
 * @returns The element the caret was placed in.
 */
const caretAtEndOf = (html: string, id: string): HTMLElement => {
  const doc = window.document;
  doc.body.innerHTML = html;
  const host = doc.getElementById(id)!;
  const textNode = host.firstChild as Text;
  const range = doc.createRange();
  range.setStart(textNode, textNode.textContent.length);
  range.collapse(true);
  const selection = doc.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return host;
};

describe("attachInlineGhost", () => {
  it("inserts the completion at the caret as a dimmed, non-editable span", () => {
    const host = caretAtEndOf("<p id='p'>A block tha</p>", "p");
    attachInlineGhost("t cannot be mapped.");

    const ghost = host.querySelector(".inscribe-ghost");
    expect(ghost).not.toBeNull();
    expect(ghost!.textContent).toBe("t cannot be mapped.");
    expect(ghost!.getAttribute("contenteditable")).toBe("false");
    expect(Number(ghost!.style.opacity)).toBeLessThan(1);
    expect(GHOST_OPACITY).toBe(ghost!.style.opacity);
  });

  it("reflows the paragraph instead of hiding it", () => {
    // The whole point of the inline ghost: existing text is ADDED to, never
    // covered. This is what the out-of-document panel could not do.
    const host = caretAtEndOf("<p id='p'>A block tha</p>", "p");
    attachInlineGhost("t cannot be mapped.");
    expect(host.textContent).toBe("A block that cannot be mapped.");
  });

  it("removes the ghost when the returned function is called", () => {
    const host = caretAtEndOf("<p id='p'>A block tha</p>", "p");
    attachInlineGhost("t cannot be mapped.")();
    expect(host.querySelector(".inscribe-ghost")).toBeNull();
    expect(host.textContent).toBe("A block tha");
  });

  it("is safe to remove twice", () => {
    const host = caretAtEndOf("<p id='p'>A block tha</p>", "p");
    const remove = attachInlineGhost("t cannot be mapped.");
    remove();
    expect(() => remove()).not.toThrow();
    expect(host.textContent).toBe("A block tha");
  });

  it("dismisses on Escape and reports it", () => {
    const onDismiss = vi.fn();
    const host = caretAtEndOf("<p id='p'>A block tha</p>", "p");
    attachInlineGhost("t cannot be mapped.", { onDismiss });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(host.querySelector(".inscribe-ghost")).toBeNull();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("drops the ghost on Ctrl+S, before a save could write it into the file", () => {
    const onDismiss = vi.fn();
    const host = caretAtEndOf("<p id='p'>A block tha</p>", "p");
    attachInlineGhost("t cannot be mapped.", { onDismiss });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true }));

    expect(host.querySelector(".inscribe-ghost")).toBeNull();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("dismisses when the window loses focus", () => {
    const onDismiss = vi.fn();
    const host = caretAtEndOf("<p id='p'>A block tha</p>", "p");
    attachInlineGhost("t cannot be mapped.", { onDismiss });

    window.dispatchEvent(new Event("blur"));

    expect(host.querySelector(".inscribe-ghost")).toBeNull();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("ignores unrelated keys", () => {
    const onDismiss = vi.fn();
    const host = caretAtEndOf("<p id='p'>A block tha</p>", "p");
    attachInlineGhost("t cannot be mapped.", { onDismiss });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));

    expect(host.querySelector(".inscribe-ghost")).not.toBeNull();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("does not fire onDismiss when removed directly", () => {
    const onDismiss = vi.fn();
    caretAtEndOf("<p id='p'>A block tha</p>", "p");
    attachInlineGhost("t cannot be mapped.", { onDismiss })();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("is a no-op when there is no caret", () => {
    document.body.innerHTML = "<p id='p'>no selection here</p>";
    window.getSelection()?.removeAllRanges();

    const remove = attachInlineGhost("x");
    expect(() => remove()).not.toThrow();
    expect(document.querySelector(".inscribe-ghost")).toBeNull();
  });
});
