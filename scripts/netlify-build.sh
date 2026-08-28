#!/usr/bin/env bash
set -euo pipefail

export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:${RUSTUP_HOME:-$HOME/.rustup}/bin:$HOME/.cargo/bin:$PATH"

# Install Rust toolchain directly into CARGO_HOME if not already present
if [ ! -x "${CARGO_HOME:-$HOME/.cargo}/bin/rustup" ]; then
  echo "Installing Rust into ${CARGO_HOME:-$HOME/.cargo}..."
  curl https://sh.rustup.rs -sSf | sh -s -- -y --default-toolchain stable --no-modify-path
fi

rustup target add wasm32-unknown-unknown

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
