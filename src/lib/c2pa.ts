import { createC2pa } from '@contentauth/c2pa-web'
import type { C2paSdk, ManifestStore, SettingsContext } from '@contentauth/c2pa-web'

let c2paInstance: C2paSdk | null = null
let trustListPem: string | null = null

// Official C2PA trust list URLs
const TRUST_LIST_URL = 'https://raw.githubusercontent.com/c2pa-org/conformance-public/main/trust-list/C2PA-TRUST-LIST.pem'
const TSA_TRUST_LIST_URL = 'https://raw.githubusercontent.com/c2pa-org/conformance-public/main/trust-list/C2PA-TSA-TRUST-LIST.pem'

/**
 * Fetch and combine the official C2PA trust lists
 */
async function fetchTrustLists(): Promise<string> {
  if (trustListPem) {
    return trustListPem
  }

  try {
    const [trustList, tsaTrustList] = await Promise.all([
      fetch(TRUST_LIST_URL).then(r => r.text()),
      fetch(TSA_TRUST_LIST_URL).then(r => r.text())
    ])

    // Combine both trust lists
    trustListPem = trustList + '\n' + tsaTrustList
    return trustListPem
  } catch (error) {
    console.error('Failed to fetch trust lists:', error)
    throw new Error('Failed to fetch C2PA trust lists')
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
 * Process a file and return a C2PA conformance report
 * @param file The file to process
 * @param testCertificates Optional array of test certificates (PEM format) to add to trust list
 */
export async function processFile(file: File, testCertificates: string[] = []): Promise<ManifestStore> {
  console.log('🔍 Starting file processing for:', file.name, 'Type:', file.type)

  // Initialize C2PA SDK if not already initialized
  console.log('Initializing C2PA SDK...')
  const c2pa = await initC2pa()
  console.log('✅ C2PA SDK initialized')

  try {
    console.log('Fetching official C2PA trust lists...')

    // Fetch and concatenate the trust lists into a single string
    let trustAnchors = await fetchTrustLists()
    console.log('✅ Trust anchors fetched, length:', trustAnchors.length)

    // Add test certificates if provided
    if (testCertificates.length > 0) {
      console.log('⚠️  Adding', testCertificates.length, 'test certificate(s) to trust list')
      trustAnchors = trustAnchors + '\n' + testCertificates.join('\n')
    }

    console.log('Configuring C2PA trust verification (official trust list only)...')
    const settings: SettingsContext = {
      verify: {
        verifyTrust: true,
        verifyAfterReading: true
      },
      trust: {
        trustAnchors // Official C2PA trust list as a single PEM string
      }
    }

    console.log('Creating reader with trust settings...')

    // Create a reader from the file blob
    const reader = await c2pa.reader.fromBlob(file.type, file, settings)

    if (!reader) {
      throw new Error('No C2PA manifest found in this file')
    }

    console.log('✅ Reader created successfully with trust verification enabled')

    // Get the manifest store
    console.log('Retrieving manifest store...')
    const manifestStore = await reader.manifestStore()

    console.log('✅ Manifest store retrieved with trust validation:', manifestStore)

    // Clean up the reader
    await reader.free()

    return manifestStore
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
