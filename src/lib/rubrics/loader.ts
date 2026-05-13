/**
 * Rubric loader — fetches rubric manifests and multi-document YAML files.
 *
 * Rubric YAML shape (matches the Python reference):
 *
 *   rubric_metadata:
 *     name: ...
 *     version: ...
 *     language: en
 *   variables:                 # optional — shared $globals
 *     $well_formed_error_codes: [...]
 *   expressions:                # optional — named reusable expressions
 *     _validationResults: |-
 *       (manifests[0].validationResults || {...})
 *   ---
 *   - id: ...
 *     expression: ...
 *     reportText: { 'true': { en: ... }, 'false': { en: ... } }
 *   - id: ...
 *     ...
 *
 * The first document is the metadata (plus `variables` / `expressions` at the
 * same top level). The second (and any subsequent) document is a list of
 * statements; statements from all later docs are concatenated.
 */

import { parseAllDocuments } from 'yaml'
import type { Rubric, RubricIndexEntry, RubricMetadata, RubricStatement } from './types'

// All rubric assets live under this base URL (honors Vite's BASE_URL for GH Pages).
const RUBRICS_BASE = `${import.meta.env.BASE_URL}rubrics/`

/** Fetch the index of available rubrics. */
export async function loadRubricIndex(): Promise<RubricIndexEntry[]> {
  const url = `${RUBRICS_BASE}index.json`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to load rubric index (${res.status}): ${url}`)
  }
  const json = (await res.json()) as { rubrics?: RubricIndexEntry[] }
  return json.rubrics ?? []
}

/** Fetch and parse a single rubric YAML file. */
export async function loadRubric(filename: string): Promise<Rubric> {
  const url = `${RUBRICS_BASE}${filename}`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to load rubric (${res.status}): ${url}`)
  }
  const yamlText = await res.text()
  return parseRubricYaml(yamlText, filename)
}

/**
 * Parse the multi-document YAML into a Rubric. Exported for use in tests.
 * Accepts a single YAML string (possibly containing multiple `---` docs).
 */
export function parseRubricYaml(yamlText: string, filenameForError = '<inline>'): Rubric {
  const docs = parseAllDocuments(yamlText)

  if (docs.length === 0) {
    throw new Error(`Empty rubric file: ${filenameForError}`)
  }

  // Doc 0 — metadata. Accepts either { rubric_metadata: {...} } or just {...}.
  const firstDoc = docs[0].toJSON()
  const metadata = extractMetadata(firstDoc, filenameForError)

  // Docs 1..N — statements. Each doc is expected to be a list.
  const statements: RubricStatement[] = []
  for (let i = 1; i < docs.length; i++) {
    const raw = docs[i].toJSON()
    if (raw == null) continue // Empty trailing document — skip.
    if (!Array.isArray(raw)) {
      throw new Error(
        `Rubric ${filenameForError} document ${i} is not a list of statements`,
      )
    }
    for (const item of raw) {
      const stmt = normalizeStatement(item, filenameForError)
      if (stmt) statements.push(stmt)
    }
  }

  // Edge case: some rubrics put everything (metadata + statements) in a single
  // document as { rubric_metadata, statements: [...] } — support that too.
  if (statements.length === 0 && firstDoc && typeof firstDoc === 'object' && 'statements' in firstDoc) {
    const inlineList = (firstDoc as { statements?: unknown }).statements
    if (Array.isArray(inlineList)) {
      for (const item of inlineList) {
        const stmt = normalizeStatement(item, filenameForError)
        if (stmt) statements.push(stmt)
      }
    }
  }

  if (statements.length === 0) {
    throw new Error(`Rubric ${filenameForError} contains no statements`)
  }

  return { metadata, statements }
}

function extractMetadata(doc: unknown, filenameForError: string): RubricMetadata {
  if (doc && typeof doc === 'object') {
    const obj = doc as Record<string, unknown>
    // `variables` and `expressions` sit at the top level of doc 0, as
    // siblings of `rubric_metadata`. Pull them out once here so both the
    // wrapped and unwrapped shapes get the same treatment.
    const variables = coerceStringKeyedObject(obj.variables)
    const expressions = coerceStringExpressions(obj.expressions)

    // Preferred: wrapped under `rubric_metadata`.
    const wrapped = obj.rubric_metadata
    if (wrapped && typeof wrapped === 'object') {
      return coerceMetadata(wrapped as Record<string, unknown>, variables, expressions)
    }
    // Fallback: metadata fields directly at the top level of doc 0.
    if ('name' in obj) {
      return coerceMetadata(obj, variables, expressions)
    }
  }
  throw new Error(`Rubric ${filenameForError} is missing rubric_metadata`)
}

function coerceMetadata(
  obj: Record<string, unknown>,
  variables: Record<string, unknown> | undefined,
  expressions: Record<string, string> | undefined,
): RubricMetadata {
  return {
    name: String(obj.name ?? 'Unnamed Rubric'),
    issuer: obj.issuer != null ? String(obj.issuer) : undefined,
    date: obj.date != null ? String(obj.date) : undefined,
    version: obj.version != null ? String(obj.version) : undefined,
    language: obj.language != null ? String(obj.language) : undefined,
    variables,
    expressions,
  }
}

/** Accept any object with string keys. Returns `undefined` for null/arrays/non-objects. */
function coerceStringKeyedObject(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  return raw as Record<string, unknown>
}

/** Expressions must be `{ [name]: string }`; drop non-string values. */
function coerceStringExpressions(raw: unknown): Record<string, string> | undefined {
  const obj = coerceStringKeyedObject(raw)
  if (!obj) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') out[k] = v
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function normalizeStatement(item: unknown, filenameForError: string): RubricStatement | null {
  if (!item || typeof item !== 'object') return null
  const obj = item as Record<string, unknown>
  const id = typeof obj.id === 'string' ? obj.id : null
  const expression = typeof obj.expression === 'string' ? obj.expression : null
  if (!id || !expression) {
    // Malformed entry — skip rather than crash the whole file. Warn in dev.
    console.warn(
      `[rubrics] Skipping malformed statement in ${filenameForError}:`,
      obj,
    )
    return null
  }
  return {
    id,
    description: typeof obj.description === 'string' ? obj.description : undefined,
    expression,
    failIfMatched: obj.failIfMatched === true,
    reportText: (obj.reportText ?? undefined) as RubricStatement['reportText'],
  }
}
