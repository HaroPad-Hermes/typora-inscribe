// Pure completion-flow logic — no Obsidian imports, fully portable.
// Adapted from obsidian-inscribe's plate-mode flow for the Typora port.
// All spacing decisions are made HERE (code-side), never derived from
// the model's raw output.

// --- Text helpers ---

export const trimTrailing = (s: string): string => s.replace(/\s+$/, "");
export const trimLeading = (s: string): string => s.replace(/^\s+/, "");

/** Collapse runs of spaces/tabs (but not newlines). */
export const collapseSpaces = (s: string): string => s.replace(/[ \t]{2,}/g, " ");

/** Limit the output to at most `max` sentences (simple regex split).
 *  Undefined/0 means no limit. */
export function limitSentences(s: string, max?: number): string {
  if (!max || max <= 0) return s;
  const sentences = s.split(/(?<=[.!?])\s+/);
  if (sentences.length <= max) return s;
  return sentences.slice(0, max).join(" ").trimEnd();
}

// --- FIM fill completeness check ---
// FIM fills are sized to satisfy the local boundary, not the sentence:
// a bare determiner/conjunction/preposition ("the", "and", "of") or an
// empty fill is a stranded unit that leaves the sentence hanging.
// Clause-closing punctuation marks a complete unit.

const CLOSED_CLASS_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "of", "to",
  "for", "by", "with", "from", "is", "was", "are", "were", "be", "been",
  "have", "has", "had", "do", "does", "did", "will", "would", "can",
  "could", "shall", "should", "may", "might", "must", "it", "its",
  "my", "your", "his", "her", "our", "their", "this", "that", "these",
  "those", "not", "no", "nor", "so", "if", "as", "than", "then",
  "each", "every", "both", "few", "many", "much", "some", "any",
  "all", "such", "own", "same", "neither", "either",
]);

const CLAUSE_CLOSING_RE = /[.!?;:,\])}]\s*$/;

export function isIncompleteFill(fill: string): boolean {
  const t = fill.trim();
  if (!t) return true; // empty fill → let the chat path try
  if (CLAUSE_CLOSING_RE.test(t)) return false; // complete clause / code unit
  const words = t.split(/\s+/);
  for (let i = words.length - 1; i >= 0; i--) {
    const w = words[i]!.toLowerCase().replace(/[^a-zA-Z]/g, "");
    if (w && CLOSED_CLASS_WORDS.has(w)) return true;
  }
  return false;
}

// --- System prompt for the spacing arbiter ---
export const WORD_VALIDITY_SYSTEM =
  'You check if a word is a plausible continuation of a text.\n' +
  'Respond with EXACTLY "YES" or "NO". No explanations.';

// --- Completion constraints ---
export const COMPLETION_CONSTRAINTS =
  "Output only the continuation text. No explanations, no meta-text. Never repeat words already in the text. If you cannot continue meaningfully, output nothing. Continue only the very last word or sentence at the end of the text; never complete or re-emit earlier sentences or list items.";

/** Build the effective system prompt from the user's prompt. */
export function buildSystemPromptFrom(systemPrompt: string): string {
  return systemPrompt + "\n\n" + COMPLETION_CONSTRAINTS;
}

// --- Utils ---

/** Some models emit "0" (optionally with trailing punctuation) as a learned
 *  stuck/refusal token. Treat it as empty. */
export const isStuckMarker = (s: string): boolean => /^0[\s.,;!?]*$/.test(s.trim());

/** Strip markdown formatting from model output so the ghost reads as plain
 *  text. Math spans ($...$, $$...$$) are preserved. */
export function stripMarkdown(s: string): string {
  let t = s;
  const math: string[] = [];
  t = t.replace(/\$\$?[^$\n]+\$\$?/g, (m) => {
    math.push(m);
    return `\u0000M${math.length - 1}\u0000`;
  });
  t = t.replace(/```[^\n]*\n?|`{3}/g, "");
  t = t.replace(/(\*\*|__)(.*?)\1/g, "$2");
  t = t.replace(/(\*|_|`)(.*?)\1/g, "$2");
  t = t.replace(/~~(.*?)~~/g, "$1");
  t = t
    .split("\n")
    .map((line) =>
      line
        .replace(/^(#{1,6})\s+/, "")
        .replace(/^>\s?/, "")
        .replace(/^[-*+]\s+/, "")
        .replace(/^\d+\.\s+/, "")
    )
    .join("\n");
  t = t.replace(/\u0000M(\d+)\u0000/g, (_, i) => math[+i] ?? "");
  return t;
}

/** Window the pre-cursor text to the last N lines, each capped at maxChars
 *  kept from the END (nearest the cursor). */
export function continuationWindow(text: string, maxLines = 2, maxLineChars = 600): string {
  return text
    .split("\n")
    .slice(-maxLines)
    .map((line) => (line.length > maxLineChars ? line.slice(-maxLineChars) : line))
    .join("\n");
}

/** Models often emit numbered lists as one run-on line. Normalize
 *  sentence-end + "N. " into a line break. */
export function normalizeListLineBreaks(text: string): string {
  return text.replace(/([.!?])\s+(?=\d+\.\s)/g, "$1\n");
}

// --- Callback interfaces ---

export interface GhostCallbacks {
  /** Called with the continuation prompt plus the raw windowed prefix.
   *  Returns the raw continuation text, or null if aborted/cursor moved. */
  continueText: (prompt: string, raw?: string) => Promise<string | null>;
  /** Spacing arbiter: is `candidate` (typed last word + continuation's first
   *  token) a plausible continuation of `text`? */
  isPlausibleWord: (text: string, candidate: string) => Promise<boolean | null>;
}

export interface GhostOptions {
  maxSentences?: number;
}

/** Compute the ghost text for the given pre-cursor text.
 *  Returns null when there is nothing to show.
 *
 *  Spacing rules (code-decided):
 *   - text ends with a space (or is empty) → single call, no leading space
 *   - no trailing space → continuation completes the word; plausible-word
 *     check decides attach vs. space */
export async function computeGhost(
  text: string,
  systemPrompt: string,
  cb: GhostCallbacks,
  options: GhostOptions = {}
): Promise<string | null> {
  const clean = (s: string): string =>
    normalizeListLineBreaks(
      trimLeading(trimTrailing(limitSentences(collapseSpaces(stripMarkdown(s)), options.maxSentences)))
    );

  // Case 1: trailing space or empty text — word boundary unambiguous
  if (text.endsWith(" ") || text.length === 0) {
    const windowed = continuationWindow(text);
    const sentence = await cb.continueText(`Continue writing. ${windowed}`, windowed);
    if (sentence === null) return null;
    const result = clean(sentence);
    if (!result || isStuckMarker(result)) return null;
    return result;
  }

  // Case 2: no trailing space — continuation completes the word or starts
  // a new one. The plausible-word check decides.
  const windowed = continuationWindow(text);
  const sentence = await cb.continueText(`Continue writing. ${windowed} `, windowed);
  if (sentence === null) return null;

  const cleaned = clean(sentence);
  if (!cleaned || isStuckMarker(cleaned)) return null;

  const lastWord = text.split(/\s/).pop() || text;
  const firstToken = cleaned.split(/\s/)[0] ?? "";
  if (!firstToken) return cleaned;

  const plausible = await cb.isPlausibleWord(text, lastWord + firstToken);
  if (plausible === null) {
    return /^[A-ZÅÄÖ0-9]/.test(cleaned) ? " " + cleaned : cleaned;
  }
  return plausible ? cleaned : " " + cleaned;
}