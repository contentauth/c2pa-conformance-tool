<script lang="ts">
  import { onMount } from 'svelte'
  import FileUpload from './lib/FileUpload.svelte'
  import ReportViewer from './lib/ReportViewer.svelte'
  import CertificateManager from './lib/CertificateManager.svelte'
  import AssetProfilePage from './lib/AssetProfilePage.svelte'
  import { processFile } from './lib/c2pa'
  import { testTrustListFetch } from './lib/trustListTest'
  import type { ConformanceReport } from './lib/types'

  type Page = 'main' | 'test-certificates' | 'asset-profiles'

  let report: ConformanceReport | null = null
  let error: string | null = null
  let noManifest = false
  let processing = false
  let globalDragOver = false
  let testCertificates: string[] = []
  let usedTestCertificates = false
  let selectedFile: File | null = null
  let darkMode = false
  let infoSectionExpanded = false
  let testModeEnabled = false
  let testRootLoaded = false
  let processingStatus = 'Processing file...'
  let currentPage: Page = 'main'
  let menuOpen = false
  let assetProfilePage: { handleExternalAssetFile: (file: File) => Promise<void> } | null = null

  // Test trust list fetching on component mount
  onMount(() => {
    console.log('=== C2PA Conformance Tool Initialized ===')
    testTrustListFetch().catch(err => {
      console.warn('Trust list fetch test failed:', err)
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
        if (currentPage === 'asset-profiles') {
          void handleAssetProfileFileSelect(files[0])
        } else {
          void handleFileSelect({ detail: files[0] } as CustomEvent<File>)
        }
      }
    }

    const handleWindowDragLeave = (e: DragEvent) => {
      if (!e.relatedTarget || e.relatedTarget === null) {
        globalDragOver = false
      }
    }

    const handleFileSelectedEvent = (e: Event) => {
      const customEvent = e as CustomEvent<File>
      if (currentPage === 'asset-profiles') {
        void handleAssetProfileFileSelect(customEvent.detail)
      } else {
        void handleFileSelect({ detail: customEvent.detail } as CustomEvent<File>)
      }
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

  async function handleAssetProfileFileSelect(file: File) {
    currentPage = 'asset-profiles'
    menuOpen = false
    await assetProfilePage?.handleExternalAssetFile(file)
  }

  async function handleTestModeChanged(event: CustomEvent<{ enabled: boolean; rootLoaded: boolean }>) {
    testModeEnabled = event.detail.enabled
    testRootLoaded = event.detail.rootLoaded

    if (selectedFile && report) {
      console.log('🔄 Test mode changed, reprocessing file...')
      processing = true
      error = null
      noManifest = false
      const previousReport = report
      report = null

      try {
        await new Promise(resolve => setTimeout(resolve, 0))
        usedTestCertificates = testCertificates.length > 0
        if (testCertificates.length > 0) {
          console.log('⚠️  Using', testCertificates.length, 'test certificate(s)')
        } else {
          console.log('✅ Using production trust list only')
        }
        report = await processFile(selectedFile, testCertificates)
        console.log('✅ File reprocessed successfully')
      } catch (err) {
        error = err instanceof Error ? err.message : 'An error occurred processing the file'
        console.error('❌ Error reprocessing file:', err)
        report = previousReport
      } finally {
        processing = false
      }
    }
  }

  async function handleCertificatesUpdated(event: CustomEvent<string[]>) {
    console.log('🔔 handleCertificatesUpdated called with', event.detail.length, 'certificates')
    testCertificates = event.detail

    if (selectedFile && report) {
      console.log('🔄 Reprocessing file with updated certificates...')
      processing = true
      error = null
      noManifest = false
      report = null
      usedTestCertificates = testCertificates.length > 0

      try {
        if (testCertificates.length > 0) {
          console.log('⚠️  Using', testCertificates.length, 'test certificate(s)')
        }
        report = await processFile(selectedFile, testCertificates)
        console.log('✅ File reprocessed successfully')
      } catch (err) {
        error = err instanceof Error ? err.message : 'An error occurred processing the file'
        console.error('❌ Error reprocessing file:', err)
      } finally {
        processing = false
      }
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
      if (currentPage === 'asset-profiles') {
        void handleAssetProfileFileSelect(files[0])
      } else {
        void handleFileSelect({ detail: files[0] } as CustomEvent<File>)
      }
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
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-gradient-to-br from-blue-600 to-purple-600 dark:from-blue-700 dark:to-purple-700 bg-opacity-98 backdrop-blur-md transition-all duration-300 animate-fade-in">
      <div class="text-center text-white">
        <div class="mb-8 animate-bounce">
          <div class="inline-flex items-center justify-center w-32 h-32 bg-white/20 backdrop-blur-sm rounded-3xl shadow-2xl">
            <svg class="w-20 h-20 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          </div>
        </div>
        <p class="text-5xl font-bold mb-3">Drop file to analyze</p>
        <p class="text-2xl opacity-90">We'll validate it instantly</p>
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
              class="text-xl font-bold text-gray-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200 cursor-pointer"
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
              class="inline-flex items-center gap-2 px-3 py-1.5 bg-amber-600 dark:bg-amber-500 text-white rounded-lg hover:bg-amber-700 dark:hover:bg-amber-600 transition-colors text-sm font-semibold shadow-sm"
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
              <svg class="w-5 h-5 text-yellow-500 group-hover:text-yellow-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            {:else}
              <svg class="w-5 h-5 text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
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
                <svg class="w-5 h-5 text-gray-700 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              {:else}
                <!-- Hamburger icon -->
                <svg class="w-5 h-5 text-gray-700 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
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
                  <svg class="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                  </svg>
                  <span>Test Certificates</span>
                  {#if testCertificates.length > 0}
                    <span class="ml-auto px-1.5 py-0.5 bg-amber-600 dark:bg-amber-500 text-white rounded-full text-xs font-bold">{testCertificates.length}</span>
                  {/if}
                </button>
                <button
                  on:click={() => navigateTo('asset-profiles')}
                  class="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-left"
                >
                  <svg class="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span>Asset Profiles</span>
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

  <!-- ── Asset Profiles page ── -->
  {:else if currentPage === 'asset-profiles'}
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
        <h2 class="mt-4 text-2xl font-bold text-gray-900 dark:text-white">Asset Profiles</h2>
        <p class="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Define expected manifest shapes to validate assets against a specific profile.
        </p>
      </div>
      <AssetProfilePage bind:this={assetProfilePage} {testCertificates} />
    </div>

  <!-- ── Main page ── -->
  {:else}
    {#if !report && !processing}
      <!-- Hero Section -->
      <div class="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center mb-12 mt-10">
        <div class="mb-10 animate-fade-in">
          <h2 class="text-4xl sm:text-5xl font-bold text-gray-900 dark:text-white mb-4 leading-tight">
            Content Credentials<br />
            <span class="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-400 dark:to-purple-400">
              Validator & Testing Tool
            </span>
          </h2>
          <p class="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
            Verify C2PA manifests against official trust lists. All processing in your browser.
          </p>
        </div>

        <!-- Collapsible Info Section -->
        <div class="mb-6">
          <button
            on:click={toggleInfoSection}
            class="inline-flex items-center gap-2 px-4 py-2 bg-blue-100 dark:bg-blue-950 hover:bg-blue-200 dark:hover:bg-blue-900 text-blue-900 dark:text-blue-100 rounded-lg transition-colors text-sm font-semibold"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            What is this all about?
            <svg class="w-4 h-4 transition-transform {infoSectionExpanded ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {#if infoSectionExpanded}
            <div class="bg-blue-50 dark:bg-gray-900 border border-blue-200 dark:border-gray-700 rounded-2xl p-8 mt-4 text-left shadow-sm animate-fade-in">
              <p class="text-gray-700 dark:text-gray-300 mb-4 leading-relaxed">
                Content Credentials from The Coalition for Content Provenance and Authenticity (C2PA) is the technical standard for digital provenance. It provides verifiable assertions about the origin and history of digital content including images, video, audio, and documents.
              </p>
              <div class="grid sm:grid-cols-3 gap-4">
                <div class="bg-white/50 dark:bg-gray-800 rounded-xl p-4 backdrop-blur-sm">
                  <div class="text-3xl mb-2">🔒</div>
                  <h4 class="font-semibold text-gray-900 dark:text-white mb-1">Validate Signatures</h4>
                  <p class="text-sm text-gray-600 dark:text-gray-400">Against official C2PA Trust Lists</p>
                </div>
                <div class="bg-white/50 dark:bg-gray-800 rounded-xl p-4 backdrop-blur-sm">
                  <div class="text-3xl mb-2">📊</div>
                  <h4 class="font-semibold text-gray-900 dark:text-white mb-1">View Manifest Details</h4>
                  <p class="text-sm text-gray-600 dark:text-gray-400">Actions, ingredients, and assertions</p>
                </div>
                <div class="bg-white/50 dark:bg-gray-800 rounded-xl p-4 backdrop-blur-sm">
                  <div class="text-3xl mb-2">🔐</div>
                  <h4 class="font-semibold text-gray-900 dark:text-white mb-1">100% Client-Side</h4>
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
          <div class="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-2xl p-8 mb-10 shadow-sm text-left">
            <div class="flex items-start gap-4">
              <div class="flex-shrink-0 w-12 h-12 bg-red-600 dark:bg-red-500 rounded-full flex items-center justify-center text-white text-2xl">
                ⚠
              </div>
              <div class="flex-1">
                <h2 class="text-2xl font-bold text-red-700 dark:text-red-400 mb-3">Error Processing File</h2>
                <p class="text-red-600 dark:text-red-300 leading-relaxed mb-4">{error}</p>
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

        <!-- Upload Area -->
        <div class="mb-6">
          <FileUpload on:fileselect={handleFileSelect} compact={false} />
        </div>
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
            <div class="w-20 h-20 border-4 border-blue-200 dark:border-blue-800 rounded-full"></div>
            <div class="w-20 h-20 border-4 border-blue-600 dark:border-blue-400 border-t-transparent rounded-full animate-spin absolute top-0 left-0"></div>
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
            This tool validates C2PA manifests using the <a href="https://github.com/contentauth/c2pa-rs" target="_blank" rel="noopener noreferrer" class="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors">c2pa-rs</a> SDK. All processing happens in your browser — files never leave your device.
          </p>
        </div>
        <div class="space-y-3 flex-1">
          <h3 class="font-bold text-gray-900 dark:text-gray-100 text-base mb-3">Learn More</h3>
          <ul class="space-y-2">
            <li>
              <a href="https://c2pa.org" target="_blank" rel="noopener noreferrer" class="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors inline-flex items-center gap-2 group">
                <span>C2PA Specification</span>
                <span class="transform group-hover:translate-x-1 transition-transform">→</span>
              </a>
            </li>
            <li>
              <a href="https://c2pa.org/conformance" target="_blank" rel="noopener noreferrer" class="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors inline-flex items-center gap-2 group">
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
