# Deployment

This project is deployed automatically to Netlify on every merge to `main`.

## How it works

Netlify is connected to this repository. When a pull request is merged to `main`, Netlify automatically:

1. Runs `npm run build`
2. Publishes the contents of `dist/` to the production URL

No manual steps are required. The build configuration is in [`netlify.toml`](./netlify.toml).

## Preview deploys

Netlify also builds a preview for every pull request, giving you a live URL to review changes before merging.

## What gets deployed

| File / directory | Description |
|---|---|
| `index.html` | Main page |
| `assets/` | JS and CSS bundles |
| `c2pa.wasm` | C2PA WebAssembly module (copied from `@contentauth/c2pa-web` at build time) |
| `trust/` | Bundled Interim Trust List PEM files |
| `profile-evaluator/` | Profile evaluator WASM (committed; update via `npm run copy:profile-evaluator`) |

## Local development

```bash
npm install
npm run dev       # Start dev server at http://localhost:5173/
npm run build     # Production build → dist/
npm run preview   # Preview the production build locally
```

## Build requirements

- Node.js 20+
- All other dependencies are installed via `npm install`
- The `postinstall` script automatically copies the C2PA WASM binary to `public/`
