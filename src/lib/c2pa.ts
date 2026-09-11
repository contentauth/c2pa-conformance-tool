import { VERSION_INFO } from './version'
import type { ConformanceReport, IcaOcspInfo } from './types'
import { VALIDATION_STATUS } from './constants'
import { isCrJson, legacyToCrJson, getActiveManifestValidationStatus, type CrJson } from './crjson'
import { X509Certificate } from '@peculiar/x509'

// Trust/verify settings passed to the local WASM read functions.
type Settings = {
  verify?: { verifyAfterReading?: boolean; verifyTrust?: boolean }
  trust?: { trustAnchors?: string; allowedList?: string }
  softBindingAlgorithms?: string[]
}

type LocalC2paModule = {
  default: () => Promise<unknown>
  get_version: () => string
  read_manifest_store: (fileBytes: Uint8Array, format: string, settingsJson?: string) => Promise<string>
  read_sidecar_manifest_store?: (
    manifestBytes: Uint8Array,
    assetBytes: Uint8Array,
    assetFormat: string,
    settingsJson?: string,
  ) => Promise<string>
  get_resource_bytes?: (
    fileBytes: Uint8Array,
    format: string,
    uri: string,
    settingsJson?: string,
  ) => Promise<Uint8Array>
  set_ocsp_proxy_endpoint?: (url: string) => void
  extract_manifest_certificates?: (
    fileBytes: Uint8Array,
    format: string,
    settingsJson?: string,
  ) => Promise<string>
  extract_sidecar_manifest_certificates?: (
    manifestBytes: Uint8Array,
    assetBytes: Uint8Array,
    assetFormat: string,
    settingsJson?: string,
  ) => Promise<string>
  check_ica_ocsp?: (
    icaPem: string,
    rootsPem: string,
  ) => Promise<string>
}

type ExtractedCrJsonResult = {
  crJson: CrJson
  usedITL: boolean
  usedTestCerts: boolean
  icaOcsp?: Record<string, IcaOcspInfo>
}

const importModule = new Function('modulePath', 'return import(modulePath)') as (modulePath: string) => Promise<LocalC2paModule>

type ITL = { allowed: string; anchors: string }

let c2paInstance: C2paInstance | null = null
let mainTrustListPem: string | null = null
let itl: ITL | null = null
let softBindingAlgorithms: string[] | null = null

// Official C2PA trust list URLs
const TRUST_LIST_URL = 'https://raw.githubusercontent.com/c2pa-org/conformance-public/main/trust-list/C2PA-TRUST-LIST.pem'
const TSA_TRUST_LIST_URL = 'https://raw.githubusercontent.com/c2pa-org/conformance-public/main/trust-list/C2PA-TSA-TRUST-LIST.pem'
// C2PA soft binding algorithm registry (canonical URL, redirects to latest JSON).
// Its 301 response doesn't send Access-Control-Allow-Origin, so browsers block the
// redirect before it ever reaches GitHub (see #48) — the correct fix is for the
// sbal.c2pa.org hosting platform to add CORS headers to that redirect response.
// Until that's fixed upstream, fall back to fetching the redirect target directly.
const SOFT_BINDING_REGISTRY_URL = 'https://sbal.c2pa.org/'
const SOFT_BINDING_REGISTRY_FALLBACK_URL =
  'https://raw.githubusercontent.com/c2pa-org/specifications/main/supplemental-ui/softbinding-alg-list/softbinding-algorithm-list.json'
// ITL (Interim Trust List) - stored locally; use base URL for deployed (e.g. GitHub Pages)
const base = typeof import.meta.env?.BASE_URL === 'string' ? import.meta.env.BASE_URL : '/'
const ITL_ALLOWED_URL = `${base}trust/allowed.pem`   // leaf certificates
const ITL_ANCHORS_URL = `${base}trust/anchors.pem`   // root certificates

