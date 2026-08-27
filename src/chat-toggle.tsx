// Floating toggle buttons for the Inscribe chat panel and settings.
// Replaces typora-copilot's footer-hosted controls with a minimal
// fixed-position cluster (chat + settings) that works in both themes.

import { attachChatPanel, detachChatPanel } from "./components/ChatPanel";
import SettingsPanel from "./components/SettingsPanel";
import { render } from "preact";

const CHAT_OPEN_KEY = "inscribe-chat-panel-open";

export function attachChatToggle(): void {
  if (document.querySelector("#inscribe-chat-toggle")) return;

  const cluster = document.createElement("div");
  cluster.className = "inscribe-toggle-cluster";
  cluster.id = "inscribe-chat-toggle";
  cluster.innerHTML = /* html */ `
    <button class="inscribe-toggle-button" id="inscribe-chat-button" title="Inscribe Chat" aria-label="Inscribe Chat">✦</button>
    <button class="inscribe-toggle-button" id="inscribe-settings-button" title="Inscribe Settings" aria-label="Inscribe Settings">⚙</button>
  `;
  document.body.appendChild(cluster);

  const isChatOpen = () => localStorage.getItem(CHAT_OPEN_KEY) === "true";

  cluster
    .querySelector<HTMLButtonElement>("#inscribe-chat-button")!
    .addEventListener("click", () => {
      if (isChatOpen()) {
        detachChatPanel?.();
      } else {
        attachChatPanel();
      }
    });

  let settingsContainer: HTMLDivElement | null = null;
  cluster
    .querySelector<HTMLButtonElement>("#inscribe-settings-button")!
    .addEventListener("click", () => {
      if (settingsContainer) {
        render(null, settingsContainer);
        settingsContainer.remove();
        settingsContainer = null;
        return;
      }
      settingsContainer = document.createElement("div");
      document.body.appendChild(settingsContainer);
      render(<SettingsPanel onClose={() => {
        render(null, settingsContainer!);
        settingsContainer!.remove();
        settingsContainer = null;
      }} />, settingsContainer);
    });

  // Restore the chat panel if it was open when Typora closed.
  if (isChatOpen()) attachChatPanel();
}