/**
 * crJSON (Content Credentials JSON) - native format from C2PA Reader.crjson().
 * This is the canonical format for reports: stored, downloaded, and passed through the app.
 * Legacy (Reader.json()) format is converted to crJSON only when received from the packaged SDK.
 */

import { isOcspNotRevokedCode, isOcspRevokedCode } from './constants'

/** Validation status entry in crJSON (code, optional url, explanation) */
export interface CrJsonValidationStatus {
  code: string
  url?: string
  explanation?: string
}

/** activeManifest block inside validationResults */
export interface CrJsonActiveManifestStatus {
  success?: CrJsonValidationStatus[]
  informational?: CrJsonValidationStatus[]
  failure?: CrJsonValidationStatus[]
}

/** validationResults in crJSON (camelCase). Document-level has activeManifest; per-manifest has status codes directly. */
export interface CrJsonValidationResults {
  activeManifest?: CrJsonActiveManifestStatus
  success?: CrJsonValidationStatus[]
  informational?: CrJsonValidationStatus[]
  failure?: CrJsonValidationStatus[]
  [key: string]: unknown
}

/** Single manifest entry in crJSON manifests array */
export interface CrJsonManifestEntry {
  label: string
  assertions: Record<string, unknown>
  claim?: Record<string, unknown>
  'claim.v2'?: Record<string, unknown>
  signature?: Record<string, unknown>
  status?: Record<string, unknown>
  validationResults?: CrJsonValidationResults
  [key: string]: unknown
}

/** Root crJSON structure from Reader.crjson() */
export interface CrJson {
  '@context'?: Record<string, unknown>
  manifests: CrJsonManifestEntry[]
  validationResults?: CrJsonValidationResults
  jsonGenerator?: Record<string, unknown>
  [key: string]: unknown
}

/** Assertion as list item: { label, data } from crJSON manifest.assertions object */
export interface CrJsonAssertionItem {
  label: string
  data: unknown
}

/** Ingredient derived from crJSON manifest.assertions (c2pa.ingredient entries) */
export interface CrJsonIngredientItem {
  title?: string
  format?: string
  document_id?: unknown
  instance_id?: unknown
  relationship?: string
  active_manifest?: string
  [key: string]: unknown
}

/** Signature info read from crJSON manifest.signature */
export interface CrJsonSignatureInfo {
  alg: string
  common_name: string
  issuer: string
  time: string
}

/** Claim info read from crJSON manifest.claim or manifest['claim.v2'] */
export interface CrJsonClaimInfo {
  claim_generator?: string
  claim_generator_info: Array<{ name?: string; version?: string; [key: string]: unknown }>
  instance_id?: string
}

/** Detect if parsed JSON is crJSON format */
export function isCrJson(obj: unknown): obj is CrJson {
  const o = obj as Record<string, unknown>
  return Array.isArray(o?.manifests) && o.manifests.length > 0
}

/** Read assertions as list from crJSON manifest.assertions (object → array of { label, data }) */
export function getAssertionsList(m: CrJsonManifestEntry): CrJsonAssertionItem[] {
  const assertions = m.assertions ?? {}
  return Object.entries(assertions).map(([label, data]) => ({ label, data }))
}

/** Read ingredients from crJSON manifest.assertions (c2pa.ingredient and entries with document_id/instance_id) */
export function getIngredientsFromManifest(m: CrJsonManifestEntry): CrJsonIngredientItem[] {
  const assertions = m.assertions ?? {}
  const out: CrJsonIngredientItem[] = []
  for (const [assertionLabel, data] of Object.entries(assertions)) {
    const d = data as Record<string, unknown>
    if (assertionLabel === 'c2pa.ingredient' || (d?.document_id != null && d?.instance_id != null)) {
      out.push({
        title: (d.title ?? d.dc_title ?? assertionLabel) as string,
        format: (d.format ?? d.dc_format ?? '') as string,
        document_id: d.document_id,
        instance_id: d.instance_id,
        relationship: (d.relationship ?? d['dc:relationship']) as string | undefined,
        active_manifest: (d.active_manifest ?? d.activeManifest) as string | undefined
      })
    }
  }
  return out
}

