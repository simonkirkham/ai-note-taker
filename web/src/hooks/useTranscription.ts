import { useCallback, useEffect, useRef, useState } from 'react';
import { completeTranscription, getTranscriptionCredentials, saveTranscriptionDraft } from '../api/transcription';
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

// Marks the boundary between recording sessions in a continued (resumed)
// transcript (Phase 18-C). Speaker labels reset per session, so this is the
// honest visual cue that "Speaker 1" below may be a different person.
const RESUME_SEPARATOR = '— resumed —';

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
  // resumeFrom: an existing committed transcript to continue. When set, the new
  // session's finalised turns are appended after it (with a "— resumed —"
  // separator); when omitted, recording starts fresh and replaces. See Phase 18-C.
  startRecording: (includeCallAudio: boolean, resumeFrom?: string) => void;
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
  const lastDraftRef = useRef<string | null>(null);
  const committedRef = useRef(false);
  const checkpointTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // The committed transcript a resumed recording is continuing (plus separator),
  // prepended to every finalised result so the new turns append rather than
  // replace. Empty for a fresh recording. See Phase 18-C.
  const resumePrefixRef = useRef('');

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

  // Autosave the finalised transcript so far to the DRAFT store (PUT, no event),
  // only when it changed since the last checkpoint. Loss-tolerant crash buffer
  // (ADR 0011); the committed transcript is produced by commitTranscript on a
  // clean exit. On failure the marker is cleared so the next checkpoint retries.
  const saveCheckpoint = useCallback(() => {
    const text = finalizedRef.current;
    // Skip the seed-only state (a resume with no new turns yet) and unchanged text.
    if (!text || text === lastDraftRef.current || text === resumePrefixRef.current) return;
    lastDraftRef.current = text;
    const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
    void saveTranscriptionDraft(noteId, text, elapsed).catch(() => {
      if (lastDraftRef.current === text) lastDraftRef.current = null;
    });
  }, [noteId]);

  // Commit the finalised transcript as the durable TranscriptionCompleted event
  // (POST) — once per recording, on a clean exit (Stop, natural end, intentional
  // unmount/navigation). The backend deletes the draft on commit, so no recovery
  // is offered afterwards. On failure the one-shot guard is released to retry.
  const commitTranscript = useCallback(() => {
    if (committedRef.current) return;
    const text = finalizedRef.current;
    if (!text) return;
    committedRef.current = true;
    const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
    void completeTranscription(noteId, text, elapsed).catch(() => {
      committedRef.current = false;
    });
  }, [noteId]);

  useEffect(
    () => () => {
      commitTranscript();
      cleanup();
    },
    [cleanup, commitTranscript],
  );

  // Warn before a browser-level leave (tab close, refresh, navigation) while a
  // recording is live or starting up (requestingCredentials) — the in-flight
  // tail since the last checkpoint would be lost. Only armed during those two
  // phases so it never blocks normal navigation.
  //
  // pagehide also keepalive-flushes the finalised tail to the loss-tolerant DRAFT
  // (BUG-34). The fire-and-forget unmount commit is aborted when the page is torn
  // down (tab close / cross-document nav), so a real exit lost everything since the
  // last 15 s checkpoint. A keepalive PUT outlives the teardown; it writes the DRAFT
  // (recoverable/continuable on reopen), never a premature TranscriptionCompleted —
  // so a bfcache restore that keeps recording is unaffected.
  useEffect(() => {
    if (status !== 'recording' && status !== 'requestingCredentials') return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    // Best-effort: if the access token is already expired, apiFetch awaits a silent
    // refresh that won't complete during teardown, so this flush can no-op. The 15 s
    // checkpoint (saveCheckpoint) is the floor — worst case loses the last <15 s tail.
    const onPageHide = () => {
      const text = finalizedRef.current;
      if (!text || text === resumePrefixRef.current) return;
      const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      void saveTranscriptionDraft(noteId, text, elapsed, { keepalive: true }).catch(() => {});
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [status, noteId]);

  const startRecording = useCallback((includeCallAudio: boolean, resumeFrom?: string) => {
    stoppedRef.current = false;
    const resumePrefix = resumeFrom ? `${resumeFrom}\n${RESUME_SEPARATOR}\n` : '';
    resumePrefixRef.current = resumePrefix;
    finalizedRef.current = resumePrefix;
    lastPartialAtRef.current = 0;
    lastDraftRef.current = null;
    committedRef.current = false;
    setTranscript(resumePrefix);
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
              // safe: the while-guard proves the queue is non-empty, so shift() returns a chunk
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              yield { AudioEvent: { AudioChunk: audioQueue.shift()! } };
            }
          }
        }

        // 19-I1: load the transcribe SDK on demand at recording-start so its weight
        // stays out of the entry bundle (it is only needed once the user records).
        const { TranscribeStreamingClient, StartStreamTranscriptionCommand } = await import(
          '@aws-sdk/client-transcribe-streaming'
        );

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
        checkpointTimerRef.current = setInterval(saveCheckpoint, CHECKPOINT_INTERVAL_MS);

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
                  finalizedRef.current = resumePrefixRef.current + speakerTranscript.toString();
                  setTranscript(finalizedRef.current);
                }
              }
            }
          }
        }

        if (!stoppedRef.current) {
          commitTranscript();
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
  }, [cleanup, saveCheckpoint, commitTranscript]);

  const stopRecording = useCallback(() => {
    commitTranscript();
    cleanup();
    setStatus('stopped');
  }, [cleanup, commitTranscript]);

  const reset = useCallback(() => {
    cleanup();
    finalizedRef.current = '';
    resumePrefixRef.current = '';
    lastDraftRef.current = null;
    committedRef.current = false;
    setStatus('idle');
    setTranscript('');
    setElapsedSeconds(0);
    setError(undefined);
    stoppedRef.current = false;
  }, [cleanup]);

  return { status, transcript, elapsedSeconds, error, startRecording, stopRecording, reset };
}
