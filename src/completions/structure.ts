/**
 * Structural legality of a completion at the caret.
 *
 * A completion is a string inserted at the caret, and some block types cannot
 * hold every string. A table cell is the sharpest case: a newline inside a cell
 * is not "text plus a line break", it is a NEW TABLE ROW. Accepting one merges
 * the neighbouring cell — observed live, where `| "sent" | "sentence" or "sent" |`
 * came back as `| "sent" "sentence" |` and the second cell's text was gone, with
 * the whole table re-padded rather than extended. An unescaped pipe is the same
 * hazard across the row instead of down it: it opens a column.
 *
 * A heading is that hazard one block type over. `# ` is a single line, so a
 * multi-line completion turns the rest of the document into heading text.
 *
 * Nothing downstream asked this question before: `flow.ts` preserves newlines on
 * purpose (`collapseSpaces` excludes them, because a leading newline is the FIM
 * boundary signal) and no caller checked whether a newline was legal HERE.
 *
 * Both sides of the caret are needed, because a table's HEADER row has its
 * separator below it rather than above.
 */

import { isSeparatorRow } from "./table";

export type StructuralReason = "heading-multiline" | "table-cell-newline" | "table-cell-pipe";

export type StructuralVerdict = { ok: true } | { ok: false; reason: StructuralReason };

const NEWLINE = /[\r\n]/;
/** A pipe that is not escaped — markdown requires `\|` inside a cell. */
const UNESCAPED_PIPE = /(?<!\\)\|/;
const HEADING_LINE = /^\s{0,3}#{1,6}(\s|$)/;

/**
 * The caret's own line, up to the caret.
 *
 * @param preCursorText - Markdown before the caret.
 * @returns The text of the caret's line before the caret.
 */
export const caretLinePrefix = (preCursorText: string): string =>
  preCursorText.slice(preCursorText.lastIndexOf("\n") + 1);

/**
 * The rest of the caret's line, after the caret.
 *
 * @param postCursorText - Markdown after the caret.
 * @returns The remainder of the caret's line.
 */
export const caretLineSuffix = (postCursorText: string): string => {
  const end = postCursorText.search(NEWLINE);
  return end < 0 ? postCursorText : postCursorText.slice(0, end);
};

/**
 * The line following the caret's line, when post-cursor text provides one.
 *
 * @param postCursorText - Markdown after the caret.
 * @returns The next line, or "" when there is none.
 */
const nextLineAfter = (postCursorText: string): string => {
  const end = postCursorText.search(NEWLINE);
  if (end < 0) return "";
  return caretLineSuffix(postCursorText.slice(end + 1));
};

/**
 * True when the caret sits inside a cell of a table row.
 *
 * A pipe in prose is not a row, so the line must also belong to a table: either
 * a separator row follows it (this is the header row) or one appears above it in
 * the contiguous run of piped lines.
 *
 * Known limitation: a row written without a leading pipe, with the caret in its
 * first cell before any pipe has been typed, is not recognised as a cell.
 *
 * @param preCursorText - Markdown before the caret.
 * @param postCursorText - Markdown after the caret.
 * @returns Whether the caret is inside a table cell.
 */
export function isInsideTableCell(preCursorText: string, postCursorText: string): boolean {
  const ownLine = caretLinePrefix(preCursorText) + caretLineSuffix(postCursorText);
  if (!UNESCAPED_PIPE.test(ownLine)) return false;

  // Header row: the separator sits on the next line.
  if (isSeparatorRow(nextLineAfter(postCursorText))) return true;

  // Body row: the separator sits above, within the contiguous piped run.
  const lines = preCursorText.split(/\r?\n/);
  for (let i = lines.length - 2; i >= 0; i--) {
    const line = lines[i]!;
    if (!line.includes("|")) return false;
    if (isSeparatorRow(line)) return true;
  }
  return false;
}

/**
 * Decide whether `candidate` can legally be inserted at the caret.
 *
 * @param preCursorText - Markdown before the caret.
 * @param postCursorText - Markdown after the caret.
 * @param candidate - The completion text that would be inserted.
 * @returns Whether it is structurally legal, or the reason it is not.
 */
export function structuralVerdict(
  preCursorText: string,
  postCursorText: string,
  candidate: string,
): StructuralVerdict {
  if (isInsideTableCell(preCursorText, postCursorText)) {
    if (NEWLINE.test(candidate)) return { ok: false, reason: "table-cell-newline" };
    if (UNESCAPED_PIPE.test(candidate)) return { ok: false, reason: "table-cell-pipe" };
    return { ok: true };
  }
  if (HEADING_LINE.test(caretLinePrefix(preCursorText)) && NEWLINE.test(candidate)) {
    return { ok: false, reason: "heading-multiline" };
  }
  return { ok: true };
}

const MESSAGES: Record<StructuralReason, string> = {
  "heading-multiline":
    "ghost refused: multi-line completion at a heading — a heading is a single line",
  "table-cell-newline":
    "ghost refused: newline inside a table cell would start a new row and merge cells (data loss)",
  "table-cell-pipe": "ghost refused: unescaped pipe inside a table cell would open a new column",
};

/**
 * Turn a refusal into a log-ready sentence.
 *
 * @param reason - A refusal from {@linkcode structuralVerdict}.
 * @returns The explanation to log.
 */
export const describeStructuralRefusal = (reason: StructuralReason): string => MESSAGES[reason];
