/**
 * Build the JMESPath evaluation context from a crJSON report.
 *
 * The Python reference evaluator expects `validationResults` to live at
 * `manifests[i].validationResults` (so expressions like
 * `manifests[0].validationResults.failure[?...]` work). c2pa-rs sometimes
 * emits it at the document root instead; we normalize by mirroring the
 * root-level validation into `manifests[0]` if it isn't already present.
 *
 * Otherwise the context is pass-through: our crJSON already has
 * `manifest.assertions` as a label-keyed object and `manifest['claim.v2']`
 * as a dotted key, which is exactly what the rubric expressions assume.
 */

import type { CrJson, CrJsonManifestEntry } from '../crjson'

/**
 * Evaluation context — a normalized crJSON ready for JMESPath.
 *
 * Typed loosely as `Record<string, unknown>` because JMESPath doesn't care
 * about our nominal types and the rubric expressions reach into arbitrary
 * fields on assertions / claim / signature.
 */
export type EvalContext = Record<string, unknown>

export function buildEvalContext(report: CrJson): EvalContext {
  // Shallow-clone so we don't mutate the caller's report.
  const ctx: Record<string, unknown> = { ...report }

  const rootValidation = (report as Record<string, unknown>).validationResults

  // If validationResults is at document-root, mirror it into each manifest
  // that lacks its own per-manifest validationResults. The Python reference
  // rubrics reference `manifests[0].validationResults`, so per-manifest is
  // the canonical shape for evaluation.
  if (Array.isArray(report.manifests) && rootValidation != null) {
    ctx.manifests = report.manifests.map((m: CrJsonManifestEntry) => {
      if (m && typeof m === 'object' && m.validationResults == null) {
        return { ...m, validationResults: rootValidation }
      }
      return m
    })
  }

  return ctx
}
