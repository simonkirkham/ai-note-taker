import { describe, it, expect } from 'vitest'
import { PcmChunker, floatTo16BitPcm, CHUNK_SAMPLES } from '../hooks/pcm'

describe('floatTo16BitPcm', () => {
  it('produces little-endian 16-bit PCM, two bytes per sample', () => {
    const bytes = floatTo16BitPcm(new Float32Array([0, 1, -1]))
    expect(bytes.byteLength).toBe(6)
    const view = new DataView(bytes.buffer)
    expect(view.getInt16(0, true)).toBe(0)
    expect(view.getInt16(2, true)).toBe(32767) // +1.0 → max
    expect(view.getInt16(4, true)).toBe(-32767) // -1.0 → symmetric −32767
  })

  it('clamps samples outside [-1, 1] to the Int16 range', () => {
    const bytes = floatTo16BitPcm(new Float32Array([2, -2]))
    const view = new DataView(bytes.buffer)
    expect(view.getInt16(0, true)).toBe(32767)
    expect(view.getInt16(2, true)).toBe(-32768)
  })
})

describe('PcmChunker', () => {
  it('uses a 100ms-at-16kHz chunk size', () => {
    expect(CHUNK_SAMPLES).toBe(1600)
  })

  it('buffers sub-chunk frames and emits nothing until a full chunk accumulates', () => {
    const chunker = new PcmChunker()
    const out: Uint8Array[] = []

    // 12 × 128 = 1536 samples (< 1600) → still buffering, nothing emitted.
    for (let i = 0; i < 12; i++) out.push(...chunker.push(new Float32Array(128)))
    expect(out).toHaveLength(0)

    // One more 128-sample frame crosses 1600 → exactly one full chunk emitted.
    out.push(...chunker.push(new Float32Array(128)))
    expect(out).toHaveLength(1)
    expect(out[0].byteLength).toBe(CHUNK_SAMPLES * 2) // 3200 bytes
  })

  it('splits a frame larger than the chunk into multiple full chunks', () => {
    const chunker = new PcmChunker()
    const out = chunker.push(new Float32Array(CHUNK_SAMPLES * 2))
    expect(out).toHaveLength(2)
    expect(out.every((b) => b.byteLength === CHUNK_SAMPLES * 2)).toBe(true)
  })

  it('flush returns the buffered remainder once, then null', () => {
    const chunker = new PcmChunker()
    chunker.push(new Float32Array(100))
    const tail = chunker.flush()
    expect(tail?.byteLength).toBe(200) // 100 samples × 2 bytes
    expect(chunker.flush()).toBeNull()
  })

  it('flush returns null when nothing is buffered', () => {
    expect(new PcmChunker().flush()).toBeNull()
  })
})
