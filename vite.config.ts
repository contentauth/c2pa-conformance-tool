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

function ocspProxyMiddleware(req: IncomingMessage, res: ServerResponse) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 200
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD')
    res.end()
    return
  }

  let urlParam = ''
  if (req.url && req.url.includes('?url=')) {
    const rawParam = req.url.slice(req.url.indexOf('?url=') + 5)
    urlParam = decodeURIComponent(rawParam.replace(/\+/g, '%2B'))
  } else {
    urlParam = new URL(req.url || '', 'http://localhost').searchParams.get('url') || ''
  }

  if (!urlParam) {
    res.statusCode = 400
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.end('Missing ?url= parameter')
    return
  }
  console.log(`[OCSP-PROXY] ${req.method} -> ${urlParam}`)

  const chunks: Buffer[] = []
  req.on('data', chunk => chunks.push(chunk))
  req.on('end', () => {
    const body = Buffer.concat(chunks)
    try {
      const targetUrl = new URL(urlParam)
      const isHttps = targetUrl.protocol === 'https:'
      const client = isHttps ? https : http
      const isGet = (req.method || 'GET').toUpperCase() === 'GET'

      const headers: Record<string, string> = {
        'User-Agent': 'C2PA-Conformance-Tool/1.0',
        'Accept': 'application/ocsp-response',
      }
      if (!isGet && body.length > 0) {
        headers['Content-Type'] = 'application/ocsp-request'
        headers['Content-Length'] = String(body.length)
      }

      const proxyReq = client.request(
        targetUrl,
        {
          method: req.method || 'GET',
          headers,
        },
        proxyRes => {
          res.statusCode = proxyRes.statusCode || 200
          res.setHeader('Access-Control-Allow-Origin', '*')
          res.setHeader('Access-Control-Allow-Headers', '*')
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
          res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'application/ocsp-response')
          proxyRes.pipe(res)
        }
      )

      proxyReq.on('error', err => {
        res.statusCode = 502
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.end(`Proxy error: ${err.message}`)
      })

      if (body.length > 0) {
        proxyReq.write(body)
      }
      proxyReq.end()
    } catch (err: unknown) {
      res.statusCode = 400
      res.end(`Invalid URL: ${err instanceof Error ? err.message : String(err)}`)
    }
  })
}

function ocspProxyPlugin(): Plugin {
  return {
    name: 'ocsp-proxy-middleware',
    configureServer(server) {
      server.middlewares.use('/api/ocsp-proxy', ocspProxyMiddleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/ocsp-proxy', ocspProxyMiddleware)
    }
  }
}

export default defineConfig({
  base,
  plugins: [svelte(), ocspProxyPlugin()],
  server: {
    allowedHosts: true,
    fs: {
      // Allow serving files from wasm directory
      allow: ['..']
    }
  },
  preview: {
    allowedHosts: true,
  },
  build: {
    target: 'esnext'
  }
})
