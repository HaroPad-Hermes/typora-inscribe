/**
 * Reading document text with the plugin's own preview excluded.
 *
 * The inline ghost is real text inside the caret's block — it is inserted into
 * the document so the paragraph reflows around it (see
 * components/inline-ghost.ts). That makes it visible to anything reading the
 * block's text, including the caret derivation, which then compares a block
 * holding typed + preview text against markdown holding only the typed text.
 * No markdown line can match that, so the caret's OWN block reports NO-MATCH and
 * the caller falls back to the stale tracker — the historical "completions are
 * nonsense" failure the floor rule exists to prevent. Reproduced live: markdown
 * one `X`, DOM two, `derived=null`, then a completion built for the stale
 * position.
 *
 * So the derivation must never read its own preview as document text. Every
 * text read on that path goes through here.
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
 * The text of `root`, with any preview subtree left out.
 *
 * @param root - The element to read.
 * @returns Its concatenated text content, excluding previews.
 */
export function textWithoutPreview(root: Node): string {
  let out = "";
  const visit = (node: Node): void => {
    if (isPreviewNode(node)) return;
    if (node.nodeType === TEXT_NODE) {
      out += node.textContent ?? "";
      return;
    }
    for (const child of Array.from(node.childNodes)) visit(child);
  };
  visit(root);
  return out;
}

/**
 * A text-node walker over `root` that skips preview subtrees.
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
    acceptNode: (node) => (isInsidePreview(node) ? FILTER_REJECT : FILTER_ACCEPT),
  });
