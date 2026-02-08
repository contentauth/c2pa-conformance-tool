<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import CertificateManager from './CertificateManager.svelte'

  export let report: any
  export let usedTestCertificates = false
  export let file: File | null = null
  export let testCertificates: string[] = []
  export let testModeEnabled = false
  export let testRootLoaded = false

  const dispatch = createEventDispatcher<{
    newfile: void
    certificatesUpdated: string[]
    testModeChanged: { enabled: boolean; rootLoaded: boolean }
  }>()

  let showRaw = false
  let mediaUrl: string | null = null
  let mediaType: 'image' | 'video' | 'audio' | 'document' | 'unknown' = 'unknown'
  let fileInput: HTMLInputElement
  let validationStatus: any[] = []
  let expandedIngredients: Set<number> = new Set()

  function toggleIngredient(index: number) {
    if (expandedIngredients.has(index)) {
      expandedIngredients.delete(index)
    } else {
      expandedIngredients.add(index)
    }
    expandedIngredients = expandedIngredients // Trigger reactivity
  }

  // Get ingredient manifest from the manifests map
  function getIngredientManifest(ingredient: any) {
    if (!report.manifests) {
      return null
    }

    // Check if ingredient has a c2pa_manifest property
    if (ingredient.c2pa_manifest) {
      return ingredient.c2pa_manifest
    }

    // Check if ingredient has an active_manifest that points to manifests map
    if (ingredient.active_manifest && report.manifests[ingredient.active_manifest]) {
      return report.manifests[ingredient.active_manifest]
    }

    // Check for manifest_data directly
    if (ingredient.manifest_data) {
      return ingredient.manifest_data
    }

    // Look up by instance_id in the manifests map
    if (ingredient.instance_id && report.manifests[ingredient.instance_id]) {
      return report.manifests[ingredient.instance_id]
    }

    // Search through all manifests to find one with matching instance_id
    for (const [key, manifest] of Object.entries(report.manifests)) {
      if (manifest && typeof manifest === 'object' && 'instance_id' in manifest) {
        if ((manifest as any).instance_id === ingredient.instance_id) {
          return manifest
        }
      }
    }

    return null
  }

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

