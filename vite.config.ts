import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// Netlify sets NETLIFY=true automatically — serve from root
// GitHub Pages sets GITHUB_REPOSITORY — serve from /<repo-name>/
// Local dev / unknown — serve from root
const isNetlify = !!process.env.NETLIFY
const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1]
const base = isNetlify ? '/' : (repoName ? `/${repoName}/` : '/')

import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  SsrfBlockedError,
  validateResponderUrl,
  fetchPinned,
  extractResponderUrlParam,
} from './src/lib/ocsp-proxy/ssrf-guard'
import {
  extractOcspRequestFromGetPath,
  isValidOcspRequest,
  isValidOcspResponse,
} from './src/lib/ocsp-proxy/ocsp-shape'

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

  const urlParam = extractResponderUrlParam(req.url || '')
  if (!urlParam) {
    sendJsonError(res, 400, 'Missing ?url= parameter')
    return
  }

  let target: { url: URL; resolvedIp: string }
  try {
    target = await validateResponderUrl(urlParam)
  } catch (err) {
    sendJsonError(res, 400, err instanceof SsrfBlockedError ? err.message : 'Invalid responder URL')
    return
  }

  const chunks: Buffer[] = []
  req.on('data', (chunk) => chunks.push(chunk))
  req.on('end', async () => {
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
    }
    if (!isGet && body.length > 0) {
      headers['Content-Type'] = 'application/ocsp-request'
    }

    try {
      const response = await fetchPinned(target.url, target.resolvedIp, {
        method: isGet ? 'GET' : 'POST',
        headers,
        body: isGet ? undefined : body,
      })

      if (!isValidOcspResponse(response.body)) {
        sendJsonError(res, 502, 'Responder did not return a valid OCSP response')
        return
      }

      res.statusCode = response.status
      corsHeaders(res)
      res.setHeader('Content-Type', response.contentType)
      res.end(response.body)
    } catch (err) {
      sendJsonError(res, 502, `Proxy error: ${err instanceof Error ? err.message : String(err)}`)
    }
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
