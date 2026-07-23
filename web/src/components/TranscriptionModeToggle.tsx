import {
  useTranscriptionMode,
  type TranscriptionMode,
} from "../hooks/useTranscriptionMode";

import styles from "./TranscriptionModeToggle.module.css";

// 48-A — desktop-only Local/Cloud transcription toggle. Renders nothing in the web app.
// When Local is selected but the on-device model is still downloading, shows a "Preparing…"
// hint; recording falls back to cloud until then (useTranscriptionMode.effectiveMode).
export default function TranscriptionModeToggle() {
  const { mode, setMode, isDesktop, status } = useTranscriptionMode();

  if (!isDesktop) return null;

  const preparing = mode === "local" && !status.modelReady;

  return (
    <div className={styles.toggle}>
      <label className={styles.label} htmlFor="transcription-mode-select">
        Transcription
      </label>
      <select
        id="transcription-mode-select"
        data-testid="transcription-mode-select"
        className={styles.select}
        value={mode}
        onChange={(e) => setMode(e.target.value as TranscriptionMode)}
      >
        <option value="cloud">Cloud</option>
        <option value="local">On device</option>
      </select>
      {preparing && (
        <span className={styles.hint} data-testid="transcription-mode-preparing">
          {status.downloading
            ? `Preparing… downloading models (${Math.round(status.progress * 100)}%)`
            : "Preparing… models unavailable, using cloud"}
        </span>
      )}
    </div>
  );
}
