import { createC2pa } from '@contentauth/c2pa-web'
import type { Settings, ValidationStatus } from '@contentauth/c2pa-web'
import { VERSION_INFO } from './version'
import type { ConformanceReport } from './types'
import { VALIDATION_STATUS } from './constants'
import { isCrJson, legacyToCrJson, type CrJson } from './crjson'

type ReaderHandle = {
  manifestStore: () => Promise<CrJson>
  free: () => Promise<void>
}

type C2paInstance = {
  reader: {
    fromBlob: (format: string, file: Blob, settings?: Settings) => Promise<ReaderHandle | null>
  }
  getVersion?: () => Promise<string> | string
}

type LocalC2paModule = {
  default: () => Promise<unknown>
  get_version: () => string
  read_manifest_store: (fileBytes: Uint8Array, format: string, settingsJson?: string) => Promise<string>
}

const importModule = new Function('modulePath', 'return import(modulePath)') as (modulePath: string) => Promise<LocalC2paModule>

let c2paInstance: C2paInstance | null = null
let mainTrustListPem: string | null = null
let itlTrustListPem: string | null = null

// Official C2PA trust list URLs
const TRUST_LIST_URL = 'https://raw.githubusercontent.com/c2pa-org/conformance-public/main/trust-list/C2PA-TRUST-LIST.pem'
const TSA_TRUST_LIST_URL = 'https://raw.githubusercontent.com/c2pa-org/conformance-public/main/trust-list/C2PA-TSA-TRUST-LIST.pem'
// ITL (Interim Trust List) - stored locally, consists of two files
const ITL_ALLOWED_URL = '/trust/allowed.pem'  // leaf certificates
const ITL_ANCHORS_URL = '/trust/anchors.pem'  // root certificates

function toLocalSettingsJson(settings?: Settings): string | undefined {
  if (!settings) {
    return undefined
  }

  const localSettings = {
    verify: {
      verify_after_reading: settings.verify?.verifyAfterReading ?? true,
      verify_trust: settings.verify?.verifyTrust ?? true,
    },
    trust: settings.trust?.trustAnchors
      ? {
          trust_anchors: settings.trust.trustAnchors,
        }
      : undefined,
  }

  return JSON.stringify(localSettings)
}

