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

// A request the browser has not answered in this long is abandoned and asked again. The premise is
// a hypothesis, not a measurement: a request left unsettled while a device is mid-re-enumeration —
// exactly the dock-drop moment — would otherwise end recovery for the rest of the meeting. If the
// browser handles a page's requests one at a time, the next one queues behind the hung one, so at
// most one abandoned request is ever left outstanding rather than one every five seconds.
export const MIC_REQUEST_TIMEOUT_MS = 5000;

// Chromium's stand-ins for "whatever the system picks". A recording asked for no particular device,
// so its track reports one of these, and asking for `exact: 'default'` again straight after a drop
// returns whatever Windows has just promoted — usually the laptop's own microphone, which in a
// docked, lid-closed setup hears next to nothing. The physical device behind it is what is wanted.
const VIRTUAL_DEVICE_IDS = new Set(['default', 'communications']);

export interface MicRecoveryOptions {
  context: AudioContext;
  /** The live microphone source, as first wired into the capture graph. */
  source: MediaStreamAudioSourceNode;
  /** Every node the microphone feeds so far. */
  targets: AudioNode[];
  /** The stream currently being captured; replaced on reconnection. */
  currentStream: () => MediaStream | null;
  /** True once the recording is over; a microphone that turns up afterwards is released at once. */
  isStopped: () => boolean;
  /** A reconnected stream is in place of `lost`. */
  replaced: (lost: MediaStream | null, replacement: MediaStream) => void;
}

export interface MicRecovery {
  /** Feeds the microphone into one more node — whichever source is current, now and after a swap. */
  connect: (target: AudioNode) => void;
  /** Called once a second: notices a track that died without saying so, and retries. */
  check: () => void;
  /** Stops listening; any microphone still being asked for is released when it answers. */
  detach: () => void;
}

function settingsOf(stream: MediaStream): MediaTrackSettings | undefined {
  try {
    return stream.getAudioTracks()[0]?.getSettings?.();
  } catch {
    return undefined;
  }
}

// The physical microphone behind a virtual one: the real input sharing its group. Read once, at
// the start, while the device is still there to be listed.
async function physicalDeviceId(settings: MediaTrackSettings | undefined): Promise<string | undefined> {
  const deviceId = settings?.deviceId || undefined;
  if (!deviceId || !VIRTUAL_DEVICE_IDS.has(deviceId)) return deviceId;
  try {
    const inputs = (await navigator.mediaDevices.enumerateDevices()).filter(
      (device) => device.kind === 'audioinput' && !VIRTUAL_DEVICE_IDS.has(device.deviceId),
    );
    const physical = inputs.find((device) => settings?.groupId && device.groupId === settings.groupId)?.deviceId;
    if (!physical) console.warn('Could not tell which microphone the system default is; a reconnection will take the default.');
    return physical;
  } catch (err) {
    console.warn('Listing the microphones failed.', err);
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
  const { context, currentStream, isStopped, replaced } = options;
  const targets = [...options.targets];
  let source = options.source;
  let watched: MediaStream | null = null;
  let lost = false;
  let attempts = 0;
  // The request in flight, if any; a newer one (or a timeout) supersedes it.
  let request: { id: number; askedAt: number } | null = null;
  // An abandoned request that has still not answered. Only one is ever left behind.
  let abandoned: number | null = null;
  let nextRequestId = 0;
  let detached = false;
  const initial = currentStream();
  let deviceId: string | undefined;
  if (initial) {
    void physicalDeviceId(settingsOf(initial)).then((id) => {
      deviceId = id;
    });
  }

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

  // One line per change of state, not one a second: a meeting with no microphone at all would
  // otherwise log 3,600 warnings an hour.
  function worthLogging(attempt: number): boolean {
    return attempt === 1 || attempt === MIC_SAME_DEVICE_ATTEMPTS + 1 || attempt % 60 === 0;
  }

  function attempt(): void {
    if (detached || request || !lost || isStopped()) return;
    attempts += 1;
    const tries = attempts;
    const id = ++nextRequestId;
    request = { id, askedAt: Date.now() };
    const constraints: MediaStreamConstraints =
      deviceId && tries <= MIC_SAME_DEVICE_ATTEMPTS ? { audio: { deviceId: { exact: deviceId } } } : { audio: true };
    navigator.mediaDevices
      .getUserMedia(constraints)
      .then((replacement) => {
        if (detached || isStopped() || request?.id !== id) {
          release(replacement);
          return;
        }
        try {
          swapIn(replacement);
        } catch (err) {
          release(replacement);
          throw err;
        }
        console.info(`Microphone reconnected after ${tries} attempt(s).`);
      })
      .catch((err: unknown) => {
        if (worthLogging(tries)) console.warn(`Microphone still unavailable (attempt ${tries}).`, err);
      })
      .finally(() => {
        if (request?.id === id) request = null;
        if (abandoned === id) abandoned = null;
      });
  }

  if (initial) watch(initial);

  return {
    connect(target) {
      targets.push(target);
      source.connect(target);
    },
    check() {
      if (detached) return;
      if (request && abandoned === null && Date.now() - request.askedAt >= MIC_REQUEST_TIMEOUT_MS) {
        console.warn('A microphone request went unanswered; asking again.');
        abandoned = request.id;
        request = null;
      }
      if (!lost && hasEnded(currentStream())) lost = true;
      attempt();
    },
    detach() {
      detached = true;
      unwatch();
    },
  };
}
