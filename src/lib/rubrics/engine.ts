/**
 * json-formula engine wrapper.
 *
 * Mirrors the Python reference evaluator at
 * `../../c2pa/conformance/asset-rubrics/c2pa_conformance_rubric_evaluator.py::create_json_formula_engine`
 * so the same rubric YAMLs evaluate identically in the browser.
 *
 * Rubrics now carry two extra metadata blocks alongside `rubric_metadata`:
 *
 *   - `variables:` → plain `$name: value` globals, passed as the `globals`
 *     argument on every `search()` call.
 *
 *   - `expressions:` → `_name: "<expr>"` named expressions, registered as
 *     custom functions. They can reference `$argN` positional parameters,
 *     which we inject into the interpreter's `globals` at call time and
 *     restore afterwards so nested calls don't leak state.
 *
 * Keep this file free of evaluator-specific logic (pass/fail, coercion,
 * reportText). Those stay in `evaluate.ts` / `perManifest.ts`.
 */
import JsonFormula, {
  dataTypes,
  type CustomFunctionEntry,
  type Interpreter,
  type JsonFormulaAst,
} from '@adobe/json-formula'
import type { RubricMetadata } from './types'

/** Thin façade exposing just the methods the evaluators call. */
export interface RubricEngine {
  /** Evaluate an expression string against `data`. */
  search(expression: string, data: unknown): unknown
  /** The resolved `$name` globals — pulled from rubric metadata. */
  readonly variables: Record<string, unknown>
}

/** Build an engine configured for one rubric's variables + named expressions. */
export function createEngine(metadata: RubricMetadata): RubricEngine {
  const variables: Record<string, unknown> = { ...(metadata.variables ?? {}) }
  const expressions: Record<string, string> = { ...(metadata.expressions ?? {}) }

  // Determine the widest `$argN` fingerprint across all named expressions so
  // the parser will accept those identifiers when compiling any of them.
  const maxArity = Object.values(expressions).reduce(
    (acc, expr) => Math.max(acc, argCount(expr)),
    0,
  )
  const argNames = Array.from({ length: maxArity }, (_, i) => `$arg${i}`)

  // Pre-compile each named expression once. Parsing happens now; execution
  // happens every time the expression is invoked (possibly many times per
  // statement via nested `_name()` calls).
  const compileHelper = new JsonFormula({}, null, [])
  const allowedGlobals = [
    ...Object.keys(variables),
    ...Object.keys(expressions),
    ...argNames,
  ]

  const compiled = new Map<string, { ast: JsonFormulaAst | null; arity: number; error?: string }>()
  for (const [name, exprStr] of Object.entries(expressions)) {
    const arity = argCount(exprStr)
    try {
      compiled.set(name, { ast: compileHelper.compile(exprStr, allowedGlobals), arity })
    } catch (err) {
      compiled.set(name, {
        ast: null,
        arity,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const customFunctions: Record<string, CustomFunctionEntry> = {}
  for (const [name, entry] of compiled) {
    customFunctions[name] = {
      _signature: makeSignature(entry.arity),
      _func: makeExpressionFn(name, entry),
    }
  }

  const engine = new JsonFormula(customFunctions, null, [])

  return {
    variables,
    search(expression: string, data: unknown): unknown {
      return engine.search(expression, data, variables)
    },
  }
}

/** Count the highest `$argN` index referenced in an expression, +1. Zero if none. */
function argCount(expr: string | undefined): number {
  if (!expr) return 0
  const re = /\$arg(\d+)/g
  let max = -1
  for (const m of expr.matchAll(re)) {
    const n = Number(m[1])
    if (Number.isFinite(n) && n > max) max = n
  }
  return max + 1
}

/** Build an `_signature` list accepting exactly `arity` positional args (any type). */
function makeSignature(arity: number) {
  if (arity === 0) return []
  return Array.from({ length: arity }, () => ({ types: [dataTypes.TYPE_ANY] }))
}

/**
 * Build the `_func` for a named expression. Zero-arity forms just re-evaluate
 * the compiled AST against the caller's data. Parameterised forms inject the
 * caller-provided values as `$arg0`, `$arg1`, ... into the interpreter's
 * `globals`, evaluate, then restore the prior values — matching the Python
 * reference's save/restore dance exactly.
 */
function makeExpressionFn(
  name: string,
  entry: { ast: JsonFormulaAst | null; arity: number; error?: string },
): CustomFunctionEntry['_func'] {
  if (entry.arity === 0) {
    return (_args, data, interpreter) => {
      if (entry.ast == null) {
        throw new Error(`Expression '${name}' failed to compile: ${entry.error ?? 'unknown error'}`)
      }
      return interpreter.search(entry.ast, data)
    }
  }
  return (args, data, interpreter) => {
    if (entry.ast == null) {
      throw new Error(`Expression '${name}' failed to compile: ${entry.error ?? 'unknown error'}`)
    }
    return withInjectedGlobals(
      interpreter,
      Object.fromEntries(args.map((v, i) => [`$arg${i}`, v])),
      () => interpreter.search(entry.ast as JsonFormulaAst, data),
    )
  }
}

/** Run `fn` with extra entries merged into `interpreter.globals`, restoring on exit. */
function withInjectedGlobals<T>(
  interpreter: Interpreter,
  extra: Record<string, unknown>,
  fn: () => T,
): T {
  const prior = new Map<string, { had: boolean; value: unknown }>()
  for (const k of Object.keys(extra)) {
    prior.set(k, {
      had: Object.prototype.hasOwnProperty.call(interpreter.globals, k),
      value: interpreter.globals[k],
    })
    interpreter.globals[k] = extra[k]
  }
  try {
    return fn()
  } finally {
    for (const [k, snap] of prior) {
      if (snap.had) interpreter.globals[k] = snap.value
      else delete interpreter.globals[k]
    }
  }
}
