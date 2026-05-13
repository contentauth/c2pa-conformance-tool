<script lang="ts">
  import type { IngredientTreeNode } from './types'

  export let nodes: IngredientTreeNode[]
  export let depth: number = 0

  function formatLabel(fmt?: string): string {
    if (!fmt) return ''
    return fmt.split('/')[1] ?? fmt
  }

  function relationshipClass(rel?: string): string {
    switch (rel) {
      case 'parentOf': return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
      case 'componentOf': return 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
      case 'inputTo': return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
      default: return 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
    }
  }
</script>

{#each nodes as node}
  <div class="flex flex-col">
    <div class="flex items-start gap-3 p-3 rounded-xl border transition-colors
      {node.isRoot
        ? 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800'
        : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'}">

      <!-- Thumbnail or format icon -->
      <div class="flex-shrink-0 w-10 h-10 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
        {#if node.thumbnailSrc}
          <img src={node.thumbnailSrc} alt="" class="w-full h-full object-cover" />
        {:else if node.format?.startsWith('image/')}
          <svg class="w-5 h-5 text-gray-400 dark:text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
            <path d="M15 8h.01"/><path d="M3 6a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v12a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3v-12z"/><path d="M3 16l5 -5c.928 -.893 2.072 -.893 3 0l5 5"/><path d="M14 14l1 -1c.928 -.893 2.072 -.893 3 0l3 3"/>
          </svg>
        {:else if node.format?.startsWith('video/')}
          <svg class="w-5 h-5 text-gray-400 dark:text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
            <path d="M4 4m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z"/><path d="M8 4l0 16"/><path d="M16 4l0 16"/><path d="M4 8l4 0"/><path d="M4 12l16 0"/><path d="M4 16l4 0"/><path d="M16 8l4 0"/><path d="M16 16l4 0"/>
          </svg>
        {:else if node.format?.startsWith('audio/')}
          <svg class="w-5 h-5 text-gray-400 dark:text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
            <path d="M3 17a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"/><path d="M6 17v-13l12 -2v13"/><path d="M15 15a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"/>
          </svg>
        {:else}
          <svg class="w-5 h-5 text-gray-400 dark:text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
            <path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z"/>
          </svg>
        {/if}
      </div>

      <!-- Info -->
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate">{node.title}</span>
          {#if node.isRoot}
            <span class="text-xs px-1.5 py-0.5 rounded font-medium bg-orange-200 dark:bg-orange-800/60 text-orange-800 dark:text-orange-200">active</span>
          {:else if node.relationship}
            <span class="text-xs px-1.5 py-0.5 rounded font-medium {relationshipClass(node.relationship)}">{node.relationship}</span>
          {/if}
        </div>
        {#if node.claimGenerator}
          <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{node.claimGenerator}</p>
        {/if}
        {#if node.format}
          <p class="text-xs text-gray-400 dark:text-gray-500 mt-0.5 font-mono">{formatLabel(node.format)}</p>
        {/if}
      </div>
    </div>

    {#if node.children.length > 0}
      <div class="ml-5 mt-1.5 pl-4 border-l-2 border-orange-200 dark:border-orange-800 space-y-1.5 pb-1">
        <svelte:self nodes={node.children} depth={depth + 1} />
      </div>
    {/if}
  </div>
{/each}
