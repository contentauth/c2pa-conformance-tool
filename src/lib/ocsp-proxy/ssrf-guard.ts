/**
 * SSRF guard for the OCSP proxy (netlify/functions/ocsp-proxy.ts and the matching
 * dev-server middleware in vite.config.ts).
 *
 * The proxy exists to fetch an OCSP responder URL taken from an X.509 certificate's
 * Authority Information Access extension. Those responders can be run by any CA at
 * any hostname on the public internet — there is no fixed set of hostnames to allow.
 * What *is* fixed is the set of addresses an OCSP responder should never resolve to:
 * loopback, private/RFC1918, link-local (which includes every major cloud provider's
 * 169.254.169.254 metadata endpoint), and a handful of other reserved ranges. This
 * module rejects those, rather than trying to allowlist hostnames.
 *
 * `resolveSafeIp` also returns the resolved address so the caller can connect to that
 * *exact* IP instead of the hostname again — resolving once for the check and again
 * for the actual connection would leave a DNS-rebinding gap (a hostname the attacker
 * controls can return a safe address for our check, then a different, forbidden one
 * moments later when the HTTP client re-resolves it to connect).
 */
import dns from 'node:dns/promises'
import type { LookupAddress } from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'

// Real OCSP responses are a few KB; this is generous headroom, not a real limit on
// legitimate traffic — it exists so the proxy can't be used to relay/amplify large
// arbitrary bodies from whatever host passed the SSRF check.
export const OCSP_RESPONSE_SIZE_LIMIT_BYTES = 64 * 1024
export const OCSP_FETCH_TIMEOUT_MS = 10_000

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SsrfBlockedError'
  }
}

function isForbiddenIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true // not a well-formed IPv4 literal — fail closed
  }
  const [a, b] = parts
  if (a === 0) return true // "this network" (RFC 791)
  if (a === 10) return true // RFC1918 private
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT (RFC6598)
  if (a === 127) return true // loopback
  if (a === 169 && b === 254) return true // link-local — includes cloud metadata (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true // RFC1918 private
  if (a === 192 && b === 168) return true // RFC1918 private
  if (a === 192 && b === 0) return true // IETF protocol assignments / documentation ranges
  if (a === 198 && (b === 18 || b === 19)) return true // benchmarking (RFC2544)
  if (a === 198 && b === 51) return true // documentation (TEST-NET-2)
  if (a === 203 && b === 0) return true // documentation (TEST-NET-3)
  if (a >= 224) return true // multicast (224-239) + reserved (240-255)
  return false
}

function isForbiddenIPv6(ip: string): boolean {
  const lower = ip.toLowerCase()
  if (lower === '::' || lower === '::1') return true // unspecified / loopback
  // IPv4-mapped/compatible IPv6 (::ffff:a.b.c.d or ::a.b.c.d) — unwrap and check the IPv4 rules.
  const v4Mapped = lower.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/)
  if (v4Mapped) return isForbiddenIPv4(v4Mapped[1])
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) {
    return true // link-local fe80::/10
  }
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true // unique local fc00::/7
  if (lower.startsWith('2001:db8:')) return true // documentation (RFC3849)
  if (lower.startsWith('ff')) return true // multicast
  return false
}

/** Returns true if `ip` (already a literal address, not a hostname) must be blocked. */
export function isForbiddenIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isForbiddenIPv4(ip)
  if (net.isIPv6(ip)) return isForbiddenIPv6(ip)
  return true // couldn't classify it — fail closed
}

/**
 * Resolves `hostname` and throws SsrfBlockedError if it's already a forbidden literal,
 * or every address it resolves to is forbidden. Returns one resolved, permitted address
 * for the caller to connect to directly (see module doc for why that matters).
 */
