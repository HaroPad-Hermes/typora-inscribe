import type { LspPosition as Position } from "../utils/tools";

import { isInsidePreview, textWalkerWithoutPreview, textWithoutPreview } from "./preview-text";
import { mapTableBlock } from "./table";

/**
 * Structural markdown prefix on a line: list bullets/numbers, heading hashes,
 * blockquote markers. Its LENGTH is what has to be added back to the rendered
 * caret offset, because Typora renders these via CSS (`data-mark`) and they are
 * absent from the DOM text.
 */
const STRUCTURAL_PREFIX = /^([-*+]\s+|\d+[.)]\s+|#{1,6}\s+|>\s?)/;

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

export interface CaretDerivationOptions {
  /** The editor's `#write` container; top-level blocks are its direct children. */
  writingArea: Element;
  /** Live selection at trigger time — `window.getSelection()`. */
  selection: Selection | null;
  /** Current document markdown. */
  markdown: string;
  /** Diagnostic sink. Pass a no-op in tests. */
  log?: (message: string) => void;
}

/**
 * Derive the caret's `{line, character}` in the markdown from the live DOM
 * selection.
 *
 * The change-event tracker only updates on markdown EDITS, so it goes stale the
 * moment the caret moves without typing. This walks the rendered top-level
 * blocks, matches each block's text against markdown lines SEQUENTIALLY, and
 * computes the caret position exactly — including `- ` bullets, heading
 * markers and block newlines the naive text-node TreeWalker missed.
 *
 * @param options - Writing area, live selection, markdown and an optional log sink.
 * @returns The caret position, or null when it cannot be derived (see `log`).
 */
