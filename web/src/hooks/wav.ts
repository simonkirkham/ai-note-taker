// Assemble captured 16-bit little-endian PCM chunks (the same chunks streamed to
// Transcribe — see pcm.ts) into a single WAV blob for upload on Stop. Mono, the
// AudioContext's actual sample rate. MVP buffers every chunk in memory and emits
// one blob; multipart/chunked upload for very long meetings is a future slice.
const NUM_CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

export function encodeWav(chunks: Uint8Array[], sampleRate: number): Blob {
  const dataLength = chunks.reduce((n, c) => n + c.byteLength, 0);
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  const blockAlign = (NUM_CHANNELS * BITS_PER_SAMPLE) / 8;
  const byteRate = sampleRate * blockAlign;

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, NUM_CHANNELS, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);
  writeString(36, 'data');
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (const chunk of chunks) {
    new Uint8Array(buffer, offset, chunk.byteLength).set(chunk);
    offset += chunk.byteLength;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
