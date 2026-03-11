import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// GitHub Pages serves at https://<user>.github.io/<repo-name>/
const base = process.env.NODE_ENV === 'production' ? '/c2pa-conformance-tool/' : '/'

export default defineConfig({
  base,
  plugins: [svelte()],
  server: {
    fs: {
      // Allow serving files from wasm directory
      allow: ['..']
    }
  },
  build: {
    target: 'esnext'
  }
})
