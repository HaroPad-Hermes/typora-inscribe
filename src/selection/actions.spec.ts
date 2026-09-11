import { describe, expect, it } from "vitest";

import { SELECTION_ACTIONS, buildSelectionMessages, findAction } from "./actions";

describe("SELECTION_ACTIONS", () => {
  it("has unique ids and non-empty labels", () => {
    const ids = SELECTION_ACTIONS.map((action) => action.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(SELECTION_ACTIONS.every((action) => action.label.length > 0)).toBe(true);
  });

  it("forbids the wrappers the document would otherwise swallow", () => {
    // A fenced or quoted answer is inserted verbatim, so every action must say
    // not to produce one.
    for (const action of SELECTION_ACTIONS) {
      expect(action.instruction).toContain("code fences");
      expect(action.instruction).toContain("ONLY the rewritten passage");
    }
  });
});

describe("findAction", () => {
  it("finds by id and returns null for anything else", () => {
    expect(findAction("rewrite")?.label).toBe("Rewrite");
    expect(findAction("nope")).toBeNull();
  });
});

describe("buildSelectionMessages", () => {
  const rewrite = SELECTION_ACTIONS[0]!;

  it("sends the instruction and the passage, in that order", () => {
    const messages = buildSelectionMessages(rewrite, "the cat sat", "");
    expect(messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(messages[0]!.content).toBe(rewrite.instruction);
    expect(messages[1]!.content).toBe("the cat sat");
  });

  it("adds the surrounding block as context when it differs from the passage", () => {
    const messages = buildSelectionMessages(rewrite, "the cat", "the cat sat on the mat");
    expect(messages[1]!.content).toContain("the cat");
    expect(messages[1]!.content).toContain("For context");
    expect(messages[1]!.content).toContain("the cat sat on the mat");
  });

  it("does not repeat the passage as its own context", () => {
    const messages = buildSelectionMessages(rewrite, "the cat", "  the cat  ");
    expect(messages[1]!.content).toBe("the cat");
  });
});
