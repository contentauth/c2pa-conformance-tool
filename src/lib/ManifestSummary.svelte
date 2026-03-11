<script lang="ts">
  import type { CrJsonManifestEntry, CrJsonIngredientItem } from './types'
  import { generateManifestSummary } from './generateSummary'

  export let manifest: CrJsonManifestEntry | null = null
  export let ingredients: CrJsonIngredientItem[] = []
  export let mimeType: string = ''
  export let usedITL: boolean = false
  export let isTrusted: boolean = true

  $: summary = generateManifestSummary(manifest, ingredients, mimeType, usedITL, isTrusted)
</script>

{#if summary.sentence}
  <div class="mt-4 px-4 py-3 bg-white/70 dark:bg-gray-900/70 backdrop-blur-sm rounded-xl border border-gray-200 dark:border-gray-700 text-center">
    <p class="text-sm font-medium text-gray-800 dark:text-gray-200 leading-relaxed">
      {summary.sentence}
    </p>
    {#if summary.details.length > 0}
      <div class="mt-1.5 flex items-center justify-center gap-3 flex-wrap">
        {#each summary.details as detail}
          <span class="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
            <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd" />
            </svg>
            {detail}
          </span>
        {/each}
      </div>
    {/if}
  </div>
{/if}
