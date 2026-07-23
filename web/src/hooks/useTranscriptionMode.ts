import { useCallback, useEffect, useState } from "react";
import type { LocalTranscriptionStatus } from "../types/desktop";

// 48-A — user's transcription engine choice (desktop only). Mirrors useTheme's localStorage
// pattern. Default 'cloud' so the proven path stays the default until the user opts in and the
// on-device model has finished its first-launch background download.

export type TranscriptionMode = "local" | "cloud";

const STORAGE_KEY = "note-taker-transcription-mode";
export const DEFAULT_MODE: TranscriptionMode = "cloud";

export function readStoredMode(): TranscriptionMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "local" || stored === "cloud") return stored;
  } catch {
    /* localStorage unavailable */
  }
  return DEFAULT_MODE;
}

export function isDesktop(): boolean {
  return typeof window !== "undefined" && window.desktop?.isDesktop === true;
}

export function useTranscriptionMode() {
  const [mode, setModeState] = useState<TranscriptionMode>(readStoredMode);
  const [status, setStatus] = useState<LocalTranscriptionStatus>({
    modelReady: false,
    downloading: false,
    progress: 0,
  });

  const setMode = useCallback((next: TranscriptionMode) => {
    setModeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* localStorage unavailable — session-only */
    }
  }, []);

  // Track model-provisioning state from the desktop shell. setState runs only inside the
  // async .then / event callback (never the effect body) to satisfy set-state-in-effect lint.
  useEffect(() => {
    const bridge = window.desktop?.local;
    if (!bridge) return;
    bridge.getStatus().then(setStatus).catch(() => {});
    return bridge.onStatus(setStatus);
  }, []);

  // Local is only usable on desktop once the model is present; otherwise the effective engine
  // is cloud (the caller uses this to fall back and to label the toggle "Preparing…").
  const localReady = isDesktop() && status.modelReady;
  const effectiveMode: TranscriptionMode =
    mode === "local" && localReady ? "local" : "cloud";

  return { mode, setMode, effectiveMode, isDesktop: isDesktop(), status };
}
