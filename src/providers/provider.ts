// Provider interface for Typora Inscribe
// Ported from obsidian-inscribe's plate-mode completion flow.
// No Obsidian dependency — works with text + caret position.

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export interface GenerateOnceOptions {
  model: string;
  maxTokens?: number;
  temperature?: number;
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