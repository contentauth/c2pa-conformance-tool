/**
 * Types for the rubric evaluation system.
 *
 * These mirror the schema of the Python reference evaluator at
 * `/Users/andyp/Desktop/Projects/c2pa/conformance/asset-rubrics` so the same
 * YAML rubrics can be evaluated by either runtime.
 *
 * Composition happens at build time in the Python toolchain: composables are
 * flattened into a single pre-built YAML before we see it. At runtime we
 * consume a flat list of statements — there is no reference resolution or
 * cycle detection in this module.
 */

/** A single check within a rubric. Evaluates one JMESPath expression. */
export interface RubricStatement {
  /** Stable identifier, usually "category:snake_case_name". */
  id: string
  /** Short human-readable description of the check. */
  description?: string
  /** JMESPath expression evaluated against the crJSON context. */
  expression: string
  /**
   * When true, a truthy/non-empty match means the check FAILED.
   * (Used for "assert absence" checks like "no malformed failures present".)
   */
  failIfMatched?: boolean
  /**
   * Outcome → locale → text. Common keys: "true", "false", "default".
   * Example:
   *   reportText:
   *     'true':  { en: 'No structural failures found' }
   *     'false': { en: 'Found structural failures: {{matches}}' }
   *
   * The special token `{{matches}}` in the text is replaced with the list of
   * match codes when the expression produced a list of strings.
   */
  reportText?: Record<string, Record<string, string>>
}

/** Metadata block from the first YAML document. */
export interface RubricMetadata {
  name: string
  issuer?: string
  date?: string
  version?: string
  /** Default locale for reportText selection. */
  language?: string
}

/** A full rubric — metadata + flat list of statements. */
export interface Rubric {
  metadata: RubricMetadata
  statements: RubricStatement[]
}

/**
 * How the rubric should be evaluated.
 *
 *   - "document": the entire crJSON bundle is passed to JMESPath. Expressions
 *     typically reference `manifests[0].*`. Each statement produces a single
 *     pass/fail for the whole asset. Used by integrity / conformance rubrics.
 *
 *   - "per-manifest": the evaluator iterates `report.manifests[]` and passes
 *     each manifest to JMESPath as the root. Only *positive* (truthy)
 *     outcomes are emitted, grouped by id prefix. Used by signals rubrics.
 */
export type EvaluationMode = 'document' | 'per-manifest'

/** Entry in public/rubrics/index.json. */
export interface RubricIndexEntry {
  id: string
  filename: string
  name: string
  description: string
  /** Defaults to "document" when omitted, for backwards compatibility. */
  mode?: EvaluationMode
  /**
   * UI grouping label shown as a divider heading in the rubric selector.
   * Entries with the same `category` are rendered under one heading, in
   * the order they appear in the index. Falls back to "Other" when absent.
   */
  category?: string
}

// ── Per-manifest (signals) result types ───────────────────────────────

/** A single truthy signal fired on a manifest. */
export interface SignalHit {
  /** The statement id that fired (e.g. "inception:signal_capturedMedia"). */
  trait: string
  /** Locale-selected reportText for the "true" outcome. */
  reportText: string
  /** True when the matching list had more than one element. */
  multiple: boolean
}

/** Who signed the manifest, from the certificate subject. */
export interface AssertedBy {
  CN: string
  O: string
  OU?: string
}

/** An ingredient edge pointing to a parent manifest in this bundle. */
export interface IngredientEdge {
  /** Index into `SignalsRubricResult.manifests`. */
  index: number
  /** e.g. "parentOf", "inputTo", "componentOf". */
  relationship?: string
}

/** Per-manifest signals output. Mirrors the Python reference shape. */
export interface ManifestSignalsResult {
  assertedBy: AssertedBy
  mimeType: string | null
  localInceptions: SignalHit[]
  localTransformations: SignalHit[]
  /** True iff at least one actions assertion exists and all have allActionsIncluded === true. */
  allActionsIncluded: boolean
  ingredients: IngredientEdge[]
}

/** Aggregate signals rubric result across all manifests. */
export interface SignalsRubricResult {
  rubricId: string
  rubricName: string
  rubricVersion?: string
  mode: 'per-manifest'
  manifests: ManifestSignalsResult[]
  evaluatedAt: Date
}

/** Discriminator for UI rendering. */
export type AnyRubricResult =
  | (RubricResult & { mode: 'document' })
  | SignalsRubricResult

/** Result of evaluating a single statement. */
export interface StatementResult {
  id: string
  /** e.g. "validation" for a statement id of "validation:well_formed_success" */
  category: string
  /** Inherited from the statement for display. */
  description?: string
  /**
   * The coerced boolean outcome. `null` means the expression errored and
   * no outcome could be determined.
   */
  passed: boolean | null
  /** Selected reportText, with `{{matches}}` substituted when applicable. */
  message: string
  /** Raw JMESPath result (for debugging / UI deep-dive). */
  rawValue: unknown
  /** Error message if evaluation threw. */
  error?: string
}

/** Result of evaluating an entire rubric. */
export interface RubricResult {
  rubricId: string
  rubricName: string
  rubricVersion?: string
  /**
   * True iff every statement with a definite boolean outcome passed.
   * Statements that errored (passed === null) do not count as pass.
   */
  overallPassed: boolean
  statements: StatementResult[]
  /** When the evaluation ran. */
  evaluatedAt: Date
}
