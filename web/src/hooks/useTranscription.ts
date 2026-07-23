import { useCallback, useEffect, useRef, useState } from 'react';
import { presignRecordingUpload, saveRecording } from '../api/recordings';
import { completeTranscription, getTranscriptionCredentials, saveTranscriptionDraft, startDiarization } from '../api/transcription';
import { PcmChunker } from './pcm';
import { SpeakerTranscript } from './speakerSegments';
import { readStoredMode } from './useTranscriptionMode';
import { encodeWav } from './wav';

const RECORDING_CONTENT_TYPE = 'audio/wav' as const;

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

// 33-B1: after the recording uploads we trigger a batch diarization job, then wait for the
// note's transcriptIsDiarized flag to flip. The job is async (seconds to minutes). If it never
// lands within this window the chip resolves to a non-blocking "couldn't refine" notice and the
// streamed transcript stays — the job may have failed server-side (no flag is ever set on failure).
const DIARIZATION_TIMEOUT_MS = 5 * 60 * 1000;

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
  | 'finalising' // 48-B: local mode only — running the higher-quality medium.en pass on stop
  | 'stopped'
  | 'error';

// Lifecycle of the call-recording upload that fires on Stop (Phase 33-A). The
// captured WAV is uploaded to S3 and its key saved to the note, independently of
// the transcript commit. 'uploading' drives the optimistic "Download recording"
// affordance the moment recording stops; it resolves to 'uploaded' or 'failed'.
export type RecordingUploadStatus = 'idle' | 'uploading' | 'uploaded' | 'failed';

// 33-B1/B2: state of the post-upload batch diarization. Set 'refining' SYNCHRONOUSLY on Stop (a
// recording will be uploaded + diarized) so the on-Stop auto-analyse can defer to the server without
// racing the async trigger. 'timedOut' = the job started (got 202) but never landed in time — the
// server still owns the one analyse, so the caller keeps deferring. 'failed' = the trigger never
// started (upload/POST failed) — the caller falls back to a local analyse. 'refining'/'timedOut'
// show the chip/notice; the streamed transcript always stays until the diarized event lands.
export type DiarizationStatus = 'idle' | 'refining' | 'timedOut' | 'failed';

export interface UseTranscriptionResult {
  status: TranscriptionStatus;
  transcript: string;
  elapsedSeconds: number;
  error: string | undefined;
  recordingUpload: RecordingUploadStatus;
  diarization: DiarizationStatus;
  // autoAnalyse: the caller's auto-analyse toggle at record time — carried to the diarization
  // trigger so the completion Lambda re-analyses on the winning transcript (33-B2). resumeFrom: an
  // existing committed transcript to continue (new finalised turns appended after a "— resumed —"
  // separator); omitted → start fresh and replace. See Phase 18-C.
  startRecording: (includeCallAudio: boolean, autoAnalyse: boolean, resumeFrom?: string) => void;
  stopRecording: () => void;
  reset: () => void;
}

