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
    <div className="tag-filter">
      <div className="tag-filter-pills">
        {tags.map((tag) => (
          <button
            key={tag}
            className={`tag-filter-pill${selectedTags.includes(tag) ? " tag-filter-pill--active" : ""}`}
            onClick={() => onToggle(tag)}
          >
            {tag}
          </button>
        ))}
      </div>
      <div className="tag-filter-controls">
        {selectedTags.length > 1 && (
          <button
            className="tag-filter-mode-toggle"
            onClick={() => onModeChange(mode === "AND" ? "OR" : "AND")}
            title="Toggle AND/OR filter mode"
          >
            {mode}
          </button>
        )}
        {selectedTags.length > 0 && (
          <button className="tag-filter-clear" onClick={onClear}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
