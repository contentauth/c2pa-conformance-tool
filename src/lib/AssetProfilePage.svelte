<script lang="ts">
  import { onMount } from 'svelte'
  import hljs from 'highlight.js'
  import FileUpload from './FileUpload.svelte'
  import { extractCrJson } from './c2pa'
  import { evaluateProfile, verifyWasm, resetProfileEvaluatorLoad, PROFILE_EVALUATOR_SCRIPT_URL } from './profileEvaluator'
  import type { CrJson } from './types'

  export let testCertificates: string[] = []

  const profileAccept = '.yml,.yaml,text/yaml,application/x-yaml'

  let assetFile: File | null = null
  let assetCrJson: CrJson | null = null
  let profileFileName = ''
  let profileYaml = ''
  let evaluationResult: unknown = null
  let error: string | null = null
  let assetStatus = 'Select an asset to begin.'
  let evaluationStatus = 'Choose an asset and a YAML profile to evaluate.'
  let extractingAsset = false
  let evaluatingProfile = false
  let profileInput: HTMLInputElement
  let resultHtml = ''
  let wasmStatus: 'idle' | 'checking' | 'ok' | 'fail' = 'idle'
  let wasmDetail: string | null = null

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
    resultHtml = hljs.highlight(JSON.stringify(value, null, 2), { language: 'json' }).value
  }

  /** True if the evaluation returned an empty object - usually means the profile has no sections. */
  $: isEmptyReport =
    evaluationResult != null &&
    typeof evaluationResult === 'object' &&
    !Array.isArray(evaluationResult) &&
    Object.keys(evaluationResult as object).length === 0

  function clearEvaluationResult() {
    evaluationResult = null
    resultHtml = ''
  }

  async function loadAsset(file: File) {
    assetFile = file
    assetCrJson = null
    error = null
    extractingAsset = true
    clearEvaluationResult()
    assetStatus = `Extracting crJSON from ${file.name}...`
    evaluationStatus = 'Waiting for a YAML profile.'

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
      error = err instanceof Error ? err.message : 'Failed to read YAML profile'
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
</script>

<div class="space-y-8">
  <section class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-3xl p-6 sm:p-8 shadow-sm">
    <div class="mb-6">
      <h3 class="text-lg font-semibold text-gray-900 dark:text-white">Asset</h3>
      <p class="mt-1 text-sm text-gray-600 dark:text-gray-400">
        Select the asset to extract crJSON using the same browser-side C2PA path as the main validator.
      </p>
    </div>

    <FileUpload on:fileselect={handleAssetSelect} />

    <div class="mt-4 flex flex-wrap items-center gap-3 text-sm">
      <span class="inline-flex items-center rounded-full bg-blue-50 dark:bg-blue-950 px-3 py-1 font-medium text-blue-700 dark:text-blue-300">
        {assetFile ? assetFile.name : 'No asset selected'}
      </span>
      <span class="text-gray-600 dark:text-gray-400">{assetStatus}</span>
    </div>
  </section>

  <section class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-3xl p-6 sm:p-8 shadow-sm">
    <div class="mb-4">
      <h3 class="text-lg font-semibold text-gray-900 dark:text-white">YAML Profile</h3>
      <p class="mt-1 text-sm text-gray-600 dark:text-gray-400">
        Choose a YAML profile to evaluate against the extracted crJSON. The profile must have <strong>multiple documents</strong>: the first is metadata; later documents define sections (blocks and statements) that produce the report.
      </p>
    </div>

    <div class="flex flex-col gap-3 sm:flex-row">
      <input
        type="text"
        readonly
        value={profileFileName}
        placeholder="No YAML profile selected"
        class="flex-1 rounded-xl border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 px-4 py-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500"
      />
      <button
        type="button"
        on:click={() => profileInput?.click()}
        class="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
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

    <div class="mt-4 flex flex-wrap items-center gap-3">
      <button
        type="button"
        on:click={runEvaluation}
        class="inline-flex items-center justify-center gap-2 rounded-xl bg-gray-900 dark:bg-white px-5 py-3 text-sm font-semibold text-white dark:text-gray-900 transition-colors hover:bg-gray-700 dark:hover:bg-gray-200 disabled:cursor-not-allowed disabled:bg-gray-400 dark:disabled:bg-gray-600 dark:disabled:text-gray-300"
        disabled={!assetCrJson || !profileYaml || extractingAsset || evaluatingProfile}
      >
        {evaluatingProfile ? 'Evaluating...' : 'Evaluate Profile'}
      </button>
      <span class="text-sm text-gray-600 dark:text-gray-400">{evaluationStatus}</span>
    </div>

    <div class="mt-3 flex flex-wrap items-center gap-2 text-sm">
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
      <div class="mt-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
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
      <div class="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
        {error}
      </div>
    {/if}
  </section>

  <section class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-3xl p-6 sm:p-8 shadow-sm">
    <div class="mb-4 flex items-center justify-between gap-4">
      <div>
        <h3 class="text-lg font-semibold text-gray-900 dark:text-white">JSON Result</h3>
        <p class="mt-1 text-sm text-gray-600 dark:text-gray-400">
          The evaluator output is shown here as syntax-highlighted JSON.
        </p>
      </div>
      {#if evaluationResult}
        <span class="inline-flex items-center rounded-full bg-emerald-50 dark:bg-emerald-950 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
          Ready
        </span>
      {/if}
    </div>

    {#if isEmptyReport}
      <div class="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
        <strong>Empty report.</strong> The evaluator ran successfully but returned no content. Asset profiles must have <strong>multiple YAML documents</strong>: the first is metadata; subsequent documents define <strong>blocks</strong> and <strong>statements</strong> that are evaluated against the indicators (crJSON). Add at least one section document (a YAML array of block or statement items) to your profile to get report output.
      </div>
    {/if}
    {#if resultHtml}
      <pre class="hljs overflow-x-auto rounded-2xl bg-gray-900 p-6 text-sm leading-relaxed shadow-inner"><code class="language-json">{@html resultHtml}</code></pre>
    {:else}
      <div class="rounded-2xl border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-900 px-6 py-10 text-sm text-gray-500 dark:text-gray-400">
        {evaluatingProfile ? 'Evaluation in progress...' : 'No evaluation result yet.'}
      </div>
    {/if}
  </section>
</div>
