import diff from "fast-diff";
import { debounce } from "radash";

import { ChatSession } from "./client/chat";
import { attachChatToggle } from "./chat-toggle";
import CompletionService from "./completions/service";
import { attachSuggestionPanel } from "./components/SuggestionPanel";
import { BUILD, VERSION } from "./constants";
import { diagLog } from "./diag";
import { logger } from "./logging";
import { OpenAICompatibleProvider } from "./providers/openai-compat";
import { settings } from "./settings";
import { getCodeMirror, waitUntilEditorInitialized } from "./typora-utils";
import { computeTextChanges } from "./utils/diff";
import { getCaretCoordinate } from "./utils/dom";
import { Observable } from "./utils/observable";
import { replaceTextByRange } from "./utils/tools";
import type { LspPosition as Position } from "./utils/tools";

import "./styles.scss";

logger.info("Inscribe plugin activated. Version:", VERSION);
diagLog(`[boot] plugin activated: v${VERSION} build ${BUILD} hotkey=${JSON.stringify(settings.triggerHotkey)} apiKey=${settings.apiKey ? "set" : "MISSING"}`);

window.addEventListener("error", (e) => {
  diagLog(`[window.error] ${e.message} @ ${e.filename}:${e.lineno}`);
});
window.addEventListener("unhandledrejection", (e) => {
  diagLog(`[unhandledrejection] ${String((e as PromiseRejectionEvent).reason)}`);
});

/** A completion produced by the FIM service, positioned in the document. */
interface Completion {
  position: Position;
  range: { start: Position; end: Position };
  text: string;
  displayText: string;
}

/** Split markdown at a document position into pre/post cursor text. */
const splitAtPosition = (
  markdown: string,
  position: Position,
): { preCursorText: string; postCursorText: string } => {
  const eol = Files.useCRLF ? "\r\n" : "\n";
  const lines = markdown.split(eol);
  const current = lines[position.line] ?? "";

  const preLines = lines.slice(0, position.line);
  const preCursorText =
    (preLines.length > 0 ? preLines.join(eol) + eol : "") + current.slice(0, position.character);

  const postLines = lines.slice(position.line + 1);
  const postCursorText =
    current.slice(position.character) +
    (postLines.length > 0 ? eol + postLines.join(eol) : "");

  return { preCursorText, postCursorText };
};

/**
 * A manager for completion tasks that makes sure exactly one completion task
 * is active at a time. Replaces typora-copilot's Copilot-LSP-based manager
 * with the FIM completion service.
 */
class CompletionTaskManager {
  private _state: "idle" | "requesting" | "pending" = "idle";
  private activeCleanup: Observable<"accepted" | "rejected"> | null = null;
  private generationId = 0;

  constructor(private service: CompletionService) {}

  get state(): "idle" | "requesting" | "pending" {
    return this._state;
  }

  rejectCurrentIfExist(): void {
    // Invalidate any in-flight generation
    this.generationId++;
    if (this.activeCleanup) {
      this.activeCleanup.next("rejected");
      this.activeCleanup = null;
    }
    void this.service.abort();
    this._state = "idle";
  }

  async start(
    position: Position,
    markdown: string,
    {
      onCompletion,
    }: {
      onCompletion?: (completion: Completion) => Observable<"accepted" | "rejected"> | void;
    },
  ): Promise<boolean> {
    this.rejectCurrentIfExist();
    this._state = "requesting";
    const myId = this.generationId;

    const { preCursorText, postCursorText } = splitAtPosition(markdown, position);
    diagLog(
      `start caret=${JSON.stringify(position)} preLen=${preCursorText.length} postLen=${postCursorText.length}`,
    );
    const result = await this.service.generateCompletion({ preCursorText, postCursorText });

    if (this.generationId !== myId) {
      diagLog("request superseded (rejected / caret moved)");
      return false; // rejected or superseded meanwhile
    }
    if (result === null) {
      diagLog("completion result NULL (nothing to show)");
      this._state = "idle";
      return false;
    }

    this._state = "pending";

    const completion: Completion = {
      position,
      range: { start: position, end: position },
      text: result.text,
      displayText: result.displayText,
    };

    const cleanup = onCompletion?.(completion) ?? new Observable<"accepted" | "rejected">();
    diagLog(`completion ready text=${JSON.stringify(completion.text.slice(0, 80))}`);
    cleanup.subscribeOnce(() => {
      this._state = "idle";
      if (this.activeCleanup === cleanup) this.activeCleanup = null;
    });
    this.activeCleanup = cleanup;
    return true;
  }
}

