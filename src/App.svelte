<script lang="ts">
  import { onMount } from 'svelte'
  import FileUpload from './lib/FileUpload.svelte'
  import ReportViewer from './lib/ReportViewer.svelte'
  import CertificateManager from './lib/CertificateManager.svelte'
  import { processFile } from './lib/c2pa'
  import { testTrustListFetch } from './lib/trustListTest'

  let report: any = null
  let error: string | null = null
  let processing = false
  let globalDragOver = false
  let testCertificates: string[] = []
  let usedTestCertificates = false
  let selectedFile: File | null = null
  let darkMode = false
  let infoSectionDismissed = false

  // Test trust list fetching on component mount
  onMount(async () => {
    console.log('=== C2PA Conformance Tool Initialized ===')
    try {
      await testTrustListFetch()
    } catch (err) {
      console.warn('Trust list fetch test failed:', err)
    }

    // Initialize dark mode from localStorage or system preference
    const savedTheme = localStorage.getItem('theme')
    if (savedTheme === 'dark') {
      darkMode = true
      document.documentElement.classList.add('dark')
    } else if (savedTheme === 'light') {
      darkMode = false
      document.documentElement.classList.remove('dark')
    } else {
      // Use system preference
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      darkMode = prefersDark
      if (prefersDark) {
        document.documentElement.classList.add('dark')
      }
    }

    // Check if info section was dismissed in this session
    const infoDismissed = sessionStorage.getItem('infoSectionDismissed')
    if (infoDismissed === 'true') {
      infoSectionDismissed = true
    }

    // Prevent default drag/drop behavior on the entire window
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
        handleFileSelect({ detail: files[0] } as CustomEvent<File>)
      }
    }

    // Handle when user drags out of the window completely
    const handleWindowDragLeave = (e: DragEvent) => {
      // Only hide if we're leaving the window (no relatedTarget means leaving the browser)
      if (!e.relatedTarget || e.relatedTarget === null) {
        globalDragOver = false
      }
    }

    // Handle file-selected event from ReportViewer
    const handleFileSelectedEvent = (e: Event) => {
      const customEvent = e as CustomEvent<File>
      handleFileSelect({ detail: customEvent.detail } as CustomEvent<File>)
    }

    window.addEventListener('dragover', preventDefaults, false)
    window.addEventListener('dragleave', handleWindowDragLeave, false)
    window.addEventListener('drop', handleWindowDrop, false)
    window.addEventListener('file-selected', handleFileSelectedEvent as EventListener)

    // Cleanup
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

    processing = true
    error = null
    report = null
    selectedFile = file
    usedTestCertificates = testCertificates.length > 0

    try {
      console.log('⏳ Starting file processing...')
      if (testCertificates.length > 0) {
        console.log('⚠️  Using', testCertificates.length, 'test certificate(s)')
      }
      report = await processFile(file, testCertificates)
      console.log('✅ File processed successfully:', report)
    } catch (err) {
      error = err instanceof Error ? err.message : 'An error occurred processing the file'
      console.error('❌ Error processing file:', err)
    } finally {
      console.log('🏁 Processing complete. Report:', !!report, 'Error:', !!error)
      processing = false
    }
  }

  async function handleCertificatesUpdated(event: CustomEvent<string[]>) {
    testCertificates = event.detail
    
    // If we're currently viewing a report, reprocess the file with updated certificates
    if (selectedFile && report) {
      console.log('🔄 Reprocessing file with updated certificates...')
      processing = true
      error = null
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

  // Global drag and drop handlers
  function handleGlobalDragEnter(event: DragEvent) {
    event.preventDefault()
    event.stopPropagation()
    globalDragOver = true
  }

  function handleGlobalDragOver(event: DragEvent) {
    event.preventDefault()
    event.stopPropagation()
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy'
    }
    globalDragOver = true
  }

  function handleGlobalDragLeave(event: DragEvent) {
    event.preventDefault()
    event.stopPropagation()
    // Hide overlay when leaving the document body (leaving the window)
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
      handleFileSelect({ detail: files[0] } as CustomEvent<File>)
    }
  }

  function resetToHome() {
    report = null
    error = null
    processing = false
    selectedFile = null
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

  function dismissInfoSection() {
    infoSectionDismissed = true
    sessionStorage.setItem('infoSectionDismissed', 'true')
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
            <img src="/content_credentials_icon.svg" alt="Content Credentials" class="h-8 w-auto transition-transform hover:scale-105 dark:brightness-0 dark:invert" />
          </a>
        </div>

        <!-- Center: Title (clickable when viewing report) -->
        <div class="flex items-center justify-center flex-1">
          {#if report || processing}
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

        <!-- Right: Dark mode toggle + C2PA Logo -->
        <div class="flex items-center justify-end gap-3">
          <button
            on:click={toggleDarkMode}
            class="p-2 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-all duration-200 group"
            aria-label="Toggle dark mode"
            title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {#if darkMode}
              <!-- Sun icon for light mode -->
              <svg class="w-5 h-5 text-yellow-500 group-hover:text-yellow-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            {:else}
              <!-- Moon icon for dark mode -->
              <svg class="w-5 h-5 text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            {/if}
          </button>
          <a href="https://c2pa.org" target="_blank" rel="noopener noreferrer" aria-label="Visit C2PA website">
            <img src="/c2pa_icon.svg" alt="C2PA" class="h-8 w-auto transition-transform hover:scale-105 dark:brightness-0 dark:invert" />
          </a>
        </div>
      </div>
    </div>
  </nav>

  {#if !report && !processing}
    <!-- Hero Section -->
    <div class="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center mb-16 mt-12">
      <div class="mb-12 animate-fade-in">
        <h2 class="text-5xl sm:text-6xl font-bold text-gray-900 dark:text-white mb-6 leading-tight">
          Content Credentials<br />
          <span class="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-400 dark:to-purple-400">
            Validator & Testing Tool
          </span>
        </h2>
        <p class="text-xl text-gray-600 dark:text-gray-400 max-w-3xl mx-auto">
          Verify C2PA manifests and test against the official trust lists — all in your browser
        </p>
      </div>

      {#if !infoSectionDismissed}
        <!-- What are Content Credentials -->
        <div class="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border border-blue-200 dark:border-blue-800 rounded-2xl p-8 mb-10 text-left shadow-sm hover:shadow-md transition-shadow duration-300 relative">
          <!-- Close button -->
          <button
            on:click={dismissInfoSection}
            class="absolute top-4 right-4 w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 rounded-lg transition-all"
            aria-label="Dismiss"
            title="Dismiss this message"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          <div class="flex items-start gap-3 mb-4">
            <div class="flex-shrink-0 w-10 h-10 bg-blue-600 dark:bg-blue-500 rounded-lg flex items-center justify-center">
              <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h3 class="text-xl font-bold text-blue-900 dark:text-blue-100">What is this all about?</h3>
            </div>
          </div>
        <p class="text-gray-700 dark:text-gray-300 mb-4 leading-relaxed">
          Content Credentials from The Coalition for Content Provenance and Authenticity (C2PA) is the technical standard for digital provenance. It provides verifiable assertions about the origin and history of digital content including images, video, audio, and documents.
        </p>
        <div class="grid sm:grid-cols-3 gap-4">
          <div class="bg-white/50 dark:bg-gray-800/50 rounded-xl p-4 backdrop-blur-sm">
            <div class="text-3xl mb-2">🔒</div>
            <h4 class="font-semibold text-gray-900 dark:text-white mb-1">Validate Signatures</h4>
            <p class="text-sm text-gray-600 dark:text-gray-400">Against official C2PA Trust Lists</p>
          </div>
          <div class="bg-white/50 dark:bg-gray-800/50 rounded-xl p-4 backdrop-blur-sm">
            <div class="text-3xl mb-2">📊</div>
            <h4 class="font-semibold text-gray-900 dark:text-white mb-1">View Manifest Details</h4>
            <p class="text-sm text-gray-600 dark:text-gray-400">Actions, ingredients, and assertions</p>
          </div>
          <div class="bg-white/50 dark:bg-gray-800/50 rounded-xl p-4 backdrop-blur-sm">
            <div class="text-3xl mb-2">🔐</div>
            <h4 class="font-semibold text-gray-900 dark:text-white mb-1">100% Client-Side</h4>
            <p class="text-sm text-gray-600 dark:text-gray-400">Files never leave your device</p>
          </div>
        </div>
        </div>
      {/if}

      {#if error}
        <div class="bg-gradient-to-br from-red-50 to-orange-50 dark:from-red-900/20 dark:to-orange-900/20 border-2 border-red-300 dark:border-red-700 rounded-2xl p-8 mb-10 shadow-lg text-left">
          <div class="flex items-start gap-4">
            <div class="flex-shrink-0 w-12 h-12 bg-red-600 dark:bg-red-500 rounded-full flex items-center justify-center text-white text-2xl">
              ⚠
            </div>
            <div class="flex-1">
              <h2 class="text-2xl font-bold text-red-700 dark:text-red-400 mb-3">Error Processing File</h2>
              <p class="text-red-600 dark:text-red-300 leading-relaxed mb-4">{error}</p>
              <button
                on:click={resetToHome}
                class="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors duration-200 font-semibold shadow-md hover:shadow-lg"
              >
                Try Another File
              </button>
            </div>
          </div>
        </div>
      {/if}

      <!-- Upload Area -->
      <div class="mb-10">
        <FileUpload on:fileselect={handleFileSelect} compact={false} />
      </div>

      <!-- Test Certificate Manager -->
      <div class="mb-8">
        <CertificateManager
          bind:testCertificates={testCertificates}
          on:certificatesUpdated={handleCertificatesUpdated}
        />
      </div>
    </div>
  {/if}

  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-8">
    {#if processing}
      <div class="flex flex-col items-center gap-6 py-20">
        <div class="relative">
          <div class="w-20 h-20 border-4 border-blue-200 dark:border-blue-800 rounded-full"></div>
          <div class="w-20 h-20 border-4 border-blue-600 dark:border-blue-400 border-t-transparent rounded-full animate-spin absolute top-0 left-0"></div>
        </div>
        <div class="text-center">
          <p class="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">Processing file...</p>
          <p class="text-sm text-gray-600 dark:text-gray-400">Validating C2PA manifest and signatures</p>
        </div>
      </div>
    {/if}

    {#if report}
      <ReportViewer {report} {usedTestCertificates} file={selectedFile} bind:testCertificates={testCertificates} on:certificatesUpdated={handleCertificatesUpdated} />
    {/if}
  </div>

  {#if !report && !processing}
    <!-- Footer Information -->
    <div class="max-w-5xl mx-auto mt-20 pt-8 px-4 sm:px-6 lg:px-8 border-t border-gray-200 dark:border-gray-700">
      <div class="grid md:grid-cols-2 gap-10 text-sm">
        <div class="space-y-3">
          <h3 class="font-bold text-gray-900 dark:text-gray-100 text-base mb-3">About This Tool</h3>
          <p class="text-gray-600 dark:text-gray-400 leading-relaxed">
            This tool validates C2PA manifests using the official <code class="px-2 py-1 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded font-mono text-xs">@contentauth/c2pa-web</code> SDK.
          </p>
          <p class="text-gray-600 dark:text-gray-400 leading-relaxed">
            All processing happens in your browser. Files never leave your device.
          </p>
        </div>
        <div class="space-y-3">
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
      <div class="text-center mt-10 pb-8 text-gray-500 dark:text-gray-500 text-xs">
        Built with ❤️ by the C2PA Conformance community
      </div>
    </div>
  {/if}
</main>

