type ProfileEvaluatorModule = {
  default: () => Promise<unknown>
  /** Returns a JSON string (report); parse with JSON.parse so the UI gets a plain object with .statements etc. */
  evaluate_profile_wasm: (profileYaml: string, indicatorsJson: string) => unknown
}

export type EvaluateProfileResult =
  | { success: true; result: unknown }
  | { success: false; error: string; detail?: string }

const base =
  typeof import.meta.env?.BASE_URL === 'string' ? import.meta.env.BASE_URL : '/'
const profileEvaluatorModuleUrl = `${base}profile-evaluator/profile_evaluator_rs.js`

/** URL the app uses to load the profile-evaluator WASM (for debugging). */
export const PROFILE_EVALUATOR_SCRIPT_URL = profileEvaluatorModuleUrl

const importModule = new Function('modulePath', 'return import(modulePath)') as (
  modulePath: string
) => Promise<ProfileEvaluatorModule>

let evaluatorModulePromise: Promise<ProfileEvaluatorModule | null> | null = null
let evaluatorModuleLoadError: string | null = null

/** Clear cached load state so the next verify or evaluate will try loading the WASM again. */
export function resetProfileEvaluatorLoad(): void {
  evaluatorModulePromise = null
  evaluatorModuleLoadError = null
}

async function loadProfileEvaluatorModule(): Promise<ProfileEvaluatorModule | null> {
  if (evaluatorModuleLoadError) return null
  if (!evaluatorModulePromise) {
    evaluatorModulePromise = (async () => {
      try {
        // Try dynamic import directly; some servers don't send application/javascript for .js
        // or HEAD may fail, so we don't rely on a prior HEAD check.
        const module = await importModule(profileEvaluatorModuleUrl)
        await module.default()
        return module
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        evaluatorModuleLoadError = msg
        evaluatorModulePromise = null
        if (import.meta.env?.DEV) {
          console.warn('[profile-evaluator] load failed:', msg, err)
        }
        return null
      }
    })()
  }
  return evaluatorModulePromise
}

/** Minimal profile + indicators that produce a non-empty report (one statement). */
const WASM_VERIFY_PROFILE = `---
profile_metadata:
  language: en
---
- id: wasm_verify
  title: WASM verification
  expression: "1 + 1"
  report_text:
    en: "2 = {{ expr \\"1+1\\" }}"
`

const WASM_VERIFY_INDICATORS = {}

export type VerifyWasmResult =
  | { ok: true; result: unknown; rawType: string }
  | { ok: false; error: string; detail?: string }

/**
 * Verifies the profile-evaluator WASM loads and runs correctly by evaluating
 * a minimal profile with known-good inputs. Call this to confirm the WASM is working.
 */
export async function verifyWasm(): Promise<VerifyWasmResult> {
  const module = await loadProfileEvaluatorModule()
  if (!module) {
    return {
      ok: false,
      error: 'WASM not loaded',
      detail:
        evaluatorModuleLoadError ??
        'Profile evaluator module not available.',
    }
  }
  try {
    const raw = module.evaluate_profile_wasm(
      WASM_VERIFY_PROFILE,
      JSON.stringify(WASM_VERIFY_INDICATORS)
    )
    // WASM returns a JSON string; parse so we get a plain object with .statements etc.
    let report: unknown = raw
    if (typeof raw === 'string') {
      try {
        report = JSON.parse(raw) as unknown
      } catch (e) {
        return {
          ok: false,
          error: 'WASM returned invalid JSON',
          detail: e instanceof Error ? e.message : String(e),
        }
      }
    }
    const rawType = typeof raw
    const hasKeys =
      report != null &&
      typeof report === 'object' &&
      !Array.isArray(report) &&
      Object.keys(report as object).length > 0
    if (import.meta.env?.DEV) {
      console.log('[profile-evaluator] verifyWasm:', {
        rawType,
        keys: report != null && typeof report === 'object' ? Object.keys(report as object) : [],
      })
    }
    if (!hasKeys) {
      return {
        ok: false,
        error: 'WASM returned empty result',
        detail: `Expected non-empty report from minimal profile. Parsed type: ${typeof report}, keys: ${report != null && typeof report === 'object' ? Object.keys(report as object).join(', ') || 'none' : 'n/a'}.`,
      }
    }
    return { ok: true, result: report, rawType: typeof report }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      error: 'WASM verification failed',
      detail: message,
    }
  }
}

/**
 * Evaluate a YAML profile against crJSON indicators.
 * If the profile-evaluator WASM module is not available, returns a structured
 * result with success: false and an error message instead of throwing.
 */
export async function evaluateProfile(
  profileYaml: string,
  indicators: unknown
): Promise<EvaluateProfileResult> {
  const evaluatorModule = await loadProfileEvaluatorModule()
  if (!evaluatorModule) {
    return {
      success: false,
      error: 'Profile evaluator WASM not available',
      detail:
        evaluatorModuleLoadError ??
        'Run "npm run copy:profile-evaluator" to copy the profile evaluator from a sibling profile-evaluator-rs repo into public/profile-evaluator/.',
    }
  }
  try {
    // WASM returns a JSON string (serde_json::to_string); parse so the UI gets a plain object with .statements etc.
    const raw = evaluatorModule.evaluate_profile_wasm(
      profileYaml,
      JSON.stringify(indicators)
    )
    let result: unknown
    if (typeof raw === 'string') {
      try {
        result = JSON.parse(raw) as unknown
      } catch {
        result = raw
      }
    } else {
      result = raw
    }
    if (import.meta.env?.DEV) {
      console.log('[profile-evaluator] evaluate_profile_wasm:', {
        keys: result != null && typeof result === 'object' && !Array.isArray(result) ? Object.keys(result as object) : [],
      })
    }
    return { success: true, result }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: 'Profile evaluation failed', detail: message }
  }
}
