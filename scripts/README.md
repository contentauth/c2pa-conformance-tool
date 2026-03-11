# Build Scripts

## build-local-wasm.mjs

Builds a browser-targeted wasm reader from the local `../c2pa-rs` checkout and writes the generated loader plus `.wasm` binary to `public/local-c2pa/`.

### What it does:
- Uses `wasm-pack` to build the wrapper crate in the project's `wasm/` directory
- Links that wrapper crate against the local `../c2pa-rs/sdk` source tree
- Generates `public/local-c2pa/c2pa_local.js` and `public/local-c2pa/c2pa_local_bg.wasm`

### When it runs:
- Manually via `npm run build:local-wasm`

### Runtime behavior:
- If `public/local-c2pa/c2pa_local.js` exists, the app prefers that locally built wasm at runtime
- If it does not exist, the app falls back to the packaged `@contentauth/c2pa-web` wasm

### Prerequisites:
- A local checkout at `../c2pa-rs`
- `wasm-pack`
- Rust target `wasm32-unknown-unknown`

## generate-version.js

This script automatically generates `src/lib/version.ts` with git version information at build time.

### What it does:
- Captures the current git commit SHA (full and short)
- Records the commit date
- Records the current branch name
- Includes a timestamp of when the version file was generated

### When it runs:
- Automatically before every `npm run dev`
- Automatically before every `npm run build`

### Output:
Creates `src/lib/version.ts` with content like:

```typescript
export const VERSION_INFO = {
  "sha": "7bf7a937a6fc3b751fb693c5a64e425f8c55900d",
  "shortSha": "7bf7a93",
  "date": "2026-02-11 08:54:29 -0500",
  "branch": "main",
  "timestamp": "2026-02-11T16:49:52.969Z"
} as const
```

### Usage in code:
This version information is automatically included in all C2PA conformance reports under the `_conformanceToolVersion` field:

```typescript
import { VERSION_INFO } from './version'

// Included in every report
{
  ...manifestStore,
  _conformanceToolVersion: {
    commit: VERSION_INFO.sha,
    shortCommit: VERSION_INFO.shortSha,
    date: VERSION_INFO.date,
    branch: VERSION_INFO.branch,
    generatedAt: VERSION_INFO.timestamp
  }
}
```

### Note:
The generated `src/lib/version.ts` file is excluded from git (in .gitignore) since it's auto-generated on every build.
