import { useState, type KeyboardEvent } from "react";
import type { TagIndexEntry } from "../api";
import { useTagSuggestions } from "../hooks/useTagSuggestions";

const LISTBOX_ID = "tag-suggestions-listbox";

export default function TagsSection({
  tags,
  allTags,
  onAdd,
  onRemove,
}: {
  tags: string[];
  allTags: TagIndexEntry[];
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
}) {
  const [input, setInput] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const suggestions = useTagSuggestions(input, allTags, tags);

  function submitTag(tag: string) {
    const trimmed = tag.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setInput("");
    setIsOpen(false);
    setHighlightedIndex(-1);
  }

  function completeWith(tag: string) {
    setInput(tag);
    setIsOpen(false);
    setHighlightedIndex(-1);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (isOpen && suggestions.length > 0) {
        setHighlightedIndex((i) => Math.min(i + 1, suggestions.length - 1));
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (isOpen && suggestions.length > 0) {
        setHighlightedIndex((i) => Math.max(i - 1, -1));
      }
    } else if (e.key === "ArrowRight") {
      if (isOpen && highlightedIndex >= 0) {
        e.preventDefault();
        completeWith(suggestions[highlightedIndex].tag);
      }
    } else if (e.key === "Tab") {
      if (isOpen && suggestions.length > 0) {
        e.preventDefault();
        const idx = highlightedIndex >= 0 ? highlightedIndex : 0;
        completeWith(suggestions[idx].tag);
      }
      // When dropdown is closed, Tab moves focus naturally → onBlur → submit
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (isOpen && highlightedIndex >= 0) {
        submitTag(suggestions[highlightedIndex].tag);
      } else {
        submitTag(input);
      }
    } else if (e.key === "Escape") {
      setIsOpen(false);
      setHighlightedIndex(-1);
    }
  }

  const showDropdown = isOpen && suggestions.length > 0;
  const activeDescendant =
    showDropdown && highlightedIndex >= 0
      ? `tag-suggestion-${suggestions[highlightedIndex].tag}`
      : undefined;

  return (
    <div data-testid="tags-section" className="tags-section">
      <h2 className="tags-heading">Tags</h2>
      <div className="tags-pills">
        {tags.map((tag) => (
          <span key={tag} data-testid={`tag-pill-${tag}`} className="tag-pill">
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
      <div className="tags-input-wrapper">
        <input
          data-testid="tag-input"
          className="tags-input"
          type="text"
          placeholder="Add tag…"
          value={input}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showDropdown}
          aria-haspopup="listbox"
          aria-controls={LISTBOX_ID}
          aria-activedescendant={activeDescendant}
          onChange={(e) => {
            setInput(e.target.value);
            setIsOpen(true);
            setHighlightedIndex(-1);
          }}
          onFocus={() => setIsOpen(true)}
          onBlur={() => {
            setIsOpen(false);
            setHighlightedIndex(-1);
            submitTag(input);
          }}
          onKeyDown={handleKeyDown}
        />
        {showDropdown && (
          <ul
            id={LISTBOX_ID}
            data-testid="tag-suggestions"
            className="tag-suggestions"
            role="listbox"
            aria-label="Tag suggestions"
          >
            {suggestions.flatMap((item, idx) => {
              const optionId = `tag-suggestion-${item.tag}`;
              const elements = [];
              if (item.heading) {
                elements.push(
                  <li
                    key={`heading-${item.heading}`}
                    role="presentation"
                    className="suggestion-group-item"
                  >
                    <span
                      className="suggestion-group-heading"
                      data-testid={`heading-${item.heading}`}
                    >
                      {item.heading}
                    </span>
                  </li>,
                );
              }
              elements.push(
                <li
                  key={item.tag}
                  id={optionId}
                  role="option"
                  aria-selected={idx === highlightedIndex}
                  data-testid={`suggestion-${item.tag}`}
                  className={`tag-suggestion-item${idx === highlightedIndex ? " highlighted" : ""}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => submitTag(item.tag)}
                >
                  {item.tag}
                </li>,
              );
              return elements;
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
