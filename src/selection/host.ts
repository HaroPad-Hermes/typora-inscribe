/**
 * The selection action host: bar, model, preview, accepted edit.
 *
 * This is the only place the pieces meet, and it stays thin — every decision it
 * could get wrong lives in a tested module beside it. What is left here is glue
 * plus four rules worth stating:
 *
 *   - an edit is applied to the document the user can see RIGHT NOW. The
 *     markdown and the range are read again at run time, not carried over from
 *     when the bar opened, because reloading stale text would silently revert
 *     anything typed in between;
 *   - nothing is applied without an accept. A refusal is logged and left
 *     visible; it is never turned into a best guess;
 *   - the request is the reference implementation's shape: the selection is
 *     MARKED, its neighbours are tagged context, and `thinking` is off unless
 *     the bar's toggle says otherwise;
 *   - the bar appears only once the selection has settled (the reference's
 *     350ms debounce), so it never chases the drag.
 */

import { attachSelectionMenu } from "../components/selection-menu";
import type { SelectionMenuHandle } from "../components/selection-menu";
import { attachEditPreview } from "../components/selection-preview";
import { diagLog } from "../diag";
import { OpenAICompatibleProvider } from "../providers/openai-compat";
import type { ChatMessage, GenerateOnceOptions } from "../providers/provider";
import { settings } from "../settings";

import { SELECTION_MAX_TOKENS, SELECTION_PRESETS, buildRewriteMessages } from "./actions";
import { caretAfter, describeEditRefusal, offsetAt, planEdit } from "./edit-plan";
import type { EditPlan } from "./edit-plan";
import { describeRangeRefusal, rangeStillHolds, selectionRange } from "./range";
import type { SelectionRangeResult } from "./range";
import { describeRefusal, readSelection, selectionSignature } from "./selection";
import type { SelectedText } from "./selection";

/** The plugin's own UI must never be read as document text. */
const INSIDE_OUR_UI = "inside-inscribe-ui";
/** How long the selection must be still before the bar appears. */
const SHOW_DELAY_MS = 350;

export interface SelectionHostOptions {
  /**
   * The model call. Defaults to the configured provider; injected by tests so
   * the flow can be driven end to end without a request (or a key).
   */
  generate?: (messages: ChatMessage[], opts: GenerateOnceOptions) => Promise<string>;
}

/**
 * Attach the selection actions.
 *
 * @param options - Optional model call override, for tests.
 * @returns A function that detaches everything it attached.
 */
