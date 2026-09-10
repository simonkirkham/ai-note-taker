import { useCallback, useEffect, useRef, useState } from "react";
import { analyseNote } from "../api/notes";
import type { NoteRecording } from "../hooks/recordingSessionContext";
import { type AnalyseTrigger, reportAnalyseFailure } from "../lib/analyseFailure";
import styles from "./RecordControl.module.css";

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export default function RecordControl({
  noteId,
  noteHasContent = false,
  hasInitialTranscript = false,
  initialTranscript = null,
  transcription,
  onAnalysisComplete,
}: {
  noteId: string;
  noteHasContent?: boolean;
  hasInitialTranscript?: boolean;
  initialTranscript?: string | null;
  // 51-C: the session is app-scoped, so `transcription` may carry the single-recorder flag —
  // true when ANOTHER note holds the live session.
  transcription: NoteRecording;
  onAnalysisComplete?: () => void;
}) {
  const { status, transcript, elapsedSeconds, error, startRecording, stopRecording, reset } =
    transcription;
  const otherNoteRecording = transcription.otherNoteRecording ?? false;
  const { autoAnalyseChoice, claimAutoAnalyse } = transcription;
  // Say which it is. "Another note is recording" is wrong and confusing when the other note
  // has already stopped and is only finishing its save — the user sees nothing recording
  // anywhere and is told something is.
  const unavailableReason = !otherNoteRecording
    ? undefined
    : transcription.otherNoteBusyReason === 'saving'
      ? "Still saving the last recording — you can start again once it's done"
      : "Another note is recording — stop it first";

  // 51-C review: the session owns this, because this control does not outlive a tab switch.
  //
  // Recording in one note and looking at another unmounts the control mid-meeting, and a plain
  // `useState(false)` came back false — so pressing Stop saved the transcript and silently
  // skipped the automatic write-up, with nothing on screen to say the write-up was ever coming.
  // The local state stays as the fallback for a caller that passes a bare session (every spec
  // that drives this control directly), where nothing can unmount it mid-recording anyway.
  const [recordedLocally, setRecordedLocally] = useState(false);
  const hasRecordedThisSession = recordedLocally || transcription.hasRecordedThisSession === true;
  const [isAnalysing, setIsAnalysing] = useState(false);
  const [analyseError, setAnalyseError] = useState<string | null>(null);
  const [includeCallAudio, setIncludeCallAudio] = useState(true);
  const [autoAnalyse, setAutoAnalyse] = useState(true);
  const [confirmingResume, setConfirmingResume] = useState(false);
  const autoAnalyseFiredRef = useRef(false);

  function begin(resumeFrom?: string) {
    setConfirmingResume(false);
    setRecordedLocally(true);
    // Capture the auto-analyse toggle at record start (it's hidden during recording, so it can't
    // change) — carried to the diarization trigger so the server re-analyses on the winning
    // transcript (33-B2).
    startRecording(includeCallAudio, autoAnalyse, resumeFrom);
  }

  // Record on a note that already has a committed transcript asks whether to
  // Continue (append) or Re-record (replace); with no transcript it starts
  // immediately. See Phase 18-C.
  function handleRecordClick() {
    if (hasInitialTranscript) {
      setConfirmingResume(true);
      return;
    }
    begin();
  }

  const isRecording = status === "recording";
  const isRequesting = status === "requestingCredentials";
  const showInitialTranscript = status === "idle" && hasInitialTranscript && !hasRecordedThisSession;
  const hasSomethingToAnalyse = status === "stopped" || showInitialTranscript || noteHasContent;
  const showAnalyseControl = status === "idle" || status === "stopped";
  const analyseDisabled = !hasSomethingToAnalyse || isAnalysing;

  // BUG-77: this used to be a bare `catch {}` that discarded the error and printed one sentence —
  // "Analysis failed. Please try again." — for a dead network, an expired sign-in, a refused
  // request and a server fault alike, while recording nothing anywhere. The first live occurrence
  // was therefore undiagnosable: no client-side record existed, and the message named the wrong
  // subsystem. Keep what actually failed, say something true, and emit it.
  const handleAnalyse = useCallback(
    async (trigger: AnalyseTrigger) => {
      setIsAnalysing(true);
      setAnalyseError(null);
      const startedAt = Date.now();
      try {
        await analyseNote(noteId);
        onAnalysisComplete?.();
      } catch (err) {
        setAnalyseError(reportAnalyseFailure(err, { noteId, trigger, startedAt }).message);
      } finally {
        setIsAnalysing(false);
      }
    },
    [noteId, onAnalysisComplete],
  );

  useEffect(() => {
    if (status === "recording") {
      autoAnalyseFiredRef.current = false;
      return;
    }
    if (
      status === "stopped" &&
      // The choice as it was at Record, not as the toggle reads now. The toggle is hidden during
      // a recording so it cannot change — but a remount mid-meeting resets it to its default,
      // which would quietly write up a meeting the user had opted out of.
      (autoAnalyseChoice ?? autoAnalyse) &&
      hasRecordedThisSession &&
      transcript.trim().length > 0 &&
      !autoAnalyseFiredRef.current &&
      !isAnalysing &&
      // 33-B2: defer to the server while a diarization job is in flight ('refining') or started but
      // slow ('timedOut') — the completion Lambda re-analyses on the winning transcript. Only fall
      // back to a local analyse when the job never STARTED ('failed') or there's no diarization
      // ('idle', e.g. a content-only note), so the note is still analysed exactly once.
      transcription.diarization !== "refining" &&
      transcription.diarization !== "timedOut" &&
      // LAST in the chain, and deliberately a call with a side effect: it takes the one-shot
      // claim, so it must run only once every other condition has already passed.
      //
      // The local ref above cannot be the latch on its own — it remounts with this control, so
      // looking at another note's tab after Stop and coming back would write the same recording
      // up a second time. The session outlives both. Absent (a spec driving this control with a
      // bare session), the local ref is the latch, as it was before.
      (claimAutoAnalyse === undefined || claimAutoAnalyse())
    ) {
      autoAnalyseFiredRef.current = true;
      void handleAnalyse("auto");
    }
  }, [
    status,
    autoAnalyse,
    autoAnalyseChoice,
    claimAutoAnalyse,
    hasRecordedThisSession,
    transcript,
    isAnalysing,
    transcription.diarization,
    handleAnalyse,
  ]);

  return (
    <div className={styles.recordControl} data-testid="record-control">
      {isRecording && (
        <span className={styles.timer} data-testid="transcription-timer">
          <span className={styles.dot} aria-hidden="true" />
          {formatTime(elapsedSeconds)}
        </span>
      )}

      {status === "finalising" && (
        <span className={styles.timer} data-testid="transcription-finalising" aria-live="polite">
          <span className={styles.dot} aria-hidden="true" />
          Finalising transcript…
        </span>
      )}

      {/* BUG-56: also render while the recording CONTINUES. The on-device engine reports a dead
          live view through `error` without moving `status` off "recording" (audio is still captured
          for the stop-time pass), so gating on status === "error" alone stored the message and never
          showed it — the user watched an empty transcript with no explanation. */}
      {(status === "error" || error) && (
        <span className={styles.error} data-testid="transcription-error" role="alert">
          {error ?? "Cannot connect to transcription service."}
        </span>
      )}

      {(status === "idle" || status === "stopped") && (
        <label className={styles.toggle}>
          <input
            type="checkbox"
            data-testid="transcription-call-audio-toggle"
            checked={includeCallAudio}
            onChange={(e) => setIncludeCallAudio(e.target.checked)}
          />
          Record screen-share audio
        </label>
      )}

      {showAnalyseControl && (
        <label className={styles.toggle}>
          <input
            type="checkbox"
            data-testid="transcription-auto-analyse-toggle"
            checked={autoAnalyse}
            onChange={(e) => setAutoAnalyse(e.target.checked)}
            disabled={isAnalysing}
          />
          Auto-analyse
        </label>
      )}

      {showAnalyseControl && (
        <button
          type="button"
          className={styles.analyseButton}
          data-testid="transcription-analyse-button"
          onClick={() => void handleAnalyse("manual")}
          disabled={analyseDisabled}
          title={hasSomethingToAnalyse ? undefined : "Add notes or record a transcript to analyse"}
        >
          {isAnalysing ? "Analysing…" : "Analyse note"}
        </button>
      )}

      {status === "error" && (
        <button
          type="button"
          className={styles.resetButton}
          data-testid="transcription-reset-button"
          onClick={reset}
        >
          Reset
        </button>
      )}

      {(status === "idle" || status === "stopped") && !confirmingResume && (
        <button
          type="button"
          className={styles.recordButton}
          data-testid="transcription-record-button"
          onClick={handleRecordClick}
          // 51-C: only one note records at a time. The session refuses a second claim anyway,
          // so without this the button would look live and silently do nothing. The tooltip
          // says what to do about it; it deliberately does not name the holding note, which
          // this component has no way to resolve — the bar's marker is where you look for that.
          disabled={otherNoteRecording}
          title={unavailableReason}
        >
          <span className={styles.recordDot} aria-hidden="true" />
          Record
        </button>
      )}

      {(status === "idle" || status === "stopped") && confirmingResume && (
        <span className={styles.resumePrompt} role="group" aria-label="Continue or re-record">
          <button
            type="button"
            className={styles.recordButton}
            data-testid="transcription-continue-button"
            onClick={() => begin(initialTranscript ?? undefined)}
          >
            <span className={styles.recordDot} aria-hidden="true" />
            Continue
          </button>
          <button
            type="button"
            className={styles.resetButton}
            data-testid="transcription-rerecord-button"
            onClick={() => begin()}
          >
            Re-record
          </button>
        </span>
      )}

      {(isRequesting || isRecording) && (
        <button
          type="button"
          className={styles.stopButton}
          data-testid="transcription-stop-button"
          onClick={stopRecording}
          disabled={isRequesting}
        >
          Stop
        </button>
      )}

      {analyseError && (
        <span className={styles.analyseError} data-testid="transcription-analyse-error" role="alert">
          {analyseError}
        </span>
      )}
    </div>
  );
}
