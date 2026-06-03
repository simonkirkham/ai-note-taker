import clsx from "clsx";

import styles from "./TagFilter.module.css";

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
  if (tags.length === 0) return null;

  return (
    <div className={styles.tagFilter} data-testid="tag-filter">
      <div className={styles.tagFilterPills}>
        {tags.map((tag) => (
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
