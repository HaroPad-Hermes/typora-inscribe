// Completion service for Typora Inscribe.
// Ported from obsidian-inscribe's plate-mode flow (src/completions/service.ts),
// with Obsidian editor deps removed: works on markdown text + caret position.
// Spacing is decided by CODE (see completions/flow.ts), never the model.

import {
  buildSystemPromptFrom,
  computeGhost,
  isIncompleteFill,
  WORD_VALIDITY_SYSTEM,
} from "./flow";
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

  /** Local spacing arbiter: OpenAI-compatible call to the fine-tuned model
   *  (llama-server --reasoning off). Returns "YES"/"NO", or null on any
   *  failure so the caller can fall back. */
  private async localPlausibleWord(system: string, user: string): Promise<string | null> {
    const { arbiterBaseUrl, arbiterModel, arbiterTimeoutMs } = this.settings;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), arbiterTimeoutMs);
    try {
      const res = await fetch(`${arbiterBaseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: arbiterModel,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          max_tokens: 128,
          temperature: 0,
          stream: false,
        }),
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const d = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content: string | undefined = d?.choices?.[0]?.message?.content;
      if (!content) return null;
      const t = content.trim().toUpperCase();
      return t.startsWith("YES") ? "YES" : t.startsWith("NO") ? "NO" : null;
    } catch (error) {
      console.error("Inscribe: local arbiter failed", error);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

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
        console.error("Inscribe: completion request failed", error);
        return null;
      }
    };

    // FIM suffix anchor: text after the cursor, capped
    const suffixText = postCursorText.slice(0, 4000);

    const ghost = await computeGhost(preCursorText, systemPrompt, {
      continueText: async (p, raw) => {
        // FIM path: when there IS text after the cursor, the raw prefix +
        // suffix anchor the position structurally.
        let fimResult: string | null = null;
        let fimTried = false;
        if (raw !== undefined && suffixText && this.provider.generateFimOnce) {
          fimTried = true;
          try {
            fimResult = await this.provider.generateFimOnce(raw, suffixText, opts);
          } catch (error) {
            console.error("Inscribe: FIM completion failed — falling back to chat path", error);
          }
        }
        if (fimTried && fimResult !== null) {
          // FIM fills are boundary-sized: an empty or stranded-unit fill
          // ("the", "and") leaves the sentence hanging — re-run via chat.
          // Skipped inside code blocks, where short fills are legitimate.
          const inCode = raw !== undefined && raw.includes("```");
          if (this.settings.fimShortFillFallback && !inCode && isIncompleteFill(fimResult)) {
            console.log("Inscribe: FIM fill incomplete — falling back to chat path");
            fimResult = null;
          } else {
            return fimResult;
          }
        }
        return generate(
          [
            { role: "system", content: systemPrompt },
            { role: "user", content: p },
          ],
          { maxTokens: opts.maxTokens, temperature: opts.temperature },
        );
      },
      isPlausibleWord: async (text, candidate) => {
        const user = `Text: "${text}"\nIs "${candidate}" a plausible word to write here?`;
        const mode = this.settings.arbiterMode;
        if (mode !== "api" && mode !== "off") {
          const local = await this.localPlausibleWord(WORD_VALIDITY_SYSTEM, user);
          if (local !== null) return local === "YES";
          if (mode === "local") return null;
        }
        if (mode === "off") return null; // let computeGhost use its heuristic
        const r = await generate(
          [
            { role: "system", content: WORD_VALIDITY_SYSTEM },
            { role: "user", content: user },
          ],
          { maxTokens: 5, temperature: 0.1 },
        );
        if (r === null) return null;
        return r.trim().toUpperCase().startsWith("YES");
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