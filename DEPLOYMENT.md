# Deployment Guide

This is a **100% static site** with no server-side code. All C2PA processing happens client-side using WebAssembly.

## Quick Deploy Options

### 1. GitHub Pages (Recommended)

Deploys automatically via the `.github/workflows/deploy.yml` GitHub Actions workflow. The workflow builds the site in CI and publishes it to GitHub Pages.

**Triggers:**
- Every push to `main`
- Manual runs via **Actions → Build and Deploy to GitHub Pages → Run workflow** (`workflow_dispatch`)

**One-time setup:**
1. Push your code to GitHub.
2. Go to **Settings → Pages**.
3. Under "Build and deployment", set **Source** to **GitHub Actions**.
4. (Optional) Go to **Settings → Environments → github-pages** to configure branch protection for the deploy environment.

After the first successful workflow run, the site is live.

**URL:** **`https://<username>.github.io/c2pa-conformance-tool/`** (use your GitHub username; no `index.html` needed).

**What the workflow does:**
1. Checks out the repo
2. Installs Node 24 and runs `npm ci`
3. Runs `npm run build` with `GITHUB_REPOSITORY` set so Vite uses the correct base path
4. Uploads `dist/` as a Pages artifact and deploys it with `actions/deploy-pages`

**Features:**
- ✅ Free hosting, HTTPS, custom domain
- ✅ Automatic deploys on push to `main`
- ✅ Manual deploys via `workflow_dispatch`
- ✅ No `gh-pages` branch to manage

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
```

Deployments to GitHub Pages are handled by the `Build and Deploy to GitHub Pages` GitHub Actions workflow — no local `deploy` script is needed.

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
