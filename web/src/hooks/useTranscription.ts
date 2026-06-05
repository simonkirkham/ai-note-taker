import {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand,
} from '@aws-sdk/client-transcribe-streaming';
import { useCallback, useEffect, useRef, useState } from 'react';
import { completeTranscription, getTranscriptionCredentials } from '../api/transcription';
import { PcmChunker } from './pcm';
import { SpeakerTranscript } from './speakerSegments';

const LANGUAGE_CODE = 'en-GB' as const;

// Coalesce live partial-result re-renders to at most one per this interval. The
// finalised tail of a long transcript grows unbounded, so re-rendering it on
// every partial (several/sec) congests the main thread and competes with audio
// streaming; finals always render immediately.
const PARTIAL_RENDER_INTERVAL_MS = 200;

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

  const cleanup = useCallback(() => {
    stoppedRef.current = true;
    wakeupRef.current?.();
    wakeupRef.current = null;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
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

  useEffect(() => () => cleanup(), [cleanup]);

  const startRecording = useCallback((includeCallAudio: boolean) => {
    stoppedRef.current = false;
    finalizedRef.current = '';
    lastPartialAtRef.current = 0;
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
          const text = finalizedRef.current;
          const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
          cleanup();
          setStatus('stopped');
          if (text) void completeTranscription(noteId, text, elapsed).catch(() => {});
        }
      } catch (err) {
        if (stoppedRef.current) return;
        cleanup();
        setError(err instanceof Error ? err.message : 'Transcription failed');
        setStatus('error');
      }
    })();
  }, [cleanup, noteId]);

  const stopRecording = useCallback(() => {
    const text = finalizedRef.current;
    const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
    cleanup();
    setStatus('stopped');
    if (text) void completeTranscription(noteId, text, elapsed).catch(() => {});
  }, [cleanup, noteId]);

  const reset = useCallback(() => {
    cleanup();
    finalizedRef.current = '';
    setStatus('idle');
    setTranscript('');
    setElapsedSeconds(0);
    setError(undefined);
    stoppedRef.current = false;
  }, [cleanup]);

  return { status, transcript, elapsedSeconds, error, startRecording, stopRecording, reset };
}
