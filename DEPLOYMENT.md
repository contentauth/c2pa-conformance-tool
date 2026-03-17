# Deployment Guide

This is a **100% static site** with no server-side code. All C2PA processing happens client-side using WebAssembly.

## Quick Deploy Options

### 1. GitHub Pages (Recommended)

Deploy by building locally and pushing the built site to the `gh-pages` branch. No build runs in CI, so you avoid environment/base-path issues.

**One-time setup:**
1. Push your code to GitHub.
2. Go to **Settings → Pages**.
3. Under "Build and deployment", set:
   - **Source:** Deploy from a **branch**
   - **Branch:** `gh-pages` / `/(root)`
4. Save.

**Deploy (whenever you want to publish):**
```bash
npm run deploy
```
This runs `npm run build` (with the correct base path for GitHub Pages) and pushes the contents of `dist/` to the `gh-pages` branch. No GitHub Action is used.

**URL:** **`https://<username>.github.io/c2pa-conformance-tool/`** (use your GitHub username; no `index.html` needed).

**Features:**
- ✅ Free hosting, HTTPS, custom domain
- ✅ Same build locally and on the site (no CI surprises)
- ✅ No Actions or build step in the repo

---

### 2. Vercel (Zero Config)

```bash
npm install -g vercel
vercel
```

**Features:**
- ✅ Free tier
- ✅ Automatic HTTPS
- ✅ Preview deployments for PRs
- ✅ Custom domains

---

### 3. Netlify (Drag & Drop)

1. Build: `npm run build`
2. Go to [app.netlify.com](https://app.netlify.com)
3. Drag the `dist` folder

**Or use CLI:**
```bash
npm install -g netlify-cli
netlify deploy --prod
```

---

### 4. Cloudflare Pages

1. Connect your GitHub repo
2. Build command: `npm run build`
3. Output directory: `dist`

**Features:**
- ✅ Free unlimited bandwidth
- ✅ Global CDN
- ✅ Custom domains

---

## Build Locally

```bash
# Install dependencies
npm install

# Build for production
npm run build

# Preview the build (open http://localhost:4173/c2pa-conformance-tool/)
npm run preview

# Build and deploy to GitHub Pages (pushes dist/ to gh-pages branch)
npm run deploy
```

**Output:** `dist/` folder contains all static files

---

## What Gets Deployed?

- `index.html` - Main page
- `assets/` - JS and CSS bundles
- `c2pa.wasm` - WebAssembly module (copied from `@contentauth/c2pa-web` at **build time** via `postinstall`)
- `profile-evaluator/` - Profile evaluator WASM (committed in repo; update by running `npm run copy:profile-evaluator` from a sibling `profile-evaluator-rs` checkout, then commit)

**Total size:** ~8MB+ (mostly the C2PA WASM; profile-evaluator adds some size if present)

---

## Requirements

Just static file hosting with:
- ✅ HTTPS support (recommended for WebAssembly)
- ✅ No server-side processing needed
- ✅ No environment variables required
- ✅ No backend services

---

## Important Notes

### File Upload
All file processing happens **client-side**. Files never leave the user's browser. This means:
- ✅ Privacy-friendly
- ✅ No server storage costs
- ✅ Works offline (after initial load)

### WASM Requirements
The app requires WebAssembly support. All modern browsers support it:
- Chrome 57+ ✅
- Firefox 52+ ✅
- Safari 11+ ✅
- Edge 16+ ✅

### Browser Compatibility
Requires ES2020 features. Supported browsers:
- Chrome 80+
- Firefox 75+
- Safari 13.1+
- Edge 80+

---

## Troubleshooting

### WASM Loading Issues
If the WASM file fails to load:
- Ensure your server serves `.wasm` files with correct MIME type: `application/wasm`
- Most modern platforms handle this automatically

### 404 on Refresh
If you get 404s when refreshing on routes:
- This app is single-page, so shouldn't be an issue
- If problems occur, configure platform for SPA routing

### Large Initial Load
The 7.7MB WASM file is necessary for C2PA processing:
- It's only downloaded once and cached
- Consider adding a loading screen (future enhancement)
- Users on slow connections may need to wait ~10 seconds

---

## Performance

- **Initial load:** ~8MB (WASM + code)
- **Subsequent loads:** Instant (browser cache)
- **Processing time:** 1-3 seconds per file
- **Client-side only:** No server latency

---

## Cost

All recommended platforms offer **free tiers** that are perfect for this app:
- GitHub Pages: Free forever
- Vercel: 100GB bandwidth/month free
- Netlify: 100GB bandwidth/month free
- Cloudflare Pages: Unlimited bandwidth free
