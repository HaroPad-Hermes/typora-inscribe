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
 * The surrounding block is sent as context because a passage alone often cannot
 * be rewritten well — "it" has no referent, and the tone is set by the sentence
 * before it — but the passage is the only thing the model may replace.
 *
 * @param action - The action to perform.
 * @param passage - The selected text, exactly as rendered.
 * @param context - The block the passage sits in, when available.
 * @returns The messages to send.
 */
export function buildSelectionMessages(
  action: SelectionAction,
  passage: string,
  context: string,
): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: "system", content: action.instruction }];
  const trimmed = context.trim();
  const surroundings =
    trimmed && trimmed !== passage.trim() ? `\n\nFor context, it sits in:\n${trimmed}` : "";
  messages.push({ role: "user", content: `${passage}${surroundings}` });
  return messages;
}
