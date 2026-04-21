<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" >
  <link href="https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap" rel="stylesheet">
</svelte:head>

<script lang="ts">
  import { onMount } from 'svelte'
  import FileUpload from './lib/FileUpload.svelte'
  import ReportViewer from './lib/ReportViewer.svelte'
  import CertificateManager from './lib/CertificateManager.svelte'
  import { processFile, processSidecarWithAsset, isSidecarFile, isSidecarWithAssetSupported } from './lib/c2pa'
  import { testTrustListFetch } from './lib/trustListTest'
  import type { ConformanceReport } from './lib/types'

  type Page = 'main' | 'test-certificates'
  // 'embedded' = normal asset with in-band manifest.
  // 'sidecar+asset' = user supplied both the .c2pa and the asset; hash
  //   bindings are actually verified.
  // 'sidecar-only' = user supplied a .c2pa without the asset; we can still
  //   parse/inspect the manifest, but hash bindings cannot be validated.
  type ValidationMode = 'embedded' | 'sidecar+asset' | 'sidecar-only'

  let report: ConformanceReport | null = null
  let error: string | null = null
  let noManifest = false
  let processing = false
  let globalDragOver = false
  let testCertificates: string[] = []
  let usedTestCertificates = false
  let selectedFile: File | null = null
  let sidecarFile: File | null = null       // companion file when we processed a sidecar+asset pair
  let pendingSidecar: File | null = null    // sidecar dropped, waiting for user to supply the asset
  let validationMode: ValidationMode = 'embedded'
  let sidecarSupported = false              // `true` iff local WASM exposes fromSidecarAndBlob
  let darkMode = false
  let infoSectionExpanded = false
  let testModeEnabled = false
  let testRootLoaded = false
  let processingStatus = 'Processing file...'
  let currentPage: Page = 'main'
  let menuOpen = false
  // Test trust list fetching on component mount
  onMount(() => {
    console.log('=== C2PA Conformance Tool Initialized ===')
    testTrustListFetch().catch(err => {
      console.warn('Trust list fetch test failed:', err)
    })

    // Detect whether sidecar+asset validation is available. When it isn't (the
    // packaged SDK fallback) we still accept .c2pa drops, but skip the
    // "drop the matching asset" prompt and go straight to sidecar-only
    // inspection — asking the user for an asset we can't actually validate
    // against would just be confusing.
    isSidecarWithAssetSupported()
      .then((supported) => {
        sidecarSupported = supported
        console.log(`Sidecar+asset validation: ${supported ? 'available (local WASM)' : 'unavailable (packaged SDK)'}`)
      })
      .catch((err) => {
        console.warn('Could not probe sidecar support:', err)
        sidecarSupported = false
      })

    // Initialize dark mode from localStorage or system preference
    const savedTheme = localStorage.getItem('theme')
    if (savedTheme === 'dark') {
      darkMode = true
      document.documentElement.classList.add('dark')
    } else if (savedTheme === 'light') {
      darkMode = false
      document.documentElement.classList.remove('dark')
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      darkMode = prefersDark
      if (prefersDark) {
        document.documentElement.classList.add('dark')
      }
    }

    const infoExpanded = sessionStorage.getItem('infoSectionExpanded')
    if (infoExpanded === 'true') infoSectionExpanded = true

    const preventDefaults = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
    }

    const handleWindowDrop = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      globalDragOver = false
      const files = e.dataTransfer?.files
      if (files && files.length > 0) {
        void handleFilesDropped(Array.from(files))
      }
    }

    const handleWindowDragLeave = (e: DragEvent) => {
      if (!e.relatedTarget || e.relatedTarget === null) {
        globalDragOver = false
      }
    }

    const handleFileSelectedEvent = (e: Event) => {
      const customEvent = e as CustomEvent<File>
      void handleFilesDropped([customEvent.detail])
    }

    window.addEventListener('dragover', preventDefaults, false)
    window.addEventListener('dragleave', handleWindowDragLeave, false)
    window.addEventListener('drop', handleWindowDrop, false)
    window.addEventListener('file-selected', handleFileSelectedEvent as EventListener)

    return () => {
      window.removeEventListener('dragover', preventDefaults, false)
      window.removeEventListener('dragleave', handleWindowDragLeave, false)
      window.removeEventListener('drop', handleWindowDrop, false)
      window.removeEventListener('file-selected', handleFileSelectedEvent as EventListener)
    }
  })

  /**
   * Entry point for any drop. Handles three pairing cases:
   *   1. Two files dropped together, exactly one a .c2pa → auto-pair.
   *   2. A single .c2pa, sidecar+asset supported, nothing pending → enter
   *      "awaiting asset" state (show a prompt, don't process yet).
   *   3. A single asset while a sidecar is pending → pair them.
   *   4. Anything else → fall through to single-file processing.
   */
  async function handleFilesDropped(files: File[]) {
    if (files.length === 0) return

    // Case 1: Exactly one sidecar + one asset dropped together → pair them.
    if (files.length >= 2 && sidecarSupported) {
      const sidecars = files.filter(isSidecarFile)
      const assets = files.filter(f => !isSidecarFile(f))
      if (sidecars.length === 1 && assets.length === 1) {
        await processSidecarPair(sidecars[0], assets[0])
        return
      }
    }

    const file = files[0]

    // Case 3: Pending sidecar + user supplied an asset → pair them.
    if (pendingSidecar && !isSidecarFile(file)) {
      await processSidecarPair(pendingSidecar, file)
      return
    }

    // Case 2: Single sidecar, no asset yet, and we CAN validate pairs →
    //   park it and prompt the user to drop the asset.
    if (isSidecarFile(file) && sidecarSupported && !pendingSidecar) {
      pendingSidecar = file
      selectedFile = file
      report = null
      error = null
      noManifest = false
      processing = false
      currentPage = 'main'
      menuOpen = false
      return
    }

    // Case 4 (default): single-file processing. Covers plain assets and —
    //   when sidecar+asset validation isn't available — lone .c2pa files
    //   which we just inspect without hash verification.
    await handleFileSelect({ detail: file } as CustomEvent<File>)
  }

  async function handleFileSelect(event: CustomEvent<File>) {
    const file = event.detail
    console.log('📄 File selected:', file.name, file.type, file.size, 'bytes')

    // Navigate to main view if on a sub-page
    currentPage = 'main'
    menuOpen = false

    processing = true
    error = null
    noManifest = false
    report = null
    selectedFile = file
    sidecarFile = null
    pendingSidecar = null
    validationMode = isSidecarFile(file) ? 'sidecar-only' : 'embedded'
    usedTestCertificates = testCertificates.length > 0

    try {
      console.log('⏳ Starting file processing...')
      processingStatus = 'Initializing C2PA SDK...'
      await new Promise(resolve => setTimeout(resolve, 100))

      processingStatus = 'Fetching trust lists...'
      await new Promise(resolve => setTimeout(resolve, 100))

      processingStatus = 'Validating signatures...'
      if (testCertificates.length > 0) {
        console.log('⚠️  Using', testCertificates.length, 'test certificate(s)')
      }

      report = await processFile(file, testCertificates)

      processingStatus = 'Building report...'
      await new Promise(resolve => setTimeout(resolve, 100))

      console.log('✅ File processed successfully:', report)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'An error occurred processing the file'
      if (msg.includes('No C2PA manifest')) {
        noManifest = true
      } else {
        error = msg
      }
      console.error('❌ Error processing file:', err)
    } finally {
      console.log('🏁 Processing complete. Report:', !!report, 'Error:', !!error)
      processing = false
      processingStatus = 'Processing file...'
    }
  }

  async function processSidecarPair(sidecar: File, asset: File) {
    console.log('🔗 Pairing sidecar with asset:', sidecar.name, '+', asset.name)

    currentPage = 'main'
    menuOpen = false

    processing = true
    error = null
    noManifest = false
    report = null
    selectedFile = asset
    sidecarFile = sidecar
    pendingSidecar = null
    validationMode = 'sidecar+asset'
    usedTestCertificates = testCertificates.length > 0

    try {
      processingStatus = 'Initializing C2PA SDK...'
      await new Promise(resolve => setTimeout(resolve, 100))
      processingStatus = 'Validating manifest against asset bytes...'
      report = await processSidecarWithAsset(sidecar, asset, testCertificates)
      processingStatus = 'Building report...'
      await new Promise(resolve => setTimeout(resolve, 100))
      console.log('✅ Sidecar+asset processed successfully:', report)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'An error occurred processing the files'
      if (msg.includes('No C2PA manifest')) {
        noManifest = true
      } else {
        error = msg
      }
      console.error('❌ Error processing sidecar pair:', err)
    } finally {
      processing = false
      processingStatus = 'Processing file...'
    }
  }

  function cancelPendingSidecar() {
    pendingSidecar = null
    selectedFile = null
  }

  function inspectSidecarWithoutAsset() {
    if (!pendingSidecar) return
    const sidecar = pendingSidecar
    pendingSidecar = null
    void handleFileSelect({ detail: sidecar } as CustomEvent<File>)
  }

  async function reprocessCurrentFile() {
    if (!selectedFile || !report) return
    processing = true
    error = null
    noManifest = false
    report = null
    usedTestCertificates = testCertificates.length > 0
    try {
      await new Promise(resolve => setTimeout(resolve, 0))
      if (validationMode === 'sidecar+asset' && sidecarFile) {
        report = await processSidecarWithAsset(sidecarFile, selectedFile, testCertificates)
      } else {
        report = await processFile(selectedFile, testCertificates)
      }
      console.log('✅ File reprocessed successfully')
    } catch (err) {
      error = err instanceof Error ? err.message : 'An error occurred processing the file'
      console.error('❌ Error reprocessing file:', err)
    } finally {
      processing = false
    }
  }

  async function handleTestModeChanged(event: CustomEvent<{ enabled: boolean; rootLoaded: boolean }>) {
    testModeEnabled = event.detail.enabled
    testRootLoaded = event.detail.rootLoaded
    if (selectedFile && report) {
      console.log('🔄 Test mode changed, reprocessing file...')
      await reprocessCurrentFile()
    }
  }

  async function handleCertificatesUpdated(event: CustomEvent<string[]>) {
    console.log('🔔 handleCertificatesUpdated called with', event.detail.length, 'certificates')
    testCertificates = event.detail
    if (selectedFile && report) {
      console.log('🔄 Reprocessing file with updated certificates...')
      await reprocessCurrentFile()
    }
  }

  function handleGlobalDragEnter(event: DragEvent) {
    event.preventDefault()
    event.stopPropagation()
    globalDragOver = true
  }

  function handleGlobalDragOver(event: DragEvent) {
    event.preventDefault()
    event.stopPropagation()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    globalDragOver = true
  }

  function handleGlobalDragLeave(event: DragEvent) {
    event.preventDefault()
    event.stopPropagation()
    if (event.target === document.body || !(event.target instanceof Node) || !document.body.contains(event.relatedTarget as Node)) {
      globalDragOver = false
    }
  }

  function handleGlobalDrop(event: DragEvent) {
    event.preventDefault()
    event.stopPropagation()
    globalDragOver = false
    const files = event.dataTransfer?.files
    if (files && files.length > 0) {
      void handleFilesDropped(Array.from(files))
    }
  }

  function resetToHome() {
    report = null
    error = null
    noManifest = false
    processing = false
    selectedFile = null
    currentPage = 'main'
    menuOpen = false
  }

  function navigateTo(page: Page) {
    currentPage = page
    menuOpen = false
  }

  function toggleDarkMode() {
    darkMode = !darkMode
    if (darkMode) {
      document.documentElement.classList.add('dark')
      localStorage.setItem('theme', 'dark')
    } else {
      document.documentElement.classList.remove('dark')
      localStorage.setItem('theme', 'light')
    }
  }

  function toggleInfoSection() {
    infoSectionExpanded = !infoSectionExpanded
    sessionStorage.setItem('infoSectionExpanded', String(infoSectionExpanded))
  }
