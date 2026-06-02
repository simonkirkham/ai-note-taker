import { useEffect, useRef, useState } from 'react';
import { analyseNote } from '../api';
import { useTranscription } from '../hooks/useTranscription';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export default function TranscriptionPanel({
  noteId,
  initialTranscript,
  noteHasContent = false,
  onAnalysisComplete,
}: {
  noteId: string;
  initialTranscript?: string | null;
  noteHasContent?: boolean;
  onAnalysisComplete?: () => void;
}) {
  const { status, transcript, elapsedSeconds, error, startRecording, stopRecording, reset } =
    useTranscription(noteId);

  const transcriptRef = useRef<HTMLDivElement>(null);
  const [hasRecordedThisSession, setHasRecordedThisSession] = useState(false);
  const [isAnalysing, setIsAnalysing] = useState(false);
  const [analyseError, setAnalyseError] = useState<string | null>(null);
  const [updateContent, setUpdateContent] = useState(false);

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript]);

  const isRecording = status === 'recording';
  const isRequesting = status === 'requestingCredentials';
  const showInitialTranscript = status === 'idle' && !!initialTranscript && !hasRecordedThisSession;
  const hasSomethingToAnalyse = status === 'stopped' || showInitialTranscript || noteHasContent;
  const showAnalyseControl = status === 'idle' || status === 'stopped';
  const analyseDisabled = !hasSomethingToAnalyse || isAnalysing;

  async function handleAnalyse() {
    setIsAnalysing(true);
    setAnalyseError(null);
    try {
      await analyseNote(noteId, updateContent);
      onAnalysisComplete?.();
    } catch {
      setAnalyseError('Analysis failed. Please try again.');
    } finally {
      setIsAnalysing(false);
    }
  }

  return (
    <div className="transcription-panel" data-testid="transcription-panel">
      <div className="transcription-header">
        <span className="transcription-heading">Transcript</span>
        {isRecording && (
          <span className="transcription-timer" data-testid="transcription-timer">
            <span className="transcription-dot" aria-hidden="true" />
            {formatTime(elapsedSeconds)}
          </span>
        )}
      </div>

      <div
        className="transcription-body"
        ref={transcriptRef}
        data-testid="transcription-body"
      >
        {status === 'idle' && !showInitialTranscript && (
          <p className="transcription-placeholder">Press Record to start transcribing</p>
        )}
        {showInitialTranscript && (
          <p className="transcription-text" data-testid="transcription-text">{initialTranscript}</p>
        )}
        {(isRequesting || isRecording || status === 'stopped') && (
          <p className="transcription-text" data-testid="transcription-text">
            {transcript || (isRequesting ? '' : ' ')}
          </p>
        )}
        {status === 'error' && (
          <div className="transcription-error" data-testid="transcription-error">
            <p>{error ?? 'Cannot connect to transcription service.'}</p>
          </div>
        )}
      </div>

      <div className="transcription-controls">
        {status === 'error' && (
          <button
            className="transcription-reset-button"
            data-testid="transcription-reset-button"
            onClick={reset}
          >
            Reset
          </button>
        )}
        {(status === 'idle' || status === 'stopped') && (
          <button
            className="transcription-record-button"
            data-testid="transcription-record-button"
            onClick={() => { setHasRecordedThisSession(true); startRecording(); }}
          >
            Record
          </button>
        )}
        {(isRequesting || isRecording) && (
          <button
            className="transcription-stop-button"
            data-testid="transcription-stop-button"
            onClick={stopRecording}
            disabled={isRequesting}
          >
            Stop
          </button>
        )}
        {showAnalyseControl && (
          <button
            className="transcription-analyse-button"
            data-testid="transcription-analyse-button"
            onClick={handleAnalyse}
            disabled={analyseDisabled}
            title={hasSomethingToAnalyse ? undefined : 'Add notes or record a transcript to analyse'}
          >
            {isAnalysing ? 'Analysing…' : 'Analyse note'}
          </button>
        )}
      </div>
      {showAnalyseControl && (
        <label className="transcription-update-content-toggle">
          <input
            type="checkbox"
            data-testid="transcription-update-content-toggle"
            checked={updateContent}
            onChange={(e) => setUpdateContent(e.target.checked)}
            disabled={analyseDisabled}
          />
          Update note content
        </label>
      )}
      {analyseError && (
        <p className="transcription-analyse-error" data-testid="transcription-analyse-error">
          {analyseError}
        </p>
      )}
    </div>
  );
}
