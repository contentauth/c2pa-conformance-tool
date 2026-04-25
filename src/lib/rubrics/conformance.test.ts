/**
 * Sanity checks on the 0.1 / Spec-2.2 conformance rubric as shipped.
 *
 * The *parity* assertions against `capture.conformance.json` (and every other
 * fixture triple) live in `goldens.test.ts`, which runs the same logic across
 * all upstream fixtures. This file keeps only the structural invariants of
 * the rubric YAML itself — so if somebody edits the rubric in a way that
 * drops every statement, or introduces a new category we weren't expecting,
 * we'll notice here.
 */

import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { parseRubricYaml } from './loader'

const RUBRIC_PATH = path.resolve(
  __dirname,
  '../../../public/rubrics/asset-rubric-conformance0.1-spec2.2.yml',
)

describe('conformance rubric · shape invariants (0.1 spec 2.2)', () => {
  const rubric = parseRubricYaml(
    fs.readFileSync(RUBRIC_PATH, 'utf8'),
    'asset-rubric-conformance0.1-spec2.2.yml',
  )

  it('ships a non-empty list of statements', () => {
    expect(rubric.statements.length).toBeGreaterThan(0)
  })

  it('all statements are in the `validation:` category', () => {
    const categories = new Set(
      rubric.statements.map((s) => (s.id.includes(':') ? s.id.split(':', 1)[0] : 'general')),
    )
    expect([...categories]).toEqual(['validation'])
  })

  it('every statement has a json-formula expression and reportText for "true" + "false"', () => {
    for (const s of rubric.statements) {
      expect(s.expression, `${s.id} missing expression`).toBeTruthy()
      expect(s.reportText?.['true'], `${s.id} missing reportText.true`).toBeTruthy()
      expect(s.reportText?.['false'], `${s.id} missing reportText.false`).toBeTruthy()
    }
  })
})
