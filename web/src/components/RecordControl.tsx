import { useCallback, useEffect, useRef, useState } from "react";
import { analyseNote } from "../api/notes";
import { useTranscription, type TranscriptionStatus } from "../hooks/useTranscription";
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
  onTranscriptChange,
  onStatusChange,
  onAnalysisComplete,
}: {
  noteId: string;
  noteHasContent?: boolean;
  hasInitialTranscript?: boolean;
  onTranscriptChange: (transcript: string) => void;
  onStatusChange: (status: TranscriptionStatus) => void;
  onAnalysisComplete?: () => void;
}) {
  const { status, transcript, elapsedSeconds, error, startRecording, stopRecording, reset } =
    useTranscription(noteId);

  const [hasRecordedThisSession, setHasRecordedThisSession] = useState(false);
  const [isAnalysing, setIsAnalysing] = useState(false);
  const [analyseError, setAnalyseError] = useState<string | null>(null);
  const [includeCallAudio, setIncludeCallAudio] = useState(true);
  const [autoAnalyse, setAutoAnalyse] = useState(true);
  const autoAnalyseFiredRef = useRef(false);

  useEffect(() => {
    onStatusChange(status);
  }, [status, onStatusChange]);

  useEffect(() => {
    if (status === "requestingCredentials" || status === "recording" || status === "stopped") {
      onTranscriptChange(transcript);
    }
  }, [status, transcript, onTranscriptChange]);

  const isRecording = status === "recording";
  const isRequesting = status === "requestingCredentials";
  const showInitialTranscript = status === "idle" && hasInitialTranscript && !hasRecordedThisSession;
  const hasSomethingToAnalyse = status === "stopped" || showInitialTranscript || noteHasContent;
  const showAnalyseControl = status === "idle" || status === "stopped";
  const analyseDisabled = !hasSomethingToAnalyse || isAnalysing;

  const handleAnalyse = useCallback(async () => {
    setIsAnalysing(true);
    setAnalyseError(null);
    try {
      await analyseNote(noteId);
      onAnalysisComplete?.();
    } catch {
      setAnalyseError("Analysis failed. Please try again.");
    } finally {
      setIsAnalysing(false);
    }
  }, [noteId, onAnalysisComplete]);

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
      !isAnalysing
    ) {
      autoAnalyseFiredRef.current = true;
      void handleAnalyse();
    }
  }, [status, autoAnalyse, hasRecordedThisSession, transcript, isAnalysing, handleAnalyse]);

  return (
    <div className={styles.recordControl} data-testid="record-control">
      {isRecording && (
        <span className={styles.timer} data-testid="transcription-timer">
          <span className={styles.dot} aria-hidden="true" />
          {formatTime(elapsedSeconds)}
        </span>
      )}

      {status === "error" && (
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
          onClick={handleAnalyse}
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

      {(status === "idle" || status === "stopped") && (
        <button
          type="button"
          className={styles.recordButton}
          data-testid="transcription-record-button"
          onClick={() => {
            setHasRecordedThisSession(true);
            startRecording(includeCallAudio);
          }}
        >
          <span className={styles.recordDot} aria-hidden="true" />
          Record
        </button>
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
