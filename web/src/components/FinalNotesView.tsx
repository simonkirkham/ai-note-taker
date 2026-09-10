import clsx from "clsx";
import { useState } from "react";
import type { InstructionResponse } from "../api/notes";
import styles from "./FinalNotesView.module.css";
import { useToast } from "./toastContext";

export default function FinalNotesView({
  summary,
  discussionPoints,
  decisions,
  instructionResponses = [],
  summaryModelId,
  onGenerate,
}: {
  summary: string | null;
  discussionPoints: string[];
  decisions: string[];
  instructionResponses?: InstructionResponse[];
  summaryModelId: string | null;
  onGenerate: () => Promise<void>;
}) {
  const { showError } = useToast();
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const hasSummary = !!summary && summary.trim().length > 0;
  const hasInstructionResponses = instructionResponses.length > 0;
  const hasContent = hasSummary || hasInstructionResponses;

  async function handleGenerate() {
    if (isGenerating) return;
    setIsGenerating(true);
    setGenerateError(null);
    try {
      await onGenerate();
      // BUG-77: this catch is UNREACHABLE from the only caller. NoteView's handleGenerateFinalNotes
      // reports the failure itself and never rethrows, so these two sentences cannot appear — the
      // toast the user sees comes from there. Left in place as the guard for any future caller that
      // does rethrow, but do not read it as "this path is handled here": a dead catch that looks
      // live is the same reading error that let a second analyse entry point go unnoticed through
      // the whole of BUG-77.
    } catch {
      if (hasContent) {
        showError("Couldn't re-process final notes. Please try again.");
      } else {
        setGenerateError("Couldn't generate final notes. Please try again.");
      }
    } finally {
      setIsGenerating(false);
    }
  }

  if (!hasContent) {
    return (
      <section
        className={styles.finalNotes}
        data-testid="final-notes"
        aria-label="Final notes"
      >
        <h2 className={styles.heading}>Final notes</h2>
        <div className={styles.empty} data-testid="final-notes-empty">
          <p className={styles.emptyMessage} role="status">No final notes yet.</p>
          <button
            type="button"
            className={styles.generateButton}
            data-testid="generate-final-notes-button"
            onClick={() => void handleGenerate()}
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
          onClick={() => void handleGenerate()}
          disabled={isGenerating}
          aria-label="Re-process final notes"
        >
          {isGenerating ? "Re-processing…" : "Re-process"}
        </button>
      </div>

      {hasSummary && (
        <section className={styles.block} aria-label="Summary">
          <h3 className={styles.sectionHeading}>Summary</h3>
          <p className={styles.summaryText} data-testid="final-notes-summary">
            {summary}
          </p>
        </section>
      )}

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

      {hasInstructionResponses && (
        <section className={styles.block} aria-label="AI responses">
          <h3 className={styles.sectionHeading}>AI responses</h3>
          <ul className={styles.instructionList} data-testid="final-notes-instruction-responses">
            {instructionResponses.map((r, idx) => (
              <li key={`instruction-${idx}`} className={styles.instructionCard}>
                <p className={styles.instructionTitle}>{r.instruction}</p>
                <p className={styles.responseText}>{r.response}</p>
              </li>
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
