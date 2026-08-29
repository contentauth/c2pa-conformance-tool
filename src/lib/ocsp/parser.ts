import { AsnParser, AsnSerializer, OctetString } from '@peculiar/asn1-schema'
import {
  OCSPRequest,
  TBSRequest,
  Request as OcspReqItem,
  CertID,
  OCSPResponse,
  BasicOCSPResponse,
} from '@peculiar/asn1-ocsp'
import { AlgorithmIdentifier, TBSCertificate, SubjectPublicKeyInfo, Certificate } from '@peculiar/asn1-x509'
import { X509Certificate, AuthorityInfoAccessExtension } from '@peculiar/x509'
import type { ParsedCertificateItem, OcspResponseData, OcspCertStatus } from './types'

const OID_SHA256 = '2.16.840.1.101.3.4.2.1'
const OID_SHA1 = '1.3.14.3.2.26'
const OID_AIA = '1.3.6.1.5.5.7.1.1'

/**
 * Split a concatenated PEM string into individual certificate PEM blocks.
 */
export function splitPemCertificates(pemChain: string): string[] {
  if (!pemChain) return []
  const matches = pemChain.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)
  return matches ? matches.map(s => s.trim()) : []
}

/**
 * Extract Authority Information Access (AIA) endpoints (OCSP responder and CA issuers) from an X.509 certificate.
 */
export function extractAiaEndpoints(cert: X509Certificate): {
  ocspResponderUrl: string | null
  caIssuersUrl: string | null
} {
  try {
    const aia = cert.getExtension(OID_AIA) as AuthorityInfoAccessExtension | null
    if (!aia) return { ocspResponderUrl: null, caIssuersUrl: null }

    const ocspResponderUrl = aia.ocsp?.[0]?.value || null
    const caIssuersUrl = aia.caIssuers?.[0]?.value || null
    return { ocspResponderUrl, caIssuersUrl }
  } catch {
    return { ocspResponderUrl: null, caIssuersUrl: null }
  }
}

/**
 * Compute SHA-256 or SHA-1 digest using Web Crypto API.
 */
async function digestBytes(algorithm: 'SHA-256' | 'SHA-1', data: Uint8Array): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle
  if (subtle) {
    const hash = await subtle.digest(algorithm, data)
    return new Uint8Array(hash)
  }
  throw new Error(`Web Crypto API (crypto.subtle) is required for computing ${algorithm} digests.`)
}

/**
 * Convert buffer/typed array to hex string.
 */
export function bufferToHex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Extract common name and org name helper from DN string.
 */
export function parseDnComponents(dn: string): { commonName?: string; org?: string } {
  if (!dn) return {}
  let commonName: string | undefined
  let org: string | undefined

  const cnMatch = dn.match(/CN=([^,]+)/i)
  if (cnMatch) commonName = cnMatch[1].trim()

  const oMatch = dn.match(/O=([^,]+)/i)
  if (oMatch) org = oMatch[1].trim()

  return { commonName, org }
}

/**
 * Parse an X509Certificate into a rich ParsedCertificateItem for UI and validation.
 */
export async function createParsedCertificateItem(params: {
  id: string
  manifestLabel: string
  manifestIndex: number
  manifestRole: 'active' | 'ingredient'
  manifestTitle?: string
  certificateRole: 'claim_signer' | 'timestamp'
  targetCert: X509Certificate
  issuerCert?: X509Certificate
}): Promise<ParsedCertificateItem> {
  const { id, manifestLabel, manifestIndex, manifestRole, manifestTitle, certificateRole, targetCert, issuerCert } = params

  const { ocspResponderUrl, caIssuersUrl } = extractAiaEndpoints(targetCert)
  const targetSubject = parseDnComponents(targetCert.subject)
  const targetIssuer = parseDnComponents(targetCert.issuer)

  let certThumbprint = ''
  try {
    const tp = await targetCert.getThumbprint('SHA-256')
    certThumbprint = bufferToHex(tp)
  } catch {
    certThumbprint = targetCert.serialNumber
  }

  const isExpired = Date.now() > targetCert.notAfter.getTime()

  return {
    id,
    manifestLabel,
    manifestIndex,
    manifestRole,
    manifestTitle,
    certificateRole,
    subject: targetCert.subject,
    subjectCommonName: targetSubject.commonName,
    subjectOrg: targetSubject.org,
    issuer: targetCert.issuer,
    issuerCommonName: targetIssuer.commonName,
    issuerOrg: targetIssuer.org,
    serialNumber: targetCert.serialNumber,
    notBefore: targetCert.notBefore.toISOString(),
    notAfter: targetCert.notAfter.toISOString(),
    isExpired,
    certThumbprint,
    targetCertPem: targetCert.toString('pem'),
    targetCertDer: new Uint8Array(targetCert.rawData),
    issuerCertPem: issuerCert?.toString('pem'),
    issuerCertDer: issuerCert ? new Uint8Array(issuerCert.rawData) : undefined,
    ocspResponderUrl,
    caIssuersUrl,
  }
}

