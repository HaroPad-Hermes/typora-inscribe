/**
 * The actions the selection menu offers, and the prompts behind them.
 *
 * Each action sends the selected passage to the model and proposes the answer
 * as a REPLACEMENT for that passage: the menu edits the document, it does not
 * hold a conversation. That is why an action carries an instruction rather than
 * a chat prompt, and why the output rules are strict — a preamble or a wrapping
 * code fence would be inserted into the document verbatim.
 *
 * The list is data. Adding an action is one entry, not a new code path.
 */

import type { ChatMessage } from "../providers/provider";

export interface SelectionAction {
  /** Stable identifier, used for the button's `data-action`. */
  id: string;
  /** Button label. */
  label: string;
  /** What the model is told to do with the passage. */
  instruction: string;
}

/** Output rules shared by every action, so none of them drifts. */
const OUTPUT_RULES = [
  "Output ONLY the rewritten passage.",
  "No preamble, no explanation, no commentary.",
  "Never wrap the output in code fences or quotes.",
  "Keep the author's meaning, tone and language.",
  "Preserve the Markdown the passage already uses (emphasis, links, code spans).",
].join(" ");

export const SELECTION_ACTIONS: SelectionAction[] = [
  {
    id: "rewrite",
    label: "Rewrite",
    instruction: `Rewrite the passage so it reads more clearly, without changing what it says. ${OUTPUT_RULES}`,
  },
  {
    id: "shorten",
    label: "Shorten",
    instruction: `Shorten the passage, keeping only what it needs to say. ${OUTPUT_RULES}`,
  },
];

/** A rewrite is far longer than a completion, so it gets its own ceiling. */
export const SELECTION_MAX_TOKENS = 700;

/**
 * Find an action by id.
 *
 * @param id - The action id, usually a button's `data-action`.
 * @returns The action, or null when nothing matches.
 */
export const findAction = (id: string): SelectionAction | null =>
  SELECTION_ACTIONS.find((action) => action.id === id) ?? null;

/**
 * Build the request for one action.
 *
 * The passage is the whole request. An earlier version also sent the surrounding
 * block under a "For context, it sits in:" heading, and that single line is what
 * broke the feature: measured against the live endpoint, the context-bearing shape
 * returned `finish_reason: length` with an EMPTY content after spending the entire
 * 700-token budget on reasoning (and 2000 when given 2000), while the same request
 * without it stopped at 69-270 reasoning tokens with a real answer. A passage-only
 * request answered correctly in every shape tested. Do not re-add the context
 * without re-probing this endpoint.
 *
 * @param action - The action to perform.
 * @param passage - The selected text, exactly as rendered.
 * @returns The messages to send.
 */
export function buildSelectionMessages(action: SelectionAction, passage: string): ChatMessage[] {
  return [
    { role: "system", content: action.instruction },
    { role: "user", content: passage },
  ];
}
