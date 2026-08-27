// Completion service for Typora Inscribe.
// Ported from obsidian-inscribe's plate-mode flow (src/completions/service.ts),
// with Obsidian editor deps removed: works on markdown text + caret position.
// Spacing is decided by CODE (see completions/flow.ts), never the model.

import {
  buildSystemPromptFrom,
  computeGhost,
} from "./flow";
import { diagLog } from "../diag";
import type { ChatMessage, GenerateOnceOptions, Provider } from "../providers/provider";
import { type Settings } from "../settings";
export interface CompletionResult {
  /** Full text to insert at the caret (may start with a space). */
  text: string;
  /** Text to display in the suggestion panel. */
  displayText: string;
}

/** A completion request: the document state at request time. */
export interface CompletionRequest {
  /** Full markdown text up to the caret (pre-cursor). */
  preCursorText: string;
  /** Full markdown text after the caret (post-cursor), FIM suffix anchor. */
  postCursorText: string;
}

export default class CompletionService {
  constructor(
    private provider: Provider,
    private settings: Settings = settings,
  ) {}

  /** Abort the current generation (called when the caret moves or a new
   *  request supersedes this one). */
  async abort(): Promise<void> {
    await this.provider.abort();
  }

  /** Generate a completion for the given document state.
   *  Returns null when there is nothing to show (abort, empty, stuck marker). */
  async generateCompletion(req: CompletionRequest): Promise<CompletionResult | null> {
    const { preCursorText, postCursorText } = req;

    const model = this.settings.model;
    const systemPrompt = buildSystemPromptFrom(
      this.settings.systemPrompt ||
        "You are an AI autocomplete engine. Output only the continuation text.",
    );

    const opts = {
      model,
      maxTokens: this.settings.maxTokens,
      temperature: this.settings.temperature,
    };

    const generate = async (
      messages: ChatMessage[],
      o: Partial<GenerateOnceOptions>,
    ): Promise<string | null> => {
      try {
        return await this.provider.generateOnce(messages, { model, ...o });
      } catch (error) {
        diagLog(`chat completion failed: ${String(error)}`);
        return null;
      }
    };

    // FIM suffix anchor: text after the cursor, capped. May be empty — FIM
    // with an empty suffix is plain prefix completion, which is what we want
    // at end-of-line. The model's leading whitespace marks the word boundary.
    const suffixText = postCursorText.slice(0, 4000);

    const ghost = await computeGhost(preCursorText, systemPrompt, {
      continueText: async (p, raw) => {
        // FIM path: preferred ALWAYS (empty suffix included). It completes
        // mid-word reliably and signals the boundary via leading whitespace.
        let fimResult: string | null = null;
        let fimTried = false;
        if (raw !== undefined && this.provider.generateFimOnce) {
          fimTried = true;
          try {
            fimResult = await this.provider.generateFimOnce(raw, suffixText, opts);
            diagLog(`FIM result: ${JSON.stringify((fimResult ?? "").slice(0, 80))} (suffix ${suffixText.length} chars)`);
          } catch (error) {
            diagLog(`FIM completion failed — falling back to chat path: ${String(error)}`);
          }
        }
        if (fimTried && fimResult !== null) {
          // Raw FIM fills are boundary-sized: they routinely end mid-word or
          // on closed-class words ("ence with some ", " dog. This is a ") even
          // when they are exactly the right continuation. The old
          // isIncompleteFill veto + chat fallback produced a NULL result for
          // 8/8 measured fills (live API matrix) because the chat path returns
          // empty for mid-word prompts — i.e. it vetoed GOOD completions.
          // Show the FIM fill as-is; the only vetoes are empty / stuck-marker,
          // applied in computeGhost's clean() step.
          return fimResult;
        }
        const chatResult = await generate(
          [
            { role: "system", content: systemPrompt },
            { role: "user", content: p },
          ],
          { maxTokens: opts.maxTokens, temperature: opts.temperature },
        );
        diagLog(`chat fallback result: ${JSON.stringify((chatResult ?? "").slice(0, 80))}`);
        return chatResult;
      },
    }, {
      maxSentences: this.settings.outputLimitSentences > 0
        ? this.settings.outputLimitSentences
        : undefined,
    });

    if (ghost === null) return null;
    return { text: ghost, displayText: ghost.trimStart() };
  }
}
