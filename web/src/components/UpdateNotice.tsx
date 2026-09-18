// 53-A — "a newer version is available" notice for the desktop app. Checks on mount and hourly;
// renders nothing in a browser, in a dev build, or when the check fails.
// 54-A — the app now updates itself: once an update has downloaded the notice offers "Restart
// now" instead, and the 53-A command is only the fallback for when updating itself fails.
import { useEffect, useState } from "react";
import { useBusyNoteId } from "../hooks/recordingSessionContext";
import { buildTime } from "../lib/buildInfo";
import { safeLocal } from "../lib/safeStorage";
import { updateStatus, type ReleaseEntry } from "../lib/updateStatus";
import type { AutoUpdateState } from "../types/desktop";
import styles from "./UpdateNotice.module.css";

// Works from any PowerShell window: fetches the published update script and runs it. The app
// cannot know where (or whether) the repository is checked out, so `npm run update` would not.
// The desktop shell copies its own identical copy (desktop/src/updateCommand.ts).
export const UPDATE_COMMAND =
  '$f="$env:TEMP\\ainote-update.ps1"; irm https://github.com/simonkirkham/ai-note-taker/releases/download/desktop-latest/update.ps1 -OutFile $f; if ($?) { powershell -ExecutionPolicy Bypass -File $f }';

const DISMISSED_KEY = "updateNotice.dismissedLatest";
const CHECK_EVERY_MS = 60 * 60 * 1000;

type CopyState = "idle" | "copied" | "failed";

// While the app is checking, downloading or holding a downloaded update, the command would only
// tell you to do by hand what is already happening.
const SELF_UPDATING: ReadonlySet<AutoUpdateState> = new Set(["checking", "downloading", "ready"]);

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export default function UpdateNotice() {
  // Read once: the effect below must not re-subscribe if the bridge getter hands back a new object.
  const [bridge] = useState(() => window.desktop?.updates);
  const [builtAt] = useState(buildTime);
  const [history, setHistory] = useState<ReleaseEntry[] | null>(null);
  const [dismissed, setDismissed] = useState(() => safeLocal.get(DISMISSED_KEY));
  const [copyState, setCopyState] = useState<CopyState>("idle");
  // `undefined` until the shell answers; a shell with no self-updating stays on the 53-A notice.
  const [autoState, setAutoState] = useState<AutoUpdateState | null | undefined>(() =>
    bridge?.getState ? undefined : null,
  );
  const [readyDismissed, setReadyDismissed] = useState(false);
  // A restart would close the app mid-recording, or before the recording has finished saving.
  const busy = useBusyNoteId() !== null;

  useEffect(() => {
    if (!bridge?.getState) return;
    let cancelled = false;
    bridge
      .getState()
      .then((state) => {
        if (!cancelled) setAutoState((current) => current ?? state);
      })
      .catch(() => {
        if (!cancelled) setAutoState((current) => current ?? null);
      });
    const unsubscribe = bridge.onState?.((state) => setAutoState(state));
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [bridge]);

  useEffect(() => {
    if (!bridge || !builtAt) return;
    let cancelled = false;
    const check = () => {
      bridge
        .getHistory()
        .then((next) => {
          // A failed later check keeps what the last good one found.
          if (!cancelled && next) setHistory(next);
        })
        .catch(() => {
          // A failed check is a hidden notice, never an error in the app.
        });
    };
    check();
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [bridge, builtAt]);

  useEffect(() => {
    if (copyState === "idle") return;
    const timer = window.setTimeout(() => setCopyState("idle"), 2500);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  const status = history
    ? updateStatus({ builtAt, history, now: new Date(), dismissedLatest: dismissed })
    : ({ show: false } as const);

  if (!bridge || autoState === undefined) return null;

  if (autoState === "ready") {
    if (readyDismissed) return null;
    return (
      <div role="status" className={styles.notice}>
        <div className={styles.body}>
          <p className={styles.text}>An update is ready — it installs when you close the app.</p>
        </div>
        {!busy && bridge.restart && (
          <button type="button" className={styles.copy} onClick={() => void bridge.restart?.().catch(() => {})}>
            Restart now
          </button>
        )}
        <button
          type="button"
          className={styles.dismiss}
          onClick={() => setReadyDismissed(true)}
          aria-label="Dismiss update notice"
        >
          ×
        </button>
      </div>
    );
  }

  if ((autoState && SELF_UPDATING.has(autoState)) || !status.show) return null;

  const handleDismiss = () => {
    safeLocal.set(DISMISSED_KEY, status.latest);
    setDismissed(status.latest);
  };

  const handleCopy = () => {
    bridge
      .copyUpdateCommand()
      .then((ok) => setCopyState(ok ? "copied" : "failed"))
      .catch(() => setCopyState("failed"));
  };

  const age = status.ageDays < 1 ? "less than a day" : plural(status.ageDays, "day");
  const copyLabel =
    copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed — select the command" : "Copy";

  return (
    <div role="status" className={styles.notice}>
      <div className={styles.body}>
        <p className={styles.text}>
          A newer version is available — your copy is {age} old and {plural(status.behind, "update")} behind.
        </p>
        <p className={styles.hint}>To update, paste this into PowerShell:</p>
        <div className={styles.commandRow}>
          <code className={styles.command}>{UPDATE_COMMAND}</code>
          <button
            type="button"
            className={styles.copy}
            onClick={handleCopy}
            aria-label={copyState === "idle" ? "Copy update command" : copyLabel}
          >
            {copyLabel}
          </button>
        </div>
      </div>
      <button type="button" className={styles.dismiss} onClick={handleDismiss} aria-label="Dismiss update notice">
        ×
      </button>
    </div>
  );
}
