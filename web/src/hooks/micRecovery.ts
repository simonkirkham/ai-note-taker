// BUG-85: a microphone that disappears mid-recording is asked for again until it is back.
//
// 2026-10-06: a USB-C dock dropped off the laptop for two seconds when the screen flicked off, and
// took the webcam microphone on it. The device was back almost at once, but the recording had no
// way to pick it up again: the dead track fed digital silence into a healthy transcription stream
// for the remaining 23 minutes. The same drop, to the second, explains the 3.5 hours lost on
// 2026-09-17.
//
// Only the microphone is recovered. A shared screen's call audio cannot be: asking for it again
// needs a click, and a recording does not get one.

// Tries for the same physical microphone — one a second, so about ten seconds — before settling for
// whatever the system default is. A dock re-enumerates in two or three; ten covers a slow one
// without leaving the meeting silent for long if the device is gone for good.
export const MIC_SAME_DEVICE_ATTEMPTS = 10;

export interface MicRecoveryOptions {
  context: AudioContext;
  /** The live microphone source, as first wired into the capture graph. */
  source: MediaStreamAudioSourceNode;
  /** Every node the microphone feeds. Extended later when the on-device engine adds its own. */
  targets: AudioNode[];
  /** The stream currently being captured; replaced on reconnection. */
  currentStream: () => MediaStream | null;
  /** True once the recording is over; a microphone that turns up afterwards is released at once. */
  isStopped: () => boolean;
  /** A reconnected stream is in place of `lost`. */
  replaced: (lost: MediaStream | null, replacement: MediaStream) => void;
}

export interface MicRecovery {
  /** Called once a second: notices a track that died without saying so, and retries. */
  check: () => void;
  /** Stops listening; any microphone still being asked for is released when it answers. */
  detach: () => void;
}

function deviceIdOf(stream: MediaStream): string | undefined {
  try {
    return stream.getAudioTracks()[0]?.getSettings?.().deviceId || undefined;
  } catch {
    return undefined;
  }
}

function hasEnded(stream: MediaStream | null): boolean {
  if (!stream) return false;
  try {
    return stream.getAudioTracks().some((track) => track.readyState === 'ended');
  } catch {
    return false;
  }
}

function release(stream: MediaStream): void {
  try {
    for (const track of stream.getTracks()) track.stop();
  } catch (err) {
    console.warn('Releasing a microphone failed.', err);
  }
}

export function createMicRecovery(options: MicRecoveryOptions): MicRecovery {
  const { context, targets, currentStream, isStopped, replaced } = options;
  let source = options.source;
  let watched: MediaStream | null = null;
  let lost = false;
  let attempts = 0;
  let asking = false;
  let detached = false;
  const initial = currentStream();
  const deviceId = initial ? deviceIdOf(initial) : undefined;

  const onEnded = () => {
    lost = true;
    attempt();
  };

  function watch(stream: MediaStream): void {
    unwatch();
    watched = stream;
    try {
      for (const track of stream.getAudioTracks()) track.addEventListener('ended', onEnded);
    } catch (err) {
      console.warn('Listening for the microphone ending failed.', err);
    }
  }

  function unwatch(): void {
    if (!watched) return;
    try {
      for (const track of watched.getAudioTracks()) track.removeEventListener('ended', onEnded);
    } catch {
      // A released track may refuse; it can no longer fire anyway.
    }
    watched = null;
  }

  function swapIn(replacement: MediaStream): void {
    const next = context.createMediaStreamSource(replacement);
    for (const target of targets) next.connect(target);
    try {
      source.disconnect();
    } catch (err) {
      console.warn('Disconnecting the lost microphone failed.', err);
    }
    source = next;
    const previous = currentStream();
    replaced(previous, replacement);
    if (previous) release(previous);
    watch(replacement);
    lost = false;
    attempts = 0;
  }

  function attempt(): void {
    if (detached || asking || !lost || isStopped()) return;
    asking = true;
    attempts += 1;
    const constraints: MediaStreamConstraints =
      deviceId && attempts <= MIC_SAME_DEVICE_ATTEMPTS ? { audio: { deviceId: { exact: deviceId } } } : { audio: true };
    navigator.mediaDevices
      .getUserMedia(constraints)
      .then((replacement) => {
        if (detached || isStopped()) {
          release(replacement);
          return;
        }
        const tries = attempts;
        try {
          swapIn(replacement);
        } catch (err) {
          release(replacement);
          throw err;
        }
        console.info(`Microphone reconnected after ${tries} attempt(s).`);
      })
      .catch((err: unknown) => {
        console.warn(`Microphone still unavailable (attempt ${attempts}).`, err);
      })
      .finally(() => {
        asking = false;
      });
  }

  if (initial) watch(initial);

  return {
    check() {
      if (detached) return;
      if (!lost && hasEnded(currentStream())) lost = true;
      attempt();
    },
    detach() {
      detached = true;
      unwatch();
    },
  };
}
