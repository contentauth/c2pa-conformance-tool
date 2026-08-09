# C2PA Conformance Tool

A client-side web application for validating C2PA (Coalition for Content Provenance and Authenticity) manifests in media files. All processing happens in the browser via WebAssembly — no server, no uploads.

## Features

- **Drag & Drop Interface**: Upload files via drag-and-drop or file picker
- **Client-Side Processing**: Files are processed entirely in your browser using a locally-built c2pa-rs WASM module — nothing leaves your machine
- **Official C2PA Trust List**: Validates signatures against the official [C2PA Conformance Trust List](https://c2pa.org/conformance)
- **Interim Trust List (ITL)**: Automatically falls back to ITL validation with distinct visual indicators
- **Test Certificate Mode**: Load the C2PA Conformance Test Root, download the test signing cert (ZIP), and add custom PEM certificates (session-only, clearly marked)
- **Conformance Rubrics**: Evaluate assets against YAML-authored C2PA conformance rubrics (Conformance 0.1/0.2, Spec 2.2/2.4, Integrity, Signals)
- **Version Tracking**: Every report includes git commit SHA and date for reproducibility ([details](VERSION_TRACKING.md))
- **Comprehensive Reports**:
  - Manifest summary (claim generator, trust status, provenance tree)
  - Signature information with trust validation
  - Assertions and claims
  - Ingredient details
  - Validation status with clear test/production indicators
- **crJSON Output**: Reports use the crJSON format from c2pa-rs, with syntax-highlighted raw JSON and one-click download

## Prerequisites

- **Node.js** 20+
- **Rust** + **wasm-pack** (required to build the C2PA WASM module for local development)

### Installing Rust and wasm-pack

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
cargo install wasm-pack
rustup target add wasm32-unknown-unknown
```

## Setup

```bash
git clone --recurse-submodules <repo-url>
cd conformance-tool
npm install
npm run build:local-wasm   # Build the C2PA WASM module from the c2pa-rs submodule
npm run dev                # Start dev server at http://localhost:5173
```

`npm run build:local-wasm` compiles the Rust crate in `wasm/` against the `c2pa-rs` git submodule and writes the output to `public/local-c2pa/`. This step is required before the first `npm run dev` and whenever `c2pa-rs` is updated.

## Development

```bash
npm run dev          # Start Vite dev server with hot reload
npm run check        # Svelte type checking
npm run test:run     # Run tests once
npm run test         # Run tests in watch mode
npm run build        # Production build → dist/
npm run preview      # Preview production build locally
```

## Deployment

Merging a pull request to `main` automatically triggers a Netlify build and deploys to production. The Netlify build compiles the WASM from the `c2pa-rs` submodule — no pre-built binaries are committed.

See [DEPLOYMENT.md](./DEPLOYMENT.md) for details.

## Project Structure

```
conformance-tool/
├── c2pa-rs/                        # git submodule — c2pa-rs source
├── wasm/                           # Rust crate that wraps c2pa-rs for WASM
│   └── src/lib.rs                  # WASM exports (read_manifest_store, get_resource_bytes, …)
├── public/
│   ├── rubrics/                    # YAML conformance rubrics + index.json
│   └── trust/                      # Bundled Interim Trust List PEM files
├── src/
│   ├── lib/
│   │   ├── c2pa.ts                 # WASM loader, trust validation flow, thumbnail enrichment
│   │   ├── crjson.ts               # crJSON type guards and helpers
│   │   ├── types.ts                # Shared types (ConformanceReport, etc.)
│   │   ├── rubrics/                # Rubric evaluator (loader, engine, evaluate, perManifest)
│   │   ├── FileUpload.svelte       # Drag-and-drop upload
│   │   ├── ReportViewer.svelte     # Report display
│   │   ├── ManifestSummary.svelte  # Human-readable manifest summary
│   │   ├── RubricsPanel.svelte     # Conformance rubric evaluation UI
│   │   ├── OverviewPanel.svelte    # Provenance tree visualization
│   │   └── CertificateManager.svelte  # Test certificate management
│   ├── App.svelte                  # Root component and routing
│   └── main.ts                     # Entry point
├── scripts/
│   ├── generate-version.js         # Injects git metadata into version.ts at build time
│   ├── build-local-wasm.mjs        # Builds WASM from the c2pa-rs submodule
│   └── netlify-build.sh            # Full Netlify CI build (WASM + npm build)
├── netlify.toml
├── vite.config.ts
└── vitest.config.ts
```

## Usage

### Basic Validation

1. Open the app and drag-and-drop a C2PA-signed media file (or click "Browse Files")
2. The tool validates the file and displays trust status, manifest details, and validation results
3. Use the tabs to switch between the formatted summary, raw crJSON, and rubric evaluation views
4. Download the report as JSON or copy it to clipboard

### Sidecar Files (`.c2pa`)

Drag a `.c2pa` sidecar file on its own to validate the manifest store without an asset. To validate hash bindings, drop the sidecar and its matching asset file together.

### Conformance Rubrics

1. After uploading a file, open the **Rubrics** tab
2. Select which rubrics to evaluate (Integrity, Conformance 0.1/0.2 for Spec 2.2 or 2.4, Signals)
3. Click **Evaluate selected** to run the checks
4. Results show per-statement pass/fail with report text; the overall pass/fail is shown in the header

### Test Certificate Mode

1. Go to **Test Certificates** and click **Enable Test Mode** to load the C2PA Conformance Test Root
2. Optionally upload additional `.pem`/`.crt` certificates
3. Upload a C2PA file — it will be validated against the official trust list plus your test certs
4. Reports clearly indicate when test certificates were used. Certs are session-only and cleared on refresh.

## Supported File Types

Any format supported by c2pa-rs: JPEG, PNG, WebP, AVIF, HEIC, MP4, MOV, MP3, WAV, AIFF, PDF, and more.

## How It Works

1. The file is read in the browser and passed to a locally-built c2pa-rs WASM module
2. Signatures are validated in a multi-step trust flow:
   - **Step 1** — Official C2PA Trust List (`C2PA-TRUST-LIST.pem` + `C2PA-TSA-TRUST-LIST.pem`)
   - **Step 2** — If test certificates are present, re-validates with those added
   - **Step 3** — If still untrusted, re-validates against the Interim Trust List (ITL)
3. crJSON is extracted from the WASM result and displayed in the UI
4. Thumbnail URIs are resolved back through the WASM to inline base64 images

## Privacy & Security

- **Client-side only** — all processing happens in your browser
- **No server upload** — files never leave your machine
- **No tracking or analytics**
- Trust lists are fetched directly from the official C2PA repository at validation time

## Dependencies

- **Svelte 5** — UI framework
- **TypeScript** — type safety
- **Vite** — build tool
- **c2pa-rs** (via WASM submodule) — C2PA validation engine
- **@adobe/json-formula** — expression engine for conformance rubric evaluation
- **highlight.js** — syntax highlighting for raw crJSON
- **@peculiar/x509** — certificate parsing
- **yaml** — rubric YAML parsing

## License

Copyright 2026 Content Authenticity Initiative

Licensed under the Apache License, Version 2.0. See [LICENSE](./LICENSE) for the full text.
