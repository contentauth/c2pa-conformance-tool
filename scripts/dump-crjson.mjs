// Dump the crJSON the locally-built WASM produces for an asset, for use as a test
// fixture. Requires `npm run build:local-wasm` first.
//
//   node scripts/dump-crjson.mjs <asset> [mime-type] > out.json
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const [assetPath, format = 'image/jpeg'] = process.argv.slice(2)
if (!assetPath) {
  console.error('usage: node scripts/dump-crjson.mjs <asset> [mime-type]')
  process.exit(1)
}

const wasmDir = fileURLToPath(new URL('../public/local-c2pa/', import.meta.url))
const mod = await import(`${wasmDir}c2pa_local.js`)
mod.initSync({ module: readFileSync(`${wasmDir}c2pa_local_bg.wasm`) })

// Same verify settings the app sends, with no trust anchors configured.
const settings = JSON.stringify({
  verify: { verify_after_reading: true, verify_trust: true, remote_manifest_fetch: false },
})
const crjson = JSON.parse(await mod.read_manifest_store(readFileSync(assetPath), format, settings))
// validationTime changes on every run; drop it so fixtures are stable.
for (const m of crjson.manifests ?? []) delete m.validationResults?.validationTime
process.stdout.write(JSON.stringify(crjson, null, 2) + '\n')
