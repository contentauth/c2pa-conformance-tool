# C2PA Conformance Testing Tool

A web application for validating C2PA (Coalition for Content Provenance and Authenticity) manifests in media files. This tool provides an easy-to-use interface for drag-and-drop file testing with detailed conformance reports.

**Built with the official [@contentauth/c2pa-web](https://github.com/contentauth/c2pa-js) SDK** - ensuring complete file format support and validation compatibility.

## Features

- **Drag & Drop Interface**: Easy file upload via drag-and-drop or file selection
- **Client-Side Processing**: Uses the official C2PA SDK compiled to WebAssembly for fast, private processing
- **Official C2PA Trust List**: Validates signatures against the official [C2PA Conformance Trust List](https://c2pa.org/conformance)
- **Interim Trust List (ITL)**: Automatically detects and validates signatures against the ITL with distinct visual indicators
- **Server-Side OCSP Revocation Checking**: When a signing certificate's OCSP responder is unreachable from the browser (typically because the URL is HTTP and the tool is served over HTTPS), the tool automatically extracts the certificate chain client-side and checks revocation status via a server-side proxy — no file content is ever sent to the server
- **Test Certificate Mode**: Enable test mode to load the C2PA Conformance Test Root, download the test signing cert (ZIP), and add custom test certificates (session-only, clearly marked)
- **Version Tracking**: Every report includes git commit SHA and date for reproducibility ([details](VERSION_TRACKING.md))
- **Modern Tailwind CSS UI**: Clean, responsive design matching verify.contentauthenticity.org
- **Comprehensive Reports**: View detailed C2PA manifest information including:
  - Manifest summary (claim generator, trust status)
  - Signature information with trust validation
  - Active manifest details
  - Assertions and claims
  - Ingredient information
  - Validation status with clear test/production indicators
- **crJSON Reports**: Reports use the Content Credentials JSON (crJSON) format from the C2PA SDK, with syntax-highlighted raw JSON
- **Multiple Output Options**:
  - Human-readable formatted view
  - Raw JSON display (syntax highlighted)
  - Downloadable JSON reports (with version metadata)
  - Copy to clipboard functionality

## Prerequisites

- **Node.js** (v18 or higher)

### Installing Prerequisites

#### Install Node.js
Download and install from [nodejs.org](https://nodejs.org/)

## Setup

1. **Install dependencies**:
```bash
npm install
```

This will install all necessary dependencies, including the official `@contentauth/c2pa-web` package. The postinstall script automatically copies the WASM binary to the `public/` directory.

## Development

Start the development server:

```bash
npm run dev
```

This will start Vite's development server, typically at `http://localhost:5173`.

## Building for Production

1. **Build the web application**:
```bash
npm run build
```

The production-ready files will be in the `dist/` directory.

2. **Preview the production build**:
```bash
npm run preview
```

## Deployment

Merging a pull request to `main` automatically triggers a Netlify build and deploys to production. No manual steps required.

See [DEPLOYMENT.md](./DEPLOYMENT.md) for details on the build process and preview deployments.

## Project Structure

```
conformance-tool/
├── netlify/
│   └── functions/
│       └── ocsp-proxy.ts           # Server-side OCSP proxy with in-memory cache
├── src/
│   ├── lib/
│   │   ├── FileUpload.svelte       # Drag-and-drop file upload component
│   │   ├── ReportViewer.svelte     # C2PA report display (crJSON, highlight.js)
│   │   ├── ManifestSummary.svelte  # Summary (claim generator, trust status)
│   │   ├── CertificateManager.svelte  # Test mode and custom certificate upload
│   │   ├── c2pa.ts                 # TypeScript interface to @contentauth/c2pa-web
│   │   ├── crjson.ts               # crJSON types and helpers
│   │   ├── generateSummary.ts      # Report summary generation
│   │   ├── ocspExtract.ts          # Client-side cert extraction from JUMBF/COSE
│   │   ├── trustListTest.ts        # Trust list (C2PA vs ITL) detection
│   │   └── types.ts                # Shared types
│   ├── App.svelte                  # Main application component
│   ├── main.ts                     # Application entry point
│   └── app.css                     # Global styles
├── scripts/
│   ├── generate-version.js        # Build-time git version (see VERSION_TRACKING.md)
│   └── build-local-wasm.mjs       # Optional local WASM build (see scripts/README.md)
├── index.html
├── netlify.toml                    # Netlify build config and function settings
├── package.json
└── vite.config.ts
```

## Usage

### Basic Validation

1. Open the application in your browser
2. Drag and drop a media file anywhere, or click "Browse Files"
3. The tool will process the file and display:
   - Signature information with trust validation
   - Active C2PA manifest information
   - Assertions and claims
   - Ingredient details
   - Validation status
4. Use the buttons to:
   - Toggle between formatted and raw JSON views
   - Download the report as a JSON file
   - Copy the JSON to clipboard
   - Upload another file

### Conformance Testing with Test Certificates

1. In the **Test Certificates** section, click **"Enable Test Mode"** to load the C2PA Conformance Test Root
2. Optionally click **"Download Signing Cert (ZIP)"** to get the test signing certificate bundle
3. Optionally click **"Add Custom Certificate"** to upload additional test certificates (.pem, .crt, .cer)
4. Upload a C2PA file — it will validate against the official trust list plus any test certificates
5. Reports show a clear **⚠️ Test Certificate Mode Active** warning when test certs are used
6. Test certificates are **session-only** (cleared on refresh). See [TEST_CERTIFICATES.md](TEST_CERTIFICATES.md) for details

## Supported File Types

The tool supports any file format that can contain C2PA manifests:
- Images (JPEG, PNG, WebP, etc.)
- Videos (MP4, MOV, etc.)
- Audio files
- PDF documents

## How It Works

1. **File Upload**: User uploads a file via drag-and-drop or file picker
2. **WASM Processing**: The file is processed entirely in the browser using the official `@contentauth/c2pa-web` library
3. **Trust Validation**: Signatures are validated against the official C2PA trust lists:
   - **C2PA-TRUST-LIST.pem** - Approved signing certificates for conformant products
   - **C2PA-TSA-TRUST-LIST.pem** - Trusted Time Stamp Authorities
4. **OCSP Check**: If the SDK cannot reach the OCSP responder from the browser (see [OCSP Revocation Checking](#ocsp-revocation-checking) below), a server-side fallback check is triggered automatically
5. **Report Generation**: C2PA manifest data is extracted, validated, and formatted
6. **Display**: Results are shown in both human-readable and JSON formats with trust status

## Trust Verification & Conformance

This tool uses the **official C2PA Conformance Trust List** to validate digital signatures:

- ✅ Only signatures from [C2PA conformant products](https://c2pa.org/conformance) are marked as trusted
- ✅ Certificates are validated against official trust anchors maintained by C2PA
- ✅ Time stamps are verified against approved Time Stamp Authorities
- ✅ Trust lists are fetched directly from the [official C2PA repository](https://github.com/c2pa-org/conformance-public/tree/main/trust-list)

**Important**: As of January 2026, the Interim Trust List (ITL) has been frozen. This tool uses the current official trust list, ensuring compatibility with conformant implementations.

Learn more: [C2PA Conformance Program](https://c2pa.org/conformance)

## OCSP Revocation Checking

C2PA signing certificates often list an OCSP (Online Certificate Status Protocol) responder URL in their Authority Information Access extension. The C2PA SDK checks this responder during validation to confirm the signing certificate has not been revoked.

### Why the browser sometimes can't check OCSP

When the tool is served over HTTPS (as it is in production), many OCSP responders are unreachable because their URLs use plain HTTP. Browsers block such mixed-content requests, and most OCSP endpoints also reject browser-originated requests due to [CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS) policy. When this happens, the SDK reports `signingCredential.ocsp.inaccessible` and cannot determine revocation status.

### Server-side fallback

When the SDK reports OCSP as inaccessible, the tool automatically performs a server-side check:

1. **Client-side extraction** (`src/lib/ocspExtract.ts`): The signing certificate chain is extracted directly from the file's embedded JUMBF/COSE signature bytes — no file content is sent anywhere. Specifically:
   - For JPEG files: APP11 segments are reassembled into the JUMBF stream
   - For all other formats: JUMBF boxes are scanned from the raw file bytes
   - The `c2pa.signature` box is located, its COSE_Sign1 envelope is CBOR-decoded, and the `x5chain` (key 33) from the protected header yields the DER-encoded certificate chain
   - The leaf cert's AIA extension provides the OCSP responder URL

2. **Server proxy** (`netlify/functions/ocsp-proxy.ts`): A Netlify Function receives `{ responderUrl, certDerB64, issuerDerB64 }`, builds a proper OCSP request (SHA-1 CertID per RFC 6960), and forwards it to the OCSP responder. The result is cached in-process to avoid redundant upstream queries.

3. **Reactive update**: The initial report is displayed immediately. When the server check completes, the UI reactively updates the OCSP status in the Signature Info section.

### Cache TTL

The function cache is ephemeral (resets on cold start) and controlled by the `OCSP_CACHE_TTL_SECONDS` environment variable in `netlify.toml`:

| Context | Default TTL |
|---|---|
| Production | 3600 s (1 hour) |
| Deploy preview | 300 s (5 minutes) |

To override, set `OCSP_CACHE_TTL_SECONDS` in the Netlify environment variables for the relevant deploy context.

### Local development

The Netlify Function is not available when running `npm run dev` (Vite only). To test the full OCSP flow locally, use:

```bash
npm install -g netlify-cli
netlify dev
```

`netlify dev` runs both the Vite dev server and the Netlify Functions runtime, making the proxy available at `/.netlify/functions/ocsp-proxy`.

## Privacy & Security

- **File Processing**: All C2PA manifest parsing happens in your browser via WebAssembly — files never leave your machine
- **OCSP Checking**: When a server-side OCSP check is triggered, only the signing certificate's DER bytes and the OCSP responder URL are sent to the Netlify Function proxy. No file content, metadata, or user information is transmitted
- **No Data Collection**: No tracking or analytics
- **Trust List Updates**: Trust lists are fetched directly from the official C2PA repository when processing files

## Troubleshooting

### Module not found errors
If you see module import errors, try reinstalling dependencies:
```bash
rm -rf node_modules package-lock.json
npm install
```

### WASM initialization errors
Clear your browser cache and reload the page. The WASM module is loaded from the `@contentauth/c2pa-web` package automatically.

## Development Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run check` - Run Svelte type checking
- `npm run build:local-wasm` - Build C2PA WASM from a local `../c2pa-rs` checkout into `public/local-c2pa/` (see [scripts/README.md](scripts/README.md))
- `npm run copy:profile-evaluator` - Copy profile-evaluator WASM from a sibling `../profile-evaluator-rs/ui/pkg` into `public/profile-evaluator/` so Asset Profiles evaluation works locally

## Dependencies

### Frontend
- **Svelte** (v5) - Reactive UI framework
- **TypeScript** - Type-safe JavaScript
- **Vite** - Build tool and dev server
- **@contentauth/c2pa-web** - Official C2PA JavaScript/WASM SDK from Content Authenticity Initiative
- **highlight.js** - Syntax highlighting for raw JSON in reports
- **@peculiar/x509** - Certificate parsing (CertificateManager, OCSP AIA extension extraction)
- **cborg** - CBOR decoding for COSE_Sign1 protected headers during OCSP cert extraction

## License

Copyright 2026 Content Authenticity Initiative

Licensed under the Apache License, Version 2.0. See [LICENSE](./LICENSE) for the full text.

This project uses the [@contentauth/c2pa-web](https://github.com/contentauth/c2pa-js) library, also from the Content Authenticity Initiative and also licensed under Apache 2.0.

## Contributing

Contributions are welcome! Please ensure that:
1. The WASM module builds successfully
2. The TypeScript code type-checks
3. The UI works across modern browsers

## Future Enhancements

Potential features to add:
- Batch file processing
- Export reports as PDF or HTML
- Detailed validation error explanations
- Visual manifest relationship graphs
- Support for manifest signing and editing
- Progressive Web App (PWA) support for offline use
