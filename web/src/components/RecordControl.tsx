import { useCallback, useEffect, useRef, useState } from "react";
import { analyseNote } from "../api/notes";
import type { NoteRecording } from "../hooks/recordingSessionContext";
import type { TranscriptionStallKind } from "../hooks/transcriptHealth";
import { type AnalyseTrigger, reportAnalyseFailure } from "../lib/analyseFailure";
import { shouldAutoWriteUp } from "../lib/autoWriteUp";
import styles from "./RecordControl.module.css";

// BUG-85: what to say when the live transcript has stopped growing part-way through a meeting. It
// happened twice, costing 54 minutes of one meeting and 3.5 hours of another, with nothing on
// screen to say so. Each line names the cause in ordinary words — the four are genuinely different
// situations, and a quiet room is not a fault at all, so it never advises a restart.
//
// Review round 1: none of these asserts that transcription HAS STOPPED. A meeting can be quiet, and
// telling someone to restart a recording that is working would make a good recording worse. The
// duration states the fact; the advice leaves the judgement with the person in the room.
//
// Review round 2: that hedge stays on `noWords` too, which is the one line that does name a fault.
// The speech threshold it fires on is an assumed level, not one measured on this user's
// microphones, and the speech it counts accumulates over the WHOLE stalled stretch — so the longer
// a genuinely quiet meeting runs, the more certainly a cough, a door or a chair adds up to the
// minimum and the line appears anyway. Restarting then splits a perfectly good transcript in two.
// The condition costs one clause and makes the reader the judge. Drop it only once the threshold
// has been measured against a real stall record.
const STALL_REASONS: Record<TranscriptionStallKind, string> = {
  sourceEnded: "The audio source ended — the microphone or shared audio was disconnected.",
  noSound: "No sound is being picked up from the microphone or shared audio.",
  quiet: "Only quiet background sound is being picked up — nobody seems to be speaking.",
  noWords: "Speech is being picked up, but nothing is coming back from transcription.",
};

const STALL_ADVICE: Record<TranscriptionStallKind, string> = {
  sourceEnded: "Stop and start recording again to keep a transcript of the rest.",
  noSound: "Check the microphone or shared audio, then stop and start recording again.",
  quiet: "Nothing needs doing if the meeting is quiet. If people are speaking, check the right microphone is selected.",
  noWords: "If people are speaking and nothing is appearing, stop and start recording again.",
};

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

// Rounded down to the minute: the notice is about how long has been lost, not a stopwatch.
function formatStallDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return plural(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? plural(hours, "hour") : `${plural(hours, "hour")} ${plural(rest, "minute")}`;
}

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
  const { status, transcript, elapsedSeconds, error, stall, startRecording, stopRecording, reset } =
    transcription;
  const otherNoteRecording = transcription.otherNoteRecording ?? false;
  const { autoWriteUp, autoWriteUpError, clearAutoWriteUp } = transcription;
  // Under a recording session the SESSION runs the automatic write-up — it outlives this control,
  // which unmounts whenever you look at another note. This control then only shows it. The local
  // path below is for a caller with no session above it, where nothing can unmount it mid-meeting.
  const sessionOwnsWriteUp = autoWriteUp !== undefined;
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
  // Busy either way: a manual analysis from here, or the session's automatic one for this note.
  const analysing = isAnalysing || autoWriteUp === "running";
  const analyseDisabled = !hasSomethingToAnalyse || analysing;
  // A local failure is the most recent thing that happened here, so it wins. The session's is the
  // one that survives a tab switch — so a failed write-up is still said when you come back.
  const shownAnalyseError = analyseError ?? autoWriteUpError ?? null;

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
        // A manual success puts right a failed automatic write-up — stop saying it failed. Only
        // on success: a manual failure leaves the note still un-analysed, and the session's
        // failure must then still be there after the next tab switch has dropped this one's.
        if (trigger === "manual") clearAutoWriteUp?.();
        onAnalysisComplete?.();
      } catch (err) {
        setAnalyseError(reportAnalyseFailure(err, { noteId, trigger, startedAt }).message);
      } finally {
        setIsAnalysing(false);
      }
    },
    [noteId, onAnalysisComplete, clearAutoWriteUp],
  );

  useEffect(() => {
    if (status === "recording") {
      autoAnalyseFiredRef.current = false;
      return;
    }
    if (
      !sessionOwnsWriteUp &&
      hasRecordedThisSession &&
      !autoAnalyseFiredRef.current &&
      !isAnalysing &&
      shouldAutoWriteUp({ status, autoAnalyse, transcript, diarization: transcription.diarization })
    ) {
      autoAnalyseFiredRef.current = true;
      void handleAnalyse("auto");
    }
  }, [
    status,
    autoAnalyse,
    sessionOwnsWriteUp,
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
            disabled={analysing}
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
          {analysing ? "Analysing…" : "Analyse note"}
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

      {/* BUG-85: a recording that is no longer producing a transcript says so, rather than running
          silently for hours. Announced politely and never focused — the audio is still being
          captured to the recording, so this is a problem to act on, not a crash.

          The announced region is present for the whole recording and its text is swapped in, which
          is what makes a screen reader read it at the moment it appears. The DURATION is deliberately
          outside it: it changes every minute, and inside the region that would re-read the whole
          notice every minute — 200 times over the stall that cost 3.5 hours. */}
      {isRecording && (
        <span className={styles.stall} data-stalled={stall ? "true" : "false"}>
          {stall && (
            <strong className={styles.stallHeadline} data-testid="transcription-stall-duration">
              No words have been transcribed for {formatStallDuration(stall.stalledForSeconds)}.
            </strong>
          )}
          <span
            className={styles.stallMessage}
            data-testid="transcription-stall"
            role="status"
            aria-live="polite"
          >
            {stall ? `${STALL_REASONS[stall.kind]} ${STALL_ADVICE[stall.kind]}` : ""}
          </span>
        </span>
      )}

      {shownAnalyseError && (
        <span className={styles.analyseError} data-testid="transcription-analyse-error" role="alert">
          {shownAnalyseError}
        </span>
      )}
    </div>
  );
}
