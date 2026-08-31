import { X509Certificate } from '@peculiar/x509'
import type { ParsedCertificateItem, OcspResponseData, OcspBatchSummary } from './types'
import {
  buildOcspRequestDer,
  parseOcspResponseDer,
  generateCurlOcspCommand,
  bufferToBase64,
} from './parser'

/**
 * In-memory client cache keyed by certificate thumbprint / serial number.
 */
const ocspCache = new Map<string, OcspResponseData>()

/**
 * Clear the in-memory OCSP response cache.
 */
export function clearOcspCache(): void {
  ocspCache.clear()
}

/**
 * Determine the candidate OCSP proxy endpoints to use based on environment.
 */
export function getProxyEndpoints(): string[] {
  if (typeof window === 'undefined') return []

  const origin = window.location.origin
  const hostname = window.location.hostname

  // If on netlify domain, prioritize Netlify function
  if (hostname.endsWith('.netlify.app')) {
    return [
      `${origin}/.netlify/functions/ocsp-proxy`,
      `${origin}/api/ocsp-proxy`,
    ]
  }

  // Otherwise (local dev, Vite preview, Cloudtop proxy, custom domain)
  return [
    `${origin}/api/ocsp-proxy`,
    `${origin}/.netlify/functions/ocsp-proxy`,
  ]
}

/**
 * Execute HTTP POST / GET to the OCSP responder with automatic proxy routing and fallback.
 */
