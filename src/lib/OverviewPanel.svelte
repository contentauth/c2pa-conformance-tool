<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte'
  import TreeNode from './TreeNode.svelte'
  import type { OverviewNode, ConformanceReport, CrJsonManifestEntry } from './types'
  import type { SignalsRubricResult } from './rubrics/types'
  import { getClaimInfo, getSignatureInfo } from './crjson'
  import { evaluateReportSignals } from './summarySignals'

  export let report: ConformanceReport
  export let file: File | null = null

  // Object URL for the opened file — revoked when file changes or component is destroyed
  let fileSrc: string | undefined
  $: {
    if (fileSrc) URL.revokeObjectURL(fileSrc)
    fileSrc = file ? URL.createObjectURL(file) : undefined
  }
  onMount(() => {
    window.addEventListener('resize', fitToTree)
    return () => window.removeEventListener('resize', fitToTree)
  })
  onDestroy(() => {
    if (fileSrc) URL.revokeObjectURL(fileSrc)
    document.removeEventListener('mousemove', onDocMouseMove)
    document.removeEventListener('mouseup', onDocMouseUp)
  })

  let signals: SignalsRubricResult | null = null

  // Reload signals whenever report changes
  $: {
    const current = report
    signals = null
    evaluateReportSignals(current).then(result => {
      if (report === current) signals = result
    })
  }

  $: labelIndex = (() => {
    const m = new Map<string, number>()
    report.manifests?.forEach((mf, i) => {
      if (typeof mf.label === 'string') m.set(mf.label, i)
    })
    return m
  })()

  $: tree = buildTree(0, report, signals, labelIndex)

  // ── Pan / zoom ────────────────────────────────────────────────────────

  const MIN_ZOOM = 0.1
  const MAX_ZOOM = 3
  const FIT_PAD = 48 // px padding around tree in fit view

  let canvasEl: HTMLDivElement
  let contentEl: HTMLDivElement
  let containerWidth = 0

  let panX = 0
  let panY = FIT_PAD
  let zoom = 1

  // Stored fit-view state — reset button returns here
  let _fitPanX = 0
  let _fitPanY = FIT_PAD
  let _fitZoom = 1

  let isDragging = false
  let _dragStartX = 0
  let _dragStartY = 0
  let _dragStartPanX = 0
  let _dragStartPanY = 0

  // Scroll to top when a new report loads; refit pan/zoom when report or width changes.
  // NOT triggered by `signals` arrival so the user's pan state survives that async update.
  $: if (report) window.scrollTo({ top: 0, behavior: 'instant' })
  $: if (report && containerWidth > 0) tick().then(fitToTree)

  async function fitToTree() {
    if (!contentEl || !canvasEl || !containerWidth) return
    await tick()

    const naturalW = contentEl.offsetWidth
    const naturalH = contentEl.offsetHeight
    if (naturalW === 0 || naturalH === 0) return

    // Root card (w-[300px]) starts at 1:1 scale.
    const fitZoom = 1
    // Center on the root node horizontally; leave FIT_PAD from the top.
    const fitPanX = containerWidth / 2 - (naturalW / 2) * fitZoom
    const fitPanY = FIT_PAD

    _fitPanX = fitPanX
    _fitPanY = fitPanY
    _fitZoom = fitZoom

    panX = fitPanX
    panY = fitPanY
    zoom = fitZoom
  }

  function resetView() {
    panX = _fitPanX
    panY = _fitPanY
    zoom = _fitZoom
  }

  function onMouseDown(e: MouseEvent) {
    if (e.button !== 0) return
    isDragging = true
    _dragStartX = e.clientX
    _dragStartY = e.clientY
    _dragStartPanX = panX
    _dragStartPanY = panY
    document.addEventListener('mousemove', onDocMouseMove)
    document.addEventListener('mouseup', onDocMouseUp)
  }

  function onDocMouseMove(e: MouseEvent) {
    if (!isDragging) return
    const dx = e.clientX - _dragStartX
    const dy = e.clientY - _dragStartY
    panX = _dragStartPanX + dx
    panY = _dragStartPanY + dy
  }

  function onDocMouseUp() {
    isDragging = false
    document.removeEventListener('mousemove', onDocMouseMove)
    document.removeEventListener('mouseup', onDocMouseUp)
  }

  function onMouseMove(e: MouseEvent) {
    if (!isDragging) return
    const dx = e.clientX - _dragStartX
    const dy = e.clientY - _dragStartY
    panX = _dragStartPanX + dx
    panY = _dragStartPanY + dy
  }

  function onMouseUp() {
    isDragging = false
  }

  function onWheel(e: WheelEvent) {
    if (!canvasEl) return
    const rect = canvasEl.getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    // Normalise: trackpads report tiny deltas, mice report large ones.
    const delta = e.deltaY !== 0 ? e.deltaY : -e.deltaX
    const factor = 1 - Math.sign(delta) * Math.min(Math.abs(delta) * 0.002, 0.15)
    applyZoom(zoom * factor, cx, cy)
  }

  function applyZoom(newZoom: number, cx: number, cy: number) {
    newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, newZoom))
    panX = cx - (cx - panX) * (newZoom / zoom)
    panY = cy - (cy - panY) * (newZoom / zoom)
    zoom = newZoom
  }

  function stepZoom(direction: 1 | -1) {
    if (!canvasEl) return
    const rect = canvasEl.getBoundingClientRect()
    applyZoom(zoom * (1 + direction * 0.2), rect.width / 2, rect.height / 2)
  }

  // Touch support via an action so we can register non-passive touchmove.
  let _lastTouchDist = 0

  function touchAction(node: HTMLDivElement) {
    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 1) {
        isDragging = true
        _dragStartX = e.touches[0].clientX
        _dragStartY = e.touches[0].clientY
        _dragStartPanX = panX
        _dragStartPanY = panY
        _lastTouchDist = 0
      } else if (e.touches.length === 2) {
        isDragging = false
        _lastTouchDist = Math.hypot(
          e.touches[1].clientX - e.touches[0].clientX,
          e.touches[1].clientY - e.touches[0].clientY,
        )
      }
    }

    function onTouchMove(e: TouchEvent) {
      e.preventDefault()
      if (e.touches.length === 1 && isDragging) {
        const dx = e.touches[0].clientX - _dragStartX
        const dy = e.touches[0].clientY - _dragStartY
        panX = _dragStartPanX + dx
        panY = _dragStartPanY + dy
      } else if (e.touches.length === 2 && _lastTouchDist > 0) {
        const dist = Math.hypot(
          e.touches[1].clientX - e.touches[0].clientX,
          e.touches[1].clientY - e.touches[0].clientY,
        )
        const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2
        const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2
        const rect = node.getBoundingClientRect()
        applyZoom(zoom * (dist / _lastTouchDist), midX - rect.left, midY - rect.top)
        _lastTouchDist = dist
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (e.touches.length < 2) _lastTouchDist = 0
      if (e.touches.length === 0) isDragging = false
    }

    node.addEventListener('touchstart', onTouchStart, { passive: true })
    node.addEventListener('touchmove', onTouchMove, { passive: false })
    node.addEventListener('touchend', onTouchEnd, { passive: true })

    return {
      destroy() {
        node.removeEventListener('touchstart', onTouchStart)
        node.removeEventListener('touchmove', onTouchMove)
        node.removeEventListener('touchend', onTouchEnd)
      },
    }
  }

  // ── Tree building ─────────────────────────────────────────────────────

  // Extract the manifest label from a JUMBF URL.
  // Handles both new-style (urn:c2pa:UUID) and old-style (self#jumbf=/c2pa/<label>) formats.
  function parseManifestLabel(url: string): string {
    const prefix = '/c2pa/'
    const i = url.indexOf(prefix)
    if (i >= 0) {
      const after = url.slice(i + prefix.length)
      const slash = after.indexOf('/')
      return slash >= 0 ? after.slice(0, slash) : after
    }
    const urnIdx = url.indexOf('urn:c2pa:')
    if (urnIdx >= 0) {
      const tail = url.slice(urnIdx)
      const slash = tail.indexOf('/')
      return slash >= 0 ? tail.slice(0, slash) : tail
    }
    return url
  }

  function manifestFormat(m: CrJsonManifestEntry): string | undefined {
    const claim = ((m['claim.v2'] ?? m.claim) ?? {}) as Record<string, unknown>
    if (typeof claim['dc:format'] === 'string') return claim['dc:format'] as string
    for (const [key, value] of Object.entries((m.assertions ?? {}) as Record<string, unknown>)) {
      if (!key.startsWith('c2pa.thumbnail') || !value || typeof value !== 'object') continue
      const fmt = (value as Record<string, unknown>).format
      if (typeof fmt === 'string') return fmt
    }
    return undefined
  }

  function thumbnailSrc(m: CrJsonManifestEntry): string | undefined {
    for (const [key, value] of Object.entries((m.assertions ?? {}) as Record<string, unknown>)) {
      if (!key.startsWith('c2pa.thumbnail') || !value || typeof value !== 'object') continue
      const v = value as Record<string, unknown>
      if (typeof v.data !== 'string' || !v.data) continue
      const fmt = typeof v.format === 'string' ? v.format : 'image/jpeg'
      const raw = v.data
      const b64 = raw.startsWith("b64'") && raw.endsWith("'") ? raw.slice(4, -1) : raw
      return `data:${fmt};base64,${b64}`
    }
    return undefined
  }

  type Edge = { childIdx: number | null; relationship?: string; stubTitle?: string; stubFormat?: string }

  function crJsonEdges(
    m: CrJsonManifestEntry,
    idx: Map<string, number>
  ): Edge[] {
    const out: Edge[] = []
    for (const [key, raw] of Object.entries((m.assertions ?? {}) as Record<string, unknown>)) {
      if (!key.startsWith('c2pa.ingredient') || !raw || typeof raw !== 'object') continue
      const v = raw as Record<string, unknown>
      const relationship = v.relationship as string | undefined
      const stubTitle = (v.title ?? v.dc_title) as string | undefined
      const stubFormat = (v.format ?? v.dc_format) as string | undefined
      // v1: c2pa_manifest is an object { url, alg, hash }
      // v2: active_manifest is a direct string (manifest label)
      const manifestRef = (v.c2pa_manifest ?? v.activeManifest) as Record<string, unknown> | undefined
      const activeManifestStr = v['active_manifest'] as string | undefined
      const url = (manifestRef?.url as string | undefined) ?? (typeof activeManifestStr === 'string' ? activeManifestStr : undefined)
      if (!url) {
        // No manifest reference — ingredient has no Content Credentials
        out.push({ childIdx: null, relationship, stubTitle, stubFormat })
      } else {
        const childIdx = idx.get(parseManifestLabel(url))
        if (childIdx != null) {
          out.push({ childIdx, relationship })
        } else {
          // Manifest referenced but not present in this report
          out.push({ childIdx: null, relationship, stubTitle, stubFormat })
        }
      }
    }
    return out
  }

  function makeStubNode(edge: Edge): OverviewNode {
    return {
      manifestIdx: -1,
      claimGenerator: edge.stubTitle,
      mimeType: edge.stubFormat ?? null,
      thumbnailSrc: undefined,
      date: undefined,
      ingredientCount: 0,
      inceptions: [],
      transformations: [],
      relationship: edge.relationship,
      isStub: true,
      children: [],
    }
  }

  function buildTree(
    rootIdx: number,
    r: ConformanceReport,
    s: SignalsRubricResult | null,
    idx: Map<string, number>,
    visited: Set<number> = new Set()
  ): OverviewNode | null {
    if (visited.has(rootIdx)) return null
    visited.add(rootIdx)

    const manifest = r.manifests?.[rootIdx]
    if (!manifest) return null

    const sigData = s?.manifests[rootIdx]
    const claimInfo = getClaimInfo(manifest)

    const allCrJsonEdges = crJsonEdges(manifest, idx)
    const edges: Edge[] = sigData
      ? [
          // sigData has better relationship/index data for credentialed ingredients
          ...sigData.ingredients.map(e => ({ childIdx: e.index, relationship: e.relationship })),
          // but extractIngredients skips uncredentialed ones — add them from crJsonEdges
          ...allCrJsonEdges.filter(e => e.childIdx === null),
        ]
      : allCrJsonEdges

    const children: OverviewNode[] = []
    for (const edge of edges) {
      if (edge.childIdx == null) {
        children.push(makeStubNode(edge))
      } else {
        const child = buildTree(edge.childIdx, r, s, idx, new Set(visited))
        if (child) {
          child.relationship = edge.relationship
          children.push(child)
        } else if (!r.manifests?.[edge.childIdx]) {
          // Referenced index has no manifest entry
          children.push(makeStubNode(edge))
        }
      }
    }

    const sigInfo = getSignatureInfo(manifest)
    const rawDate = sigInfo?.time
    const date = rawDate ? new Date(rawDate).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : undefined

    return {
      manifestIdx: rootIdx,
      claimGenerator: claimInfo.claim_generator_info?.[0]?.name ?? claimInfo.claim_generator,
      mimeType: sigData?.mimeType ?? manifestFormat(manifest) ?? null,
      thumbnailSrc: thumbnailSrc(manifest),
      date,
      ingredientCount: children.length,
      inceptions: sigData?.localInceptions.map(h => h.reportText) ?? [],
      transformations: sigData?.localTransformations.map(h => h.reportText) ?? [],
      relationship: undefined,
      isStub: false,
      children,
    }
  }
