#!/usr/bin/env bash
set -euo pipefail

export PATH="${RUSTUP_HOME:-$HOME/.rustup}/bin:${CARGO_HOME:-$HOME/.cargo}/bin:$HOME/.cargo/bin:$PATH"

# Netlify's build image ships rustup but with no default toolchain configured.
# Install stable toolchain and target for wasm32
if command -v rustup &>/dev/null; then
  rustup toolchain install stable
  rustup default stable
else
  echo "Installing Rust..."
  curl https://sh.rustup.rs -sSf | sh -s -- -y --default-toolchain stable --no-modify-path
fi

rustup target add wasm32-unknown-unknown

# Install wasm-pack if not cached.
if ! command -v wasm-pack &>/dev/null; then
  echo "Installing wasm-pack..."
  curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
fi

export PATH="$HOME/.cargo/bin:${CARGO_HOME:-$HOME/.cargo}/bin:$PATH"

# Ensure submodules are checked out (for fork PRs where Netlify git clone may not recurse)
if [ ! -f "c2pa-rs/sdk/Cargo.toml" ]; then
  echo "Initializing git submodules..."
  git submodule update --init --recursive
fi

# Build c2pa-rs WASM from the submodule.
node scripts/generate-version.js
npm run build:local-wasm

# Build the Vite app (generate-version runs again inside, that's fine).
npm run build
