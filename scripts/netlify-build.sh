#!/usr/bin/env bash
set -euo pipefail

# Install Rust if not already present (cached between builds via RUSTUP_HOME/CARGO_HOME).
if ! command -v rustc &>/dev/null; then
  echo "Installing Rust..."
  curl https://sh.rustup.rs -sSf | sh -s -- -y --default-toolchain stable --no-modify-path
fi

export PATH="$RUSTUP_HOME/bin:$CARGO_HOME/bin:$PATH"
rustup target add wasm32-unknown-unknown

# Install wasm-pack if not cached.
if ! command -v wasm-pack &>/dev/null; then
  echo "Installing wasm-pack..."
  curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
fi

# Build c2pa-rs WASM from the submodule.
node scripts/generate-version.js
npm run build:local-wasm

# Build the Vite app (generate-version runs again inside, that's fine).
npm run build
