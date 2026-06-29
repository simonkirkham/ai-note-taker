import clsx from "clsx";
import { useMemo, useState } from "react";

import styles from "./TagFilter.module.css";

// Above this many tags the pill list is hard to scan, so a local search box
// renders to narrow the displayed pills (CHANGE-18). The search is view-only:
// it never changes which tags are selected or how filtering applies to notes.
const SEARCH_THRESHOLD = 8;

export default function TagFilter({
  tags,
  selectedTags,
  mode,
  onToggle,
  onModeChange,
  onClear,
}: {
  tags: string[];
  selectedTags: string[];
  mode: "AND" | "OR";
  onToggle: (tag: string) => void;
  onModeChange: (mode: "AND" | "OR") => void;
  onClear: () => void;
}) {
  const [search, setSearch] = useState("");
  const showSearch = tags.length > SEARCH_THRESHOLD;

  const visibleTags = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!showSearch || needle === "") return tags;
    return tags.filter((tag) => tag.toLowerCase().includes(needle));
  }, [tags, search, showSearch]);

  if (tags.length === 0) return null;

  return (
    <div className={styles.tagFilter} data-testid="tag-filter">
      {showSearch && (
        <input
          type="text"
          data-testid="tag-filter-search"
          className={styles.tagFilterSearch}
          placeholder="Search tags…"
          aria-label="Search tags"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      )}
      <div className={styles.tagFilterPills}>
        {visibleTags.map((tag) => (
          <button
            key={tag}
            data-testid={`tag-filter-pill-${tag}`}
            className={clsx(styles.tagFilterPill, selectedTags.includes(tag) && styles.tagFilterPillActive)}
            onClick={() => onToggle(tag)}
          >
            {tag}
          </button>
        ))}
      </div>
      <div className={styles.tagFilterControls}>
        {selectedTags.length > 1 && (
          <button
            data-testid="tag-filter-mode-toggle"
            className={styles.tagFilterModeToggle}
            onClick={() => onModeChange(mode === "AND" ? "OR" : "AND")}
            title="Toggle AND/OR filter mode"
          >
            {mode}
          </button>
        )}
        {selectedTags.length > 0 && (
          <button data-testid="tag-filter-clear" className={styles.tagFilterClear} onClick={onClear}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
