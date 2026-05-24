import { describe, it, expect } from 'vitest'
import { render, fireEvent } from '@testing-library/svelte'
import ReportViewer from './ReportViewer.svelte'
import type { ConformanceReport } from './types'

describe('ReportViewer Component', () => {
  it('should render failures grouped by manifest in Validation Status Details', () => {
    const mockReport: ConformanceReport = {
      manifests: [
        {
          label: 'active_manifest_label',
          assertions: {},
          validationResults: {
            success: [
              { code: 'signingCredential.trusted' },
              { code: 'timeStamp.trusted' },
              { code: 'claimSignature.validated' }
            ],
            failure: [
              { code: 'assertion.bmffHash.mismatch', explanation: 'BMFF hash mismatch' }
            ]
          },
          signature: {
            certificateInfo: {
              subject: { CN: 'Active Signer' }
            }
          }
        }
      ]
    }

    const { container, getByText } = render(ReportViewer, { report: mockReport })

    // Navigate to the Report tab (default is Summary)
    fireEvent.click(getByText('Report'))

    const detailsSection = container.querySelector('#validation-status')
    expect(detailsSection).toBeTruthy()

    // Should have 1 manifest group card
    const groupCards = detailsSection?.querySelectorAll('.manifest-group-card')
    expect(groupCards?.length).toBe(1)

    // Check header of the group
    const header = groupCards?.[0].querySelector('h4')
    expect(header?.textContent).toContain('Active Asset')
    expect(header?.textContent).toContain('active_manifest_label')
    expect(header?.textContent).toContain('signed by Active Signer')

    // Check status cards inside the group (1 failure + 3 successes)
    const failureCards = groupCards?.[0].querySelectorAll('.bg-red-50\\/50') // escaped slash for selector
    expect(failureCards?.length).toBe(1)
    expect(failureCards?.[0].textContent).toContain('assertion.bmffHash.mismatch')
    expect(failureCards?.[0].textContent).toContain('BMFF hash mismatch')

    const successCards = groupCards?.[0].querySelectorAll('.bg-green-50\\/50')
    expect(successCards?.length).toBe(3)
    expect(successCards?.[0].textContent).toContain('signingCredential.trusted')
  })

  it('should render ingredient failures in their own group card', () => {
    const mockReport: ConformanceReport = {
      manifests: [
        {
          label: 'active_label',
          assertions: {},
          validationResults: {
            success: [{ code: 'signingCredential.trusted' }]
          },
          signature: {
            certificateInfo: {
              subject: { CN: 'Active Signer' }
            }
          }
        },
        {
          label: 'ingredient_label',
          assertions: {},
          validationResults: {
            failure: [{ code: 'assertion.bmffHash.mismatch', explanation: 'BMFF hash mismatch' }]
          },
          signature: {
            certificateInfo: {
              subject: { CN: 'Ingredient Signer' }
            }
          }
        }
      ]
    }

    const { container, getByText } = render(ReportViewer, { report: mockReport })

    // Navigate to the Report tab (default is Summary)
    fireEvent.click(getByText('Report'))

    const detailsSection = container.querySelector('#validation-status')
    expect(detailsSection).toBeTruthy()

    // Should have 2 manifest group cards (both have statuses to show)
    const groupCards = detailsSection?.querySelectorAll('.manifest-group-card')
    expect(groupCards?.length).toBe(2)

    // First group (Active Asset)
    const header1 = groupCards?.[0].querySelector('h4')
    expect(header1?.textContent).toContain('Active Asset')
    expect(header1?.textContent).toContain('active_label')
    expect(header1?.textContent).toContain('signed by Active Signer')
    expect(groupCards?.[0].querySelectorAll('.bg-green-50\\/50').length).toBe(1)
    expect(groupCards?.[0].querySelectorAll('.bg-red-50\\/50').length).toBe(0)

    // Second group (Ingredient 1)
    const header2 = groupCards?.[1].querySelector('h4')
    expect(header2?.textContent).toContain('Ingredient 1')
    expect(header2?.textContent).toContain('ingredient_label')
    expect(header2?.textContent).toContain('signed by Ingredient Signer')
    expect(groupCards?.[1].querySelectorAll('.bg-green-50\\/50').length).toBe(0)
    expect(groupCards?.[1].querySelectorAll('.bg-red-50\\/50').length).toBe(1)
    expect(groupCards?.[1].querySelector('.bg-red-50\\/50')?.textContent).toContain('assertion.bmffHash.mismatch')
  })

  it('should filter out ingredient thumbnails from active manifest claim thumbnail and map ingredient nodes correctly', () => {
    const mockReport: ConformanceReport = {
      manifests: [
        {
          label: 'urn:c2pa:active',
          assertions: {
            'c2pa.thumbnail.ingredient': {
              format: 'image/jpeg',
              data: 'active_ingredient_thumb_b64'
            },
            'c2pa.ingredient.v3': {
              relationship: 'parentOf',
              thumbnail: {
                url: 'self#jumbf=c2pa.assertions/c2pa.thumbnail.ingredient'
              },
              activeManifest: {
                url: 'self#jumbf=/c2pa/urn:c2pa:ingredient',
                hash: "b64'child_hash"
              }
            }
          },
          signature: {
            certificateInfo: {
              subject: { CN: 'Active Signer' }
            }
          },
          validationResults: { success: [], failure: [] }
        },
        {
          label: 'urn:c2pa:ingredient',
          assertions: {
            'c2pa.thumbnail.claim': {
              format: 'image/png',
              data: 'ingredient_claim_thumb_b64'
            }
          },
          signature: {
            certificateInfo: {
              subject: { CN: 'Child Signer' }
            }
          },
          validationResults: { success: [], failure: [] }
        }
      ]
    } as unknown as ConformanceReport

    const { container } = render(ReportViewer, { report: mockReport })

    // Query all provenance graph nodes (button cards)
    const nodeCards = container.querySelectorAll('button.relative')
    expect(nodeCards.length).toBe(2)

    // Root node (active manifest): should NOT render an image because its c2pa.thumbnail.ingredient was filtered out of claim thumbnails.
    const rootImg = nodeCards[0].querySelector('img.object-cover')
    expect(rootImg).toBeFalsy()

    // Ingredient node (child manifest): should render its own claim thumbnail ("ingredient_claim_thumb_b64")
    const childImg = nodeCards[1].querySelector('img.object-cover')
    expect(childImg).toBeTruthy()
    expect(childImg?.getAttribute('src')).toBe('data:image/png;base64,ingredient_claim_thumb_b64')
  })

  it('should fall back to parent-resolved ingredient thumbnail for child manifest node if it lacks its own claim thumbnail', () => {
    const mockReport: ConformanceReport = {
      manifests: [
        {
          label: 'urn:c2pa:active',
          assertions: {
            'c2pa.thumbnail.ingredient': {
              format: 'image/jpeg',
              data: 'active_ingredient_thumb_b64'
            },
            'c2pa.ingredient.v3': {
              relationship: 'parentOf',
              thumbnail: {
                url: 'self#jumbf=c2pa.assertions/c2pa.thumbnail.ingredient'
              },
              activeManifest: {
                url: 'self#jumbf=/c2pa/urn:c2pa:ingredient',
                hash: "b64'child_hash"
              }
            }
          },
          signature: {
            certificateInfo: {
              subject: { CN: 'Active Signer' }
            }
          },
          validationResults: { success: [], failure: [] }
        },
        {
          label: 'urn:c2pa:ingredient',
          assertions: {
            // No claim thumbnail assertion here!
          },
          signature: {
            certificateInfo: {
              subject: { CN: 'Child Signer' }
            }
          },
          validationResults: { success: [], failure: [] }
        }
      ]
    } as unknown as ConformanceReport

    const { container } = render(ReportViewer, { report: mockReport })

    const nodeCards = container.querySelectorAll('button.relative')
    expect(nodeCards.length).toBe(2)

    // Root node (active manifest): should NOT render an image.
    const rootImg = nodeCards[0].querySelector('img.object-cover')
    expect(rootImg).toBeFalsy()

    // Ingredient node: should fall back to parent's resolved ingredient thumbnail ("active_ingredient_thumb_b64")
    const childImg = nodeCards[1].querySelector('img.object-cover')
    expect(childImg).toBeTruthy()
    expect(childImg?.getAttribute('src')).toBe('data:image/jpeg;base64,active_ingredient_thumb_b64')
  })
})

