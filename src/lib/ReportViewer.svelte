<script lang="ts">
  import { createEventDispatcher } from 'svelte'

  export let report: any
  export let usedTestCertificates = false
  export let file: File | null = null

  const dispatch = createEventDispatcher<{ newfile: void }>()

  let showRaw = false
  let mediaUrl: string | null = null
  let mediaType: 'image' | 'video' | 'audio' | 'document' | 'unknown' = 'unknown'
  let fileInput: HTMLInputElement
  let validationStatus: any[] = []

  // Create object URL for media preview
  $: if (file) {
    if (mediaUrl) {
      URL.revokeObjectURL(mediaUrl)
    }
    mediaUrl = URL.createObjectURL(file)

    // Determine media type
    if (file.type.startsWith('image/')) {
      mediaType = 'image'
    } else if (file.type.startsWith('video/')) {
      mediaType = 'video'
    } else if (file.type.startsWith('audio/')) {
      mediaType = 'audio'
    } else if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
      mediaType = 'document'
    } else {
      mediaType = 'unknown'
    }
  }

  // Get the active manifest object from the manifests map
  $: activeManifest = report.active_manifest && report.manifests
    ? report.manifests[report.active_manifest]
    : null

  // Get validation results from the correct location
  $: validationResults = report.validation_results?.activeManifest

  // Check if trusted based on validation_state or signingCredential.trusted status
  $: isTrusted = report.validation_state === 'Trusted' ||
    validationResults?.success?.some((status: any) =>
      status.code === 'signingCredential.trusted'
    )

  // Build validation status array - show key validation results from success and failure
  $: {
    const successStatuses = validationResults?.success?.filter((status: any) =>
      status.code === 'signingCredential.trusted' ||
      status.code === 'timeStamp.trusted' ||
      status.code === 'claimSignature.validated'
    ).map((status: any) => ({
      code: status.code,
      success: true,
      explanation: status.explanation || 'Validation passed'
    })) || []

    const failureStatuses = validationResults?.failure?.filter((status: any) =>
      status.code === 'signingCredential.untrusted' ||
      status.code === 'timeStamp.untrusted' ||
      status.code === 'claimSignature.invalid'
    ).map((status: any) => ({
      code: status.code,
      success: false,
      explanation: status.explanation || 'Validation failed'
    })) || []

    validationStatus = [...successStatuses, ...failureStatuses]
  }

  function downloadReport() {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `c2pa-report-${Date.now()}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  function copyToClipboard() {
    navigator.clipboard.writeText(JSON.stringify(report, null, 2))
  }

  // Elide long hash-like values for readability
  function elideValue(value: any, key?: string): any {
    if (typeof value === 'string') {
      // Check if this is a hash-like field based on key name
      const isHashKey = key && (
        key.toLowerCase().includes('hash') ||
        key.toLowerCase().includes('pad') ||
        key === 'identifier'
      )

      // Check if value looks like a hash (long hex string, base64, etc.)
      // But exclude instance_id and document_id patterns
      const looksLikeHash = value.length > 32 && (
        /^[0-9a-fA-F]{32,}$/.test(value) || // Hex hash
        /^[A-Za-z0-9+/]{32,}={0,2}$/.test(value) // Base64
      )

      if (isHashKey || looksLikeHash) {
        return '<elided>'
      }
    } else if (Array.isArray(value)) {
      // Check if it's an array of numbers (binary data)
      if (value.length > 10 && value.every(v => typeof v === 'number' && v >= 0 && v <= 255)) {
        return '<binary data elided>'
      }
      return value.map(v => elideValue(v))
    } else if (typeof value === 'object' && value !== null) {
      const result: any = {}
      for (const k in value) {
        result[k] = elideValue(value[k], k)
      }
      return result
    }
    return value
  }

  // Format assertion data with elided hashes
  function formatAssertionData(data: any): string {
    const elided = elideValue(data)
    return JSON.stringify(elided, null, 2)
  }

  function handleNewFile() {
    fileInput?.click()
  }

  function handleFileInput(event: Event) {
    const target = event.target as HTMLInputElement
    const files = target.files
    if (files && files.length > 0) {
      dispatch('newfile')
      // The file will be handled by the parent component through the FileUpload event
      window.dispatchEvent(new CustomEvent('file-selected', { detail: files[0] }))
    }
  }
</script>

<div class="text-left mt-8">
  <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
    <h2 class="text-3xl font-bold text-gray-900 dark:text-white">C2PA Conformance Report</h2>
    <div class="flex flex-wrap gap-2">
      <button
        class="px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-medium"
        on:click={() => showRaw = !showRaw}
      >
        {showRaw ? 'Show Formatted' : 'Show Raw JSON'}
      </button>
      <button
        class="px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-medium"
        on:click={downloadReport}
      >
        Download Report
      </button>
      <button
        class="px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-medium"
        on:click={copyToClipboard}
      >
        Copy JSON
      </button>
      <button
        class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-medium"
        on:click={handleNewFile}
      >
        📁 New File
      </button>
    </div>
  </div>

  <!-- Hidden file input -->
  <input
    bind:this={fileInput}
    type="file"
    on:change={handleFileInput}
    accept="image/*,video/*,audio/*,.pdf"
    class="hidden"
  />

  {#if usedTestCertificates}
    <div class="mb-6 bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-400 dark:border-amber-600 rounded-lg p-4">
      <div class="flex items-start gap-3">
        <div class="flex-shrink-0 text-2xl">⚠️</div>
        <div>
          <h3 class="font-bold text-amber-900 dark:text-amber-100 mb-1">Test Certificate Mode Active</h3>
          <p class="text-sm text-amber-800 dark:text-amber-200">
            This validation used custom test certificates. Results may differ from production validation using only the official C2PA trust list.
          </p>
        </div>
      </div>
    </div>
  {/if}

  {#if showRaw}
    <pre class="bg-gray-900 dark:bg-gray-950 border border-gray-700 rounded-lg p-6 overflow-x-auto text-sm leading-relaxed text-gray-100">{JSON.stringify(report, null, 2)}</pre>
  {:else}
    <!-- Media Preview and Validation Status -->
    <div class="mb-6">
      <div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 shadow-sm">
        <h3 class="text-xl font-semibold text-blue-600 dark:text-blue-400 mb-4 pb-3 border-b-2 border-blue-200 dark:border-blue-800">Media Preview</h3>

        {#if file && mediaUrl}
          <div class="flex flex-col gap-3">
            <div class="text-sm text-gray-600 dark:text-gray-400">
              <p><span class="font-semibold">File:</span> {file.name}</p>
              <p><span class="font-semibold">Type:</span> {file.type || 'Unknown'}</p>
              <p><span class="font-semibold">Size:</span> {(file.size / 1024 / 1024).toFixed(2)} MB</p>
            </div>

            <div class="mt-4 bg-gray-100 dark:bg-gray-900 rounded-lg p-4 flex items-center justify-center min-h-[300px]">
              {#if mediaType === 'image'}
                <img src={mediaUrl} alt="Preview" class="max-w-full max-h-[500px] object-contain rounded" />
              {:else if mediaType === 'video'}
                <video src={mediaUrl} controls class="max-w-full max-h-[500px] rounded">
                  <track kind="captions" />
                  Your browser does not support video playback.
                </video>
              {:else if mediaType === 'audio'}
                <div class="w-full">
                  <div class="text-6xl text-center mb-4 text-gray-400">🎵</div>
                  <audio src={mediaUrl} controls class="w-full">
                    Your browser does not support audio playback.
                  </audio>
                </div>
              {:else if mediaType === 'document'}
                <div class="text-center">
                  <div class="text-6xl mb-4 text-gray-400">📄</div>
                  <p class="text-gray-600 dark:text-gray-400">PDF Document</p>
                  <a href={mediaUrl} download={file.name} class="mt-4 inline-block px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                    Download PDF
                  </a>
                </div>
              {:else}
                <div class="text-center">
                  <div class="text-6xl mb-4 text-gray-400">📦</div>
                  <p class="text-gray-600 dark:text-gray-400">Preview not available</p>
                </div>
              {/if}
            </div>
          </div>
        {:else}
          <div class="text-center py-12 text-gray-500 dark:text-gray-400">
            <div class="text-6xl mb-4">📁</div>
            <p>No media file available</p>
          </div>
        {/if}

        <!-- Validation Status (below media preview) - Always shown -->
        <div class="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
          <h4 class="text-lg font-semibold text-blue-600 dark:text-blue-400 mb-3">Validation Status</h4>
          {#if validationStatus && validationStatus.length > 0}
            <div class="space-y-3">
              {#each validationStatus as status}
                <div class={`rounded-lg p-4 border ${
                  status.success
                    ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                    : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                }`}>
                  <strong class="text-gray-900 dark:text-gray-100">{status.code}</strong>
                  {#if status.explanation}
                    <p class={`mt-1 text-sm ${
                      status.success
                        ? 'text-green-700 dark:text-green-300'
                        : 'text-red-700 dark:text-red-300'
                    }`}>{status.explanation}</p>
                  {/if}
                </div>
              {/each}
            </div>
          {:else}
            <div class="bg-gray-50 dark:bg-gray-900/20 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
              <p class="text-gray-600 dark:text-gray-400 text-sm">No validation status available</p>
            </div>
          {/if}
        </div>
      </div>
    </div>

    <div class="space-y-6">
      {#if activeManifest}
        {#if activeManifest.signature_info}
          <section class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 shadow-sm">
            <h3 class="text-xl font-semibold text-blue-600 dark:text-blue-400 mb-4 pb-3 border-b-2 border-blue-200 dark:border-blue-800">Signature Information</h3>
            <div class="space-y-3">
              {#if activeManifest.signature_info.common_name}
                <div class="flex gap-2">
                  <span class="font-semibold text-gray-700 dark:text-gray-300 min-w-[140px]">Common Name:</span>
                  <span class="text-gray-900 dark:text-gray-100 break-all">{activeManifest.signature_info.common_name}</span>
                </div>
              {/if}
              {#if activeManifest.signature_info.issuer}
                <div class="flex gap-2">
                  <span class="font-semibold text-gray-700 dark:text-gray-300 min-w-[140px]">Issuer:</span>
                  <span class="text-gray-900 dark:text-gray-100 break-all">{activeManifest.signature_info.issuer}</span>
                </div>
              {/if}
              {#if activeManifest.signature_info.time}
                <div class="flex gap-2">
                  <span class="font-semibold text-gray-700 dark:text-gray-300 min-w-[140px]">Signed:</span>
                  <span class="text-gray-900 dark:text-gray-100 break-all">{activeManifest.signature_info.time}</span>
                </div>
              {/if}
              {#if activeManifest.signature_info.alg}
                <div class="flex gap-2">
                  <span class="font-semibold text-gray-700 dark:text-gray-300 min-w-[140px]">Algorithm:</span>
                  <span class="text-gray-900 dark:text-gray-100 break-all">{activeManifest.signature_info.alg}</span>
                </div>
              {/if}
            </div>
          </section>
        {/if}

        <section class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 shadow-sm">
          <h3 class="text-xl font-semibold text-blue-600 dark:text-blue-400 mb-4 pb-3 border-b-2 border-blue-200 dark:border-blue-800">Active Manifest</h3>
          <div class="space-y-3">
            <div class="flex gap-2">
              <span class="font-semibold text-gray-700 dark:text-gray-300 min-w-[140px]">Claim Generator:</span>
              <span class="text-gray-900 dark:text-gray-100">
                {#if activeManifest.claim_generator_info && activeManifest.claim_generator_info.length > 0}
                  {activeManifest.claim_generator_info[0].name}
                  {#if activeManifest.claim_generator_info[0].version}
                    v{activeManifest.claim_generator_info[0].version}
                  {/if}
                {:else if activeManifest.claim_generator}
                  {activeManifest.claim_generator}
                {:else}
                  N/A
                {/if}
              </span>
            </div>
            <div class="flex gap-2">
              <span class="font-semibold text-gray-700 dark:text-gray-300 min-w-[140px]">Instance ID:</span>
              <span class="text-gray-900 dark:text-gray-100 break-all">{activeManifest.instance_id || 'N/A'}</span>
            </div>
            {#if activeManifest.label}
              <div class="flex gap-2">
                <span class="font-semibold text-gray-700 dark:text-gray-300 min-w-[140px]">Label:</span>
                <span class="text-gray-900 dark:text-gray-100 break-all">{activeManifest.label}</span>
              </div>
            {/if}
          </div>
        </section>

        {#if activeManifest.assertions && activeManifest.assertions.length > 0}
          <section class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 shadow-sm">
            <h3 class="text-xl font-semibold text-blue-600 dark:text-blue-400 mb-4 pb-3 border-b-2 border-blue-200 dark:border-blue-800">Assertions ({activeManifest.assertions.length})</h3>
            <div class="space-y-4">
              {#each activeManifest.assertions as assertion}
                <div class="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4">
                  <strong class="text-gray-900 dark:text-gray-100">{assertion.label || assertion.url || 'Unknown'}</strong>
                  {#if assertion.data}
                    <pre class="mt-2 bg-gray-100 dark:bg-gray-900 p-3 rounded text-sm overflow-x-auto text-gray-800 dark:text-gray-200">{formatAssertionData(assertion.data)}</pre>
                  {/if}
                </div>
              {/each}
            </div>
          </section>
        {/if}

        {#if activeManifest.ingredients && activeManifest.ingredients.length > 0}
          <section class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 shadow-sm">
            <h3 class="text-xl font-semibold text-blue-600 dark:text-blue-400 mb-4 pb-3 border-b-2 border-blue-200 dark:border-blue-800">Ingredients ({activeManifest.ingredients.length})</h3>
            <div class="space-y-4">
              {#each activeManifest.ingredients as ingredient}
                <div class="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4">
                  <strong class="text-gray-900 dark:text-gray-100">{ingredient.title || ingredient.instance_id || 'Unknown'}</strong>
                  {#if ingredient.relationship}
                    <p class="mt-2 text-sm text-gray-700 dark:text-gray-300">
                      <span class="font-semibold text-gray-600 dark:text-gray-400">Relationship:</span> {ingredient.relationship}
                    </p>
                  {/if}
                  {#if ingredient.document_id}
                    <p class="mt-1 text-sm text-gray-700 dark:text-gray-300">
                      <span class="font-semibold text-gray-600 dark:text-gray-400">Document ID:</span> {ingredient.document_id}
                    </p>
                  {/if}
                  {#if ingredient.instance_id && !ingredient.title}
                    <p class="mt-1 text-sm text-gray-700 dark:text-gray-300">
                      <span class="font-semibold text-gray-600 dark:text-gray-400">Instance ID:</span> {ingredient.instance_id}
                    </p>
                  {/if}
                </div>
              {/each}
            </div>
          </section>
        {/if}

      {:else}
        <p class="text-center text-gray-500 dark:text-gray-400 py-8">No active manifest found in this file.</p>
      {/if}
    </div>
  {/if}
</div>

