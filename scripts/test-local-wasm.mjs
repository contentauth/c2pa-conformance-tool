import assert from 'node:assert/strict'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { createServer as createViteServer } from 'vite'
import * as wasm from '../public/local-c2pa/c2pa_local.js'

await wasm.default({
  module_or_path: await readFile(new URL('../public/local-c2pa/c2pa_local_bg.wasm', import.meta.url)),
})
wasm.init()

test('compiled WASM honors the live OCSP override and routes requests through the proxy', { timeout: 20_000 }, async () => {
  const asset = await readFile(new URL('../c2pa-rs/sdk/tests/fixtures/ocsp.jpg', import.meta.url))
  assert.ok(asset.includes(Buffer.from('ocspVals')), 'fixture must contain a stapled OCSP response')

  const requests = []
  const server = createServer((req, res) => {
    requests.push(new URL(req.url, 'http://localhost'))
    // Keep this deterministic and offline, including the SDK's failed-fetch path.
    res.writeHead(404)
    res.end()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const endpoint = `http://127.0.0.1:${server.address().port}/api/ocsp-proxy`
  const originalFetch = globalThis.fetch

  try {
    wasm.set_ocsp_proxy_endpoint(endpoint)
    globalThis.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      assert.ok(url.startsWith(`${endpoint}?url=`), `unexpected direct network request: ${url}`)
      return originalFetch(input, init)
    }

    for (const [fetch, override] of [[false, false], [false, true], [true, true]]) {
      requests.length = 0
      const report = JSON.parse(await wasm.read_manifest_store(asset, 'image/jpeg', JSON.stringify({
        verify: {
          verify_trust: false,
          remote_manifest_fetch: false,
          ocsp_fetch: fetch,
          ocsp_fetch_should_override: override,
        },
      })))

      assert.ok(report.manifests.length > 0, 'validation must return crJSON after a failed live fetch')
      if (!override) {
        assert.equal(requests.length, 0, 'disabled fetching must not contact the proxy')
      } else {
        // Override alone must enable fetching: an older SDK that ignores the new
        // setting would make no requests in the [false, true] case.
        assert.ok(requests.length > 0, 'override must trigger a live request despite the staple')
        for (const request of requests) {
          assert.equal(request.pathname, '/api/ocsp-proxy')
          const target = new URL(request.searchParams.get('url'))
          assert.match(target.protocol, /^https?:$/)
          assert.match(target.hostname, /ocsp/)
        }
      }
    }
  } finally {
    globalThis.fetch = originalFetch
    await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()))
  }
})

test('real app trust flow reaches ITL and supplies timestamp anchors', { timeout: 30_000 }, async () => {
  const vite = await createViteServer({
    server: { middlewareMode: true, watch: null, ws: false },
    appType: 'custom',
  })
  const originalFetch = globalThis.fetch
  const proxyRequests = []
  const proxy = createServer((req, res) => {
    proxyRequests.push(req.url)
    res.writeHead(404)
    res.end()
  })
  proxy.listen(0, '127.0.0.1')
  await once(proxy, 'listening')
  const endpoint = `http://127.0.0.1:${proxy.address().port}/api/ocsp-proxy`
  const calls = []

  try {
    const app = await vite.ssrLoadModule('/src/lib/c2pa.ts')
    app._setLocalModuleForTesting({
      ...wasm,
      read_manifest_store: async (bytes, format, settings) => {
        const report = await wasm.read_manifest_store(bytes, format, settings)
        calls.push({ settings: JSON.parse(settings), report: JSON.parse(report) })
        return report
      },
    })
    wasm.set_ocsp_proxy_endpoint(endpoint)
    const unrelatedRoot = await readFile(new URL('../wasm/tests/fixtures/eku/root_cert.pem', import.meta.url), 'utf8')
    const roots = await readFile(new URL('../public/trust/anchors.pem', import.meta.url), 'utf8')
    const allowed = await readFile(new URL('../public/trust/allowed.pem', import.meta.url), 'utf8')
    globalThis.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url.startsWith(`${endpoint}?url=`)) return originalFetch(input, init)
      if (url.endsWith('C2PA-TRUST-LIST.pem') || url.endsWith('C2PA-TSA-TRUST-LIST.pem')) {
        return Promise.resolve(new Response(unrelatedRoot))
      }
      if (url === '/trust/anchors.pem') return Promise.resolve(new Response(roots))
      if (url === '/trust/allowed.pem') return Promise.resolve(new Response(allowed))
      if (url === 'https://sbal.c2pa.org/') return Promise.resolve(Response.json([]))
      throw new Error(`unexpected network request: ${url}`)
    }

    const asset = await readFile(process.env.C2PA_TEST_ASSET
      ?? new URL('../c2pa-rs/sdk/tests/fixtures/ocsp.jpg', import.meta.url))
    const report = await app.processFile(new File([asset], 'itl-test.jpg', { type: 'image/jpeg' }))
    assert.equal(report.usedITL, true, 'app must reach and select ITL validation')
    assert.equal(calls.length, 2, 'official and ITL validation must both run')
    assert.ok(calls[0].report.manifests[0].validationResults.failure.some(s => s.code === 'signingCredential.untrusted'))
    const status = report.manifests[0].validationResults
    assert.ok(status.success.some(s => s.code === 'timeStamp.trusted'), 'ITL roots must support timestamp trust')
    assert.ok(status.success.some(s => s.code === 'signingCredential.trusted'), 'ITL must restore signing trust')
    assert.ok(!status.failure.some(s => ['signingCredential.untrusted', 'signingCredential.expired'].includes(s.code)))
    assert.ok(proxyRequests.length > 0, 'live OCSP must remain enabled')
    for (const call of calls) {
      for (const anchor of call.settings.trust.anchors.filter(a => a.trust_kind === 'tsa')) {
        assert.equal(anchor.allowed_list, undefined, 'private leaf credentials must not grant timestamp trust')
      }
    }

    const modernAsset = await readFile(new URL('../c2pa-rs/sdk/tests/fixtures/C_with_CAWG_data.jpg', import.meta.url))
    const itlSettings = calls[1].settings
    for (const includeTsa of [false, true]) {
      const settings = {
        ...itlSettings,
        trust: {
          ...itlSettings.trust,
          anchors: itlSettings.trust.anchors.filter(a => includeTsa || a.trust_kind !== 'tsa'),
        },
      }
      const result = JSON.parse(await wasm.read_manifest_store(modernAsset, 'image/jpeg', JSON.stringify(settings)))
      const trusted = result.manifests[0].validationResults.success.some(s => s.code === 'timeStamp.trusted')
      assert.equal(trusted, includeTsa, 'modern timestamp trust requires explicit TSA anchors')
    }
  } finally {
    globalThis.fetch = originalFetch
    await vite.close()
    await new Promise((resolve, reject) => proxy.close(err => err ? reject(err) : resolve()))
  }
})
