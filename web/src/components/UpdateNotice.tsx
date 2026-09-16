// 53-A — "a newer version is available" notice for the desktop app. Checks on mount and hourly;
// renders nothing in a browser, in a dev build, or when the check fails.
import { useEffect, useState } from "react";
import { buildTime } from "../lib/buildInfo";
import { safeLocal } from "../lib/safeStorage";
import { updateStatus, type ReleaseEntry } from "../lib/updateStatus";
import styles from "./UpdateNotice.module.css";

// Works from any PowerShell window: fetches the published update script and runs it. The app
// cannot know where (or whether) the repository is checked out, so `npm run update` would not.
// The desktop shell copies its own identical copy (desktop/src/updateCommand.ts).
export const UPDATE_COMMAND =
  '$f="$env:TEMP\\ainote-update.ps1"; irm https://github.com/simonkirkham/ai-note-taker/releases/download/desktop-latest/update.ps1 -OutFile $f; if ($?) { powershell -ExecutionPolicy Bypass -File $f }';

const DISMISSED_KEY = "updateNotice.dismissedLatest";
const CHECK_EVERY_MS = 60 * 60 * 1000;

type CopyState = "idle" | "copied" | "failed";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export default function UpdateNotice() {
  // Read once: the effect below must not re-subscribe if the bridge getter hands back a new object.
  const [bridge] = useState(() => window.desktop?.updates);
  const [builtAt] = useState(buildTime);
  const [history, setHistory] = useState<ReleaseEntry[] | null>(null);
  const [dismissed, setDismissed] = useState(() => safeLocal.get(DISMISSED_KEY));
  const [copyState, setCopyState] = useState<CopyState>("idle");

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

  if (!bridge || !status.show) return null;

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
