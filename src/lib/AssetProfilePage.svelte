<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import hljs from 'highlight.js'
  import FileUpload from './FileUpload.svelte'
  import { extractCrJson } from './c2pa'
  import { evaluateProfile, verifyWasm, resetProfileEvaluatorLoad, PROFILE_EVALUATOR_SCRIPT_URL } from './profileEvaluator'
  import type { CrJson } from './types'

  export let testCertificates: string[] = []

  const profileAccept = '.yml,.yaml,text/yaml,application/x-yaml'
  const PROFILE_COMPLIANCE_KEY = 'c2pa:profile_compliance'

  // Only these image types can be rendered by browsers natively
  const BROWSER_PREVIEWABLE_IMAGES = new Set([
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
    'image/avif', 'image/svg+xml', 'image/bmp', 'image/ico', 'image/x-icon',
  ])

  let assetFile: File | null = null
  let assetCrJson: CrJson | null = null
  let profileFileName = ''
  let profileYaml = ''
  let evaluationResult: unknown = null
  let error: string | null = null
  let assetStatus = 'Select an asset to begin.'
  let evaluationStatus = 'Choose an asset and an asset profile to evaluate.'
  let extractingAsset = false
  let evaluatingProfile = false
  let profileInput: HTMLInputElement
  let resultHtml = ''
  let wasmStatus: 'idle' | 'checking' | 'ok' | 'fail' = 'idle'
  let wasmDetail: string | null = null
  let showJsonTab = false
  let rawJsonCodeEl: HTMLElement | null = null
  let copied = false
  let copyTimeout: ReturnType<typeof setTimeout> | null = null
  let mediaUrl: string | null = null
  let mediaType: 'image' | 'video' | 'audio' | 'document' | 'unknown' = 'unknown'
  let expandedSections: Set<string> = new Set()

  /** When we get a new display result, expand the first section by default. */
  $: if (displayResult && typeof displayResult === 'object' && !Array.isArray(displayResult)) {
    const entries = getSortedSectionEntries(displayResult as Record<string, unknown>)
    const firstKey = entries[0]?.[0]
    if (firstKey && !expandedSections.size) {
      expandedSections = new Set([firstKey])
    }
  }

  $: rawJsonHighlighted = (() => {
    if (!evaluationResult || typeof evaluationResult !== 'object') return ''
    try {
      return hljs.highlight(JSON.stringify(evaluationResult, null, 2), { language: 'json' }).value
    } catch {
      return ''
    }
  })()
  $: if (rawJsonCodeEl && rawJsonHighlighted) {
    rawJsonCodeEl.innerHTML = rawJsonHighlighted
  }

  onMount(() => {
    wasmStatus = 'checking'
    verifyWasm()
      .then((out) => {
        if (out.ok) {
          wasmStatus = 'ok'
          wasmDetail = `Return type: ${out.rawType}`
        } else {
          wasmStatus = 'fail'
          wasmDetail = out.detail ?? out.error
        }
      })
      .catch(() => {
        wasmStatus = 'fail'
        wasmDetail = 'Verification threw'
      })
  })

  onDestroy(() => {
    if (mediaUrl) {
      URL.revokeObjectURL(mediaUrl)
      mediaUrl = null
    }
    if (copyTimeout) clearTimeout(copyTimeout)
  })

  $: if (assetFile) {
    if (mediaUrl) URL.revokeObjectURL(mediaUrl)
    mediaUrl = URL.createObjectURL(assetFile)
    if (assetFile.type.startsWith('image/')) {
      mediaType = BROWSER_PREVIEWABLE_IMAGES.has(assetFile.type) ? 'image' : 'unknown'
    } else if (assetFile.type.startsWith('video/')) {
      mediaType = 'video'
    } else if (assetFile.type.startsWith('audio/')) {
      mediaType = 'audio'
    } else if (assetFile.type === 'application/pdf' || assetFile.name.endsWith('.pdf')) {
      mediaType = 'document'
    } else {
      mediaType = 'unknown'
    }
  }

  async function recheckWasm() {
    wasmStatus = 'checking'
    wasmDetail = null
    resetProfileEvaluatorLoad()
    const out = await verifyWasm()
    if (out.ok) {
      wasmStatus = 'ok'
      wasmDetail = `Return type: ${out.rawType}`
    } else {
      wasmStatus = 'fail'
      wasmDetail = [out.error, out.detail].filter(Boolean).join(': ')
    }
  }

  function updateHighlightedResult(value: unknown) {
    resultHtml = value != null ? hljs.highlight(JSON.stringify(value, null, 2), { language: 'json' }).value : ''
  }

  /** True if the evaluation returned an empty object - usually means the profile has no sections. */
  $: isEmptyReport =
    evaluationResult != null &&
    typeof evaluationResult === 'object' &&
    !Array.isArray(evaluationResult) &&
    !('success' in (evaluationResult as object)) &&
    Object.keys(evaluationResult as object).length === 0

  /** Whether the result is the error object (success: false). */
  $: isErrorResult =
    evaluationResult != null &&
    typeof evaluationResult === 'object' &&
    (evaluationResult as { success?: boolean }).success === false

  /** Report object for formatted/JSON display (excludes error wrapper). */
  $: displayResult =
    evaluationResult != null && !isErrorResult
      ? evaluationResult
      : null

  function clearEvaluationResult() {
    evaluationResult = null
    resultHtml = ''
    expandedSections = new Set()
  }

  /** Section key order: profile_metadata first, c2pa:profile_compliance second, then rest. */
  function getSortedSectionEntries(obj: Record<string, unknown>): [string, unknown][] {
    const entries = Object.entries(obj)
    const metadata = entries.find(([k]) => k === 'profile_metadata')
    const compliance = entries.find(([k]) => k === PROFILE_COMPLIANCE_KEY)
    const rest = entries.filter(([k]) => k !== 'profile_metadata' && k !== PROFILE_COMPLIANCE_KEY)
    return [...(metadata ? [metadata] : []), ...(compliance ? [compliance] : []), ...rest]
  }

  /** True if section value is a plain object (e.g. profile_metadata), not array of arrays. */
  function isMetadataSection(value: unknown): boolean {
    if (value == null) return false
    if (Array.isArray(value)) return false
    return typeof value === 'object'
  }

  /** Section value is array of arrays. Each sub-array: first object has title, rest have value. */
  function getStatementBlocks(value: unknown): unknown[][] {
    if (value == null) return []
    let arr: unknown[] = []
    if (Array.isArray(value)) arr = value
    else if (typeof value === 'object') {
      const o = value as Record<string, unknown>
      const s = o.statements ?? o.statement ?? o.items
      if (Array.isArray(s)) arr = s
      else return []
    } else return []
    return arr.filter((x): x is unknown[] => Array.isArray(x))
  }

  /** Human-readable section title from key. */
  function sectionTitle(key: string): string {
    if (key === PROFILE_COMPLIANCE_KEY) return 'Profile compliance'
    if (key === 'profile_metadata') return 'Profile metadata'
    return key
  }

  /** Extract report_text string from object (handles { en: "..." } form). */
  function getReportText(obj: Record<string, unknown>): string {
    const rt = obj.report_text
    if (typeof rt === 'string') return rt
    if (rt != null && typeof rt === 'object' && !Array.isArray(rt)) {
      const r = rt as Record<string, unknown>
      return (r.en ?? r['en-US'] ?? Object.values(r)[0]) as string ?? ''
    }
    return ''
  }

  /** Get id, report_text, and value or title from a statement object. */
  function getStatementObj(item: unknown): { id: string; report_text: string; value: unknown; title: string } | null {
    if (item == null || typeof item !== 'object' || Array.isArray(item)) return null
    const o = item as Record<string, unknown>
    return {
      id: String(o.id ?? ''),
      report_text: getReportText(o),
      value: 'value' in o ? o.value : undefined,
      title: 'title' in o ? String(o.title ?? '') : ''
    }
  }

  function toggleSection(key: string) {
    const next = new Set(expandedSections)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    expandedSections = next
  }

  /** The last object in the last array of the entire statements (all sections) has id c2pa:profile_compliance. */
  $: profileComplianceStatement = (() => {
    if (!displayResult || typeof displayResult !== 'object' || Array.isArray(displayResult)) return null
    const obj = displayResult as Record<string, unknown>
    const entries = getSortedSectionEntries(obj)
    for (let i = entries.length - 1; i >= 0; i--) {
      const blocks = getStatementBlocks(entries[i][1])
      for (let j = blocks.length - 1; j >= 0; j--) {
        const block = blocks[j]
        if (Array.isArray(block) && block.length > 0) {
          const lastObj = block[block.length - 1]
          if (lastObj != null && typeof lastObj === 'object' && !Array.isArray(lastObj)) {
            return lastObj as Record<string, unknown>
          }
        }
      }
    }
    return null
  })()

  /** Whether profile evaluation is compliant. Use value/result/compliance and report_text only - NOT id (id is always c2pa:profile_compliance). */
  $: isProfileCompliant = (() => {
    const s = profileComplianceStatement
    if (!s) return null
    const v = s.value ?? s.result ?? s.compliance
    const reportStr = getReportText(s).toLowerCase()
    const str = typeof v === 'string' ? v.toLowerCase() : ''
    if (v === true || str === 'pass') return true
    if (v === false || str === 'fail' || str === 'false' || str === 'non-compliant' || str === 'not compliant') return false
    if (reportStr.includes('fail') || reportStr.includes('not compliant') || reportStr.includes('non-compliant')) return false
    if (reportStr.includes('pass') || (reportStr.includes('compliant') && !reportStr.includes('not compliant') && !reportStr.includes('non-compliant'))) return true
    return null
  })()

  /** Format a single item for display (string or object summary). */
  function formatItemSummary(item: unknown): string {
    if (item == null) return ''
    if (typeof item === 'string') return item
    if (typeof item === 'number' || typeof item === 'boolean') return String(item)
    if (Array.isArray(item)) return item.length ? `[${item.length} items]` : '[]'
    if (typeof item === 'object') {
      const o = item as Record<string, unknown>
      const parts: string[] = []
      for (const k of ['result', 'status', 'message', 'text', 'title', 'value', 'compliance']) {
        if (o[k] != null) parts.push(String(o[k]))
      }
      if (parts.length) return parts.join(' · ')
      const keys = Object.keys(o)
      return keys.length ? `${keys.slice(0, 3).join(', ')}${keys.length > 3 ? '…' : ''}` : ''
    }
    return String(item)
  }

  async function loadAsset(file: File) {
    assetFile = file
    assetCrJson = null
    error = null
    extractingAsset = true
    clearEvaluationResult()
    assetStatus = `Extracting crJSON from ${file.name}...`
    evaluationStatus = 'Waiting for an asset profile.'

    try {
      assetCrJson = await extractCrJson(file, testCertificates)
      assetStatus = `Extracted crJSON from ${file.name}.`

      if (profileYaml) {
        await runEvaluation()
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to process asset'
      assetStatus = 'Asset extraction failed.'
    } finally {
      extractingAsset = false
    }
  }

  async function handleAssetSelect(event: CustomEvent<File>) {
    await loadAsset(event.detail)
  }

  export async function handleExternalAssetFile(file: File) {
    await loadAsset(file)
  }

  async function handleProfileInput(event: Event) {
    const target = event.target as HTMLInputElement
    const file = target.files?.[0]
    target.value = ''

    if (!file) return

    error = null
    clearEvaluationResult()
    profileFileName = file.name
    evaluationStatus = `Loading profile ${file.name}...`

    try {
      profileYaml = await file.text()
      evaluationStatus = assetCrJson
        ? `Loaded ${file.name}. Ready to evaluate.`
        : `Loaded ${file.name}. Waiting for an asset.`

      if (assetCrJson) {
        await runEvaluation()
      }
    } catch (err) {
      profileYaml = ''
      profileFileName = ''
      error = err instanceof Error ? err.message : 'Failed to read asset profile'
      evaluationStatus = 'Profile loading failed.'
    }
  }

  async function runEvaluation() {
    if (!assetCrJson || !profileYaml) return

    error = null
    evaluatingProfile = true
    clearEvaluationResult()
    evaluationStatus = 'Evaluating asset profile...'

    try {
      const outcome = await evaluateProfile(profileYaml, assetCrJson)
      if (outcome.success) {
        evaluationResult = outcome.result
        evaluationStatus = 'Profile evaluation complete.'
      } else {
        evaluationResult = outcome
        error = outcome.detail ?? outcome.error
        evaluationStatus = 'Profile evaluation failed.'
      }
      updateHighlightedResult(evaluationResult)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Failed to evaluate profile'
      error = errMsg
      evaluationStatus = 'Profile evaluation failed.'
      evaluationResult = { success: false, error: errMsg, detail: String(err) }
      updateHighlightedResult(evaluationResult)
    } finally {
      evaluatingProfile = false
    }
  }

  function downloadResult() {
    const data = evaluationResult != null ? JSON.stringify(evaluationResult, null, 2) : '{}'
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `profile-result-${Date.now()}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  async function copyResult() {
    const text = evaluationResult != null ? JSON.stringify(evaluationResult, null, 2) : '{}'
    await navigator.clipboard.writeText(text)
    if (copyTimeout) clearTimeout(copyTimeout)
    copied = true
    copyTimeout = setTimeout(() => {
      copied = false
      copyTimeout = null
    }, 2000)
  }
</script>

<div class="space-y-8">
  <!-- Two columns: drop area | profile text + Select Profile -->
  <section class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-3xl p-6 sm:p-8 shadow-sm">
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
      <!-- Left: drop area or media preview -->
      <div class="flex flex-col gap-4">
        <h3 class="text-lg font-semibold text-gray-900 dark:text-white">Asset</h3>
        <p class="text-sm text-gray-600 dark:text-gray-400 -mt-2">
          Select the asset to extract crJSON. Drop a file or click to browse.
        </p>
        {#if assetFile && assetCrJson && mediaUrl}
          <!-- Media preview (compact) -->
          <div class="bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-2xl p-4 shadow-sm">
            <div class="flex items-center gap-2 mb-3 pb-2 border-b border-gray-200 dark:border-gray-700">
              <div class="w-8 h-8 bg-gray-800 dark:bg-gray-700 rounded-lg flex items-center justify-center text-white">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <span class="text-sm font-semibold text-gray-900 dark:text-white">Media Preview</span>
            </div>
            <div class="flex flex-col gap-2">
              <p class="text-xs font-medium text-gray-500 dark:text-gray-400 truncate" title={assetFile.name}>{assetFile.name}</p>
              <div class="bg-gray-50 dark:bg-gray-900 rounded-xl p-3 flex items-center justify-center min-h-[140px] border border-gray-200 dark:border-gray-700">
                {#if mediaType === 'image'}
                  <img src={mediaUrl} alt="Preview" class="max-w-full max-h-[200px] object-contain rounded-lg" />
                {:else if mediaType === 'video'}
                  <video src={mediaUrl} controls class="max-w-full max-h-[200px] rounded-lg">
                    <track kind="captions" />
                  </video>
                {:else if mediaType === 'audio'}
                  <div class="w-full">
                    <div class="w-12 h-12 mx-auto bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl flex items-center justify-center text-white text-2xl mb-2">🎵</div>
                    <audio src={mediaUrl} controls class="w-full max-w-xs mx-auto"></audio>
                  </div>
                {:else if mediaType === 'document'}
                  <div class="text-center">
                    <div class="w-12 h-12 mx-auto bg-gradient-to-br from-red-500 to-orange-500 rounded-xl flex items-center justify-center text-white text-2xl mb-2">📄</div>
                    <a href={mediaUrl} download={assetFile.name} class="text-sm text-blue-600 dark:text-blue-400 hover:underline">Download PDF</a>
                  </div>
                {:else}
                  <p class="text-sm text-gray-500 dark:text-gray-400">Preview not available</p>
                {/if}
              </div>
            </div>
          </div>
        {:else}
          <div class="min-h-[320px] flex flex-col">
            <FileUpload on:fileselect={handleAssetSelect} />
          </div>
        {/if}
        <div class="flex flex-wrap items-center gap-2 text-sm">
          <span class="inline-flex items-center rounded-full bg-blue-50 dark:bg-blue-950 px-3 py-1 font-medium text-blue-700 dark:text-blue-300">
            {assetFile ? assetFile.name : 'No asset selected'}
          </span>
          <span class="text-gray-600 dark:text-gray-400">{assetStatus}</span>
        </div>
      </div>

      <!-- Right: Asset profile text area + Select Profile -->
      <div class="flex flex-col gap-4">
        <h3 class="text-lg font-semibold text-gray-900 dark:text-white">Asset profile</h3>
        <p class="text-sm text-gray-600 dark:text-gray-400 -mt-2">
          Paste YAML below or load from file. Multiple documents: first is metadata; later documents define sections.
        </p>
        <div class="flex gap-2">
          <input
            type="text"
            readonly
            value={profileFileName}
            placeholder="No file loaded"
            class="flex-1 rounded-xl border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400"
          />
          <button
            type="button"
            on:click={() => profileInput?.click()}
            class="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
            disabled={extractingAsset || evaluatingProfile}
          >
            Select Profile
          </button>
          <input
            bind:this={profileInput}
            type="file"
            accept={profileAccept}
            class="hidden"
            on:change={handleProfileInput}
          />
        </div>
        <div class="rounded-2xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
          <textarea
            bind:value={profileYaml}
            placeholder="Paste asset profile YAML or load via Select Profile…"
            class="w-full h-[320px] bg-transparent px-4 py-3 text-sm font-mono text-gray-900 dark:text-gray-100 placeholder:text-gray-400 resize-none focus:outline-none focus:ring-0 block"
            spellcheck="false"
          ></textarea>
        </div>
      </div>
    </div>

    <!-- Evaluate Profile row (below two columns) -->
    <div class="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700 flex flex-col gap-4">
      <div class="flex flex-wrap items-center gap-3">
        <button
          type="button"
          on:click={runEvaluation}
          class="inline-flex items-center justify-center gap-2 rounded-xl bg-gray-900 dark:bg-white px-5 py-3 text-sm font-semibold text-white dark:text-gray-900 transition-colors hover:bg-gray-700 dark:hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!assetCrJson || !profileYaml || extractingAsset || evaluatingProfile}
        >
          {evaluatingProfile ? 'Evaluating...' : 'Evaluate Profile'}
        </button>
        <span class="text-sm text-gray-600 dark:text-gray-400">{evaluationStatus}</span>
      </div>
      <div class="flex flex-wrap items-center gap-2 text-sm">
        <span class="text-gray-500 dark:text-gray-400">Evaluator WASM:</span>
        {#if wasmStatus === 'checking'}
          <span class="text-amber-600 dark:text-amber-400">Checking…</span>
        {:else if wasmStatus === 'ok'}
          <span class="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950 px-2.5 py-1 font-medium text-emerald-700 dark:text-emerald-300" title={wasmDetail ?? undefined}>OK</span>
        {:else if wasmStatus === 'fail'}
          <span class="inline-flex items-center gap-2 rounded-full bg-red-50 dark:bg-red-950/50 px-2.5 py-1 font-medium text-red-700 dark:text-red-300">Failed</span>
          <button type="button" on:click={recheckWasm} class="text-blue-600 dark:text-blue-400 hover:underline">Re-check</button>
        {/if}
      </div>
      {#if wasmStatus === 'fail' && wasmDetail}
        <div class="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
          <p class="font-medium mb-1">Why the evaluator failed</p>
          <p class="break-all">{wasmDetail}</p>
          <p class="mt-2 text-red-700 dark:text-red-300 text-xs">
            Script URL: <code class="bg-red-100 dark:bg-red-900/50 px-1 rounded break-all">{PROFILE_EVALUATOR_SCRIPT_URL}</code>
          </p>
          <p class="mt-2 text-red-700 dark:text-red-300">
            Ensure <code class="bg-red-100 dark:bg-red-900/50 px-1 rounded">public/profile-evaluator/</code> contains
            <code class="bg-red-100 dark:bg-red-900/50 px-1 rounded">profile_evaluator_rs.js</code> and
            <code class="bg-red-100 dark:bg-red-900/50 px-1 rounded">profile_evaluator_rs_bg.wasm</code>
            (run <code class="bg-red-100 dark:bg-red-900/50 px-1 rounded">npm run copy:profile-evaluator</code> from a built sibling <code class="bg-red-100 dark:bg-red-900/50 px-1 rounded">profile-evaluator-rs</code> repo).
          </p>
        </div>
      {/if}
      {#if error}
        <div class="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      {/if}
    </div>
  </section>

  <!-- JSON Result: Formatted | JSON tabs + Download & Copy -->
  <section class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-3xl p-6 sm:p-8 shadow-sm">
    <div class="mb-4 flex flex-wrap items-center justify-between gap-4">
      <div>
        <h3 class="text-lg font-semibold text-gray-900 dark:text-white">Output</h3>
        <p class="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Formatted report or raw JSON. Download or copy the result.
        </p>
      </div>
      {#if evaluationResult != null}
        <div class="flex items-center gap-2">
          <div class="flex gap-1 border border-gray-200 dark:border-gray-600 rounded-lg p-1">
            <button
              class="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 rounded-md transition-colors {!showJsonTab ? 'bg-gray-100 dark:bg-gray-700 font-medium' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}"
              on:click={() => showJsonTab = false}
            >
              Formatted
            </button>
            <button
              class="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 rounded-md transition-colors {showJsonTab ? 'bg-gray-100 dark:bg-gray-700 font-medium' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}"
              on:click={() => showJsonTab = true}
            >
              JSON
            </button>
          </div>
          <button
            class="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 dark:text-gray-400 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            on:click={downloadResult}
            title="Download result as JSON"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
            Download
          </button>
          <button
            class="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border transition-colors {copied ? 'border-green-500 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}"
            on:click={copyResult}
            title="Copy JSON to clipboard"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      {/if}
    </div>

    {#if isEmptyReport}
      <div class="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
        <strong>Empty report.</strong> The evaluator ran successfully but returned no content. Asset profiles must have <strong>multiple YAML documents</strong>: the first is metadata; subsequent documents define <strong>blocks</strong> and <strong>statements</strong>. Add at least one section document to your profile to get report output.
      </div>
    {/if}

    {#if evaluationResult == null}
      <div class="rounded-2xl border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 px-6 py-10 text-sm text-gray-500 dark:text-gray-400">
        {evaluatingProfile ? 'Evaluation in progress...' : 'No evaluation result yet. Select an asset and an asset profile, then run Evaluate Profile.'}
      </div>
    {:else if showJsonTab}
      <div class="bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-2xl overflow-hidden">
        <pre class="hljs overflow-x-auto rounded-2xl bg-gray-900 p-6 text-sm leading-relaxed"><code class="language-json" bind:this={rawJsonCodeEl}></code></pre>
      </div>
    {:else}
      <!-- Formatted view: sections like status details, c2pa:profile_compliance first -->
      {#if isErrorResult}
        <div class="rounded-2xl border border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-950/40 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          <p class="font-semibold">Evaluation failed</p>
          <p class="mt-1">{(evaluationResult as { error?: string }).error ?? 'Unknown error'}</p>
          {#if (evaluationResult as { detail?: string }).detail}
            <p class="mt-2 text-xs opacity-90">{(evaluationResult as { detail: string }).detail}</p>
          {/if}
        </div>
      {:else if displayResult && typeof displayResult === 'object' && !Array.isArray(displayResult)}
        {@const entries = getSortedSectionEntries(displayResult as Record<string, unknown>)}
        <div class="space-y-6">
          <!-- Overall conformance: always show, from c2pa:profile_compliance when present -->
          <div class={`rounded-2xl p-6 shadow-sm border-2 transition-colors ${
            isProfileCompliant === true
              ? 'bg-green-50 dark:bg-green-950/50 border-green-300 dark:border-green-800'
              : isProfileCompliant === false
                ? 'bg-red-50 dark:bg-red-950/50 border-red-300 dark:border-red-800'
                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
          }`}>
            {#if profileComplianceStatement}
              {@const compReportText = getReportText(profileComplianceStatement)}
              <div class="flex items-center gap-4">
                <div class={`flex-shrink-0 w-14 h-14 rounded-full flex items-center justify-center text-2xl ${
                  isProfileCompliant === true
                    ? 'bg-green-200 dark:bg-green-900 text-green-700 dark:text-green-300'
                    : isProfileCompliant === false
                      ? 'bg-red-200 dark:bg-red-900 text-red-700 dark:text-red-300'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                }`}>
                  {#if isProfileCompliant === true}
                    ✓
                  {:else if isProfileCompliant === false}
                    ✗
                  {:else}
                    ?
                  {/if}
                </div>
                <div class="flex-1 min-w-0">
                  <h3 class={`text-lg font-semibold ${
                    isProfileCompliant === true
                      ? 'text-green-800 dark:text-green-200'
                      : isProfileCompliant === false
                        ? 'text-red-800 dark:text-red-200'
                        : 'text-gray-900 dark:text-white'
                  }`}>
                    {#if isProfileCompliant === true}
                      ✓ Profile compliant
                    {:else if isProfileCompliant === false}
                      ✗ Not compliant
                    {:else}
                      Profile compliance
                    {/if}
                  </h3>
                  {#if compReportText}
                    <p class={`text-sm mt-1 ${
                      isProfileCompliant === true
                        ? 'text-green-700 dark:text-green-300'
                        : isProfileCompliant === false
                          ? 'text-red-700 dark:text-red-300'
                          : 'text-gray-600 dark:text-gray-400'
                    }`}>{compReportText}</p>
                  {/if}
                </div>
              </div>
            {:else}
              <div class="flex items-center gap-4">
                <div class="flex-shrink-0 w-14 h-14 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-2xl text-gray-500 dark:text-gray-400">
                  ?
                </div>
                <div class="flex-1 min-w-0">
                  <h3 class="text-lg font-semibold text-gray-900 dark:text-white">Overall conformance</h3>
                  <p class="text-sm text-gray-600 dark:text-gray-400 mt-1">No profile compliance data in report. Ensure the profile defines a <code class="px-1 rounded bg-gray-200 dark:bg-gray-700">c2pa:profile_compliance</code> section.</p>
                </div>
              </div>
            {/if}
          </div>

          <!-- Collapsing sections: metadata = key-value; statement sections = array of arrays -->
          {#each entries as [sectionKey, sectionValue]}
            {@const isMeta = isMetadataSection(sectionValue)}
            {@const blocks = getStatementBlocks(sectionValue)}
            {@const isExpanded = expandedSections.has(sectionKey)}
            {@const blockCount = isMeta ? 1 : blocks.length}
            <div class="bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-2xl overflow-hidden shadow-sm">
              <button
                type="button"
                class="w-full flex items-center gap-3 px-6 py-4 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors min-h-[4rem]"
                on:click={() => toggleSection(sectionKey)}
              >
                <div class="w-10 h-10 bg-gray-800 dark:bg-gray-700 rounded-lg flex items-center justify-center text-white shadow-md flex-shrink-0">
                  <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
                  </svg>
                </div>
                <span class="text-lg font-semibold text-gray-900 dark:text-white flex-1 text-left">{sectionTitle(sectionKey) || sectionKey || 'Section'}</span>
                <span class="text-sm text-gray-500 dark:text-gray-400">{#if isMeta}(metadata){:else}({blockCount} {blockCount === 1 ? 'block' : 'blocks'}){/if}</span>
                <span class="text-gray-500 dark:text-gray-400 flex-shrink-0">
                  {#if isExpanded}
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" /></svg>
                  {:else}
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
                  {/if}
                </span>
              </button>
              {#if isExpanded}
                <div class="border-t border-gray-200 dark:border-gray-700 px-6 pb-6 pt-4">
                  {#if isMeta}
                    <!-- profile_metadata: plain object key-value display -->
                    <div class="grid gap-3 sm:grid-cols-2">
                      {#each Object.entries(sectionValue as Record<string, unknown>) as [k, v]}
                        {#if v != null}
                          <div class="rounded-xl p-4 border-2 border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
                            <div class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">{k}</div>
                            <div class="text-sm text-gray-900 dark:text-gray-100">{typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : String(v)}</div>
                          </div>
                        {/if}
                      {/each}
                    </div>
                  {:else}
                    <div class="space-y-6">
                      {#each blocks as block}
                        {@const titleObj = block[0] != null && typeof block[0] === 'object' && !Array.isArray(block[0]) ? getStatementObj(block[0]) : null}
                        {@const valueObjs = block.slice(1).filter((x): x is Record<string, unknown> => x != null && typeof x === 'object' && !Array.isArray(x) && 'value' in x)}
                        <div class="space-y-3">
                          {#if titleObj?.title}
                            <h5 class="text-base font-semibold text-gray-900 dark:text-white">{titleObj.title}</h5>
                          {/if}
                          <div class="grid gap-3 sm:grid-cols-2">
                            {#each valueObjs as obj}
                              {@const stmt = getStatementObj(obj)}
                              {#if stmt}
                                <div class={`rounded-xl p-4 border-2 transition-colors ${
                                  stmt.value === true
                                    ? 'bg-green-50 dark:bg-green-950/50 border-green-300 dark:border-green-800'
                                    : stmt.value === false
                                      ? 'bg-red-50 dark:bg-red-950/50 border-red-300 dark:border-red-800'
                                      : 'bg-gray-50 dark:bg-gray-900/50 border-gray-200 dark:border-gray-700'
                                }`}>
                                  <div class="flex items-center justify-between gap-2 mb-2">
                                    <span class="text-sm font-mono text-gray-600 dark:text-gray-400">{stmt.id || '—'}</span>
                                    {#if stmt.value === true}
                                      <span class="text-green-700 dark:text-green-300 font-semibold">✓ Pass</span>
                                    {:else if stmt.value === false}
                                      <span class="text-red-700 dark:text-red-300 font-semibold">✗ Fail</span>
                                    {:else if stmt.value != null}
                                      <span class="text-sm font-medium text-gray-900 dark:text-gray-100">{String(stmt.value)}</span>
                                    {/if}
                                  </div>
                                  <p class="text-sm text-gray-700 dark:text-gray-300">
                                    <span class="font-medium">Explanation:</span> {stmt.report_text || '—'}
                                  </p>
                                </div>
                              {/if}
                            {/each}
                          </div>
                        </div>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {:else}
        <div class="rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-6 text-sm text-gray-600 dark:text-gray-400">
          Result is not an object with sections. Use the JSON tab to view raw output.
        </div>
      {/if}
    {/if}
  </section>
</div>