export function deriveCaretFromDomSelection(options: CaretDerivationOptions): Position | null {
  const { log, markdown, selection: sel, writingArea } = options;
  const trace = (msg: string) => log?.(`deriveCaret TRACE: ${msg}`);
  const doc = writingArea.ownerDocument;

  try {
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) {
      trace(
        `selection bad: sel=${String(Boolean(sel))} rangeCount=${sel?.rangeCount ?? -1} collapsed=${String(sel?.isCollapsed)}`,
      );
      return null;
    }
    const anchor = sel.anchorNode;
    if (!anchor || !writingArea.contains(anchor)) {
      const where = anchor ? `${anchor.nodeName}#${(anchor as Element).className}` : "null";
      trace(`anchor outside writingArea: ${where}`);
      return null;
    }
    const elem = anchor.nodeType === TEXT_NODE ? anchor.parentElement : (anchor as Element);
    if (
      !elem ||
      elem.closest(".CodeMirror") ||
      elem.closest("input") ||
      elem.classList.contains("ty-input")
    ) {
      const which = elem ? `${elem.tagName}.${elem.className}` : "null";
      trace(`elem rejected: ${which}`);
      return null;
    }
    trace(
      `anchor=${anchor.nodeName} offset=${sel.anchorOffset} elem=${elem.tagName}.${elem.className}`,
    );

    const norm = markdown.replace(/\r\n/g, "\n");
    const lines = norm.split("\n");

    // Find the caret's block: walk up to the top-level block (direct child of
    // #write), or the closest list item / mdtype element.
    // `caretBlock` is never null: it starts from the already-guarded `elem`, and
    // the loop only reassigns it from a `parentElement` it just confirmed truthy.
    let caretBlock: Element | null = elem;
    while (caretBlock.parentElement && caretBlock.parentElement !== writingArea) {
      if (caretBlock.tagName === "LI" || caretBlock.classList.contains("md-list-item")) break;
      caretBlock = caretBlock.parentElement;
    }
    if (caretBlock === writingArea) caretBlock = elem.closest("li, [mdtype]") ?? elem;
    if (caretBlock === writingArea) {
      trace("no caretBlock: writingArea");
      return null;
    }
    trace(`caretBlock=${caretBlock.tagName}.${caretBlock.className}`);

    // Read it the way the matcher will, so this trace shows the string the
    // comparison actually sees. It used to log the raw DOM read, which disagreed
    // by the ghost's own text — the exact confusion the exclusion exists to end.
    const caretBlockText = textWithoutPreview(caretBlock).replace(/\s+/g, " ").trim();
    if (!caretBlockText) {
      trace("caretBlockText empty");
      return null;
    }
    trace(`caretBlockText="${caretBlockText.slice(0, 60)}"`);

    /**
     * Strip structural markers and collapse whitespace, for line comparison.
     *
     * @param raw - A raw markdown line.
     * @returns The comparable form of the line.
     */
    const stripLine = (raw: string): string =>
      raw
        .replace(/^[-*+]\s+/, "") // "- ", "* ", "+ "
        .replace(/^\d+[.)]\s+/, "") // "1. ", "2) "
        .replace(/^#{1,6}\s+/, "") // "## "
        .replace(/^>\s?/, "") // "> "
        .replace(/^```.*$/, "") // code fence markers
        .replace(/\s+/g, " ")
        .trim();

    /**
     * Whitespace-insensitive form, for blocks that render without separators.
     *
     * @param s - Text to squash.
     * @returns The text with all whitespace removed.
     */
    const squash = (s: string): string => s.replace(/\s+/g, "");

    // Sequential matching: walk top-level blocks, matching each to the next
    // markdown line. Handles repeated lines and multi-line blocks.
    let mdLineIdx = 0;
    /**
     * Match a rendered block's collapsed text against the markdown starting at
     * `fromIdx`, returning the FIRST markdown line it covers and how many lines
     * it spans.
     *
     * Most blocks are one line. A fenced code block (and a table) renders as ONE
     * element whose text is several lines, so a line-by-line equality check can
     * never match it — which is why the derivation used to return null inside a
     * fence and the caller silently fell back to a STALE caret, producing a
     * coherent completion of the wrong prefix. Accumulating consecutive lines
     * fixes that without the old trap of comparing a sibling's textContent (a
     * UL's textContent is all its items concatenated with no separator).
     *
     * A fence caret still does not derive — its anchor is refused earlier when it
     * lives in CodeMirror — so this closes the mapping gap, not the feature.
     *
     * @param blockText - The block's rendered text, whitespace-collapsed.
     * @param fromIdx - Markdown line index to start searching from.
     * @returns The matched line range, or null when the block is unmapped.
     */
    const matched = (firstLine: number, lineCount: number, approximate = false) => ({
      approximate,
      firstLine,
      lineCount,
    });
    const matchBlockLines = (
      blockText: string,
      fromIdx: number,
    ): { approximate: boolean; firstLine: number; lineCount: number } | null => {
      const squashedBlock = squash(blockText);
      for (let i = fromIdx; i < lines.length; i++) {
        // Skip fence markers and blank lines that precede the block's content.
        const head = stripLine(lines[i]!);
        if (head === "") continue;
        if (head === blockText) return matched(i, 1);
        let acc = head;
        for (let j = i + 1; j < lines.length; j++) {
          acc = `${acc} ${stripLine(lines[j]!)}`.replace(/\s+/g, " ").trim();
          if (acc === blockText) return matched(i, j - i + 1);
          // A rendered multi-line block joins its lines WITHOUT the space the markdown
          // uses — a fence's indentation is CSS, not text — so the spaced accumulator
          // can never equal the block text and the block was reported NO-MATCH. Retry
          // whitespace-insensitively, but mark the match APPROXIMATE: squashing throws
          // away line structure, so the block is located yet unmapped for offsets.
          if (squash(acc) === squashedBlock) return matched(i, j - i + 1, true);
          if (squash(acc).length > squashedBlock.length) break;
        }
      }
      return null;
    };

    const forEachTopBlock = (
      root: Element,
      fn: (el: Element, isCaret: boolean) => boolean | void,
    ): boolean => {
      for (const child of root.children) {
        if (child.nodeType !== ELEMENT_NODE) continue;
        if (child.tagName === "UL" || child.tagName === "OL") {
          for (const li of child.children) {
            if (li.nodeType !== ELEMENT_NODE) continue;
            const stop = fn(li, li === caretBlock || li.contains(caretBlock));
            if (stop) return true;
          }
        } else {
          const stop = fn(child, child === caretBlock || child.contains(caretBlock));
          if (stop) return true;
        }
      }
      return false;
    };

    let result: Position | null = null;
    trace(
      `writingArea children: ${Array.from(writingArea.children)
        .map((c) => c.tagName)
        .join(",")}`,
    );
    forEachTopBlock(writingArea, (el, isCaret) => {
      // A table renders as ONE figure whose textContent is every cell
      // concatenated with no separator, so `matchBlockLines` can never match it
      // and the old code skipped it silently — leaving the caller on a stale
      // caret. Tables are mapped by CELL instead; see completions/table.ts.
      if (el.tagName === "FIGURE") {
        const table = mapTableBlock({
          anchor,
          anchorOffset: sel.anchorOffset,
          figure: el,
          fromLine: mdLineIdx,
          lines,
          trace,
        });
        if (table.lineCount > 0 && !isCaret) mdLineIdx = table.startLine + table.lineCount;
        if (table.caret) {
          result = table.caret;
          trace(
            `RESULT line=${table.caret.line} char=${table.caret.character} (table cell mapping, blockStart=${table.startLine})`,
          );
          return true;
        }
        trace(
          `block NO-MATCH isCaret=${String(isCaret)} tag=FIGURE reason="${table.reason ?? "unmapped"}"`,
        );
        // Never fall through when the caret is inside this table: no later block
        // can be the caret's block, and letting one match is the stale-caret bug
        // this branch exists to remove.
        return isCaret;
      }
      // Never read the plugin's own preview as document text: an undismissed ghost
      // inside this block made it unmatchable and the caller fell back to a stale
      // tracker (see completions/preview-text.ts).
      const blockText = textWithoutPreview(el).replace(/\s+/g, " ").trim();
      const matched = matchBlockLines(blockText, mdLineIdx);
      if (!matched) {
        trace(
          `block NO-MATCH isCaret=${String(isCaret)} tag=${el.tagName} "${blockText.slice(0, 50)}" mdLineIdx=${mdLineIdx}` +
            ` html="${el.innerHTML.slice(0, 120)}"`,
        );
        return false; // skip unmatched (table with irregular cells, etc.)
      }
      trace(
        `block matched isCaret=${String(isCaret)} tag=${el.tagName} line=${matched.firstLine} span=${matched.lineCount} "${blockText.slice(0, 50)}"`,
      );
      if (isCaret) {
        // An approximate match means the DOM hid the block's separators (a fence's
        // indentation and breaks are CSS), so the block's line structure is not
        // recoverable and the offset cannot be computed exactly. Refuse: a confident
        // wrong caret is worse than no suggestion, and is the failure this whole
        // derivation exists to remove.
        // Reachability, verified live: for a caret inside a fence this branch is not
        // reached — the anchor is refused earlier because it lives in CodeMirror — so
        // it is defence for a future fence path, NOT the fence fix.
        if (matched.approximate && !el.textContent.includes("\n")) {
          trace(`block matched approximately — no rendered line separators, offset not derivable`);
          return false;
        }
        // Compute intra-block offset, handling both text-node anchors
        // (common in mid-paragraph) and element anchors (common when clicking
        // at the end of a line, where the browser sets anchorNode to the block
        // element with anchorOffset = child count).
        const intraOffset = ((): number => {
          if (anchor.nodeType === TEXT_NODE) {
            const walker = textWalkerWithoutPreview(doc, el);
            let acc = 0;
            for (let n = walker.nextNode(); n; n = walker.nextNode()) {
              if (n === anchor) return acc + sel.anchorOffset;
              acc += n.textContent?.length ?? 0;
            }
            return -1;
          }
          // Element anchor: caret at node boundary in `anchor`. Walk the
          // block's flattened nodes, accumulating text before the boundary.
          let acc = 0;
          const collectBefore = (node: Node, target: Node, off: number): boolean => {
            if (node === target) {
              for (let i = 0; i < off; i++) acc += target.childNodes[i]?.textContent?.length ?? 0;
              return true;
            }
            if (node.nodeType === TEXT_NODE) {
              acc += node.textContent?.length ?? 0;
              return false;
            }
            for (const ch of node.childNodes) {
              if (isInsidePreview(ch)) continue;
              if (collectBefore(ch, target, off)) return true;
            }
            return false;
          };
          if (!collectBefore(el, anchor, sel.anchorOffset)) return -1;
          return acc;
        })();
        if (intraOffset < 0) {
          trace(`intraOffset FAILED anchor=${anchor.nodeName} offset=${sel.anchorOffset}`);
          return false;
        }
        // The caret can sit several lines into a multi-line block (code fence,
        // table). `intraOffset` counts characters through the block's rendered
        // text, so split it on newlines to get the line WITHIN the block and the
        // column, then offset from the markdown line the block starts on.
        const blockRaw = textWithoutPreview(el);
        const before = blockRaw.slice(0, intraOffset);
        const lineWithinBlock = (before.match(/\n/g) ?? []).length;
        const lastNl = before.lastIndexOf("\n");
        const column = lastNl < 0 ? before.length : before.length - lastNl - 1;
        const mdLine = matched.firstLine + lineWithinBlock;
        const raw = lines[mdLine]!;
        const bulletLen = (STRUCTURAL_PREFIX.exec(raw)?.[1] ?? "").length;
        result = { line: mdLine, character: bulletLen + column };
        trace(
          `RESULT line=${mdLine} char=${bulletLen + column} (blockStart=${matched.firstLine} +${lineWithinBlock} bulletLen=${bulletLen} col=${column})`,
        );
        return true;
      }
      // Preceding block: advance past its line. Blank lines between blocks are
      // skipped by the forward search. Do NOT try to count how many lines a
      // block spans — a UL's textContent is all its items concatenated (never
      // matching a single markdown line), so the old heuristic ran to the end
      // of the document and desynced every subsequent list-item match (breaks
      // all triggers after a list).
      mdLineIdx = matched.firstLine + matched.lineCount;
      return false;
    });

    return result;
  } catch (e) {
    log?.(`deriveCaret EXCEPTION: ${String(e)}`);
    return null;
  }
}

/**
 * Validate a tracked caret against the markdown before trusting it.
 *
 * `derived ?? tracked` treats a refused derivation as "use the older value anyway".
 * The tracker only learns a caret from markdown EDITS, so it goes stale after a
 * caret move, and it overshoots by one at end-of-line (observed live: character 27
 * for a 26-character line). A completion built for a position the document cannot
 * hold is the historical "completions are nonsense" report, so the fallback now
 * refuses what the document cannot contain: the trigger then reports no caret
 * position and flashes, instead of spending a request on a position that is not
 * real. It still logs `source=tracked`, so the fallback remains visible.
 *
 * @param tracked - The tracker's last known caret, or null.
 * @param markdown - The document the position must be valid in.
 * @returns The position when the document can hold it, otherwise null.
 */
/**
 * Why a tracked caret cannot be trusted, or null when it can.
 *
 * @param tracked - The tracker's last known caret, or null.
 * @param markdown - The document the position must be valid in.
 * @returns The refusal, or null when the position is usable.
 */
export function trackedRefusal(
  tracked: Position | null,
  markdown: string,
): "never-tracked" | "out-of-range" | null {
  if (!tracked) return "never-tracked";
  const line = markdown.split(/\r?\n/)[tracked.line];
  if (line === undefined) return "out-of-range";
  return tracked.character > line.length ? "out-of-range" : null;
}

/**
 * Explain why the trigger produced no caret position.
 *
 * The two refusals are different problems — a tracker that never saw an edit is
 * normal after a click, one that the document cannot hold is the bug this
 * validation exists to catch — and one message for both made the log say
 * "tracker null" about a position that did exist.
 *
 * @param tracked - The tracker's last known caret, or null.
 * @param markdown - The document the position must be valid in.
 * @returns A log-ready sentence naming the refusal.
 */
export const noCaretReason = (tracked: Position | null, markdown: string): string => {
  const refusal = trackedRefusal(tracked, markdown);
  if (refusal === "never-tracked")
    return "derivation failed and the tracker never saw an edit (null)";
  if (refusal === "out-of-range")
    return "derivation failed and the tracked caret is past the end of its line";
  return "derivation failed, but the tracked caret was usable (unexpected: it should have been used)";
};

export function validTrackedCaret(tracked: Position | null, markdown: string): Position | null {
  return trackedRefusal(tracked, markdown) === null ? tracked : null;
}
