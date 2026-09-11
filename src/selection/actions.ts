/**
 * Selection actions: the presets, and the request they build.
 *
 * Modelled on the reference implementation (`obsidian-inscribe`), prompt shape
 * and preset list included, because the rewrites are only as robust as the
 * request. Three parts of that request each carry a lesson this port learned the
 * hard way:
 *
 *   - The selected text is MARKED (`<selected>`) and its neighbours are tagged
 *     context (`<context_before>` / `<context_after>`). An earlier version of
 *     this file repeated the passage under a "For context, it sits in:" heading
 *     instead; measured live, that shape made the model reason without bound and
 *     return EMPTY content.
 *   - `thinking` is disabled by default. DeepSeek V4 Flash with reasoning on
 *     spends its whole budget thinking on harder passages and returns nothing
 *     (`finish_reason: "length"`, content `""`) — budget-dependent, which is why
 *     easy rewrites worked and difficult ones quietly did not.
 *   - The budget is 4000 tokens, because reasoning tokens count against it.
 */

import type { ChatMessage } from "../providers/provider";

export interface SelectionAction {
  /** Stable identifier, used for the button's `data-action`. */
  id: string;
  /** Full label: the button's tooltip, and its name in settings. */
  label: string;
  /** Compact label, for logs and settings. */
  short: string;
  /** The lucide icon the bar draws; the full `label` is its hover tooltip. */
  icon: string;
  /**
   * Text fallback if the icon set ever lacks the name.
   * Six words made the bar wide enough to cover the text it acts on, which is
   * worse than a symbol a user has to hover once.
   */
  glyph: string;
  /** The instruction sent to the model. */
  instruction: string;
}

/** The preset operations, verbatim from the reference implementation. */
export const SELECTION_PRESETS: SelectionAction[] = [
  {
    id: "rephrase",
    icon: "wand-2",
    glyph: "↻",
    short: "Rephrase",
    label: "Rephrase",
    instruction:
      "Rephrase the selected text while keeping its meaning and style consistent with the surrounding text.",
  },
  {
    id: "shorten",
    icon: "minimize-2",
    glyph: "↓",
    short: "Shorten",
    label: "Shorten",
    instruction:
      "Shorten the selected text, keeping the essential meaning. Aim for roughly half the length.",
  },
  {
    id: "expand",
    icon: "maximize-2",
    glyph: "↑",
    short: "Expand",
    label: "Expand",
    instruction:
      "Expand the selected text with more detail and depth, keeping the same style and tone.",
  },
  {
    id: "formal",
    icon: "graduation-cap",
    glyph: "⚖",
    short: "Formal",
    label: "Make more formal",
    instruction: "Rewrite the selected text to be more formal and professional.",
  },
  {
    id: "grammar",
    icon: "spell-check",
    glyph: "✓",
    short: "Grammar",
    label: "Fix grammar and spelling",
    instruction:
      "Fix grammar, spelling, and punctuation errors in the selected text. Change as little as possible.",
  },
  {
    id: "latex",
    icon: "sigma",
    glyph: "Σ",
    short: "LaTeX",
    label: "Convert math to LaTeX",
    instruction:
      "Convert any math in the selected text to LaTeX notation ($...$ inline, $$...$$ block). Keep the surrounding prose unchanged.",
  },
];

/** The system prompt, verbatim from the reference implementation. */
export const REWRITE_SYSTEM_PROMPT =
  "You rewrite text according to the user's instruction. The text to rewrite is marked with <selected> and </selected>; the surrounding <context_before>/<context_after> blocks are provided for style and continuity only.\n" +
  "Output ONLY the rewritten text for the selected part — no explanations, no meta-text, no markers. Preserve markdown formatting. Keep the original language unless the instruction says otherwise. Write in Markdown: preserve headings and list structure, putting each numbered list item on its own line, always starting a new line after a heading before body text — never expand a heading or rubric into a large body.";

/** Characters of context kept on each side of the selection. */
export const CONTEXT_LIMIT = 8000;

/** Reasoning tokens count against the budget, so a rewrite gets real headroom. */
export const SELECTION_MAX_TOKENS = 4000;

export interface RewriteRequest {
  /** What to do — a preset instruction, or whatever the user typed. */
  instruction: string;
  /** The selected text, exactly as rendered. */
  selection: string;
  /** Markdown before the selection, for style and continuity only. */
  before: string;
  /** Markdown after the selection. */
  after: string;
}

/**
 * Find a preset by id.
 *
 * @param id - The preset id, usually a button's `data-action`.
 * @returns The preset, or null when nothing matches.
 */
export const findPreset = (id: string): SelectionAction | null =>
  SELECTION_PRESETS.find((preset) => preset.id === id) ?? null;

/**
 * Build the request for one rewrite.
 *
 * @param input - The instruction, the selected text and its neighbours.
 * @returns The messages to send.
 */
export function buildRewriteMessages(input: RewriteRequest): ChatMessage[] {
  const before = input.before.slice(-CONTEXT_LIMIT);
  const after = input.after.slice(0, CONTEXT_LIMIT);
  return [
    { role: "system", content: REWRITE_SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        `Instruction: ${input.instruction}`,
        "",
        before ?
          `<context_before>\n${before}\n</context_before>`
        : "<context_before></context_before>",
        "",
        `<selected>\n${input.selection}\n</selected>`,
        "",
        after ? `<context_after>\n${after}\n</context_after>` : "<context_after></context_after>",
      ].join("\n"),
    },
  ];
}
