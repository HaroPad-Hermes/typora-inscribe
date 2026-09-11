// Provider interface for Typora Inscribe
// Ported from obsidian-inscribe's plate-mode completion flow.
// No Obsidian dependency — works with text + caret position.

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

/** DeepSeek V4 style reasoning control. */
export type ThinkingMode = "enabled" | "disabled";

export interface GenerateOnceOptions {
  model: string;
  maxTokens?: number;
  temperature?: number;
  /**
   * Per-request reasoning override; falls back to `settings.disableThinking`.
   *
   * This is not a nicety. Measured against the live endpoint, DeepSeek V4 Flash
   * with thinking ON spends its whole budget on reasoning and returns EMPTY text
   * with `finish_reason: length` on harder passages — the failure is
   * budget-dependent, which is why easy rewrites worked and difficult ones did
   * not. `thinking: {type: "disabled"}` is the fix.
   */
  thinking?: ThinkingMode;
}

export interface FimOnceOptions {
  model: string;
  maxTokens?: number;
  temperature?: number;
}

export interface Provider {
  /** Non-streaming chat completion (used by the plate-mode flow). */
  generateOnce: (messages: ChatMessage[], opts: GenerateOnceOptions) => Promise<string>;
  /** FIM (fill-in-the-middle): raw completion with a suffix anchor.
   *  DeepSeek /beta/completions with prompt + suffix. */
  generateFimOnce: (prompt: string, suffix: string, opts: FimOnceOptions) => Promise<string>;
  /** Abort the current request. */
  abort: () => Promise<void>;
}