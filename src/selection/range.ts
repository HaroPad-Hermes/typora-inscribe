/**
 * Mapping a text SELECTION to the markdown range an edit would replace.
 *
 * The caret derivation answers "where is the point" for a collapsed selection.
 * An edit needs more than that: it needs the SPAN, in markdown coordinates, of
 * the text the user has selected — the two `{line, character}` endpoints that
 * `replaceTextByRange` takes. Both endpoints come from the same derivation, so
 * there is one definition of where the document is, not two that can disagree.
 *
 * Everything here refuses by name. A replacement built on a guessed range
 * rewrites the wrong text, which is worse than doing nothing, so an unmappable
 * endpoint, a selection that moved, or a span that collapsed to nothing all
 * return a named refusal the caller logs instead of an approximate range.
 *
 * Known refusal: a selection inside a code fence cannot be mapped, because any
 * live caret inside a fence sits in CodeMirror and the derivation refuses
 * `.CodeMirror` anchors by design. That is a refusal, not a wrong range.
 */

import { deriveCaretFromDomSelection } from "../completions/caret";
import type { LspRange, LspPosition as Position } from "../utils/tools";

export type RangeRefusal =
  | "no-selection"
  | "collapsed"
  | "selection-changed"
  | "start-unmappable"
  | "end-unmappable"
  | "empty-range";

export interface SelectionRangeOptions {
  /** The editor's `#write` container. */
  writingArea: Element;
  /** Live selection — pass `window.getSelection()` at click time. */
  selection: Selection | null;
  /** Current document markdown. */
  markdown: string;
  /**
   * The text the caller believes is selected, when it has one.
   *
   * The menu opens on `mouseup` and acts on `click`, and the selection can move
   * between the two. Comparing the live selection's text against the snapshot
   * turns "the user moved the caret mid-click" into a refusal instead of an edit
   * applied to text nobody chose.
   */
  expectedText?: string;
  /** Diagnostic sink. Pass a no-op in tests. */
  log?: (message: string) => void;
}

export type SelectionRangeResult =
  | { ok: true; range: LspRange; start: Position; end: Position }
  | { ok: false; reason: RangeRefusal };

/**
 * Order two positions, earliest first.
 *
 * Exported because a selection can be made backwards (drag right-to-left), and
 * that ordering is the one part of this module a DOM harness cannot reproduce:
 * a `Range`-based selection always reports anchor at its start, so a forward
 * selection is the only shape happy-dom can build.
 *
 * @param a - One endpoint.
 * @param b - The other endpoint.
 * @returns The two endpoints, earliest first.
 */
export const orderEndpoints = (a: Position, b: Position): [Position, Position] => {
  if (a.line !== b.line) return a.line < b.line ? [a, b] : [b, a];
  return a.character <= b.character ? [a, b] : [b, a];
};

/**
 * Map the live selection to the markdown range it covers.
 *
 * @param options - Writing area, live selection, markdown and the caller's snapshot.
 * @returns The range, or the reason it cannot be trusted.
 */
export function selectionRange(options: SelectionRangeOptions): SelectionRangeResult {
  const { expectedText, log, markdown, selection, writingArea } = options;

  if (!selection || selection.rangeCount === 0) return { ok: false, reason: "no-selection" };
  if (selection.isCollapsed) return { ok: false, reason: "collapsed" };
  if (expectedText !== undefined && selection.toString() !== expectedText)
    return { ok: false, reason: "selection-changed" };

  const derive = (node: Node | null, offset: number): Position | null =>
    node ?
      deriveCaretFromDomSelection({
        writingArea,
        selection,
        markdown,
        log,
        point: { node, offset },
      })
    : null;

  // Take the endpoints from the live RANGE rather than anchor/focus: a Range is
  // always ordered, while anchor/focus describe the drag's direction, which is
  // not what an edit needs. `orderEndpoints` then guards the DERIVED positions,
  // since each of the two comes from its own walk of the block list.
  const live = selection.getRangeAt(0);

  const from = derive(live.startContainer, live.startOffset);
  if (!from) return { ok: false, reason: "start-unmappable" };
  const to = derive(live.endContainer, live.endOffset);
  if (!to) return { ok: false, reason: "end-unmappable" };

  const [start, end] = orderEndpoints(from, to);
  if (start.line === end.line && start.character === end.character)
    return { ok: false, reason: "empty-range" };

  return { ok: true, range: { start, end }, start, end };
}

/**
 * The refusals, phrased for a diagnostic log line.
 */
const REFUSAL_MESSAGES: Record<RangeRefusal, string> = {
  "no-selection": "there is no selection to map",
  collapsed: "the selection is collapsed — there is no span to replace",
  "selection-changed": "the selection changed between opening the menu and acting on it",
  "start-unmappable": "the selection's start could not be mapped to the document",
  "end-unmappable": "the selection's end could not be mapped to the document",
  "empty-range": "the selection maps to an empty span",
};

/**
 * Turn a refusal into a log-ready sentence.
 *
 * @param reason - A refusal from {@linkcode selectionRange}.
 * @returns A human-readable explanation of the refusal.
 */
export const describeRangeRefusal = (reason: RangeRefusal): string => REFUSAL_MESSAGES[reason];
