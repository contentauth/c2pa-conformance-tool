/**
 * CAWG identity assertion helpers.
 *
 * c2pa-rs validates `cawg.identity` assertions during an async read and emits
 * their statuses into the same `validationResults` buckets as the manifest's
 * own claim signature, distinguishable only by `url` (see
 * `isAssertionScopedStatus` in crjson.ts). crJSON also decodes the identity
 * assertion's `signature` into either `certificateInfo` (X.509, `cawg.x509.cose`)
 * or `issuer`/`verifiedIdentities` (identity claims aggregation,
 * `cawg.identity_claims_aggregation`). This module pulls both back together per
 * identity assertion so the UI can show who is named and whether that identity
 * credential validated — separately from the C2PA signer's own trust.
 */

import type {
  CrJson,
  CrJsonManifestEntry,
  CrJsonValidationResults,
  CrJsonValidationStatus
} from './crjson'

export const CAWG_SIG_TYPE = {
  X509: 'cawg.x509.cose',
  ICA: 'cawg.identity_claims_aggregation'
} as const

export const CAWG_STATUS = {
  WELL_FORMED: 'cawg.identity.well-formed',
  X509_SIGNATURE_VALIDATED: 'cawg.x509.signature.validated',
  X509_CREDENTIAL_TRUSTED: 'cawg.x509.credential.trusted',
  X509_CREDENTIAL_UNTRUSTED: 'cawg.x509.credential.untrusted',
  ICA_CREDENTIAL_VALID: 'cawg.ica.credential_valid',
  ICA_UNTRUSTED_ISSUER: 'cawg.ica.untrusted_issuer'
} as const

// Codes that mean "the identity credential checked out cryptographically but its
// issuer isn't on a configured trust list". c2pa-rs builds before the CAWG-specific
// codes reused `signingCredential.untrusted` for this, so it is accepted too.
const UNTRUSTED_CODES = new Set<string>([
  CAWG_STATUS.X509_CREDENTIAL_UNTRUSTED,
  CAWG_STATUS.ICA_UNTRUSTED_ISSUER,
  'signingCredential.untrusted'
])

const TRUSTED_CODES = new Set<string>([
  CAWG_STATUS.X509_CREDENTIAL_TRUSTED,
  CAWG_STATUS.ICA_CREDENTIAL_VALID
])

/**
 * - `trusted`: credential validated and chains to a trusted anchor / issuer
 * - `untrusted`: credential is well-formed but its issuer is not trusted here
 * - `invalid`: a non-trust validation failure (bad signature, payload mismatch, …)
 * - `unknown`: no trust verdict was reported for this assertion
 */
export type CawgIdentityState = 'trusted' | 'untrusted' | 'invalid' | 'unknown'

export interface CawgVerifiedIdentity {
  type?: string
  name?: string
  username?: string
  uri?: string
  method?: string
  verifiedAt?: string
  providerId?: string
  providerName?: string
}

export interface CawgCertificate {
  subject?: Record<string, string>
  issuer?: Record<string, string>
  serialNumber?: string
  notBefore?: string
  notAfter?: string
}

export interface CawgIdentity {
  /** Assertion label, e.g. `cawg.identity` or `cawg.identity__1` */
  label: string
  manifestLabel?: string
  sigType?: string
  algorithm?: string
  roles: string[]
  /** Labels of the assertions this identity signs over (e.g. `c2pa.hash.data`) */
  referencedAssertions: string[]
  /** Best human-readable name for the named actor */
  displayName?: string
  certificate?: CawgCertificate
  /** ICA credential issuer (a DID) */
  issuer?: string
  validFrom?: string
  validUntil?: string
  verifiedIdentities: CawgVerifiedIdentity[]
  success: CrJsonValidationStatus[]
  informational: CrJsonValidationStatus[]
  failure: CrJsonValidationStatus[]
  state: CawgIdentityState
}

export function isCawgIdentityLabel(label: string): boolean {
  return label === 'cawg.identity' || label.startsWith('cawg.identity__')
}

export function sigTypeDisplayName(sigType?: string): string {
  if (sigType === CAWG_SIG_TYPE.X509) return 'X.509 certificate'
  if (sigType === CAWG_SIG_TYPE.ICA) return 'Identity claims aggregation'
  return sigType ?? 'Unknown signature type'
}

export const CAWG_STATE_LABEL: Record<CawgIdentityState, string> = {
  trusted: 'Trusted',
  untrusted: 'Untrusted issuer',
  invalid: 'Invalid',
  unknown: 'Not evaluated'
}

/**
 * Assertion label a status is scoped to, or null if it isn't scoped to an
 * assertion. Matches `.../c2pa.assertions/<label>` at the end of the url.
 */
export function assertionLabelFromUrl(url?: string): string | null {
  const match = url?.match(/\/c2pa\.assertions\/([^/]+)$/)
  return match ? match[1] : null
}

/** Manifest label a status url points into (`self#jumbf=/c2pa/<label>/...`), if any */
function manifestLabelFromUrl(url?: string): string | null {
  const match = url?.match(/\/c2pa\/([^/]+)\//)
  return match ? match[1] : null
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined
}

function obj(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
}

function dn(v: unknown): Record<string, string> | undefined {
  const o = obj(v)
  if (!o) return undefined
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(o)) if (typeof val === 'string') out[k] = val
  return out
}

