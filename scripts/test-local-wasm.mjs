import assert from 'node:assert/strict'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { test } from 'node:test'
import * as wasm from '../public/local-c2pa/c2pa_local.js'

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
    await wasm.default({
      module_or_path: await readFile(new URL('../public/local-c2pa/c2pa_local_bg.wasm', import.meta.url)),
    })
    wasm.init()
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