/**
 * Convert certificate subject/issuer to display string.
 * c2pa-rs crJSON uses DN component objects { CN, O, OU, L, ST, C }; extract string or format.
 */
function certFieldToString(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value !== 'object' || Array.isArray(value)) return ''
  const obj = value as Record<string, unknown>
  // DN components: prefer CN for common name; for full display join key=value
  const cn = obj.CN ?? obj.cn
  if (cn != null && typeof cn === 'string') return cn
  const parts: string[] = []
  const order = ['CN', 'O', 'OU', 'L', 'ST', 'C']
  for (const key of order) {
    const v = obj[key] ?? obj[key.toLowerCase()]
    if (v != null && typeof v === 'string') parts.push(`${key}=${v}`)
  }
  if (parts.length > 0) return parts.join(', ')
  return ''
}

/** Read signature display info from crJSON manifest.signature */
export function getSignatureInfo(m: CrJsonManifestEntry): CrJsonSignatureInfo | undefined {
  const sig = m.signature as Record<string, unknown> | undefined
  if (!sig || typeof sig !== 'object') return undefined
  // crJSON from c2pa-rs: certificateInfo (camelCase), subject/issuer are DN objects { CN, O, ... }
  const certInfo = (sig.certificateInfo ?? sig.certificate_info ?? {}) as Record<string, unknown>
  const tsInfo = (sig.timeStampInfo ?? sig.time_stamp_info ?? sig.timeStamp ?? {}) as Record<string, unknown>
  const alg = (sig.algorithm ?? sig.alg ?? '') as string
  const common_name =
    certFieldToString(certInfo.subject) ||
    (typeof certInfo.common_name === 'string' ? certInfo.common_name : '') ||
    (typeof certInfo.commonName === 'string' ? certInfo.commonName : '')
  const issuer = certFieldToString(certInfo.issuer) || (typeof certInfo.issuer === 'string' ? certInfo.issuer : '')
  const timeRaw = tsInfo.timestamp ?? sig.time ?? sig.timestamp
  const time = typeof timeRaw === 'string' ? timeRaw : ''
  // Return undefined if no meaningful signature data (avoids empty section)
  if (!alg && !common_name && !issuer && !time) return undefined
  return { alg, common_name, issuer, time }
}

/** Read claim info from crJSON manifest.claim or manifest['claim.v2'] */
export function getClaimInfo(m: CrJsonManifestEntry): CrJsonClaimInfo {
  const claim = (m.claim ?? m['claim.v2']) as Record<string, unknown> | undefined
  const cgi = claim?.claim_generator_info
  const cgiArray = Array.isArray(cgi)
    ? cgi
    : cgi != null
      ? [cgi]
      : claim?.claim_generator != null
        ? [{ name: String(claim.claim_generator) }]
        : []
  return {
    claim_generator: claim?.claim_generator as string | undefined,
    claim_generator_info: cgiArray as CrJsonClaimInfo['claim_generator_info'],
    instance_id: (claim?.instanceID ?? claim?.instance_id) as string | undefined
  }
}

/** Get assertion data by label from crJSON manifest.assertions */
export function getAssertionDataByLabel(m: CrJsonManifestEntry, label: string): unknown {
  const assertions = m.assertions ?? {}
  return assertions[label]
}

/**
 * True if a validation status is scoped to a specific embedded assertion (its `url`
 * points into `c2pa.assertions/...`, e.g. a `cawg.identity` assertion's own X.509
 * credential) rather than to the manifest's own claim signature.
 *
 * c2pa-rs reuses the same status codes (e.g. `signingCredential.untrusted`) for both
 * the manifest's claim signature and any per-assertion credential — the `url` is the
 * only way to tell them apart. Conflating the two makes an untrusted CAWG identity
 * credential look like the file's own C2PA signature is untrusted, which it isn't.
 */
export function isAssertionScopedStatus(status: CrJsonValidationStatus): boolean {
  return status.url?.includes('/c2pa.assertions/') ?? false
}

