import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import TranscriptFindBar from "./TranscriptFindBar";
import styles from "./TranscriptTab.module.css";

export type RecordingDownloadStatus = "none" | "uploading" | "available" | "failed";

// 33-B1: the speaker-labelling chip state. 'refining' shows while the batch job runs; 'failed' is
// a non-blocking notice (trigger error or timeout); 'none' hides it (idle or already diarized).
export type DiarizationDisplayStatus = "none" | "refining" | "failed";

// A one-character query on an hour-long transcript matches thousands of times; every match is a
// DOM node, and during a recording the whole tree re-renders on each incoming phrase. Capping the
// highlights keeps that responsive — the count says "500+" so the total is never a lie.
const MAX_MATCHES = 500;

interface Match {
  start: number;
  end: number;
}

function escapeForRegExp(query: string): string {
  return query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 52-A: literal, case-insensitive substring search — deliberately not the fuzzy ranking Phase 22
// uses to order whole notes. Find-in-page needs exact offsets, or the highlights land in the wrong
// place.
//
// Matching runs against the ORIGINAL text via a case-insensitive regex, not against a lower-cased
// copy. Lower-casing is not length-preserving — `"İ".toLowerCase()` is two code units — so a single
// U+0130 anywhere earlier in a transcript de-synchronises the two strings and shifts every later
// highlight one character left. The query is escaped, so it is still matched as literal text.
function findMatches(text: string, query: string): Match[] {
  if (query === "") return [];
  const pattern = new RegExp(escapeForRegExp(query), "gi");
  const matches: Match[] = [];
  for (let m = pattern.exec(text); m !== null && matches.length < MAX_MATCHES; m = pattern.exec(text)) {
    matches.push({ start: m.index, end: m.index + m[0].length });
  }
  return matches;
}

// A live transcript grows by appending, which leaves every earlier match exactly where it was — so
// the position the user is on stays meaningful and must not move. Any other change (the speaker-
// labelled transcript replacing the streamed one, or a re-record) rewrites the text wholesale,
// after which neither "the 5th match" nor "the match at character 400" refers to anything the user
// chose. The only honest answer there is to start again at the first match.
function isAppendTo(previous: string | null, next: string | null): boolean {
  return (next ?? "").startsWith(previous ?? "");
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
  const [seenTranscript, setSeenTranscript] = useState(transcript);
  const hasTranscript = !!transcript && transcript.trim().length > 0;

  // Adjusting state during render, rather than in an effect: React re-renders immediately without
  // committing, and `react-hooks/set-state-in-effect` — a hard CI gate — forbids the effect form.
  if (transcript !== seenTranscript) {
    setSeenTranscript(transcript);
    if (!isAppendTo(seenTranscript, transcript)) setMatchIndex(0);
  }

  const matches = useMemo(() => findMatches(transcript ?? "", query), [transcript, query]);

  const currentIndex = matches.length === 0 ? -1 : Math.min(matchIndex, matches.length - 1);
  const currentStart = currentIndex < 0 ? null : matches[currentIndex].start;
  const isSearching = query !== "";

  useEffect(() => {
    // An active search owns the scroll position: without this guard every incoming phrase would
    // yank the user off the match they are reading and back to the bottom.
    if (isRecording && !isSearching && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [transcript, isRecording, isSearching]);

  // Depends on the offset, not the matches array — the array is a new identity on every incoming
  // phrase, which would re-centre the view on the current match each time speech arrived and stop
  // the user reading the conversation around it. An earlier match's offset is stable across appends.
  useEffect(() => {
    if (currentStart === null) return;
    currentMarkRef.current?.scrollIntoView({ block: "center" });
  }, [currentStart]);

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
    matches.forEach((match, i) => {
      if (match.start > cursor) parts.push(text.slice(cursor, match.start));
      const isCurrent = i === currentIndex;
      parts.push(
        <mark
          key={match.start}
          ref={isCurrent ? currentMarkRef : undefined}
          aria-current={isCurrent ? "true" : undefined}
          className={isCurrent ? styles.currentMatch : styles.match}
        >
          {text.slice(match.start, match.end)}
        </mark>,
      );
      cursor = match.end;
    });
    if (cursor < text.length) parts.push(text.slice(cursor));
    return parts;
  }

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
          current={currentIndex + 1}
          total={matches.length}
          capped={matches.length === MAX_MATCHES}
          onQueryChange={search}
          onNext={() => step(1)}
          onPrevious={() => step(-1)}
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
