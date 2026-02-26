import { createC2pa } from '@contentauth/c2pa-web'
import type { C2paSdk, Settings, ValidationStatus } from '@contentauth/c2pa-web'
import { VERSION_INFO } from './version'
import type { ConformanceReport } from './types'
import { VALIDATION_STATUS } from './constants'

let c2paInstance: C2paSdk | null = null
let mainTrustListPem: string | null = null
let itlTrustListPem: string | null = null

// Official C2PA trust list URLs
const TRUST_LIST_URL = 'https://raw.githubusercontent.com/c2pa-org/conformance-public/main/trust-list/C2PA-TRUST-LIST.pem'
const TSA_TRUST_LIST_URL = 'https://raw.githubusercontent.com/c2pa-org/conformance-public/main/trust-list/C2PA-TSA-TRUST-LIST.pem'
// ITL (Interim Trust List) - stored locally, consists of two files
const ITL_ALLOWED_URL = '/trust/allowed.pem'  // leaf certificates
const ITL_ANCHORS_URL = '/trust/anchors.pem'  // root certificates

/**
 * Fetch the main C2PA trust lists (without ITL)
 */
async function fetchMainTrustList(): Promise<string> {
  if (mainTrustListPem) {
    return mainTrustListPem
  }

  try {
    const [trustListResponse, tsaTrustListResponse] = await Promise.all([
      fetch(TRUST_LIST_URL),
      fetch(TSA_TRUST_LIST_URL)
    ])

    if (!trustListResponse.ok) {
      throw new Error(`Failed to fetch C2PA trust list: ${trustListResponse.status} ${trustListResponse.statusText}`)
    }
    if (!tsaTrustListResponse.ok) {
      throw new Error(`Failed to fetch TSA trust list: ${tsaTrustListResponse.status} ${tsaTrustListResponse.statusText}`)
    }

    const [trustList, tsaTrustList] = await Promise.all([
      trustListResponse.text(),
      tsaTrustListResponse.text()
    ])

    mainTrustListPem = trustList + '\n' + tsaTrustList
    console.log('✅ Loaded main trust lists')
    return mainTrustListPem
  } catch (error) {
    console.error('Failed to fetch main trust lists:', error)
    throw new Error('Failed to fetch C2PA trust lists')
  }
}

/**
 * Fetch the ITL (Interim Trust List)
 * The ITL consists of two files that need to be merged:
 * - allowed.pem: leaf certificates
 * - anchors.pem: root certificates
 */
async function fetchITL(): Promise<string> {
  if (itlTrustListPem) {
    return itlTrustListPem
  }

  try {
    const [allowedResponse, anchorsResponse] = await Promise.all([
      fetch(ITL_ALLOWED_URL),
      fetch(ITL_ANCHORS_URL)
    ])

    if (!allowedResponse.ok) {
      throw new Error(`Failed to fetch ITL allowed.pem: ${allowedResponse.status} ${allowedResponse.statusText}`)
    }
    if (!anchorsResponse.ok) {
      throw new Error(`Failed to fetch ITL anchors.pem: ${anchorsResponse.status} ${anchorsResponse.statusText}`)
    }

    const [allowed, anchors] = await Promise.all([
      allowedResponse.text(),
      anchorsResponse.text()
    ])

    itlTrustListPem = allowed + '\n' + anchors
    console.log('✅ Loaded ITL (Interim Trust List) - merged allowed.pem and anchors.pem')
    return itlTrustListPem
  } catch (error) {
    console.error('Failed to fetch ITL:', error)
    throw new Error('Failed to fetch ITL')
  }
}

/**
 * Initialize the C2PA SDK
 */
async function initC2pa(): Promise<C2paSdk> {
  if (c2paInstance) {
    return c2paInstance
  }

  try {
    // Initialize the C2PA SDK with WASM source
    c2paInstance = await createC2pa({
      wasmSrc: '/c2pa.wasm'
    })
    return c2paInstance
  } catch (error) {
    console.error('Failed to initialize C2PA SDK:', error)
    throw new Error('Failed to initialize C2PA SDK')
  }
}

/**
 * Process a file and return a C2PA conformance report with ITL detection
 * @param file The file to process
 * @param testCertificates Optional array of test certificates (PEM format) to add to trust list
 */
