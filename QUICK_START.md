# Quick Start

## Running locally

```bash
npm install
npm run dev
```

Open http://localhost:5173/ and drop any media file with C2PA content credentials onto the page.

## Common commands

| Command | Description |
|---|---|
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Production build → `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm run check` | Svelte type checking |
| `npm run test:run` | Run tests once |
| `npm run build:local-wasm` | Build C2PA WASM from a local `../c2pa-rs` checkout |
| `npm run copy:profile-evaluator` | Copy profile evaluator WASM from a sibling `../profile-evaluator-rs` checkout |

## Deployment

Merging to `main` automatically triggers a Netlify build and deploy. See [DEPLOYMENT.md](./DEPLOYMENT.md) for details.

## Architecture

All C2PA processing happens client-side via WebAssembly — files never leave the browser. The app is a 100% static site with no backend.

## Browser support

Requires WebAssembly and ES2020 support:

- Chrome 80+ ✅
- Firefox 75+ ✅
- Safari 13.1+ ✅
- Edge 80+ ✅
