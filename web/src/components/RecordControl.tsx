import { useCallback, useEffect, useRef, useState } from "react";
import { analyseNote } from "../api/notes";
import type { UseTranscriptionResult } from "../hooks/useTranscription";
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
  transcription: UseTranscriptionResult;
  onAnalysisComplete?: () => void;
}) {
  const { status, transcript, elapsedSeconds, error, startRecording, stopRecording, reset } =
    transcription;

  const [hasRecordedThisSession, setHasRecordedThisSession] = useState(false);
  const [isAnalysing, setIsAnalysing] = useState(false);
  const [analyseError, setAnalyseError] = useState<string | null>(null);
  const [includeCallAudio, setIncludeCallAudio] = useState(true);
  const [autoAnalyse, setAutoAnalyse] = useState(true);
  const [confirmingResume, setConfirmingResume] = useState(false);
  const autoAnalyseFiredRef = useRef(false);

  function begin(resumeFrom?: string) {
    setConfirmingResume(false);
    setHasRecordedThisSession(true);
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
      autoAnalyse &&
      hasRecordedThisSession &&
      transcript.trim().length > 0 &&
      !autoAnalyseFiredRef.current &&
      !isAnalysing &&
      // 33-B2: defer to the server while a diarization job is in flight ('refining') or started but
      // slow ('timedOut') — the completion Lambda re-analyses on the winning transcript. Only fall
      // back to a local analyse when the job never STARTED ('failed') or there's no diarization
      // ('idle', e.g. a content-only note), so the note is still analysed exactly once.
      transcription.diarization !== "refining" &&
      transcription.diarization !== "timedOut"
    ) {
      autoAnalyseFiredRef.current = true;
      void handleAnalyse("auto");
    }
  }, [status, autoAnalyse, hasRecordedThisSession, transcript, isAnalysing, transcription.diarization, handleAnalyse]);

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
