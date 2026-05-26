/**
 * Netlify Function: OCSP proxy with in-memory cache.
 *
 * Accepts POST { responderUrl, certDerB64, issuerDerB64 }.
 * Builds an OCSP request, forwards it to the given OCSP responder,
 * parses the response, and returns { status, nextUpdate }.
 * Results are cached in-process; the cache resets on cold start.
 */

import { createHash } from 'node:crypto'

// ── Types ─────────────────────────────────────────────────────────────────────

interface HandlerEvent {
  httpMethod: string
  body: string | null
  headers: Record<string, string | undefined>
}

interface HandlerResponse {
  statusCode: number
  headers?: Record<string, string>
  body: string
}

export interface OcspServerResult {
  status: 'good' | 'revoked' | 'unknown' | 'error'
  nextUpdate?: string
  error?: string
}

// ── In-memory cache ───────────────────────────────────────────────────────────

interface CacheEntry extends OcspServerResult {
  cachedAt: number
}

const cache = new Map<string, CacheEntry>()
const TTL_MS = parseInt(process.env.OCSP_CACHE_TTL_SECONDS ?? '3600', 10) * 1000

// ── Handler ───────────────────────────────────────────────────────────────────

export const handler = async (event: HandlerEvent): Promise<HandlerResponse> => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  let certDerB64: string, issuerDerB64: string, responderUrl: string
  try {
    const body = JSON.parse(event.body ?? '{}') as Record<string, unknown>
    certDerB64 = body.certDerB64 as string
    issuerDerB64 = body.issuerDerB64 as string
    responderUrl = body.responderUrl as string
    if (!certDerB64 || !issuerDerB64 || !responderUrl) throw new Error('missing fields')
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ status: 'error', error: 'Invalid request body' }) }
  }

  // Sanitize: only allow http/https OCSP URLs
  if (!/^https?:\/\//i.test(responderUrl)) {
    return { statusCode: 400, body: JSON.stringify({ status: 'error', error: 'Invalid responder URL' }) }
  }

  const certDer = Buffer.from(certDerB64, 'base64')
  const issuerDer = Buffer.from(issuerDerB64, 'base64')

  // Cache key: responder URL + SHA-1 of the cert DER (identifies the specific cert)
  const cacheKey = `${responderUrl}:${createHash('sha1').update(certDer).digest('hex')}`

  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.cachedAt < TTL_MS) {
    const { cachedAt: _, ...result } = cached
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    }
  }

  const result = await queryOcsp(responderUrl, certDer, issuerDer)
  cache.set(cacheKey, { ...result, cachedAt: Date.now() })

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result),
  }
}

// ── OCSP logic ────────────────────────────────────────────────────────────────

async function queryOcsp(
  responderUrl: string,
  certDer: Buffer,
  issuerDer: Buffer,
): Promise<OcspServerResult> {
  try {
    const issuerSubject = extractSubjectName(issuerDer)
    const issuerKeyBits = extractPublicKeyBitString(issuerDer)
    const serial = extractSerialNumber(certDer)

    if (!issuerSubject || !issuerKeyBits || !serial) {
      return { status: 'error', error: 'Could not parse certificate fields' }
    }

    const issuerNameHash = createHash('sha1').update(issuerSubject).digest()
    const issuerKeyHash  = createHash('sha1').update(issuerKeyBits).digest()

    const ocspReq = buildOcspRequest(issuerNameHash, issuerKeyHash, serial)

    const response = await fetch(responderUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/ocsp-request' },
      body: ocspReq,
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      return { status: 'error', error: `OCSP responder returned HTTP ${response.status}` }
    }

    const responseBytes = Buffer.from(await response.arrayBuffer())
    return parseOcspResponse(responseBytes)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { status: 'error', error: msg }
  }
}

// ── DER building ──────────────────────────────────────────────────────────────

