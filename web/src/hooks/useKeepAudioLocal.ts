import { useCallback, useState } from "react";
import { isDesktop } from "./useTranscriptionMode";

// 48-E — "keep recordings on this device only" (desktop-only). Mirrors useTranscriptionMode's
// localStorage pattern. Default ON (privacy-first, per the phase decision): a locally-transcribed
// meeting uploads NO audio; the note still saves its transcript, summary, and action items. Only
// affects local-mode recordings — cloud transcription still needs the WAV upload and ignores this.

const STORAGE_KEY = "note-taker-keep-audio-local";
export const DEFAULT_KEEP_LOCAL = true;

export function readStoredKeepAudioLocal(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "true") return true;
    if (stored === "false") return false;
  } catch {
    /* localStorage unavailable */
  }
  return DEFAULT_KEEP_LOCAL;
}

export function useKeepAudioLocal() {
  const [keepLocal, setKeepLocalState] = useState<boolean>(readStoredKeepAudioLocal);

  const setKeepLocal = useCallback((next: boolean) => {
    setKeepLocalState(next);
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      /* localStorage unavailable — session-only */
    }
  }, []);

  return { keepLocal, setKeepLocal, isDesktop: isDesktop() };
}
