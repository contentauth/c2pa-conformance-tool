# AGENTS.md

This file provides guidance to AI coding agents when working with code in this repository.

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

Local WASM development:
```bash
npm run build:local-wasm   # Build C2PA WASM from the c2pa-rs git submodule
```

## Architecture

### Data Flow
1. User drops a file onto `FileUpload.svelte`
2. `c2pa.ts` processes it via a locally-built c2pa-rs WASM module (`public/local-c2pa/`)
3. Result is a `ConformanceReport` (extends `CrJson`) stored in the root `App.svelte` state
4. `ReportViewer.svelte` renders the report; `ManifestSummary.svelte` generates human-readable text

### Key Abstractions

**`src/lib/c2pa.ts`** — WASM loader and validation orchestrator. Handles trust list fetching (official C2PA list from GitHub + local ITL), test certificate injection, thumbnail enrichment via `get_resource_bytes`, and the multi-step trust validation flow.

**`src/lib/crjson.ts`** — Type guards and helpers for the crJSON format (canonical C2PA report format). All report data flows through `CrJson` types.

**`src/lib/types.ts`** — `ConformanceReport` extends `CrJson` with conformance-specific fields: `usedITL`, `usedTestCerts`, and `_conformanceToolVersion` (git metadata injected at build time).

**`src/lib/rubrics/`** — Client-side evaluator for YAML-authored C2PA asset rubrics. Ported from the Python reference. Rubric YAML files live in `public/rubrics/`.

**`src/lib/version.ts`** — Auto-generated before each build/dev start via `scripts/generate-version.js`. Do not edit manually.

### Routing
`App.svelte` handles navigation between two pages:
- Main validation page (default)
- Test Certificates (`CertificateManager.svelte`)

### WASM Modules
The WASM module is **not** committed — it is built at dev/build time:
- `public/local-c2pa/` — Output of `npm run build:local-wasm` (gitignored); built from the `c2pa-rs` git submodule via the Rust crate in `wasm/`

The Netlify CI build runs `scripts/netlify-build.sh`, which compiles the WASM from the submodule before running `npm run build`.

### Rubrics
YAML-authored conformance rubrics live in `public/rubrics/` with an `index.json` manifest. The TS evaluator in `src/lib/rubrics/` mirrors the Python reference:
- `loader.ts` — Fetches and parses multi-document YAML; injects `$expected_spec_version` from filenames like `*-spec2.4.yml`
- `engine.ts` — Wraps `@adobe/json-formula` for expression evaluation
- `evaluate.ts` — Runs a single rubric against a `CrJson` report
- `perManifest.ts` — Iterates rubric checks per-manifest

### Trust Lists
- **C2PA Trust List**: Fetched at runtime from GitHub
- **Interim Trust List (ITL)**: Bundled in `public/trust/` (allowed.pem + anchors.pem)
- **Test certificates**: Session-only, stored in memory, clearly flagged in reports

### Deployment
Merging to `main` automatically triggers a Netlify build and deploy. The base URL is always `/` (set in `vite.config.ts` via the `NETLIFY` env var). See `netlify.toml` for the build configuration.
