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
Base URL is dynamically set in `vite.config.ts` — `/` for Netlify, `/<repo-name>/` for GitHub Pages. Deploy via `npm run deploy` (gh-pages branch) or push to Netlify.

### Rubrics

YAML-authored checks run against the crJSON in the browser. Mirrors the Python reference at `../../c2pa/conformance/asset-rubrics`. Composition (`include` directives, composables) is resolved at build time in the Python toolchain — we consume pre-built flat YAMLs and do **no** runtime composition or reference resolution.

**Files**
- `public/rubrics/index.json` — curated list the UI selector renders. Each entry: `{ id, filename, name, description, mode, category }`. `category` groups entries under section dividers in the selector (ordered by first appearance).
- `public/rubrics/asset-rubric-*.yml` — pre-built rubric YAMLs. Two-doc format: `rubric_metadata:` then `---` then a list of statements (`id`, `expression`, `reportText`, optional `failIfMatched`, `description`).
- `src/lib/rubrics/loader.ts` — fetch + parse rubric YAMLs.
- `src/lib/rubrics/evaluate.ts` — document-mode evaluator. Passes the whole crJSON to JMESPath; statements produce pass/fail (expressions typically reference `manifests[0].*`). Used by integrity + conformance rubrics.
- `src/lib/rubrics/perManifest.ts` — per-manifest evaluator. Iterates `report.manifests[]`, passes each manifest to JMESPath as the root, emits only truthy signals grouped by id prefix (`inception:` → localInceptions, `transformation:` → localTransformations). Also builds the ingredient DAG (parses `activeManifest.url` → bare `urn:c2pa:…` → index lookup) and resolves mimeType with a three-level priority chain (own claim → own thumbnail → child-ingredient back-fill).
- `src/lib/rubrics/context.ts` — crJSON normalization: mirrors root-level `validationResults` into each manifest when missing, so `manifests[0].validationResults.*` expressions work uniformly.
- `src/lib/rubrics/types.ts` — `RubricResult` (document mode), `SignalsRubricResult` (per-manifest mode), and `AnyRubricResult` discriminated union keyed by `mode`.
- `src/lib/RubricsPanel.svelte` — UI. Renders the category-grouped selector, dispatches on `mode` to evaluate, renders both result shapes. Clears results when the `report` prop changes in place (so a new file doesn't show stale results on the active tab).

**Evaluation semantics (port of the Python rules)**
- JMESPath result coercion: list non-empty → true; bool preserved; number > 0 → true; null → false; other → true.
- `failIfMatched: true` inverts: non-empty list → fail, `{{matches}}` substituted into reportText.
- `reportText[passed ? 'true' : 'false'][locale]` with fallback to `default` and `DEFAULT_LOCALE` ("en").
- Per-manifest mode drops falsy results entirely (only truthy signals surface).

**Gating**
The Rubrics tab in `ReportViewer` is only enabled when `isTrusted && hasNoValidationFailures`. If the gate closes mid-session (e.g. test certs cleared), the tab snaps back to Formatted.

**Testing**
`src/lib/rubrics/__fixtures__/` holds 18 fixture triples copied from `../../c2pa/conformance/asset-rubrics/test/` — `<name>.json` (crJSON input) + `<name>.conformance.json` (reference conformance output) + `<name>.signals.json` (reference signals output). `goldens.test.ts` iterates all triples, asserting parity with the Python reference. Conformance uses subset-match (forward-compatible when the rubric grows past its fixture); signals use exact-match. Unit tests in `evaluate.test.ts` and `perManifest.test.ts` cover coercion edge cases, failIfMatched, reportText fallback, error handling, ingredient back-fill, and the `allActionsIncluded` strictness rule.

**Adding a new rubric**
1. Drop the YAML in `public/rubrics/`.
2. Add an entry to `public/rubrics/index.json` (pick `mode: "document"` vs `"per-manifest"`, set `category`).
3. If it ships with a reference fixture, drop the input + expected-output pair in `__fixtures__/` — the parameterized goldens auto-discover by filename.
4. No evaluator changes needed unless the rubric introduces a new evaluation model.