async function createLocalC2pa(): Promise<C2paInstance | null> {
  try {
    const localModule = await importModule('/local-c2pa/c2pa_local.js')
    await localModule.default()

    return {
      reader: {
        fromBlob: async (format: string, file: Blob, settings?: Settings) => ({
          manifestStore: async () => {
            const fileBytes = new Uint8Array(await file.arrayBuffer())
            const manifestStoreJson = await localModule.read_manifest_store(
              fileBytes,
              format,
              toLocalSettingsJson(settings)
            )
            const parsed = JSON.parse(manifestStoreJson) as CrJson
            if (!isCrJson(parsed)) {
              throw new Error('Local WASM returned non-crJSON format')
            }
            return parsed
          },
          free: async () => {},
        }),
      },
      getVersion: () => localModule.get_version(),
    }
  } catch (error) {
    console.info('Local c2pa-rs wasm not available, using packaged SDK', error)
    return null
  }
}

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
async function initC2pa(): Promise<C2paInstance> {
  if (c2paInstance) {
    return c2paInstance
  }

  try {
    c2paInstance = await createLocalC2pa()

    if (!c2paInstance) {
      const fallbackSdk = await createC2pa({
        wasmSrc: '/c2pa.wasm'
      })

      c2paInstance = {
        reader: {
          fromBlob: async (format: string, file: Blob, settings?: Settings) => {
            const reader = await fallbackSdk.reader.fromBlob(format, file, settings)

            if (!reader) {
              return null
            }

            return {
              manifestStore: async () => {
                const legacy = await reader.manifestStore() as Record<string, unknown>
                return legacyToCrJson(legacy)
              },
              free: async () => {
                await reader.free()
              },
            }
          },
        },
        getVersion: () => '@contentauth/c2pa-web v0.6.1',
      }
    }

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
// Map browser MIME types to SDK-supported equivalents
const MIME_TYPE_MAP: Record<string, string> = {
  'audio/x-m4a': 'audio/mp4',
  'audio/m4a': 'audio/mp4',
  'video/x-m4v': 'video/mp4',
  'video/quicktime': 'video/mp4',
}

export async function processFile(file: File, testCertificates: string[] = []): Promise<ConformanceReport> {
  const mimeType = MIME_TYPE_MAP[file.type] ?? file.type
  console.log('🔍 Starting file processing for:', file.name, 'Type:', file.type, mimeType !== file.type ? `(remapped to ${mimeType})` : '')

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
    const reader1 = await c2pa.reader.fromBlob(mimeType, file, officialSettings)
    if (!reader1) {
      throw new Error('No C2PA manifest found in this file')
    }

    const officialCrJson = await reader1.manifestStore()
    await reader1.free()

    const vr = officialCrJson.validationResults?.activeManifest
    const officialUntrusted = vr?.failure?.some(
      (status: ValidationStatus) => status.code === VALIDATION_STATUS.SIGNING_CREDENTIAL_UNTRUSTED
    )

    console.log('Official TL validation results:', {
      isUntrusted: officialUntrusted,
      success: vr?.success?.map((s: ValidationStatus) => s.code),
      failure: vr?.failure?.map((f: ValidationStatus) => f.code)
    })

    let crJson = officialCrJson
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

      const reader2 = await c2pa.reader.fromBlob(mimeType, file, testSettings)
      if (reader2) {
        const testCrJson = await reader2.manifestStore()
        await reader2.free()

        const testVr = testCrJson.validationResults?.activeManifest
        const testUntrusted = testVr?.failure?.some(
          (status: ValidationStatus) => status.code === VALIDATION_STATUS.SIGNING_CREDENTIAL_UNTRUSTED
        )

        console.log('Test cert validation results:', {
          isUntrusted: testUntrusted,
          success: testVr?.success?.map((s: ValidationStatus) => s.code),
          failure: testVr?.failure?.map((f: ValidationStatus) => f.code)
        })

        if (officialUntrusted && !testUntrusted) {
          console.log('✅ Test certificates made the difference - signature now trusted')
          usedTestCerts = true
          crJson = testCrJson
        } else {
          console.log('ℹ️  Test certificates loaded but not needed for validation')
        }
      }
    }

    const mainVr = crJson.validationResults?.activeManifest
    const isUntrusted = mainVr?.failure?.some(
      (status: ValidationStatus) => status.code === VALIDATION_STATUS.SIGNING_CREDENTIAL_UNTRUSTED
    )

    console.log('Main validation results:', {
      isUntrusted,
      success: mainVr?.success?.map((s: ValidationStatus) => s.code),
      failure: mainVr?.failure?.map((f: ValidationStatus) => f.code)
    })

    let usedITL = false
    let finalCrJson = crJson

    if (isUntrusted) {
      console.log('⚠️  Signature untrusted on main list, checking ITL...')

      const itlSettings: Settings = {
        verify: {
          verifyTrust: true,
          verifyAfterReading: true
        },
        trust: {
          trustAnchors: mainTrustList + '\n' + itl
        }
      }

      const reader2 = await c2pa.reader.fromBlob(mimeType, file, itlSettings)
      if (reader2) {
        const itlCrJson = await reader2.manifestStore()
        await reader2.free()

        const itlVr = itlCrJson.validationResults?.activeManifest
        console.log('ITL validation results:', {
          success: itlVr?.success?.map((s: ValidationStatus) => s.code),
          failure: itlVr?.failure?.map((f: ValidationStatus) => ({ code: f.code, explanation: f.explanation }))
        })

        const itlTrusted = itlVr?.success?.some(
          (status: ValidationStatus) => status.code === VALIDATION_STATUS.SIGNING_CREDENTIAL_TRUSTED
        )
        const itlStillUntrusted = itlVr?.failure?.some(
          (status: ValidationStatus) => status.code === VALIDATION_STATUS.SIGNING_CREDENTIAL_UNTRUSTED
        )

        console.log('ITL validation check:', { itlTrusted, itlStillUntrusted })

        const untrustedFailure = itlVr?.failure?.find(
          (status: ValidationStatus) => status.code === VALIDATION_STATUS.SIGNING_CREDENTIAL_UNTRUSTED
        )
        if (untrustedFailure) {
          console.log('ITL still untrusted, reason:', untrustedFailure.explanation)
        }

        if (itlTrusted && !itlStillUntrusted) {
          console.log('✅ Signature validated by ITL')
          usedITL = true
          finalCrJson = itlCrJson
        } else {
          console.log('❌ Signature still not trusted even with ITL')
        }
      }
    }

    console.log('✅ Manifest store retrieved with trust validation')

    return {
      ...finalCrJson,
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
      const msg = error.message
      if (msg.includes('UnsupportedFormatError') || msg.includes('Unsupported format')) {
        throw new Error(`Unsupported file format (${mimeType}). Supported formats include JPEG, PNG, WebP, AVIF, MP4, MOV, MP3, WAV, and PDF.`)
      }
      if (msg.includes('InvalidAsset') || msg.includes('Box size extends beyond') || msg.includes('box size')) {
        throw new Error(`Could not parse this file. It may be corrupted, use an unsupported codec, or the C2PA manifest may be malformed.`)
      }
      if (msg.includes('NoManifest') || msg.includes('no manifest')) {
        throw new Error(`No C2PA manifest found in this file.`)
      }
      throw new Error(`Failed to process file: ${msg}`)
    }
    throw error
  }
}

/**
 * Get the C2PA library version
 */
export async function getVersion(): Promise<string> {
  const c2pa = await initC2pa()
  const version = await c2pa.getVersion?.()
  return version ?? '@contentauth/c2pa-web v0.6.1'
}
