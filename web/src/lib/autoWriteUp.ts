import type { DiarizationStatus, TranscriptionStatus } from '../hooks/useTranscription'

/**
 * Whether a recording that has just ended should be written up automatically, now.
 *
 * One rule, shared by the two places that act on it: the recording session, which runs the
 * write-up for every real recording, and the record control's fallback for a caller with no
 * session above it. Keeping it in one place is what keeps those two from drifting.
 */
export function shouldAutoWriteUp({
  status,
  autoAnalyse,
  transcript,
  diarization,
}: {
  status: TranscriptionStatus
  /** The choice as it was when Record was pressed. */
  autoAnalyse: boolean
  transcript: string
  diarization: DiarizationStatus
}): boolean {
  return (
    status === 'stopped' &&
    autoAnalyse &&
    transcript.trim().length > 0 &&
    // 33-B2: defer to the server while a speaker-labelling job is in flight ('refining') or
    // started but slow ('timedOut') — its completion re-analyses on the winning transcript. Only
    // write up here when the job never STARTED ('failed') or there is none ('idle'), so the note
    // is still analysed exactly once.
    diarization !== 'refining' &&
    diarization !== 'timedOut'
  )
}
