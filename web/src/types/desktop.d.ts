// 48-A — shape of the Electron desktop bridge (desktop/src/preload.ts). Only present when
// running inside the desktop shell; every consumer must guard on `window.desktop?.isDesktop`.

export type LocalTranscriptionStatus = {
  modelReady: boolean
  downloading: boolean
  progress: number
};

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
    // 48-C: diarize a 1:1 call from separate mic/loopback recordings → Me/Them transcript (or null).
    diarize(me: ArrayBuffer, them: ArrayBuffer): Promise<string | null>;
    // 48-C: drop the live session without its final pass (diarization produced the transcript).
    discard(): void;
    // BUG-53: the current live transcript (a full string, replace-not-append), emitted ~every 1.5s.
    onLive(cb: (text: string) => void): () => void;
    onError(cb: (message: string) => void): () => void;
  };
}

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}

export {};
