/**
 * Async helper that loads the signals rubric and evaluates it against a
 * crJSON report. Used by `ManifestSummary.svelte` to power the rubric-driven
 * `generateManifestSummary()`.
 *
 * The signals rubric is loaded **once per session** and cached in-memory:
 * the YAML is small (~7KB) and shared across every manifest summary on
 * the page. The browser will additionally cache the HTTP fetch via the
 * normal cache-control headers Vite sets.
 *
 * Failures are non-fatal — if the rubric can't be loaded for any reason
 * (e.g. offline preview, bad deploy), we resolve to `null` and the
 * caller renders its generic fallback summary.
 */

import type { CrJson } from './crjson'
import { loadRubric } from './rubrics/loader'
import { evaluatePerManifest } from './rubrics/perManifest'
import type { Rubric, SignalsRubricResult } from './rubrics/types'

const SIGNALS_RUBRIC_FILE = 'asset-rubric-signals-local.yml'
const SIGNALS_RUBRIC_ID = 'asset-signals-local'

let rubricPromise: Promise<Rubric | null> | null = null

/** Load (and cache) the signals rubric. Resolves to `null` on any failure. */
function loadSignalsRubric(): Promise<Rubric | null> {
  if (rubricPromise) return rubricPromise
  rubricPromise = loadRubric(SIGNALS_RUBRIC_FILE).catch((err) => {
    // eslint-disable-next-line no-console
    console.warn('[summarySignals] Failed to load signals rubric:', err)
    // Reset so a transient failure doesn't poison the cache for the rest
    // of the session — next call will retry.
    rubricPromise = null
    return null
  })
  return rubricPromise
}

/**
 * Evaluate the signals rubric against the report. Returns the full result
 * (per-manifest signal hits + assertedBy + ingredient edges) or `null` if
 * the rubric couldn't be loaded.
 */
export async function evaluateReportSignals(
  report: CrJson,
): Promise<SignalsRubricResult | null> {
  const rubric = await loadSignalsRubric()
  if (!rubric) return null
  return evaluatePerManifest(rubric, report, { rubricId: SIGNALS_RUBRIC_ID })
}

/** Test seam — wipe the cached rubric so a fresh fetch happens next call. */
export function _resetSignalsCacheForTests(): void {
  rubricPromise = null
}
