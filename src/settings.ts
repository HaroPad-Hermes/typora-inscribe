import { mapValues } from "radash";
import { kebabCase } from "string-ts";

export type ArbiterMode = "auto" | "local" | "api" | "off";

export type Settings = typeof defaultSettings;

const defaultSettings = {
  /* General */
  disableCompletions: false,
  useInlineCompletionTextInSource: true,
  // Live preview: render the completion inline at the caret as ghost text
  // (paragraph reflows around it) instead of the out-of-document panel.
  useInlineCompletionTextInPreview: true,

  /* OpenAI-compatible provider */
  baseUrl: "https://api.deepseek.com/v1",
  apiKey: "",
  model: "deepseek-v4-flash",
  temperature: 0.5,
  maxTokens: 40,
  systemPrompt:
    "You are an AI autocomplete engine. Output only the continuation text. No explanations, no meta-text. Never repeat words already in the text. If you cannot continue meaningfully, output nothing. Continue ONLY the very last word or sentence at the end of the text. Never complete or re-emit earlier sentences, list items, or text that already exists above. Write in Markdown, matching the surrounding structure — always start a new line after a heading (## ...) before body text.",

  /* Completion behavior */
  // Limit the ghost to at most this many sentences (0 = no limit)
  outputLimitSentences: 1,
  // Re-run FIM continuations that end in a stranded unit through chat
  fimShortFillFallback: true,
  // Manual trigger hotkey, e.g. "ctrl+space" — when set, auto-trigger is
  // disabled and this key fires a completion request on demand.
  triggerHotkey: "",
  /* Selection menu geometry. Defaults match the reference implementation:
   * below the selection, 10px gap, smart horizontal anchor, pull-in on. */
  selectionMenuPlacement: "smart" as "smart" | "centered" | "first",
  selectionMenuSide: "below" as "below" | "above",
  selectionMenuPullIn: true,
  selectionMenuGap: 10,
  /* Send `thinking: {type: "disabled"}`. Required for DeepSeek V4 Flash, which
   * otherwise spends the whole token budget on reasoning and returns no text. */
  disableThinking: true,
};

export const settings = (() => {
  const changeListeners = new Map<keyof Settings, (() => void)[]>();
  const onChange = <K extends keyof Settings>(key: K, callback: (value: Settings[K]) => void) => {
    const listener = () => callback(settings[key]);
    if (!changeListeners.has(key)) changeListeners.set(key, []);
    changeListeners.get(key)?.push(listener);
    return () => {
      const listeners = changeListeners.get(key);
      if (!listeners) return;
      const index = listeners.indexOf(listener);
      if (index !== -1) listeners.splice(index, 1);
    };
  };

  const clear = (key: keyof Settings) => {
    if (localStorage.getItem(kebabCase(key)) === null) return;
    const changed = JSON.stringify(settings[key]) !== JSON.stringify(defaultSettings[key]);
    localStorage.removeItem(kebabCase(key));
    if (changed) changeListeners.get(key)?.forEach((listener) => listener());
  };

  const localStorageKeys = mapValues(defaultSettings, (_, key) => kebabCase(key));
  return new Proxy(
    {} as Settings & { readonly onChange: typeof onChange; readonly clear: typeof clear },
    {
      get(_target, prop, _receiver) {
        if (prop === "onChange") return onChange;
        if (prop === "clear") return clear;
        if (!(prop in defaultSettings)) throw new Error(`Unknown setting: ${String(prop)}`);
        const unparsedValue = localStorage.getItem(localStorageKeys[prop as keyof Settings]);
        if (unparsedValue === null) return defaultSettings[prop as keyof Settings];
        return JSON.parse(unparsedValue);
      },
      set(_target, prop, value, _receiver) {
        if (prop === "onChange") return false;
        if (prop === "clear") return false;
        if (!(prop in defaultSettings)) return false;
        const jsonifiedValue = JSON.stringify(value);
        if (
          jsonifiedValue ===
          (localStorage.getItem(localStorageKeys[prop as keyof Settings]) ??
            JSON.stringify(defaultSettings[prop as keyof Settings]))
        )
          // No change
          return true;
        localStorage.setItem(localStorageKeys[prop as keyof Settings], jsonifiedValue);
        changeListeners.get(prop as keyof Settings)?.forEach((listener) => listener());
        return true;
      },
    },
  );
})();