import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import type { TagIndexEntry } from "../api/tags";
import { useActions } from "../hooks/useActions";
import ActionsSection from "./ActionsSection";
import styles from "./CommandBar.module.css";
import TagCombobox from "./TagCombobox";

export default function CommandBar({
  noteId,
  tags,
  allTags,
  onAddTags,
  onRemoveTag,
}: {
  noteId: string;
  tags: string[];
  allTags: TagIndexEntry[];
  onAddTags: (raw: string) => void;
  onRemoveTag: (tag: string) => void;
}) {
  const { data: actions = [] } = useActions(noteId);
  const total = actions.length;
  const done = actions.filter((a) => a.completed).length;
  const allDone = total > 0 && done === total;

  const [addingTag, setAddingTag] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const actionsRegionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (addingTag) tagInputRef.current?.focus();
  }, [addingTag]);

  useEffect(() => {
    if (!popoverOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (!actionsRegionRef.current?.contains(e.target as Node)) {
        setPopoverOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setPopoverOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [popoverOpen]);

  return (
    <div className={styles.commandBar} data-testid="command-bar">
      <div data-testid="tags-section" className={styles.tagsRegion} aria-label="Tags">
        <span className={styles.tagGlyph} aria-hidden="true">
          <TagIcon />
        </span>
        <div className={styles.tagChips}>
          {tags.map((tag) => (
            <span key={tag} data-testid={`tag-pill-${tag}`} className={styles.tagPill}>
              {tag}
              <button
                type="button"
                className={styles.tagPillRemove}
                onClick={() => onRemoveTag(tag)}
                aria-label={`Remove tag ${tag}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        {addingTag ? (
          <TagCombobox
            tags={tags}
            allTags={allTags}
            onAdd={onAddTags}
            inputRef={tagInputRef}
            onBlur={() => setAddingTag(false)}
          />
        ) : (
          <button
            type="button"
            data-testid="add-tag-button"
            className={styles.addTagButton}
            onClick={() => setAddingTag(true)}
            aria-label="Add tag"
          >
            <PlusIcon />
            Tag
          </button>
        )}
      </div>

      <div ref={actionsRegionRef} className={styles.actionsRegion}>
        <button
          type="button"
          data-testid="actions-pill"
          className={clsx(styles.actionsPill, allDone && styles.actionsPillDone)}
          aria-haspopup="dialog"
          aria-expanded={popoverOpen}
          aria-label={`Actions, ${done} of ${total} done`}
          onClick={() => setPopoverOpen((o) => !o)}
        >
          <CheckIcon />
          <span className={styles.actionsLabel}>Actions</span>
          <span className={styles.actionsCount} data-testid="actions-count">
            {done}/{total}
          </span>
          <ChevronIcon open={popoverOpen} />
        </button>
        {popoverOpen && (
          <div
            data-testid="actions-popover"
            className={styles.actionsPopover}
            role="dialog"
            aria-label="Action items"
          >
            <div className={clsx(styles.popoverHeader, allDone && styles.popoverHeaderDone)}>
              <span className={styles.popoverTitle}>Actions</span>
              <span className={styles.popoverCount}>
                {done}/{total}
              </span>
            </div>
            <div className={styles.popoverBody}>
              <ActionsSection key={noteId} noteId={noteId} showHeading={false} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TagIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform 150ms ease" }}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
