/**
 * Golden test: verify the TS evaluator produces the same pass/fail outcomes
 * as the Python reference evaluator on a known-good input.
 *
 * Fixtures are copied from `/Users/andyp/Desktop/Projects/c2pa/conformance/asset-rubrics/test/`:
 *   - capture.json — input crJSON for a clean captured-media asset
 *   - capture.conformance.json — expected output from the full conformance rubric
 *
 * The integrity rubric's six statements all appear under "true" in
 * capture.conformance.json, so we assert that our evaluator reports all six
 * as passed.
 */

import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type { CrJson } from '../crjson'
import { parseRubricYaml } from './loader'
import { evaluateRubric } from './evaluate'

const FIXTURE_DIR = path.resolve(__dirname, '__fixtures__')
const RUBRIC_PATH = path.resolve(__dirname, '../../../public/rubrics/asset-rubric-integrity.yml')

function loadFixture<T>(filename: string): T {
  const raw = fs.readFileSync(path.join(FIXTURE_DIR, filename), 'utf8')
  return JSON.parse(raw) as T
}

describe('integrity rubric · golden parity with Python reference', () => {
  const input = loadFixture<CrJson>('capture.json')
  const rubric = parseRubricYaml(fs.readFileSync(RUBRIC_PATH, 'utf8'), 'asset-rubric-integrity.yml')

  it('loads all 6 integrity statements', () => {
    expect(rubric.statements.map((s) => s.id)).toEqual([
      'validation:well_formed_data_present',
      'validation:well_formed_success',
      'validation:valid_data_present',
      'validation:valid_success',
      'validation:trusted_data_present',
      'validation:trusted_success',
    ])
  })

  it('all statements pass on capture.json (clean captured-media asset)', () => {
    const result = evaluateRubric(rubric, input, { rubricId: 'asset-integrity' })

    const failed = result.statements.filter((s) => s.passed !== true)
    // If this fails, print which statements regressed and the raw value so
    // we can see exactly where the TS port diverges from the Python reference.
    if (failed.length > 0) {
      console.error(
        'Regressions:\n' +
          failed
            .map(
              (s) =>
                `  - ${s.id}: passed=${s.passed} raw=${JSON.stringify(s.rawValue)} error=${s.error ?? ''}`,
            )
            .join('\n'),
      )
    }
    expect(failed).toEqual([])
    expect(result.overallPassed).toBe(true)
  })

  it('selects the "true" reportText for passing statements', () => {
    const result = evaluateRubric(rubric, input, { rubricId: 'asset-integrity' })
    const wellFormed = result.statements.find((s) => s.id === 'validation:well_formed_success')
    expect(wellFormed?.message).toBe('No structural failures found')
  })

  it('sets category from the id prefix', () => {
    const result = evaluateRubric(rubric, input, { rubricId: 'asset-integrity' })
    expect(result.statements.every((s) => s.category === 'validation')).toBe(true)
  })
})

describe('coercion rules', () => {
  it('failIfMatched inverts a non-empty list to a failure with matches', () => {
    const rubric = parseRubricYaml(
      [
        'rubric_metadata:',
        '  name: test',
        '  version: 1.0.0',
        '---',
        '- id: test:absence',
        '  failIfMatched: true',
        '  expression: |-',
        "    failures[?contains(['boom'], code)].code",
        '  reportText:',
        "    'true':",
        '      en: No boom',
        "    'false':",
        "      en: 'Boom found: {{matches}}'",
      ].join('\n'),
      'inline',
    )
    const ctx = { failures: [{ code: 'boom' }, { code: 'other' }] } as unknown as CrJson
    const result = evaluateRubric(rubric, ctx, { rubricId: 'test' })
    expect(result.statements[0].passed).toBe(false)
    expect(result.statements[0].message).toBe('Boom found: boom')
  })

  it('failIfMatched on an empty list passes', () => {
    const rubric = parseRubricYaml(
      [
        'rubric_metadata:',
        '  name: test',
        '---',
        '- id: test:absence',
        '  failIfMatched: true',
        '  expression: |-',
        "    failures[?code == 'boom'].code",
        '  reportText:',
        "    'true':",
        '      en: No boom',
        "    'false':",
        "      en: 'Boom: {{matches}}'",
      ].join('\n'),
      'inline',
    )
    const ctx = { failures: [] } as unknown as CrJson
    const result = evaluateRubric(rubric, ctx, { rubricId: 'test' })
    expect(result.statements[0].passed).toBe(true)
    expect(result.statements[0].message).toBe('No boom')
  })

  it('records an error when the expression is invalid', () => {
    const rubric = parseRubricYaml(
      [
        'rubric_metadata:',
        '  name: test',
        '---',
        '- id: test:bad',
        '  expression: |-',
        '    ))) not valid jmespath',
        '  reportText:',
        "    'true': { en: ok }",
        "    'false': { en: bad }",
      ].join('\n'),
      'inline',
    )
    const ctx = {} as CrJson
    const result = evaluateRubric(rubric, ctx, { rubricId: 'test' })
    expect(result.statements[0].passed).toBe(null)
    expect(result.statements[0].error).toBeTruthy()
  })
})
