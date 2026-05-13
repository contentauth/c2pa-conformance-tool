# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A client-side SPA for validating C2PA (Coalition for Content Provenance and Authenticity) manifests in media files. All file processing happens in the browser via WebAssembly — there is no server-side code. Built with Svelte 5 + TypeScript + Vite.

## Commands

```bash
npm run dev              # Start Vite dev server with hot reload
npm run build            # Production build to dist/
npm run check            # Svelte type checking
npm run test             # Run Vitest in watch mode
npm run test:run         # Single test run (no watch)
npm run test:coverage    # Coverage report
npm run preview          # Preview production build locally
```

To run a single test file:
```bash
npx vitest run src/lib/c2pa.test.ts
```

Local WASM development (requires sibling repos):
```bash
npm run build:local-wasm        # Build C2PA WASM from ../c2pa-rs
npm run copy:profile-evaluator  # Copy profile evaluator from ../profile-evaluator-rs
```

## Architecture

### Data Flow
1. User drops a file onto `FileUpload.svelte`
2. `c2pa.ts` processes it with `@contentauth/c2pa-web` (WASM)
3. Result is a `ConformanceReport` (extends `CrJson`) stored in the root `App.svelte` state
4. `ReportViewer.svelte` renders the report; `ManifestSummary.svelte` generates human-readable text

### Key Abstractions

**`src/lib/c2pa.ts`** — Wraps `@contentauth/c2pa-web`. Handles trust list fetching (official C2PA list from GitHub + local ITL), test certificate injection, and optional fallback to a locally-built WASM at `public/local-c2pa/`.

**`src/lib/crjson.ts`** — Type guards and helpers for the crJSON format (canonical C2PA report format). All report data flows through `CrJson` types from the SDK.

**`src/lib/types.ts`** — `ConformanceReport` extends `CrJson` with conformance-specific fields: `usedITL`, `usedTestCerts`, and `_conformanceToolVersion` (git metadata injected at build time).

**`src/lib/rubrics/`** — Client-side evaluator for YAML-authored C2PA asset rubrics. Ported from the Python reference at `../../c2pa/conformance/asset-rubrics`. See the Rubrics section below for details.

**`src/lib/version.ts`** — Auto-generated before each build/dev start via `scripts/generate-version.js`. Do not edit manually.

### Routing
`App.svelte` handles navigation between two pages:
- Main validation page (default)
- Test Certificates (`CertificateManager.svelte`)

### WASM Modules
One WASM binary is committed to `public/`:
- `public/c2pa.wasm` — Official C2PA reader (copied from `@contentauth/c2pa-web` during `postinstall`)

(`public/profile-evaluator/` is a legacy directory — the profile-evaluator page was removed when Rubrics replaced it. Safe to delete when convenient.)

### Trust Lists
- **C2PA Trust List**: Fetched at runtime from GitHub
- **Interim Trust List (ITL)**: Bundled in `public/trust/` (allowed.pem + anchors.pem)
- **Test certificates**: Session-only, stored in memory, clearly flagged in reports

### Deployment
Merging to `main` automatically triggers a Netlify build and deploy. The base URL is always `/` (set in `vite.config.ts` via the `NETLIFY` env var). See `netlify.toml` for the build configuration.
