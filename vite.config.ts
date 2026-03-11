import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// Netlify sets NETLIFY=true automatically — serve from root
// GitHub Pages sets GITHUB_REPOSITORY — serve from /<repo-name>/
// Local dev / unknown — serve from root
const isNetlify = !!process.env.NETLIFY
const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1]
const base = isNetlify ? '/' : (repoName ? `/${repoName}/` : '/')

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
