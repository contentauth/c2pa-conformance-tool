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

  it('should render solid red Cr badge and Signature Not Trusted — Certificate Revoked when active cert is revoked', () => {
    const mockReport: ConformanceReport = {
      manifests: [
        {
          label: 'active_manifest',
          assertions: {},
          validationResults: {
            success: [{ code: 'claimSignature.validated' }],
            failure: [{ code: 'signingCredential.ocsp.revoked', explanation: 'The certificate was revoked by CA' }]
          },
          signature: {
            certificateInfo: {
              subject: { CN: 'Revoked Signer' }
            }
          }
        }
      ]
    } as unknown as ConformanceReport

    const { container, getByText } = render(ReportViewer, { report: mockReport })

    // Check main banner
    expect(getByText(/Signature Not Trusted — Certificate Revoked/)).toBeTruthy()

    // Check top-left Cr pin badge on the card
    const badge = container.querySelector('.bg-red-600')
    expect(badge).toBeTruthy()
    expect(badge?.textContent).toContain('Revoked')

    // Check card border is border-red-500
    const card = container.querySelector('button.border-red-500')
    expect(card).toBeTruthy()
  })

  it('should display OCSP Verified badge when active manifest has signingCredential.ocsp.notRevoked and is trusted', () => {
    const mockReport: ConformanceReport = {
      manifests: [
        {
          label: 'active_manifest',
          assertions: {},
          validationResults: {
            success: [
              { code: 'signingCredential.trusted' },
              { code: 'signingCredential.ocsp.notRevoked' },
              { code: 'claimSignature.validated' }
            ],
            failure: []
          },
          signature: {
            certificateInfo: {
              subject: { CN: 'Trusted Signer' }
            }
          }
        }
      ]
    } as unknown as ConformanceReport

    const { container, getByText } = render(ReportViewer, { report: mockReport })

    expect(getByText('Signature Trusted')).toBeTruthy()
    expect(getByText('OCSP Verified (Not Revoked)')).toBeTruthy()
    expect(container.textContent).toContain('Validated against official C2PA Trust List and verified active (not revoked) via OCSP')
  })

  it('should display OCSP Verified badge and headline when signingCredential.ocsp.notRevoked is under informational', () => {
    const mockReport: ConformanceReport = {
      manifests: [
        {
          label: 'active_manifest',
          assertions: {},
          validationResults: {
            success: [
              { code: 'signingCredential.trusted' },
              { code: 'claimSignature.validated' }
            ],
            informational: [
              { code: 'signingCredential.ocsp.notRevoked', explanation: 'certificate not revoked' }
            ],
            failure: []
          },
          signature: {
            certificateInfo: {
              subject: { CN: 'Trusted Signer' }
            }
          }
        }
      ]
    } as unknown as ConformanceReport

    const { container, getByText } = render(ReportViewer, { report: mockReport })

    expect(getByText('Signature Trusted')).toBeTruthy()
    expect(getByText('OCSP Verified (Not Revoked)')).toBeTruthy()
    expect(container.textContent).toContain('Validated against official C2PA Trust List and verified active (not revoked) via OCSP')
  })

  it('should mark overall verdict untrusted if an ingredient manifest has revoked certificate', () => {
    const mockReport: ConformanceReport = {
      manifests: [
        {
          label: 'active_manifest',
          assertions: {
            'c2pa.ingredient.v3': {
              relationship: 'parentOf',
              activeManifest: 'urn:c2pa:ingredient'
            }
          },
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
          label: 'urn:c2pa:ingredient',
          assertions: {},
          validationResults: {
            failure: [{ code: 'signingCredential.ocsp.revoked' }]
          },
          signature: {
            certificateInfo: {
              subject: { CN: 'Revoked Ingredient' }
            }
          }
        }
      ]
    } as unknown as ConformanceReport

    const { container, getByText } = render(ReportViewer, { report: mockReport })

    // Overall verdict should be untrusted due to ingredient revocation
    expect(getByText(/Signature Not Trusted — Certificate Revoked/)).toBeTruthy()

    // The ingredient card should have border-red-500 and the red revoked Cr badge
    const redCards = container.querySelectorAll('button.border-red-500')
    expect(redCards.length).toBe(1)
  })

  it('should display Full-Chain OCSP Verified badge and headline when both leaf and issuing CA are good', () => {
    const mockReport: ConformanceReport = {
      manifests: [
        {
          label: 'active_manifest',
          assertions: {},
          validationResults: {
            success: [
              { code: 'signingCredential.trusted' },
              { code: 'signingCredential.ocsp.notRevoked' }
            ],
            failure: []
          },
          signature: {
            certificateInfo: {
              subject: { CN: 'Active Signer' }
            }
          }
        }
      ],
      _icaOcsp: {
        active_manifest: {
          status: 'good',
          icaSubjectCn: 'Test Issuing CA G1',
          responderUrl: 'http://ocsp.test-pki.example'
        }
      }
    } as unknown as ConformanceReport

    const { container, getByText, getAllByText } = render(ReportViewer, { report: mockReport })

    // Check subtitle (on headline banner, visible across tabs)
    expect(getByText(/verified active \(not revoked\) via Full-Chain OCSP/)).toBeTruthy()

    // Check badge (on headline banner)
    expect(getByText(/Full-Chain OCSP Verified/)).toBeTruthy()

    // Check top-right shield overlay on thumbnail card
    const shieldOverlay = container.querySelector('[title="All certificates in the chain passed live OCSP checks"]')
    expect(shieldOverlay).toBeTruthy()
    expect(shieldOverlay?.classList.contains('bg-blue-600')).toBe(true)

    // Ensure "Full-Chain OCSP" text badge is NOT present below the thumbnail card
    const badgeSpans = container.querySelectorAll('.badge')
    for (const b of badgeSpans) {
      expect(b.textContent?.toLowerCase()).not.toContain('full-chain ocsp')
    }

    // Switch to Report tab to check Validation Status Details
    fireEvent.click(getByText('Report'))

    // Check Issuing CA row in Validation Status Details
    expect(getByText(/issuingCA.ocsp.notRevoked/)).toBeTruthy()

    // Test Issuing CA G1 appears in both Validation Status Details and Signature Information
    const icaNodes = getAllByText(/Test Issuing CA G1/)
    expect(icaNodes.length).toBe(2)
  })

  it('should mark overall verdict untrusted when an Issuing CA is revoked in _icaOcsp', () => {
    const mockReport: ConformanceReport = {
      manifests: [
        {
          label: 'active_manifest',
          assertions: {},
          validationResults: {
            success: [
              { code: 'signingCredential.trusted' },
              { code: 'signingCredential.ocsp.notRevoked' }
            ],
            failure: []
          },
          signature: {
            certificateInfo: {
              subject: { CN: 'Active Signer' }
            }
          }
        }
      ],
      _icaOcsp: {
        active_manifest: {
          status: 'revoked',
          icaSubjectCn: 'Revoked Issuing CA G1',
          responderUrl: 'http://ocsp.test-pki.example',
          revokedAt: '2026-09-01T12:00:00Z'
        }
      }
    } as unknown as ConformanceReport

    const { getByText } = render(ReportViewer, { report: mockReport })

    // Headline should reflect revoked status (visible across tabs)
    expect(getByText(/Signature Not Trusted — Certificate Revoked/)).toBeTruthy()

    // Switch to Report tab
    fireEvent.click(getByText('Report'))

    // Issuing CA failure row in Validation Status Details
    expect(getByText(/issuingCA.ocsp.revoked/)).toBeTruthy()
  })
})


