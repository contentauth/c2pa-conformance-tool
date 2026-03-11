import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')
const wasmDir = resolve(repoRoot, 'wasm')
const c2paRsDir = resolve(repoRoot, '../c2pa-rs')
const outDir = resolve(repoRoot, 'public/local-c2pa')
const cargoHome = resolve(repoRoot, '.cargo-home')

if (!existsSync(c2paRsDir)) {
  console.error(`Expected local c2pa-rs checkout at ${c2paRsDir}`)
  process.exit(1)
}

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
mkdirSync(cargoHome, { recursive: true })

const result = spawnSync(
  'wasm-pack',
  [
    'build',
    wasmDir,
    '--target',
    'web',
    '--release',
    '--out-dir',
    outDir,
    '--out-name',
    'c2pa_local'
  ],
  {
    cwd: repoRoot,
    env: {
      ...process.env,
      CARGO_HOME: cargoHome,
      TMPDIR: '/tmp',
    },
    stdio: 'inherit'
  }
)

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}

console.log(`Local C2PA wasm build is ready at ${outDir}`)
