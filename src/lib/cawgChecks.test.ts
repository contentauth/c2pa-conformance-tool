import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/svelte'
import { getCawgIdentities, type CawgIdentity } from './cawg'
import { evaluateCawgChecks } from './cawgChecks'
import CawgIdentityPanel from './CawgIdentityPanel.svelte'
import type { CrJson } from './crjson'
import type { ConformanceReport } from './types'
import x509Fixture from '../test/fixtures/cawg/C_with_CAWG_data.crjson.json'
import icaFixture from '../test/fixtures/cawg/adobe_connected_identities.crjson.json'

const x509Report = x509Fixture as unknown as CrJson
const icaReport = icaFixture as unknown as CrJson

function outcomes(identity: CawgIdentity) {
  return Object.fromEntries(evaluateCawgChecks(identity).map((c) => [c.id, c.outcome]))
}

function identityWith(overrides: Partial<CawgIdentity>): CawgIdentity {
  return {
    label: 'cawg.identity', sigType: 'cawg.x509.cose', roles: [], referencedAssertions: ['c2pa.hash.data'],
    verifiedIdentities: [], success: [], informational: [], failure: [], state: 'unknown', ...overrides
  }
}

describe('evaluateCawgChecks', () => {
  it('evaluates the X.509 identity in C_with_CAWG_data.jpg', () => {
    const [identity] = getCawgIdentities(x509Report, x509Report.manifests![0])
    expect(outcomes(identity)).toEqual({
      'cawg.sig_type_recognized': 'passed',
      'cawg.signature_valid': 'passed',
      'cawg.hard_binding_covered': 'passed',
      'cawg.identity_trusted': 'not_assessed',
      'cawg.identity_policy': 'not_assessed',
      'cawg.live_ocsp': 'not_assessed'
    })
    const checks = evaluateCawgChecks(identity)
    expect(checks[1].evidence).toEqual([
      'assertion.hashedURI.match', 'cawg.x509.signature.validated', 'cawg.identity.well-formed', 'cawg.x509.credential.untrusted'
    ])
    expect(checks[2].detail).toContain('c2pa.hash.data')
  })

  it('evaluates the ICA identity in adobe_connected_identities.jpg', () => {
    const [identity] = getCawgIdentities(icaReport, icaReport.manifests![0])
    expect(outcomes(identity)).toEqual({
      'cawg.sig_type_recognized': 'passed',
      // c2pa-rs withholds cawg.ica.credential_valid for an untrusted issuer, so there
      // is no positive evidence the credential itself verified.
      'cawg.signature_valid': 'not_assessed',
      'cawg.hard_binding_covered': 'passed',
      'cawg.identity_trusted': 'not_assessed',
      'cawg.identity_policy': 'not_applicable',
      'cawg.live_ocsp': 'not_applicable'
    })
  })

  it('passes trust when the credential chains to a trusted anchor', () => {
    const url = 'self#jumbf=/c2pa/m/c2pa.assertions/cawg.identity'
    const identity = identityWith({
      state: 'trusted',
      success: [{ code: 'cawg.identity.well-formed', url }, { code: 'cawg.x509.credential.trusted', url }]
    })
    expect(outcomes(identity)['cawg.identity_trusted']).toBe('passed')
  })

  it('fails the signature check on a non-trust failure, but not on an untrusted credential alone', () => {
    const url = 'self#jumbf=/c2pa/m/c2pa.assertions/cawg.identity'
    const mismatch = identityWith({ state: 'invalid', failure: [{ code: 'cawg.x509.signature.mismatch', url }] })
    expect(outcomes(mismatch)['cawg.signature_valid']).toBe('failed')
    expect(outcomes(mismatch)['cawg.identity_trusted']).toBe('failed')

    const untrusted = identityWith({
      state: 'untrusted',
      success: [{ code: 'cawg.identity.well-formed', url }],
      failure: [{ code: 'cawg.x509.credential.untrusted', url }]
    })
    expect(outcomes(untrusted)['cawg.signature_valid']).toBe('passed')
  })

  it('fails sig type and hard binding checks when they are missing', () => {
    const identity = identityWith({ sigType: 'example.unknown', referencedAssertions: ['cawg.training-mining'] })
    expect(outcomes(identity)['cawg.sig_type_recognized']).toBe('failed')
    expect(outcomes(identity)['cawg.hard_binding_covered']).toBe('failed')
  })

  it('treats any c2pa.hash.* assertion as a hard binding', () => {
    const identity = identityWith({ referencedAssertions: ['c2pa.hash.bmff.v3'] })
    expect(outcomes(identity)['cawg.hard_binding_covered']).toBe('passed')
  })
})

describe('CawgIdentityPanel', () => {
  it('renders one checklist per identity assertion', () => {
    const { container } = render(CawgIdentityPanel, { report: x509Report as ConformanceReport })
    const group = container.querySelector('#creator-identity .cawg-check-group[data-label="cawg.identity"]')!
    expect(group.textContent).toContain('C2PA Test Signing Cert')
    expect(group.querySelectorAll('[data-check]')).toHaveLength(6)
    expect(group.querySelector('[data-check="cawg.signature_valid"]')?.getAttribute('data-outcome')).toBe('passed')
    expect(group.querySelector('[data-check="cawg.identity_trusted"]')?.textContent).toContain('Not assessed')
  })

  it('renders nothing when the report has no CAWG identity', () => {
    const report: ConformanceReport = { manifests: [{ label: 'm', assertions: { 'c2pa.actions': {} } }] }
    const { container } = render(CawgIdentityPanel, { report })
    expect(container.querySelector('#creator-identity')).toBeNull()
  })
})
