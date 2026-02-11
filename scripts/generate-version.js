#!/usr/bin/env node

/**
 * Generate version information from git
 * This script runs at build time to capture the git commit SHA and date
 */

import { execSync } from 'child_process'
import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

function getGitInfo() {
  try {
    const sha = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim()
    const shortSha = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim()
    const date = execSync('git log -1 --format=%ai', { encoding: 'utf-8' }).trim()
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim()

    return {
      sha,
      shortSha,
      date,
      branch,
      timestamp: new Date().toISOString()
    }
  } catch (error) {
    console.warn('Warning: Could not get git information:', error.message)
    return {
      sha: 'unknown',
      shortSha: 'unknown',
      date: 'unknown',
      branch: 'unknown',
      timestamp: new Date().toISOString()
    }
  }
}

const versionInfo = getGitInfo()

const content = `// Auto-generated file - do not edit
// Generated at ${versionInfo.timestamp}

export const VERSION_INFO = ${JSON.stringify(versionInfo, null, 2)} as const
`

const outputPath = join(__dirname, '../src/lib/version.ts')
writeFileSync(outputPath, content, 'utf-8')

console.log('✅ Generated version.ts with git info:', versionInfo.shortSha, versionInfo.date)