// SHA-1 AlgorithmIdentifier: SEQUENCE { OID 1.3.14.3.2.26, NULL }
const SHA1_ALG_ID = Buffer.from([0x30, 0x09, 0x06, 0x05, 0x2B, 0x0E, 0x03, 0x02, 0x1A, 0x05, 0x00])

function derLen(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n])
  if (n < 0x100) return Buffer.from([0x81, n])
  return Buffer.from([0x82, (n >> 8) & 0xFF, n & 0xFF])
}

function derSeq(...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts)
  return Buffer.concat([Buffer.from([0x30]), derLen(body.length), body])
}

function derOctetStr(data: Buffer): Buffer {
  return Buffer.concat([Buffer.from([0x04]), derLen(data.length), data])
}

function derInt(bytes: Buffer): Buffer {
  // Strip leading zero bytes but preserve sign
  let start = 0
  while (start < bytes.length - 1 && bytes[start] === 0) start++
  const trimmed = bytes.subarray(start)
  const needsSign = (trimmed[0] & 0x80) !== 0
  const value = needsSign ? Buffer.concat([Buffer.from([0x00]), trimmed]) : trimmed
  return Buffer.concat([Buffer.from([0x02]), derLen(value.length), value])
}

function buildOcspRequest(
  issuerNameHash: Buffer,
  issuerKeyHash: Buffer,
  serialNumber: Buffer,
): Buffer {
  const certId = derSeq(SHA1_ALG_ID, derOctetStr(issuerNameHash), derOctetStr(issuerKeyHash), derInt(serialNumber))
  return derSeq(derSeq(derSeq(derSeq(certId)))) // OCSPRequest { TBSRequest { requestList { Request { CertID } } } }
}

// ── DER parsing ───────────────────────────────────────────────────────────────

interface DerNode { tag: number; len: number; valStart: number; total: number }

function readDer(b: Buffer, pos: number): DerNode {
  const tag = b[pos]
  let lp = pos + 1
  let len: number
  if (b[lp] < 0x80) {
    len = b[lp++]
  } else {
    const nb = b[lp++] & 0x7F
    len = 0
    for (let i = 0; i < nb; i++) len = (len << 8) | b[lp++]
  }
  return { tag, len, valStart: lp, total: lp - pos + len }
}

function extractSubjectName(certDer: Buffer): Buffer | null {
  try {
    const cert = readDer(certDer, 0)               // Certificate SEQUENCE
    const tbs  = readDer(certDer, cert.valStart)   // TBSCertificate SEQUENCE
    let pos = tbs.valStart

    if (certDer[pos] === 0xA0) pos += readDer(certDer, pos).total  // version [0]
    pos += readDer(certDer, pos).total  // serialNumber
    pos += readDer(certDer, pos).total  // signature AlgorithmIdentifier
    pos += readDer(certDer, pos).total  // issuer Name (skip issuer, keep for subject below)
    pos += readDer(certDer, pos).total  // validity
    const sub = readDer(certDer, pos)   // subject Name
    return certDer.subarray(pos, pos + sub.total)
  } catch { return null }
}

function extractPublicKeyBitString(certDer: Buffer): Buffer | null {
  try {
    const cert = readDer(certDer, 0)
    const tbs  = readDer(certDer, cert.valStart)
    let pos = tbs.valStart

    if (certDer[pos] === 0xA0) pos += readDer(certDer, pos).total
    pos += readDer(certDer, pos).total  // serialNumber
    pos += readDer(certDer, pos).total  // signature
    pos += readDer(certDer, pos).total  // issuer
    pos += readDer(certDer, pos).total  // validity
    pos += readDer(certDer, pos).total  // subject

    // SubjectPublicKeyInfo SEQUENCE
    const spki = readDer(certDer, pos)
    let spkiPos = spki.valStart
    spkiPos += readDer(certDer, spkiPos).total  // AlgorithmIdentifier

    // BIT STRING: first byte is unused-bits count
    const bs = readDer(certDer, spkiPos)
    return certDer.subarray(bs.valStart, bs.valStart + bs.len)
  } catch { return null }
}