function excludeAssertionScoped(status: CrJsonActiveManifestStatus): CrJsonActiveManifestStatus {
  return {
    success: status.success?.filter((s) => !isAssertionScopedStatus(s)),
    informational: status.informational?.filter((s) => !isAssertionScopedStatus(s)),
    failure: status.failure?.filter((s) => !isAssertionScopedStatus(s)),
  }
}

function mergeStatusLists(
  ...lists: Array<CrJsonValidationStatus[] | undefined>
): CrJsonValidationStatus[] {
  const combined: CrJsonValidationStatus[] = []
  const seen = new Set<string>()
  for (const list of lists) {
    if (!list) continue
    for (const item of list) {
      if (item && item.code && !seen.has(item.code)) {
        seen.add(item.code)
        combined.push(item)
      }
    }
  }
  return combined
}

/**
 * Get validation status for the active manifest from crJSON —
 * excludes statuses scoped to an embedded assertion (see `isAssertionScopedStatus`),
 * and merges per-manifest status and document-level status, deduplicated by code.
 */
export function getActiveManifestValidationStatus(report: CrJson): CrJsonActiveManifestStatus | undefined {
  const activeLabel = (report.active_manifest ?? report.activeManifest) as string | undefined
  const activeManifest = (activeLabel ? report.manifests?.find(m => m.label === activeLabel) : undefined) ?? report.manifests?.[0]
  const perManifest = activeManifest?.validationResults as CrJsonValidationResults | undefined
  const docLevel = report.validationResults?.activeManifest
  const flatLevel = report.validationResults

  const merged = excludeAssertionScoped({
    success: mergeStatusLists(perManifest?.success, docLevel?.success, flatLevel?.success),
    failure: mergeStatusLists(perManifest?.failure, docLevel?.failure, flatLevel?.failure),
    informational: mergeStatusLists(perManifest?.informational, docLevel?.informational, flatLevel?.informational),
  })

  if ((merged.success?.length ?? 0) + (merged.failure?.length ?? 0) + (merged.informational?.length ?? 0) === 0) {
    return undefined
  }

  return merged
}

/**
 * Get all validation failures relevant to trust for the report — including
 * document-level, active manifest, and all ingredient manifests — excluding
 * failures scoped to an embedded assertion's own credential (see
 * `isAssertionScopedStatus`), which don't indicate the manifest's own signature
 * is untrusted.
 */
export function getAllValidationFailures(report: CrJson): CrJsonValidationStatus[] {
  const failures: CrJsonValidationStatus[] = []

  // 1. Document-level failures
  if (report.validationResults?.failure) {
    failures.push(...report.validationResults.failure)
  }
  if (report.validationResults?.activeManifest?.failure) {
    failures.push(...report.validationResults.activeManifest.failure)
  }

  // 2. Per-manifest failures (active and ingredients)
  if (report.manifests) {
    for (const manifest of report.manifests) {
      const perManifest = manifest.validationResults as CrJsonValidationResults | undefined
      if (perManifest?.failure) {
        failures.push(...perManifest.failure)
      }
    }
  }

  // De-duplicate by code, excluding failures scoped to an embedded assertion's own
  // credential rather than the manifest's own claim signature.
  const uniqueFailures: CrJsonValidationStatus[] = []
  const seenCodes = new Set<string>()
  for (const f of failures) {
    if (isAssertionScopedStatus(f)) continue
    if (!seenCodes.has(f.code)) {
      seenCodes.add(f.code)
      uniqueFailures.push(f)
    }
  }

  return uniqueFailures
}

/**
 * Get all validation successes from the report, including document-level,
 * active manifest, and all ingredient manifests.
 */
