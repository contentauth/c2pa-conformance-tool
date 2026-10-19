/**
 * Per-identity conformance checks for CAWG identity assertions, shown in the
 * Report tab's "Creator identity" panel. Each check is derived only from what
 * c2pa-rs reports in crJSON (see `getCawgIdentities`); where crJSON doesn't carry
 * the evidence a check needs, it is reported as "not assessed" with the reason,
 * never as passed.
 */

import { CAWG_SIG_TYPE, CAWG_STATUS, type CawgIdentity } from './cawg'

export type CawgCheckOutcome = 'passed' | 'failed' | 'not_assessed' | 'not_applicable'

export interface CawgCheck {
  id: string
  title: string
  outcome: CawgCheckOutcome
  /** Status codes or values the outcome is based on */
  evidence: string[]
  detail?: string
  reference: string
}

export const CAWG_CHECK_OUTCOME_LABEL: Record<CawgCheckOutcome, string> = {
  passed: 'Passed',
  failed: 'Failed',
  not_assessed: 'Not assessed',
  not_applicable: 'Not applicable'
}

const RECOGNIZED_SIG_TYPES = new Set<string>([CAWG_SIG_TYPE.X509, CAWG_SIG_TYPE.ICA])

// Codes that mean the credential is fine but its issuer isn't trusted here; they
// don't make the signature or structure invalid.
const TRUST_ONLY_CODES = new Set<string>([
  CAWG_STATUS.X509_CREDENTIAL_UNTRUSTED,
  CAWG_STATUS.ICA_UNTRUSTED_ISSUER,
  'signingCredential.untrusted'
])

// Positive evidence that c2pa-rs verified the identity signature and structure.
const SIGNATURE_VALID_CODES = new Set<string>([
  CAWG_STATUS.WELL_FORMED,
  CAWG_STATUS.X509_SIGNATURE_VALIDATED,
  CAWG_STATUS.ICA_CREDENTIAL_VALID
])

/** `c2pa.hash.data`, `c2pa.hash.bmff.v3`, `c2pa.hash.boxes__1`, … */
function isHardBindingLabel(label: string): boolean {
  return label.startsWith('c2pa.hash.')
}

function codes(identity: CawgIdentity): string[] {
  return [...identity.success, ...identity.informational, ...identity.failure].map((s) => s.code)
}

function sigTypeRecognized(identity: CawgIdentity): CawgCheck {
  const base = {
    id: 'cawg.sig_type_recognized',
    title: 'CAWG identity claims a recognized signature type',
    reference: 'CAWG Identity Assertion 1.3 §signer_payload.sig_type'
  }
  if (!identity.sigType) {
    return { ...base, outcome: 'failed', evidence: [], detail: 'The identity assertion has no sig_type.' }
  }
  if (RECOGNIZED_SIG_TYPES.has(identity.sigType)) {
    return { ...base, outcome: 'passed', evidence: [identity.sigType] }
  }
  return {
    ...base,
    outcome: 'failed',
    evidence: [identity.sigType],
    detail: 'This signature type is not one c2pa-rs can verify (cawg.x509.cose or cawg.identity_claims_aggregation).'
  }
}

function signatureValid(identity: CawgIdentity): CawgCheck {
  const base = {
    id: 'cawg.signature_valid',
    title: 'CAWG identity signature and structure valid (per c2pa-rs)',
    reference:
      identity.sigType === CAWG_SIG_TYPE.ICA
        ? 'CAWG Identity Assertion 1.3 (cawg.identity_claims_aggregation / W3C VC)'
        : 'CAWG Identity Assertion 1.3 (cawg.x509.cose / COSE_Sign1)',
    evidence: codes(identity)
  }
  const failures = identity.failure.filter((s) => !TRUST_ONLY_CODES.has(s.code))
  if (failures.length > 0) {
    return { ...base, outcome: 'failed', detail: failures.map((s) => s.explanation ?? s.code).join('; ') }
  }
  if (identity.success.some((s) => SIGNATURE_VALID_CODES.has(s.code))) {
    return { ...base, outcome: 'passed' }
  }
  return {
    ...base,
    outcome: 'not_assessed',
    detail: 'c2pa-rs reported no failure for this identity, but also no status confirming its signature was verified.'
  }
}

