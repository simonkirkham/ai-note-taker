import {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand,
} from '@aws-sdk/client-transcribe-streaming';
import { useCallback, useEffect, useRef, useState } from 'react';
import { completeTranscription, getTranscriptionCredentials } from '../api';
import { PcmChunker } from './pcm';
import { SpeakerTranscript } from './speakerSegments';

const LANGUAGE_CODE = 'en-GB' as const;

// Coalesce live partial-result re-renders to at most one per this interval. The
// finalised tail of a long transcript grows unbounded, so re-rendering it on
// every partial (several/sec) congests the main thread and competes with audio
// streaming; finals always render immediately.
const PARTIAL_RENDER_INTERVAL_MS = 200;

// Autosave the finalised transcript on this cadence while recording, so a crash
// or unexpected close loses at most this much of the tail. Dedupe means a quiet
// interval (no new finalised text) emits nothing, so the event stream only
// grows while speech is actually being captured.
export const CHECKPOINT_INTERVAL_MS = 15000;

const WORKLET_CODE = `
class PcmProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (ch) this.port.postMessage(ch);
    return true;
  }
}
registerProcessor('pcm-processor', PcmProcessor);
`;
const WORKLET_DATA_URL = `data:application/javascript,${encodeURIComponent(WORKLET_CODE)}`;

export type TranscriptionStatus =
  | 'idle'
  | 'requestingCredentials'
  | 'recording'
  | 'stopped'
  | 'error';

export interface UseTranscriptionResult {
  status: TranscriptionStatus;
  transcript: string;
  elapsedSeconds: number;
  error: string | undefined;
  startRecording: (includeCallAudio: boolean) => void;
  stopRecording: () => void;
  reset: () => void;
}

