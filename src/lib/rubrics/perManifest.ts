/**
 * Per-manifest rubric evaluator — used for "signals" rubrics where every
 * statement is a local predicate applied to a single manifest, and only
 * *truthy* outcomes are reported.
 *
 * This is a direct port of the Python reference at
 * `c2pa_signals_rubric_evaluator.py` (in asset-rubrics/). The algorithm:
 *
 *   1. Build a label → index mapping over `report.manifests`.
 *   2. For every manifest, run each statement's JMESPath expression with
 *      that manifest as the root. Only record signals where the result
 *      coerces to true.
 *   3. Build the "mimeType" and ingredient-DAG metadata per manifest, so
 *      the UI can show ingredient edges, assertedBy, and allActionsIncluded.
 *
 * We intentionally do NOT share coerce() with `evaluate.ts` here: the
 * document-mode evaluator exposes pass/fail + matches (including support
 * for `failIfMatched`), while this mode is strictly "truthy emit, falsy drop".
 * Diverging intents → diverging code; keeping them separate prevents surprise
 * coupling when either evaluation mode grows.
 */

import { search as jmespathSearch, type JSONValue } from '@metrichor/jmespath'
import type { CrJson, CrJsonManifestEntry } from '../crjson'
import type {
  AssertedBy,
  IngredientEdge,
  ManifestSignalsResult,
  Rubric,
  RubricStatement,
  SignalHit,
  SignalsRubricResult,
} from './types'

const DEFAULT_LOCALE = 'en'

export function evaluatePerManifest(
  rubric: Rubric,
  report: CrJson,
  options: { rubricId: string; locale?: string } = { rubricId: 'unknown' },
): SignalsRubricResult {
  const locale = options.locale ?? rubric.metadata.language ?? DEFAULT_LOCALE
  const manifests = Array.isArray(report.manifests) ? report.manifests : []

  // label → string index, mirroring the Python reference.
  const indexMapping = buildIndexMapping(manifests)

  // Derive per-manifest mime types, resolving parent fills from child
  // ingredient assertions (same pass as the Python DAG builder).
  const mimeTypes = resolveMimeTypes(manifests, indexMapping)

  const manifestResults: ManifestSignalsResult[] = manifests.map((manifest, idx) => {
    const signals = evaluateManifestSignals(manifest, rubric.statements, locale)

    const localInceptions: SignalHit[] = []
    const localTransformations: SignalHit[] = []
    for (const s of signals) {
      if (s.trait.startsWith('inception:')) localInceptions.push(s)
      else if (s.trait.startsWith('transformation:')) localTransformations.push(s)
    }

    return {
      assertedBy: extractAssertedBy(manifest),
      mimeType: mimeTypes[idx] ?? null,
      localInceptions,
      localTransformations,
      allActionsIncluded: computeAllActionsIncluded(manifest),
      ingredients: extractIngredients(manifest, indexMapping),
    }
  })

  return {
    rubricId: options.rubricId,
    rubricName: rubric.metadata.name,
    rubricVersion: rubric.metadata.version,
    mode: 'per-manifest',
    manifests: manifestResults,
    evaluatedAt: new Date(),
  }
}

// ── Signal evaluation ────────────────────────────────────────────────

function evaluateManifestSignals(
  manifest: CrJsonManifestEntry,
  statements: RubricStatement[],
  locale: string,
): SignalHit[] {
  const hits: SignalHit[] = []
  for (const stmt of statements) {
    if (!stmt.expression || !stmt.id) continue

    let val: unknown
    try {
      val = jmespathSearch(manifest as JSONValue, stmt.expression.trim())
    } catch (e) {
      // Match Python: log and skip; don't let one bad expression kill the run.
      // eslint-disable-next-line no-console
      console.warn(`[rubrics] Error evaluating ${stmt.id}:`, e)
      continue
    }

    const { truthy, multiple } = coerceTruthy(val)
    if (!truthy) continue

    hits.push({
      trait: stmt.id,
      reportText: pickTrueText(stmt, locale) ?? stmt.id,
      multiple,
    })
  }
  return hits
}

/**
 * Truthy-only coercion (mirror of the Python reference for signals mode):
 *   list   → truthy if non-empty; multiple if length > 1
 *   bool   → as-is
 *   number → truthy if > 0
 *   null   → falsy
 *   other  → truthy
 */
function coerceTruthy(val: unknown): { truthy: boolean; multiple: boolean } {
  if (Array.isArray(val)) return { truthy: val.length > 0, multiple: val.length > 1 }
  if (typeof val === 'boolean') return { truthy: val, multiple: false }
  if (typeof val === 'number') return { truthy: val > 0, multiple: false }
  if (val == null) return { truthy: false, multiple: false }
  return { truthy: true, multiple: false }
}

function pickTrueText(stmt: RubricStatement, locale: string): string | undefined {
  const dict = stmt.reportText
  if (!dict) return undefined
  const chosen = dict['true'] ?? dict.default
  if (!chosen) return undefined
  if (typeof chosen === 'string') return chosen
  return chosen[locale] ?? chosen[DEFAULT_LOCALE]
}

// ── Metadata extraction ──────────────────────────────────────────────

