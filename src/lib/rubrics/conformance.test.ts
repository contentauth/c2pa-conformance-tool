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
import type { CrJson } from '../crjson'
import { parseRubricYaml } from './loader'
import { evaluateRubric } from './evaluate'

const RUBRIC_DIR = path.resolve(__dirname, '../../../public/rubrics')

function loadRubric(filename: string) {
  return parseRubricYaml(fs.readFileSync(path.join(RUBRIC_DIR, filename), 'utf8'), filename)
}

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

describe('$expected_spec_version injection', () => {
  // Minimal crJSON with no specVersion in claim_generator_info — matches real
  // Google Photos output that was incorrectly passing this check.
  const crJsonNoSpecVersion: CrJson = {
    manifests: [
      {
        label: 'urn:c2pa:test',
        'claim.v2': {
          claim_generator_info: { name: 'Google C2PA SDK for Android', version: '1.0' },
          signature: 'self#jumbf=/c2pa/urn:c2pa:test/c2pa.signature',
          alg: 'sha256',
          created_assertions: [],
        },
        assertions: {},
        validationResults: { success: [], failure: [], informational: [] },
      } as unknown as CrJson['manifests'][0],
    ],
    activeManifest: 'urn:c2pa:test',
  }

  it('mandatory_spec_version FAILS when specVersion absent and rubric is spec2.4', () => {
    const rubric24 = loadRubric('asset-rubric-conformance0.2-spec2.4.yml')
    expect(rubric24.metadata.variables?.['$expected_spec_version']).toBe('2.4')

    const result = evaluateRubric(rubric24, crJsonNoSpecVersion, { rubricId: 'test' })
    const specCheck = result.statements.find((s) => s.id === 'validation:mandatory_spec_version')
    expect(specCheck?.passed).toBe(false)
  })

  it('mandatory_spec_version PASSES when specVersion absent and rubric is spec2.2', () => {
    const rubric22 = loadRubric('asset-rubric-conformance0.2-spec2.2.yml')
    expect(rubric22.metadata.variables?.['$expected_spec_version']).toBe('2.2')

    const result = evaluateRubric(rubric22, crJsonNoSpecVersion, { rubricId: 'test' })
    const specCheck = result.statements.find((s) => s.id === 'validation:mandatory_spec_version')
    // specVersion is only required for spec >= 2.4; absent in 2.2 is fine.
    expect(specCheck?.passed).toBe(true)
  })

  it('no_dst_for_opened_action is enforced when rubric is spec2.4', () => {
    const rubric24 = loadRubric('asset-rubric-conformance0.2-spec2.4.yml')

    // A c2pa.opened action WITH digitalSourceType is a violation for spec 2.4.
    const crJsonBadOpened: CrJson = {
      manifests: [
        {
          label: 'urn:c2pa:test',
          'claim.v2': {
            claim_generator_info: { name: 'TestApp', version: '1.0', specVersion: '2.4' },
            signature: 'self#jumbf=/c2pa/urn:c2pa:test/c2pa.signature',
            alg: 'sha256',
            created_assertions: [],
          },
          assertions: {
            'c2pa.actions.v2': {
              allActionsIncluded: true,
              actions: [
                {
                  action: 'c2pa.opened',
                  digitalSourceType: 'http://cv.iptc.org/newscodes/digitalsourcetype/humanEdits',
                },
              ],
            },
          },
          validationResults: { success: [], failure: [], informational: [] },
        } as unknown as CrJson['manifests'][0],
      ],
      activeManifest: 'urn:c2pa:test',
    }

    const result = evaluateRubric(rubric24, crJsonBadOpened, { rubricId: 'test' })
    const check = result.statements.find((s) => s.id === 'validation:no_dst_for_opened_action')
    expect(check?.passed).toBe(false)
  })

  it('no_dst_for_opened_action is not enforced when rubric is spec2.2', () => {
    const rubric22 = loadRubric('asset-rubric-conformance0.2-spec2.2.yml')

    // Same violation — should pass for spec 2.2 since the check doesn't apply.
    const crJsonBadOpened: CrJson = {
      manifests: [
        {
          label: 'urn:c2pa:test',
          'claim.v2': {
            claim_generator_info: { name: 'TestApp', version: '1.0' },
            signature: 'self#jumbf=/c2pa/urn:c2pa:test/c2pa.signature',
            alg: 'sha256',
            created_assertions: [],
          },
          assertions: {
            'c2pa.actions.v2': {
              allActionsIncluded: true,
              actions: [
                {
                  action: 'c2pa.opened',
                  digitalSourceType: 'http://cv.iptc.org/newscodes/digitalsourcetype/humanEdits',
                },
              ],
            },
          },
          validationResults: { success: [], failure: [], informational: [] },
        } as unknown as CrJson['manifests'][0],
      ],
      activeManifest: 'urn:c2pa:test',
    }

    const result = evaluateRubric(rubric22, crJsonBadOpened, { rubricId: 'test' })
    const check = result.statements.find((s) => s.id === 'validation:no_dst_for_opened_action')
    expect(check?.passed).toBe(true)
  })
})