export function useTranscription(noteId: string): UseTranscriptionResult {
  const [status, setStatus] = useState<TranscriptionStatus>('idle');
  const [transcript, setTranscript] = useState('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState<string | undefined>();

  const stoppedRef = useRef(false);
  const wakeupRef = useRef<(() => void) | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const finalizedRef = useRef('');
  const lastPartialAtRef = useRef(0);
  const lastSavedRef = useRef<string | null>(null);
  const checkpointTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback(() => {
    stoppedRef.current = true;
    wakeupRef.current?.();
    wakeupRef.current = null;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (checkpointTimerRef.current) {
      clearInterval(checkpointTimerRef.current);
      checkpointTimerRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (displayStreamRef.current) {
      displayStreamRef.current.getTracks().forEach((t) => t.stop());
      displayStreamRef.current = null;
    }
  }, []);

  // Persist the finalised transcript so far, but only when it has changed since
  // the last save. The backend replaces (not appends), so re-sending the full
  // accumulated text is idempotent. Driven on a periodic checkpoint while
  // recording and on every exit path (Stop, natural end, unmount) — so a
  // crash, tab close, or navigation mid-call keeps whatever was captured up to
  // the last checkpoint instead of losing it. On failure the saved marker is
  // cleared so the next checkpoint retries.
  const saveTranscript = useCallback(() => {
    const text = finalizedRef.current;
    if (!text || text === lastSavedRef.current) return;
    lastSavedRef.current = text;
    const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
    void completeTranscription(noteId, text, elapsed).catch(() => {
      if (lastSavedRef.current === text) lastSavedRef.current = null;
    });
  }, [noteId]);

  useEffect(
    () => () => {
      saveTranscript();
      cleanup();
    },
    [cleanup, saveTranscript],
  );

  // Warn before a browser-level leave (tab close, refresh, navigation) while a
  // recording is live — the in-flight tail since the last checkpoint would be
  // lost. Only armed while recording so it never blocks normal navigation.
  useEffect(() => {
    if (status !== 'recording' && status !== 'requestingCredentials') return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [status]);

  const startRecording = useCallback((includeCallAudio: boolean) => {
    stoppedRef.current = false;
    finalizedRef.current = '';
    lastPartialAtRef.current = 0;
    lastSavedRef.current = null;
    setTranscript('');
    setElapsedSeconds(0);
    setError(undefined);
    setStatus('requestingCredentials');

    void (async () => {
      try {
        // Optionally capture remote-participant (call) audio via screen-share and mix it with the
        // mic. Requested first, before the credential and mic awaits, because getDisplayMedia needs
        // the click's transient user activation — intervening awaits can let that window expire.
        // video must be true: Chromium rejects an audio-only getDisplayMedia with NotSupportedError,
        // so we request a video track to obtain the audio one, then use only the audio in the mix.
        // If the user cancels, the browser is unsupported, or activation lapsed, fall back to
        // mic-only — call audio is a best-effort enhancement, not a hard requirement.
        let displayStream: MediaStream | null = null;
        if (includeCallAudio) {
          try {
            displayStream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
          } catch (err) {
            console.warn('Call audio capture unavailable; continuing with microphone only.', err);
            displayStream = null;
          }
          displayStreamRef.current = displayStream;
          if (stoppedRef.current) {
            cleanup();
            return;
          }
        }

        const creds = await getTranscriptionCredentials();
        if (stoppedRef.current) {
          cleanup();
          return;
        }

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;
        if (stoppedRef.current) {
          cleanup();
          return;
        }

        const audioContext = new AudioContext({ sampleRate: 16000 });
        audioContextRef.current = audioContext;
        await audioContext.audioWorklet.addModule(WORKLET_DATA_URL);
        const workletNode = new AudioWorkletNode(audioContext, 'pcm-processor');

        const micSource = audioContext.createMediaStreamSource(stream);
        if (displayStream && displayStream.getAudioTracks().length > 0) {
          // Sum mic + system audio into a single mono mix before the worklet sees it.
          const systemSource = audioContext.createMediaStreamSource(displayStream);
          const mixer = audioContext.createGain();
          micSource.connect(mixer);
          systemSource.connect(mixer);
          mixer.connect(workletNode);
        } else {
          micSource.connect(workletNode);
        }

        const audioQueue: Uint8Array[] = [];
        const chunker = new PcmChunker();
        const speakerTranscript = new SpeakerTranscript();

        workletNode.port.onmessage = (e: MessageEvent) => {
          if (stoppedRef.current) return;
          const chunks = chunker.push(e.data as Float32Array);
          if (chunks.length === 0) return;
          for (const chunk of chunks) audioQueue.push(chunk);
          wakeupRef.current?.();
          wakeupRef.current = null;
        };

        async function* audioStream() {
          while (!stoppedRef.current) {
            if (audioQueue.length === 0) {
              await new Promise<void>((r) => {
                wakeupRef.current = r;
              });
            }
            while (!stoppedRef.current && audioQueue.length > 0) {
              yield { AudioEvent: { AudioChunk: audioQueue.shift()! } };
            }
          }
        }

        const client = new TranscribeStreamingClient({
          region: creds.region,
          credentials: {
            accessKeyId: creds.accessKeyId,
            secretAccessKey: creds.secretAccessKey,
            sessionToken: creds.sessionToken,
          },
        });

        const command = new StartStreamTranscriptionCommand({
          LanguageCode: LANGUAGE_CODE,
          MediaEncoding: 'pcm',
          MediaSampleRateHertz: audioContext.sampleRate,
          ShowSpeakerLabel: true,
          AudioStream: audioStream(),
        });

        setStatus('recording');
        startTimeRef.current = Date.now();
        timerRef.current = setInterval(() => {
          setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
        }, 1000);
        checkpointTimerRef.current = setInterval(saveTranscript, CHECKPOINT_INTERVAL_MS);

        const response = await client.send(command);

        if (response.TranscriptResultStream) {
          for await (const event of response.TranscriptResultStream) {
            if (stoppedRef.current) break;
            if (event.TranscriptEvent) {
              const results = event.TranscriptEvent.Transcript?.Results ?? [];
              for (const result of results) {
                const alternative = result.Alternatives?.[0];
                if (result.IsPartial) {
                  // Partials carry no stable speaker labels; show the plain in-flight
                  // text on its own line below the labelled finalised turns.
                  const text = alternative?.Transcript ?? '';
                  if (!text) continue;
                  const now = Date.now();
                  if (now - lastPartialAtRef.current < PARTIAL_RENDER_INTERVAL_MS) continue;
                  lastPartialAtRef.current = now;
                  const display = finalizedRef.current ? `${finalizedRef.current}\n${text}` : text;
                  setTranscript(display);
                } else {
                  // Finalised results are assembled from per-item speakers, so the
                  // guard must key off Items — not .Transcript, which is a different field.
                  const items = alternative?.Items ?? [];
                  if (items.length === 0) continue;
                  lastPartialAtRef.current = 0;
                  speakerTranscript.append(items);
                  finalizedRef.current = speakerTranscript.toString();
                  setTranscript(finalizedRef.current);
                }
              }
            }
          }
        }

        if (!stoppedRef.current) {
          saveTranscript();
          cleanup();
          setStatus('stopped');
        }
      } catch (err) {
        if (stoppedRef.current) return;
        cleanup();
        setError(err instanceof Error ? err.message : 'Transcription failed');
        setStatus('error');
      }
    })();
  }, [cleanup, saveTranscript]);

  const stopRecording = useCallback(() => {
    saveTranscript();
    cleanup();
    setStatus('stopped');
  }, [cleanup, saveTranscript]);

  const reset = useCallback(() => {
    cleanup();
    finalizedRef.current = '';
    lastSavedRef.current = null;
    setStatus('idle');
    setTranscript('');
    setElapsedSeconds(0);
    setError(undefined);
    stoppedRef.current = false;
  }, [cleanup]);

  return { status, transcript, elapsedSeconds, error, startRecording, stopRecording, reset };
}
