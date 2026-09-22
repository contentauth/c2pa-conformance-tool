import { describe, it, expect } from 'vitest'
import { AsnSerializer, OctetString } from '@peculiar/asn1-schema'
import {
  OCSPRequest,
  OCSPResponse,
  TBSRequest,
  Request as SingleOcspRequest,
  CertID,
  OCSPResponseStatus,
} from '@peculiar/asn1-ocsp'
import { AlgorithmIdentifier } from '@peculiar/asn1-x509'
import { isValidOcspRequest, isValidOcspResponse, extractOcspRequestFromGetPath } from './ocsp-shape'

function makeValidOcspRequestDer(): Uint8Array {
  const certId = new CertID({
    hashAlgorithm: new AlgorithmIdentifier({ algorithm: '1.3.14.3.2.26' }), // SHA-1
    issuerNameHash: new OctetString(new Uint8Array(20).buffer),
    issuerKeyHash: new OctetString(new Uint8Array(20).buffer),
    serialNumber: new Uint8Array([1]).buffer,
  })
  const req = new OCSPRequest({
    tbsRequest: new TBSRequest({ requestList: [new SingleOcspRequest({ reqCert: certId })] }),
  })
  return new Uint8Array(AsnSerializer.serialize(req))
}

function makeValidOcspResponseDer(): Uint8Array {
  const res = new OCSPResponse({ responseStatus: OCSPResponseStatus.malformedRequest })
  return new Uint8Array(AsnSerializer.serialize(res))
}

describe('isValidOcspRequest', () => {
  it('accepts a well-formed DER-encoded OCSP request', () => {
    expect(isValidOcspRequest(makeValidOcspRequestDer())).toBe(true)
  })

  it('rejects arbitrary garbage bytes', () => {
    expect(isValidOcspRequest(new Uint8Array([1, 2, 3, 4, 5]))).toBe(false)
  })

  it('rejects an empty buffer', () => {
    expect(isValidOcspRequest(new Uint8Array())).toBe(false)
  })

  it('rejects a valid OCSP *response* passed as if it were a request', () => {
    expect(isValidOcspRequest(makeValidOcspResponseDer())).toBe(false)
  })
})

describe('isValidOcspResponse', () => {
  it('accepts a well-formed DER-encoded OCSP response', () => {
    expect(isValidOcspResponse(makeValidOcspResponseDer())).toBe(true)
  })

  it('rejects arbitrary garbage bytes', () => {
    expect(isValidOcspResponse(new Uint8Array([1, 2, 3, 4, 5]))).toBe(false)
  })

  it('rejects HTML (e.g. an error page returned instead of an OCSP response)', () => {
    const html = new TextEncoder().encode('<html><body>404 Not Found</body></html>')
    expect(isValidOcspResponse(html)).toBe(false)
  })

  it('rejects a valid OCSP *request* passed as if it were a response', () => {
    expect(isValidOcspResponse(makeValidOcspRequestDer())).toBe(false)
  })
})

describe('extractOcspRequestFromGetPath', () => {
  it('extracts and decodes a valid base64-encoded OCSP request from the last path segment', () => {
    const der = makeValidOcspRequestDer()
    const b64 = Buffer.from(der).toString('base64')
    const url = new URL(`https://ocsp.example.com/${encodeURIComponent(b64)}`)
    const extracted = extractOcspRequestFromGetPath(url)
    expect(extracted).not.toBeNull()
    expect(isValidOcspRequest(extracted!)).toBe(true)
  })

  it('returns null for a URL with no path segments', () => {
    expect(extractOcspRequestFromGetPath(new URL('https://ocsp.example.com/'))).toBeNull()
  })

  it('does not throw for a non-base64 last segment (caller validates the decoded bytes)', () => {
    expect(() => extractOcspRequestFromGetPath(new URL('https://ocsp.example.com/not-valid-base64!!'))).not.toThrow()
  })
})
