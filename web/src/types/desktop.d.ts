// 48-A — shape of the Electron desktop bridge (desktop/src/preload.ts). Only present when
// running inside the desktop shell; every consumer must guard on `window.desktop?.isDesktop`.

export type LocalTranscriptionStatus = {
  modelReady: boolean
  downloading: boolean
  progress: number
};

// 53-A — one published update: the commit it was built from and when it was built.
export type ReleaseEntry = { sha: string; builtAt: string };

// 54-A — where self-updating has got to. 'disabled' is a dev (unpackaged) build.
export type AutoUpdateState = "disabled" | "checking" | "downloading" | "ready" | "none" | "failed";

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
  // CHANGE-46 — the public web address of the app (https://…), for a copyable note link. The
  // desktop window's own origin is http://localhost:5180 and is useless to anyone else.
  // Absent in a shell built before the copy-link button existed; null off the bundle origin.
  app?: {
    getPublicOrigin(): Promise<string | null>;
  };
  // 53-A — absent in a shell built before the update notice existed.
  updates?: {
    // The published update history, or null when it could not be fetched or read.
    getHistory(): Promise<ReleaseEntry[] | null>;
    // Copies the update command to the system clipboard; false when the copy did not happen.
    // Takes no text on purpose: the page shows note content, so it must not choose what lands
    // on a clipboard the user may paste into PowerShell.
    copyUpdateCommand(): Promise<boolean>;
    // 54-A — absent in a shell built before the app could update itself.
    getState?(): Promise<AutoUpdateState | null>;
    onState?(cb: (state: AutoUpdateState) => void): () => void;
    // Installs the downloaded update and reopens the app.
    restart?(): Promise<void>;
  };
}

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}

export {};
