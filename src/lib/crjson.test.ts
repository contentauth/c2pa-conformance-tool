import { describe, it, expect } from 'vitest'
import { getAllValidationFailures, getActiveManifestValidationStatus, getManifestValidationStatus, isAssertionScopedStatus, type CrJson } from './crjson'

describe('crjson utilities', () => {
  describe('getAllValidationFailures', () => {
    it('should return empty array if no failures', () => {
      const report: CrJson = {
        manifests: [
          {
            label: 'active',
            assertions: {},
            validationResults: {
              success: [{ code: 'signingCredential.trusted' }]
            }
          }
        ]
      }
      expect(getAllValidationFailures(report)).toEqual([])
    })

    it('should collect document-level failures', () => {
      const report: CrJson = {
        manifests: [{ label: 'active', assertions: {} }],
        validationResults: {
          failure: [{ code: 'general.error', explanation: 'error' }]
        }
      }
      expect(getAllValidationFailures(report)).toEqual([
        { code: 'general.error', explanation: 'error' }
      ])
    })

    it('should collect activeManifest failures from document-level validationResults', () => {
      const report: CrJson = {
        manifests: [{ label: 'active', assertions: {} }],
        validationResults: {
          activeManifest: {
            failure: [{ code: 'signingCredential.untrusted' }]
          }
        }
      }
      expect(getAllValidationFailures(report)).toEqual([
        { code: 'signingCredential.untrusted' }
      ])
    })

    it('should collect failures from active manifest per-manifest validationResults', () => {
      const report: CrJson = {
        manifests: [
          {
            label: 'active',
            assertions: {},
            validationResults: {
              failure: [{ code: 'signingCredential.untrusted' }]
            }
          }
        ]
      }
      expect(getAllValidationFailures(report)).toEqual([
        { code: 'signingCredential.untrusted' }
      ])
    })

    it('should collect failures from ingredient manifests', () => {
      const report: CrJson = {
        manifests: [
          {
            label: 'active',
            assertions: {},
            validationResults: {
              success: [{ code: 'signingCredential.trusted' }]
            }
          },
          {
            label: 'ingredient',
            assertions: {},
            validationResults: {
              failure: [{ code: 'claimSignature.invalid', explanation: 'bad sig' }]
            }
          }
        ]
      }
      expect(getAllValidationFailures(report)).toEqual([
        { code: 'claimSignature.invalid', explanation: 'bad sig' }
      ])
    })

    it('should de-duplicate failures by code', () => {
      const report: CrJson = {
        manifests: [
          {
            label: 'active',
            assertions: {},
            validationResults: {
              failure: [{ code: 'signingCredential.untrusted', explanation: '1' }]
            }
          },
          {
            label: 'ingredient',
            assertions: {},
            validationResults: {
              failure: [{ code: 'signingCredential.untrusted', explanation: '2' }]
            }
          }
        ]
      }
      expect(getAllValidationFailures(report)).toEqual([
        { code: 'signingCredential.untrusted', explanation: '1' }
      ])
    })

    // Regression: a CAWG identity assertion's own X.509 credential can be untrusted
    // even though the manifest's own C2PA claim signature is fully trusted. c2pa-rs
    // reuses the same `signingCredential.untrusted` code for both, distinguishable
    // only by `url` (this shape is taken from a real signed video that reproduced the
    // bug). getAllValidationFailures must not let the assertion-scoped failure make
    // the whole report look untrusted.
    it('excludes a signingCredential.untrusted failure scoped to an embedded assertion', () => {
      const claimUrl = 'self#jumbf=/c2pa/urn:c2pa:test/c2pa.signature'
      const cawgUrl = 'self#jumbf=/c2pa/urn:c2pa:test/c2pa.assertions/cawg.identity'
      const report: CrJson = {
        manifests: [
          {
            label: 'active',
            assertions: {},
            validationResults: {
              success: [{ code: 'signingCredential.trusted', url: claimUrl }],
              failure: [{ code: 'signingCredential.untrusted', url: cawgUrl, explanation: 'signing certificate untrusted' }]
            }
          }
        ]
      }
      expect(getAllValidationFailures(report)).toEqual([])
    })

    it('still includes a signingCredential.untrusted failure that is scoped to the claim signature itself', () => {
      const claimUrl = 'self#jumbf=/c2pa/urn:c2pa:test/c2pa.signature'
      const report: CrJson = {
        manifests: [
          {
            label: 'active',
            assertions: {},
            validationResults: {
              failure: [{ code: 'signingCredential.untrusted', url: claimUrl }]
            }
          }
        ]
      }
      expect(getAllValidationFailures(report)).toEqual([
        { code: 'signingCredential.untrusted', url: claimUrl }
      ])
    })
  })

  describe('isAssertionScopedStatus', () => {
    it('is true for a status scoped to an embedded assertion', () => {
      expect(isAssertionScopedStatus({
        code: 'signingCredential.untrusted',
        url: 'self#jumbf=/c2pa/urn:c2pa:test/c2pa.assertions/cawg.identity'
      })).toBe(true)
    })

    it('is false for a status scoped to the claim signature', () => {
      expect(isAssertionScopedStatus({
        code: 'signingCredential.trusted',
        url: 'self#jumbf=/c2pa/urn:c2pa:test/c2pa.signature'
      })).toBe(false)
    })

    it('is false when there is no url', () => {
      expect(isAssertionScopedStatus({ code: 'signingCredential.trusted' })).toBe(false)
    })
  })

  describe('getActiveManifestValidationStatus', () => {
    it('excludes assertion-scoped entries but keeps claim-signature-scoped ones', () => {
      const claimUrl = 'self#jumbf=/c2pa/urn:c2pa:test/c2pa.signature'
      const cawgUrl = 'self#jumbf=/c2pa/urn:c2pa:test/c2pa.assertions/cawg.identity'
      const report: CrJson = {
        manifests: [
          {
            label: 'active',
            assertions: {},
            validationResults: {
              success: [
                { code: 'signingCredential.trusted', url: claimUrl },
                { code: 'timeStamp.validated', url: claimUrl },
              ],
              failure: [{ code: 'signingCredential.untrusted', url: cawgUrl }],
              informational: [{ code: 'cawg.identity.well-formed', url: cawgUrl }],
            }
          }
        ]
      }
      const status = getActiveManifestValidationStatus(report)
      expect(status?.failure).toEqual([])
      expect(status?.success).toEqual([
        { code: 'signingCredential.trusted', url: claimUrl },
        { code: 'timeStamp.validated', url: claimUrl },
      ])
      expect(status?.informational).toEqual([])
    })
  })

  // Regression: the "Validation Status Details" UI reads getManifestValidationStatus
  // per-manifest, a separate code path from getActiveManifestValidationStatus above.
  // It must apply the same exclusion, or a CAWG identity assertion's untrusted X.509
  // credential shows up as a validation error even though this tool does not evaluate
  // CAWG identity.
  describe('getManifestValidationStatus', () => {
    it('excludes assertion-scoped entries but keeps claim-signature-scoped ones', () => {
      const claimUrl = 'self#jumbf=/c2pa/urn:c2pa:test/c2pa.signature'
      const cawgUrl = 'self#jumbf=/c2pa/urn:c2pa:test/c2pa.assertions/cawg.identity'
      const report: CrJson = {
        manifests: [
          {
            label: 'active',
            assertions: {},
            validationResults: {
              success: [{ code: 'signingCredential.trusted', url: claimUrl }],
              failure: [{ code: 'signingCredential.untrusted', url: cawgUrl }],
              informational: [{ code: 'cawg.identity.well-formed', url: cawgUrl }],
            }
          }
        ]
      }
      const status = getManifestValidationStatus(report, report.manifests![0], true)
      expect(status?.failure).toEqual([])
      expect(status?.informational).toEqual([])
      expect(status?.success).toEqual([{ code: 'signingCredential.trusted', url: claimUrl }])
    })
  })
})
