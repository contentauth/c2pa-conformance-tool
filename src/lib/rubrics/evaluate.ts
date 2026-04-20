/**
 * Rubric evaluator — runs one or more statements against a crJSON context.
 *
 * Mirrors the coercion and reportText rules from the Python reference at
 * `c2pa_conformance_rubric_evaluator.py`. Key rules:
 *
 *   - JMESPath result coercion (normal case):
 *       list   → passed = list.length > 0
 *       bool   → passed = val
 *       number → passed = val > 0
 *       null   → passed = false
 *       other  → passed = true
 *
 *   - failIfMatched:
 *       list & non-empty → passed = false, matches = list
 *       otherwise        → passed = true
 *
 *   - reportText[passed ? 'true' : 'false'][locale] is selected; falls back
 *     to reportText['default'][locale]. `{{matches}}` is replaced with the
 *     comma-joined matches if they are strings.
 *
 *   - Any thrown error produces passed = null and an `error` field.
 */

import { search as jmespathSearch, type JSONValue } from '@metrichor/jmespath'
import type { CrJson } from '../crjson'
import { buildEvalContext } from './context'
import type { Rubric, RubricResult, RubricStatement, StatementResult } from './types'

const DEFAULT_LOCALE = 'en'

export function evaluateRubric(
  rubric: Rubric,
  report: CrJson,
  options: { rubricId: string; locale?: string } = { rubricId: 'unknown' },
): RubricResult {
  const context = buildEvalContext(report)
  const locale = options.locale ?? rubric.metadata.language ?? DEFAULT_LOCALE

  const statements = rubric.statements.map((s) => evaluateStatement(s, context, locale))

  const overallPassed = statements.every((s) => s.passed === true)

  return {
    rubricId: options.rubricId,
    rubricName: rubric.metadata.name,
    rubricVersion: rubric.metadata.version,
    overallPassed,
    statements,
    evaluatedAt: new Date(),
  }
}

export function evaluateStatement(
  stmt: RubricStatement,
  context: unknown,
  locale: string = DEFAULT_LOCALE,
): StatementResult {
  const category = stmt.id.includes(':') ? stmt.id.split(':', 1)[0] : 'general'

  let rawValue: unknown = undefined
  let error: string | undefined

  try {
    // JMESPath operates on plain JSON data; our crJSON is JSON-compatible,
    // but its static type is `unknown`, so we cast at the boundary.
    rawValue = jmespathSearch(context as JSONValue, stmt.expression.trim())
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
    return {
      id: stmt.id,
      category,
      description: stmt.description,
      passed: null,
      rawValue: null,
      error,
      message: `Error: ${error}`,
    }
  }

  const { passed, matches } = coerce(rawValue, stmt.failIfMatched === true)
  const message = pickReportText(stmt, passed, locale, matches)

  return {
    id: stmt.id,
    category,
    description: stmt.description,
    passed,
    rawValue,
    message,
  }
}

/**
 * Coerce a raw JMESPath result to a boolean outcome, following the Python
 * reference rules. Also returns `matches` when the raw value is a list that
 * carries match information (used for `{{matches}}` substitution).
 */
function coerce(val: unknown, failIfMatched: boolean): { passed: boolean; matches?: unknown[] } {
  if (failIfMatched) {
    if (Array.isArray(val) && val.length > 0) {
      return { passed: false, matches: val }
    }
    return { passed: true }
  }

  if (Array.isArray(val)) {
    // Non-failIfMatched list: truthy iff non-empty. If entries look like
    // match records (have `label` or `signature`), expose them as matches.
    if (val.length > 0) {
      const first = val[0]
      if (first && typeof first === 'object' && !Array.isArray(first) && ('label' in first || 'signature' in first)) {
        return { passed: true, matches: val }
      }
      return { passed: true }
    }
    return { passed: false }
  }

  if (typeof val === 'boolean') return { passed: val }
  if (typeof val === 'number') return { passed: val > 0 }
  if (val == null) return { passed: false }
  return { passed: true }
}

function pickReportText(
  stmt: RubricStatement,
  passed: boolean,
  locale: string,
  matches: unknown[] | undefined,
): string {
  const dict = stmt.reportText
  if (!dict) return ''

  const key = passed ? 'true' : 'false'
  const chosen = dict[key] ?? dict.default
  if (!chosen) return ''

  // `chosen` may be either a locale-keyed object or a bare string in old rubrics.
  let text: string
  if (typeof chosen === 'string') {
    text = chosen
  } else {
    text = chosen[locale] ?? chosen[DEFAULT_LOCALE] ?? ''
  }

  // Substitute `{{matches}}` if present and matches are strings.
  if (text.includes('{{matches}}')) {
    if (Array.isArray(matches) && matches.every((m) => typeof m === 'string')) {
      text = text.replace('{{matches}}', (matches as string[]).join(', '))
    } else {
      text = text.replace('{{matches}}', '')
    }
  }

  return text
}
