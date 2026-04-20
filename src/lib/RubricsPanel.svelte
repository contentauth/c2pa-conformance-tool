<script lang="ts">
  import { onMount } from 'svelte'
  import type { ConformanceReport } from './types'
  import type {
    AnyRubricResult,
    ManifestSignalsResult,
    RubricIndexEntry,
    RubricResult,
    SignalsRubricResult,
  } from './rubrics/types'
  import { loadRubric, loadRubricIndex } from './rubrics/loader'
  import { evaluateRubric } from './rubrics/evaluate'
  import { evaluatePerManifest } from './rubrics/perManifest'

  export let report: ConformanceReport

  // ── Index / available rubrics ────────────────────────────────────────
  let index: RubricIndexEntry[] = []
  let indexLoading = true
  let indexError: string | null = null

  // Cache of parsed rubric YAMLs keyed by filename, to avoid refetching.
  const rubricCache = new Map<string, Promise<import('./rubrics/types').Rubric>>()

  // ── Selection state ──────────────────────────────────────────────────
  let selected: Set<string> = new Set()

  // ── Results state ────────────────────────────────────────────────────
  // Results carry a `mode` discriminator so the template can dispatch.
  let results: AnyRubricResult[] = []
  let ranAt: Date | null = null
  let running = false
  let runError: string | null = null

  // When a new file is loaded while this tab is open, the `report` prop changes
  // in place (the panel isn't unmounted). Without this, stale results from the
  // previous file would linger until the user clicks Evaluate again — a subtle
  // correctness bug since the results' reportText references the prior asset.
  // The rubric *index* and selection are fine to preserve; it's only the
  // evaluation output that's tied to a specific `report` instance.
  let lastReport: ConformanceReport | null = null
  $: if (report !== lastReport) {
    lastReport = report
    results = []
    ranAt = null
    runError = null
  }

  onMount(async () => {
    try {
      index = await loadRubricIndex()
      // Auto-select the first rubric to make the empty state less stark.
      if (index.length > 0) selected = new Set([index[0].id])
    } catch (e) {
      indexError = e instanceof Error ? e.message : String(e)
    } finally {
      indexLoading = false
    }
  })

  function toggle(rubricId: string) {
    if (selected.has(rubricId)) {
      selected.delete(rubricId)
    } else {
      selected.add(rubricId)
    }
    selected = selected
  }

  function selectAll() {
    selected = new Set(index.map((r) => r.id))
  }

  function clearAll() {
    selected = new Set()
  }

  async function runSelected() {
    if (selected.size === 0 || running) return
    running = true
    runError = null
    try {
      const entries = index.filter((r) => selected.has(r.id))
      const rubrics = await Promise.all(
        entries.map((entry) => {
          let p = rubricCache.get(entry.filename)
          if (!p) {
            p = loadRubric(entry.filename)
            rubricCache.set(entry.filename, p)
          }
          return p.then((rubric) => ({ entry, rubric }))
        }),
      )
      results = rubrics.map(({ entry, rubric }): AnyRubricResult => {
        if (entry.mode === 'per-manifest') {
          return evaluatePerManifest(rubric, report, { rubricId: entry.id })
        }
        // Default to document mode (backwards-compatible when mode is absent).
        const r = evaluateRubric(rubric, report, { rubricId: entry.id })
        return { ...r, mode: 'document' }
      })
      ranAt = new Date()
    } catch (e) {
      runError = e instanceof Error ? e.message : String(e)
      results = []
    } finally {
      running = false
    }
  }

  // Group statements within a single document-mode result by outcome.
  function groupByOutcome(result: RubricResult) {
    const passed: RubricResult['statements'] = []
    const failed: RubricResult['statements'] = []
    const errored: RubricResult['statements'] = []
    for (const s of result.statements) {
      if (s.passed === true) passed.push(s)
      else if (s.passed === false) failed.push(s)
      else errored.push(s)
    }
    return { passed, failed, errored }
  }

  function isDocumentResult(r: AnyRubricResult): r is RubricResult & { mode: 'document' } {
    return r.mode === 'document'
  }

  function isSignalsResult(r: AnyRubricResult): r is SignalsRubricResult {
    return r.mode === 'per-manifest'
  }

  function formatAssertedBy(a: ManifestSignalsResult['assertedBy']): string {
    const parts = [a.CN, a.O]
    if (a.OU) parts.push(a.OU)
    return parts.join(' · ')
  }

  function totalSignalCount(m: ManifestSignalsResult): number {
    return m.localInceptions.length + m.localTransformations.length
  }

  // Summary counts in the header. For document-mode rubrics we count rubrics
  // that overall-passed; for signals rubrics we count those that surfaced any
  // signal on any manifest (purely informational — signals don't pass/fail).
  $: docResults = results.filter(isDocumentResult)
  $: signalsResults = results.filter(isSignalsResult)
  $: docPassCount = docResults.filter((r) => r.overallPassed).length
  $: totalCount = results.length

  /**
   * Group the flat index into `{ category, entries[] }[]`, preserving the
   * order categories first appear in the index so the curator controls the
   * visual order. Missing `category` falls back to "Other".
   */
  function groupByCategory(
    entries: RubricIndexEntry[],
  ): { category: string; entries: RubricIndexEntry[] }[] {
    const order: string[] = []
    const buckets = new Map<string, RubricIndexEntry[]>()
    for (const e of entries) {
      const cat = e.category ?? 'Other'
      if (!buckets.has(cat)) {
        buckets.set(cat, [])
        order.push(cat)
      }
      buckets.get(cat)!.push(e)
    }
    return order.map((category) => ({ category, entries: buckets.get(category)! }))
  }

  $: groups = groupByCategory(index)
