import { useCallback, useEffect, useRef, useState } from 'react';
import { presignRecordingUpload, saveRecording } from '../api/recordings';
import { completeTranscription, getTranscriptionCredentials, saveTranscriptionDraft, startDiarization } from '../api/transcription';
import { recordRumEvent } from '../rum';
import { PcmChunker } from './pcm';
import { SpeakerTranscript } from './speakerSegments';
import { readStoredKeepAudioLocal } from './useKeepAudioLocal';
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
  // BUG-55: await the stop sequence and the transcript commit POST. Only sign-out needs it — it
  // clears the token, so an un-awaited commit 401s and the transcript is lost.
  awaitCommit: () => Promise<void>;
  reset: () => void;
}

// 48-C: concatenate captured 16-bit PCM chunks into one ArrayBuffer to hand to the diarizer.
function concatPcm(chunks: Uint8Array[]): ArrayBuffer {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out.buffer;
}

// BUG-55: how long a confirmed sign-out waits for the local finalise before going ahead anyway.
//
// It has to be DERIVED, not a flat constant. Review caught a flat 5 minutes being smaller than the
// thing it waits for, which makes the guard a no-op on exactly the case it exists for. The measured
// numbers (BUG-52): the stop-time pass is `small.en` at ~2.3x realtime, and 1:1 diarization runs it
// TWICE. So processing ≈ audio × 2 / 2.3 ≈ audio × 0.87 — a 30-minute 1:1 needs ~26 minutes, five
// times the old budget. Anything under that expires mid-pass, the token is cleared, the POST 401s,
// and BUG-55 reproduces.
//
// audio × 1.3 gives ~50% slack over that worst case. The floor covers short recordings (engine
// startup dominates); the ceiling is the actual purpose of having a deadline at all — a wedged
// engine (BUG-56's "process alive, never ready, silent") must not strand the user forever.
const AWAIT_COMMIT_SLACK = 1.3;
const AWAIT_COMMIT_MIN_MS = 2 * 60_000;
const AWAIT_COMMIT_MAX_MS = 30 * 60_000;

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
  // BUG-55: the in-flight stop sequence and the commit POST it fires, so a caller that is about to
  // destroy the session's auth can wait for them. Null until Stop runs.
  const stopSequenceRef = useRef<Promise<void> | null>(null);
  const commitPostRef = useRef<Promise<void> | null>(null);
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
  // 48-C: for a 1:1 call in local mode, the mic ("me") and loopback ("them") are captured as
  // SEPARATE buffers so the stop-time pass can diarize by source. diarizeActiveRef gates that path.
  const meChunksRef = useRef<Uint8Array[]>([]);
  const themChunksRef = useRef<Uint8Array[]>([]);
  const diarizeActiveRef = useRef(false);

  const cleanup = useCallback(() => {
    stoppedRef.current = true;
    wakeupRef.current?.();
    wakeupRef.current = null;
    // 48-A: detach the on-device engine's IPC listeners (no-op in cloud mode).
    localCleanupRef.current?.();
    localCleanupRef.current = null;
    localActiveRef.current = false;
    // 48-C: release the source-separation buffers (already consumed by diarize on stop).
    meChunksRef.current = [];
    themChunksRef.current = [];
    diarizeActiveRef.current = false;
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
    // BUG-55: keep the POST's promise. Fire-and-forget is right for every destination except
    // sign-out, which CLEARS THE TOKEN — an un-awaited commit then 401s, committedRef is released,
    // and nothing retries. awaitCommit() below lets that one caller wait; everyone else is unchanged.
    commitPostRef.current = completeTranscription(noteId, text, elapsed).catch(() => {
      committedRef.current = false;
    });
  }, [noteId]);

  // Assemble the captured PCM into a WAV and upload it to S3, then save its key to
  // the note (33-A). Fire-and-forget on Stop / natural end — independent of the
  // transcript commit. One-shot guarded so a Stop after a natural end can't double
  // upload; failures surface as 'failed' (the optimistic link reconciles to hidden).
  // triggerCloudDiarization=false (48-C local mode): upload the WAV but DON'T start the cloud
  // batch diarization — the on-device diarization has already produced the committed transcript,
  // so diarization stays 'idle' and the auto-analyse runs locally on it (no server refine).
  const uploadRecording = useCallback((triggerCloudDiarization = true) => {
    if (recordingUploadedRef.current) return;
    const chunks = recordedChunksRef.current;
    if (chunks.length === 0) return;
    recordingUploadedRef.current = true;
    recordedChunksRef.current = [];
    setRecordingUpload('uploading');
    // 33-B2: a recording WILL be uploaded + diarized — set 'refining' SYNCHRONOUSLY (before the
    // async upload) so the on-Stop auto-analyse, which runs the instant status becomes 'stopped',
    // sees the in-flight diarization and defers to the server instead of racing the 202.
    if (triggerCloudDiarization) setDiarization('refining');
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
      // 48-C: local mode diarizes on-device, so the WAV is archived but no cloud batch job runs.
      if (!triggerCloudDiarization) return;
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
    // 48-B: 'finalising' is an active session (the minutes-long medium.en pass) — keep the
    // unsaved-changes warning + keepalive draft flush armed through it too, per the same
    // "finalising is active" principle applied in NoteView.
    if (status !== 'recording' && status !== 'requestingCredentials' && status !== 'finalising') return;
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
        let systemSource: MediaStreamAudioSourceNode | null = null;
        if (displayStream && displayStream.getAudioTracks().length > 0) {
          // Sum mic + system audio into a single mono mix before the worklet sees it.
          systemSource = audioContext.createMediaStreamSource(displayStream);
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

        // 48-A / BUG-53: local engine — the on-device whisper-server streams the live transcript.
        // It emits the whole current transcript (committed text + settling tail) as one string,
        // which replaces (not appends to) finalizedRef — feeding the same finalizedRef/setTranscript
        // accumulator the cloud path uses, so draft-autosave, commit, WAV upload and analysis
        // downstream are identical.
        if (useLocal && desktopLocal) {
          const offLive = desktopLocal.onLive((text) => {
            // Gate on committedRef, NOT stoppedRef: stopRecording sets stoppedRef before awaiting
            // finish(), and finish() is what produces the flushed tail — so a stoppedRef guard here
            // would discard exactly the last update we are flushing. committedRef flips only after
            // finish() resolves, so a late live update still lands before the commit.
            if (committedRef.current) return;
            // BUG-56: live text arriving is proof the engine is working, so any earlier on-device
            // banner is now false. Without this, a model that loads slowly (past the ready deadline)
            // or an engine that recovers leaves a failure message sitting above a transcript that is
            // visibly filling in.
            setError(undefined);
            finalizedRef.current = resumePrefixRef.current + text;
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
            offLive();
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
          // 48-C: only now that local is CONFIRMED active (start() succeeded) do we attach the
          // source-separation worklets — otherwise a start-failure → cloud fallback would leave
          // them buffering mic/loopback into me/them for the whole recording, never consumed.
          if (systemSource) {
            diarizeActiveRef.current = true;
            const meChunker = new PcmChunker();
            const themChunker = new PcmChunker();
            const meWorklet = new AudioWorkletNode(audioContext, 'pcm-processor');
            const themWorklet = new AudioWorkletNode(audioContext, 'pcm-processor');
            micSource.connect(meWorklet);
            systemSource.connect(themWorklet);
            meWorklet.port.onmessage = (e: MessageEvent) => {
              if (stoppedRef.current) return;
              for (const c of meChunker.push(e.data as Float32Array)) meChunksRef.current.push(c);
            };
            themWorklet.port.onmessage = (e: MessageEvent) => {
              if (stoppedRef.current) return;
              for (const c of themChunker.push(e.data as Float32Array)) themChunksRef.current.push(c);
            };
          }
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
    // BUG-55: idempotent. `handleConfirmedLeave` calls this unconditionally and `isRecording`
    // includes 'finalising', so pressing Stop and THEN signing out called it twice. The second call
    // reassigned stopSequenceRef to a fresh IIFE which — with localActiveRef already false — took
    // the CLOUD branch and resolved immediately. awaitCommit() then awaited the wrong promise and
    // signed out mid-finalise: the exact failure this bug is about, on the exact path it targets.
    // Re-entering is a no-op elsewhere too (commitTranscript and uploadRecording are one-shot,
    // cleanup is idempotent), so returning early is behaviour-preserving.
    if (stoppedRef.current && stopSequenceRef.current) return;
    stoppedRef.current = true;
    // 48-A: in local mode, flush the on-device engine's final window before committing so the
    // last few seconds aren't lost. 48-B: finish() also runs the higher-quality medium.en pass over
    // the whole recording and resolves with that transcript (or null → keep the live base.en text).
    stopSequenceRef.current = (async () => {
      if (localActiveRef.current) {
        localActiveRef.current = false;
        // 48-C: local mode archives the WAV but diarizes on-device — no cloud batch job (pass false).
        // 48-E: unless "keep recordings on this device only" is on (default), in which case the audio
        // never leaves the machine — skip the upload entirely. Transcript + analysis still happen.
        if (!readStoredKeepAudioLocal()) uploadRecording(false);
        else recordedChunksRef.current = []; // keep-local: free the retained PCM (nothing uploads it)
        setStatus('finalising');
        try {
          let finalText: string | null = null;
          // 48-C: 1:1 call → diarize by source separation (mic vs loopback). If it produces a
          // Me/Them transcript, discard the live (mixed) session's single-stream final pass.
          if (
            diarizeActiveRef.current &&
            meChunksRef.current.length > 0 &&
            themChunksRef.current.length > 0 &&
            window.desktop?.local.diarize
          ) {
            const me = concatPcm(meChunksRef.current);
            const them = concatPcm(themChunksRef.current);
            finalText = await window.desktop.local.diarize(me, them);
            if (finalText) window.desktop.local.discard();
          }
          // 48-B fallback: single-stream medium.en final pass (mic-only local, or diarization
          // unavailable/empty). finish() returns null if the session was already discarded.
          if (!finalText) finalText = (await window.desktop?.local.finish()) ?? null;
          if (finalText) {
            finalizedRef.current = resumePrefixRef.current + finalText;
            setTranscript(finalizedRef.current);
          }
        } catch (err) {
          console.warn('Local transcription finish/diarization failed on stop.', err);
        } finally {
          // Guarantee the main-process live session is released even if an IPC call threw before
          // finish()/discard() ran (no-op when already discarded/finished).
          window.desktop?.local.discard();
        }
        localCleanupRef.current?.();
        localCleanupRef.current = null;
        commitTranscript();
        cleanup();
        setStatus('stopped');
        return;
      }
      commitTranscript();
      uploadRecording();
      cleanup();
      setStatus('stopped');
    })();
  }, [cleanup, commitTranscript, uploadRecording]);

  // BUG-55: resolves once the stop sequence AND the commit POST it fires have finished. In cloud
  // mode both are effectively immediate; in local mode the stop sequence runs the small.en final
  // pass (plus 1:1 diarization) first — minutes on a long meeting, which is exactly why this is
  // opt-in per destination rather than awaited on every navigation.
  //
  // Two things it must never do, because the caller is a sign-out the user has already confirmed:
  //
  //  - REJECT. Only the local IPC calls sit inside the stop sequence's try/catch; the surrounding
  //    `readStoredKeepAudioLocal()`, `cleanup()` and `setStatus()` do not. A throw there would
  //    propagate into the continuation and sign-out would never run. Caught here so the comment is
  //    true by construction rather than by inspection of code that may change.
  //  - HANG. `window.desktop.local.finish()/diarize()` have no timeout on this side, and BUG-56's
  //    observed failure shape is precisely "process alive, never ready, silent". Without a deadline
  //    the continuation never runs, `leavingRef` stays latched, and the app is stuck until restart.
  //    Past the deadline we proceed with the sign-out: no worse than the behaviour before this fix.
  const awaitCommit = useCallback(async () => {
    const settled = (async () => {
      try {
        await stopSequenceRef.current;
        await commitPostRef.current;
      } catch {
        // Already surfaced by the stop sequence / the commit's own catch; never block the leave.
      }
    })();
    const recordedMs = startTimeRef.current ? Date.now() - startTimeRef.current : 0;
    const deadlineMs = Math.min(
      AWAIT_COMMIT_MAX_MS,
      Math.max(AWAIT_COMMIT_MIN_MS, recordedMs * AWAIT_COMMIT_SLACK),
    );
    // The timer is cleared once the race is decided — a stray one has no purpose left, and this is
    // the same "a timer outlived what it was for" shape as BUG-66.
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    let expired = false;
    try {
      await Promise.race([
        settled,
        new Promise<void>((resolve) => {
          deadlineTimer = setTimeout(() => {
            expired = true;
            resolve();
          }, deadlineMs);
        }),
      ]);
    } finally {
      if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
    }
    if (expired) {
      // The caller is about to destroy the session's auth, so the transcript is probably lost.
      // Say so somewhere: BUG-56 and BUG-65 were both diagnosed by reading code because the local
      // path had no observable channel at all. (recordRumEvent is inert until TI-67 enables custom
      // events, hence the console.warn too.)
      console.warn(`Transcript commit did not finish within ${Math.round(deadlineMs / 1000)}s; leaving anyway.`);
      recordRumEvent('transcriptCommitDeadlineExpired', { deadlineMs, recordedMs });
    }
  }, []);

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

  return { status, transcript, elapsedSeconds, error, recordingUpload, diarization, startRecording, stopRecording, awaitCommit, reset };
}