export async function resolveSafeIp(hostname: string): Promise<string> {
  if (net.isIP(hostname)) {
    if (isForbiddenIp(hostname)) {
      throw new SsrfBlockedError(`Refusing to fetch reserved/private address: ${hostname}`)
    }
    return hostname
  }

  let addresses: LookupAddress[]
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true })
  } catch (err) {
    throw new SsrfBlockedError(
      `Could not resolve host: ${hostname} (${err instanceof Error ? err.message : String(err)})`,
    )
  }

  const safe = addresses.find((a) => !isForbiddenIp(a.address))
  if (!safe) {
    throw new SsrfBlockedError(`Refusing to fetch ${hostname}: no publicly-routable address found`)
  }
  return safe.address
}

/** Validates a caller-supplied responder URL and resolves it to a safe address to connect to. */
export async function validateResponderUrl(rawUrl: string): Promise<{ url: URL; resolvedIp: string }> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new SsrfBlockedError('Malformed responder URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfBlockedError(`Unsupported responder URL scheme: ${url.protocol}`)
  }
  const resolvedIp = await resolveSafeIp(url.hostname)
  return { url, resolvedIp }
}

/**
 * Extracts the `url` query parameter from a raw URL/query string while preserving
 * literal `+` characters in base64-encoded OCSP GET request paths (since URLSearchParams
 * decodes `+` as space per application/x-www-form-urlencoded).
 */
export function extractResponderUrlParam(rawUrlOrSearch: string): string {
  const qIdx = rawUrlOrSearch.indexOf('?')
  if (qIdx !== -1) {
    const query = rawUrlOrSearch.slice(qIdx + 1)
    const match = query.match(/(?:^|&)url=([^&]*)/)
    if (match) {
      return decodeURIComponent(match[1].replace(/\+/g, '%2B'))
    }
  }
  try {
    return new URL(rawUrlOrSearch, 'http://localhost').searchParams.get('url') || ''
  } catch {
    return ''
  }
}

export interface PinnedFetchResult {
  status: number
  contentType: string
  body: Uint8Array
}

/**
 * Fetches `url` with the TCP connection pinned to `resolvedIp` using Node's built-in
 * `node:http` / `node:https` modules (compatible with Node 20 on Netlify Functions).
 * Connecting directly to `resolvedIp` with `Host: url.host` and TLS `servername: url.hostname`
 * prevents DNS rebinding between `resolveSafeIp` and the outbound connection while
 * preserving TLS SNI and certificate hostname verification.
 */
export function fetchPinned(
  url: URL,
  resolvedIp: string,
  init: { method: string; headers: Record<string, string>; body?: Uint8Array },
): Promise<PinnedFetchResult> {
  return new Promise((resolve, reject) => {
    const isHttps = url.protocol === 'https:'
    const client = isHttps ? https : http

    const reqHeaders: Record<string, string> = {
      ...init.headers,
      Host: url.host,
    }
    if (init.body && init.body.byteLength > 0) {
      reqHeaders['Content-Length'] = String(init.body.byteLength)
    }

    const req = client.request(
      {
        protocol: url.protocol,
        hostname: resolvedIp,
        servername: isHttps ? url.hostname : undefined,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: init.method,
        headers: reqHeaders,
        timeout: OCSP_FETCH_TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = []
        let total = 0
        let aborted = false

        res.on('data', (chunk: Buffer) => {
          total += chunk.length
          if (total > OCSP_RESPONSE_SIZE_LIMIT_BYTES) {
            aborted = true
            res.destroy()
            reject(new Error('Responder returned a response larger than expected for OCSP'))
            return
          }
          chunks.push(chunk)
        })

        res.on('end', () => {
          if (aborted) return
          const contentTypeHeader = res.headers['content-type']
          const contentType = Array.isArray(contentTypeHeader)
            ? contentTypeHeader[0]
            : contentTypeHeader || 'application/ocsp-response'
          resolve({
            status: res.statusCode || 200,
            contentType,
            body: new Uint8Array(Buffer.concat(chunks)),
          })
        })

        res.on('error', (err) => {
          if (!aborted) reject(err)
        })
      },
    )

    req.on('timeout', () => {
      req.destroy(new Error('Timed out waiting for OCSP responder'))
    })

    req.on('error', (err) => {
      reject(err)
    })

    if (init.body && init.body.byteLength > 0) {
      req.write(init.body)
    }
    req.end()
  })
}
