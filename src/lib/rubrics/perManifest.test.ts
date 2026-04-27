/**
 * Unit-level behavior tests for the per-manifest signals evaluator.
 *
 * The *parity* assertions against `capture.signals.json` (and all other
 * upstream fixtures) live in `goldens.test.ts`, which iterates the full
 * fixture set. This file exercises pieces that aren't easily demonstrated
 * by upstream fixtures — coercion edge cases, ingredient back-fill, and
 * the strict "at least one actions assertion" rule for `allActionsIncluded`.
 */

import { describe, expect, it } from 'vitest'
import type { CrJson } from '../crjson'
import { parseRubricYaml } from './loader'
import { evaluatePerManifest } from './perManifest'

describe('per-manifest evaluator · local unit behavior', () => {
  it('emits only truthy signals and groups by id prefix', () => {
    const rubric = parseRubricYaml(
      [
        'rubric_metadata:',
        '  name: mini',
        '---',
        '- id: inception:always_true',
        '  expression: "`true`"',
        "  reportText: { 'true': { en: yep } }",
        '- id: transformation:always_false',
        '  expression: "`false`"',
        "  reportText: { 'true': { en: nope } }",
        '- id: inception:list_signal',
        '  expression: |-',
        "    assertions.'c2pa.actions'.actions[?action == \"c2pa.created\"].action",
        "  reportText: { 'true': { en: created } }",
      ].join('\n'),
      'inline',
    )

    const report: CrJson = {
      manifests: [
        {
          label: 'urn:c2pa:test-1',
          assertions: {
            'c2pa.actions': {
              actions: [{ action: 'c2pa.created' }, { action: 'c2pa.created' }],
            },
          },
        },
      ],
    } as unknown as CrJson

    const result = evaluatePerManifest(rubric, report, { rubricId: 'mini' })
    expect(result.manifests).toHaveLength(1)
    const m = result.manifests[0]
    expect(m.localInceptions.map((s) => s.trait)).toEqual([
      'inception:always_true',
      'inception:list_signal',
    ])
    // two 'c2pa.created' → list length 2 → multiple = true
    expect(m.localInceptions.find((s) => s.trait === 'inception:list_signal')?.multiple).toBe(true)
    expect(m.localTransformations).toEqual([])
  })

  it('resolves parent mimeType via child ingredient back-fill', () => {
    const rubric = parseRubricYaml(
      ['rubric_metadata:', '  name: empty', '---', '- id: x:never', "  expression: \"`false`\"", "  reportText: { 'true': { en: n } }"].join('\n'),
      'inline',
    )
    const report: CrJson = {
      manifests: [
        {
          label: 'urn:c2pa:parent',
          assertions: {},
        },
        {
          label: 'urn:c2pa:child',
          assertions: {
            'c2pa.ingredient.v3': {
              'dc:format': 'image/jpeg',
              relationship: 'parentOf',
              activeManifest: { url: 'self#jumbf=/c2pa/urn:c2pa:parent/c2pa.assertions/x' },
            },
          },
        },
      ],
    } as unknown as CrJson

    const result = evaluatePerManifest(rubric, report, { rubricId: 'empty' })
    expect(result.manifests[0].mimeType).toBe('image/jpeg')
    expect(result.manifests[1].ingredients).toEqual([{ index: 0, relationship: 'parentOf' }])
  })

  it('allActionsIncluded requires at least one actions assertion', () => {
    const rubric = parseRubricYaml(
      ['rubric_metadata:', '  name: e', '---', '- id: x:n', "  expression: \"`false`\"", "  reportText: { 'true': { en: n } }"].join('\n'),
      'inline',
    )
    const report: CrJson = {
      manifests: [
        { label: 'urn:c2pa:none', assertions: {} },
        {
          label: 'urn:c2pa:yes',
          assertions: { 'c2pa.actions.v2': { actions: [], allActionsIncluded: true } },
        },
        {
          label: 'urn:c2pa:partial',
          assertions: { 'c2pa.actions.v2': { actions: [], allActionsIncluded: false } },
        },
      ],
    } as unknown as CrJson

    const result = evaluatePerManifest(rubric, report, { rubricId: 'e' })
    expect(result.manifests[0].allActionsIncluded).toBe(false) // no actions → false
    expect(result.manifests[1].allActionsIncluded).toBe(true)
    expect(result.manifests[2].allActionsIncluded).toBe(false)
  })
})
