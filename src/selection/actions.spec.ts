import { describe, expect, it } from "vitest";

import {
  CONTEXT_LIMIT,
  REWRITE_SYSTEM_PROMPT,
  SELECTION_PRESETS,
  buildRewriteMessages,
  findPreset,
} from "./actions";

describe("SELECTION_PRESETS", () => {
  it("carries the reference implementation's six operations", () => {
    expect(SELECTION_PRESETS.map((preset) => preset.id)).toEqual([
      "rephrase",
      "shorten",
      "expand",
      "formal",
      "grammar",
      "latex",
    ]);
  });

  it("has unique ids, a compact bar label and a full tooltip label", () => {
    const ids = SELECTION_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of SELECTION_PRESETS) {
      expect(preset.short.length).toBeGreaterThan(0);
      expect(preset.short.length).toBeLessThanOrEqual(10);
      expect(preset.icon.length).toBeGreaterThan(0);
      expect(preset.glyph.length).toBeGreaterThan(0);
      expect(preset.glyph.length).toBeLessThanOrEqual(2);
      expect(preset.label.length).toBeGreaterThan(preset.glyph.length);
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.instruction.length).toBeGreaterThan(10);
    }
  });
});

describe("findPreset", () => {
  it("finds by id and returns null for anything else", () => {
    expect(findPreset("grammar")?.label).toBe("Fix grammar and spelling");
    expect(findPreset("nope")).toBeNull();
  });
});

describe("buildRewriteMessages", () => {
  const request = {
    instruction: "Shorten it.",
    selection: "the cat sat on the mat",
    before: "Intro paragraph.\n",
    after: "\nClosing sentence.",
  };

  it("marks the selection and tags its neighbours, so the model knows what to rewrite", () => {
    // The reference shape. An earlier port repeated the passage as its own
    // "context" instead; that shape made the model reason without bound and
    // return empty content.
    const [system, user] = buildRewriteMessages(request);
    expect(system!.role).toBe("system");
    expect(user!.content).toContain("Instruction: Shorten it.");
    expect(user!.content).toContain("<context_before>");
    expect(user!.content).toContain("Intro paragraph.");
    expect(user!.content).toContain("</context_before>");
    expect(user!.content).toContain("<selected>\nthe cat sat on the mat\n</selected>");
    expect(user!.content).toContain("<context_after>");
    expect(user!.content).toContain("Closing sentence.");
    expect(user!.content).toContain("</context_after>");
  });

  it("emits empty context tags rather than dropping them", () => {
    const [, user] = buildRewriteMessages({ ...request, before: "", after: "" });
    expect(user!.content).toContain("<context_before></context_before>");
    expect(user!.content).toContain("<context_after></context_after>");
  });

  it("caps the context it carries on each side", () => {
    const long = "x".repeat(CONTEXT_LIMIT * 2);
    const [, user] = buildRewriteMessages({ ...request, before: long, after: long });
    const before = /<context_before>\n([\s\S]*?)\n<\/context_before>/.exec(user!.content)![1]!;
    expect(before.length).toBe(CONTEXT_LIMIT);
  });

  it("keeps the output rules that stop a rewrite becoming a conversation", () => {
    expect(REWRITE_SYSTEM_PROMPT).toContain("Output ONLY the rewritten text");
    expect(REWRITE_SYSTEM_PROMPT).toContain("no explanations, no meta-text, no markers");
    expect(REWRITE_SYSTEM_PROMPT).toContain("Preserve markdown formatting");
  });
});
