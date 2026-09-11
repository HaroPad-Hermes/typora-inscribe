/**
 * Reading document text, with everything that is not document text left out.
 *
 * Two kinds of non-document text sit inside a block's DOM and both have caused
 * a corrupt caret derivation:
 *
 *   - the plugin's own inline ghost. It is real text inside the caret's block
 *     (inserted so the paragraph reflows around it — see
 *     `components/inline-ghost.ts`), so anything reading the block's text saw
 *     typed + preview text while the markdown held only the typed text. No
 *     markdown line can match that, so the caret's OWN block reported NO-MATCH
 *     and the caller fell back to the stale tracker — the historical
 *     "completions are nonsense" failure the floor rule exists to prevent.
 *   - text the user cannot see. A live fence's `textContent` carried a leading
 *     `"x "` that is in no markdown line and in no accessibility tree: a hidden
 *     widget inside the fence container (CodeMirror's measurement node is the
 *     shape of it, and its hidden input is a form control whose content is a
 *     value rather than text). Whitespace-insensitive matching cannot
 *     absorb that, so the block stayed unmapped for a reason the log did not
 *     name.
 *
 * So the rule is: a text read on the matching path includes only text that is
 * rendered. Form controls never contribute (their content is a value); hidden
 * subtrees never contribute.
 *
 * Both exports walk the same tree in the same way on purpose: the caller
 * accumulates the same nodes the walker yields, so offsets computed from the
 * walker stay consistent with the string the matcher compares. Change one rule
 * here and both stay in step.
 */

/** Class on the inline ghost span. One definition, used by the ghost renderer. */
export const PREVIEW_CLASS = "inscribe-ghost";

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
/** `NodeFilter.SHOW_TEXT` — spelled out because this module has no DOM imports. */
export const SHOW_TEXT = 4;
export const FILTER_ACCEPT = 1;
export const FILTER_REJECT = 2;

/**
 * Tags whose content is a value rather than rendered text. A code fence's
 * CodeMirror instance holds a hidden textarea for input, and reading it as
 * document text is one known source of a phantom token.
 */
const FORM_CONTROL_TAGS = new Set(["TEXTAREA", "INPUT", "SELECT"]);

/**
 * True when `node` is itself a preview element.
 *
 * @param node - The node to test.
 * @returns Whether the node is the preview container.
 */
export const isPreviewNode = (node: Node | null): boolean => {
  if (node?.nodeType !== ELEMENT_NODE) return false;
  return (node as Element).classList.contains(PREVIEW_CLASS);
};

/**
 * True when an element cannot contribute rendered text.
 *
 * Inline styles are checked directly so the rule holds without a style engine;
 * computed styles are consulted as well, because the widget that produced the
 * observed phantom `"x "` is hidden by a class, not by an inline style. A
 * `visibility: hidden` subtree whose descendant restores `visibility: visible`
 * would be skipped here — that shape does not occur in the editor's blocks, and
 * the alternative is to keep matching against text nobody can see.
 *
 * @param node - The node to test.
 * @returns Whether the node is a form control or is hidden.
 */
export const isUnrenderedNode = (node: Node | null): boolean => {
  if (node?.nodeType !== ELEMENT_NODE) return false;
  const element = node as Element;
  if (FORM_CONTROL_TAGS.has(element.tagName)) return true;
  if (element.hasAttribute("hidden")) return true;

  const inline = (element as HTMLElement).style;
  if (inline.display === "none" || inline.visibility === "hidden") return true;

  const view = element.ownerDocument.defaultView;
  if (!view?.getComputedStyle) return false;
  try {
    const computed = view.getComputedStyle(element);
    return computed.display === "none" || computed.visibility === "hidden";
  } catch {
    // A detached node has no computed style; treat it as rendered rather than
    // silently dropping text the caller may be measuring against.
    return false;
  }
};

/**
 * True when `node` is the preview, or sits inside an unrendered subtree.
 *
 * The walk is bounded by `root`, so a hidden container ABOVE the block (a
 * collapsed pane, an inactive tab) never makes the whole block read as empty.
 *
 * @param node - The node to test.
 * @param root - The block being read; the walk stops here.
 * @returns Whether the node must be skipped.
 */
export const isInsideUnrendered = (node: Node | null, root: Node): boolean => {
  if (!node) return false;
  const start = node.nodeType === ELEMENT_NODE ? (node as Element) : node.parentElement;
  let current: Element | null = start;
  while (current && current !== root) {
    if (isUnrenderedNode(current)) return true;
    current = current.parentElement;
  }
  return false;
};

/**
 * True when `node` sits inside a preview subtree.
 *
 * @param node - The node to test.
 * @returns Whether the node is part of the plugin's own preview.
 */
export const isInsidePreview = (node: Node | null): boolean => {
  if (!node) return false;
  const element = node.nodeType === ELEMENT_NODE ? (node as Element) : node.parentElement;
  return element?.closest(`.${PREVIEW_CLASS}`) != null;
};

/**
 * The text of `root`, with previews and unrendered subtrees left out.
 *
 * `root` itself is never skipped: the caller passes the caret's block, which is
 * rendered by definition.
 *
 * @param root - The element to read.
 * @returns Its concatenated rendered text.
 */
export function textWithoutPreview(root: Node): string {
  let out = "";
  const visit = (node: Node, isRoot: boolean): void => {
    if (!isRoot && (isPreviewNode(node) || isUnrenderedNode(node))) return;
    if (node.nodeType === TEXT_NODE) {
      out += node.textContent ?? "";
      return;
    }
    for (const child of Array.from(node.childNodes)) visit(child, false);
  };
  visit(root, true);
  return out;
}

/**
 * A text-node walker over `root` that skips previews and unrendered subtrees.
 *
 * The caller accumulates the same nodes this yields, so the offsets it computes
 * stay consistent with {@linkcode textWithoutPreview}.
 *
 * @param doc - The owning document.
 * @param root - The subtree to walk.
 * @returns A walker yielding text nodes outside the preview.
 */
export const textWalkerWithoutPreview = (doc: Document, root: Node): TreeWalker =>
  doc.createTreeWalker(root, SHOW_TEXT, {
    acceptNode: (node) =>
      isInsidePreview(node) || isInsideUnrendered(node, root) ? FILTER_REJECT : FILTER_ACCEPT,
  });
