import fs from 'fs'
import path from 'path'
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/svelte'
import ReportViewer from './ReportViewer.svelte'
import type { ConformanceReport } from './types'
import { _resetSignalsCacheForTests } from './summarySignals'

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

  it('should overlay pseudo-manifest signals onto flat ingredient stub nodes without duplicating leaves', async () => {
    const originalFetch = global.fetch
    const signalsYamlPath = path.resolve(__dirname, '../../public/rubrics/asset-rubric-signals-local.yml')
    const signalsYaml = fs.readFileSync(signalsYamlPath, 'utf-8')

    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
      if (urlStr.endsWith('asset-rubric-signals-local.yml')) {
        return {
          ok: true,
          text: async () => signalsYaml
        } as unknown as Response
      }
      if (typeof originalFetch === 'function') {
        return originalFetch(input, init)
      }
      return { ok: false, status: 404, text: async () => '' } as unknown as Response
    })

    const mockReport: ConformanceReport = {
      manifests: [
        {
          label: 'urn:c2pa:55b69364-2693-de82-a555-4c605a19e9c0',
          assertions: {
            'c2pa.ingredient.v3': {
              'dc:format': 'image/png',
              'dc:title': 'Opened Ingredient PNG',
              description: 'Opened ingredient',
              digitalSourceType: 'http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia',
              relationship: 'parentOf'
            },
            'c2pa.ingredient.v3__1': {
              'dc:format': 'image/png',
              'dc:title': 'Placed Ingredient PNG',
              description: 'Placed ingredient 0',
              digitalSourceType: 'http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia',
              relationship: 'componentOf'
            },
            'c2pa.actions.v2': {
              allActionsIncluded: true,
              actions: [
                {
                  action: 'c2pa.opened',
                  parameters: {
                    ingredients: [
                      {
                        url: 'self#jumbf=c2pa.assertions/c2pa.ingredient.v3',
                        hash: "b64'h1'"
                      }
                    ]
                  }
                },
                {
                  action: 'c2pa.placed',
                  parameters: {
                    ingredients: [
                      {
                        url: 'self#jumbf=c2pa.assertions/c2pa.ingredient.v3__1',
                        hash: "b64'h2'"
                      }
                    ]
                  }
                }
              ]
            }
          },
          signature: {
            certificateInfo: {
              subject: {
                CN: 'TESTING Google Media Processing Services',
                O: 'TESTING Google LLC'
              }
            }
          },
          validationResults: {
            success: [{ code: 'signingCredential.trusted' }],
            failure: [],
            informational: []
          }
        }
      ]
    } as unknown as ConformanceReport

    try {
      _resetSignalsCacheForTests()

      const { container } = render(ReportViewer, { report: mockReport })

      await vi.waitFor(() => {
        const nodeCards = container.querySelectorAll('button.relative')
        expect(nodeCards.length).toBe(3)

        expect(container.textContent).toContain('Opened Ingredient PNG')
        expect(container.textContent).toContain('Placed Ingredient PNG')

        expect(nodeCards[1].parentElement?.textContent).toContain('Contains Partly GenAI Creation')
        expect(nodeCards[2].parentElement?.textContent).toContain('Contains Partly GenAI Creation')
      })
    } finally {
      global.fetch = originalFetch
      _resetSignalsCacheForTests()
    }
  })
})


