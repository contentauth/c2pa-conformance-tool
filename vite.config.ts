import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// Netlify sets NETLIFY=true automatically — serve from root
// GitHub Pages sets GITHUB_REPOSITORY — serve from /<repo-name>/
// Local dev / unknown — serve from root
const isNetlify = !!process.env.NETLIFY
const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1]
const base = isNetlify ? '/' : (repoName ? `/${repoName}/` : '/')

import http from 'node:http'
import https from 'node:https'
import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { SsrfBlockedError, validateResponderUrl } from './netlify/functions/lib/ssrf-guard'
import { extractOcspRequestFromGetPath, isValidOcspRequest, isValidOcspResponse } from './netlify/functions/lib/ocsp-shape'

// Real OCSP responses are a few KB; this is generous headroom, not a real limit on
// legitimate traffic — see netlify/functions/lib/ssrf-guard.ts for why it exists.
const OCSP_RESPONSE_SIZE_LIMIT_BYTES = 64 * 1024
const OCSP_FETCH_TIMEOUT_MS = 10_000

function corsHeaders(res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD')
}

function sendJsonError(res: ServerResponse, status: number, error: string) {
  res.statusCode = status
  corsHeaders(res)
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ error }))
}

async function ocspProxyMiddleware(req: IncomingMessage, res: ServerResponse) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 200
    corsHeaders(res)
    res.end()
    return
  }

  const urlParam = new URL(req.url || '', 'http://localhost').searchParams.get('url') || ''
  if (!urlParam) {
    sendJsonError(res, 400, 'Missing ?url= parameter')
    return
  }

  // Same two independent checks as the production proxy (netlify/functions/ocsp-proxy.ts):
  // the target address can't be internal/private (SSRF guard), and the traffic itself
  // must actually be shaped like OCSP (RFC 6960), not just arbitrary bytes to an
  // arbitrary-but-public host. Keep this middleware's behavior in sync with that one —
  // it exists so `npm run dev`/`preview` match production, not as a separate design.
  let target: { url: URL; resolvedIp: string }
  try {
    target = await validateResponderUrl(urlParam)
  } catch (err) {
    sendJsonError(res, 400, err instanceof SsrfBlockedError ? err.message : 'Invalid responder URL')
    return
  }

  const chunks: Buffer[] = []
  req.on('data', (chunk) => chunks.push(chunk))
  req.on('end', () => {
    const body = new Uint8Array(Buffer.concat(chunks))
    const isGet = (req.method || 'GET').toUpperCase() === 'GET'

    if (isGet) {
      const embeddedRequest = extractOcspRequestFromGetPath(target.url)
      if (!embeddedRequest || !isValidOcspRequest(embeddedRequest)) {
        sendJsonError(res, 400, 'Responder URL does not contain a valid OCSP request')
        return
      }
    } else if (body.length > 0 && !isValidOcspRequest(body)) {
      sendJsonError(res, 400, 'Request body is not a valid OCSP request')
      return
    }

    console.log(`[OCSP-PROXY] ${req.method} -> ${target.url} (${target.resolvedIp})`)

    const headers: Record<string, string> = {
      'User-Agent': 'C2PA-Conformance-Tool/1.0',
      'Accept': 'application/ocsp-response',
      // The real Host header the origin expects — we connect to the pinned IP below,
      // not this hostname, so this has to be set explicitly.
      'Host': target.url.host,
    }
    if (!isGet && body.length > 0) {
      headers['Content-Type'] = 'application/ocsp-request'
      headers['Content-Length'] = String(body.length)
    }

    const isHttps = target.url.protocol === 'https:'
    const client = isHttps ? https : http

    // Connect to the address resolveSafeIp already validated, not the hostname again —
    // re-resolving here would reopen the DNS-rebinding gap the SSRF guard exists to
    // close. `servername` keeps TLS SNI/certificate hostname validation pointed at the
    // real hostname, so this doesn't weaken HTTPS correctness.
    const proxyReq = client.request(
      {
        protocol: target.url.protocol,
        hostname: target.resolvedIp,
        servername: isHttps ? target.url.hostname : undefined,
        port: target.url.port || (isHttps ? 443 : 80),
        path: target.url.pathname + target.url.search,
        method: req.method || 'GET',
        headers,
        timeout: OCSP_FETCH_TIMEOUT_MS,
      },
      (proxyRes) => {
        const responseChunks: Buffer[] = []
        let total = 0
        let aborted = false

        proxyRes.on('data', (chunk: Buffer) => {
          total += chunk.length
          if (total > OCSP_RESPONSE_SIZE_LIMIT_BYTES) {
            aborted = true
            proxyRes.destroy()
            sendJsonError(res, 502, 'Responder returned a response larger than expected for OCSP')
            return
          }
          responseChunks.push(chunk)
        })

        proxyRes.on('end', () => {
          if (aborted) return
          const responseBody = new Uint8Array(Buffer.concat(responseChunks))
          if (!isValidOcspResponse(responseBody)) {
            sendJsonError(res, 502, 'Responder did not return a valid OCSP response')
            return
          }
          res.statusCode = proxyRes.statusCode || 200
          corsHeaders(res)
          res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'application/ocsp-response')
          res.end(responseBody)
        })
      }
    )

    proxyReq.on('timeout', () => {
      proxyReq.destroy(new Error('Timed out waiting for OCSP responder'))
    })

    proxyReq.on('error', (err) => {
      sendJsonError(res, 502, `Proxy error: ${err.message}`)
    })

    if (body.length > 0) {
      proxyReq.write(body)
    }
    proxyReq.end()
  })
}

function ocspProxyPlugin(): Plugin {
  return {
    name: 'ocsp-proxy-middleware',
    configureServer(server) {
      server.middlewares.use('/api/ocsp-proxy', (req, res) => void ocspProxyMiddleware(req, res))
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/ocsp-proxy', (req, res) => void ocspProxyMiddleware(req, res))
    }
  }
}

export default defineConfig({
  base,
  plugins: [svelte(), ocspProxyPlugin()],
  server: {
    fs: {
      // Allow serving files from wasm directory
      allow: ['..']
    }
  },
  build: {
    target: 'esnext'
  }
})