function extractSerialNumber(certDer: Buffer): Buffer | null {
  try {
    const cert = readDer(certDer, 0)
    const tbs  = readDer(certDer, cert.valStart)
    let pos = tbs.valStart
    if (certDer[pos] === 0xA0) pos += readDer(certDer, pos).total
    const serial = readDer(certDer, pos)
    return certDer.subarray(serial.valStart, serial.valStart + serial.len)
  } catch { return null }
}

// ── OCSP response parsing ─────────────────────────────────────────────────────

function parseOcspResponse(bytes: Buffer): OcspServerResult {
  try {
    // OCSPResponse SEQUENCE
    const ocspResp = readDer(bytes, 0)
    if (ocspResp.tag !== 0x30) return { status: 'error', error: 'Not a SEQUENCE' }

    let pos = ocspResp.valStart

    // responseStatus ENUMERATED (0 = successful)
    const statusNode = readDer(bytes, pos)
    if (statusNode.tag !== 0x0A || bytes[statusNode.valStart] !== 0) {
      return { status: 'error', error: `OCSP response status: ${bytes[statusNode.valStart]}` }
    }
    pos += statusNode.total

    // responseBytes [0] EXPLICIT OPTIONAL
    if (bytes[pos] !== 0xA0) return { status: 'error', error: 'No responseBytes' }
    const rbCtx = readDer(bytes, pos)
    pos = rbCtx.valStart

    // ResponseBytes SEQUENCE
    const rbSeq = readDer(bytes, pos)
    pos = rbSeq.valStart

    // responseType OID (skip)
    pos += readDer(bytes, pos).total

    // response OCTET STRING → BasicOCSPResponse DER
    const octetStr = readDer(bytes, pos)
    const basic = Buffer.from(bytes.subarray(octetStr.valStart, octetStr.valStart + octetStr.len))

    return parseBasicOcspResponse(basic)
  } catch (e) {
    return { status: 'error', error: e instanceof Error ? e.message : String(e) }
  }
}

function parseBasicOcspResponse(basic: Buffer): OcspServerResult {
  // BasicOCSPResponse SEQUENCE
  const basicSeq = readDer(basic, 0)
  let pos = basicSeq.valStart

  // tbsResponseData ResponseData SEQUENCE
  const tbsSeq = readDer(basic, pos)
  pos = tbsSeq.valStart

  if (basic[pos] === 0xA0) pos += readDer(basic, pos).total  // version
  pos += readDer(basic, pos).total  // responderID
  pos += readDer(basic, pos).total  // producedAt

  // responses SEQUENCE OF SingleResponse
  const responses = readDer(basic, pos)
  pos = responses.valStart

  // First SingleResponse SEQUENCE
  const singleResp = readDer(basic, pos)
  pos = singleResp.valStart

  // certID CertID (skip)
  pos += readDer(basic, pos).total

  // certStatus CHOICE:
  //   good    [0] IMPLICIT NULL  → 0x80 0x00
  //   revoked [1] IMPLICIT ...   → 0xA1 ...
  //   unknown [2] IMPLICIT NULL  → 0x82 0x00
  const certStatusTag = basic[pos]

  let status: OcspServerResult['status']
  if (certStatusTag === 0x80) status = 'good'
  else if (certStatusTag === 0xA1) status = 'revoked'
  else status = 'unknown'

  const certStatusNode = readDer(basic, pos)
  pos += certStatusNode.total

  // thisUpdate GeneralizedTime (skip)
  pos += readDer(basic, pos).total

  // nextUpdate [0] EXPLICIT OPTIONAL
  let nextUpdate: string | undefined
  if (pos < singleResp.valStart + singleResp.len && basic[pos] === 0xA0) {
    const nuCtx = readDer(basic, pos)
    const nuTime = readDer(basic, nuCtx.valStart)
    nextUpdate = basic.subarray(nuTime.valStart, nuTime.valStart + nuTime.len).toString('ascii')
  }

  return { status, nextUpdate }
}