async function fetchOcspResponse(
  responderUrl: string,
  requestDer: Uint8Array,
  customProxyUrl?: string
): Promise<Uint8Array> {
  const proxyUrls = customProxyUrl ? [customProxyUrl] : getProxyEndpoints()

  // 1. Try via proxy candidates first (handles CORS and HTTP/HTTPS mixed content in browsers)
  for (const proxyUrl of proxyUrls) {
    try {
      const fullUrl = `${proxyUrl}?url=${encodeURIComponent(responderUrl)}`
      const res = await fetch(fullUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/ocsp-request',
        },
        body: requestDer as unknown as BodyInit,
      })

      if (res.ok) {
        const arrayBuf = await res.arrayBuffer()
        return new Uint8Array(arrayBuf)
      }
    } catch {
      // Proxy candidate failed or unreachable, continue to next candidate
    }
  }

  // 2. Direct browser fetch attempt (works if server sends CORS headers or same-origin)
  try {
    const res = await fetch(responderUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/ocsp-request',
      },
      body: requestDer as unknown as BodyInit,
    })

    if (res.ok) {
      const arrayBuf = await res.arrayBuffer()
      return new Uint8Array(arrayBuf)
    }
    throw new Error(`Responder returned HTTP status ${res.status}`)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Unable to reach OCSP responder directly (CORS/Network restriction): ${msg}`)
  }
}

/**
 * Fetch missing intermediate CA certificate from caIssuers URL if available.
 */
async function fetchCaIssuerCertificate(caIssuersUrl: string): Promise<X509Certificate | null> {
  const proxyUrls = getProxyEndpoints()
  for (const proxyUrl of proxyUrls) {
    try {
      const targetUrl = `${proxyUrl}?url=${encodeURIComponent(caIssuersUrl)}`
      const res = await fetch(targetUrl)
      if (res.ok) {
        const buf = await res.arrayBuffer()
        return new X509Certificate(buf)
      }
    } catch {
      // continue
    }
  }

  try {
    const res = await fetch(caIssuersUrl)
    if (res.ok) {
      const buf = await res.arrayBuffer()
      return new X509Certificate(buf)
    }
  } catch {
    // ignore
  }
  return null
}

/**
 * Query OCSP status for a single certificate item.
 */
export async function checkCertificateOcsp(
  certItem: ParsedCertificateItem,
  options: { forceRefresh?: boolean; proxyUrl?: string } = {}
): Promise<OcspResponseData> {
  const cacheKey = certItem.certThumbprint || certItem.serialNumber

  // Return cached result if available and not forced
  if (!options.forceRefresh && ocspCache.has(cacheKey)) {
    return ocspCache.get(cacheKey)!
  }

  if (!certItem.ocspResponderUrl) {
    const noResp: OcspResponseData = {
      status: 'no_responder',
      errorMessage: 'Certificate does not contain an Authority Information Access (AIA) OCSP responder URL',
      queriedAt: new Date().toISOString(),
    }
    ocspCache.set(cacheKey, noResp)
    return noResp
  }

  try {
    const targetCert = new X509Certificate(certItem.targetCertPem)
    let issuerCert: X509Certificate | null = null

    if (certItem.issuerCertPem) {
      issuerCert = new X509Certificate(certItem.issuerCertPem)
    } else if (certItem.caIssuersUrl) {
      issuerCert = await fetchCaIssuerCertificate(certItem.caIssuersUrl)
    }

    if (!issuerCert) {
      const curlCmd = `curl -i -X GET "${certItem.ocspResponderUrl}"`
      const errResp: OcspResponseData = {
        status: 'error',
        errorMessage: 'Issuer CA certificate is required to construct OCSP request CertID but was not found in chain',
        curlCommand: curlCmd,
        queriedAt: new Date().toISOString(),
      }
      return errResp
    }

    // Build RFC 6960 OCSP Request DER
    const requestDer = await buildOcspRequestDer(targetCert, issuerCert)
    const curlCommand = generateCurlOcspCommand(certItem.ocspResponderUrl, requestDer)

    // Execute network query
    let responseDer: Uint8Array
    try {
      responseDer = await fetchOcspResponse(certItem.ocspResponderUrl, requestDer, options.proxyUrl)
    } catch (networkErr: unknown) {
      const netMsg = networkErr instanceof Error ? networkErr.message : String(networkErr)
      const errResult: OcspResponseData = {
        status: 'error',
        errorMessage: netMsg,
        curlCommand,
        rawResponseBase64: bufferToBase64(requestDer),
        queriedAt: new Date().toISOString(),
      }
      ocspCache.set(cacheKey, errResult)
      return errResult
    }

    // Parse OCSP Response
    const parsedData = parseOcspResponseDer(responseDer)
    parsedData.curlCommand = curlCommand

    ocspCache.set(cacheKey, parsedData)
    return parsedData
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    const failResp: OcspResponseData = {
      status: 'error',
      errorMessage: `Failed to execute OCSP check: ${msg}`,
      queriedAt: new Date().toISOString(),
    }
    ocspCache.set(cacheKey, failResp)
    return failResp
  }
}

/**
 * Concurrently check OCSP status for all eligible certificates with progress reporting.
 */
export async function checkAllCertificatesOcsp(
  certItems: ParsedCertificateItem[],
  options: {
    forceRefresh?: boolean
    onProgress?: (completed: number, total: number) => void
    proxyUrl?: string
  } = {}
): Promise<Map<string, OcspResponseData>> {
  const results = new Map<string, OcspResponseData>()
  const eligible = certItems.filter(c => !!c.ocspResponderUrl)
  const total = eligible.length
  let completed = 0

  if (total === 0) {
    for (const c of certItems) {
      results.set(c.id, {
        status: 'no_responder',
        errorMessage: 'No AIA OCSP URL',
        queriedAt: new Date().toISOString(),
      })
    }
    return results
  }

  // Concurrent execution pool
  const promises = certItems.map(async certItem => {
    const res = await checkCertificateOcsp(certItem, {
      forceRefresh: options.forceRefresh,
      proxyUrl: options.proxyUrl,
    })
    results.set(certItem.id, res)
    if (certItem.ocspResponderUrl) {
      completed++
      options.onProgress?.(completed, total)
    }
  })

  await Promise.all(promises)
  return results
}

/**
 * Compute aggregate summary statistics from a certificate list and OCSP status map.
 */
export function computeOcspBatchSummary(
  certItems: ParsedCertificateItem[],
  statusMap: Map<string, OcspResponseData>,
  isChecking = false
): OcspBatchSummary {
  const totalCertificates = certItems.length
  const withOcspResponder = certItems.filter(c => !!c.ocspResponderUrl).length

  let checkedCount = 0
  let goodCount = 0
  let revokedCount = 0
  let unknownCount = 0
  let errorCount = 0

  for (const c of certItems) {
    const res = statusMap.get(c.id)
    if (!res || res.status === 'pending' || res.status === 'checking') continue

    checkedCount++
    if (res.status === 'good') goodCount++
    else if (res.status === 'revoked') revokedCount++
    else if (res.status === 'unknown') unknownCount++
    else if (res.status === 'error') errorCount++
  }

  return {
    totalCertificates,
    withOcspResponder,
    checkedCount,
    goodCount,
    revokedCount,
    unknownCount,
    errorCount,
    isChecking,
  }
}
