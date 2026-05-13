<script lang="ts">
  import type { OverviewNode } from './types'

  export let node: OverviewNode
  export let onZoom: ((idx: number) => void) | undefined = undefined
  export let isRoot = false
  export let fileSrc: string | undefined = undefined
  export let fileMimeType: string | undefined = undefined
  export let fileName: string | undefined = undefined

  $: previewSrc = fileSrc ?? node.thumbnailSrc

  // One width per child column — populated via bind:clientWidth.
  let colWidths: number[] = []
  $: if (node.children.length !== colWidths.length) {
    colWidths = new Array(node.children.length).fill(0)
  }

  const CONN_H = 56 // height of the connector SVG

  // One cubic-bezier path per child. Vertical tangents at both ends produce
  // smooth S-curves (or a straight line when child is directly below parent).
  $: connPaths = (() => {
    if (!colWidths.length || colWidths.some(w => w === 0)) return []
    const totalW = colWidths.reduce((a, b) => a + b, 0)
    const px = totalW / 2      // parent x (center of row)
    const mid = CONN_H / 2
    let x = 0
    return colWidths.map(w => {
      const cx = x + w / 2    // child x (center of this column)
      x += w
      return `M ${px} 0 C ${px} ${mid}, ${cx} ${mid}, ${cx} ${CONN_H}`
    })
  })()

  $: connW = colWidths.reduce((a, b) => a + b, 0)

  function formatRelationship(r: string): string {
    return r.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim()
  }
</script>

<div class="flex flex-col items-center min-w-0">
  <!-- Card -->
  <button
    class="relative rounded-2xl overflow-hidden border-2 transition-all w-[300px] focus:outline-none
      {node.isStub
        ? 'border-dashed border-gray-300 dark:border-gray-600 cursor-default'
        : isRoot || !onZoom
          ? 'border-blue-500 shadow-lg cursor-default'
          : 'border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500 hover:shadow-md cursor-pointer'}"
    style="aspect-ratio: 4/3"
    on:click={() => onZoom && !isRoot && !node.isStub && onZoom(node.manifestIdx)}
  >
    <!-- Media fill -->
    {#if previewSrc}
      {#if (fileSrc && fileMimeType?.startsWith('video/')) || (!fileSrc && node.mimeType?.startsWith('video/'))}
        <video src={previewSrc} class="absolute inset-0 w-full h-full object-cover" muted playsinline></video>
      {:else}
        <img src={previewSrc} alt="" draggable="false" class="absolute inset-0 w-full h-full object-cover" />
      {/if}
    {:else}
      <!-- Placeholder -->
      <div class="absolute inset-0 {node.isStub ? 'bg-gray-50 dark:bg-gray-900' : 'bg-gray-100 dark:bg-gray-800'} flex items-center justify-center">
        {#if node.mimeType?.startsWith('video/')}
          <svg class="w-10 h-10 text-gray-300 dark:text-gray-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
            <path d="M4 4m0 2a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M8 4l0 16"/><path d="M16 4l0 16"/><path d="M4 8l4 0"/><path d="M4 12l16 0"/><path d="M4 16l4 0"/><path d="M16 8l4 0"/><path d="M16 16l4 0"/>
          </svg>
        {:else if node.mimeType?.startsWith('audio/')}
          <svg class="w-10 h-10 text-gray-300 dark:text-gray-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
            <path d="M3 17a3 3 0 1 0 6 0a3 3 0 0 0-6 0"/><path d="M6 17v-13l12-2v13"/><path d="M15 15a3 3 0 1 0 6 0a3 3 0 0 0-6 0"/>
          </svg>
        {:else}
          <svg class="w-10 h-10 text-gray-300 dark:text-gray-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
            <path d="M15 8h.01"/><path d="M3 6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6z"/><path d="M3 16l5-5c.928-.893 2.072-.893 3 0l5 5"/><path d="M14 14l1-1c.928-.893 2.072-.893 3 0l3 3"/>
          </svg>
        {/if}
      </div>
    {/if}

    <!-- Top-left C2PA badge — hidden for stub nodes -->
    {#if !node.isStub}
      <div class="absolute top-2 left-2 flex items-center bg-white/90 dark:bg-gray-900/85 backdrop-blur-sm rounded-lg px-1.5 py-1 shadow-sm">
        <img src="{import.meta.env.BASE_URL}content_credentials_icon.svg" alt="" class="w-3.5 h-3.5 flex-shrink-0 dark:brightness-0 dark:invert" />
      </div>
    {/if}

    <!-- Hover overlay for non-root -->
    {#if !isRoot && !node.isStub}
      <div class="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors pointer-events-none rounded-2xl"></div>
    {/if}
  </button>

  <!-- Label below card -->
  <div class="mt-2 text-center w-[300px] px-2">
    <!-- Relationship (non-root only) -->
    {#if !isRoot && node.relationship}
      <p class="text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-0.5">
        {formatRelationship(node.relationship)}
      </p>
    {/if}

    <!-- Tool / filename -->
    <p class="text-xs font-semibold {node.isStub ? 'text-gray-400 dark:text-gray-500' : 'text-gray-800 dark:text-gray-200'} truncate">
      {#if node.isStub}
        {node.claimGenerator ?? 'Unknown file'}
      {:else}
        {isRoot ? (fileName ?? 'This File') : (node.claimGenerator ?? 'Unknown')}
      {/if}
    </p>

    <!-- No credentials label for stubs -->
    {#if node.isStub}
      <p class="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5 italic">No Content Credentials</p>
    {:else}
      <!-- Date -->
      {#if node.date}
        <p class="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{node.date}</p>
      {/if}

      <!-- Actions -->
      {#if node.inceptions.length > 0 || node.transformations.length > 0}
        <div class="flex flex-wrap justify-center gap-0.5 mt-1.5">
          {#each node.inceptions as s}
            <span class="text-[10px] px-1.5 py-0.5 rounded font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">{s}</span>
          {/each}
          {#each node.transformations as s}
            <span class="text-[10px] px-1.5 py-0.5 rounded font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">{s}</span>
          {/each}
        </div>
      {/if}
    {/if}
  </div>

  <!-- Subtree -->
  {#if node.children.length > 0}
    <!-- SVG connector: one bezier curve from parent-center to each child-center -->
    <svg
      width={connW || 1}
      height={CONN_H}
      class="mt-2 flex-shrink-0 overflow-visible text-gray-300 dark:text-gray-600"
      aria-hidden="true"
    >
      {#each connPaths as d, i}
        <path
          {d}
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-dasharray={node.children[i]?.isStub ? '5 4' : undefined}
        />
      {/each}
    </svg>

    <!-- Children row — no individual stems, the SVG handles the full span -->
    <div class="flex flex-row">
      {#each node.children as child, i}
        <div class="flex flex-col items-center px-3" bind:clientWidth={colWidths[i]}>
          <svelte:self node={child} {onZoom} isRoot={false} />
        </div>
      {/each}
    </div>
  {/if}
</div>
