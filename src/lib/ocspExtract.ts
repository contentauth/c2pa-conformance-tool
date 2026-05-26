/**
 * Client-side extraction of certificate chain from a C2PA-signed file's COSE signature.
 *
 * Parses JUMBF boxes (JPEG APP11 or raw scan) to find the c2pa.signature box,
 * CBOR-decodes the COSE_Sign1 envelope, and extracts the x5chain (key 33) from
 * the protected header. The leaf cert's AIA extension provides the OCSP URL.
 */

import { decode, Tagged } from 'cborg'
import { X509Certificate, AuthorityInfoAccessExtension } from '@peculiar/x509'

export interface OcspExtractResult {
  responderUrl: string
  certDerB64: string
  issuerDerB64: string
}

// COSE protected header key for x5chain (RFC 9360)
const COSE_X5CHAIN = 33

export async function extractOcspParams(file: File): Promise<OcspExtractResult | null> {
  try {
    const fileBytes = new Uint8Array(await file.arrayBuffer())

    // For JPEG, APP11 segments must be reassembled into a contiguous JUMBF stream.
    // All other formats have JUMBF inline in the raw bytes.
    const jumbfBytes = isJpeg(fileBytes) ? extractJpegJumbf(fileBytes) ?? fileBytes : fileBytes

    const coseBytes = findCoseInJumbf(jumbfBytes, 0, jumbfBytes.length)
    if (!coseBytes) return null

    const certChain = decodeCoseX5chain(coseBytes)
    if (!certChain || certChain.length < 2) return null

    const cert = new X509Certificate(certChain[0].buffer as ArrayBuffer)
    const aiaExt = cert.getExtension(AuthorityInfoAccessExtension)
    const ocspUrls = aiaExt?.ocsp ?? []
    const responderUrl = ocspUrls.find(n => typeof n.value === 'string')?.value
    if (typeof responderUrl !== 'string' || !responderUrl.startsWith('http')) return null

    return {
      responderUrl,
      certDerB64: toBase64(certChain[0]),
      issuerDerB64: toBase64(certChain[1]),
    }
  } catch {
    return null
  }
}

// ── JPEG APP11 reassembly ─────────────────────────────────────────────────────

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xD8
}

function extractJpegJumbf(bytes: Uint8Array): Uint8Array | null {
  const segments = new Map<number, Array<{ z: number; data: Uint8Array }>>()
  let pos = 2

  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xFF) break
    const marker = bytes[pos + 1]

    if (marker === 0xD9 || marker === 0xDA) break // EOI / SOS

    // RST markers and standalone markers have no payload
    if (marker >= 0xD0 && marker <= 0xD8) { pos += 2; continue }

    const segLen = (bytes[pos + 2] << 8) | bytes[pos + 3] // includes 2-byte length field itself
    if (segLen < 2 || pos + 2 + segLen > bytes.length) break

    if (marker === 0xEB && // APP11
        bytes[pos + 4] === 0x4A && bytes[pos + 5] === 0x50 && // CI = "JP"
        pos + 10 <= bytes.length) {
      const en = (bytes[pos + 6] << 8) | bytes[pos + 7]
      const z  = (bytes[pos + 8] << 8) | bytes[pos + 9]
      const data = bytes.slice(pos + 10, pos + 2 + segLen)
      if (!segments.has(en)) segments.set(en, [])
      segments.get(en)!.push({ z, data })
    }

    pos += 2 + segLen
  }

  if (segments.size === 0) return null

  const segs = [...segments.values()][0]
  segs.sort((a, b) => a.z - b.z)
  const total = segs.reduce((s, seg) => s + seg.data.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const seg of segs) { out.set(seg.data, off); off += seg.data.length }
  return out
}

// ── JUMBF box walking ─────────────────────────────────────────────────────────

function readU32BE(b: Uint8Array, p: number): number {
  return ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0
}

/** Returns the COSE_Sign1 bytes from the first c2pa.signature bidb box found. */
function findCoseInJumbf(bytes: Uint8Array, start: number, end: number): Uint8Array | null {
  let pos = start
  while (pos + 8 <= end) {
    let size = readU32BE(bytes, pos)
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7])
    let hdrSize = 8

    // Extended 64-bit size (only low 32 bits used for practical file sizes)
    if (size === 1 && pos + 16 <= end) {
      size = readU32BE(bytes, pos + 12)
      hdrSize = 16
    }

    if (size < hdrSize || pos + size > end) break

    if (type === 'jumb') {
      const result = searchJumbBox(bytes, pos + hdrSize, pos + size)
      if (result) return result
    }

    if (size === 0) break
    pos += size
  }
  return null
}

function searchJumbBox(bytes: Uint8Array, start: number, end: number): Uint8Array | null {
  let pos = start
  let label: string | null = null
  let bidbContent: Uint8Array | null = null

  while (pos + 8 <= end) {
    let size = readU32BE(bytes, pos)
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7])
    let hdrSize = 8

    if (size === 1 && pos + 16 <= end) { size = readU32BE(bytes, pos + 12); hdrSize = 16 }
    if (size < hdrSize || pos + size > end) break

    if (type === 'jumd') {
      // UUID (16 bytes) + toggle (1 byte) + null-terminated label
      const labelStart = pos + hdrSize + 16 + 1
      let labelEnd = labelStart
      while (labelEnd < end && bytes[labelEnd] !== 0) labelEnd++
      label = new TextDecoder().decode(bytes.slice(labelStart, labelEnd))
    } else if (type === 'bidb') {
      bidbContent = bytes.slice(pos + hdrSize, pos + size)
    } else if (type === 'jumb') {
      // Recurse into nested manifest container boxes
      const nested = searchJumbBox(bytes, pos + hdrSize, pos + size)
      if (nested) return nested
    }

    if (size === 0) break
    pos += size
  }

  return label === 'c2pa.signature' && bidbContent ? bidbContent : null
}

// ── COSE x5chain extraction ───────────────────────────────────────────────────

function decodeCoseX5chain(coseBytes: Uint8Array): Uint8Array[] | null {
  try {
    // COSE_Sign1 may be wrapped in CBOR tag 18; preserve it so decode doesn't throw.
    const decoded = decode(coseBytes, { tags: Tagged.preserve(18) })
    const array: unknown = decoded instanceof Tagged ? decoded.value : decoded

    if (!Array.isArray(array) || array.length < 2) return null

    const protectedBstr = array[0]
    if (!(protectedBstr instanceof Uint8Array)) return null

    const headerMap = decode(protectedBstr, { useMaps: true })
    let x5chain = (headerMap instanceof Map) ? headerMap.get(COSE_X5CHAIN) : undefined

    // Fall back to unprotected header (some implementations put x5chain there)
    if (x5chain === undefined) {
      const unprotected = array[1]
      if (unprotected instanceof Map) x5chain = unprotected.get(COSE_X5CHAIN)
    }

    if (x5chain instanceof Uint8Array) return [x5chain]
    if (Array.isArray(x5chain) && x5chain.every(v => v instanceof Uint8Array)) {
      return x5chain as Uint8Array[]
    }
    return null
  } catch {
    return null
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 8192
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}
