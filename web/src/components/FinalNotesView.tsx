import clsx from "clsx";
import { useState } from "react";
import styles from "./FinalNotesView.module.css";
import { useToast } from "./ToastProvider";

export default function FinalNotesView({
  summary,
  discussionPoints,
  decisions,
  summaryModelId,
  onGenerate,
}: {
  summary: string | null;
  discussionPoints: string[];
  decisions: string[];
  summaryModelId: string | null;
  onGenerate: () => Promise<void>;
}) {
  const { showError } = useToast();
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const hasSummary = !!summary && summary.trim().length > 0;

  async function handleGenerate() {
    if (isGenerating) return;
    setIsGenerating(true);
    setGenerateError(null);
    try {
      await onGenerate();
    } catch {
      if (hasSummary) {
        showError("Couldn't re-process final notes. Please try again.");
      } else {
        setGenerateError("Couldn't generate final notes. Please try again.");
      }
    } finally {
      setIsGenerating(false);
    }
  }

  if (!hasSummary) {
    return (
      <section
        className={styles.finalNotes}
        data-testid="final-notes"
        aria-label="Final notes"
      >
        <h2 className={styles.heading}>Final notes</h2>
        <div className={styles.empty} data-testid="final-notes-empty">
          <p className={styles.emptyMessage}>No final notes yet.</p>
          <button
            type="button"
            className={styles.generateButton}
            data-testid="generate-final-notes-button"
            onClick={handleGenerate}
            disabled={isGenerating}
          >
            {isGenerating ? "Generating…" : "Generate final notes"}
          </button>
          {generateError && (
            <p
              className={styles.generateError}
              data-testid="final-notes-generate-error"
              role="alert"
            >
              {generateError}
            </p>
          )}
        </div>
      </section>
    );
  }

  return (
    <section
      className={styles.finalNotes}
      data-testid="final-notes"
      aria-label="Final notes"
    >
      <div className={styles.headingRow}>
        <h2 className={styles.heading}>Final notes</h2>
        <button
          type="button"
          className={clsx(styles.reprocessButton, isGenerating && styles.isPending)}
          data-testid="reprocess-final-notes-button"
          onClick={handleGenerate}
          disabled={isGenerating}
          aria-label="Re-process final notes"
        >
          {isGenerating ? "Re-processing…" : "Re-process"}
        </button>
      </div>

      <section className={styles.block} aria-label="Summary">
        <h3 className={styles.sectionHeading}>Summary</h3>
        <p className={styles.summaryText} data-testid="final-notes-summary">
          {summary}
        </p>
      </section>

      {discussionPoints.length > 0 && (
        <section className={styles.block} aria-label="Discussion">
          <h3 className={styles.sectionHeading}>Discussion</h3>
          <ul className={styles.list} data-testid="final-notes-discussion">
            {discussionPoints.map((point, idx) => (
              <li key={`discussion-${idx}`}>{point}</li>
            ))}
          </ul>
        </section>
      )}

      {decisions.length > 0 && (
        <section className={styles.block} aria-label="Decisions">
          <h3 className={styles.sectionHeading}>Decisions</h3>
          <ul className={styles.list} data-testid="final-notes-decisions">
            {decisions.map((decision, idx) => (
              <li key={`decision-${idx}`}>{decision}</li>
            ))}
          </ul>
        </section>
      )}

      {summaryModelId && (
        <p className={styles.attribution} data-testid="final-notes-attribution">
          Written by {summaryModelId}
        </p>
      )}
    </section>
  );
}
