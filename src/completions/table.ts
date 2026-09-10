/**
 * Table-block mapping for the caret derivation.
 *
 * A markdown table renders as ONE `<figure>` whose `textContent` is every cell
 * concatenated with no separator at all ("DimensionRuleChecked byRuns at"), so
 * `matchBlockLines` — which compares a block's collapsed text against a run of
 * source lines — can never match it. Before this module such a block was
 * silently skipped (`return false; // skip unmatched (table with irregular
 * cells, etc.)`) and, when the caret was inside it, the derivation returned null
 * and the trigger fell back to a stale caret: a coherent completion of the WRONG
 * prefix, with nothing logged as an error.
 *
 * Mapping a caret in a table is therefore done by CELL, not by rendered text.
 * The DOM supplies the cell holding the caret; the pipe-delimited source row
 * supplies the same cell's markdown and its offset. The two are then
 * CROSS-CHECKED before a position is returned.
 *
 * Two deliberate choices, both forced by observed behaviour:
 *
 * 1. The cross-check compares PLAIN text on both sides (markers stripped from
 *    the source cell *and* from the rendered cell). Typora's DOM keeps inline
 *    markers in cell text — CONSTRAINTS.md's own log lines show `**CRLF breaks
 *    lint` and `` E1`@ts-expect-error` `` — so comparing rendered-against-source
 *    literally would refuse every valid cell.
 * 2. Offsets are counted in PLAIN characters, likewise on both sides, which
 *    makes the mapping correct whether or not the renderer kept the markers.
 *
 * A refused mapping falls back to the old behaviour; a wrong one would silently
 * complete the wrong text. Every refusal carries a `reason` for the log.
 */

const TEXT_NODE = 3;

const ELEMENT_NODE = 1;

const SHOW_TEXT = 4;

/** A table-row source line: `| a | b |`, with optional indentation. */
const TABLE_ROW = /^\s*\|/;

export interface TableBlockOptions {
  /** The `<figure>` block that rendered the table. */
  figure: Element;
  /** Document markdown split into lines, `\r\n` already normalised. */
  lines: string[];
  /** Index the sequential block matcher has already reached. */
  fromLine: number;
  /** Live selection anchor — the node the caret sits in. */
  anchor: Node | null;
  /** Live selection anchor offset within `anchor`. */
  anchorOffset: number;
  /** Diagnostic sink; pass a no-op in tests. */
  trace?: (message: string) => void;
}

export interface TableBlockMapping {
  /** Source line index the table's first row sits on, or -1 when not found. */
  startLine: number;
  /** How many source lines the whole table occupies (0 when not found). */
  lineCount: number;
  /** Caret position, present only when inside this table and verified. */
  caret: { line: number; character: number } | null;
  /** Why `caret` is null, for the diagnostic log. */
  reason?: string;
}

/**
 * Whether a source line is a table's `|---|:--:|` delimiter row.
 *
 * @param line - A raw markdown line.
 * @returns True when the line holds only pipes, dashes, colons and spaces, and at least one dash.
 */
export function isSeparatorRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.includes("-") && /^[|\s:-]+$/.test(trimmed);
}

/**
 * Split a markdown table row into cells, remembering each cell's offset in the
 * raw line.
 *
 * Escaped pipes (`\|`) and pipes inside code spans must not split, which matters
 * concretely here: CONSTRAINTS.md's Suppressions row contains
 * `` `rg -c '@ts-ignore\|@ts-expect-error\|eslint-disable' src/` `` and a naive
 * `split("|")` sees seven fields instead of four, landing the caret in the wrong
 * column. Escapes are preserved in the returned text so offsets stay aligned.
 *
 * @param line - A raw markdown table row.
 * @returns Each cell's raw text and its start offset in `line`.
 */
export function splitRow(line: string): { text: string; start: number }[] {
  const cells: { text: string; start: number }[] = [];
  let buffer = "";
  let cellStart = -1;
  let inCode = false;
  const flush = (): void => {
    if (cellStart >= 0) cells.push({ start: cellStart, text: buffer });
    buffer = "";
    cellStart = -1;
  };
  let i = 0;
  while (i < line.length) {
    const ch = line[i]!;
    if (ch === "\\" && line[i + 1] === "|") {
      if (cellStart < 0) cellStart = i;
      buffer += "\\|";
      i += 2;
      continue;
    }
    if (ch === "`") {
      inCode = !inCode;
      if (cellStart < 0) cellStart = i;
      buffer += ch;
    } else if (ch === "|" && !inCode) {
      flush();
    } else {
      if (cellStart < 0) cellStart = i;
      buffer += ch;
    }
    i += 1;
  }
  flush();
  return cells;
}

