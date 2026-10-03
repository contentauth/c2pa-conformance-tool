import { describe, it, expect } from 'vitest'
import { readSafetensorsSummary } from './safetensorsSummary'

function safetensors(header: unknown, data = new Uint8Array(0)): Blob {
  const json = new TextEncoder().encode(JSON.stringify(header))
  const len = new Uint8Array(8)
  new DataView(len.buffer).setBigUint64(0, BigInt(json.length), true)
  return new Blob([len, json, data])
}

describe('readSafetensorsSummary', () => {
  it('lists tensors, parameter counts, dtypes and metadata keys', async () => {
    const summary = await readSafetensorsSummary(safetensors({
      __metadata__: { format: 'pt', 'c2pa:manifest': 'AAAA' },
      'layer.weight': { dtype: 'F32', shape: [4, 3], data_offsets: [0, 48] },
      'layer.bias': { dtype: 'F16', shape: [4], data_offsets: [48, 56] },
    }, new Uint8Array(56)))
    expect(summary).not.toBeNull()
    expect(summary!.tensors.map(t => [t.name, t.params])).toEqual([['layer.weight', 12], ['layer.bias', 4]])
    expect(summary!.totalParams).toBe(16)
    expect(summary!.dtypes).toEqual(['F16', 'F32'])
    expect(summary!.metadataKeys).toEqual(['c2pa:manifest', 'format'])
    expect(summary!.hasC2paManifest).toBe(true)
  })

  it('treats a scalar (empty shape) as one parameter', async () => {
    const summary = await readSafetensorsSummary(safetensors({ s: { dtype: 'I64', shape: [], data_offsets: [0, 8] } }))
    expect(summary!.totalParams).toBe(1)
    expect(summary!.hasC2paManifest).toBe(false)
  })

  it('returns null for files that are not SafeTensors', async () => {
    expect(await readSafetensorsSummary(new Blob(['tiny']))).toBeNull()
    expect(await readSafetensorsSummary(new Blob([new Uint8Array(8).fill(0xff), 'x']))).toBeNull()
    expect(await readSafetensorsSummary(safetensors([1, 2, 3]))).toBeNull()
    expect(await readSafetensorsSummary(safetensors({ t: { dtype: 'F32' } }))).toBeNull()
  })
})