export function getAllValidationSuccesses(report: CrJson): CrJsonValidationStatus[] {
  const successes: CrJsonValidationStatus[] = []

  // 1. Document-level successes
  if (report.validationResults?.success) {
    successes.push(...report.validationResults.success)
  }
  if (report.validationResults?.activeManifest?.success) {
    successes.push(...report.validationResults.activeManifest.success)
  }

  // 2. Per-manifest successes (active and ingredients)
  if (report.manifests) {
    for (const manifest of report.manifests) {
      const perManifest = manifest.validationResults as CrJsonValidationResults | undefined
      if (perManifest?.success) {
        successes.push(...perManifest.success)
      }
    }
  }

  // De-duplicate by code
  const uniqueSuccesses: CrJsonValidationStatus[] = []
  const seenCodes = new Set<string>()
  for (const s of successes) {
    if (s?.code && !seenCodes.has(s.code)) {
      seenCodes.add(s.code)
      uniqueSuccesses.push(s)
    }
  }

  return uniqueSuccesses
}

/**
 * Get validation status for a specific manifest from crJSON.
 * Merges per-manifest status and document-level status (if active/first), deduplicated by code.
 */
export function getManifestValidationStatus(
  report: CrJson,
  m: CrJsonManifestEntry,
  isFirst: boolean
): CrJsonActiveManifestStatus | undefined {
  const perManifest = m.validationResults as CrJsonValidationResults | undefined
  const docLevel = isFirst ? report.validationResults?.activeManifest : undefined
  const flatLevel = isFirst ? report.validationResults : undefined

  const success = mergeStatusLists(perManifest?.success, docLevel?.success, flatLevel?.success)
  const failure = mergeStatusLists(perManifest?.failure, docLevel?.failure, flatLevel?.failure)
  const informational = mergeStatusLists(perManifest?.informational, docLevel?.informational, flatLevel?.informational)

  if (success.length + failure.length + informational.length === 0) {
    return undefined
  }

  return { success, failure, informational }
}

/**
 * Get all validation informational statuses from the report, including document-level,
 * active manifest, and all ingredient manifests.
 */
export function getAllValidationInformational(report: CrJson): CrJsonValidationStatus[] {
  const informational: CrJsonValidationStatus[] = []

  if (report.validationResults?.informational) {
    informational.push(...report.validationResults.informational)
  }
  if (report.validationResults?.activeManifest?.informational) {
    informational.push(...report.validationResults.activeManifest.informational)
  }

  if (report.manifests) {
    for (const manifest of report.manifests) {
      const perManifest = manifest.validationResults as CrJsonValidationResults | undefined
      if (perManifest?.informational) {
        informational.push(...perManifest.informational)
      }
    }
  }

  const uniqueInformational: CrJsonValidationStatus[] = []
  const seenCodes = new Set<string>()
  for (const s of informational) {
    if (s?.code && !seenCodes.has(s.code)) {
      seenCodes.add(s.code)
      uniqueInformational.push(s)
    }
  }

  return uniqueInformational
}

/**
 * Checks whether any manifest or document-level validation in the report
 * contains a valid OCSP not-revoked status (in success or informational).
 */
export function isReportOcspVerified(report?: CrJson): boolean {
  if (!report) return false

  const activeStatus = getActiveManifestValidationStatus(report)
  if (activeStatus?.success?.some((s) => isOcspNotRevokedCode(s.code))) return true
  if (activeStatus?.informational?.some((s) => isOcspNotRevokedCode(s.code))) return true

  const allSuccess = getAllValidationSuccesses(report)
  if (allSuccess.some((s) => isOcspNotRevokedCode(s.code))) return true

  const allInfo = getAllValidationInformational(report)
  if (allInfo.some((s) => isOcspNotRevokedCode(s.code))) return true

  if (report.manifests) {
    for (const m of report.manifests) {
      const vr = m.validationResults as CrJsonValidationResults | undefined
      if (vr?.success?.some((s) => isOcspNotRevokedCode(s.code))) return true
      if (vr?.informational?.some((s) => isOcspNotRevokedCode(s.code))) return true

      if (m.assertions) {
        for (const assertion of Object.values(m.assertions)) {
          if (assertion && typeof assertion === 'object') {
            const data = (assertion as { data?: any }).data ?? assertion
            const vrIng = data?.validationResults
            if (vrIng?.activeManifest?.success?.some((s: any) => isOcspNotRevokedCode(s?.code))) return true
            if (vrIng?.activeManifest?.informational?.some((s: any) => isOcspNotRevokedCode(s?.code))) return true
            if (vrIng?.success?.some((s: any) => isOcspNotRevokedCode(s?.code))) return true
            if (vrIng?.informational?.some((s: any) => isOcspNotRevokedCode(s?.code))) return true
          }
        }
      }
    }
  }

  return false
}

