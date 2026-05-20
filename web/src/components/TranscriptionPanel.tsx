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
  onAnalysisComplete,
}: {
  noteId: string;
  initialTranscript?: string | null;
  onAnalysisComplete?: () => void;
}) {
  const { status, transcript, elapsedSeconds, error, startRecording, stopRecording, reset } =
    useTranscription(noteId);

  const transcriptRef = useRef<HTMLDivElement>(null);
  const [hasRecordedThisSession, setHasRecordedThisSession] = useState(false);
  const [isAnalysing, setIsAnalysing] = useState(false);

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript]);

  const isRecording = status === 'recording';
  const isRequesting = status === 'requestingCredentials';
  const showInitialTranscript = status === 'idle' && !!initialTranscript && !hasRecordedThisSession;
  const canAnalyse = (status === 'stopped' || showInitialTranscript) && !isAnalysing;

  async function handleAnalyse() {
    setIsAnalysing(true);
    try {
      await analyseNote(noteId);
      onAnalysisComplete?.();
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
        {canAnalyse && (
          <button
            className="transcription-analyse-button"
            data-testid="transcription-analyse-button"
            onClick={handleAnalyse}
            disabled={isAnalysing}
          >
            {isAnalysing ? 'Analysing…' : 'Save & Analyse'}
          </button>
        )}
      </div>
    </div>
  );
}
