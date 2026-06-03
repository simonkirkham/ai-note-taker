import { useEffect, useRef } from "react";
import styles from "./TranscriptTab.module.css";

export default function TranscriptTab({
  transcript,
  isRecording = false,
}: {
  transcript: string | null;
  isRecording?: boolean;
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
      <div className={styles.body} ref={bodyRef} data-testid="transcription-body">
        {hasTranscript ? (
          <p className={styles.text} data-testid="transcription-text">
            {transcript}
          </p>
        ) : isRecording ? (
          <p className={styles.placeholder}>Listening…</p>
        ) : (
          <p className={styles.placeholder} data-testid="transcript-empty">
            No transcript yet. Press Record to start transcribing.
          </p>
        )}
      </div>
    </div>
  );
}