export async function processFile(file: File, testCertificates: string[] = []): Promise<ConformanceReport> {
  console.log('🔍 Starting file processing for:', file.name, 'Type:', file.type)

  // Initialize C2PA SDK if not already initialized
  console.log('Initializing C2PA SDK...')
  const c2pa = await initC2pa()
  console.log('✅ C2PA SDK initialized')

  try {
    console.log('Fetching official C2PA trust lists...')

    // Fetch main trust list and ITL separately
    const [mainTrustList, itl] = await Promise.all([
      fetchMainTrustList(),
      fetchITL()
    ])

    console.log('Step 1: Validating with official trust list only...')
    const officialSettings: Settings = {
      verify: {
        verifyTrust: true,
        verifyAfterReading: true
      },
      trust: {
        trustAnchors: mainTrustList
      }
    }

    // First validation with official trust list only (no test certs)
    const reader1 = await c2pa.reader.fromBlob(file.type, file, officialSettings)
    if (!reader1) {
      throw new Error('No C2PA manifest found in this file')
    }

    const officialManifestStore = await reader1.manifestStore()
    await reader1.free()

    // Check if signature is untrusted with official TL
    const officialUntrusted = officialManifestStore.validation_results?.activeManifest?.failure?.some(
      (status: ValidationStatus) => status.code === VALIDATION_STATUS.SIGNING_CREDENTIAL_UNTRUSTED
    )

    console.log('Official TL validation results:', {
      isUntrusted: officialUntrusted,
      success: officialManifestStore.validation_results?.activeManifest?.success?.map((s: ValidationStatus) => s.code),
      failure: officialManifestStore.validation_results?.activeManifest?.failure?.map((f: ValidationStatus) => f.code)
    })

    // Now validate with test certificates if provided
    let manifestStore = officialManifestStore
    let usedTestCerts = false

    if (testCertificates.length > 0) {
      console.log('Step 2: Validating with test certificates added...')
      const testSettings: Settings = {
        verify: {
          verifyTrust: true,
          verifyAfterReading: true
        },
        trust: {
          trustAnchors: mainTrustList + '\n' + testCertificates.join('\n')
        }
      }

      const reader2 = await c2pa.reader.fromBlob(file.type, file, testSettings)
      if (reader2) {
        const testManifestStore = await reader2.manifestStore()
        await reader2.free()

        const testUntrusted = testManifestStore.validation_results?.activeManifest?.failure?.some(
          (status: ValidationStatus) => status.code === VALIDATION_STATUS.SIGNING_CREDENTIAL_UNTRUSTED
        )

        console.log('Test cert validation results:', {
          isUntrusted: testUntrusted,
          success: testManifestStore.validation_results?.activeManifest?.success?.map((s: ValidationStatus) => s.code),
          failure: testManifestStore.validation_results?.activeManifest?.failure?.map((f: ValidationStatus) => f.code)
        })

        // If it was untrusted with official TL but trusted with test certs, test certs were used
        if (officialUntrusted && !testUntrusted) {
          console.log('✅ Test certificates made the difference - signature now trusted')
          usedTestCerts = true
          manifestStore = testManifestStore
        } else {
          console.log('ℹ️  Test certificates loaded but not needed for validation')
          // Use official validation results
        }
      }
    }

    // Check if signature is untrusted
    const isUntrusted = manifestStore.validation_results?.activeManifest?.failure?.some(
      (status: ValidationStatus) => status.code === VALIDATION_STATUS.SIGNING_CREDENTIAL_UNTRUSTED
    )

    console.log('Main validation results:', {
      isUntrusted,
      success: manifestStore.validation_results?.activeManifest?.success?.map((s: ValidationStatus) => s.code),
      failure: manifestStore.validation_results?.activeManifest?.failure?.map((f: ValidationStatus) => f.code)
    })

    let usedITL = false
    let finalManifestStore = manifestStore

    if (isUntrusted) {
      console.log('⚠️  Signature untrusted on main list, checking ITL...')

      // Try with ITL included
      const itlSettings: Settings = {
        verify: {
          verifyTrust: true,
          verifyAfterReading: true
        },
        trust: {
          trustAnchors: mainTrustList + '\n' + itl
        }
      }

      const reader2 = await c2pa.reader.fromBlob(file.type, file, itlSettings)
      if (reader2) {
        const itlManifestStore = await reader2.manifestStore()
        await reader2.free()

        console.log('ITL validation results:', {
          success: itlManifestStore.validation_results?.activeManifest?.success?.map((s: ValidationStatus) => s.code),
          failure: itlManifestStore.validation_results?.activeManifest?.failure?.map((f: ValidationStatus) => ({
            code: f.code,
            explanation: f.explanation
          }))
        })

        // Check if ITL validation succeeded
        const itlTrusted = itlManifestStore.validation_results?.activeManifest?.success?.some(
          (status: ValidationStatus) => status.code === VALIDATION_STATUS.SIGNING_CREDENTIAL_TRUSTED
        )

        const itlStillUntrusted = itlManifestStore.validation_results?.activeManifest?.failure?.some(
          (status: ValidationStatus) => status.code === VALIDATION_STATUS.SIGNING_CREDENTIAL_UNTRUSTED
        )

        console.log('ITL validation check:', { itlTrusted, itlStillUntrusted })

        // Log the untrusted failure details
        const untrustedFailure = itlManifestStore.validation_results?.activeManifest?.failure?.find(
          (status: ValidationStatus) => status.code === VALIDATION_STATUS.SIGNING_CREDENTIAL_UNTRUSTED
        )
        if (untrustedFailure) {
          console.log('ITL still untrusted, reason:', untrustedFailure.explanation)
        }

        if (itlTrusted && !itlStillUntrusted) {
          console.log('✅ Signature validated by ITL')
          usedITL = true
          finalManifestStore = itlManifestStore
        } else {
          console.log('❌ Signature still not trusted even with ITL')
        }
      }
    }

    console.log('✅ Manifest store retrieved with trust validation')

    return {
      ...finalManifestStore,
      usedITL,
      usedTestCerts,
      _conformanceToolVersion: {
        commit: VERSION_INFO.sha,
        shortCommit: VERSION_INFO.shortSha,
        date: VERSION_INFO.date,
        branch: VERSION_INFO.branch,
        generatedAt: VERSION_INFO.timestamp
      }
    }
  } catch (error) {
    console.error('❌ Error in processFile:', error)
    if (error instanceof Error) {
      throw new Error(`Failed to process file: ${error.message}`)
    }
    throw error
  }
}

/**
 * Get the C2PA library version
 */
export async function getVersion(): Promise<string> {
  // The SDK doesn't expose a version property directly
  // Return the package version we're using
  return '@contentauth/c2pa-web v0.5.6'
}
