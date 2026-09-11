/**
 * The selection action host: menu, model, preview, accepted edit.
 *
 * This is the only place the three pieces meet, and it is deliberately thin —
 * every decision it could get wrong lives in a tested module beside it:
 * `selection.ts` says what is selected (or names why it cannot tell),
 * `range.ts` maps that to a markdown span (or names which endpoint failed),
 * `actions.ts` holds the prompts, `edit-plan.ts` decides whether an answer can
 * be applied at all, and `selection-preview.ts` collects the consent.
 *
 * What is left here is glue and two rules worth stating:
 *
 *   - an edit is applied to the document the user can see RIGHT NOW. The
 *     markdown and the range are read again at apply time, not carried over
 *     from when the menu opened, because a reload of stale text would silently
 *     revert anything typed in between;
 *   - nothing is applied without an accept. A refusal is logged and left
 *     visible; it is never turned into a best guess.
 */

import { attachSelectionMenu } from "../components/selection-menu";
import type { SelectionMenuAction } from "../components/selection-menu";
import { attachEditPreview } from "../components/selection-preview";
import { diagLog } from "../diag";
import { OpenAICompatibleProvider } from "../providers/openai-compat";
import type { ChatMessage, GenerateOnceOptions } from "../providers/provider";
import { settings } from "../settings";

import {
  SELECTION_ACTIONS,
  SELECTION_MAX_TOKENS,
  buildSelectionMessages,
  findAction,
} from "./actions";
import type { SelectionAction } from "./actions";
import { caretAfter, describeEditRefusal, planEdit } from "./edit-plan";
import type { EditPlan } from "./edit-plan";
import { describeRangeRefusal, selectionRange } from "./range";
import { describeRefusal, readSelection, selectionSignature } from "./selection";
import type { SelectedText } from "./selection";

/** The plugin's own UI must never be read as document text. */
const INSIDE_OUR_UI = "inside-inscribe-ui";

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
  let detachMenu: (() => void) | null = null;
  let lastSignature = "";
  let inFlight = false;

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
      // `main.ts` calls both directly after a reload; the types declare them
      // non-optional, so no defensive chain here either.
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

  const runAction = (action: SelectionAction, selection: SelectedText): void => {
    if (inFlight) return;
    const editor = editorNow();
    if (!editor) return;

    const markdown = editor.getMarkdown();
    const mapping = selectionRange({
      writingArea: editor.writingArea,
      selection: window.getSelection(),
      markdown,
      expectedText: selection.text,
      log: diagLog,
    });
    if (!mapping.ok) {
      diagLog(`selection action refused: ${describeRangeRefusal(mapping.reason)}`);
      return;
    }

    inFlight = true;
    diagLog(`selection action ${action.id}: ${JSON.stringify(selection.text.slice(0, 40))}`);
    void generate(buildSelectionMessages(action, selection.text), {
      model: settings.model,
      maxTokens: SELECTION_MAX_TOKENS,
      temperature: settings.temperature,
    })
      .then((answer) => {
        const planned = planEdit({
          markdown: editorNow()?.getMarkdown() ?? markdown,
          range: mapping.range,
          passage: selection.text,
          answer,
          eol: Files.useCRLF ? "\r\n" : "\n",
        });
        if (!planned.ok) {
          diagLog(`selection edit refused: ${describeEditRefusal(planned.reason)}`);
          return;
        }
        attachEditPreview({
          rect: selection.rect,
          title: action.label,
          boundaryRight: editorNow()?.writingArea.getBoundingClientRect().right,
          passage: planned.plan.before,
          replacement: planned.plan.replacement,
          onAccept: () => applyEdit(planned.plan),
        });
      })
      .catch((error: unknown) => {
        diagLog(`selection action failed: ${String(error)}`);
      })
      .finally(() => {
        inFlight = false;
      });
  };

  const menuActions: SelectionMenuAction[] = SELECTION_ACTIONS.map((action) => ({
    id: action.id,
    label: action.label,
    onSelect: (selection) => {
      const found = findAction(action.id);
      if (found) runAction(found, selection);
    },
  }));

  const offerMenu = (): void => {
    const editor = editorNow();
    if (!editor) return;
    const read = readSelection({
      writingArea: editor.writingArea,
      selection: window.getSelection(),
    });
    if (!read.ok) {
      // A click inside our own UI, or a fresh caret, both retire the menu.
      detachMenu?.();
      detachMenu = null;
      lastSignature = "";
      if (read.reason !== "collapsed" && read.reason !== INSIDE_OUR_UI)
        diagLog(`selection menu: ${describeRefusal(read.reason)}`);
      return;
    }
    const signature = selectionSignature(read.selection);
    if (signature === lastSignature) return;
    lastSignature = signature;
    detachMenu?.();
    detachMenu = attachSelectionMenu({
      selection: read.selection,
      actions: menuActions,
      boundaryRight: editor.writingArea.getBoundingClientRect().right,
    });
  };

  document.addEventListener("mouseup", offerMenu, true);
  document.addEventListener("selectionchange", offerMenu, true);

  return () => {
    document.removeEventListener("mouseup", offerMenu, true);
    document.removeEventListener("selectionchange", offerMenu, true);
    detachMenu?.();
    detachMenu = null;
  };
}
