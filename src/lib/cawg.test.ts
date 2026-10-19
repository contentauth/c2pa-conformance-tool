import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { getCawgIdentities, isCawgIdentityLabel, assertionLabelFromUrl } from './cawg'
import { getAllValidationFailures, getActiveManifestValidationStatus, type CrJson } from './crjson'
// Real crJSON from the locally-built WASM, regenerated with
//   node scripts/dump-crjson.mjs c2pa-rs/sdk/tests/fixtures/C_with_CAWG_data.jpg
//   node scripts/dump-crjson.mjs c2pa-rs/sdk/src/identity/tests/fixtures/claim_aggregation/adobe_connected_identities.jpg
import x509Fixture from '../test/fixtures/cawg/C_with_CAWG_data.crjson.json'
import icaFixture from '../test/fixtures/cawg/adobe_connected_identities.crjson.json'

const x509Report = x509Fixture as unknown as CrJson
const icaReport = icaFixture as unknown as CrJson

describe('cawg', () => {
  describe('X.509 identity (C_with_CAWG_data.jpg)', () => {
    const [identity, ...rest] = getCawgIdentities(x509Report, x509Report.manifests![0])

    it('finds the single cawg.identity assertion', () => {
      expect(rest).toHaveLength(0)
      expect(identity.label).toBe('cawg.identity')
      expect(identity.sigType).toBe('cawg.x509.cose')
      expect(identity.algorithm).toBe('ed25519')
    })

    it('names the actor from the identity certificate subject', () => {
      expect(identity.displayName).toBe('C2PA Test Signing Cert')
      expect(identity.certificate?.issuer?.CN).toBe('Intermediate CA')
      expect(identity.verifiedIdentities).toEqual([])
    })

    it('lists the referenced assertions by label', () => {
      expect(identity.referencedAssertions).toEqual(['cawg.training-mining', 'c2pa.hash.data'])
    })

    it('collects only the statuses scoped to this identity assertion', () => {
      expect(identity.success.map((s) => s.code)).toEqual([
        'assertion.hashedURI.match',
        'cawg.x509.signature.validated',
        'cawg.identity.well-formed'
      ])
      expect(identity.failure.map((s) => s.code)).toEqual(['cawg.x509.credential.untrusted'])
      expect(identity.informational).toEqual([])
    })

    it('reports the identity as untrusted (no CAWG trust anchors configured)', () => {
      expect(identity.state).toBe('untrusted')
    })

    it("keeps the identity's untrusted credential out of the manifest's own failures", () => {
      const codes = getAllValidationFailures(x509Report).map((f) => f.code)
      expect(codes).toEqual(['signingCredential.untrusted'])
      expect(getActiveManifestValidationStatus(x509Report)?.success?.map((s) => s.code))
        .not.toContain('cawg.identity.well-formed')
    })
  })

  describe('identity claims aggregation (adobe_connected_identities.jpg)', () => {
    const [identity] = getCawgIdentities(icaReport, icaReport.manifests![0])

    it('decodes the issuer and verified identities', () => {
      expect(identity.sigType).toBe('cawg.identity_claims_aggregation')
      expect(identity.issuer).toBe('did:web:connected-identities.identity-stage.adobe.com')
      expect(identity.validFrom).toBe('2025-04-09T22:46:13Z')
      expect(identity.verifiedIdentities).toEqual([
        {
          type: 'cawg.social_media',
          name: undefined,
          username: 'testuser23',
          uri: 'https://net.s2stagehance.com/testuser23',
          method: 'cawg.federated_login',
          verifiedAt: '2025-04-09T22:45:26Z',
          providerId: 'https://behance.net',
          providerName: 'behance'
        }
      ])
      expect(identity.displayName).toBe('testuser23 (behance)')
    })

    it('reports an untrusted issuer from the informational status', () => {
      expect(identity.informational.map((s) => s.code)).toEqual(['cawg.ica.untrusted_issuer'])
      expect(identity.state).toBe('untrusted')
    })
  })

  describe('state', () => {
    const url = 'self#jumbf=/c2pa/urn:c2pa:m/c2pa.assertions/cawg.identity'
    const reportWith = (vr: Record<string, unknown>): CrJson => ({
      manifests: [{
        label: 'urn:c2pa:m',
        assertions: { 'cawg.identity': { signer_payload: { sig_type: 'cawg.x509.cose' }, signature: {} } },
        validationResults: vr
      }]
    })
    const stateOf = (vr: Record<string, unknown>) => {
      const r = reportWith(vr)
      return getCawgIdentities(r, r.manifests![0])[0].state
    }

    it('is trusted when the credential chains to a trusted anchor', () => {
      expect(stateOf({ success: [{ code: 'cawg.x509.credential.trusted', url }] })).toBe('trusted')
      expect(stateOf({ success: [{ code: 'cawg.ica.credential_valid', url }] })).toBe('trusted')
    })

    it('is invalid when any non-trust failure is present', () => {
      expect(stateOf({
        failure: [
          { code: 'cawg.x509.credential.untrusted', url },
          { code: 'cawg.identity.assertion.mismatch', url }
        ]
      })).toBe('invalid')
    })

    it('is unknown when nothing was reported', () => {
      expect(stateOf({})).toBe('unknown')
    })

    it('ignores statuses for the same label in another manifest', () => {
      const other = 'self#jumbf=/c2pa/urn:c2pa:other/c2pa.assertions/cawg.identity'
      expect(stateOf({ failure: [{ code: 'cawg.identity.cbor.invalid', url: other }] })).toBe('unknown')
    })
  })

  it('recognises identity labels and assertion urls', () => {
    expect(isCawgIdentityLabel('cawg.identity')).toBe(true)
    expect(isCawgIdentityLabel('cawg.identity__1')).toBe(true)
    expect(isCawgIdentityLabel('cawg.training-mining')).toBe(false)
    expect(assertionLabelFromUrl('self#jumbf=/c2pa/urn:c2pa:m/c2pa.assertions/cawg.identity__1')).toBe('cawg.identity__1')
    expect(assertionLabelFromUrl('self#jumbf=/c2pa/urn:c2pa:m/c2pa.signature')).toBeNull()
  })

  // End-to-end: run the real locally-built WASM on the real fixture asset, so a c2pa-rs
  // upgrade that changes the CAWG crJSON shape or status codes fails here. Skipped
  // when the WASM hasn't been built (`npm run build:local-wasm`) or the submodule
  // isn't checked out.
  const wasmDir = `${process.cwd()}/public/local-c2pa`
  const asset = `${process.cwd()}/c2pa-rs/sdk/tests/fixtures/C_with_CAWG_data.jpg`
  const canRunWasm = existsSync(`${wasmDir}/c2pa_local_bg.wasm`) && existsSync(asset)

  it.skipIf(!canRunWasm)('extracts the identity from C_with_CAWG_data.jpg via the real WASM', async () => {
    const mod = await import(/* @vite-ignore */ `${wasmDir}/c2pa_local.js`)
    mod.initSync({ module: readFileSync(`${wasmDir}/c2pa_local_bg.wasm`) })
    const settings = JSON.stringify({ verify: { verify_after_reading: true, verify_trust: true, remote_manifest_fetch: false } })
    const report = JSON.parse(await mod.read_manifest_store(readFileSync(asset), 'image/jpeg', settings)) as CrJson

    const [identity] = getCawgIdentities(report, report.manifests![0])
    expect(identity.sigType).toBe('cawg.x509.cose')
    expect(identity.displayName).toBe('C2PA Test Signing Cert')
    expect(identity.success.map((s) => s.code)).toContain('cawg.identity.well-formed')
    expect(identity.state).toBe('untrusted')
  })
})
