import { describe, it, expect } from 'vitest'
import { midiFormatName, readMidiSummary } from './midiSummary'

function midi(format: number, tracks: number, division: number): Blob {
  const header = new Uint8Array(14)
  const view = new DataView(header.buffer)
  header.set([0x4d, 0x54, 0x68, 0x64]) // MThd
  view.setUint32(4, 6)
  view.setUint16(8, format)
  view.setUint16(10, tracks)
  view.setUint16(12, division)
  return new Blob([header, new Uint8Array([0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 0])]) // empty MTrk
}

describe('readMidiSummary', () => {
  it('reads format, track count and ticks per quarter note', async () => {
    expect(await readMidiSummary(midi(1, 4, 480))).toEqual({
      format: 1, tracks: 4, timing: '480 ticks per quarter note',
    })
  })

  it('reads SMPTE timing', async () => {
    // -25 fps (0xE7) with 40 ticks per frame.
    expect((await readMidiSummary(midi(0, 1, 0xe728)))?.timing).toBe('25 fps SMPTE, 40 ticks per frame')
  })

  it('returns null for files that are not MIDI', async () => {
    expect(await readMidiSummary(new Blob(['MThd']))).toBeNull()
    expect(await readMidiSummary(new Blob(['RIFF0000WAVEfmt ']))).toBeNull()
  })

  it('names the three SMF formats', () => {
    expect(midiFormatName(0)).toBe('single track')
    expect(midiFormatName(2)).toBe('multiple independent sequences')
    expect(midiFormatName(7)).toBe('unknown')
  })
})
