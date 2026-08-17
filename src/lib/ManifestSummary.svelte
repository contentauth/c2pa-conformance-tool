<script lang="ts">
  import type { CrJsonManifestEntry, CrJsonIngredientItem } from './types'
  import type { ManifestSignalsResult } from './rubrics/types'
  import { generateManifestSummary } from './generateSummary'

  export let manifest: CrJsonManifestEntry | null = null
  export let ingredients: CrJsonIngredientItem[] = []
  export let mimeType: string = ''
  export let usedITL: boolean = false
  export let isTrusted: boolean = true
  /**
   * Per-manifest signals from the signals rubric, or `null` if the rubric
   * isn't yet loaded / failed to load. When null, the summary falls back to
   * a minimal "{a/an} {media} from {signer}" sentence that doesn't claim
   * any property the rubric would.
   */
  export let signals: ManifestSignalsResult | null = null

  $: summary = generateManifestSummary(manifest, signals, ingredients, mimeType, usedITL, isTrusted)
</script>

{#if summary.sentence}
  <div class="mt-4 px-4 py-4 bg-white/70 dark:bg-gray-900/70 backdrop-blur-sm rounded-2xl border-2 border-gray-200 dark:border-gray-700 text-center">
    <p class="text-sm font-medium text-gray-800 dark:text-gray-200 leading-relaxed">
      {summary.sentence}
    </p>
    {#if summary.details.length > 0}
      <div class="mt-2 flex items-center justify-center gap-4 flex-wrap">
        {#each summary.details as detail}
          <span class="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0" /><path d="M12 9h.01" /><path d="M11 12h1v4h1" /></svg>
            {detail}
          </span>
        {/each}
      </div>
    {/if}
  </div>
{/if}