/**
 * Length of the inline markdown construct starting at `index`, or 0 when the
 * character at `index` is rendered as-is.
 *
 * @param cell - Raw markdown cell text.
 * @param index - Offset to inspect.
 * @returns Characters to skip without consuming a rendered character.
 */
function markerSkip(cell: string, index: number): number {
  const rest = cell.slice(index);
  for (const marker of ["**", "__", "~~", "`", "*", "_"]) {
    if (rest.startsWith(marker)) return marker.length;
  }
  // `[label](url)` renders only the label: the opening bracket is dropped and
  // the trailing `](url)` with it. A bare `[` is left alone.
  if (rest.startsWith("[") && rest.includes("](")) return 1;
  if (rest.startsWith("](")) {
    const close = cell.indexOf(")", index);
    if (close > index) return close - index + 1;
  }
  return 0;
}

/**
 * Plain rendered text of a markdown fragment: inline markers and escapes removed.
 *
 * @param text - Raw markdown text.
 * @returns The text a browser would render.
 */
export function stripMarkers(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; ) {
    if (text[i] === "\\" && i + 1 < text.length) {
      out += text[i + 1];
      i += 2;
      continue;
    }
    const skip = markerSkip(text, i);
    if (skip > 0) {
      i += skip;
      continue;
    }
    out += text[i];
    i++;
  }
  return out;
}

/**
 * Whitespace-collapsed plain text, for comparing two renderings of one cell.
 *
 * @param text - Raw or rendered text.
 * @returns The comparable form.
 */
function plain(text: string): string {
  return stripMarkers(text).replace(/\s+/g, " ").trim();
}

/**
 * Map a count of PLAIN characters into an offset in the raw markdown cell.
 *
 * @param cell - Raw markdown cell text.
 * @param plainOffset - Rendering-visible characters the caret sits past.
 * @returns The corresponding offset in `cell`, or null when they disagree.
 */
export function sourceOffsetFor(cell: string, plainOffset: number): number | null {
  let rendered = 0;
  let i = 0;
  while (i < cell.length && rendered < plainOffset) {
    if (cell[i] === "\\" && i + 1 < cell.length) {
      i += 2;
      rendered += 1;
      continue;
    }
    const skip = markerSkip(cell, i);
    if (skip > 0) {
      i += skip;
      continue;
    }
    i++;
    rendered++;
  }
  return rendered === plainOffset ? i : null;
}

/**
 * Find an ancestor of `node` matching `selector`, constrained to `root`.
 *
 * @param root - Element the result must stay inside.
 * @param node - Node to start from (text node or element).
 * @param selector - Selector to match, e.g. `"td, th"`.
 * @returns The matching ancestor, or null.
 */
function ancestorWithin(root: Element, node: Node | null, selector: string): Element | null {
  const el = node?.nodeType === TEXT_NODE ? node.parentElement : (node as Element | null);
  if (!el || typeof el.closest !== "function") return null;
  const found = el.closest(selector);
  return found && root.contains(found) ? found : null;
}

/**
 * Caret offset in characters, counted through an element's rendered text.
 *
 * @param el - Element the offset is relative to.
 * @param node - Node the caret sits in.
 * @param offset - Caret offset within `node`.
 * @returns The character offset, or null when the node is not inside `el`.
 */
export function offsetWithin(el: Element, node: Node, offset: number): number | null {
  const doc = el.ownerDocument;
  if (node.nodeType === TEXT_NODE) {
    const walker = doc.createTreeWalker(el, SHOW_TEXT, null);
    let acc = 0;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n === node) return acc + offset;
      acc += n.textContent?.length ?? 0;
    }
    return null;
  }
  // Element anchor: the browser sets anchorNode to the element with the child
  // index when a click lands at a line end.
  let acc = 0;
  const collect = (n: Node, target: Node, off: number): boolean => {
    if (n === target) {
      for (let i = 0; i < off; i++) acc += target.childNodes[i]?.textContent?.length ?? 0;
      return true;
    }
    if (n.nodeType === TEXT_NODE) {
      acc += n.textContent?.length ?? 0;
      return false;
    }
    for (const child of n.childNodes) if (collect(child, target, off)) return true;
    return false;
  };
  return collect(el, node, offset) ? acc : null;
}

/**
 * Collect the contiguous table-row source lines for the block the matcher is at.
 *
 * @param lines - Document markdown lines.
 * @param fromLine - Index the sequential matcher has reached.
 * @returns Each row's raw text and its source line index.
 */
