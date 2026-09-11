// OpenAI-compatible provider with FIM support for Typora Inscribe.
// fork of obsidian-inscribe's openai-compat provider, adapted for the
// Typora port (no Obsidian deps, no OpenAI SDK — fetch-based).

import type { Provider, ChatMessage, GenerateOnceOptions, FimOnceOptions } from "./provider";

export interface OpenAICompatibleSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  /** Send `thinking: {type: "disabled"}`; required for DeepSeek V4 Flash. */
  disableThinking?: boolean;
}

/** The FIM endpoint is a sibling of the versioned chat base:
 *  strip a trailing /v\d+ and append /beta/completions. */
export function fimEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "").replace(/\/v\d+$/, "")}/beta/completions`;
}

export class OpenAICompatibleProvider implements Provider {
  settings: OpenAICompatibleSettings;
  private abortController: AbortController | null = null;

  constructor(settings: OpenAICompatibleSettings) {
    this.settings = settings;
  }

  /**
   * Extra request parameters, including the reasoning control.
   *
   * @param thinking - A per-request override, or undefined to use the setting.
   * @returns The parameters to spread into the request body.
   */
  private buildExtraParams(thinking?: "enabled" | "disabled"): Record<string, unknown> {
    const mode = thinking ?? (this.settings.disableThinking ? "disabled" : undefined);
    return mode ? { thinking: { type: mode } } : {};
  }

  async generateOnce(messages: ChatMessage[], opts: GenerateOnceOptions): Promise<string> {
    const controller = new AbortController();
    this.abortController = controller;

    const res = await fetch(`${this.settings.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.settings.apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model ?? this.settings.model,
        messages,
        temperature: opts.temperature ?? this.settings.temperature,
        max_tokens: opts.maxTokens ?? this.settings.maxTokens,
        stream: false,
        ...this.buildExtraParams(opts.thinking),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Chat request failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    }

    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content ?? "";
  }

  /** FIM: raw completion against {base}/beta/completions (sibling of /v1),
   *  with the post-cursor text as a positional anchor.
   *  The model writes the middle between prompt and suffix. */
  async generateFimOnce(prompt: string, suffix: string, opts: FimOnceOptions): Promise<string> {
    const controller = new AbortController();
    this.abortController = controller;

    const url = fimEndpoint(this.settings.baseUrl);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.settings.apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model ?? this.settings.model,
        prompt,
        suffix,
        max_tokens: opts.maxTokens ?? this.settings.maxTokens,
        temperature: opts.temperature ?? this.settings.temperature,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`FIM request failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    }

    const data = (await res.json()) as { choices?: Array<{ text?: string }> };
    return data.choices?.[0]?.text ?? "";
  }

  async abort(): Promise<void> {
    this.abortController?.abort();
    this.abortController = null;
  }
}
