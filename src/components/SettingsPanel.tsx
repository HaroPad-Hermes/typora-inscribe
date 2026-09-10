import { useState } from "preact/hooks";

import { settings } from "@/settings";
import { t } from "@/i18n";

import ModalBody from "./ModalBody";
import ModalCloseButton from "./ModalCloseButton";
import ModalContent from "./ModalContent";
import ModalOverlay from "./ModalOverlay";
import ModalTitle from "./ModalTitle";
import Switch from "./Switch";

export interface SettingsPanelProps {
  onClose: () => void;
}

const SettingsPanel: FC<SettingsPanelProps> = ({ onClose }) => {
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [model, setModel] = useState(settings.model);
  const [temperature, setTemperature] = useState(String(settings.temperature));
  const [maxTokens, setMaxTokens] = useState(String(settings.maxTokens));
  const [outputLimitSentences, setOutputLimitSentences] = useState(
    String(settings.outputLimitSentences),
  );
  const [fimShortFillFallback, setFimShortFillFallback] = useState(settings.fimShortFillFallback);
  const [triggerHotkey, setTriggerHotkey] = useState(settings.triggerHotkey);
  const [useInlineInSource, setUseInlineInSource] = useState(
    settings.useInlineCompletionTextInSource,
  );
  const [useInlineInPreview, setUseInlineInPreview] = useState(
    settings.useInlineCompletionTextInPreview,
  );

  const save = () => {
    settings.baseUrl = baseUrl.trim() || "https://api.deepseek.com/v1";
    settings.apiKey = apiKey.trim();
    settings.model = model.trim() || "deepseek-v4-flash";
    const temp = parseFloat(temperature);
    settings.temperature = Number.isFinite(temp) ? Math.min(Math.max(temp, 0), 2) : 0.5;
    const mt = parseInt(maxTokens, 10);
    settings.maxTokens = Number.isFinite(mt) ? Math.min(Math.max(mt, 1), 1000) : 40;
    const ols = parseInt(outputLimitSentences, 10);
    settings.outputLimitSentences = Number.isFinite(ols) ? Math.max(ols, 0) : 1;
    settings.fimShortFillFallback = fimShortFillFallback;
    settings.triggerHotkey = triggerHotkey.trim().toLowerCase();
    settings.useInlineCompletionTextInSource = useInlineInSource;
    settings.useInlineCompletionTextInPreview = useInlineInPreview;
    onClose();
  };

  const fieldStyle: preact.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
    marginBottom: "0.75rem",
  };
  const labelStyle: preact.CSSProperties = { fontSize: "0.9em", opacity: 0.85 };
  const inputStyle: preact.CSSProperties = {
    padding: "0.35rem 0.5rem",
    borderRadius: "0.375rem",
    border: "1px solid var(--border-color, rgba(128,128,128,0.4))",
    background: window.getComputedStyle(document.body).backgroundColor,
    color: window.getComputedStyle(document.body).color,
    font: "inherit",
    width: "100%",
    boxSizing: "border-box",
  };

  return (
    <ModalOverlay onClose={onClose}>
      <ModalBody>
        <ModalContent>
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0 0.25rem 0.5rem",
            }}>
            <ModalTitle>{t("settings.title")}</ModalTitle>
            <ModalCloseButton onClick={onClose} />
          </div>

          <div style={{ padding: "0.5rem", maxHeight: "70vh", overflowY: "auto" }}>
            <div style={fieldStyle}>
              <label style={labelStyle}>{t("settings.base-url")}</label>
              <input style={inputStyle} value={baseUrl} onInput={(e) => setBaseUrl((e.target as HTMLInputElement).value)} placeholder="https://api.deepseek.com/v1" />
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>{t("settings.api-key")}</label>
              <input style={inputStyle} type="password" value={apiKey} onInput={(e) => setApiKey((e.target as HTMLInputElement).value)} placeholder="sk-..." />
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>{t("settings.model")}</label>
              <input style={inputStyle} value={model} onInput={(e) => setModel((e.target as HTMLInputElement).value)} placeholder="deepseek-v4-flash" />
            </div>

            <div style={{ ...fieldStyle, flexDirection: "row", alignItems: "center", gap: "1rem" }}>
              <label style={{ ...labelStyle, width: "50%" }}>{t("settings.temperature")}</label>
              <input style={{ ...inputStyle, width: "50%" }} value={temperature} onInput={(e) => setTemperature((e.target as HTMLInputElement).value)} />
            </div>

            <div style={{ ...fieldStyle, flexDirection: "row", alignItems: "center", gap: "1rem" }}>
              <label style={{ ...labelStyle, width: "50%" }}>{t("settings.max-tokens")}</label>
              <input style={{ ...inputStyle, width: "50%" }} value={maxTokens} onInput={(e) => setMaxTokens((e.target as HTMLInputElement).value)} />
            </div>

            <div style={{ ...fieldStyle, flexDirection: "row", alignItems: "center", gap: "1rem" }}>
              <label style={{ ...labelStyle, width: "50%" }}>{t("settings.output-limit")}</label>
              <input style={{ ...inputStyle, width: "50%" }} value={outputLimitSentences} onInput={(e) => setOutputLimitSentences((e.target as HTMLInputElement).value)} />
            </div>

            <div style={{ ...fieldStyle, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <label style={labelStyle}>{t("settings.fim-fallback")}</label>
              <Switch value={fimShortFillFallback} onChange={setFimShortFillFallback} />
            </div>

            <div style={{ ...fieldStyle, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <label style={labelStyle}>{t("settings.inline-source")}</label>
              <Switch value={useInlineInSource} onChange={setUseInlineInSource} />
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}>
              <label style={labelStyle}>{t("settings.inline-preview")}</label>
              <Switch value={useInlineInPreview} onChange={setUseInlineInPreview} />
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>{t("settings.trigger-hotkey")}</label>
              <input style={inputStyle} value={triggerHotkey} onInput={(e) => setTriggerHotkey((e.target as HTMLInputElement).value)} placeholder="ctrl+space (empty = auto-trigger)" />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
              <button type="button" className="unset-button" style={{ padding: "0.4rem 1rem", borderRadius: "0.375rem", border: "1px solid rgba(128,128,128,0.4)", cursor: "pointer" }} onClick={onClose}>
                {t("settings.cancel")}
              </button>
              <button type="button" className="unset-button" style={{ padding: "0.4rem 1rem", borderRadius: "0.375rem", background: "#18a058", color: "#fff", cursor: "pointer" }} onClick={save}>
                {t("settings.save")}
              </button>
            </div>
          </div>
        </ModalContent>
      </ModalBody>
    </ModalOverlay>
  );
};

export default SettingsPanel;