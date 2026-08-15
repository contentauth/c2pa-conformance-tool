<script lang="ts">
  import type { OverviewNode } from './types'

  export let node: OverviewNode
  export let onZoom: ((idx: number) => void) | undefined = undefined
  export let isRoot = false
  export let fileSrc: string | undefined = undefined
  export let fileMimeType: string | undefined = undefined

  const BROWSER_PREVIEWABLE_IMAGES = new Set([
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
    'image/avif', 'image/svg+xml', 'image/bmp', 'image/ico', 'image/x-icon',
  ])

  // Prefer the C2PA manifest's declared format (authoritative, read from file content)
  // over the browser-reported MIME type, which can be empty or generic.
  $: effectiveMimeType = node.mimeType || fileMimeType || null

  // Determines what to render in the card media area.
  // 'video-live'  — root video file, show <video controls>
  // 'audio-live'  — root audio file, show icon placeholder + <audio controls> below card
  // 'image'       — previewable image or thumbnail, show <img>
  // 'placeholder' — nothing renderable, show type icon
  $: cardMedia = (() => {
    if (fileSrc) {
      if (effectiveMimeType?.startsWith('video/')) return 'video-live'
      if (effectiveMimeType?.startsWith('audio/')) return 'audio-live'
      if (effectiveMimeType?.startsWith('image/') && BROWSER_PREVIEWABLE_IMAGES.has(effectiveMimeType ?? '')) return 'image'
      return 'placeholder'
    }
    if (node.thumbnailSrc) return 'image'
    return 'placeholder'
  })()

  $: imageSrc = cardMedia === 'image' ? (fileSrc ?? node.thumbnailSrc) : undefined

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
          : 'border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500 hover:shadow-sm cursor-pointer'}"
    style="aspect-ratio: 4/3"
    on:click={() => onZoom && !isRoot && !node.isStub && onZoom(node.manifestIdx)}
  >
    <!-- Media fill -->
    {#if cardMedia === 'video-live'}
      <video src={fileSrc} controls playsinline class="absolute inset-0 w-full h-full object-cover">
        <track kind="captions" />
      </video>
    {:else if cardMedia === 'audio-live'}
      <div class="absolute inset-0 bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
        <svg class="w-10 h-10 text-gray-300 dark:text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
          <path d="M3 17a3 3 0 1 0 6 0a3 3 0 0 0-6 0"/><path d="M6 17v-13l12-2v13"/><path d="M15 15a3 3 0 1 0 6 0a3 3 0 0 0-6 0"/>
        </svg>
      </div>
    {:else if cardMedia === 'image'}
      <img src={imageSrc} alt="" draggable="false" class="absolute inset-0 w-full h-full object-cover" />
    {:else}
      <!-- Placeholder icon: pick by content type -->
      <div class="absolute inset-0 {node.isStub ? 'bg-gray-50 dark:bg-gray-900' : 'bg-gray-100 dark:bg-gray-800'} flex items-center justify-center">
        {#if effectiveMimeType?.startsWith('video/')}
          <svg class="w-10 h-10 text-gray-300 dark:text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
            <path d="M4 4m0 2a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M8 4l0 16"/><path d="M16 4l0 16"/><path d="M4 8l4 0"/><path d="M4 12l16 0"/><path d="M4 16l4 0"/><path d="M16 8l4 0"/><path d="M16 16l4 0"/>
          </svg>
        {:else if effectiveMimeType?.startsWith('audio/')}
          <svg class="w-10 h-10 text-gray-300 dark:text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
            <path d="M3 17a3 3 0 1 0 6 0a3 3 0 0 0-6 0"/><path d="M6 17v-13l12-2v13"/><path d="M15 15a3 3 0 1 0 6 0a3 3 0 0 0-6 0"/>
          </svg>
        {:else if effectiveMimeType?.startsWith('application/')}
          <svg class="w-10 h-10 text-gray-300 dark:text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
            <path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z"/><path d="M9 17h6"/><path d="M9 13h6"/>
          </svg>
        {:else}
          <svg class="w-10 h-10 text-gray-300 dark:text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
            <path d="M15 8h.01"/><path d="M3 6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6z"/><path d="M3 16l5-5c.928-.893 2.072-.893 3 0l5 5"/><path d="M14 14l1-1c.928-.893 2.072-.893 3 0l3 3"/>
          </svg>
        {/if}
      </div>
    {/if}

    <!-- Top-left C2PA badge — hidden for stub nodes -->
    {#if !node.isStub}
      <div class="absolute top-2 left-2 flex items-center bg-white/90 dark:bg-gray-900/85 backdrop-blur-sm rounded-lg px-2 py-1 shadow-sm">
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
      <p class="text-xs font-medium text-gray-400 dark:text-gray-400 uppercase tracking-wide mb-1">
        {formatRelationship(node.relationship)}
      </p>
    {/if}

    <!-- Tool / filename -->
    <p class="text-xs font-semibold {node.isStub ? 'text-gray-400 dark:text-gray-400' : 'text-gray-800 dark:text-gray-200'} truncate">
      {#if node.isStub}
        {node.signer ?? 'Unknown file'}
      {:else}
        {node.signer ?? 'Unknown'}
      {/if}
    </p>

    <!-- No credentials label for stubs -->
    {#if node.isStub}
      <p class="text-xs text-gray-400 dark:text-gray-400 mt-1 italic">No Content Credentials</p>
    {:else}
      <!-- Date -->
      {#if node.date}
        <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">{node.date}</p>
      {/if}

      <!-- Actions -->
      {#if node.inceptions.length > 0 || node.transformations.length > 0}
        <div class="flex flex-wrap justify-center gap-1 mt-2">
          {#each node.inceptions as s}
            <span class="badge bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">{s}</span>
          {/each}
          {#each node.transformations as s}
            <span class="badge bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">{s}</span>
          {/each}
        </div>
      {/if}
    {/if}
  </div>

  <!-- Audio player — shown below the card for the root audio file -->
  {#if cardMedia === 'audio-live' && fileSrc}
    <audio src={fileSrc} controls class="w-[300px] mt-2 rounded-lg">
      Your browser does not support audio playback.
    </audio>
  {/if}

  <!-- Subtree -->
  {#if node.children.length > 0}
    <!-- SVG connector: one bezier curve from parent-center to each child-center -->
    <svg
      width={connW || 1}
      height={CONN_H}
      class="mt-2 flex-shrink-0 overflow-visible text-gray-300 dark:text-gray-500"
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
        <div class="flex flex-col items-center px-4" bind:clientWidth={colWidths[i]}>
          <svelte:self node={child} {onZoom} isRoot={false} />
        </div>
      {/each}
    </div>
  {/if}
</div>
