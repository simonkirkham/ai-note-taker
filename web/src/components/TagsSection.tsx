import { useRef, useState } from "react";

export default function TagsSection({
  tags,
  onAdd,
  onRemove,
}: {
  tags: string[];
  onAdd: (raw: string) => void;
  onRemove: (tag: string) => void;
}) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function submit() {
    const trimmed = input.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setInput("");
  }

  return (
    <div className="tags-section">
      <h2 className="tags-heading">Tags</h2>
      <div className="tags-pills">
        {tags.map((tag) => (
          <span key={tag} className="tag-pill">
            {tag}
            <button
              className="tag-pill-remove"
              onClick={() => onRemove(tag)}
              aria-label={`Remove tag ${tag}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <input
        ref={inputRef}
        className="tags-input"
        type="text"
        placeholder="Add tag…"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        onBlur={submit}
      />
    </div>
  );
}
