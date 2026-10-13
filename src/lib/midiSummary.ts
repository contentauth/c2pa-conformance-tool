// Reads the header chunk of a Standard MIDI File for the Report tab's preview: `MThd`, a 32-bit
// big-endian length (6), then 16-bit format, track count and division. A division with the top
// bit clear is ticks per quarter note; with it set, the high byte is a negative SMPTE frame rate
// and the low byte is ticks per frame.

export interface MidiSummary {
  format: number
  tracks: number
  timing: string
}

const FORMAT_NAMES: Record<number, string> = {
  0: 'single track',
  1: 'multiple simultaneous tracks',
  2: 'multiple independent sequences',
}

export function midiFormatName(format: number): string {
  return FORMAT_NAMES[format] ?? 'unknown'
}

/** Parses the MIDI header from the start of a file, or returns null if it is not a MIDI file. */
export async function readMidiSummary(file: Blob): Promise<MidiSummary | null> {
  if (file.size < 14) return null
  const view = new DataView(await file.slice(0, 14).arrayBuffer())
  const id = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))
  if (id !== 'MThd' || view.getUint32(4) < 6) return null
  const division = view.getUint16(12)
  const timing = division & 0x8000
    ? `${-view.getInt8(12)} fps SMPTE, ${division & 0xff} ticks per frame`
    : `${division} ticks per quarter note`
  return { format: view.getUint16(8), tracks: view.getUint16(10), timing }
}