function toLocalSettingsJson(settings?: Settings): string {
  const localSettings = {
    verify: {
      verify_after_reading: settings?.verify?.verifyAfterReading ?? true,
      verify_trust: settings?.verify?.verifyTrust ?? true,
      ocsp_fetch: true,
    },
    trust: (settings?.trust?.trustAnchors || settings?.trust?.allowedList)
      ? {
          ...(settings?.trust?.trustAnchors ? { trust_anchors: settings.trust.trustAnchors } : {}),
          ...(settings?.trust?.allowedList ? { allowed_list: settings.trust.allowedList } : {}),
        }
      : undefined,
    ...(settings?.softBindingAlgorithms?.length
      ? { soft_binding: { soft_binding_algorithms: settings.softBindingAlgorithms } }
      : {}),
  }

  return JSON.stringify(localSettings)
}

// ── Local WASM instance ───────────────────────────────────────────────────────

type C2paInstance = {
  module: LocalC2paModule
  reader: {
    fromBlob: (format: string, file: Blob, settings?: Settings) => Promise<ReaderHandle | null>
    fromSidecarAndBlob?: (
      sidecarBytes: Uint8Array,
      assetFormat: string,
      assetFile: Blob,
      settings?: Settings,
    ) => Promise<ReaderHandle | null>
  }
  getVersion: () => string
  extractCertificates?: (format: string, file: Blob, settings?: Settings) => Promise<any>
  extractSidecarCertificates?: (
    sidecarBytes: Uint8Array,
    assetFormat: string,
    assetFile: Blob,
    settings?: Settings,
  ) => Promise<any>
  checkIcaOcsp?: (icaPem: string, rootsPem: string) => Promise<IcaOcspInfo>
}

type ReaderHandle = {
  manifestStore: () => Promise<CrJson>
  free: () => Promise<void>
}

// Test-only escape hatch: set to bypass the probe+import path.
let _overrideLocalModule: LocalC2paModule | null = null

export function _setLocalModuleForTesting(mod: LocalC2paModule | null): void {
  _overrideLocalModule = mod
  c2paInstance = null
}

function buildC2paFromModule(localModule: LocalC2paModule): C2paInstance {
  const parseCrJson = (raw: string): CrJson => {
    const parsed = JSON.parse(raw) as CrJson
    if (!isCrJson(parsed)) {
      throw new Error('Local WASM returned non-crJSON format')
    }
    return parsed
  }

  return {
    module: localModule,
    reader: {
      fromBlob: async (format: string, file: Blob, settings?: Settings) => ({
        manifestStore: async () => {
          const fileBytes = new Uint8Array(await file.arrayBuffer())
          const json = await localModule.read_manifest_store(
            fileBytes,
            format,
            toLocalSettingsJson(settings),
          )
          return parseCrJson(json)
        },
        free: async () => {},
      }),
      ...(typeof localModule.read_sidecar_manifest_store === 'function'
        ? {
            fromSidecarAndBlob: async (
              sidecarBytes: Uint8Array,
              assetFormat: string,
              assetFile: Blob,
              settings?: Settings,
            ) => ({
              manifestStore: async () => {
                const assetBytes = new Uint8Array(await assetFile.arrayBuffer())
                const json = await localModule.read_sidecar_manifest_store!(
                  sidecarBytes,
                  assetBytes,
                  assetFormat,
                  toLocalSettingsJson(settings),
                )
                return parseCrJson(json)
              },
              free: async () => {},
            }),
          }
        : {}),
    },
    getVersion: () => localModule.get_version(),
    ...(typeof localModule.extract_manifest_certificates === 'function'
      ? {
          extractCertificates: async (format: string, file: Blob, settings?: Settings) => {
            const fileBytes = new Uint8Array(await file.arrayBuffer())
            const json = await localModule.extract_manifest_certificates!(
              fileBytes,
              format,
              toLocalSettingsJson(settings),
            )
            return JSON.parse(json)
          },
        }
      : {}),
    ...(typeof localModule.extract_sidecar_manifest_certificates === 'function'
      ? {
          extractSidecarCertificates: async (
            sidecarBytes: Uint8Array,
            assetFormat: string,
            assetFile: Blob,
            settings?: Settings,
          ) => {
            const assetBytes = new Uint8Array(await assetFile.arrayBuffer())
            const json = await localModule.extract_sidecar_manifest_certificates!(
              sidecarBytes,
              assetBytes,
              assetFormat,
              toLocalSettingsJson(settings),
            )
            return JSON.parse(json)
          },
        }
      : {}),
    ...(typeof localModule.check_ica_ocsp === 'function'
      ? {
          checkIcaOcsp: async (icaPem: string, rootsPem: string): Promise<IcaOcspInfo> => {
            const json = await localModule.check_ica_ocsp!(icaPem, rootsPem)
            return JSON.parse(json) as IcaOcspInfo
          },
        }
      : {}),
  }
}

