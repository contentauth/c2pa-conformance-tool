/**
 * Structural validation for OCSP traffic relayed by the proxy (RFC 6960). This is
 * defense-in-depth on top of the SSRF guard in ssrf-guard.ts: even for a request whose
 * target address passed that check, the proxy should still refuse to relay anything
 * that isn't actually shaped like an OCSP request going out or an OCSP response coming
 * back — closing off using it as a generic "fetch arbitrary bytes from an arbitrary
 * public host and hand me the response" relay.
 *
 * Uses @peculiar/asn1-ocsp's real ASN.1 grammar (the same family as @peculiar/x509,
 * already a dependency here) rather than a hand-rolled byte-level heuristic.
 */
import { AsnParser } from '@peculiar/asn1-schema'
import { OCSPRequest, OCSPResponse } from '@peculiar/asn1-ocsp'

/** True if `body` parses as a well-formed DER-encoded OCSPRequest (RFC 6960 §4.1.1). */
export function isValidOcspRequest(body: Uint8Array): boolean {
  try {
    AsnParser.parse(body, OCSPRequest)
    return true
  } catch {
    return false
  }
}

/** True if `body` parses as a well-formed DER-encoded OCSPResponse (RFC 6960 §4.2.1). */
export function isValidOcspResponse(body: Uint8Array): boolean {
  try {
    AsnParser.parse(body, OCSPResponse)
    return true
  } catch {
    return false
  }
}

/**
 * For a GET request, RFC 6960 Appendix A.1 embeds the base64url-ish-encoded DER request
 * as the last path segment of the responder URL. Extracts and decodes it so callers can
 * validate it the same way as a POST body.
 */
export function extractOcspRequestFromGetPath(url: URL): Uint8Array | null {
  const segments = url.pathname.split('/').filter(Boolean)
  const last = segments[segments.length - 1]
  if (!last) return null
  try {
    // RFC 6960 uses the URL-encoded base64 of the DER request; browsers/clients vary on
    // whether '+' arrives literally or as '%2B', so undo both before decoding.
    const b64 = decodeURIComponent(last).replace(/ /g, '+')
    return new Uint8Array(Buffer.from(b64, 'base64'))
  } catch {
    return null
  }
}