function collectTableLines(lines: string[], fromLine: number): { text: string; index: number }[] {
  const rows: { text: string; index: number }[] = [];
  let started = false;
  for (let i = fromLine; i < lines.length; i++) {
    const line = lines[i]!;
    if (TABLE_ROW.test(line)) {
      started = true;
      rows.push({ index: i, text: line });
      continue;
    }
    if (started) break;
  }
  return rows;
}

/**
 * Map a `<figure>` table block to markdown, and the caret to a position in it.
 *
 * @param options - Figure element, markdown lines, matcher position, caret.
 * @returns The table's source span plus a verified caret position, or a reason.
 */
export function mapTableBlock(options: TableBlockOptions): TableBlockMapping {
  const { anchor, anchorOffset, figure, fromLine, lines, trace } = options;
  const block = collectTableLines(lines, fromLine);
  if (block.length === 0) {
    return {
      caret: null,
      lineCount: 0,
      reason: "no pipe-table source found ahead of the matcher",
      startLine: -1,
    };
  }
  const startLine = block[0]!.index;
  const span = { lineCount: block.length, startLine };

  if (!anchor || !figure.contains(anchor)) {
    return { ...span, caret: null, reason: "caret outside this table" };
  }
  const cellEl = ancestorWithin(figure, anchor, "td, th");
  if (!cellEl) {
    const at = anchor.nodeType === ELEMENT_NODE ? (anchor as Element).tagName : anchor.nodeName;
    return { ...span, caret: null, reason: `caret is not inside a cell (td/th), at ${at}` };
  }
  const rowEl = ancestorWithin(figure, cellEl, "tr");
  if (!rowEl) return { ...span, caret: null, reason: "cell has no ancestor tr" };

  const tableEl = figure.querySelector("table") ?? figure;
  const domRow = Array.from<Element>(tableEl.querySelectorAll("tr")).indexOf(rowEl);
  const domCol = Array.from(rowEl.children).indexOf(cellEl);
  if (domRow < 0 || domCol < 0) {
    return { ...span, caret: null, reason: `row/cell not found (row=${domRow} col=${domCol})` };
  }

  const sourceRows = block.filter((row) => !isSeparatorRow(row.text));
  const sourceRow = sourceRows[domRow];
  if (!sourceRow) {
    return {
      ...span,
      caret: null,
      reason: `rendered row ${domRow} has no source row (${sourceRows.length} source rows)`,
    };
  }
  const cells = splitRow(sourceRow.text);
  const cell = cells[domCol];
  if (!cell) {
    return {
      ...span,
      caret: null,
      reason: `rendered cell ${domCol} has no source cell (row has ${cells.length})`,
    };
  }

  const cellText = cellEl.textContent;
  if (plain(cellText) !== plain(cell.text)) {
    trace?.(
      `table cell DISAGREES row=${domRow} col=${domCol}: rendered="${plain(cellText).slice(0, 40)}" source="${plain(cell.text).slice(0, 40)}"`,
    );
    return {
      ...span,
      caret: null,
      reason: `row ${domRow} col ${domCol} disagrees: rendered "${plain(cellText).slice(0, 24)}" vs source "${plain(cell.text).slice(0, 24)}"`,
    };
  }

  const domOffset = offsetWithin(cellEl, anchor, anchorOffset);
  if (domOffset === null) {
    return { ...span, caret: null, reason: "caret offset inside the cell could not be computed" };
  }
  // Leading whitespace is trimmed on BOTH sides before counting, because the
  // source cell carries markdown padding ("| clean |") that the rendered cell
  // does not ("clean"); counting it would shift the caret one character right.
  const domTrimmed = cellText.trimStart();
  const domSkipped = cellText.length - domTrimmed.length;
  const wanted = stripMarkers(domTrimmed.slice(0, Math.max(0, domOffset - domSkipped))).length;
  const trimmedCell = cell.text.trim();
  const padStart = cell.start + (cell.text.length - cell.text.trimStart().length);
  const inCell = sourceOffsetFor(trimmedCell, wanted);
  if (inCell === null) {
    return {
      ...span,
      caret: null,
      reason: `cell offset ${domOffset} (${wanted} plain chars) did not map into the source cell`,
    };
  }
  const caret = { character: padStart + inCell, line: sourceRow.index };
  trace?.(`table mapped row=${domRow} col=${domCol} -> line=${caret.line} char=${caret.character}`);
  return { ...span, caret };
}
