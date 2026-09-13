import type { Config, Context } from '@netlify/functions'
import { SsrfBlockedError, validateResponderUrl, fetchPinned } from './lib/ssrf-guard'
import { extractOcspRequestFromGetPath, isValidOcspRequest, isValidOcspResponse } from './lib/ocsp-shape'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, HEAD',
}

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

export default async (req: Request, _context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: CORS_HEADERS })
  }

  const urlObj = new URL(req.url)
  const responderUrlParam = urlObj.searchParams.get('url') || req.headers.get('x-ocsp-responder-url')

  if (!responderUrlParam) {
    return jsonError(400, 'Missing responder URL parameter (?url=...)')
  }

  // This proxy exists only to fetch OCSP responders on the caller's behalf — it must
  // never become a generic "fetch any URL, from anywhere" relay. Two independent
  // checks enforce that: the target address can't be internal/private (SSRF guard),
  // and the traffic itself must actually be shaped like OCSP (RFC 6960), not just
  // arbitrary bytes to an arbitrary-but-public host.
  let target: { url: URL; resolvedIp: string }
  try {
    target = await validateResponderUrl(responderUrlParam)
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      return jsonError(400, err.message)
    }
    throw err
  }

  const isGet = req.method === 'GET'
  const requestBytes = isGet ? undefined : new Uint8Array(await req.arrayBuffer())

  if (isGet) {
    const embeddedRequest = extractOcspRequestFromGetPath(target.url)
    if (!embeddedRequest || !isValidOcspRequest(embeddedRequest)) {
      return jsonError(400, 'Responder URL does not contain a valid OCSP request')
    }
  } else if (requestBytes && requestBytes.byteLength > 0 && !isValidOcspRequest(requestBytes)) {
    return jsonError(400, 'Request body is not a valid OCSP request')
  }

  const headers: Record<string, string> = {
    'User-Agent': 'C2PA-Conformance-Tool/1.0',
    'Accept': 'application/ocsp-response',
  }
  if (!isGet && requestBytes && requestBytes.byteLength > 0) {
    headers['Content-Type'] = 'application/ocsp-request'
  }

  try {
    const response = await fetchPinned(target.url, target.resolvedIp, {
      method: isGet ? 'GET' : 'POST',
      headers,
      body: requestBytes,
    })

    const responseBody = new Uint8Array(await response.arrayBuffer())
    if (!isValidOcspResponse(responseBody)) {
      return jsonError(502, 'Responder did not return a valid OCSP response')
    }

    return new Response(responseBody, {
      status: response.status,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': response.headers.get('content-type') || 'application/ocsp-response',
      },
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return jsonError(502, `Failed to proxy OCSP request: ${msg}`)
  }
}

export const config: Config = {
  path: '/api/ocsp-proxy'
}
