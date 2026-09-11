/* On-demand caret probe — a diagnostic, not part of the completion path.
 *
 * Until now the plugin's live cursor could only be observed by running a real
 * completion: `doTrigger` logs `caret=… ctx=…`, but it also spends an API call
 * and paints a ghost over the document, so "where is the caret right now?" was
 * expensive to ask and was only ever answered as a side effect of a request.
 *
 * Pressing F8 runs the SAME derivation the completion path runs and logs the
 * result, plus the derivation's own TRACE lines, without calling the model.
 * This module imports no provider and no service, so it cannot spend a request;
 * it touches nothing on the completion path and is inert unless F8 is pressed.
 * Read `[caret-probe]` lines in %LOCALAPPDATA%\typora-inscribe\inscribe.log.
 */

import { deriveCaretFromDomSelection } from "./completions/caret";
import { diagLog } from "./diag";
import type { LspPosition as Position } from "./utils/tools";

/** Hotkey, as an `event.key` value, matched with no modifier held. */
const PROBE_KEY = "f8";

/** Characters of context logged on each side of the caret. */
const CTX_RADIUS = 15;

/**
 * Absolute character offset of a caret position in the markdown.
 *
 * @param markdown - Markdown source.
 * @param position - Caret position.
 * @param eol - Line terminator the file uses.
 * @returns The offset, clamped to the end of `markdown`.
 */
const offsetOf = (markdown: string, position: Position, eol: string): number => {
  const lines = markdown.split(eol);
  let offset = 0;
  for (let i = 0; i < position.line && i < lines.length; i += 1) {
    offset += (lines[i]?.length ?? 0) + eol.length;
  }
  return Math.min(offset + position.character, markdown.length);
};

/**
 * Characters around a caret, `␂` marking the caret itself. Deliberately the
 * same shape as the `ctx` the completion trigger logs, so a probe line and a
 * trigger line can be compared field by field.
 *
 * @param markdown - Markdown source.
 * @param position - Caret position.
 * @returns The snippet, with `␂` at the caret.
 */
const ctxAround = (markdown: string, position: Position): string => {
  const eol = Files.useCRLF ? "\r\n" : "\n";
  const at = offsetOf(markdown, position, eol);
  return `${markdown.slice(Math.max(0, at - CTX_RADIUS), at)}␂${markdown.slice(at, at + CTX_RADIUS)}`;
};

/**
 * Derive the caret once and log it. Never calls the model.
 *
 * @param log - Diagnostic sink.
 */
const probeCaret = (log: (message: string) => void): void => {
  const editor: Typora.Editor | undefined = Files.editor;
  const writingArea: HTMLDivElement | undefined = editor?.writingArea;
  if (!editor || !writingArea) {
    log("[caret-probe] no editor/writingArea — nothing to probe");
    return;
  }
  const markdown = editor.getMarkdown();
  const derived = deriveCaretFromDomSelection({
    log,
    markdown,
    selection: window.getSelection(),
    writingArea,
  });
  log(
    `[caret-probe] derived=${JSON.stringify(derived)} mdLen=${markdown.length}` +
      (derived ? ` ctx=${JSON.stringify(ctxAround(markdown, derived))}` : ""),
  );
};

/**
 * Attach the F8 caret probe. Call once at boot; the returned function detaches
 * it again (used by specs, which attach a fresh probe per test).
 *
 * @param log - Diagnostic sink, injectable so the probe works off-Typora.
 * @returns A function that removes the keydown listener.
 */
export function attachCaretProbe(log: (message: string) => void = diagLog): () => void {
  const handler = (event: KeyboardEvent): void => {
    if (event.key.toLowerCase() !== PROBE_KEY) return;
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    event.stopPropagation();
    probeCaret(log);
  };
  document.addEventListener("keydown", handler, true);
  log("[caret-probe] attached: press F8 to log the caret without requesting a completion");
  return () => {
    document.removeEventListener("keydown", handler, true);
  };
}