</script>

<div class="space-y-6">
  <!-- Rubric selector -->
  <div class="bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-2xl p-5 shadow-sm">
    <div class="flex items-center justify-between gap-4 mb-3 pb-3 border-b border-gray-200 dark:border-gray-700">
      <div class="flex items-center gap-2.5">
        <div class="w-7 h-7 bg-gray-800 dark:bg-gray-700 rounded-md flex items-center justify-center text-white shadow-sm">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path stroke="none" d="M0 0h24v24H0z" fill="none" />
            <path d="M9 5h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2h-2" />
            <path d="M9 3m0 2a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v0a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2z" />
            <path d="M9 14l2 2l4 -4" />
          </svg>
        </div>
        <h3 class="text-base font-semibold text-gray-900 dark:text-white">Available Rubrics</h3>
      </div>
      {#if index.length > 0}
        <div class="flex items-center gap-1 text-xs">
          <button
            on:click={selectAll}
            class="px-2 py-1 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
          >
            Select all
          </button>
          <button
            on:click={clearAll}
            class="px-2 py-1 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
          >
            Clear
          </button>
        </div>
      {/if}
    </div>

    {#if indexLoading}
      <p class="text-sm text-gray-500 dark:text-gray-400">Loading rubrics…</p>
    {:else if indexError}
      <div class="text-sm text-red-700 dark:text-gray-200 bg-red-50 dark:bg-gray-900 border border-red-200 dark:border-gray-700 rounded-lg p-4">
        Failed to load rubric index: {indexError}
      </div>
    {:else if index.length === 0}
      <p class="text-sm text-gray-500 dark:text-gray-400">No rubrics available.</p>
    {:else}
      <div class="space-y-3">
        {#each groups as group (group.category)}
          <section>
            <!-- Category divider: small-caps label + hairline rule. -->
            <div class="flex items-center gap-3 mb-1.5">
              <h4 class="text-[11px] font-bold uppercase tracking-[0.12em] text-gray-500 dark:text-gray-400">
                {group.category}
              </h4>
              <div class="flex-1 h-px bg-gray-200 dark:bg-gray-700"></div>
              <span class="text-[11px] text-gray-400 dark:text-gray-500">
                {group.entries.length}
              </span>
            </div>
            <ul class="space-y-1.5">
              {#each group.entries as rubric (rubric.id)}
                {@const isChecked = selected.has(rubric.id)}
                <li>
                  <label
                    title={rubric.description}
                    class="flex items-center gap-2.5 px-3 py-2 border rounded-lg cursor-pointer transition-colors {isChecked
                      ? 'border-blue-400 bg-blue-50/50 dark:border-gray-500 dark:bg-gray-900/40'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'}"
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      on:change={() => toggle(rubric.id)}
                      class="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 flex-shrink-0"
                    />
                    <div class="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                      <span class="font-semibold text-gray-900 dark:text-white text-sm">{rubric.name}</span>
                      {#if rubric.mode === 'per-manifest'}
                        <span class="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-indigo-100 text-indigo-800 dark:bg-gray-700 dark:text-gray-200">
                          signals
                        </span>
                      {/if}
                      <span class="text-xs text-gray-400 dark:text-gray-500 font-mono truncate">{rubric.id}</span>
                    </div>
                  </label>
                </li>
              {/each}
            </ul>
          </section>
        {/each}
      </div>

      <div class="mt-4 flex items-center justify-between gap-4">
        <p class="text-xs text-gray-500 dark:text-gray-400">
          {selected.size} of {index.length} selected
        </p>
        <button
          on:click={runSelected}
          disabled={selected.size === 0 || running}
          class="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg shadow-sm transition-colors"
        >
          {#if running}
            <svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path stroke="none" d="M0 0h24v24H0z" fill="none" />
              <path d="M12 3a9 9 0 1 0 9 9" />
            </svg>
            Evaluating…
          {:else}
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path stroke="none" d="M0 0h24v24H0z" fill="none" />
              <path d="M7 4v16l13 -8z" />
            </svg>
            Evaluate selected
          {/if}
        </button>
      </div>
    {/if}
  </div>

  <!-- Run error -->
  {#if runError}
    <div class="bg-red-50 dark:bg-gray-900 border border-red-200 dark:border-gray-700 rounded-2xl p-5 shadow-sm">
      <h4 class="font-semibold text-red-900 dark:text-gray-100 text-sm mb-1">Evaluation failed</h4>
      <p class="text-sm text-red-800 dark:text-gray-300 leading-relaxed">{runError}</p>
    </div>
  {/if}

  <!-- Results -->
  {#if results.length > 0}
    <div class="bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-2xl p-8 shadow-sm">
      <div class="flex items-center justify-between gap-4 mb-6 pb-4 border-b border-gray-200 dark:border-gray-700">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 bg-gray-800 dark:bg-gray-700 rounded-lg flex items-center justify-center text-white shadow-md">
            <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path stroke="none" d="M0 0h24v24H0z" fill="none" />
              <path d="M9 11l3 3l8 -8" />
              <path d="M20 12v6a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2h9" />
            </svg>
          </div>
          <div>
            <h3 class="text-xl font-semibold text-gray-900 dark:text-white">Results</h3>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              {#if docResults.length > 0}
                <span class="font-semibold {docPassCount === docResults.length ? 'text-green-700 dark:text-gray-200' : 'text-red-700 dark:text-gray-200'}">
                  {docPassCount} of {docResults.length} pass/fail rubrics passed
                </span>
              {/if}
              {#if docResults.length > 0 && signalsResults.length > 0}
                <span class="text-gray-400 dark:text-gray-500"> · </span>
              {/if}
              {#if signalsResults.length > 0}
                <span class="font-semibold text-gray-700 dark:text-gray-300">
                  {signalsResults.length} signals rubric{signalsResults.length === 1 ? '' : 's'}
                </span>
              {/if}
              {#if ranAt}
                <span class="text-gray-400 dark:text-gray-500"> · evaluated {ranAt.toLocaleTimeString()}</span>
              {/if}
            </p>
          </div>
        </div>
      </div>

      <ul class="space-y-4">
        {#each results as r (r.rubricId)}
          {#if isDocumentResult(r)}
            {@const grouped = groupByOutcome(r)}
            <li class="border-2 rounded-xl p-5 {r.overallPassed
              ? 'border-green-200 bg-green-50/50 dark:border-gray-700 dark:bg-gray-900/40'
              : 'border-red-200 bg-red-50/50 dark:border-gray-700 dark:bg-gray-900/40'}">
              <div class="flex items-start gap-3 mb-3">
                {#if r.overallPassed}
                  <div class="flex-shrink-0 w-8 h-8 bg-green-500 dark:bg-gray-600 rounded-full flex items-center justify-center text-white">
                    <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M5 12l5 5l10 -10" />
                    </svg>
                  </div>
                {:else}
                  <div class="flex-shrink-0 w-8 h-8 bg-red-500 dark:bg-gray-600 rounded-full flex items-center justify-center text-white">
                    <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M18 6l-12 12" /><path d="M6 6l12 12" />
                    </svg>
                  </div>
                {/if}
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-semibold text-gray-900 dark:text-white">{r.rubricName}</span>
                    {#if r.rubricVersion}
                      <span class="text-xs text-gray-400 dark:text-gray-500 font-mono">v{r.rubricVersion}</span>
                    {/if}
                    <span class="px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide {r.overallPassed
                      ? 'bg-green-100 text-green-800 dark:bg-gray-800 dark:text-gray-200'
                      : 'bg-red-100 text-red-800 dark:bg-gray-800 dark:text-gray-200'}">
                      {r.overallPassed ? 'Pass' : 'Fail'}
                    </span>
                    <span class="text-xs text-gray-500 dark:text-gray-400">
                      {r.statements.filter((s) => s.passed === true).length}/{r.statements.length} checks passed
                    </span>
                  </div>
                </div>
              </div>

              <!-- Failures first (most interesting), then errors, then passes. -->
              {#if grouped.failed.length > 0}
                <div class="mt-3">
                  <h5 class="text-xs font-semibold text-red-700 dark:text-gray-300 uppercase tracking-wider mb-2">Failed</h5>
                  <ul class="space-y-1.5">
                    {#each grouped.failed as s (s.id)}
                      <li class="flex items-start gap-2 text-sm">
                        <svg class="w-4 h-4 text-red-600 dark:text-gray-400 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M18 6l-12 12" /><path d="M6 6l12 12" />
                        </svg>
                        <div class="flex-1 min-w-0">
                          <p class="text-gray-700 dark:text-gray-300">{s.message || s.description || s.id}</p>
                          <p class="text-xs text-gray-400 dark:text-gray-500 font-mono mt-0.5">{s.id}</p>
                        </div>
                      </li>
                    {/each}
                  </ul>
                </div>
              {/if}

              {#if grouped.errored.length > 0}
                <div class="mt-3">
                  <h5 class="text-xs font-semibold text-amber-700 dark:text-gray-300 uppercase tracking-wider mb-2">Errored</h5>
                  <ul class="space-y-1.5">
                    {#each grouped.errored as s (s.id)}
                      <li class="flex items-start gap-2 text-sm">
                        <svg class="w-4 h-4 text-amber-600 dark:text-gray-400 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M12 9v4" /><path d="M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0z" /><path d="M12 16h.01" />
                        </svg>
                        <div class="flex-1 min-w-0">
                          <p class="text-gray-700 dark:text-gray-300">{s.message || s.description || s.id}</p>
                          <p class="text-xs text-gray-400 dark:text-gray-500 font-mono mt-0.5">{s.id}</p>
                        </div>
                      </li>
                    {/each}
                  </ul>
                </div>
              {/if}

              {#if grouped.passed.length > 0}
                <details class="mt-3">
                  <summary class="text-xs font-semibold text-green-700 dark:text-gray-300 uppercase tracking-wider mb-2 cursor-pointer hover:text-green-900 dark:hover:text-gray-100">
                    Passed ({grouped.passed.length})
                  </summary>
                  <ul class="space-y-1.5 mt-2">
                    {#each grouped.passed as s (s.id)}
                      <li class="flex items-start gap-2 text-sm">
                        <svg class="w-4 h-4 text-green-600 dark:text-gray-400 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M5 12l5 5l10 -10" />
                        </svg>
                        <div class="flex-1 min-w-0">
                          <p class="text-gray-700 dark:text-gray-300">{s.message || s.description || s.id}</p>
                          <p class="text-xs text-gray-400 dark:text-gray-500 font-mono mt-0.5">{s.id}</p>
                        </div>
                      </li>
                    {/each}
                  </ul>
                </details>
              {/if}
            </li>
          {:else if isSignalsResult(r)}
            <!-- Signals mode: one card per rubric, containing one block per manifest. -->
            <li class="border-2 rounded-xl p-5 border-indigo-200 bg-indigo-50/30 dark:border-gray-700 dark:bg-gray-900/40">
              <div class="flex items-start gap-3 mb-4">
                <div class="flex-shrink-0 w-8 h-8 bg-indigo-500 dark:bg-gray-600 rounded-full flex items-center justify-center text-white">
                  <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
                    <path d="M4 11a9 9 0 0 1 9 9" />
                    <path d="M4 4a16 16 0 0 1 16 16" />
                    <path d="M5 19m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
                  </svg>
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-semibold text-gray-900 dark:text-white">{r.rubricName}</span>
                    {#if r.rubricVersion}
                      <span class="text-xs text-gray-400 dark:text-gray-500 font-mono">v{r.rubricVersion}</span>
                    {/if}
                    <span class="px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide bg-indigo-100 text-indigo-800 dark:bg-gray-800 dark:text-gray-200">
                      Signals
                    </span>
                    <span class="text-xs text-gray-500 dark:text-gray-400">
                      {r.manifests.length} manifest{r.manifests.length === 1 ? '' : 's'}
                    </span>
                  </div>
                </div>
              </div>

              <ol class="space-y-3 list-none">
                {#each r.manifests as m, idx (idx)}
                  <li class="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
                    <div class="flex items-center justify-between gap-3 flex-wrap mb-2">
                      <div class="flex items-center gap-2 flex-wrap">
                        <span class="font-mono text-xs text-gray-500 dark:text-gray-400">#{idx}</span>
                        <span class="text-sm font-semibold text-gray-900 dark:text-white">{formatAssertedBy(m.assertedBy)}</span>
                        {#if m.mimeType}
                          <span class="px-1.5 py-0.5 rounded text-[10px] font-mono bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">{m.mimeType}</span>
                        {/if}
                      </div>
                      <div class="flex items-center gap-1.5 text-xs">
                        <span class="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                          allActionsIncluded: <span class="font-mono">{m.allActionsIncluded}</span>
                        </span>
                      </div>
                    </div>

                    {#if totalSignalCount(m) === 0 && m.ingredients.length === 0}
                      <p class="text-xs text-gray-500 dark:text-gray-400 italic mt-2">No signals detected on this manifest.</p>
                    {/if}

                    {#if m.localInceptions.length > 0}
                      <div class="mt-3">
                        <h5 class="text-xs font-semibold text-indigo-700 dark:text-gray-300 uppercase tracking-wider mb-2">
                          Inception ({m.localInceptions.length})
                        </h5>
                        <ul class="space-y-1.5">
                          {#each m.localInceptions as sig (sig.trait)}
                            <li class="flex items-start gap-2 text-sm">
                              <svg class="w-4 h-4 text-indigo-600 dark:text-gray-400 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                              </svg>
                              <div class="flex-1 min-w-0">
                                <p class="text-gray-700 dark:text-gray-300">
                                  {sig.reportText}
                                  {#if sig.multiple}
                                    <span class="ml-1 text-[10px] uppercase font-semibold text-gray-400 dark:text-gray-500">×multiple</span>
                                  {/if}
                                </p>
                                <p class="text-xs text-gray-400 dark:text-gray-500 font-mono mt-0.5">{sig.trait}</p>
                              </div>
                            </li>
                          {/each}
                        </ul>
                      </div>
                    {/if}

                    {#if m.localTransformations.length > 0}
                      <div class="mt-3">
                        <h5 class="text-xs font-semibold text-amber-700 dark:text-gray-300 uppercase tracking-wider mb-2">
                          Transformation ({m.localTransformations.length})
                        </h5>
                        <ul class="space-y-1.5">
                          {#each m.localTransformations as sig (sig.trait)}
                            <li class="flex items-start gap-2 text-sm">
                              <svg class="w-4 h-4 text-amber-600 dark:text-gray-400 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M4 4v5h5" /><path d="M20 20v-5h-5" />
                                <path d="M5.63 9A9 9 0 0 1 20 12" /><path d="M18.37 15A9 9 0 0 1 4 12" />
                              </svg>
                              <div class="flex-1 min-w-0">
                                <p class="text-gray-700 dark:text-gray-300">
                                  {sig.reportText}
                                  {#if sig.multiple}
                                    <span class="ml-1 text-[10px] uppercase font-semibold text-gray-400 dark:text-gray-500">×multiple</span>
                                  {/if}
                                </p>
                                <p class="text-xs text-gray-400 dark:text-gray-500 font-mono mt-0.5">{sig.trait}</p>
                              </div>
                            </li>
                          {/each}
                        </ul>
                      </div>
                    {/if}

                    {#if m.ingredients.length > 0}
                      <div class="mt-3">
                        <h5 class="text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider mb-2">
                          Ingredients ({m.ingredients.length})
                        </h5>
                        <ul class="space-y-1 text-xs">
                          {#each m.ingredients as edge, eidx (eidx)}
                            <li class="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                              <span class="font-mono">→ manifest #{edge.index}</span>
                              {#if edge.relationship}
                                <span class="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 font-mono">{edge.relationship}</span>
                              {/if}
                            </li>
                          {/each}
                        </ul>
                      </div>
                    {/if}
                  </li>
                {/each}
              </ol>
            </li>
          {/if}
        {/each}
      </ul>
    </div>
  {/if}
</div>
