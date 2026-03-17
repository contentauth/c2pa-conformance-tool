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
const sourceDir = resolve(repoRoot, '../profile-evaluator-rs/ui/pkg')
const outDir = resolve(repoRoot, 'public/profile-evaluator')

if (!existsSync(sourceDir)) {
  console.error(
    `Profile evaluator pkg not found at ${sourceDir}\n` +
      'Build it first in the profile-evaluator-rs repo (e.g. wasm-pack build in ui/) then run this script.'
  )
  process.exit(1)
}

const requiredFile = resolve(sourceDir, 'profile_evaluator_rs.js')
if (!existsSync(requiredFile)) {
  console.error(
    `Expected profile_evaluator_rs.js in ${sourceDir}\n` +
      'Ensure wasm-pack build was run in profile-evaluator-rs/ui with the correct crate name.'
  )
  process.exit(1)
}

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
cpSync(sourceDir, outDir, { recursive: true })

console.log(`Profile evaluator copied to ${outDir}`)