export function useTranscription(noteId: string): UseTranscriptionResult {
  const [status, setStatus] = useState<TranscriptionStatus>('idle');
  const [transcript, setTranscript] = useState('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState<string | undefined>();
  const [recordingUpload, setRecordingUpload] = useState<RecordingUploadStatus>('idle');
  const [diarization, setDiarization] = useState<DiarizationStatus>('idle');

  const stoppedRef = useRef(false);
  const diarizationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 33-B2: the auto-analyse toggle captured at record start (the toggle is hidden during recording,
  // so it can't change), carried into the diarization trigger so the completion Lambda re-analyses.
  const analyseOnCompletionRef = useRef(false);
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
  // 33-A: the captured 16-bit PCM chunks (the same ones streamed to Transcribe),
  // teed here so a WAV can be assembled and uploaded on Stop. Buffered in memory
  // for the whole recording (multipart upload for very long meetings is future).
  const recordedChunksRef = useRef<Uint8Array[]>([]);
  const recordedSampleRateRef = useRef(16000);
  const recordingUploadedRef = useRef(false);
  // 48-A: when the on-device (local) engine is driving the live transcript, its session must
  // be flushed on Stop before the transcript is committed. localCleanupRef detaches its IPC
  // listeners; localActiveRef gates the stop-time flush.
  const localActiveRef = useRef(false);
  const localCleanupRef = useRef<(() => void) | null>(null);

  const cleanup = useCallback(() => {
    stoppedRef.current = true;
    wakeupRef.current?.();
    wakeupRef.current = null;
    // 48-A: detach the on-device engine's IPC listeners (no-op in cloud mode).
    localCleanupRef.current?.();
    localCleanupRef.current = null;
    localActiveRef.current = false;
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

  // Assemble the captured PCM into a WAV and upload it to S3, then save its key to
  // the note (33-A). Fire-and-forget on Stop / natural end — independent of the
  // transcript commit. One-shot guarded so a Stop after a natural end can't double
  // upload; failures surface as 'failed' (the optimistic link reconciles to hidden).
  const uploadRecording = useCallback(() => {
    if (recordingUploadedRef.current) return;
    const chunks = recordedChunksRef.current;
    if (chunks.length === 0) return;
    recordingUploadedRef.current = true;
    recordedChunksRef.current = [];
    setRecordingUpload('uploading');
    // 33-B2: a recording WILL be uploaded + diarized — set 'refining' SYNCHRONOUSLY (before the
    // async upload) so the on-Stop auto-analyse, which runs the instant status becomes 'stopped',
    // sees the in-flight diarization and defers to the server instead of racing the 202.
    setDiarization('refining');
    void (async () => {
      let savedKey: string;
      try {
        const blob = encodeWav(chunks, recordedSampleRateRef.current);
        const presign = await presignRecordingUpload(noteId, {
          contentType: RECORDING_CONTENT_TYPE,
          contentLength: blob.size,
        });
        const put = await fetch(presign.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': RECORDING_CONTENT_TYPE },
          body: blob,
        });
        if (!put.ok) throw new Error(`recording upload failed: ${put.status}`);
        await saveRecording(noteId, presign.key);
        savedKey = presign.key;
        setRecordingUpload('uploaded');
      } catch {
        recordingUploadedRef.current = false;
        setRecordingUpload('failed');
        // Trigger never started → 'failed' tells the caller to fall back to a local analyse.
        setDiarization('failed');
        return;
      }
      // Kick off the batch job. analyseOnCompletion carries the auto-analyse intent so the
      // completion Lambda re-analyses on the winning transcript (33-B2). Stays 'refining' on 202;
      // a timeout becomes 'timedOut' (the server still owns the analyse — keep deferring); a start
      // failure becomes 'failed' (never started → local fallback analyse).
      try {
        await startDiarization(noteId, savedKey, analyseOnCompletionRef.current);
        setDiarization('refining');
        if (diarizationTimerRef.current) clearTimeout(diarizationTimerRef.current);
        diarizationTimerRef.current = setTimeout(
          () => setDiarization((s) => (s === 'refining' ? 'timedOut' : s)),
          DIARIZATION_TIMEOUT_MS,
        );
      } catch {
        setDiarization('failed');
      }
    })();
  }, [noteId]);

  useEffect(
    () => () => {
      commitTranscript();
      cleanup();
      if (diarizationTimerRef.current) clearTimeout(diarizationTimerRef.current);
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

  const startRecording = useCallback((includeCallAudio: boolean, autoAnalyse: boolean, resumeFrom?: string) => {
    stoppedRef.current = false;
    analyseOnCompletionRef.current = autoAnalyse;
    const resumePrefix = resumeFrom ? `${resumeFrom}\n${RESUME_SEPARATOR}\n` : '';
    resumePrefixRef.current = resumePrefix;
    finalizedRef.current = resumePrefix;
    lastPartialAtRef.current = 0;
    lastDraftRef.current = null;
    committedRef.current = false;
    recordedChunksRef.current = [];
    recordingUploadedRef.current = false;
    if (diarizationTimerRef.current) {
      clearTimeout(diarizationTimerRef.current);
      diarizationTimerRef.current = null;
    }
    setTranscript(resumePrefix);
    setElapsedSeconds(0);
    setError(undefined);
    setRecordingUpload('idle');
    setDiarization('idle');
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

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;
        if (stoppedRef.current) {
          cleanup();
          return;
        }

        const audioContext = new AudioContext({ sampleRate: 16000 });
        audioContextRef.current = audioContext;
        // The browser may not honour the requested 16 kHz exactly; record the actual
        // rate so the WAV header matches the captured PCM.
        recordedSampleRateRef.current = audioContext.sampleRate;
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

        // 48-A: decide the STT engine now that the real capture rate is known. Local runs only
        // on the desktop shell, when the user selected it, the on-device model is downloaded,
        // and the browser honoured 16 kHz (whisper needs 16 kHz mono). Anything else → cloud.
        const desktopLocal = window.desktop?.local;
        let useLocal = false;
        if (desktopLocal && readStoredMode() === 'local' && audioContext.sampleRate === 16000) {
          try {
            useLocal = (await desktopLocal.getStatus()).modelReady;
          } catch {
            useLocal = false;
          }
        }

        workletNode.port.onmessage = (e: MessageEvent) => {
          if (stoppedRef.current) return;
          const chunks = chunker.push(e.data as Float32Array);
          if (chunks.length === 0) return;
          for (const chunk of chunks) {
            audioQueue.push(chunk);
            // Tee the same PCM chunk into the recording buffer for the WAV upload (33-A).
            recordedChunksRef.current.push(chunk);
            // 48-A: and, in local mode, stream it to the on-device whisper engine. Pass a
            // standalone ArrayBuffer of exactly this chunk's bytes (defensive against chunk
            // being a subarray view; ipcRenderer structured-clones it across to main).
            if (useLocal && desktopLocal) {
              desktopLocal.pushPcm(new Uint8Array(chunk).buffer);
            }
          }
          wakeupRef.current?.();
          wakeupRef.current = null;
        };

        // 48-A: local engine — the on-device whisper session produces the live transcript.
        // Its parsed segments feed the same finalizedRef/setTranscript accumulator the cloud
        // path uses, so draft-autosave, commit, WAV upload and analysis downstream are identical.
        if (useLocal && desktopLocal) {
          const parts: string[] = [];
          const offSegments = desktopLocal.onSegments((segs) => {
            // Gate on committedRef, NOT stoppedRef: stopRecording sets stoppedRef before awaiting
            // finish(), and finish() is what produces the flushed tail window — so a stoppedRef
            // guard here would discard exactly the last window we are flushing. committedRef flips
            // only after finish() resolves, so tail segments still land before the commit.
            if (committedRef.current) return;
            for (const s of segs) {
              const t = s.text.trim();
              if (t) parts.push(t);
            }
            finalizedRef.current = resumePrefixRef.current + parts.join(' ');
            setTranscript(finalizedRef.current);
          });
          const offError = desktopLocal.onError((message) => {
            // On-device engine crashed mid-recording. Surface it; audio is still captured to the
            // WAV, so the on-stop upload + diarization backfills the durable transcript (no empty
            // transcript). Live text simply stops updating.
            console.error('[local transcription]', message);
            setError(`On-device transcription failed: ${message}`);
          });
          localCleanupRef.current = () => {
            offSegments();
            offError();
          };
          try {
            await desktopLocal.start();
            localActiveRef.current = true;
          } catch (err) {
            // Could not start the engine at all → clean up and fall through to the cloud path.
            localCleanupRef.current?.();
            localCleanupRef.current = null;
            console.warn('Local transcription unavailable; falling back to cloud.', err);
            useLocal = false;
          }
        }

        if (useLocal) {
          setStatus('recording');
          startTimeRef.current = Date.now();
          timerRef.current = setInterval(() => {
            setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
          }, 1000);
          checkpointTimerRef.current = setInterval(saveCheckpoint, CHECKPOINT_INTERVAL_MS);
          return; // Stop is driven by stopRecording (flush the session, then commit/upload).
        }

        // Cloud engine (default) — stream PCM to AWS Transcribe.
        const creds = await getTranscriptionCredentials();
        if (stoppedRef.current) {
          cleanup();
          return;
        }

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
          uploadRecording();
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
  }, [cleanup, saveCheckpoint, commitTranscript, uploadRecording]);

  const stopRecording = useCallback(() => {
    stoppedRef.current = true;
    // 48-A: in local mode, flush the on-device engine's final window before committing so the
    // last few seconds aren't lost. 48-B: finish() also runs the higher-quality medium.en pass over
    // the whole recording and resolves with that transcript (or null → keep the live base.en text).
    void (async () => {
      if (localActiveRef.current) {
        localActiveRef.current = false;
        setStatus('finalising');
        try {
          const finalText = await window.desktop?.local.finish();
          if (finalText) {
            finalizedRef.current = resumePrefixRef.current + finalText;
            setTranscript(finalizedRef.current);
          }
        } catch (err) {
          console.warn('Local transcription finish/final-pass failed on stop.', err);
        }
        localCleanupRef.current?.();
        localCleanupRef.current = null;
      }
      commitTranscript();
      uploadRecording();
      cleanup();
      setStatus('stopped');
    })();
  }, [cleanup, commitTranscript, uploadRecording]);

  const reset = useCallback(() => {
    cleanup();
    finalizedRef.current = '';
    resumePrefixRef.current = '';
    lastDraftRef.current = null;
    committedRef.current = false;
    recordedChunksRef.current = [];
    recordingUploadedRef.current = false;
    if (diarizationTimerRef.current) {
      clearTimeout(diarizationTimerRef.current);
      diarizationTimerRef.current = null;
    }
    setStatus('idle');
    setTranscript('');
    setElapsedSeconds(0);
    setError(undefined);
    setRecordingUpload('idle');
    setDiarization('idle');
    stoppedRef.current = false;
  }, [cleanup]);

  return { status, transcript, elapsedSeconds, error, recordingUpload, diarization, startRecording, stopRecording, reset };
}
