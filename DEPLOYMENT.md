# Deployment

This project is deployed automatically to Netlify on every merge to `main`.

## How it works

Netlify is connected to this repository. When a pull request is merged to `main`, Netlify automatically runs `scripts/netlify-build.sh`, which:

1. Compiles the Rust WASM crate in `wasm/` against the bundled `c2pa-rs` git submodule
2. Writes the output to `public/local-c2pa/`
3. Runs `npm run build` to produce the final `dist/`

No manual steps are required. The build configuration is in [`netlify.toml`](./netlify.toml).

## Preview deploys

Netlify also builds a preview for every pull request, giving you a live URL to review changes before merging.

## What gets deployed

| File / directory | Description |
|---|---|
| `index.html` | Main page |
| `assets/` | JS and CSS bundles |
| `local-c2pa/` | C2PA WebAssembly module (built from `c2pa-rs` submodule at build time) |
| `rubrics/` | YAML conformance rubrics + `index.json` |
| `trust/` | Bundled Interim Trust List PEM files |

## Local development

```bash
git clone --recurse-submodules <repo-url>
cd conformance-tool
npm install
npm run build:local-wasm   # Build the WASM module from the c2pa-rs submodule
npm run dev                # Start dev server at http://localhost:5173/
npm run build              # Production build → dist/
npm run preview            # Preview the production build locally
```

If you cloned without `--recurse-submodules`, initialize the submodule manually:

```bash
git submodule update --init --recursive
```

## Build requirements

- Node.js 20+
- Rust + wasm-pack (required to build the WASM module)

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
cargo install wasm-pack
rustup target add wasm32-unknown-unknown
```

The `c2pa-rs` source is included as a git submodule at `c2pa-rs/` — no separate checkout is needed.

## Updating the c2pa-rs submodule

The submodule is pinned to a specific commit. To update it (e.g. to pull in a new c2pa-rs release or latest main):

```bash
# Move the submodule to the desired commit
cd c2pa-rs
git fetch origin

# Option A: latest main
git checkout origin/main

# Option B: a specific tag or release
git checkout v0.x.y

cd ..

# Stage the new pointer and commit
git add c2pa-rs
git commit -m "chore: update c2pa-rs submodule to <version or short SHA>"
```

After merging, Netlify will automatically compile the updated WASM on the next build. Local developers need to run `git submodule update --init` after pulling to sync their submodule to the new pointer, then re-run `npm run build:local-wasm`.
