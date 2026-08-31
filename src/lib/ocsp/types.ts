/**
 * Type definitions for X.509 Certificate AIA and OCSP Revocation Status.
 */

export type OcspCertStatus =
  | 'pending'
  | 'checking'
  | 'good'
  | 'revoked'
  | 'unknown'
  | 'no_responder'
  | 'error'

export interface ParsedCertificateItem {
  id: string // unique identifier (e.g. `${manifestLabel}-signer`)
  manifestLabel: string
  manifestIndex: number
  manifestRole: 'active' | 'ingredient'
  manifestTitle?: string
  certificateRole: 'claim_signer' | 'timestamp'
  subject: string
  subjectCommonName?: string
  subjectOrg?: string
  issuer: string
  issuerCommonName?: string
  issuerOrg?: string
  serialNumber: string
  notBefore: string
  notAfter: string
  isExpired: boolean
  certThumbprint: string // SHA-256 hex
  targetCertPem: string
  targetCertDer: Uint8Array
  issuerCertPem?: string
  issuerCertDer?: Uint8Array
  ocspResponderUrl: string | null
  caIssuersUrl: string | null
}

export interface OcspResponseData {
  status: OcspCertStatus
  revokedAt?: string
  revocationReason?: string
  thisUpdate?: string
  nextUpdate?: string
  producedAt?: string
  responderName?: string
  rawResponseBase64?: string
  errorMessage?: string
  curlCommand?: string
  queriedAt?: string
}

export interface ManifestCertificateGroup {
  manifestLabel: string
  manifestIndex: number
  manifestRole: 'active' | 'ingredient'
  manifestTitle?: string
  signerCommonName?: string
  signerOrg?: string
  certificates: ParsedCertificateItem[]
}

export interface OcspBatchSummary {
  totalCertificates: number
  withOcspResponder: number
  checkedCount: number
  goodCount: number
  revokedCount: number
  unknownCount: number
  errorCount: number
  isChecking: boolean
}