Promise.defer(async () => {
  await waitUntilEditorInitialized();

  /*****************************
   * Initialize AI services    *
   *****************************/
  const provider = new OpenAICompatibleProvider(settings);
  const completionService = new CompletionService(provider, settings);
  const taskManager = new CompletionTaskManager(completionService);

  /*********************
   * Utility functions *
   *********************/
  /**
   * Insert completion text to editor.
   * @param caretPosition The caret position at request time.
   * @param completion Completion options.
   * @returns
   */
  const insertCompletionTextToEditor = (
    caretPosition: Position,
    completion: Completion,
  ): Observable<"accepted" | "rejected"> | void => {
    const { position, range } = completion;
    let { displayText, text } = completion;

    const activeElement = document.activeElement;
    if (!activeElement) return;

    // When in input, do not insert completion text
    if ("INPUT" === activeElement.tagName || activeElement.classList.contains("ty-input")) return;

    // When not in writer, do not insert completion text
    if ("BODY" === activeElement.tagName) return;

    let mode: NonNullable<CodeMirror.EditorConfiguration["mode"]> | null = null;
    let fontSize: string | null = null;
    let backgroundColor: string | null = null;
    // If in a CodeMirror instance, prune completion text to only include text before code block starter
    if ("TEXTAREA" === activeElement.tagName && getCodeMirror(activeElement)) {
      const cm = getCodeMirror(activeElement)!;

      const startPos = { ...caretPosition };
      startPos.line -=
        cm.getValue(Files.useCRLF ? "\r\n" : "\n").split(Files.useCRLF ? "\r\n" : "\n").length - 1;
      startPos.character -= cm.getCursor().ch;
      if (startPos.character < 0) startPos.character = 0;

      // Get starter of CodeMirror to determine whether it is a code block, formula, etc.
      const cmStarter = state.markdown.split(Files.useCRLF ? "\r\n" : "\n")[startPos.line - 1];

      if (cmStarter) {
        const cmElement = cm.getWrapperElement();

        let handled = false;
        // * Code block *
        if (cmStarter.startsWith("```") || cmStarter.startsWith("~~~")) {
          handled = true;
          const lang = (cmElement as unknown as { lang: string }).lang;
          mode = window.getCodeMirrorMode(lang);
          fontSize = window.getComputedStyle(cmElement).fontSize;
          backgroundColor = window.getComputedStyle(cmElement).backgroundColor;

          // Keep only completion text before code block ender, as in Typora code block it is not possible
          // to insert a new code block or end one using "```" or "~~~"
          const ender = /^(.)\1*/.exec(cmStarter)![0];
          const indexOfEnder = text.indexOf(ender);
          if (indexOfEnder !== -1) {
            displayText = displayText.slice(0, displayText.indexOf(ender));
            text = text.slice(0, indexOfEnder);
            const textAfterEnder = text.slice(indexOfEnder);
            // Reduce `range` to only include text before ender
            const rows = textAfterEnder.split(Files.useCRLF ? "\r\n" : "\n").length - 1;
            range.end.line -= rows;
            range.end.character = textAfterEnder.split(Files.useCRLF ? "\r\n" : "\n").pop()!.length;
          }
        }
        // * Math block *
        else if (cmStarter === "$$") {
          handled = true;
          mode = "stex";

          const match = /(?<!\\)\$\$/.exec(text);
          const indexOfEnder = match ? match.index : -1;
          if (indexOfEnder !== -1) {
            const match = /(?<!\\)\$\$/.exec(displayText);
            if (match) displayText = displayText.slice(0, match.index);
            text = text.slice(0, indexOfEnder);
            const textAfterEnder = text.slice(indexOfEnder);
            // Reduce `range` to only include text before ender
            const rows = textAfterEnder.split(Files.useCRLF ? "\r\n" : "\n").length - 1;
            range.end.line -= rows;
            range.end.character = textAfterEnder.split(Files.useCRLF ? "\r\n" : "\n").pop()!.length;
          }
        }

        if (handled && settings.useInlineCompletionTextInSource) {
          const subCmCompletion = { ...completion };

          // Set `position` and `range` to be relative to `startPos`
          subCmCompletion.position = {
            line: position.line - startPos.line,
            character: position.character - startPos.character,
          };
          subCmCompletion.range = {
            start: {
              line: range.start.line - startPos.line,
              character: range.start.character - startPos.character,
            },
            end: {
              line: range.end.line - startPos.line,
              character: range.end.character - startPos.character,
            },
          };

          return insertCompletionTextToCodeMirror(cm, subCmCompletion);
        }
      }
    }

    const focusedElem = document.querySelector(`[cid=${editor.focusCid}]`);
    if (!focusedElem) return;
    if (!(focusedElem instanceof HTMLElement)) return;

    const pos = getCaretCoordinate();
    if (!pos) return;

    // Insert a suggestion panel below the cursor
    const unattachSuggestionPanel = attachSuggestionPanel(displayText, mode, {
      backgroundColor,
      fontSize,
    });

    const insertCompletionText = () => {
      try {
        // Check whether it is safe to just use `insertText` to insert completion text,
        // as using `reloadContent` uses much more resources and causes a flicker
        const newMarkdown = replaceTextByRange(
          state.markdown,
          range,
          completion.text,
          Files.useCRLF ? "\r\n" : "\n",
        );
        const diffs = diff(state.markdown, newMarkdown).filter((part) => part[0] !== diff.EQUAL);

        if (diffs.length === 1 && diffs[0]![0] === diff.INSERT) {
          diagLog(`insert via editor.insertText: ${JSON.stringify(completion.text.slice(0, 60))}`);
          editor.insertText(diffs[0]![1]);
        } else {
          diagLog(`insert via cm.replaceRange + reloadContent (diffs=${diffs.length})`);
          // @ts-expect-error - CodeMirror supports 2nd parameter, but not declared in types
          cm.setValue(editor.getMarkdown(), "begin");
          cm.setCursor({ line: position.line, ch: position.character });
          cm.replaceRange(
            text,
            { line: range.start.line, ch: range.start.character },
            { line: range.end.line, ch: range.end.character },
          );
          const newMarkdown = cm.getValue(Files.useCRLF ? "\r\n" : "\n");
          const cursorPos = Object.assign(cm.getCursor(), {
            lineText: cm.getLine(cm.getCursor().line),
          });
          Files.reloadContent(newMarkdown, {
            fromDiskChange: false,
            skipChangeCount: true,
            skipStore: false,
          });
          // Restore text cursor position
          sourceView.gotoLine(cursorPos);
          editor.refocus();
        }
      } catch (e) {
        diagLog(`insert EXCEPTION: ${String(e)}`);
        throw e;
      }
    };

    const cleanup = new Observable<"accepted" | "rejected">();
    cleanup.subscribeOnce(() => {
      unattachSuggestionPanel();
      editor.writingArea.removeEventListener("keydown", keydownHandler, true);
      $(editor.writingArea).off("caretMove", caretMoveHandler);
    });

    /**
     * Intercept `Tab` key once and change it to accept completion.
     * @param event The keyboard event.
     */
    const keydownHandler = (event: KeyboardEvent) => {
      // Prevent tab key to trigger tab once
      if (event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        insertCompletionText();
        cleanup.next("accepted");
      }
    };
    editor.writingArea.addEventListener("keydown", keydownHandler, true);

    const caretMoveHandler = () => {
      cleanup.next("rejected");
    };
    $(editor.writingArea).on("caretMove", caretMoveHandler);

    return cleanup;
  };

  /**
   * Insert completion text to CodeMirror.
   * @param cm The CodeMirror instance.
   * @returns
   */
  const insertCompletionTextToCodeMirror = (
    cm: CodeMirror.Editor,
    { displayText, position, range, text }: Completion,
  ): Observable<"accepted" | "rejected"> | void => {
    interface CodeMirrorHistory {
      done: readonly object[];
      undone: readonly object[];
    }

    const cloneHistory = (history: CodeMirrorHistory): CodeMirrorHistory => ({
      done: history.done.map((item) =>
        "primIndex" in item ?
          new (item.constructor as any)([...(item as any).ranges], item.primIndex)
        : { ...item, changes: [...(item as any).changes] },
      ),
      undone: history.undone.map((item) =>
        "primIndex" in item ?
          new (item.constructor as any)([...(item as any).ranges], item.primIndex)
        : { ...item, changes: [...(item as any).changes] },
      ),
    });

    const cursorBefore = cm.getCursor();
    const historyBefore = cloneHistory(cm.getHistory() as CodeMirrorHistory);
    const commandStackBefore = editor.undo.commandStack.map((item) => ({
      ...item,
      undo: [...item.undo],
      redo: [...item.redo],
    }));
    state.suppressMarkdownChange++;
    cm.replaceRange(displayText, { line: position.line, ch: position.character });
    const cursorAfter = cm.getCursor();
    cm.setCursor(cursorBefore);
    const textMarker = cm.markText({ line: position.line, ch: position.character }, cursorAfter, {
      className: "text-gray font-italic",
    });

    // Force set `history.undone` to enable redo.
    // The first redo after it should be intercepted and then reject the completion (the history
    // will be restored to `historyBefore`), so the editor state will not be corrupted.
    cm.setHistory({
      done: (cm.getHistory() as CodeMirrorHistory).done,
      undone: historyBefore.undone,
    });

    // Remove the last registered operation command, so the completion text will not be
    // registered as a new operation command
    if (!sourceView.inSourceMode) editor.undo.removeLastRegisteredOperationCommand();

    /**
     * Reject the completion.
     *
     * **Warning:** It should only be called when no more changes is applied after
     * completion text is inserted, otherwise history will be corrupted.
     */
    let rejectedOrAccepted = false;
    const reject = () => {
      const textMarkerRange = textMarker.find();
      if (!textMarkerRange) {
        cleanup.next("rejected");
        return;
      }
      const { from, to } = textMarkerRange;

      state.suppressMarkdownChange++;
      cm.replaceRange("", from, to);
      cm.setHistory(historyBefore);

      if (!sourceView.inSourceMode) {
        editor.undo.commandStack.length = 0;
        Array.prototype.push.apply(editor.undo.commandStack, commandStackBefore);
      }

      cleanup.next("rejected");
    };
    /**
     * Accept the completion.
     */
    const accept = () => {
      // Clear completion hint
      const textMarkerRange = textMarker.find();
      if (!textMarkerRange) {
        cleanup.next("rejected");
        return;
      }
      const { from, to } = textMarkerRange;

      state.suppressMarkdownChange++;
      cm.replaceRange("", from, to);
      cm.setHistory(historyBefore);

      if (!sourceView.inSourceMode) {
        editor.undo.commandStack.length = 0;
        Array.prototype.push.apply(editor.undo.commandStack, commandStackBefore);
      }

      // Insert completion text
      cm.replaceRange(
        text,
        { line: range.start.line, ch: range.start.character },
        { line: range.end.line, ch: range.end.character },
      );

      cleanup.next("accepted");
    };

    const cleanup = new Observable<"accepted" | "rejected">();
    cleanup.subscribeOnce(() => {
      cm.off("keydown", cmTabFixer);
      cm.off("beforeChange", cmChangeFixer);
      cm.off("cursorActivity", cursorMoveHandler);
    });

    /**
     * Intercept `Tab` key once and change it to accept completion.
     * @param _cm The CodeMirror instance.
     * @param event The keyboard event.
     */
    const cmTabFixer = (_cm: CodeMirror.Editor, event: KeyboardEvent) => {
      if (rejectedOrAccepted) return;

      // Prevent tab key to accept completion
      if (event.key === "Tab") {
        event.preventDefault();
        rejectedOrAccepted = true;
        accept();
      }
    };
    cm.on("keydown", cmTabFixer);

    /**
     * Reject completion before any change applied.
     * @param cm The CodeMirror instance.
     * @param change The change.
     */
    const cmChangeFixer = (cm: CodeMirror.Editor, change: CodeMirror.EditorChangeCancellable) => {
      if (rejectedOrAccepted) return;
      rejectedOrAccepted = true;

      const { from, origin, text, to } = change;

      // Cancel the change temporarily
      change.cancel();
      // Reject completion and redo the change after 1 tick
      // It is to make sure these changes are applied after the `"beforeChange"` event
      // has finished, in order to avoid corrupting the CodeMirror instance
      void Promise.resolve().then(() => {
        reject();
        if (origin === "undo" || origin === "redo") {
          if (sourceView.inSourceMode) cm[origin]();
          else editor.undo[origin]();
        } else {
          cm.replaceRange(text.join(Files.useCRLF ? "\r\n" : "\n"), from, to, origin);
        }
      });
    };
    cm.on("beforeChange", cmChangeFixer);

    /**
     * Reject completion if cursor moved.
     */
    const cursorMoveHandler = () => {
      if (rejectedOrAccepted) return;
      rejectedOrAccepted = true;

      reject();
    };
    cm.on("cursorActivity", cursorMoveHandler);

    return cleanup;
  };

  /**
   * Insert suggestion panel to CodeMirror.
   * @param cm The CodeMirror instance.
   * @returns
   */
  const insertSuggestionPanelToCodeMirror = (
    cm: CodeMirror.Editor,
    { displayText, range, text }: Completion,
  ): Observable<"accepted" | "rejected"> | void => {
    // Insert a suggestion panel below the cursor
    const unattachSuggestionPanel = attachSuggestionPanel(displayText, null, { cm });

    const insertCompletionText = () => {
      // Insert completion text
      cm.replaceRange(
        text,
        { line: range.start.line, ch: range.start.character },
        { line: range.end.line, ch: range.end.character },
      );
    };

    const cleanup = new Observable<"accepted" | "rejected">();
    cleanup.subscribeOnce(() => {
      unattachSuggestionPanel();
      cm.off("keydown", keydownHandler);
      cm.off("cursorActivity", cursorMoveHandler);
    });

    /**
     * Intercept `Tab` key once and change it to accept completion.
     * @param event The keyboard event.
     */
    const keydownHandler = (_: CodeMirror.Editor, event: KeyboardEvent) => {
      // Prevent tab key to trigger tab once
      if (event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        insertCompletionText();
        cleanup.next("accepted");
      }
    };
    cm.on("keydown", keydownHandler);

    /**
     * Reject completion if cursor moved.
     */
    const cursorMoveHandler = () => {
      cleanup.next("rejected");
    };
    cm.on("cursorActivity", cursorMoveHandler);

    return cleanup;
  };

  /*******************
   * Trigger logic    *
   *******************/

  /* "✦ …" indicator shown while a manual request is in flight, so the user
   * knows the keypress was registered even before the ghost appears. */
  let requestingIndicator: HTMLDivElement | null = null;
  let requestingTimer: ReturnType<typeof setTimeout> | null = null;
  const hideRequestingIndicator = () => {
    requestingIndicator?.remove();
    requestingIndicator = null;
    if (requestingTimer) {
      clearTimeout(requestingTimer);
      requestingTimer = null;
    }
  };
  const showRequestingIndicator = (): void => {
    hideRequestingIndicator();
    const pos = getCaretCoordinate();
    if (!pos) return;
    const el = document.createElement("div");
    el.textContent = "✦ …";
    el.style.cssText =
      "position:fixed;z-index:99999;font-size:12px;color:#888;pointer-events:none;font-family:inherit;" +
      `left:${pos.x}px;top:${pos.y + 24}px;`;
    document.body.appendChild(el);
    requestingIndicator = el;
  };
  /** Flash "no suggestion" feedback when a manual request found nothing. */
  const flashNoSuggestion = (): void => {
    if (requestingIndicator) requestingIndicator.textContent = "✦ no suggestion";
    requestingTimer = setTimeout(hideRequestingIndicator, 900);
  };

  /* The actual completion request — shared by auto-trigger and hotkey. */
  /* Show ~15 chars before/after a position for diag verification. */
  const ctxAround = (md: string, p: Position): string => {
    const eol = Files.useCRLF ? "\r\n" : "\n";
    const lines = md.split(eol);
    let off = 0;
    for (let i = 0; i < p.line && i < lines.length; i++) off += (lines[i]?.length ?? 0) + eol.length;
    off += p.character;
    return md.slice(Math.max(0, off - 15), off) + "␂" + md.slice(off, off + 15);
  };

  /* Derive the caret directly from the live DOM selection at trigger time.
   * Walks the top-level blocks of the editor (flattening list items), matches
   * each block's rendered text to its markdown line SEQUENTIALLY, and computes
   * the caret's {line, character} exactly — including `- ` bullets, heading
   * markers, and block newlines that the naive text-node TreeWalker missed.
   * Falls back to tracked when matching fails (code blocks, tables, wrapped
   * paragraphs). */
  const deriveCaretFromDomSelection = (markdown: string): Position | null => {
    try {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
      const anchor = sel.anchorNode;
      if (!anchor || !editor.writingArea.contains(anchor)) return null;
      const elem = anchor.nodeType === Node.TEXT_NODE ? anchor.parentElement : (anchor as Element);
      if (!elem || elem.closest(".CodeMirror") || elem.closest("input") || elem.classList?.contains("ty-input"))
        return null;

      const norm = markdown.replace(/\r\n/g, "\n");
      const lines = norm.split("\n");

      // Find the caret's block: walk up to the top-level block (direct child
      // of #write), or the closest list item / mdtype element.
      let caretBlock: Element | null = elem;
      while (caretBlock && caretBlock.parentElement && caretBlock.parentElement !== editor.writingArea) {
        if (caretBlock.tagName === "LI" || caretBlock.classList.contains("md-list-item")) break;
        caretBlock = caretBlock.parentElement;
      }
      if (!caretBlock || caretBlock === editor.writingArea)
        caretBlock = elem.closest("li, [mdtype]") || elem;
      if (!caretBlock || caretBlock === editor.writingArea) return null;

      const caretBlockText = (caretBlock.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!caretBlockText) return null;

      // Sequential matching: walk top-level blocks, matching each to the next
      // markdown line. Handles repeated lines and multi-line blocks.
      let mdLineIdx = 0;
      const matchBlockToLine = (blockText: string, fromIdx: number): number => {
        for (let i = fromIdx; i < lines.length; i++) {
          const stripped = lines[i]!
            .replace(/^[-*+]\s+/, "") // "- ", "* ", "+ "
            .replace(/^\d+[.)]\s+/, "") // "1. ", "2) "
            .replace(/^#{1,6}\s+/, "") // "## "
            .replace(/^>\s?/, "") // "> "
            .replace(/^```.*$/, "") // code fence markers
            .replace(/\s+/g, " ").trim();
          if (stripped === blockText) return i;
        }
        return -1;
      };

      const forEachTopBlock = (
        root: Element,
        fn: (el: Element, isCaret: boolean) => boolean | void,
      ): boolean => {
        for (const child of root.children) {
          if (child.nodeType !== Node.ELEMENT_NODE) continue;
          if (child.tagName === "UL" || child.tagName === "OL") {
            for (const li of child.children) {
              if (li.nodeType !== Node.ELEMENT_NODE) continue;
              const stop = fn(li as Element, li === caretBlock || li.contains(caretBlock));
              if (stop) return true;
            }
          } else {
            const stop = fn(child as Element, child === caretBlock || child.contains(caretBlock));
            if (stop) return true;
          }
        }
        return false;
      };

      let result: Position | null = null;
      forEachTopBlock(editor.writingArea, (el, isCaret) => {
        const blockText = (el.textContent ?? "").replace(/\s+/g, " ").trim();
        const matched = matchBlockToLine(blockText, mdLineIdx);
        if (matched < 0) return false; // skip unmatched (code/table)
        if (isCaret) {
          // Compute intra-block offset, handling both text-node anchors
          // (common in mid-paragraph) and element anchors (common when
          // clicking at the end of a line, where the browser sets
          // anchorNode to the block element with anchorOffset = child count).
          const intraOffset = ((): number => {
            if (anchor.nodeType === Node.TEXT_NODE) {
              const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
              let acc = 0;
              for (let n = walker.nextNode(); n; n = walker.nextNode()) {
                if (n === anchor) return acc + sel.anchorOffset;
                acc += n.textContent?.length ?? 0;
              }
              return -1;
            }
            // Element anchor: caret at node boundary in `anchor`.
            // Walk the block's flattened nodes, accumulating text before
            // the boundary inside `anchor`.
            const collectBefore = (node: Node, target: Node, off: number): boolean => {
              if (node === target) {
                for (let i = 0; i < off; i++)
                  acc += (target.childNodes[i]?.textContent ?? "").length;
                return true;
              }
              if (node.nodeType === Node.TEXT_NODE) {
                acc += node.textContent?.length ?? 0;
                return false;
              }
              for (const ch of node.childNodes)
                if (collectBefore(ch, target, off)) return true;
              return false;
            };
            let acc = 0;
            if (!collectBefore(el, anchor, sel.anchorOffset)) return -1;
            return acc;
          })();
          if (intraOffset < 0) return false;
          const raw = lines[matched]!;
          const bulletLen = (raw.match(/^([-*+]\s+|\d+[.)]\s+|#{1,6}\s+|>\s?)/)?.[1] ?? "").length;
          result = { line: matched, character: bulletLen + intraOffset };
          return true;
        }
        // Preceding block: advance past its line. Blank lines between blocks
        // are skipped by the forward search. Do NOT try to count how many
        // lines a block spans — a UL's textContent is all its items
        // concatenated (never matching a single markdown line), so the old
        // heuristic ran to the end of the document and desynced every
        // subsequent list-item match (breaks all triggers after a list).
        mdLineIdx = matched + 1;
        return false;
      });

      return result;
    } catch (e) {
      diagLog(`deriveCaret EXCEPTION: ${String(e)}`);
      return null;
    }
  };

  const doTrigger = (manual = false): void => {
    if (settings.disableCompletions) return;
    if (!settings.apiKey) {
      diagLog("trigger: NO API KEY — returning");
      if (manual) flashNoSuggestion();
      return;
    }

    /* Prefer a fresh DOM-derived caret. The change-event tracker only updates
     * on markdown EDITS — it goes stale the moment the user clicks/moves the
     * caret without typing, and every subsequent trigger then uses the old
     * position (seen in logs: tracked frozen at the last accepted insert
     * while derived tracked the real caret across lines). The block-matching
     * derivation reads the live selection and accounts for list bullets,
     * heading markers and block newlines exactly. */
    const tracked = state.caretPosition;
    const derived = deriveCaretFromDomSelection(state.markdown);
    const caretPosition = derived ?? tracked;
    diagLog(
      `trigger${manual ? " (manual)" : ""} caret=${JSON.stringify(caretPosition)} source=${derived ? "dom" : "tracked"} ` +
        `tracked=${JSON.stringify(tracked)} derived=${JSON.stringify(derived)}` +
        (caretPosition ? ` ctx=${JSON.stringify(ctxAround(state.markdown, caretPosition))}` : ""),
    );
    if (caretPosition) {
      logger.debug("Triggering completion at", caretPosition);
      if (manual) showRequestingIndicator();
      void taskManager
        .start(caretPosition, state.markdown, {
          onCompletion: (completion) => {
            if (editor.sourceView.inSourceMode)
              if (settings.useInlineCompletionTextInSource)
                return insertCompletionTextToCodeMirror(cm, completion);
              else return insertSuggestionPanelToCodeMirror(cm, completion);
            else return insertCompletionTextToEditor(caretPosition, completion);
          },
        })
        .then((shown) => {
          if (manual) {
            hideRequestingIndicator();
            if (!shown) flashNoSuggestion();
          }
        });
    } else if (manual) {
      diagLog("manual trigger: no caret position (derivation failed, tracker null)");
      flashNoSuggestion();
    }
  };

  /* Auto-trigger: debounced on document change. Disabled when a manual
   * trigger hotkey is configured (Inscribe-style). */
  const triggerCompletion = debounce({ delay: 500 }, () => {
    if (settings.triggerHotkey) return; // manual mode: no auto-trigger
    doTrigger(false);
  });

  /* Manual trigger hotkey, e.g. "ctrl+space" (Inscribe-style). */
  const parseHotkey = (spec: string): { key: string; mods: Set<string> } | null => {
    const parts = spec.trim().toLowerCase().split("+").map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) return null;
    const key = parts.pop()!;
    const mods = new Set(parts);
    return { key, mods };
  };
  const hotkeyHandler = (event: KeyboardEvent): void => {
    const parsed = parseHotkey(settings.triggerHotkey);
    if (!parsed) return;
    // Never steal keys while typing in inputs (chat box, settings, search).
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

    const key = event.key.toLowerCase();
    const isKey =
      key === parsed.key ||
      (parsed.key === "space" && (key === " " || key === "spacebar"));
    if (!isKey) return;
    const mods = parsed.mods;
    const has = (m: string) =>
      m === "ctrl" ? event.ctrlKey : m === "shift" ? event.shiftKey : m === "alt" ? event.altKey : m === "meta" ? event.metaKey : false;
    if (mods.size !== ["ctrl", "shift", "alt", "meta"].filter(has).length) return;
    for (const m of mods) if (!has(m)) return;

    diagLog(`manual hotkey pressed: ${settings.triggerHotkey}`);
    event.preventDefault();
    event.stopPropagation();
    doTrigger(true);
  };
  document.addEventListener("keydown", hotkeyHandler, true);

  /*********************
   * Initialize states *
   *********************/
  const editor = Files.editor as Typora.EnhancedEditor;
  // Initialize state
  const initialMarkdown = editor.getMarkdown();
  const state = {
    markdownUsedInLastCompletion: initialMarkdown,
    markdown: initialMarkdown,
    caretPosition: { line: 0, character: 0 } as Position | null,
    _actualLatestMarkdown: initialMarkdown,
    suppressMarkdownChange: 0,
  };
  ChatSession.currentDocument = initialMarkdown;
  // Initialize CodeMirror
  const sourceView = editor.sourceView as Typora.EnhancedSourceView;
  if (!sourceView.cm) sourceView.prep();
  const cm = sourceView.cm!;

  /***********
   * UI Misc *
   ***********/
  attachChatToggle();

  /************
   * Watchers *
   ************/

  /* Reject completion on toggle source mode */
  sourceView.on("beforeToggle", (_, on) => {
    if (taskManager.state === "pending") {
      logger.debug(`Refusing completion before toggling source mode ${on ? "on" : "off"}`);
      taskManager.rejectCurrentIfExist();
    }
  });

  /* Watch for markdown change in live preview mode */
  editor.on("change", (_, { newMarkdown }) => {
    if (settings.disableCompletions) return;
    if (sourceView.inSourceMode) return;

    // If not literally changed, simply return
    if (newMarkdown === state._actualLatestMarkdown) return;
    // If literally changed, update current actual markdown text
    state._actualLatestMarkdown = newMarkdown;
    // If update suppressed, return
    if (state.suppressMarkdownChange) {
      state.suppressMarkdownChange--;
      return;
    }

    /* When update not suppressed */
    // Update caret position
    const rangyRange = (editor.selection as any)?.getRangy?.();
    const caretCollapsed = rangyRange ? rangyRange.collapsed === true : undefined;
    if (caretCollapsed === true && window.getSelection()?.rangeCount) {
      const changes = computeTextChanges(state.markdown, newMarkdown, state.caretPosition);
      if (changes.length === 1) {
        const change = changes[0]!;
        const changeLines = change.text.split(Files.useCRLF ? "\r\n" : "\n").length - 1;
        state.caretPosition = {
          line: change.range.start.line + changeLines,
          character:
            changeLines === 0 ?
              change.range.start.character + change.text.length
            : change.text.lastIndexOf(Files.useCRLF ? "\r\n" : "\n") - 1,
        };

        // Fix code blocks, math blocks and HTML blocks caret position
        // When creating these blocks, Typora place the caret in the middle of the block,
        // instead of at the end of the block
        if (
          // If it is an insert operation
          change.range.start.line === change.range.end.line &&
          change.range.start.character === change.range.end.character &&
          // If not in input
          !document.activeElement?.classList.contains("ty-input")
          // If in a CodeMirror instance
        ) {
          // The line of the starter (```, ~~~, $$, <div>, etc.)
          let starterLine =
            change.range.start.character === 0 ?
              change.range.start.line - 1
            : change.range.start.line;

          const lines = newMarkdown.split(Files.useCRLF ? "\r\n" : "\n");
          if (lines[starterLine] === "") starterLine--;
          const lineText = lines[starterLine];

          let starter: string | undefined = undefined;
          let ender: string | undefined = undefined;

          if (lineText) {
            const unindentedLineText = lineText.replace(/^(\s|>)*/, "");

            // * Code block *
            if (
              // Check if the caret is inside a CodeMirror instance
              document.activeElement?.tagName === "TEXTAREA" &&
              (starter = /^(```([^`]|$)|~~~([^~]|$))/.exec(unindentedLineText)?.[0]?.slice(0, 3))
            ) {
              ender = starter;
            }
            // * Math block *
            // NOTE: Typora renders the CodeMirror instance of a math/HTML block in an async way,
            // so we cannot check if the caret is inside a CodeMirror instance like what we did
            // in code blocks checking
            else if (unindentedLineText === "$$" && change.text.trimEnd().endsWith("$$")) {
              starter = ender = "$$";
            }
            // * HTML block *
            else if (
              (starter = /^<[^>]*>/.exec(unindentedLineText)?.[0]) &&
              change.text.trimEnd().endsWith(`</${starter.slice(1, -1)}>`)
            ) {
              ender = `</${starter.slice(1, -1)}>`;
            }

            if (starter && ender) {
              const caretLine = starterLine + 1;
              const caretLineText = lines[caretLine];
              if (caretLineText !== undefined)
                state.caretPosition = {
                  line: caretLine,
                  character:
                    caretLineText.replace(/^(\s|>)*/, "") === ender ? 0 : caretLineText.length,
                };
            }
          }
        }

        // Set `character` to 0 if it is negative
        if (state.caretPosition.character < 0) state.caretPosition.character = 0;
      } else {
        state.caretPosition = null;
      }
    } else {
      state.caretPosition = null;
    }
    // Update current markdown text
    state.markdown = newMarkdown;
    ChatSession.currentDocument = newMarkdown;
    // Reject last completion if exists
    taskManager.rejectCurrentIfExist();
    // Trigger completion
    triggerCompletion();
  });

  /* Watch for markdown change in source mode */
  cm.on("change", (cm): void => {
    if (settings.disableCompletions) return;
    if (!editor.sourceView.inSourceMode) return;

    const newMarkdown = cm.getValue(Files.useCRLF ? "\r\n" : "\n");
    // If not literally changed, simply return
    if (newMarkdown === state._actualLatestMarkdown) return;
    // If literally changed, update current actual markdown text
    state._actualLatestMarkdown = newMarkdown;
    // If update suppressed, return
    if (state.suppressMarkdownChange) {
      state.suppressMarkdownChange--;
      return;
    }

    /* When update not suppressed */
    // Update caret position if not selecting text
    if (!cm.getSelection()) {
      state.caretPosition = {
        line: cm.getCursor().line,
        character: cm.getCursor().ch,
      };
    } else {
      state.caretPosition = null;
    }
    // Update current markdown text
    state.markdown = newMarkdown;
    ChatSession.currentDocument = newMarkdown;
    // Reject last completion if exists
    taskManager.rejectCurrentIfExist();
    // Trigger completion
    triggerCompletion();
  });

  /* Cancel current request on caret move */
  $(editor.writingArea).on("caretMove", () => {
    if (settings.disableCompletions) return;
    if (sourceView.inSourceMode) return;

    taskManager.rejectCurrentIfExist();
  });
  cm.on("cursorActivity", () => {
    if (settings.disableCompletions) return;
    if (!editor.sourceView.inSourceMode) return;

    taskManager.rejectCurrentIfExist();
  });
}).catch((err) => {
  throw err;
});