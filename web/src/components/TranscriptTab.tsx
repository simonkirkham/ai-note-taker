import { useEffect, useRef } from "react";
import styles from "./TranscriptTab.module.css";

export type RecordingDownloadStatus = "none" | "uploading" | "available" | "failed";

export default function TranscriptTab({
  transcript,
  isRecording = false,
  recordingStatus = "none",
  onDownloadRecording,
}: {
  transcript: string | null;
  isRecording?: boolean;
  recordingStatus?: RecordingDownloadStatus;
  onDownloadRecording?: () => void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const hasTranscript = !!transcript && transcript.trim().length > 0;

  useEffect(() => {
    if (isRecording && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [transcript, isRecording]);

  return (
    <div className={styles.transcriptTab} data-testid="transcript-tab">
      {recordingStatus !== "none" && (
        <div className={styles.recordingBar} data-testid="recording-bar">
          {recordingStatus === "available" ? (
            <button
              type="button"
              className={styles.downloadButton}
              data-testid="recording-download-button"
              onClick={onDownloadRecording}
            >
              Download recording
            </button>
          ) : recordingStatus === "uploading" ? (
            <span className={styles.recordingHint} data-testid="recording-uploading" role="status">
              Saving recording…
            </span>
          ) : (
            <span className={styles.recordingError} data-testid="recording-failed" role="alert">
              Recording upload failed.
            </span>
          )}
        </div>
      )}
      <div className={styles.body} ref={bodyRef} data-testid="transcription-body">
        {hasTranscript ? (
          <p className={styles.text} data-testid="transcription-text">
            {transcript}
          </p>
        ) : isRecording ? (
          <p className={styles.placeholder} role="status">Listening…</p>
        ) : (
          <p className={styles.placeholder} data-testid="transcript-empty" role="status">
            No transcript yet. Press Record to start transcribing.
          </p>
        )}
      </div>
    </div>
  );
}
