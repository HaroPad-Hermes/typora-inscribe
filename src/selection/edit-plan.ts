/**
 * Turning a model's answer into an edit that is safe to apply.
 *
 * The model returns text; the document needs a decision. Between those two sits
 * everything that can go wrong with an edit, and every one of them is answered
 * here, in one place, before any of the document is touched:
 *
 *   - an empty answer (nothing to insert, and a rewrite of nothing is not a fix);
 *   - an answer identical to the passage (no edit, so no reload and no undo entry);
 *   - an answer that cannot legally live where the passage does — a newline or an
 *     unescaped pipe inside a table cell does not reflow the table, it rewrites
 *     the table (see `completions/structure.ts`, which already refuses exactly
 *     that on the completion path);
 *   - a range the document cannot hold, which `replaceTextByRange` answers with a
 *     throw rather than a corrupted file.
 *
 * The result carries the whole document AFTER the edit, so the caller applies a
 * string it can log, diff and reason about instead of a mutation.
 */

import { structuralVerdict } from "../completions/structure";
import type { StructuralReason } from "../completions/structure";
import { replaceTextByRange } from "../utils/tools";
import type { EOL, LspPosition, LspRange } from "../utils/tools";

export type EditRefusal = "empty-output" | "unchanged" | "range-out-of-document" | StructuralReason;

export interface EditPlan {
  /** The span being replaced. */
  range: LspRange;
  /** The cleaned text that will stand in its place. */
  replacement: string;
  /** The passage as it is now. */
  before: string;
  /** The whole document with the replacement applied. */
  after: string;
}

export interface PlanEditOptions {
  markdown: string;
  range: LspRange;
  /** The selected passage, as the menu captured it. */
  passage: string;
  /** The model's raw answer. */
  answer: string;
  eol?: EOL;
}

export const EDIT_REFUSAL_MESSAGES: Record<EditRefusal, string> = {
  "empty-output": "the model returned nothing to insert",
  unchanged: "the model returned the passage unchanged",
  "range-out-of-document": "the selection maps to a range this document cannot hold",
  "heading-multiline":
    "the rewrite spans lines but a heading is a single line — the rest of the document would become heading text",
  "table-cell-newline":
    "the rewrite contains a line break inside a table cell — that starts a new ROW and merges cells",
  "table-cell-pipe":
    "the rewrite contains an unescaped pipe inside a table cell — that opens a new column",
};

/**
 * The character offset of a `{line, character}` position.
 *
 * @param markdown - The document.
 * @param position - The position to locate.
 * @param eol - The document's line ending. Defaults to `"\n"`.
 * @returns The offset, or -1 when the document has no such line.
 */
export function offsetAt(markdown: string, position: LspPosition, eol: EOL = "\n"): number {
  const lines = markdown.split(eol);
  let offset = 0;
  for (let i = 0; i < position.line; i++) {
    const line = lines[i];
    if (line === undefined) return -1;
    offset += line.length + eol.length;
  }
  const target = lines[position.line];
  if (target === undefined) return -1;
  return offset + Math.min(position.character, target.length);
}

/**
 * Where the caret belongs after a replacement.
 *
 * @param range - The span that was replaced.
 * @param replacement - The text that replaced it.
 * @returns The position just after the inserted text.
 */
export function caretAfter(range: LspRange, replacement: string): LspPosition {
  const parts = replacement.split("\n");
  const lastLine = parts[parts.length - 1] ?? "";
  if (parts.length === 1)
    return { line: range.start.line, character: range.start.character + lastLine.length };
  return { line: range.start.line + parts.length - 1, character: lastLine.length };
}

/**
 * Strip the wrappers models add around an answer.
 *
 * Only a fence that wraps the WHOLE answer goes: a fence inside the passage is
 * usually content the author wrote, and removing it would be this code editing
 * on its own initiative.
 *
 * @param raw - The model's answer.
 * @returns The text to insert, trimmed.
 */
export function cleanReplacement(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /^(?:```|~~~)[^\n]*\n([\s\S]*?)\n?(?:```|~~~)$/.exec(trimmed);
  return (fenced?.[1] ?? trimmed).trim();
}

/**
 * Decide whether an answer can replace a passage, and produce the result.
 *
 * @param options - Document, range, passage and the model's answer.
 * @returns The plan, or the reason it cannot be applied.
 */
export function planEdit(
  options: PlanEditOptions,
): { ok: true; plan: EditPlan } | { ok: false; reason: EditRefusal } {
  const { answer, eol = "\n", markdown, passage, range } = options;

  const replacement = cleanReplacement(answer);
  if (!replacement) return { ok: false, reason: "empty-output" };
  if (replacement === passage.trim()) return { ok: false, reason: "unchanged" };

  const start = offsetAt(markdown, range.start, eol);
  const end = offsetAt(markdown, range.end, eol);
  if (start < 0 || end < 0 || end < start) {
    return { ok: false, reason: "range-out-of-document" };
  }

  const verdict = structuralVerdict(markdown.slice(0, start), markdown.slice(end), replacement);
  if (!verdict.ok) return { ok: false, reason: verdict.reason };

  return {
    ok: true,
    plan: {
      range,
      replacement,
      before: passage,
      after: replaceTextByRange(markdown, range, replacement, eol),
    },
  };
}

/**
 * Turn a refusal into a log-ready sentence.
 *
 * @param reason - A refusal from {@linkcode planEdit}.
 * @returns A human-readable explanation of the refusal.
 */
export const describeEditRefusal = (reason: EditRefusal): string => EDIT_REFUSAL_MESSAGES[reason];