/**
 * Build RFC 6960 OCSPRequest DER bytes from target and issuer certificates.
 */
export async function buildOcspRequestDer(
  targetCert: X509Certificate,
  issuerCert: X509Certificate,
  useSha1 = false
): Promise<Uint8Array> {
  const targetCertObj = AsnParser.parse(targetCert.rawData, Certificate)
  const issuerCertObj = AsnParser.parse(issuerCert.rawData, Certificate)
  const targetTbs = targetCertObj.tbsCertificate
  const issuerTbs = issuerCertObj.tbsCertificate

  const hashAlgorithmOid = useSha1 ? OID_SHA1 : OID_SHA256
  const hashAlgName = useSha1 ? 'SHA-1' : 'SHA-256'

  // 1. issuerNameHash: digest of the DER encoded issuer Subject Name
  const issuerSubjectDer = new Uint8Array(AsnSerializer.serialize(issuerTbs.subject))
  const issuerNameHash = await digestBytes(hashAlgName, issuerSubjectDer)

  // 2. issuerKeyHash: digest of the issuer Public Key BIT STRING (value only, without tag/length)
  const keyBitString = new Uint8Array(issuerTbs.subjectPublicKeyInfo.subjectPublicKey)
  const issuerKeyHash = await digestBytes(hashAlgName, keyBitString)

  // 3. AlgorithmIdentifier
  const hashAlg = new AlgorithmIdentifier({
    algorithm: hashAlgorithmOid,
  })

  // 4. CertID
  const certId = new CertID({
    hashAlgorithm: hashAlg,
    issuerNameHash: new OctetString(issuerNameHash.buffer.slice(issuerNameHash.byteOffset, issuerNameHash.byteOffset + issuerNameHash.byteLength)),
    issuerKeyHash: new OctetString(issuerKeyHash.buffer.slice(issuerKeyHash.byteOffset, issuerKeyHash.byteOffset + issuerKeyHash.byteLength)),
    serialNumber: targetTbs.serialNumber,
  })

  const req = new OcspReqItem({
    reqCert: certId,
  })

  const tbs = new TBSRequest({
    requestList: [req],
  })

  const ocspReq = new OCSPRequest({
    tbsRequest: tbs,
  })

  const derArrayBuf = AsnSerializer.serialize(ocspReq)
  return new Uint8Array(derArrayBuf)
}

function formatRdnName(name: unknown): string {
  if (!name || !Array.isArray(name)) return ''
  const parts: string[] = []
  for (const rdn of name) {
    if (!Array.isArray(rdn)) continue
    for (const atv of rdn) {
      if (atv?.value) {
        if (typeof atv.value === 'string') {
          parts.push(atv.value)
        } else if (typeof atv.value === 'object') {
          const val = (atv.value as Record<string, unknown>).utf8String
            || (atv.value as Record<string, unknown>).printableString
            || (atv.value as Record<string, unknown>).ia5String
            || Object.values(atv.value as Record<string, unknown>)[0]
          if (val) parts.push(String(val))
        }
      }
    }
  }
  return parts.join(', ')
}

/**
 * Parse an RFC 6960 OCSPResponse DER binary payload.
 */
