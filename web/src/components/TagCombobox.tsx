import clsx from "clsx";
import { useState, type KeyboardEvent, type Ref } from "react";
import type { TagIndexEntry } from "../api/tags";
import { useTagSuggestions } from "../hooks/useTagSuggestions";
import styles from "./TagCombobox.module.css";

const LISTBOX_ID = "tag-suggestions-listbox";

export default function TagCombobox({
  tags,
  allTags,
  onAdd,
  inputRef,
  onBlur,
}: {
  tags: string[];
  allTags: TagIndexEntry[];
  onAdd: (tag: string) => void;
  inputRef?: Ref<HTMLInputElement>;
  onBlur?: () => void;
}) {
  const [input, setInput] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const suggestions = useTagSuggestions(input, allTags, tags);

  function submitTag(tag: string) {
    const normalized = tag.trim().toLowerCase();
    if (!normalized) return;
    onAdd(normalized);
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
    <div className={styles.comboboxWrapper}>
      <input
        ref={inputRef}
        data-testid="tag-input"
        className={styles.tagsInput}
        type="text"
        placeholder="Add tag…"
        value={input}
        autoComplete="off"
        role="combobox"
        aria-label="Add tag"
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
          const hadText = input.trim().length > 0;
          submitTag(input);
          // BUG-38: only collapse when there was nothing to submit. Collapsing straight after a
          // blur-submit unmounts the input *mid-interaction* — the parent renders
          // `addingTag ? <TagCombobox/> : <button/>`, so an element a caller is already acting on
          // is destroyed and never comes back. That is the chronic deploy-gate flake: the E2E
          // helper fills the input and presses Enter as two separate Playwright calls, and a blur
          // landing between them detaches the resolved element, leaving the retry loop chasing a
          // node that can no longer exist until the 30 s cap. Staying open after a submit is also
          // what someone adding several tags in a row wants.
          if (!hadText) onBlur?.();
        }}
        onKeyDown={handleKeyDown}
      />
      {showDropdown && (
        <ul
          id={LISTBOX_ID}
          data-testid="tag-suggestions"
          className={styles.tagSuggestions}
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
                  className={styles.suggestionGroupItem}
                >
                  <span
                    className={styles.suggestionGroupHeading}
                    data-testid={`heading-${item.heading}`}
                  >
                    {item.heading}
                  </span>
                </li>,
              );
            }
            elements.push(
              /* eslint-disable-next-line jsx-a11y/click-events-have-key-events */
              <li
                key={item.tag}
                id={optionId}
                role="option"
                aria-selected={idx === highlightedIndex}
                data-testid={`suggestion-${item.tag}`}
                className={clsx(styles.tagSuggestionItem, {
                  [styles.highlighted]: idx === highlightedIndex,
                })}
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
  );
}