export function attachSelectionActions(options: SelectionHostOptions = {}): () => void {
  const provider = new OpenAICompatibleProvider(settings);
  const generate = options.generate ?? provider.generateOnce.bind(provider);
  let bar: SelectionMenuHandle | null = null;
  let lastSignature = "";
  let inFlight = false;
  let showTimer: number | null = null;

  const editorNow = (): Typora.EnhancedEditor | null =>
    (Files.editor as Typora.EnhancedEditor | undefined) ?? null;

  const applyEdit = (plan: EditPlan): void => {
    const editor = editorNow();
    if (!editor) {
      diagLog("selection edit: no editor to apply to");
      return;
    }
    try {
      const eol = Files.useCRLF ? "\r\n" : "\n";
      Files.reloadContent(plan.after, {
        fromDiskChange: false,
        skipChangeCount: true,
        skipStore: false,
      });
      const caret = caretAfter(plan.range, plan.replacement);
      const lineText = plan.after.split(eol)[caret.line] ?? "";
      editor.sourceView.gotoLine({ line: caret.line, ch: caret.character, lineText });
      editor.refocus();
      diagLog(
        `selection edit applied: ${JSON.stringify(plan.before.slice(0, 40))} -> ` +
          JSON.stringify(plan.replacement.slice(0, 40)),
      );
    } catch (error) {
      // reloadContent can throw on a malformed range; say so rather than
      // leaving a half-applied document unexplained.
      diagLog(`selection edit FAILED to apply: ${String(error)}`);
    }
  };

  const run = (
    instruction: string,
    thinking: boolean,
    selection: SelectedText,
    mapping: SelectionRangeResult,
  ): void => {
    if (inFlight) return;
    const editor = editorNow();
    if (!editor) return;
    // Any refusal hands the bar back so the user can try another action
    // instead of watching a frozen toolbar.
    const refuse = (message: string): void => {
      diagLog(message);
      bar?.setBusy(false);
    };

    const eol = Files.useCRLF ? "\r\n" : "\n";
    const markdown = editor.getMarkdown();
    if (!mapping.ok) {
      refuse(`selection action refused: ${describeRangeRefusal(mapping.reason)}`);
      return;
    }
    // The span was captured when the bar opened; the live selection is gone by
    // now (clicking the bar's field collapses it), so validate the captured
    // span against the current document instead.
    if (!rangeStillHolds(markdown, mapping.range, selection.text, eol)) {
      refuse(`selection action refused: ${describeRangeRefusal("selection-changed")}`);
      return;
    }

    const start = offsetAt(markdown, mapping.range.start, eol);
    const end = offsetAt(markdown, mapping.range.end, eol);
    inFlight = true;
    diagLog(
      `selection action ${JSON.stringify(instruction.slice(0, 40))} thinking=${String(thinking)}: ` +
        JSON.stringify(selection.text.slice(0, 40)),
    );
    void generate(
      buildRewriteMessages({
        instruction,
        selection: selection.text,
        before: markdown.slice(0, Math.max(0, start)),
        after: markdown.slice(Math.max(0, end)),
      }),
      {
        model: settings.model,
        maxTokens: SELECTION_MAX_TOKENS,
        temperature: settings.temperature,
        thinking: thinking ? "enabled" : "disabled",
      },
    )
      .then((answer) => {
        const planned = planEdit({
          markdown: editorNow()?.getMarkdown() ?? markdown,
          range: mapping.range,
          passage: selection.text,
          answer,
          eol,
        });
        if (!planned.ok) {
          const hint =
            planned.reason === "empty-output" && thinking ?
              " (thinking spent the budget — try the Think toggle off)"
            : "";
          refuse(`selection edit refused: ${describeEditRefusal(planned.reason)}${hint}`);
          return;
        }
        bar?.remove();
        bar = null;
        attachEditPreview({
          rect: selection.rect,
          title: instruction.slice(0, 40),
          passage: planned.plan.before,
          replacement: planned.plan.replacement,
          boundaryRight: undefined,
          onAccept: () => applyEdit(planned.plan),
        });
      })
      .catch((error: unknown) => {
        refuse(`selection action failed: ${String(error)}`);
      })
      .finally(() => {
        inFlight = false;
      });
  };

  const offerMenu = (): void => {
    if (showTimer !== null) window.clearTimeout(showTimer);
    showTimer = window.setTimeout(() => {
      showTimer = null;
      const editor = editorNow();
      if (!editor) return;
      const read = readSelection({
        writingArea: editor.writingArea,
        selection: window.getSelection(),
      });
      if (!read.ok) {
        // A collapsed selection must NOT retire an open bar: in Typora clicking
        // the bar's own field collapses the document selection, and retiring on
        // that made the bar vanish the moment it was used. The bar's own
        // dismissers (Escape, save, outside click, scroll) close it instead, and
        // a NEW selection replaces it through the signature below.
        if (!bar) {
          lastSignature = "";
          if (read.reason !== "collapsed" && read.reason !== INSIDE_OUR_UI)
            diagLog(`selection menu: ${describeRefusal(read.reason)}`);
        }
        return;
      }
      const signature = selectionSignature(read.selection);
      if (signature === lastSignature) return;
      lastSignature = signature;
      bar?.remove();
      bar = null;

      // The span is mapped HERE, once, and the bar runs against it. Two reasons:
      // the run cannot re-read a selection that clicking the field has already
      // collapsed, and whether the selection spans lines picks the "smart"
      // horizontal anchor, which the DOM cannot answer (a soft-wrapped line has
      // no newline in it).
      const field = editor.writingArea.getBoundingClientRect();
      const probing = selectionRange({
        writingArea: editor.writingArea,
        selection: window.getSelection(),
        markdown: editor.getMarkdown(),
        expectedText: read.selection.text,
        log: diagLog,
      });
      bar = attachSelectionMenu({
        selection: read.selection,
        presets: SELECTION_PRESETS,
        onRun: (instruction, thinking) => run(instruction, thinking, read.selection, probing),
        // The toggle starts where the setting is, so its state is never a lie.
        thinking: !settings.disableThinking,
        place: {
          gap: settings.selectionMenuGap,
          placement: settings.selectionMenuPlacement,
          side: settings.selectionMenuSide,
          pullIn: settings.selectionMenuPullIn,
          boundaryRight: field.right,
          contentLeft: field.left,
          multiLine: probing.ok && probing.range.start.line !== probing.range.end.line,
        },
      });
    }, SHOW_DELAY_MS);
  };

  document.addEventListener("mouseup", offerMenu, true);
  document.addEventListener("selectionchange", offerMenu, true);

  return () => {
    if (showTimer !== null) window.clearTimeout(showTimer);
    document.removeEventListener("mouseup", offerMenu, true);
    document.removeEventListener("selectionchange", offerMenu, true);
    bar?.remove();
    bar = null;
  };
}