export function parseOcspResponseDer(derBytes: Uint8Array): OcspResponseData {
  try {
    const rawBuffer = derBytes.buffer.slice(derBytes.byteOffset, derBytes.byteOffset + derBytes.byteLength)
    const resp = AsnParser.parse(rawBuffer, OCSPResponse)

    // responseStatus: 0 = successful, 1 = malformedRequest, 2 = internalError, 3 = tryLater, 5 = sigRequired, 6 = unauthorized
    if (resp.responseStatus !== 0) {
      const statusLabels: Record<number, string> = {
        1: 'malformedRequest',
        2: 'internalError',
        3: 'tryLater',
        5: 'sigRequired',
        6: 'unauthorized',
      }
      return {
        status: 'error',
        errorMessage: `OCSP server returned error status: ${statusLabels[resp.responseStatus] || resp.responseStatus}`,
        rawResponseBase64: bufferToBase64(derBytes),
        queriedAt: new Date().toISOString(),
      }
    }

    if (!resp.responseBytes) {
      return {
        status: 'error',
        errorMessage: 'OCSP response did not contain responseBytes',
        rawResponseBase64: bufferToBase64(derBytes),
        queriedAt: new Date().toISOString(),
      }
    }

    const basic = AsnParser.parse(resp.responseBytes.response, BasicOCSPResponse)
    const firstResp = basic.tbsResponseData.responses?.[0]
    if (!firstResp) {
      return {
        status: 'unknown',
        errorMessage: 'BasicOCSPResponse contained no single response entries',
        rawResponseBase64: bufferToBase64(derBytes),
        queriedAt: new Date().toISOString(),
      }
    }

    let status: OcspCertStatus = 'unknown'
    let revokedAt: string | undefined
    let revocationReason: string | undefined

    if (firstResp.certStatus.good !== undefined) {
      status = 'good'
    } else if (firstResp.certStatus.revoked !== undefined) {
      status = 'revoked'
      const revInfo = firstResp.certStatus.revoked
      if (revInfo.revocationTime) {
        revokedAt = revInfo.revocationTime.toISOString()
      }
      if (revInfo.revocationReason !== undefined) {
        const reasonMap: Record<number, string> = {
          0: 'unspecified',
          1: 'keyCompromise',
          2: 'cACompromise',
          3: 'affiliationChanged',
          4: 'superseded',
          5: 'cessationOfOperation',
          6: 'certificateHold',
          8: 'removeFromCRL',
          9: 'privilegeWithdrawn',
          10: 'aACompromise',
        }
        const val = Number(revInfo.revocationReason)
        revocationReason = reasonMap[val] || `Reason ${val}`
      }
    } else if (firstResp.certStatus.unknown !== undefined) {
      status = 'unknown'
    }

    const thisUpdate = firstResp.thisUpdate ? firstResp.thisUpdate.toISOString() : undefined
    const nextUpdate = firstResp.nextUpdate ? firstResp.nextUpdate.toISOString() : undefined
    const producedAt = basic.tbsResponseData.producedAt ? basic.tbsResponseData.producedAt.toISOString() : undefined

    let responderName: string | undefined
    if (basic.tbsResponseData.responderID.byName) {
      responderName = formatRdnName(basic.tbsResponseData.responderID.byName)
    } else if (basic.tbsResponseData.responderID.byKey) {
      responderName = `KeyHash: ${bufferToHex(new Uint8Array(basic.tbsResponseData.responderID.byKey.buffer))}`
    }

    return {
      status,
      revokedAt,
      revocationReason,
      thisUpdate,
      nextUpdate,
      producedAt,
      responderName: responderName || undefined,
      rawResponseBase64: bufferToBase64(derBytes),
      queriedAt: new Date().toISOString(),
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      status: 'error',
      errorMessage: `Failed to parse OCSP response: ${msg}`,
      rawResponseBase64: bufferToBase64(derBytes),
      queriedAt: new Date().toISOString(),
    }
  }
}

/**
 * Convert Uint8Array to base64 string.
 */
export function bufferToBase64(buffer: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(buffer).toString('base64')
  }
  let binary = ''
  const len = buffer.byteLength
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(buffer[i])
  }
  return btoa(binary)
}

/**
 * Generate a copyable curl command for testing OCSP responder from the CLI.
 */
export function generateCurlOcspCommand(responderUrl: string, requestDer: Uint8Array): string {
  const b64 = bufferToBase64(requestDer)
  return `curl -i -X POST "${responderUrl}" \\\n  -H "Content-Type: application/ocsp-request" \\\n  --data-binary "$(echo "${b64}" | base64 -d)"`
}
