// Reads the JSON header of a SafeTensors file for the Report tab's preview: an 8-byte
// little-endian header length followed by a JSON object mapping tensor names to
// { dtype, shape, data_offsets }, plus an optional string-to-string `__metadata__` map (where
// C2PA stores the manifest store under `c2pa:manifest`).

export interface SafetensorsTensor {
  name: string
  dtype: string
  shape: number[]
  params: number
}

export interface SafetensorsSummary {
  tensors: SafetensorsTensor[]
  totalParams: number
  dtypes: string[]
  metadataKeys: string[]
  hasC2paManifest: boolean
}

// Headers in real models are at most a few MB; refuse anything larger than this.
export const MAX_HEADER_BYTES = 100 * 1024 * 1024

/** Parses the header from the start of a SafeTensors file, or returns null if it is not one. */
export async function readSafetensorsSummary(file: Blob): Promise<SafetensorsSummary | null> {
  if (file.size < 8) return null
  const len = new DataView(await file.slice(0, 8).arrayBuffer()).getBigUint64(0, true)
  if (len === 0n || len > BigInt(Math.min(MAX_HEADER_BYTES, file.size - 8))) return null
  let header: unknown
  try {
    header = JSON.parse(new TextDecoder().decode(await file.slice(8, 8 + Number(len)).arrayBuffer()))
  } catch {
    return null
  }
  if (typeof header !== 'object' || header === null || Array.isArray(header)) return null

  const tensors: SafetensorsTensor[] = []
  let metadata: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(header as Record<string, unknown>)) {
    if (name === '__metadata__') {
      if (typeof value === 'object' && value !== null) metadata = value as Record<string, unknown>
      continue
    }
    const t = value as { dtype?: unknown; shape?: unknown }
    if (typeof t?.dtype !== 'string' || !Array.isArray(t.shape)) return null
    const shape = t.shape.map(Number)
    tensors.push({ name, dtype: t.dtype, shape, params: shape.reduce((a, b) => a * b, 1) })
  }
  return {
    tensors,
    totalParams: tensors.reduce((a, t) => a + t.params, 0),
    dtypes: [...new Set(tensors.map(t => t.dtype))].sort(),
    metadataKeys: Object.keys(metadata).sort(),
    hasC2paManifest: 'c2pa:manifest' in metadata,
  }
}
