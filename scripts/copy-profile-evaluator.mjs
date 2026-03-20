/**
 * Copies the profile-evaluator-rs wasm-pack pkg from a sibling directory
 * into public/profile-evaluator so the app can load it locally (no runtime
 * dependency on the sibling repo).
 *
 * Prerequisites: profile-evaluator-rs built (wasm-pack build in its ui crate)
 * and available at ../profile-evaluator-rs (sibling of this repo).
 *
 * Usage: npm run copy:profile-evaluator
 */

import { existsSync, mkdirSync, rmSync, cpSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')
const siblingRoot = resolve(repoRoot, '../profile-evaluator-rs')
const outDir = resolve(repoRoot, 'public/profile-evaluator')

// Try ui/pkg first (standard layout), then pkg at repo root
const candidateDirs = [
  resolve(siblingRoot, 'ui/pkg'),
  resolve(siblingRoot, 'pkg'),
]
const sourceDir = candidateDirs.find((d) => existsSync(d))

if (!sourceDir) {
  console.error(
    `Profile evaluator pkg not found. Looked in:\n` +
      candidateDirs.map((d) => `  - ${d}`).join('\n') +
      '\n\nBuild it first in the profile-evaluator-rs repo (e.g. wasm-pack build in ui/ or ./scripts/build-wasm.sh) then run this script.'
  )
  process.exit(1)
}

const requiredFiles = ['profile_evaluator_rs.js', 'profile_evaluator_rs_bg.wasm']
const missing = requiredFiles.filter((f) => !existsSync(resolve(sourceDir, f)))
if (missing.length > 0) {
  console.error(
    `Expected ${missing.join(' and ')} in ${sourceDir}\n` +
      'Ensure wasm-pack build was run in profile-evaluator-rs with the correct crate name.'
  )
  process.exit(1)
}

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
cpSync(sourceDir, outDir, { recursive: true })

// Verify both required files are present in output
const outMissing = requiredFiles.filter((f) => !existsSync(resolve(outDir, f)))
if (outMissing.length > 0) {
  console.error(`Copy failed: missing ${outMissing.join(', ')} in ${outDir}`)
  process.exit(1)
}

console.log(`Profile evaluator copied to ${outDir}`)
console.log(`  - profile_evaluator_rs.js`)
console.log(`  - profile_evaluator_rs_bg.wasm`)