async function createLocalC2pa(): Promise<C2paInstance | null> {
  if (_overrideLocalModule) {
    return buildC2paFromModule(_overrideLocalModule)
  }

  try {
    const moduleUrl = `${base}local-c2pa/c2pa_local.js`
    const probe = await fetch(moduleUrl, { method: 'HEAD' })
    const contentType = probe.headers.get('content-type') ?? ''
    if (!probe.ok || (!contentType.includes('javascript') && !contentType.includes('ecmascript'))) {
      return null
    }

    const localModule = await importModule(moduleUrl)
    await localModule.default()

    if (typeof localModule.set_ocsp_proxy_endpoint === 'function') {
      const origin = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : ''
      if (origin) {
        localModule.set_ocsp_proxy_endpoint(`${origin}/api/ocsp-proxy`)
      }
    }

    return buildC2paFromModule(localModule)
  } catch (error) {
    console.info('Local c2pa-rs WASM not available:', error)
    return null
  }
}

async function initC2pa(): Promise<C2paInstance> {
  if (c2paInstance) {
    return c2paInstance
  }

  const instance = await createLocalC2pa()
  if (!instance) {
    throw new Error('Local c2pa-rs WASM not available. Run `npm run build:local-wasm` to build it.')
  }

  c2paInstance = instance
  return c2paInstance
}

// ── Trust list fetching ───────────────────────────────────────────────────────

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
 * The ITL consists of two files with distinct roles:
 * - allowed.pem: end-entity (leaf) certificates → SDK allowedList
 * - anchors.pem: root CA certificates → SDK trustAnchors
 */
async function fetchITL(): Promise<ITL> {
  if (itl) {
    return itl
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

    itl = { allowed, anchors }
    console.log('✅ Loaded ITL (Interim Trust List) - allowed.pem (leaf certs) + anchors.pem (root CAs)')
    return itl
  } catch (error) {
    console.error('Failed to fetch ITL:', error)
    throw new Error('Failed to fetch ITL')
  }
}

async function fetchSoftBindingAlgorithms(): Promise<string[]> {
  if (softBindingAlgorithms) {
    return softBindingAlgorithms
  }

  for (const url of [SOFT_BINDING_REGISTRY_URL, SOFT_BINDING_REGISTRY_FALLBACK_URL]) {
    try {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`Failed to fetch soft binding registry: ${response.status} ${response.statusText}`)
      }
      const entries = await response.json() as Array<{ alg?: string }>
      softBindingAlgorithms = entries.flatMap((e) => (e.alg ? [e.alg] : []))
      console.log(`✅ Loaded soft binding registry from ${url} (${softBindingAlgorithms.length} algorithms)`)
      return softBindingAlgorithms
    } catch (error) {
      console.warn(`Failed to fetch soft binding registry from ${url}:`, error)
    }
  }

  console.warn('Failed to fetch soft binding registry from all sources; soft binding validation may report unsupported algorithms')
  return []
}

export const _fetchSoftBindingAlgorithmsForTesting = fetchSoftBindingAlgorithms

export function _resetSoftBindingCacheForTesting(): void {
  softBindingAlgorithms = null
}

// ── MIME / file type helpers ──────────────────────────────────────────────────

const MIME_TYPE_MAP: Record<string, string> = {
  'audio/x-m4a': 'audio/mp4',
  'audio/m4a': 'audio/mp4',
  'video/x-m4v': 'video/mp4',
  'video/quicktime': 'video/mp4',
  'image/dng': 'image/x-adobe-dng',
}

