import { existsSync, mkdirSync, rmSync, unlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')
const wasmDir = resolve(repoRoot, 'wasm')
const c2paRsDir = resolve(repoRoot, 'c2pa-rs')
const outDir = resolve(repoRoot, 'public/local-c2pa')
const cargoHome = resolve(repoRoot, '.cargo-home')

const c2paSdkCargoToml = resolve(repoRoot, 'c2pa-rs/sdk/Cargo.toml')
if (!existsSync(c2paSdkCargoToml)) {
  console.log('Submodule c2pa-rs not checked out. Initializing git submodules...')
  spawnSync('git', ['submodule', 'update', '--init', '--recursive'], {
    cwd: repoRoot,
    stdio: 'inherit'
  })
}

if (!existsSync(c2paSdkCargoToml)) {
  console.error(`Expected local c2pa-rs checkout at ${c2paRsDir}`)
  process.exit(1)
}

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
mkdirSync(cargoHome, { recursive: true })

const wasmPackBin = resolve(repoRoot, 'node_modules/.bin/wasm-pack')
const wasmPackCmd = existsSync(wasmPackBin) ? wasmPackBin : 'wasm-pack'

const result = spawnSync(
  wasmPackCmd,
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

if (result.error) {
  console.error('Failed to spawn wasm-pack:', result.error)
  process.exit(1)
}

if (result.status !== 0) {
  console.error(`wasm-pack exited with status ${result.status}`)
  process.exit(result.status ?? 1)
}

// Remove the wasm-pack generated .gitignore (we use the repo-level .gitignore instead).
const wasmPackGitignore = resolve(outDir, '.gitignore')
if (existsSync(wasmPackGitignore)) {
  unlinkSync(wasmPackGitignore)
}

console.log(`Local C2PA wasm build is ready at ${outDir}`)