/** `self#jumbf=c2pa.assertions/c2pa.hash.data` → `c2pa.hash.data` */
function referencedLabel(ref: unknown): string | undefined {
  const url = str(obj(ref)?.url) ?? str(ref)
  if (!url) return undefined
  const parts = url.split('/')
  return parts[parts.length - 1] || undefined
}

function parseVerifiedIdentity(v: unknown): CawgVerifiedIdentity | null {
  const o = obj(v)
  if (!o) return null
  const provider = obj(o.provider)
  return {
    type: str(o.type),
    name: str(o.name),
    username: str(o.username),
    uri: str(o.uri),
    method: str(o.method),
    verifiedAt: str(o.verifiedAt),
    providerId: str(provider?.id),
    providerName: str(provider?.name)
  }
}

function identityDisplayName(id: CawgVerifiedIdentity): string | undefined {
  const who = id.name ?? id.username
  if (!who) return id.uri
  return id.providerName ? `${who} (${id.providerName})` : who
}

/** Collect statuses from every place a report carries them, de-duplicated. */
function allStatuses(report: CrJson, manifest: CrJsonManifestEntry) {
  const buckets = { success: [] as CrJsonValidationStatus[], informational: [] as CrJsonValidationStatus[], failure: [] as CrJsonValidationStatus[] }
  const sources: Array<Partial<Record<keyof typeof buckets, CrJsonValidationStatus[]>> | undefined> = [
    manifest.validationResults as CrJsonValidationResults | undefined,
    report.validationResults?.activeManifest,
    report.validationResults
  ]
  for (const key of Object.keys(buckets) as Array<keyof typeof buckets>) {
    const seen = new Set<string>()
    for (const src of sources) {
      for (const s of src?.[key] ?? []) {
        const id = `${s.code}|${s.url ?? ''}`
        if (seen.has(id)) continue
        seen.add(id)
        buckets[key].push(s)
      }
    }
  }
  return buckets
}

function deriveState(
  success: CrJsonValidationStatus[],
  informational: CrJsonValidationStatus[],
  failure: CrJsonValidationStatus[]
): CawgIdentityState {
  if (failure.some((s) => !UNTRUSTED_CODES.has(s.code))) return 'invalid'
  if ([...failure, ...informational].some((s) => UNTRUSTED_CODES.has(s.code))) return 'untrusted'
  if (success.some((s) => TRUSTED_CODES.has(s.code))) return 'trusted'
  return 'unknown'
}

/** All CAWG identity assertions in one manifest, with their scoped statuses. */
export function getCawgIdentities(report: CrJson, manifest: CrJsonManifestEntry): CawgIdentity[] {
  const assertions = (manifest.assertions ?? {}) as Record<string, unknown>
  const labels = Object.keys(assertions).filter(isCawgIdentityLabel)
  if (labels.length === 0) return []

  const statuses = allStatuses(report, manifest)
  const manifestLabel = typeof manifest.label === 'string' ? manifest.label : undefined

  const scoped = (list: CrJsonValidationStatus[], label: string) =>
    list.filter((s) => {
      if (assertionLabelFromUrl(s.url) !== label) return false
      const ml = manifestLabelFromUrl(s.url)
      return !ml || !manifestLabel || ml === manifestLabel
    })

  return labels.map((label) => {
    const a = obj(assertions[label]) ?? {}
    const payload = obj(a.signer_payload) ?? {}
    const sig = obj(a.signature) ?? {}
    const certInfo = obj(sig.certificateInfo)
    const validity = obj(certInfo?.validity)

    const certificate: CawgCertificate | undefined = certInfo
      ? {
          subject: dn(certInfo.subject),
          issuer: dn(certInfo.issuer),
          serialNumber: str(certInfo.serialNumber),
          notBefore: str(validity?.notBefore),
          notAfter: str(validity?.notAfter)
        }
      : undefined

    const verifiedIdentities = (Array.isArray(sig.verifiedIdentities) ? sig.verifiedIdentities : [])
      .map(parseVerifiedIdentity)
      .filter((v): v is CawgVerifiedIdentity => v !== null)

    const roles = (Array.isArray(payload.roles) ? payload.roles : []).filter(
      (r): r is string => typeof r === 'string'
    )
    const referencedAssertions = (Array.isArray(payload.referenced_assertions) ? payload.referenced_assertions : [])
      .map(referencedLabel)
      .filter((l): l is string => !!l)

    const displayName =
      verifiedIdentities.map(identityDisplayName).find(Boolean) ??
      certificate?.subject?.O ??
      certificate?.subject?.CN

    const success = scoped(statuses.success, label)
    const informational = scoped(statuses.informational, label)
    const failure = scoped(statuses.failure, label)

    return {
      label,
      manifestLabel,
      sigType: str(payload.sig_type),
      algorithm: str(sig.algorithm),
      roles,
      referencedAssertions,
      displayName,
      certificate,
      issuer: str(sig.issuer),
      validFrom: str(sig.validFrom),
      validUntil: str(sig.validUntil),
      verifiedIdentities,
      success,
      informational,
      failure,
      state: deriveState(success, informational, failure)
    }
  })
}
