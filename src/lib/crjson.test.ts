import { describe, it, expect } from 'vitest'
import { getAllValidationFailures, type CrJson } from './crjson'

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
  })
})