</script>

{#if tree}
  <!-- Pan/zoom canvas -->
  <div
    bind:this={canvasEl}
    bind:clientWidth={containerWidth}
    use:touchAction
    class="relative w-full flex-1 overflow-hidden rounded-2xl"
    style="cursor: {isDragging ? 'grabbing' : 'grab'}; background-color: var(--canvas-bg, #f8f9fb);"
    role="application"
    aria-label="Provenance tree — drag to pan, scroll to zoom"
    on:mousedown={onMouseDown}
    on:mousemove={onMouseMove}
    on:mouseup={onMouseUp}
    on:mouseleave={onMouseUp}
    on:wheel|preventDefault={onWheel}
    on:dragstart|preventDefault={() => {}}
  >
    <!-- Canvas background -->
    <div class="absolute inset-0 bg-gray-50 dark:bg-gray-900/60 pointer-events-none rounded-2xl"></div>

    <!-- Tree content (panned and scaled) -->
    <div
      bind:this={contentEl}
      style="position: absolute; top: 0; left: 0;
             transform: translate({panX}px, {panY}px) scale({zoom});
             transform-origin: 0 0;"
    >
      <TreeNode
        node={tree}
        isRoot={true}
        fileSrc={fileSrc}
        fileMimeType={file?.type}
        fileName={file?.name}
      />
    </div>

    <!-- Zoom controls -->
    <div class="absolute bottom-3 right-3 flex flex-col gap-1 z-10 select-none">
      <button
        on:click|stopPropagation={() => stepZoom(1)}
        class="w-8 h-8 rounded-lg bg-white/90 dark:bg-gray-800/90 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-center shadow-sm backdrop-blur-sm transition-colors text-xl font-light leading-none"
        title="Zoom in (scroll up)"
      >+</button>
      <button
        on:click|stopPropagation={resetView}
        class="w-8 h-8 rounded-lg bg-white/90 dark:bg-gray-800/90 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-center shadow-sm backdrop-blur-sm transition-colors"
        title="Reset view"
      >
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
          <path d="M3 3v5h5"/>
        </svg>
      </button>
      <button
        on:click|stopPropagation={() => stepZoom(-1)}
        class="w-8 h-8 rounded-lg bg-white/90 dark:bg-gray-800/90 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-center shadow-sm backdrop-blur-sm transition-colors text-xl font-light leading-none"
        title="Zoom out (scroll down)"
      >−</button>
    </div>

    <!-- Signal loading hint (floating bottom-left) -->
    {#if !signals}
      <p class="absolute bottom-3 left-3 text-xs text-gray-400 dark:text-gray-600 pointer-events-none">Loading signal data…</p>
    {/if}
  </div>
{:else}
  <p class="text-center py-12 text-gray-400 dark:text-gray-600 text-sm">No manifest data</p>
{/if}