const EXTENSION_MIME_MAP: Record<string, string> = {
  'heic': 'image/heic',
  'heif': 'image/heif',
  'avci': 'image/avci',
  'avcs': 'image/avcs',
  'dng': 'image/x-adobe-dng',
  'arw': 'image/x-sony-arw',
  'cr2': 'image/x-canon-cr2',
  'cr3': 'image/x-canon-cr3',
  'nef': 'image/x-nikon-nef',
  'orf': 'image/x-olympus-orf',
  'rw2': 'image/x-panasonic-rw2',
  'c2pa': 'application/c2pa',
}

export const SIDECAR_MIME = 'application/c2pa'

export function isSidecarFile(file: File): boolean {
  if (file.type === SIDECAR_MIME) return true
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return ext === 'c2pa'
}

export function resolveMimeType(file: File): string {
  const mapped = MIME_TYPE_MAP[file.type]
  if (mapped) return mapped
  if (file.type && file.type !== 'application/octet-stream') return file.type
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return EXTENSION_MIME_MAP[ext] ?? file.type
}

// ── Thumbnail enrichment ──────────────────────────────────────────────────────

/**
 * Resolve unresolved JUMBF `identifier` URIs in thumbnail assertions to inline
 * base64 `data` fields. Uses the local WASM's `get_resource_bytes` when
 * available; silently skips when not.
 */
async function enrichThumbnailsViaWasm(
  crJson: CrJson,
  fileBytes: Uint8Array,
  format: string,
  localModule: LocalC2paModule,
): Promise<void> {
  if (typeof localModule.get_resource_bytes !== 'function') return

  const resourceToBytes = async (uri: string): Promise<Uint8Array> => {
    return localModule.get_resource_bytes!(fileBytes, format, uri, undefined)
  }

  await enrichThumbnails(crJson, resourceToBytes)
}

async function enrichThumbnails(
  crJson: CrJson,
  resourceToBytes: (uri: string) => Promise<Uint8Array>,
): Promise<void> {
  for (const manifest of (crJson.manifests ?? [])) {
    const assertions = (manifest.assertions ?? {}) as Record<string, Record<string, unknown>>
    for (const [key, assertion] of Object.entries(assertions)) {
      if (!assertion || typeof assertion !== 'object') continue

      const targets: Array<Record<string, unknown>> = []
      if (key.startsWith('c2pa.thumbnail')) {
        targets.push(assertion)
      } else if (key.startsWith('c2pa.ingredient')) {
        const thumb = assertion.thumbnail as Record<string, unknown> | undefined
        if (thumb && typeof thumb === 'object') targets.push(thumb)
      }

      for (const target of targets) {
        if (target.data) continue
        const identifier = target.identifier
        if (typeof identifier !== 'string') continue
        try {
          const bytes = await resourceToBytes(identifier)
          const chunkSize = 8192
          let binary = ''
          for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
          }
          target.data = `b64'${btoa(binary)}'`
        } catch {
          // Non-fatal: skip thumbnails we can't resolve
        }
      }
    }
  }
}

// ── Trust validation flow ─────────────────────────────────────────────────────

type ReadManifestStore = (settings: Settings) => Promise<CrJson | null>

/**
 * Three-step trust validation flow, independent of how bytes are sourced:
 *
 *   1. Official C2PA trust list.
 *   2. + Session-only test certificates, if they change the outcome.
 *   3. + ITL (Interim Trust List), as a last-resort fallback.
 */