function extractAssertedBy(manifest: CrJsonManifestEntry): AssertedBy {
  const sig = (manifest.signature ?? {}) as Record<string, unknown>
  const certInfo = (sig.certificateInfo ?? sig.certificate_info ?? {}) as Record<string, unknown>
  const subject = (certInfo.subject ?? {}) as Record<string, unknown>

  const CN = typeof subject.CN === 'string' ? subject.CN : 'Unknown CN'
  const O = typeof subject.O === 'string' ? subject.O : 'Unknown O'
  const OU = typeof subject.OU === 'string' ? subject.OU : undefined

  const out: AssertedBy = { CN, O }
  if (OU) out.OU = OU
  return out
}

/**
 * Mirror the Python reference: `allActionsIncluded` is true iff at least
 * one actions assertion exists and every such assertion has
 * `allActionsIncluded === true`. If no actions assertions are present,
 * the value is false (not vacuously true).
 */
function computeAllActionsIncluded(manifest: CrJsonManifestEntry): boolean {
  const assertions = (manifest.assertions ?? {}) as Record<string, unknown>
  let actionsFound = false
  let allIncluded = true
  for (const value of Object.values(assertions)) {
    if (!value || typeof value !== 'object') continue
    const obj = value as Record<string, unknown>
    if (!('actions' in obj)) continue
    actionsFound = true
    if (obj.allActionsIncluded !== true) {
      allIncluded = false
      break
    }
  }
  return actionsFound && allIncluded
}

function extractIngredients(
  manifest: CrJsonManifestEntry,
  indexMapping: Map<string, number>,
): IngredientEdge[] {
  const assertions = (manifest.assertions ?? {}) as Record<string, unknown>
  const edges: IngredientEdge[] = []

  for (const [key, rawValue] of Object.entries(assertions)) {
    if (!key.startsWith('c2pa.ingredient')) continue
    if (!rawValue || typeof rawValue !== 'object') continue
    const value = rawValue as Record<string, unknown>

    const activeManifest = (value.activeManifest ?? {}) as Record<string, unknown>
    const url = typeof activeManifest.url === 'string' ? activeManifest.url : undefined
    const relationship = typeof value.relationship === 'string' ? value.relationship : undefined

    if (!url) continue

    const parentUrn = parseParentUrn(url)
    const parentIdx = indexMapping.get(parentUrn)
    if (parentIdx == null) {
      // Parent not present in this bundle — mirror Python's warning-only behavior.
      // eslint-disable-next-line no-console
      console.warn(`[rubrics] Could not map parent URN ${parentUrn} to index`)
      continue
    }
    edges.push({ index: parentIdx, relationship })
  }
  return edges
}

/**
 * Extract the bare `urn:c2pa:…` identifier from an activeManifest URL,
 * stripping any JUMBF path suffix (e.g. `…/c2pa.assertions/…`).
 */
function parseParentUrn(url: string): string {
  const idx = url.indexOf('urn:c2pa:')
  if (idx < 0) return url
  const tail = url.slice(idx)
  const slash = tail.indexOf('/')
  return slash >= 0 ? tail.slice(0, slash) : tail
}

function buildIndexMapping(manifests: CrJsonManifestEntry[]): Map<string, number> {
  const mapping = new Map<string, number>()
  manifests.forEach((m, idx) => {
    if (m && typeof m.label === 'string') {
      mapping.set(m.label, idx)
    }
  })
  return mapping
}

/**
 * Resolve a mime type for each manifest using the Python reference priority:
 *
 *   1. Own `claim.v2["dc:format"]` (or legacy `claim["dc:format"]`).
 *   2. Own `c2pa.thumbnail*` assertion `format` field.
 *   3. Any child manifest's ingredient assertion that names this manifest
 *      as its parent and carries a `dc:format` — but only if the parent
 *      does not already have a mime type set from (1) or (2).
 *
 * Returns one entry per manifest in the input order; `null` when no type
 * could be resolved.
 */
function resolveMimeTypes(
  manifests: CrJsonManifestEntry[],
  indexMapping: Map<string, number>,
): (string | null)[] {
  const out: (string | null)[] = manifests.map(() => null)

  // Pass 1: own claim / thumbnail.
  manifests.forEach((manifest, idx) => {
    const claim = ((manifest['claim.v2'] ?? manifest.claim) ?? {}) as Record<string, unknown>
    const claimFormat = claim['dc:format']
    if (typeof claimFormat === 'string' && claimFormat.length > 0) {
      out[idx] = claimFormat
      return
    }
    const assertions = (manifest.assertions ?? {}) as Record<string, unknown>
    for (const [key, value] of Object.entries(assertions)) {
      if (!key.startsWith('c2pa.thumbnail')) continue
      if (!value || typeof value !== 'object') continue
      const fmt = (value as Record<string, unknown>).format
      if (typeof fmt === 'string' && fmt.length > 0) {
        out[idx] = fmt
        return
      }
    }
  })

  // Pass 2: ingredient back-fills. Only fills a parent that's still null.
  manifests.forEach((manifest) => {
    const assertions = (manifest.assertions ?? {}) as Record<string, unknown>
    for (const [key, rawValue] of Object.entries(assertions)) {
      if (!key.startsWith('c2pa.ingredient')) continue
      if (!rawValue || typeof rawValue !== 'object') continue
      const value = rawValue as Record<string, unknown>
      const activeManifest = (value.activeManifest ?? {}) as Record<string, unknown>
      const url = typeof activeManifest.url === 'string' ? activeManifest.url : undefined
      const fmt = value['dc:format']
      if (!url || typeof fmt !== 'string' || fmt.length === 0) continue

      const parentIdx = indexMapping.get(parseParentUrn(url))
      if (parentIdx == null) continue
      if (out[parentIdx] == null) out[parentIdx] = fmt
    }
  })

  return out
}
