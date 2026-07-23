// 48-A — shape of the Electron desktop bridge (desktop/src/preload.ts). Only present when
// running inside the desktop shell; every consumer must guard on `window.desktop?.isDesktop`.

export type LocalTranscriptionStatus = {
  modelReady: boolean
  downloading: boolean
  progress: number
};

export type LocalWhisperSegment = { startMs: number; endMs: number; text: string };

export interface DesktopBridge {
  isDesktop: true;
  platform: string;
  local: {
    prepare(): void;
    getStatus(): Promise<LocalTranscriptionStatus>;
    onStatus(cb: (s: LocalTranscriptionStatus) => void): () => void;
    start(): Promise<void>;
    pushPcm(pcm: ArrayBuffer): void;
    // Resolves with the higher-quality final-pass transcript (or null → keep the live text).
    finish(): Promise<string | null>;
    onSegments(cb: (segs: LocalWhisperSegment[]) => void): () => void;
    onError(cb: (message: string) => void): () => void;
  };
}

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}

export {};