async function runTrustValidationFlow(
  readManifestStore: ReadManifestStore,
  testCertificates: string[],
  noManifestErrorMessage: string,
): Promise<ExtractedCrJsonResult> {
  console.log('Fetching official C2PA trust lists and soft binding registry...')
  const [mainTrustList, itlData, softBindingAlgs] = await Promise.all([
    fetchMainTrustList(),
    fetchITL(),
    fetchSoftBindingAlgorithms(),
  ])

  console.log('Step 1: Validating with official trust list only...')
  const officialSettings: Settings = {
    verify: { verifyTrust: true, verifyAfterReading: true },
    trust: { trustAnchors: mainTrustList },
    softBindingAlgorithms: softBindingAlgs,
  }

  const officialCrJson = await readManifestStore(officialSettings)
  if (!officialCrJson) {
    throw new Error(noManifestErrorMessage)
  }

  console.log('📋 Raw crJSON keys:', Object.keys(officialCrJson))
  console.log('📋 validationResults:', JSON.stringify(officialCrJson.validationResults ?? null))
  console.log('📋 manifests[0] vr:', JSON.stringify((officialCrJson.manifests?.[0] as Record<string, unknown>)?.validationResults ?? null))

  const officialVr = getActiveManifestValidationStatus(officialCrJson)
  const officialUntrusted = officialVr?.failure?.some(
    (status) => status.code === VALIDATION_STATUS.SIGNING_CREDENTIAL_UNTRUSTED
  )

  console.log('Official TL validation results:', {
    isUntrusted: officialUntrusted,
    success: officialVr?.success?.map((s) => s.code),
    failure: officialVr?.failure?.map((f) => f.code)
  })

  let crJson = officialCrJson
  let usedTestCerts = false

  if (testCertificates.length > 0) {
    console.log('Step 2: Validating with test certificates added...')
    const testSettings: Settings = {
      verify: { verifyTrust: true, verifyAfterReading: true },
      trust: { trustAnchors: mainTrustList + '\n' + testCertificates.join('\n') },
      softBindingAlgorithms: softBindingAlgs,
    }

    const testCrJson = await readManifestStore(testSettings)
    if (testCrJson) {
      const testVr = getActiveManifestValidationStatus(testCrJson)
      const testUntrusted = testVr?.failure?.some(
        (status) => status.code === VALIDATION_STATUS.SIGNING_CREDENTIAL_UNTRUSTED
      )

      console.log('Test cert validation results:', {
        isUntrusted: testUntrusted,
        success: testVr?.success?.map((s) => s.code),
        failure: testVr?.failure?.map((f) => f.code)
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

  const mainVr = getActiveManifestValidationStatus(crJson)
  const isUntrusted = mainVr?.failure?.some(
    (status) => status.code === VALIDATION_STATUS.SIGNING_CREDENTIAL_UNTRUSTED
  )

  console.log('Main validation results:', {
    isUntrusted,
    success: mainVr?.success?.map((s) => s.code),
    failure: mainVr?.failure?.map((f) => f.code)
  })

  let usedITL = false
  let finalCrJson = crJson

  if (isUntrusted) {
    console.log('⚠️  Signature untrusted on main list, checking ITL...')

    const itlSettings: Settings = {
      verify: { verifyTrust: true, verifyAfterReading: true },
      trust: {
        trustAnchors: mainTrustList + '\n' + itlData.anchors,
        allowedList: itlData.allowed,
      },
      softBindingAlgorithms: softBindingAlgs,
    }

    const itlCrJson = await readManifestStore(itlSettings)
    if (itlCrJson) {
      const itlVr = getActiveManifestValidationStatus(itlCrJson)
      console.log('ITL validation results:', {
        success: itlVr?.success?.map((s) => s.code),
        failure: itlVr?.failure?.map((f) => ({ code: f.code, explanation: f.explanation }))
      })

      const itlTrusted = itlVr?.success?.some(
        (status) => status.code === VALIDATION_STATUS.SIGNING_CREDENTIAL_TRUSTED
      )
      const itlStillUntrusted = itlVr?.failure?.some(
        (status) => status.code === VALIDATION_STATUS.SIGNING_CREDENTIAL_UNTRUSTED
      )

      console.log('ITL validation check:', { itlTrusted, itlStillUntrusted })
      if (itlStillUntrusted) {
        const untrustedFailure = itlVr?.failure?.find(
          (status) => status.code === VALIDATION_STATUS.SIGNING_CREDENTIAL_UNTRUSTED
        )
        console.log('ITL still untrusted, reason:', untrustedFailure?.explanation)
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
    crJson: finalCrJson,
    usedITL,
    usedTestCerts,
  }
}

/**
 * Sideband check: verify live OCSP status for each manifest's Issuing CA (ICA).
 * Evaluates active manifest and all ingredients in the lineage against loaded trust anchors.
 */
async function checkLineageIcaOcsp(
  c2pa: C2paInstance,
  fileBytes: Uint8Array,
  mimeType: string,
  allRootsPem: string,
  sidecarBytes?: Uint8Array,
): Promise<Record<string, IcaOcspInfo>> {
  if (!c2pa.module.check_ica_ocsp) {
    return {}
  }

  try {
    let certsJson: string | undefined
    if (sidecarBytes && typeof c2pa.module.extract_sidecar_manifest_certificates === 'function') {
      certsJson = await c2pa.module.extract_sidecar_manifest_certificates(sidecarBytes, fileBytes, mimeType, undefined)
    } else if (typeof c2pa.module.extract_manifest_certificates === 'function') {
      certsJson = await c2pa.module.extract_manifest_certificates(fileBytes, mimeType, undefined)
    }

    if (!certsJson) return {}

    const extracted = JSON.parse(certsJson) as {
      manifests?: Record<string, { cert_chain_pem?: string; common_name?: string }>
    }

    const icaResults: Record<string, IcaOcspInfo> = {}
    if (!extracted.manifests) return icaResults

    for (const [label, manifestData] of Object.entries(extracted.manifests)) {
      if (!manifestData.cert_chain_pem) continue

      const pems = manifestData.cert_chain_pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) || []
      if (pems.length < 2) {
        continue
      }

      const icaPem = pems[1]
      try {
        const icaCert = new X509Certificate(icaPem)
        const icaSubjectCn = icaCert.subject.match(/CN=([^,]+)/)?.[1] ?? icaCert.subject
        const icaIssuerCn = icaCert.issuer.match(/CN=([^,]+)/)?.[1] ?? icaCert.issuer

        const rawRes = await c2pa.module.check_ica_ocsp(icaPem, allRootsPem)
        const res = JSON.parse(rawRes) as Record<string, any>

        const info: IcaOcspInfo = {
          status: res.status,
          responderUrl: res.responder_url ?? res.responderUrl,
          serialNumber: res.serial_number ?? res.serialNumber,
          thisUpdate: res.this_update ?? res.thisUpdate,
          nextUpdate: res.next_update ?? res.nextUpdate,
          icaSubjectCn,
          icaIssuerCn,
        }
        const revokedAt = res.revoked_at ?? res.revokedAt
        if (revokedAt) {
          info.revokedAt = revokedAt
        }
        const revocationReason = res.revocation_reason ?? res.revocationReason
        if (revocationReason) {
          info.revocationReason = revocationReason
        }
        icaResults[label] = info
      } catch (err) {
        console.warn(`Failed to check ICA OCSP for manifest ${label}:`, err)
      }
    }

    return icaResults
  } catch (err) {
    console.warn('Failed to extract certificates or check ICA OCSP:', err)
    return {}
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

async function extractCrJsonWithMetadata(file: File, testCertificates: string[] = []): Promise<ExtractedCrJsonResult> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'json' || file.type === 'application/json') {
    throw new Error('JSON files are not supported. Uploading a raw crJSON report would let its contents (including trust/validation status) be displayed without any cryptographic verification.')
  }

  const mimeType = resolveMimeType(file)
  console.log('🔍 Starting file processing for:', file.name, 'Type:', file.type, mimeType !== file.type ? `(remapped to ${mimeType})` : '')

  console.log('Initializing C2PA SDK...')
  const c2pa = await initC2pa()
  console.log('✅ C2PA SDK initialized')

  const readManifestStore: ReadManifestStore = async (settings) => {
    const reader = await c2pa.reader.fromBlob(mimeType, file, settings)
    if (!reader) return null
    try {
      const crJson = await reader.manifestStore()
      const fileBytes = new Uint8Array(await file.arrayBuffer())
      await enrichThumbnailsViaWasm(crJson, fileBytes, mimeType, c2pa.module)
      return crJson
    } finally {
      await reader.free()
    }
  }

  try {
    const result = await runTrustValidationFlow(
      readManifestStore,
      testCertificates,
      mimeType === SIDECAR_MIME
        ? 'No C2PA manifest could be read from this sidecar. It may be corrupted or not a valid .c2pa file.'
        : 'No C2PA manifest found in this file',
    )

    try {
      const [mainTrustList, itlData] = await Promise.all([
        fetchMainTrustList(),
        fetchITL(),
      ])
      const allRootsPem = mainTrustList + '\n' + itlData.anchors + (testCertificates.length > 0 ? '\n' + testCertificates.join('\n') : '')
      const fileBytes = new Uint8Array(await file.arrayBuffer())
      const icaOcsp = await checkLineageIcaOcsp(c2pa, fileBytes, mimeType, allRootsPem)
      result.icaOcsp = icaOcsp

      // If any ICA is revoked, mark that manifest untrusted per C2PA specification
      for (const [label, icaInfo] of Object.entries(icaOcsp)) {
        if (icaInfo.status === 'revoked') {
          const manifest = result.crJson.manifests?.find((m) => m.label === label)
          if (manifest) {
            const vr = (manifest.validationResults = manifest.validationResults || { failure: [], success: [], informational: [] })
            vr.failure = vr.failure || []
            vr.failure.push({
              code: VALIDATION_STATUS.SIGNING_CREDENTIAL_UNTRUSTED,
              explanation: `Issuing CA (${icaInfo.icaSubjectCn || 'ICA'}) revoked via live OCSP`
            })
          }
          if (result.crJson.active_manifest === label || result.crJson.manifests?.[0]?.label === label) {
            if (result.crJson.validationResults) {
              result.crJson.validationResults.failure = result.crJson.validationResults.failure || []
              result.crJson.validationResults.failure.push({
                code: VALIDATION_STATUS.SIGNING_CREDENTIAL_UNTRUSTED,
                explanation: `Active manifest Issuing CA (${icaInfo.icaSubjectCn || 'ICA'}) revoked via live OCSP`
              })
            }
          }
        }
      }
    } catch (icaErr) {
      console.warn('ICA OCSP sideband check failed non-fatally:', icaErr)
    }

    return result
  } catch (error) {
    console.error('❌ Error in processFile:', error)
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes('UnsupportedFormatError') || msg.includes('Unsupported format')) {
      throw new Error(`Unsupported file format (${mimeType}). Supported formats include JPEG, PNG, WebP, AVIF, MP4, MOV, MP3, WAV, and PDF.`)
    }
    if (msg.includes('InvalidAsset') || msg.includes('Box size extends beyond') || msg.includes('box size')) {
      throw new Error(`Could not parse this file. It may be corrupted, use an unsupported codec, or the C2PA manifest may be malformed.`)
    }
    if (msg.includes('NoManifest') || msg.includes('no manifest') || msg.includes('No C2PA manifest') || msg.includes('no JUMBF data')) {
      throw new Error(`No C2PA manifest found in this file.`)
    }
    throw new Error(`Failed to process file: ${msg}`)
  }
}

export async function extractCrJson(file: File, testCertificates: string[] = []): Promise<CrJson> {
  const { crJson } = await extractCrJsonWithMetadata(file, testCertificates)
  return crJson
}

function buildConformanceReport(extracted: ExtractedCrJsonResult): ConformanceReport {
  return {
    ...extracted.crJson,
    usedITL: extracted.usedITL,
    usedTestCerts: extracted.usedTestCerts,
    _icaOcsp: extracted.icaOcsp,
    _conformanceToolVersion: {
      commit: VERSION_INFO.sha,
      shortCommit: VERSION_INFO.shortSha,
      date: VERSION_INFO.date,
      branch: VERSION_INFO.branch,
      generatedAt: VERSION_INFO.timestamp
    }
  }
}

export async function processFile(file: File, testCertificates: string[] = []): Promise<ConformanceReport> {
  return buildConformanceReport(await extractCrJsonWithMetadata(file, testCertificates))
}

async function extractSidecarWithAssetCrJsonWithMetadata(
  sidecar: File,
  asset: File,
  testCertificates: string[] = [],
): Promise<ExtractedCrJsonResult> {
  const c2pa = await initC2pa()
  const fromSidecarAndBlob = c2pa.reader.fromSidecarAndBlob
  if (!fromSidecarAndBlob) {
    throw new Error('read_sidecar_manifest_store is not available in the local WASM build.')
  }

  const assetMimeType = resolveMimeType(asset)
  const sidecarBytes = new Uint8Array(await sidecar.arrayBuffer())

  const readManifestStore: ReadManifestStore = async (settings) => {
    const reader = await fromSidecarAndBlob(sidecarBytes, assetMimeType, asset, settings)
    if (!reader) return null
    try {
      const crJson = await reader.manifestStore()
      const assetBytes = new Uint8Array(await asset.arrayBuffer())
      await enrichThumbnailsViaWasm(crJson, assetBytes, assetMimeType, c2pa.module)
      return crJson
    } finally {
      await reader.free()
    }
  }

  try {
    const result = await runTrustValidationFlow(
      readManifestStore,
      testCertificates,
      `No C2PA manifest could be read from sidecar "${sidecar.name}" paired with "${asset.name}".`,
    )

    try {
      const [mainTrustList, itlData] = await Promise.all([
        fetchMainTrustList(),
        fetchITL(),
      ])
      const allRootsPem = mainTrustList + '\n' + itlData.anchors + (testCertificates.length > 0 ? '\n' + testCertificates.join('\n') : '')
      const assetBytes = new Uint8Array(await asset.arrayBuffer())
      const icaOcsp = await checkLineageIcaOcsp(c2pa, assetBytes, assetMimeType, allRootsPem, sidecarBytes)
      result.icaOcsp = icaOcsp

      // If any ICA is revoked, mark that manifest untrusted per C2PA specification
      for (const [label, icaInfo] of Object.entries(icaOcsp)) {
        if (icaInfo.status === 'revoked') {
          const manifest = result.crJson.manifests?.find((m) => m.label === label)
          if (manifest) {
            const vr = (manifest.validationResults = manifest.validationResults || { failure: [], success: [], informational: [] })
            vr.failure = vr.failure || []
            vr.failure.push({
              code: VALIDATION_STATUS.SIGNING_CREDENTIAL_UNTRUSTED,
              explanation: `Issuing CA (${icaInfo.icaSubjectCn || 'ICA'}) revoked via live OCSP`
            })
          }
          if (result.crJson.active_manifest === label || result.crJson.manifests?.[0]?.label === label) {
            if (result.crJson.validationResults) {
              result.crJson.validationResults.failure = result.crJson.validationResults.failure || []
              result.crJson.validationResults.failure.push({
                code: VALIDATION_STATUS.SIGNING_CREDENTIAL_UNTRUSTED,
                explanation: `Active manifest Issuing CA (${icaInfo.icaSubjectCn || 'ICA'}) revoked via live OCSP`
              })
            }
          }
        }
      }
    } catch (icaErr) {
      console.warn('ICA OCSP sideband check failed non-fatally:', icaErr)
    }

    return result
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes('HashMismatch') || msg.includes('dataHash') || msg.includes('bmffHash')) {
      throw new Error(
        `Asset hash mismatch: the sidecar's hash bindings don't match "${asset.name}". ` +
        `The sidecar and asset are probably not a matched pair.`,
      )
    }
    throw error
  }
}

export async function processSidecarWithAsset(
  sidecar: File,
  asset: File,
  testCertificates: string[] = [],
): Promise<ConformanceReport> {
  return buildConformanceReport(
    await extractSidecarWithAssetCrJsonWithMetadata(sidecar, asset, testCertificates),
  )
}

export async function getVersion(): Promise<string> {
  const c2pa = await initC2pa()
  return c2pa.getVersion()
}

export async function extractCertificatesForFile(file: File): Promise<any> {
  const c2pa = await initC2pa()
  const mime = resolveMimeType(file)
  if (isSidecarFile(file)) {
    return null
  }
  return c2pa.extractCertificates ? c2pa.extractCertificates(mime, file) : null
}

