import { describe, it, expect } from 'vitest'
import { encodeWav } from '../hooks/wav'

function readString(view: DataView, offset: number, length: number): string {
  let s = ''
  for (let i = 0; i < length; i++) s += String.fromCharCode(view.getUint8(offset + i))
  return s
}

describe('encodeWav', () => {
  it('writes a 44-byte PCM WAV header matching the sample rate and data length', () => {
    const chunkA = new Uint8Array([1, 2, 3, 4])
    const chunkB = new Uint8Array([5, 6])
    const blob = encodeWav([chunkA, chunkB], 16000)

    expect(blob.type).toBe('audio/wav')
    expect(blob.size).toBe(44 + 6)
  })

  it('encodes mono 16-bit fields and concatenates the PCM payload in order', async () => {
    const chunkA = new Uint8Array([10, 20])
    const chunkB = new Uint8Array([30, 40])
    const blob = encodeWav([chunkA, chunkB], 48000)
    const buffer = await blob.arrayBuffer()
    const view = new DataView(buffer)

    expect(readString(view, 0, 4)).toBe('RIFF')
    expect(readString(view, 8, 4)).toBe('WAVE')
    expect(readString(view, 12, 4)).toBe('fmt ')
    expect(view.getUint16(20, true)).toBe(1) // PCM
    expect(view.getUint16(22, true)).toBe(1) // mono
    expect(view.getUint32(24, true)).toBe(48000) // sample rate
    expect(view.getUint16(34, true)).toBe(16) // bits per sample
    expect(readString(view, 36, 4)).toBe('data')
    expect(view.getUint32(40, true)).toBe(4) // data length
    // PCM payload preserved in chunk order.
    expect(view.getUint8(44)).toBe(10)
    expect(view.getUint8(45)).toBe(20)
    expect(view.getUint8(46)).toBe(30)
    expect(view.getUint8(47)).toBe(40)
  })

  it('handles an empty capture (header only, zero data length)', () => {
    const blob = encodeWav([], 16000)
    expect(blob.size).toBe(44)
  })
})