<div class="text-left mt-8 animate-fade-in">
  <div class="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-8 gap-6">
    <div>
      <h2 class="text-4xl font-bold text-gray-900 dark:text-white mb-2">Conformance Report</h2>
      <p class="text-gray-600 dark:text-gray-400">Detailed C2PA manifest validation results</p>
    </div>
    <div class="flex flex-wrap gap-3">
      <button
        class="inline-flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-gray-800 border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 hover:border-gray-400 dark:hover:border-gray-500 transition-all duration-200 font-medium shadow-sm hover:shadow"
        on:click={() => showRaw = !showRaw}
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {#if showRaw}
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
          {:else}
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
          {/if}
        </svg>
        {showRaw ? 'Formatted' : 'Raw JSON'}
      </button>
      <button
        class="inline-flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-gray-800 border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 hover:border-gray-400 dark:hover:border-gray-500 transition-all duration-200 font-medium shadow-sm hover:shadow"
        on:click={downloadReport}
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        Download
      </button>
      <button
        class="inline-flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-gray-800 border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 hover:border-gray-400 dark:hover:border-gray-500 transition-all duration-200 font-medium shadow-sm hover:shadow"
        on:click={copyToClipboard}
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
        Copy
      </button>
      <button
        class="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white rounded-lg transition-all duration-200 font-semibold shadow-md hover:shadow-lg transform hover:scale-105"
        on:click={handleNewFile}
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        New File
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
    <div class="mb-8 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 border-2 border-amber-400 dark:border-amber-600 rounded-2xl p-6 shadow-lg">
      <div class="flex items-start gap-4">
        <div class="flex-shrink-0 w-12 h-12 bg-amber-600 dark:bg-amber-500 rounded-full flex items-center justify-center text-white text-2xl shadow-md">
          ⚠
        </div>
        <div class="flex-1">
          <h3 class="font-bold text-amber-900 dark:text-amber-100 text-lg mb-2">Test Certificate Mode Active</h3>
          <p class="text-sm text-amber-800 dark:text-amber-200 leading-relaxed">
            This validation used custom test certificates. Results may differ from production validation using only the official C2PA trust list.
          </p>
        </div>
      </div>
    </div>
  {/if}

  {#if showRaw}
    <div class="bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-2xl p-8 shadow-lg">
      <div class="flex items-center gap-3 mb-6 pb-4 border-b-2 border-gray-200 dark:border-gray-700">
        <div class="w-10 h-10 bg-gradient-to-br from-gray-700 to-gray-900 dark:from-gray-600 dark:to-gray-800 rounded-lg flex items-center justify-center text-white shadow-md">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
          </svg>
        </div>
        <h3 class="text-2xl font-bold text-gray-900 dark:text-white">Raw JSON Report</h3>
      </div>
      <pre class="bg-gray-900 dark:bg-black border-2 border-gray-700 dark:border-gray-600 rounded-xl p-6 overflow-x-auto text-sm leading-relaxed text-gray-100 shadow-inner">{JSON.stringify(report, null, 2)}</pre>
    </div>
  {:else}
    <!-- Media Preview and Validation Status -->
    <div class="mb-8">
      <div class="bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-2xl p-8 shadow-lg hover:shadow-xl transition-shadow duration-300">
        <div class="flex items-center gap-3 mb-6 pb-4 border-b-2 border-blue-200 dark:border-blue-800">
          <div class="w-10 h-10 bg-gradient-to-br from-blue-600 to-blue-700 dark:from-blue-500 dark:to-blue-600 rounded-lg flex items-center justify-center text-white shadow-md">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <h3 class="text-2xl font-bold text-gray-900 dark:text-white">Media Preview</h3>
        </div>

        {#if file && mediaUrl}
          <div class="flex flex-col gap-6">
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div class="bg-gray-50 dark:bg-gray-900/50 rounded-xl p-4">
                <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-1">Filename</div>
                <p class="text-sm font-medium text-gray-900 dark:text-gray-100 truncate" title={file.name}>{file.name}</p>
              </div>
              <div class="bg-gray-50 dark:bg-gray-900/50 rounded-xl p-4">
                <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-1">Type</div>
                <p class="text-sm font-medium text-gray-900 dark:text-gray-100">{file.type || 'Unknown'}</p>
              </div>
              <div class="bg-gray-50 dark:bg-gray-900/50 rounded-xl p-4">
                <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-1">Size</div>
                <p class="text-sm font-medium text-gray-900 dark:text-gray-100">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
              </div>
            </div>

            <div class="bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900/50 dark:to-gray-900 rounded-2xl p-6 flex items-center justify-center min-h-[350px] border border-gray-200 dark:border-gray-700">
              {#if mediaType === 'image'}
                <img src={mediaUrl} alt="Preview" class="max-w-full max-h-[600px] object-contain rounded-xl shadow-lg" />
              {:else if mediaType === 'video'}
                <video src={mediaUrl} controls class="max-w-full max-h-[600px] rounded-xl shadow-lg">
                  <track kind="captions" />
                  Your browser does not support video playback.
                </video>
              {:else if mediaType === 'audio'}
                <div class="w-full max-w-md">
                  <div class="w-20 h-20 mx-auto bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl flex items-center justify-center text-white text-4xl mb-6 shadow-lg">
                    🎵
                  </div>
                  <audio src={mediaUrl} controls class="w-full">
                    Your browser does not support audio playback.
                  </audio>
                </div>
              {:else if mediaType === 'document'}
                <div class="text-center">
                  <div class="w-20 h-20 mx-auto bg-gradient-to-br from-red-500 to-orange-500 rounded-2xl flex items-center justify-center text-white text-4xl mb-6 shadow-lg">
                    📄
                  </div>
                  <p class="text-gray-600 dark:text-gray-400 mb-4 text-lg font-medium">PDF Document</p>
                  <a href={mediaUrl} download={file.name} class="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white rounded-lg transition-all duration-200 font-semibold shadow-md hover:shadow-lg transform hover:scale-105">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download PDF
                  </a>
                </div>
              {:else}
                <div class="text-center">
                  <div class="w-20 h-20 mx-auto bg-gray-400 dark:bg-gray-600 rounded-2xl flex items-center justify-center text-white text-4xl mb-6 shadow-lg">
                    📦
                  </div>
                  <p class="text-gray-600 dark:text-gray-400 text-lg">Preview not available</p>
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
        <div class="mt-8 pt-8 border-t-2 border-gray-200 dark:border-gray-700">
          <div class="flex items-center gap-3 mb-5">
            <div class="w-8 h-8 bg-gradient-to-br from-green-600 to-emerald-600 dark:from-green-500 dark:to-emerald-500 rounded-lg flex items-center justify-center text-white shadow">
              <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
              </svg>
            </div>
            <h4 class="text-xl font-bold text-gray-900 dark:text-white">Validation Status</h4>
          </div>
          {#if validationStatus && validationStatus.length > 0}
            <div class="space-y-3">
              {#each validationStatus as status}
                <div class={`rounded-xl p-5 border-2 transition-all duration-200 hover:shadow-md ${
                  status.success
                    ? 'bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 border-green-300 dark:border-green-700'
                    : 'bg-gradient-to-r from-red-50 to-orange-50 dark:from-red-900/20 dark:to-orange-900/20 border-red-300 dark:border-red-700'
                }`}>
                  <div class="flex items-start gap-3">
                    <div class={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-white text-sm font-bold ${
                      status.success ? 'bg-green-600 dark:bg-green-500' : 'bg-red-600 dark:bg-red-500'
                    }`}>
                      {status.success ? '✓' : '✕'}
                    </div>
                    <div class="flex-1">
                      <p class="font-bold text-gray-900 dark:text-gray-100 mb-1">{status.code}</p>
                      {#if status.explanation}
                        <p class={`text-sm leading-relaxed ${
                          status.success
                            ? 'text-green-800 dark:text-green-300'
                            : 'text-red-800 dark:text-red-300'
                        }`}>{status.explanation}</p>
                      {/if}
                    </div>
                  </div>
                </div>
              {/each}
            </div>
          {:else}
            <div class="bg-gray-50 dark:bg-gray-900/20 border-2 border-gray-200 dark:border-gray-700 rounded-xl p-6 text-center">
              <p class="text-gray-600 dark:text-gray-400">No validation status available</p>
            </div>
          {/if}
        </div>
      </div>
    </div>

    <div class="space-y-8">
      {#if activeManifest}
        {#if activeManifest.signature_info}
          <section class="bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-2xl p-8 shadow-lg hover:shadow-xl transition-shadow duration-300">
            <div class="flex items-center gap-3 mb-6 pb-4 border-b-2 border-blue-200 dark:border-blue-800">
              <div class="w-10 h-10 bg-gradient-to-br from-indigo-600 to-purple-600 dark:from-indigo-500 dark:to-purple-500 rounded-lg flex items-center justify-center text-white shadow-md">
                <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
                </svg>
              </div>
              <h3 class="text-2xl font-bold text-gray-900 dark:text-white">Signature Information</h3>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
              {#if activeManifest.signature_info.common_name}
                <div class="bg-gray-50 dark:bg-gray-900/50 rounded-xl p-4">
                  <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-2">Common Name</div>
                  <p class="text-sm font-medium text-gray-900 dark:text-gray-100 break-all">{activeManifest.signature_info.common_name}</p>
                </div>
              {/if}
              {#if activeManifest.signature_info.issuer}
                <div class="bg-gray-50 dark:bg-gray-900/50 rounded-xl p-4">
                  <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-2">Issuer</div>
                  <p class="text-sm font-medium text-gray-900 dark:text-gray-100 break-all">{activeManifest.signature_info.issuer}</p>
                </div>
              {/if}
              {#if activeManifest.signature_info.time}
                <div class="bg-gray-50 dark:bg-gray-900/50 rounded-xl p-4">
                  <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-2">Signed</div>
                  <p class="text-sm font-medium text-gray-900 dark:text-gray-100">{activeManifest.signature_info.time}</p>
                </div>
              {/if}
              {#if activeManifest.signature_info.alg}
                <div class="bg-gray-50 dark:bg-gray-900/50 rounded-xl p-4">
                  <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-2">Algorithm</div>
                  <p class="text-sm font-medium text-gray-900 dark:text-gray-100">{activeManifest.signature_info.alg}</p>
                </div>
              {/if}
            </div>
          </section>
        {/if}

        <section class="bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-2xl p-8 shadow-lg hover:shadow-xl transition-shadow duration-300">
          <div class="flex items-center gap-3 mb-6 pb-4 border-b-2 border-blue-200 dark:border-blue-800">
            <div class="w-10 h-10 bg-gradient-to-br from-blue-600 to-cyan-600 dark:from-blue-500 dark:to-cyan-500 rounded-lg flex items-center justify-center text-white shadow-md">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 class="text-2xl font-bold text-gray-900 dark:text-white">Active Manifest</h3>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div class="bg-gray-50 dark:bg-gray-900/50 rounded-xl p-4">
              <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-2">Claim Generator</div>
              <p class="text-sm font-medium text-gray-900 dark:text-gray-100">
                {#if activeManifest.claim_generator_info && activeManifest.claim_generator_info.length > 0}
                  {activeManifest.claim_generator_info[0].name}
                  {#if activeManifest.claim_generator_info[0].version}
                    <span class="text-blue-600 dark:text-blue-400">v{activeManifest.claim_generator_info[0].version}</span>
                  {/if}
                {:else if activeManifest.claim_generator}
                  {activeManifest.claim_generator}
                {:else}
                  N/A
                {/if}
              </p>
            </div>
            <div class="bg-gray-50 dark:bg-gray-900/50 rounded-xl p-4">
              <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-2">Instance ID</div>
              <p class="text-sm font-medium text-gray-900 dark:text-gray-100 break-all font-mono">{activeManifest.instance_id || 'N/A'}</p>
            </div>
            {#if activeManifest.label}
              <div class="bg-gray-50 dark:bg-gray-900/50 rounded-xl p-4 md:col-span-2">
                <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-2">Label</div>
                <p class="text-sm font-medium text-gray-900 dark:text-gray-100 break-all">{activeManifest.label}</p>
              </div>
            {/if}
          </div>
        </section>

        {#if activeManifest.assertions && activeManifest.assertions.length > 0}
          <section class="bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-2xl p-8 shadow-lg hover:shadow-xl transition-shadow duration-300">
            <div class="flex items-center gap-3 mb-6 pb-4 border-b-2 border-blue-200 dark:border-blue-800">
              <div class="w-10 h-10 bg-gradient-to-br from-purple-600 to-pink-600 dark:from-purple-500 dark:to-pink-500 rounded-lg flex items-center justify-center text-white shadow-md">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
              </div>
              <div class="flex-1">
                <h3 class="text-2xl font-bold text-gray-900 dark:text-white">Assertions</h3>
              </div>
              <div class="px-3 py-1 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-full text-sm font-bold">
                {activeManifest.assertions.length}
              </div>
            </div>
            <div class="space-y-4">
              {#each activeManifest.assertions as assertion, index}
                <div class="bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900/50 dark:to-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-700 hover:border-purple-300 dark:hover:border-purple-700 transition-colors">
                  <div class="flex items-start gap-3 mb-3">
                    <div class="flex-shrink-0 w-8 h-8 bg-purple-100 dark:bg-purple-900/50 rounded-lg flex items-center justify-center text-purple-700 dark:text-purple-300 font-bold text-sm">
                      {index + 1}
                    </div>
                    <p class="flex-1 font-bold text-gray-900 dark:text-gray-100 text-lg">{assertion.label || assertion.url || 'Unknown'}</p>
                  </div>
                  {#if assertion.data}
                    <pre class="bg-gray-900 dark:bg-black/50 p-4 rounded-lg text-xs overflow-x-auto text-gray-100 dark:text-gray-300 border border-gray-700 leading-relaxed">{formatAssertionData(assertion.data)}</pre>
                  {/if}
                </div>
              {/each}
            </div>
          </section>
        {/if}

        {#if activeManifest.ingredients && activeManifest.ingredients.length > 0}
          <section class="bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-2xl p-8 shadow-lg hover:shadow-xl transition-shadow duration-300">
            <div class="flex items-center gap-3 mb-6 pb-4 border-b-2 border-blue-200 dark:border-blue-800">
              <div class="w-10 h-10 bg-gradient-to-br from-orange-600 to-red-600 dark:from-orange-500 dark:to-red-500 rounded-lg flex items-center justify-center text-white shadow-md">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </div>
              <div class="flex-1">
                <h3 class="text-2xl font-bold text-gray-900 dark:text-white">Ingredients</h3>
              </div>
              <div class="px-3 py-1 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 rounded-full text-sm font-bold">
                {activeManifest.ingredients.length}
              </div>
            </div>
            <div class="space-y-4">
              {#each activeManifest.ingredients as ingredient, index}
                {@const ingredientManifest = getIngredientManifest(ingredient)}
                {@const isExpanded = expandedIngredients.has(index)}
                <div class="bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900/50 dark:to-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-700 hover:border-orange-300 dark:hover:border-orange-700 transition-colors">
                  <div class="flex items-start gap-3 mb-3">
                    <div class="flex-shrink-0 w-8 h-8 bg-orange-100 dark:bg-orange-900/50 rounded-lg flex items-center justify-center text-orange-700 dark:text-orange-300 font-bold text-sm">
                      {index + 1}
                    </div>
                    <div class="flex-1">
                      <p class="font-bold text-gray-900 dark:text-gray-100 text-lg">{ingredient.title || ingredient.instance_id || 'Unknown'}</p>
                      {#if ingredientManifest}
                        <button
                          on:click={() => toggleIngredient(index)}
                          class="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-orange-600 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300 transition-colors"
                        >
                          <svg class="w-3 h-3 transition-transform {isExpanded ? 'rotate-90' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                          </svg>
                          {isExpanded ? 'Hide' : 'Show'} manifest details
                        </button>
                      {/if}
                    </div>
                  </div>
                  <div class="ml-11 space-y-3">
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {#if ingredient.relationship}
                        <div class="bg-white dark:bg-gray-800 rounded-lg p-3">
                          <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-1">Relationship</div>
                          <p class="text-sm font-medium text-gray-900 dark:text-gray-100">{ingredient.relationship}</p>
                        </div>
                      {/if}
                      {#if ingredient.format}
                        <div class="bg-white dark:bg-gray-800 rounded-lg p-3">
                          <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-1">Format</div>
                          <p class="text-sm font-medium text-gray-900 dark:text-gray-100">{ingredient.format}</p>
                        </div>
                      {/if}
                    </div>
                    {#if ingredient.document_id}
                      <div class="bg-white dark:bg-gray-800 rounded-lg p-3">
                        <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-1">Document ID</div>
                        <p class="text-sm font-medium text-gray-900 dark:text-gray-100 break-all font-mono">{ingredient.document_id}</p>
                      </div>
                    {/if}
                    {#if ingredient.instance_id && !ingredient.title}
                      <div class="bg-white dark:bg-gray-800 rounded-lg p-3">
                        <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-1">Instance ID</div>
                        <p class="text-sm font-medium text-gray-900 dark:text-gray-100 break-all font-mono">{ingredient.instance_id}</p>
                      </div>
                    {/if}

                    <!-- Ingredient Manifest Information -->
                    {#if ingredientManifest && isExpanded}
                      <div class="mt-3 pt-3 border-t border-gray-300 dark:border-gray-600 animate-fade-in">
                        <div class="flex items-center gap-2 mb-3">
                          <svg class="w-4 h-4 text-orange-600 dark:text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          <span class="text-xs font-bold text-orange-700 dark:text-orange-300 uppercase tracking-wide">Manifest Details</span>
                        </div>

                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {#if ingredientManifest.claim_generator}
                            <div class="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-3">
                              <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-1">Claim Generator</div>
                              <p class="text-sm font-medium text-gray-900 dark:text-gray-100">{ingredientManifest.claim_generator}</p>
                            </div>
                          {/if}
                          {#if ingredientManifest.claim_generator_info && ingredientManifest.claim_generator_info.length > 0}
                            <div class="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-3">
                              <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-1">Claim Generator</div>
                              <p class="text-sm font-medium text-gray-900 dark:text-gray-100">
                                {ingredientManifest.claim_generator_info[0].name}
                                {#if ingredientManifest.claim_generator_info[0].version}
                                  <span class="text-orange-600 dark:text-orange-400">v{ingredientManifest.claim_generator_info[0].version}</span>
                                {/if}
                              </p>
                            </div>
                          {/if}
                          {#if ingredientManifest.signature_info?.common_name}
                            <div class="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-3">
                              <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-1">Signed By</div>
                              <p class="text-sm font-medium text-gray-900 dark:text-gray-100 break-all">{ingredientManifest.signature_info.common_name}</p>
                            </div>
                          {/if}
                          {#if ingredientManifest.signature_info?.time}
                            <div class="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-3">
                              <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-1">Signature Time</div>
                              <p class="text-sm font-medium text-gray-900 dark:text-gray-100">{ingredientManifest.signature_info.time}</p>
                            </div>
                          {/if}
                          {#if ingredientManifest.signature_info?.issuer}
                            <div class="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-3">
                              <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-1">Issuer</div>
                              <p class="text-sm font-medium text-gray-900 dark:text-gray-100 break-all">{ingredientManifest.signature_info.issuer}</p>
                            </div>
                          {/if}
                        </div>

                        {#if ingredientManifest.assertions && ingredientManifest.assertions.length > 0}
                          <div class="mt-3 bg-orange-50 dark:bg-orange-900/20 rounded-lg p-3">
                            <div class="flex items-center justify-between mb-2">
                              <span class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide">Assertions</span>
                              <span class="px-2 py-1 bg-orange-200 dark:bg-orange-800 text-orange-800 dark:text-orange-200 rounded-full text-xs font-bold">{ingredientManifest.assertions.length}</span>
                            </div>
                            <div class="space-y-1">
                              {#each ingredientManifest.assertions.slice(0, 5) as assertion}
                                <div class="text-xs text-gray-700 dark:text-gray-300 font-mono">• {assertion.label || assertion.url || 'Unknown'}</div>
                              {/each}
                              {#if ingredientManifest.assertions.length > 5}
                                <div class="text-xs text-gray-500 dark:text-gray-500 italic">+ {ingredientManifest.assertions.length - 5} more...</div>
                              {/if}
                            </div>
                          </div>
                        {/if}

                        {#if ingredientManifest.ingredients && ingredientManifest.ingredients.length > 0}
                          <div class="mt-3 bg-orange-50 dark:bg-orange-900/20 rounded-lg p-3">
                            <div class="flex items-center justify-between mb-2">
                              <span class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide">Nested Ingredients</span>
                              <span class="px-2 py-1 bg-orange-200 dark:bg-orange-800 text-orange-800 dark:text-orange-200 rounded-full text-xs font-bold">{ingredientManifest.ingredients.length}</span>
                            </div>
                            <div class="space-y-1">
                              {#each ingredientManifest.ingredients.slice(0, 3) as nestedIngredient}
                                <div class="text-xs text-gray-700 dark:text-gray-300">• {nestedIngredient.title || nestedIngredient.instance_id || 'Unknown'}</div>
                              {/each}
                              {#if ingredientManifest.ingredients.length > 3}
                                <div class="text-xs text-gray-500 dark:text-gray-500 italic">+ {ingredientManifest.ingredients.length - 3} more...</div>
                              {/if}
                            </div>
                          </div>
                        {/if}
                      </div>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          </section>
        {/if}

      {:else}
        <div class="bg-gray-50 dark:bg-gray-900/50 border-2 border-gray-300 dark:border-gray-700 rounded-2xl p-12 text-center">
          <div class="w-16 h-16 mx-auto bg-gray-300 dark:bg-gray-700 rounded-full flex items-center justify-center text-gray-600 dark:text-gray-400 text-3xl mb-4">
            ⚠
          </div>
          <p class="text-lg font-semibold text-gray-600 dark:text-gray-400">No active manifest found in this file.</p>
        </div>
      {/if}
    </div>
  {/if}

  <!-- Test Certificates Section -->
  <div class="mt-8 pt-8 border-t-2 border-gray-200 dark:border-gray-700">
    <h3 class="text-2xl font-bold text-gray-900 dark:text-white mb-4">Test Certificates</h3>
    <p class="text-gray-600 dark:text-gray-400 mb-6">
      Add or remove test certificates to revalidate this file. Changes will immediately regenerate the report with updated validation results.
    </p>
    <CertificateManager
      bind:testCertificates={testCertificates}
      bind:testModeEnabled={testModeEnabled}
      bind:testRootLoaded={testRootLoaded}
      on:certificatesUpdated={(e) => dispatch('certificatesUpdated', e.detail)}
      on:testModeChanged={(e) => dispatch('testModeChanged', e.detail)}
    />
  </div>
</div>

