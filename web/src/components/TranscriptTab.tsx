import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import TranscriptFindBar from "./TranscriptFindBar";
import styles from "./TranscriptTab.module.css";

export type RecordingDownloadStatus = "none" | "uploading" | "available" | "failed";

// 33-B1: the speaker-labelling chip state. 'refining' shows while the batch job runs; 'failed' is
// a non-blocking notice (trigger error or timeout); 'none' hides it (idle or already diarized).
export type DiarizationDisplayStatus = "none" | "refining" | "failed";

// 52-A: literal, case-insensitive substring search — deliberately not the fuzzy ranking Phase 22
// uses to order whole notes. Find-in-page needs exact offsets, or the highlights land in the wrong
// place. An indexOf scan also sidesteps escaping user input into a regex.
function findMatchOffsets(text: string, query: string): number[] {
  if (query === "") return [];
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  const offsets: number[] = [];
  for (let from = 0; ; ) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    offsets.push(at);
    from = at + needle.length;
  }
  return offsets;
}

export default function TranscriptTab({
  transcript,
  isRecording = false,
  recordingStatus = "none",
  diarizationStatus = "none",
  onDownloadRecording,
}: {
  transcript: string | null;
  isRecording?: boolean;
  recordingStatus?: RecordingDownloadStatus;
  diarizationStatus?: DiarizationDisplayStatus;
  onDownloadRecording?: () => void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const currentMarkRef = useRef<HTMLElement>(null);
  const [query, setQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const hasTranscript = !!transcript && transcript.trim().length > 0;

  const matches = useMemo(() => findMatchOffsets(transcript ?? "", query), [transcript, query]);

  // A live transcript only ever grows, so clamping — rather than resetting — keeps the user on the
  // match they were reading as new speech arrives. A replaced (shorter) transcript lands on the
  // last remaining match instead of an index that no longer exists.
  const currentIndex = matches.length === 0 ? -1 : Math.min(matchIndex, matches.length - 1);
  const isSearching = query !== "";

  useEffect(() => {
    // An active search owns the scroll position: without this guard every incoming phrase would
    // yank the user off the match they are reading and back to the bottom.
    if (isRecording && !isSearching && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [transcript, isRecording, isSearching]);

  useEffect(() => {
    if (currentIndex < 0) return;
    currentMarkRef.current?.scrollIntoView({ block: "center" });
  }, [currentIndex, matches, transcript]);

  function step(delta: number) {
    if (matches.length === 0) return;
    setMatchIndex((currentIndex + delta + matches.length) % matches.length);
  }

  function search(next: string) {
    setQuery(next);
    setMatchIndex(0);
  }

  function renderTranscript(text: string): ReactNode {
    if (matches.length === 0) return text;
    const parts: ReactNode[] = [];
    let cursor = 0;
    matches.forEach((at, i) => {
      if (at > cursor) parts.push(text.slice(cursor, at));
      const isCurrent = i === currentIndex;
      parts.push(
        <mark
          key={at}
          ref={isCurrent ? currentMarkRef : undefined}
          aria-current={isCurrent ? "true" : undefined}
          className={isCurrent ? styles.currentMatch : styles.match}
        >
          {text.slice(at, at + query.length)}
        </mark>,
      );
      cursor = at + query.length;
    });
    if (cursor < text.length) parts.push(text.slice(cursor));
    return parts;
  }

  const countLabel = !isSearching
    ? ""
    : matches.length === 0
      ? "No matches"
      : `${currentIndex + 1} of ${matches.length}`;

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
      {diarizationStatus === "refining" ? (
        <div className={styles.diarizationBar} data-testid="diarization-bar">
          <span className={styles.diarizationChip} data-testid="diarization-refining" role="status">
            Refining transcript with speaker labels…
          </span>
        </div>
      ) : diarizationStatus === "failed" ? (
        <div className={styles.diarizationBar} data-testid="diarization-bar">
          <span className={styles.recordingHint} data-testid="diarization-failed" role="status">
            Couldn’t refine speaker labels — showing the live transcript.
          </span>
        </div>
      ) : null}
      {hasTranscript && (
        <TranscriptFindBar
          query={query}
          countLabel={countLabel}
          hasMatches={matches.length > 0}
          onQueryChange={search}
          onStep={step}
          onClear={() => search("")}
        />
      )}
      <div className={styles.body} ref={bodyRef} data-testid="transcription-body">
        {hasTranscript && transcript ? (
          <p className={styles.text} data-testid="transcription-text">
            {renderTranscript(transcript)}
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
