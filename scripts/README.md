# Build Scripts

## build-local-wasm.mjs

Builds a browser-targeted WASM reader from the `c2pa-rs` git submodule and writes the generated loader plus `.wasm` binary to `public/local-c2pa/`.

### What it does:
- Uses `wasm-pack` to build the wrapper crate in the project's `wasm/` directory
- Links that wrapper crate against the `c2pa-rs/` submodule source
- Generates `public/local-c2pa/c2pa_local.js` and `public/local-c2pa/c2pa_local_bg.wasm`

### When it runs:
- Automatically via `scripts/netlify-build.sh` on every Netlify build
- Manually via `npm run build:local-wasm` for local development

### Prerequisites:
- `wasm-pack`
- Rust target `wasm32-unknown-unknown`
- The `c2pa-rs` submodule must be initialized (`git submodule update --init --recursive`)

---

## netlify-build.sh

Full CI build script used by Netlify. Builds the WASM module then runs the npm build.

### What it does:
1. Runs `build-local-wasm.mjs` to compile the WASM from the `c2pa-rs` submodule
2. Runs `npm run build` to produce the final `dist/`

---

## generate-version.js

Generates `src/lib/version.ts` with git version information at build time.

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