/**
 * Checks whether any manifest or document-level validation in the report
 * contains an OCSP revoked status (in failure).
 */
export function isReportOcspRevoked(report?: CrJson): boolean {
  if (!report) return false

  const activeStatus = getActiveManifestValidationStatus(report)
  if (activeStatus?.failure?.some((f) => isOcspRevokedCode(f.code))) return true

  const failures = getAllValidationFailures(report)
  if (failures.some((f) => isOcspRevokedCode(f.code))) return true

  if (report.manifests) {
    for (const m of report.manifests) {
      const vr = m.validationResults as CrJsonValidationResults | undefined
      if (vr?.failure?.some((f) => isOcspRevokedCode(f.code))) return true
    }
  }

  return false
}



/**
 * Convert legacy ManifestStore (from Reader.json() / packaged SDK) to crJSON.
 * Use only when receiving legacy format; native path is already crJSON.
 */
export function legacyToCrJson(legacy: Record<string, unknown>): CrJson {
  const manifestsObj = legacy.manifests as Record<string, Record<string, unknown>> | undefined
  const activeLabel = legacy.active_manifest as string | undefined
  const validationResults = (legacy.validation_results ?? legacy.validationResults) as CrJsonValidationResults | undefined

  const manifests: CrJsonManifestEntry[] = []
  if (manifestsObj && typeof manifestsObj === 'object') {
    const labels = Object.keys(manifestsObj)
    // Put active manifest first (crJSON convention)
    if (activeLabel && manifestsObj[activeLabel]) {
      manifests.push(legacyManifestToCrJsonEntry(activeLabel, manifestsObj[activeLabel]))
    }
    for (const label of labels) {
      if (label !== activeLabel && manifestsObj[label]) {
        manifests.push(legacyManifestToCrJsonEntry(label, manifestsObj[label]))
      }
    }
  }

  const cr: CrJson = {
    '@context': {
      '@vocab': 'https://contentcredentials.org/crjson',
      extras: 'https://contentcredentials.org/crjson/extras'
    },
    manifests
  }
  if (validationResults && typeof validationResults === 'object') {
    cr.validationResults = validationResults
    // Propagate into first manifest so per-manifest readers (and c2pa-rs-style crJSON) see it
    const activeStatus = validationResults.activeManifest ?? validationResults
    if (manifests.length > 0 && activeStatus && typeof activeStatus === 'object') {
      manifests[0].validationResults = {
        success: (activeStatus as CrJsonActiveManifestStatus).success,
        informational: (activeStatus as CrJsonActiveManifestStatus).informational,
        failure: (activeStatus as CrJsonActiveManifestStatus).failure
      }
    }
  }
  return cr
}

function legacyManifestToCrJsonEntry(label: string, m: Record<string, unknown>): CrJsonManifestEntry {
  const assertionsArray = (m.assertions ?? []) as Array<{ label: string; data: unknown }>
  const assertions: Record<string, unknown> = {}
  for (const a of assertionsArray) {
    if (a?.label != null) assertions[a.label] = a.data
  }
  const claim = m.claim_generator_info != null || m.instance_id != null
    ? {
        claim_generator: m.claim_generator,
        claim_generator_info: m.claim_generator_info,
        instanceID: m.instance_id ?? m.instance_id
      }
    : undefined
  const sig = m.signature_info as Record<string, unknown> | undefined
  const signature = sig
    ? {
        algorithm: sig.alg ?? sig.algorithm,
        certificateInfo: {
          subject: sig.common_name ?? sig.subject,
          issuer: sig.issuer
        },
        timeStampInfo: sig.time ? { timestamp: sig.time } : undefined
      }
    : undefined
  return {
    label,
    assertions,
    ...(claim && { claim: claim as Record<string, unknown> }),
    ...(signature && { signature })
  }
}