function hardBindingCovered(identity: CawgIdentity): CawgCheck {
  const hardBindings = identity.referencedAssertions.filter(isHardBindingLabel)
  const base = {
    id: 'cawg.hard_binding_covered',
    title: 'CAWG identity assertion covers the hard binding',
    reference: 'CAWG Identity Assertion 1.3 §signer_payload.referenced_assertions',
    evidence: identity.referencedAssertions
  }
  if (identity.failure.some((s) => s.code === 'cawg.identity.hard_binding_missing') || hardBindings.length === 0) {
    return {
      ...base,
      outcome: 'failed',
      detail: 'The identity payload does not reference a hard binding (c2pa.hash.*), so it is not tied to this file\'s content.'
    }
  }
  return {
    ...base,
    outcome: 'passed',
    detail: `The identity payload references the content hash (${hardBindings.join(', ')}).`
  }
}

function identityTrusted(identity: CawgIdentity): CawgCheck {
  const base = {
    id: 'cawg.identity_trusted',
    title: identity.sigType === CAWG_SIG_TYPE.ICA
      ? 'CAWG identity issuer accepted by a configured trust source'
      : 'CAWG identity certificate accepted by a configured trust source',
    reference: 'CAWG Identity Assertion 1.3 §8.2.4 (purpose-scoped trust sources)',
    evidence: codes(identity).filter((c) =>
      TRUST_ONLY_CODES.has(c) ||
      c === CAWG_STATUS.X509_CREDENTIAL_TRUSTED ||
      c === CAWG_STATUS.ICA_CREDENTIAL_VALID
    )
  }
  switch (identity.state) {
    case 'trusted':
      return { ...base, outcome: 'passed' }
    case 'invalid':
      return { ...base, outcome: 'failed', detail: 'The identity credential failed validation, so trust was not established.' }
    case 'untrusted':
      return {
        ...base,
        outcome: 'not_assessed',
        detail: identity.sigType === CAWG_SIG_TYPE.ICA
          ? 'The credential\'s issuer is not on the configured list of trusted identity claims aggregators.'
          : 'The identity certificate could not be verified against the configured identity trust lists.'
      }
    default:
      return { ...base, outcome: 'not_assessed', detail: 'c2pa-rs reported no trust result for this identity.' }
  }
}

function identityPolicy(identity: CawgIdentity): CawgCheck {
  const base = {
    id: 'cawg.identity_policy',
    title: 'CAWG identity certificate policy',
    reference: 'CAWG Identity Assertion 1.3 §8.2.4.1 (interim S/MIME policy)',
    evidence: [] as string[]
  }
  if (identity.sigType !== CAWG_SIG_TYPE.X509) {
    return { ...base, outcome: 'not_applicable', detail: 'Applies only to X.509 identity certificates.' }
  }
  return {
    ...base,
    outcome: 'not_assessed',
    detail:
      'The interim policy requires an organization-, sponsor- or individual-validated S/MIME certificate. ' +
      'The report does not include the certificate\'s policy OIDs or EKUs, so this tool cannot check it.'
  }
}

function liveOcsp(identity: CawgIdentity): CawgCheck {
  const base = {
    id: 'cawg.live_ocsp',
    title: 'CAWG certificate-chain live OCSP',
    reference: 'CAWG Identity Assertion 1.3 §8.2.2.3 / RFC 6960',
    evidence: [] as string[]
  }
  if (identity.sigType !== CAWG_SIG_TYPE.X509) {
    return { ...base, outcome: 'not_applicable', detail: 'Applies only to X.509 identity certificates.' }
  }
  return {
    ...base,
    outcome: 'not_assessed',
    detail: 'This tool does not check revocation for identity certificates yet.'
  }
}

/** The ordered checklist for one CAWG identity assertion. */
export function evaluateCawgChecks(identity: CawgIdentity): CawgCheck[] {
  return [
    sigTypeRecognized(identity),
    signatureValid(identity),
    hardBindingCovered(identity),
    identityTrusted(identity),
    identityPolicy(identity),
    liveOcsp(identity)
  ]
}
