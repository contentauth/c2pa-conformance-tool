/**
 * Tests for the json-formula engine wrapper.
 *
 * Most engine behavior is exercised end-to-end by the goldens (and by
 * `evaluate.test.ts` / `perManifest.test.ts`). This file pins down the
 * pieces that aren't easy to demonstrate via real rubrics — specifically
 * the bare-keyword normalizer and named-expression invocation with $argN.
 */
import { describe, expect, it } from 'vitest'
import { createEngine, normalizeExpression } from './engine'

describe('normalizeExpression', () => {
  it('rewrites bare true / false / null to function calls', () => {
    expect(normalizeExpression('contains(arr, true)')).toBe('contains(arr, true())')
    expect(normalizeExpression('x == false')).toBe('x == false()')
    expect(normalizeExpression('y != null')).toBe('y != null()')
  })

  it('leaves string literals alone', () => {
    expect(normalizeExpression('"true is here"')).toBe('"true is here"')
    expect(normalizeExpression("'true.field'")).toBe("'true.field'")
    expect(normalizeExpression('`true`')).toBe('`true`')
  })

  it("doesn't touch identifiers that contain a keyword", () => {
    expect(normalizeExpression('is_true')).toBe('is_true')
    expect(normalizeExpression('truely == falsehood')).toBe('truely == falsehood')
    expect(normalizeExpression('null_check')).toBe('null_check')
  })

  it('leaves already-called keyword functions alone', () => {
    expect(normalizeExpression('contains(arr, true())')).toBe('contains(arr, true())')
    expect(normalizeExpression('false() && null()')).toBe('false() && null()')
  })

  it('handles whitespace between keyword and parens', () => {
    expect(normalizeExpression('true ()')).toBe('true ()')
    expect(normalizeExpression('true\n()')).toBe('true\n()')
  })

  it('handles the real upstream pattern from no_unsupported_assertions', () => {
    const expr = 'contains(startsWith(@, $allowed), true)'
    expect(normalizeExpression(expr)).toBe('contains(startsWith(@, $allowed), true())')
  })
})

describe('createEngine', () => {
  it('returns null/true/false coerced correctly even when used as bare keywords', () => {
    const engine = createEngine({ name: 'test' })
    expect(engine.search('null', {})).toBe(null)
    expect(engine.search('true', {})).toBe(true)
    expect(engine.search('false', {})).toBe(false)
  })

  it('exposes variables via $name globals', () => {
    const engine = createEngine({
      name: 'test',
      variables: { $codes: ['a', 'b', 'c'] },
    })
    expect(engine.search('contains($codes, "b")', {})).toBe(true)
  })

  it('registers named expressions as zero-arg functions', () => {
    const engine = createEngine({
      name: 'test',
      expressions: { _firstFailure: 'manifests[0].validationResults.failure[0].code' },
    })
    const data = {
      manifests: [{ validationResults: { failure: [{ code: 'boom' }] } }],
    }
    expect(engine.search('_firstFailure()', data)).toBe('boom')
  })

  it('passes positional args to parameterised _expressions via $argN injection', () => {
    const engine = createEngine({
      name: 'test',
      expressions: {
        _hasCode: 'manifests[0].validationResults.failure[?code == $arg0].code',
      },
    })
    const data = {
      manifests: [{ validationResults: { failure: [{ code: 'boom' }, { code: 'bam' }] } }],
    }
    expect(engine.search('_hasCode("boom")', data)).toEqual(['boom'])
    expect(engine.search('_hasCode("nope")', data)).toEqual([])
  })

  it('isolates $argN injection across nested calls (save/restore)', () => {
    // Two named expressions: outer calls inner; both reference $arg0. The
    // engine must restore outer's $arg0 after inner returns.
    const engine = createEngine({
      name: 'test',
      expressions: {
        _inner: '$arg0',
        _outer: '[$arg0, _inner("inner-val"), $arg0]',
      },
    })
    expect(engine.search('_outer("outer-val")', {})).toEqual([
      'outer-val',
      'inner-val',
      'outer-val',
    ])
  })
})
