# Quick Start Guide

## For Users

Visit the deployed app and drag-drop any media file with C2PA data to validate it instantly!

## For Developers

### Run Locally
```bash
npm install
npm run dev
```
Open http://localhost:5173/

### Deploy to Production
```bash
# Build
npm run build

# The dist/ folder is ready to deploy!
```

### Deploy to GitHub Pages
1. Push code to GitHub
2. Settings → Pages → Source: **GitHub Actions**
3. Done! Auto-deploys on every push to `main`

## Architecture

**100% Static Site**
- ✅ No backend needed
- ✅ No API keys required
- ✅ No environment variables
- ✅ All processing happens in the browser via WebAssembly

**What You're Deploying:**
- Single HTML page
- JavaScript/CSS bundles (~70KB)
- C2PA WebAssembly module (7.7MB)
- Total: ~8MB

**Hosting Requirements:**
- Static file hosting only
- HTTPS recommended (for WebAssembly)
- No server-side processing

## Quick Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build |
| `npm run check` | Run Svelte type checking |
| `npm run test:run` | Run tests once |
| `npm run build:local-wasm` | Build the C2PA WebAssembly module locally |

## Browser Support

- Chrome 80+ ✅
- Firefox 75+ ✅
- Safari 13.1+ ✅
- Edge 80+ ✅

Requires WebAssembly and ES2020 support (all modern browsers).

## Cost

**Free Forever** on:
- GitHub Pages
- Vercel (100GB/month free)
- Netlify (100GB/month free)
- Cloudflare Pages (unlimited free)

No ongoing costs, no credit card required!
