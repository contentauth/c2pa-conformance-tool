import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/svelte'
import TreeNode from './TreeNode.svelte'
import { getCawgIdentities } from './cawg'
import type { CrJson } from './crjson'
import type { OverviewNode } from './types'
import icaFixture from '../test/fixtures/cawg/adobe_connected_identities.crjson.json'

function node(overrides: Partial<OverviewNode> = {}): OverviewNode {
  return {
    manifestIdx: 0, signer: 'Signer', ingredientCount: 0,
    inceptions: [], transformations: [], children: [], ...overrides,
  }
}

describe('TreeNode identity card', () => {
  it('shows the CAWG identity named in the manifest with its own trust state', () => {
    const report = icaFixture as unknown as CrJson
    const identities = getCawgIdentities(report, report.manifests![0])
    const { container } = render(TreeNode, { node: node({ identities }), isRoot: true })

    const card = container.querySelector('.cawg-identity')!
    expect(card.getAttribute('data-state')).toBe('untrusted')
    expect(card.textContent).toContain('testuser23 (behance)')
    expect(card.textContent).toContain('Untrusted issuer')
    expect(card.textContent).toContain('Identity claims aggregation · did:web:connected-identities.identity-stage.adobe.com')
    expect(card.querySelector('a')?.getAttribute('href')).toBe('https://net.s2stagehance.com/testuser23')
  })

  it('renders no identity card when the manifest has none', () => {
    const { container } = render(TreeNode, { node: node(), isRoot: true })
    expect(container.querySelector('.cawg-identity')).toBeNull()
  })
})
