import clsx from "clsx";
import { useRef } from "react";
import styles from "./TranscriptFindBar.module.css";

export default function TranscriptFindBar({
  query,
  countLabel,
  hasMatches,
  onQueryChange,
  onStep,
  onClear,
}: {
  query: string;
  countLabel: string;
  hasMatches: boolean;
  onQueryChange: (query: string) => void;
  onStep: (delta: number) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleClear() {
    onClear();
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      onStep(e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleClear();
    }
  }

  return (
    <div className={styles.findBar} role="search" data-testid="transcript-find">
      <input
        ref={inputRef}
        type="text"
        className={styles.findInput}
        data-testid="transcript-find-input"
        aria-label="Find in transcript"
        placeholder="Find in transcript"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <span className={styles.findCount} data-testid="transcript-find-count" role="status">
        {countLabel}
      </span>
      <button
        type="button"
        className={clsx("icon-btn", styles.findButton)}
        data-testid="transcript-find-prev"
        aria-label="Previous match"
        disabled={!hasMatches}
        onClick={() => onStep(-1)}
      >
        ‹
      </button>
      <button
        type="button"
        className={clsx("icon-btn", styles.findButton)}
        data-testid="transcript-find-next"
        aria-label="Next match"
        disabled={!hasMatches}
        onClick={() => onStep(1)}
      >
        ›
      </button>
      <button
        type="button"
        className={clsx("icon-btn", styles.findButton)}
        data-testid="transcript-find-clear"
        aria-label="Clear search"
        disabled={query === ""}
        onClick={handleClear}
      >
        ✕
      </button>
    </div>
  );
}
