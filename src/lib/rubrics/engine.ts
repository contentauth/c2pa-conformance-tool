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
 *     custom functions. They can reference `$args[N]` (the same convention
 *     as the Python reference) via a `$args` array global injected at call
 *     time and restored afterwards so nested calls don't leak state.
 *
 * Keep this file free of evaluator-specific logic (pass/fail, coercion,
 * reportText). Those stay in `evaluate.ts` / `perManifest.ts`.
 */
import JsonFormula, {
  dataTypes,
  type CustomFunctionEntry,
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

  // Infer arity of each named expression from call sites and body references
  const exprArities = inferArities(expressions)

  // If any expression body references $args, include it in allowed names for compilation
  const usesArgs = Object.values(expressions).some(
    (expr) => /\$args\b/.test(expr),
  )
  const allowedGlobals = [
    ...Object.keys(variables),
    ...Object.keys(expressions),
    ...(usesArgs ? ['$args'] : []),
  ]

  // Pre-compile each named expression once. Parsing happens now; execution
  // happens every time the expression is invoked (possibly many times per
  // statement via nested `_name()` calls).
  const compileHelper = new JsonFormula({}, null, [])

  const compiled = new Map<string, { ast: JsonFormulaAst | null; arity: number; error?: string }>()
  for (const [name, exprStr] of Object.entries(expressions)) {
    const arity = exprArities[name]
    try {
      compiled.set(name, {
        ast: compileHelper.compile(normalizeExpression(exprStr), allowedGlobals),
        arity,
      })
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
      return engine.search(normalizeExpression(expression), data, variables)
    },
  }
}

/**
 * Rewrite bare `true` / `false` / `null` keywords to their zero-arg function
 * form (`true()`, etc.).
 *
 * Why: `@adobe/json-formula` 2.0 registers `true`/`false`/`null` as zero-arg
 * functions but does NOT auto-invoke them when written without parens — bare
 * `true` is parsed as a field access (current value's `true` property),
 * which yields `null` and breaks `contains([...], true)`. The reference
 * Python `json-formula` package tolerates the bare form, so upstream rubrics
 * are written that way (e.g. the `no_unsupported_assertions` rule:
 * `contains(startsWith(@, $allowed), true)`). Normalizing here keeps the
 * pre-built YAMLs unmodified relative to upstream while still evaluating
 * correctly in the browser.
 *
 * The walk is string-aware: it skips over `"..."` (string literals),
 * `'...'` (quoted identifiers), and `` `...` `` (JSON literals) so a
 * keyword inside a string is never rewritten. It also leaves identifiers
 * like `is_true` or `truely` alone (word-boundary check), and skips any
 * keyword already followed by `(`.
 */
export function normalizeExpression(expr: string): string {
  if (typeof expr !== 'string' || expr.length === 0) return expr
  const KEYWORDS = new Set(['true', 'false', 'null'])
  // Characters that count as "word" for the purpose of identifier detection.
  const isWordChar = (ch: string | undefined) =>
    ch != null && /[A-Za-z0-9_$]/.test(ch)

  let out = ''
  let i = 0
  while (i < expr.length) {
    const ch = expr[i]

    // Skip string-like spans untouched: " ' and `.
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch
      out += ch
      i += 1
      while (i < expr.length && expr[i] !== quote) {
        if (expr[i] === '\\' && i + 1 < expr.length) {
          out += expr[i] + expr[i + 1]
          i += 2
        } else {
          out += expr[i]
          i += 1
        }
      }
      if (i < expr.length) {
        out += expr[i] // closing quote
        i += 1
      }
      continue
    }

    // Try to match one of the bare keywords at this position. They must:
    //   - not be preceded by a word char (so we don't touch `is_true`),
    //   - not be followed by a word char (so we don't touch `truely`),
    //   - not be already followed by `(` (so we don't touch `true()`).
    const prev = i > 0 ? expr[i - 1] : undefined
    if (!isWordChar(prev)) {
      let matched: string | undefined
      for (const kw of KEYWORDS) {
        if (
          expr.startsWith(kw, i) &&
          !isWordChar(expr[i + kw.length])
        ) {
          matched = kw
          break
        }
      }
      if (matched) {
        // Look past whitespace for an opening `(` — if present, it's already
        // a function call and we leave it alone.
        let j = i + matched.length
        while (j < expr.length && /\s/.test(expr[j])) j += 1
        if (expr[j] !== '(') {
          out += `${matched}()`
          i += matched.length
          continue
        }
      }
    }

    out += ch
    i += 1
  }
  return out
}

/**
 * Infer the arity of each named expression from call sites and from $args body references.
 *
 * Mirrors the Python implementation's two-pass arity inference.
 */
function inferArities(expressions: Record<string, string>): Record<string, number> {
  const arities: Record<string, number> = {}
  for (const name of Object.keys(expressions)) {
    arities[name] = 0
  }

  // Pass 1: infer from call sites
  for (const funcName of Object.keys(expressions)) {
    const escaped = funcName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')
    const callPattern = new RegExp('\\b' + escaped + '\\s*\\(', 'g')

    for (const exprVal of Object.values(expressions)) {
      const exprStr = exprVal ?? ''
      callPattern.lastIndex = 0
      let match
      while ((match = callPattern.exec(exprStr)) !== null) {
        const startIndex = callPattern.lastIndex
        const rest = exprStr.slice(startIndex)
        let count = 0
        if (!rest.startsWith(')')) {
          let depth = 1
          count = 1
          for (let i = 0; i < rest.length; i++) {
            const c = rest[i]
            if (c === '(') {
              depth += 1
            } else if (c === ')') {
              depth -= 1
              if (depth === 0) break
            } else if (c === ',' && depth === 1) {
              count += 1
            }
          }
        }
        arities[funcName] = Math.max(arities[funcName], count)
      }
    }
  }

  // Pass 2: infer from $args[N] body references
  for (const [name, exprVal] of Object.entries(expressions)) {
    const exprStr = exprVal ?? ''
    const matches = [...exprStr.matchAll(/\$args\[(\d+)\]/g)]
    let maxIdx = -1
    for (const m of matches) {
      const idx = parseInt(m[1], 10)
      if (idx > maxIdx) maxIdx = idx
    }
    if (maxIdx >= 0) {
      arities[name] = Math.max(arities[name], maxIdx + 1)
    } else if (/\$args\b/.test(exprStr)) {
      arities[name] = Math.max(arities[name], 1)
    }
  }

  return arities
}

/** Build an `_signature` list accepting exactly `arity` positional args (any type). */
function makeSignature(arity: number) {
  if (arity === 0) return []
  return Array.from({ length: arity }, () => ({ types: [dataTypes.TYPE_ANY] }))
}

/**
 * Build the `_func` for a named expression. Zero-arity forms just re-evaluate
 * the compiled AST against the caller's data. Parameterised forms inject the
 * caller-provided values as a `$args` array into the interpreter's `globals`,
 * evaluate, then restore the prior value — matching the Python reference's
 * save/restore dance exactly.
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
    const saved = interpreter.globals['$args']
    interpreter.globals['$args'] = [...args]
    try {
      return interpreter.search(entry.ast, data)
    } finally {
      if (saved === undefined) {
        delete interpreter.globals['$args']
      } else {
        interpreter.globals['$args'] = saved
      }
    }
  }
}