</script>

<main
  on:dragenter={handleGlobalDragEnter}
  on:dragover={handleGlobalDragOver}
  on:dragleave={handleGlobalDragLeave}
  on:drop={handleGlobalDrop}
  class="relative min-h-screen"
  class:pointer-events-none={globalDragOver}
>
  {#if globalDragOver}
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-gradient-to-br from-blue-100 to-blue-100 dark:from-gray-700 dark:to-gray-800 bg-opacity-98 backdrop-blur-md transition-all duration-100">
      <div class="text-center text-blue-900 dark:text-white">
        <div class="mb-8 animate-bounce">
          <div class="inline-flex items-center justify-center w-32 h-32 bg-blue-900 dark:bg-gray-600 rounded-3xl shadow-2xl">
            <svg class="w-20 h-20 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M7 18a4.6 4.4 0 0 1 0 -9a5 4.5 0 0 1 11 2h1a3.5 3.5 0 0 1 0 7h-1" /><path d="M9 15l3 -3l3 3" /><path d="M12 12l0 9" /></svg>
          </div>
        </div>
        <p class="text-3xl font-bold mb-3">Drop file to analyze</p>
        <p class="text-xl opacity-90">We'll validate it instantly</p>
      </div>
    </div>
  {/if}

  <!-- Navigation Bar (always shown) -->
  <nav class="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shadow-sm sticky top-0 z-40 backdrop-blur-sm bg-white/95 dark:bg-gray-800/95">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex items-center justify-between h-16 gap-4">
        <!-- Left: Content Credentials Logo -->
        <div class="flex items-center justify-start gap-3">
          <a href="https://contentcredentials.org" target="_blank" rel="noopener noreferrer" aria-label="Visit Content Credentials website">
            <img src="{import.meta.env.BASE_URL}content_credentials_icon.svg" alt="Content Credentials" class="h-8 w-auto transition-transform hover:scale-105 dark:brightness-0 dark:invert" />
          </a>
        </div>

        <!-- Center: Title (clickable to return home) -->
        <div class="flex items-center justify-center flex-1">
          {#if report || processing || currentPage !== 'main'}
            <button
              on:click={resetToHome}
              class="text-xl font-bold text-gray-900 dark:text-white hover:text-blue-600 dark:hover:text-gray-300 transition-colors duration-200 cursor-pointer"
              aria-label="Return to home"
            >
              C2PA Verify
            </button>
          {:else}
            <h1 class="text-xl font-bold text-gray-900 dark:text-white">C2PA Verify</h1>
          {/if}
        </div>

        <!-- Right: Test Mode Badge + Dark mode toggle + C2PA Logo + Hamburger -->
        <div class="flex items-center justify-end gap-3">
          {#if testModeEnabled}
            <button
              on:click={() => navigateTo('test-certificates')}
              class="inline-flex items-center gap-2 px-3 py-1.5 bg-amber-600 dark:bg-gray-600 text-white rounded-lg hover:bg-amber-700 dark:hover:bg-gray-500 transition-colors text-sm font-semibold shadow-sm"
              title="Test mode active - click to manage certificates"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
              </svg>
              TEST MODE ({testCertificates.length})
            </button>
          {/if}
          <button
            on:click={toggleDarkMode}
            class="p-2 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-all duration-200 group"
            aria-label="Toggle dark mode"
            title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {#if darkMode}
              <svg class="w-5 h-5 text-yellow-500 group-hover:text-yellow-400 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454l0 .008" /></svg>
            {:else}
              <svg class="w-5 h-5 text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454l0 .008" /></svg>
            {/if}
          </button>
          <!-- Hamburger menu -->
          <div class="relative">
            <button
              on:click={() => menuOpen = !menuOpen}
              class="p-2 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-all duration-200"
              aria-label="Open menu"
              aria-expanded={menuOpen}
            >
              {#if menuOpen}
                <!-- X icon -->
                <svg class="w-5 h-5 text-gray-700 dark:text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M18 6l-12 12" /><path d="M6 6l12 12" /></svg>
              {:else}
                <!-- Hamburger icon -->
                <svg class="w-5 h-5 text-gray-700 dark:text-gray-300" viewBox="0 0 24 24" fill="currentColor"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M21 6a1 1 0 0 1 -1 1h-16a1 1 0 1 1 0 -2h16a1 1 0 0 1 1 1" /><path d="M21 12a1 1 0 0 1 -1 1h-16a1 1 0 0 1 0 -2h16a1 1 0 0 1 1 1" /><path d="M21 18a1 1 0 0 1 -1 1h-16a1 1 0 0 1 0 -2h16a1 1 0 0 1 1 1" /></svg>
              {/if}
            </button>

            {#if menuOpen}
              <!-- Click-outside overlay -->
              <button
                class="fixed inset-0 z-40 cursor-default"
                aria-hidden="true"
                tabindex="-1"
                on:click={() => menuOpen = false}
              ></button>

              <!-- Dropdown panel -->
              <div class="absolute right-0 mt-2 w-56 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg z-50 py-1 animate-fade-in">
                <div class="px-3 py-2 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                  Advanced
                </div>
                <button
                  on:click={() => navigateTo('test-certificates')}
                  class="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-left"
                >
                  <svg class="w-4 h-4 text-amber-600 dark:text-gray-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M9 3l6 0" /><path d="M10 9l4 0" /><path d="M10 3v6l-4 11a.7 .7 0 0 0 .5 1h11a.7 .7 0 0 0 .5 -1l-4 -11v-6" /></svg>
                  <span>Test Certificates</span>
                  {#if testCertificates.length > 0}
                    <span class="ml-auto px-1.5 py-0.5 bg-amber-600 dark:bg-gray-600 text-white rounded-full text-xs font-bold">{testCertificates.length}</span>
                  {/if}
                </button>
              </div>
            {/if}
          </div>
        </div>
      </div>
    </div>
  </nav>

  <!-- ── Test Certificates page ── -->
  {#if currentPage === 'test-certificates'}
    <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <div class="mb-8">
        <button
          on:click={() => navigateTo('main')}
          class="inline-flex items-center gap-2 text-sm font-semibold text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
          </svg>
          Back to main view
        </button>
        <h2 class="mt-4 text-2xl font-bold text-gray-900 dark:text-white">Test Certificates</h2>
        <p class="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Load custom certificates to validate files signed outside the official C2PA Trust List.
        </p>
      </div>
      <CertificateManager
        bind:testCertificates={testCertificates}
        bind:testModeEnabled={testModeEnabled}
        bind:testRootLoaded={testRootLoaded}
        on:certificatesUpdated={handleCertificatesUpdated}
        on:testModeChanged={handleTestModeChanged}
      />
    </div>

  <!-- ── Main page ── -->
  {:else}
    {#if !report && !processing}
      <!-- Hero Section -->
      <div class="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center mb-12 mt-10">
        <div class="mb-10">
          <h2 class="text-[34px] sm:text-[48px] font-bold text-[#444] dark:text-white mb-4 tracking-wide leading-tight">
             Content Credentials<br />
            <span class="text-[#444] dark:text-white">
              Validator & Testing Tool
            </span>
          </h2>
          <p class="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
            Verify C2PA manifests against official trust lists, locally in your browser.
          </p>
        </div>

        <!-- Collapsible Info Section -->
        <div class="mb-6">
          <button
            on:click={toggleInfoSection}
            class="inline-flex items-center gap-2 px-4 py-2 bg-blue-100 dark:bg-gray-800 hover:bg-blue-200 dark:hover:bg-gray-700 text-blue-900 dark:text-gray-100 rounded-lg transition-colors text-sm font-semibold"
          >
            <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0" /><path d="M12 9h.01" /><path d="M11 12h1v4h1" /></svg>
            What is this all about?
            <svg class="w-4 h-4 transition-transform {infoSectionExpanded ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {#if infoSectionExpanded}
            <div class="bg-blue-50 dark:bg-gray-900 border-2 border-blue-400 dark:border-gray-700 rounded-2xl p-8 mt-4 text-left shadow-sm">
              <p class="text-gray-700 dark:text-gray-300 mb-4 leading-relaxed">
                Content Credentials from The Coalition for Content Provenance and Authenticity (C2PA) is the technical standard for digital provenance. It provides verifiable assertions about the origin and history of digital content including images, video, audio, and documents.
              </p>
              <div class="grid sm:grid-cols-3 gap-4">
                <div class="bg-white dark:bg-gray-800 rounded-xl p-4 backdrop-blur-sm">
                  <div class="text-3xl mb-2">
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icons-tabler-outline icon-tabler-rosette-discount-check"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M5 7.2a2.2 2.2 0 0 1 2.2 -2.2h1a2.2 2.2 0 0 0 1.55 -.64l.7 -.7a2.2 2.2 0 0 1 3.12 0l.7 .7c.412 .41 .97 .64 1.55 .64h1a2.2 2.2 0 0 1 2.2 2.2v1c0 .58 .23 1.138 .64 1.55l.7 .7a2.2 2.2 0 0 1 0 3.12l-.7 .7a2.2 2.2 0 0 0 -.64 1.55v1a2.2 2.2 0 0 1 -2.2 2.2h-1a2.2 2.2 0 0 0 -1.55 .64l-.7 .7a2.2 2.2 0 0 1 -3.12 0l-.7 -.7a2.2 2.2 0 0 0 -1.55 -.64h-1a2.2 2.2 0 0 1 -2.2 -2.2v-1a2.2 2.2 0 0 0 -.64 -1.55l-.7 -.7a2.2 2.2 0 0 1 0 -3.12l.7 -.7a2.2 2.2 0 0 0 .64 -1.55v-1" /><path d="M9 12l2 2l4 -4" /></svg>
                  </div>
                  <h4 class="font-semibold text-[#444] dark:text-white mb-1">Validate Signatures</h4>
                  <p class="text-sm text-gray-600 dark:text-gray-400">Against official C2PA Trust Lists</p>
                </div>
                <div class="bg-white dark:bg-gray-800 rounded-xl p-4 backdrop-blur-sm">
                  <div class="text-3xl mb-2">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icons-tabler-outline icon-tabler-list-details"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M13 5h8" /><path d="M13 9h5" /><path d="M13 15h8" /><path d="M13 19h5" /><path d="M3 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4" /><path d="M3 15a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4" /></svg>
                  </div>
                  <h4 class="font-semibold text-[#444] dark:text-white mb-1">View Manifest Details</h4>
                  <p class="text-sm text-gray-600 dark:text-gray-400">Actions, ingredients, and assertions</p>
                </div>
                <div class="bg-white dark:bg-gray-800 rounded-xl p-4 backdrop-blur-sm">
                  <div class="text-3xl mb-2">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icons-tabler-outline icon-tabler-lock"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-6" /><path d="M11 16a1 1 0 1 0 2 0a1 1 0 0 0 -2 0" /><path d="M8 11v-4a4 4 0 1 1 8 0v4" /></svg>
                  </div>
                  <h4 class="font-semibold text-[#444] dark:text-white mb-1">100% Client-Side</h4>
                  <p class="text-sm text-gray-600 dark:text-gray-400">Files never leave your device</p>
                </div>
              </div>
            </div>
          {/if}
        </div>

        {#if noManifest}
          <div class="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl p-8 mb-10 shadow-sm text-left">
            <div class="flex items-start gap-4">
              <div class="flex-shrink-0 w-12 h-12 bg-gray-400 dark:bg-gray-500 rounded-full flex items-center justify-center text-white text-2xl">
                🔍
              </div>
              <div class="flex-1">
                <h2 class="text-2xl font-bold text-gray-700 dark:text-gray-200 mb-3">No C2PA Content Credentials Found</h2>
                <p class="text-gray-600 dark:text-gray-300 leading-relaxed mb-4">This file doesn't appear to contain C2PA content credentials.</p>
                <button
                  on:click={resetToHome}
                  class="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white text-sm font-semibold rounded-lg transition-colors"
                >
                  Try Another File
                </button>
              </div>
            </div>
          </div>
        {/if}

        {#if error}
          <div class="bg-red-50 dark:bg-gray-900 border border-red-200 dark:border-gray-700 rounded-2xl p-8 mb-10 shadow-sm text-left">
            <div class="flex items-start gap-4">
              <div class="flex-shrink-0 w-12 h-12 bg-red-600 dark:bg-gray-600 rounded-full flex items-center justify-center text-white text-2xl">
                ⚠
              </div>
              <div class="flex-1">
                <h2 class="text-2xl font-bold text-red-700 dark:text-gray-300 mb-3">Error Processing File</h2>
                <p class="text-red-600 dark:text-gray-300 leading-relaxed mb-4">{error}</p>
                <button
                  on:click={resetToHome}
                  class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-lg transition-colors"
                >
                  Try Another File
                </button>
              </div>
            </div>
          </div>
        {/if}

        {#if pendingSidecar}
          <!-- Pending sidecar: waiting for the matching asset to be dropped -->
          <div class="bg-blue-50 dark:bg-gray-900 border-2 border-blue-400 dark:border-gray-600 border-dashed rounded-2xl p-8 mb-6 text-left shadow-sm">
            <div class="flex items-start gap-4">
              <div class="flex-shrink-0 w-12 h-12 bg-blue-600 dark:bg-gray-600 rounded-full flex items-center justify-center text-white">
                <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M15 13l-3.5 3.5a1.5 1.5 0 0 1 -2 0l-.5 -.5a1.5 1.5 0 0 1 0 -2l3.5 -3.5" /><path d="M9 11l-1.5 -1.5a1.5 1.5 0 0 1 0 -2l.5 -.5a1.5 1.5 0 0 1 2 0l1.5 1.5" /><path d="M13 11l1 1" /><path d="M11 13l1 1" /><path d="M14 4l-2 2" /><path d="M5 13l-1 1" /><path d="M4 14l-1 2l1 3l3 1l2 -1" /><path d="M14 20l2 1l3 -1l1 -3l-1 -2" /><path d="M20 10l1 -2l-1 -3l-3 -1l-2 1" /></svg>
              </div>
              <div class="flex-1 min-w-0">
                <h3 class="text-lg font-bold text-blue-900 dark:text-white mb-1">Sidecar received — now drop the matching asset</h3>
                <p class="text-sm text-blue-700 dark:text-gray-300 mb-1 truncate">
                  <span class="font-mono">{pendingSidecar.name}</span>
                </p>
                <p class="text-sm text-blue-600 dark:text-gray-400 mb-4">
                  Drop or select the asset file this sidecar belongs to. The sidecar's hash bindings will be verified against the asset bytes.
                </p>
                <div class="flex flex-wrap gap-3">
                  <FileUpload on:fileselect={(e) => handleFilesDropped([e.detail])} compact={true} label="Select asset file" />
                  <button
                    on:click={inspectSidecarWithoutAsset}
                    class="inline-flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-700 border border-blue-300 dark:border-gray-500 text-blue-700 dark:text-gray-200 text-sm font-semibold rounded-lg hover:bg-blue-50 dark:hover:bg-gray-600 transition-colors"
                  >
                    Inspect sidecar only (no asset)
                  </button>
                  <button
                    on:click={cancelPendingSidecar}
                    class="inline-flex items-center gap-2 px-4 py-2 text-gray-500 dark:text-gray-400 text-sm font-semibold hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        {:else}
          <!-- Upload Area -->
          <div class="mb-6">
            <FileUpload
              on:fileselect={handleFileSelect}
              on:filesselect={(e) => handleFilesDropped(e.detail)}
              compact={false}
            />
          </div>
        {/if}
      </div>
    {/if}

    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-8">
      {#if processing}
        <div
          class="flex flex-col items-center gap-6 py-20"
          aria-live="polite"
          aria-busy="true"
          aria-label="Processing file"
        >
          <div class="relative" aria-hidden="true">
            <div class="w-20 h-20 border-4 border-blue-200 dark:border-gray-700 rounded-full"></div>
            <div class="w-20 h-20 border-4 border-blue-600 dark:border-gray-400 border-t-transparent rounded-full animate-spin absolute top-0 left-0"></div>
          </div>
          <div class="text-center">
            <p class="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">{processingStatus}</p>
            <p class="text-sm text-gray-600 dark:text-gray-400">Please wait while we validate your file</p>
          </div>
        </div>
      {/if}

      {#if report}
        <ReportViewer
          {report}
          {usedTestCertificates}
          file={selectedFile}
        />
      {/if}
    </div>

  {/if}

  <!-- Footer (always shown) -->
  <footer class="border-t border-gray-200 dark:border-gray-700 mt-20">
    <div class="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <div class="flex flex-col md:flex-row md:items-start gap-10 text-sm">
        <div class="space-y-3 flex-1">
          <h3 class="font-bold text-gray-900 dark:text-gray-100 text-base mb-3">About This Tool</h3>
          <p class="text-gray-600 dark:text-gray-400 leading-relaxed">
            This tool validates C2PA manifests using the <a href="https://github.com/contentauth/c2pa-rs" target="_blank" rel="noopener noreferrer" class="text-blue-600 dark:text-gray-400 hover:text-blue-700 dark:hover:text-gray-300 transition-colors">c2pa-rs</a> SDK. All processing happens in your browser — files never leave your device.
          </p>
        </div>
        <div class="space-y-3 flex-1">
          <h3 class="font-bold text-gray-900 dark:text-gray-100 text-base mb-3">Learn More</h3>
          <ul class="space-y-2">
            <li>
              <a href="https://c2pa.org" target="_blank" rel="noopener noreferrer" class="text-blue-600 dark:text-gray-400 hover:text-blue-700 dark:hover:text-gray-300 transition-colors inline-flex items-center gap-2 group">
                <span>C2PA Specification</span>
                <span class="transform group-hover:translate-x-1 transition-transform">→</span>
              </a>
            </li>
            <li>
              <a href="https://c2pa.org/conformance" target="_blank" rel="noopener noreferrer" class="text-blue-600 dark:text-gray-400 hover:text-blue-700 dark:hover:text-gray-300 transition-colors inline-flex items-center gap-2 group">
                <span>Conformance Program</span>
                <span class="transform group-hover:translate-x-1 transition-transform">→</span>
              </a>
            </li>
          </ul>
        </div>
      </div>
      <div class="mt-10 pt-6 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
        <span class="text-xs text-gray-400 dark:text-gray-500">Built with ❤️ by the C2PA Conformance community</span>
        <a href="https://c2pa.org" target="_blank" rel="noopener noreferrer" aria-label="Visit C2PA website">
          <img src="{import.meta.env.BASE_URL}c2pa_icon.svg" alt="C2PA" class="h-7 w-auto opacity-60 hover:opacity-100 transition-opacity dark:brightness-0 dark:invert" />
        </a>
      </div>
    </div>
  </footer>
</main>
