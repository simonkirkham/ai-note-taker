import clsx from "clsx";
import { useRef } from "react";
import styles from "./TranscriptFindBar.module.css";

export default function TranscriptFindBar({
  query,
  current,
  total,
  capped,
  onQueryChange,
  onNext,
  onPrevious,
  onClear,
}: {
  query: string;
  current: number;
  total: number;
  capped: boolean;
  onQueryChange: (query: string) => void;
  onNext: () => void;
  onPrevious: () => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const isSearching = query !== "";

  // When capped, the label says which window the controls actually move through. A bare "+" would
  // be honest about there being more matches while silently implying the buttons can reach them.
  const countLabel = !isSearching
    ? ""
    : total === 0
      ? "No matches"
      : capped
        ? `${current} of first ${total}`
        : `${current} of ${total}`;

  function handleClear() {
    onClear();
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) onPrevious();
      else onNext();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleClear();
    }
  }

  return (
    <div
      className={styles.findBar}
      role="search"
      aria-label="Transcript search"
      data-testid="transcript-find"
    >
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
        disabled={total === 0}
        onClick={onPrevious}
      >
        ‹
      </button>
      <button
        type="button"
        className={clsx("icon-btn", styles.findButton)}
        data-testid="transcript-find-next"
        aria-label="Next match"
        disabled={total === 0}
        onClick={onNext}
      >
        ›
      </button>
      <button
        type="button"
        className={clsx("icon-btn", styles.findButton)}
        data-testid="transcript-find-clear"
        aria-label="Clear search"
        disabled={!isSearching}
        onClick={handleClear}
      >
        ✕
      </button>
    </div>
  );
}
