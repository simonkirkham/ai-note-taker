// Coalesce the AudioWorklet's 128-sample (~8ms) frames into fixed ~100ms PCM
// chunks before they reach the Transcribe streaming client. Each AudioEvent the
// SDK sends is serialised and SigV4-signed on the main thread, so emitting ~10
// chunks/sec instead of ~125 keeps that overhead off the critical path and lets
// the client stream at realtime instead of falling progressively behind.

// 100ms of mono audio at 16kHz.
export const CHUNK_SAMPLES = 1600;

// Float32 [-1, 1] samples → little-endian 16-bit PCM bytes (Transcribe's `pcm`
// encoding). Out-of-range samples are clamped to the Int16 range.
export function floatTo16BitPcm(input: Float32Array): Uint8Array {
  const pcm = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    pcm[i] = Math.max(-32768, Math.min(32767, Math.round(input[i] * 32767)));
  }
  return new Uint8Array(pcm.buffer);
}

export class PcmChunker {
  private readonly buffer = new Float32Array(CHUNK_SAMPLES);
  private filled = 0;

  // Accumulate a worklet frame, returning any full PCM chunks it completed
  // (usually zero or one; more if `frame` is larger than a chunk).
  push(frame: Float32Array): Uint8Array[] {
    const chunks: Uint8Array[] = [];
    let offset = 0;
    while (offset < frame.length) {
      const take = Math.min(this.buffer.length - this.filled, frame.length - offset);
      this.buffer.set(frame.subarray(offset, offset + take), this.filled);
      this.filled += take;
      offset += take;
      if (this.filled === this.buffer.length) {
        chunks.push(floatTo16BitPcm(this.buffer));
        this.filled = 0;
      }
    }
    return chunks;
  }

  // Emit any partially-filled remainder (e.g. on stop); null if empty.
  flush(): Uint8Array | null {
    if (this.filled === 0) return null;
    const chunk = floatTo16BitPcm(this.buffer.subarray(0, this.filled));
    this.filled = 0;
    return chunk;
  }
}
