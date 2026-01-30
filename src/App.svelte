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

  // Test trust list fetching on component mount
  onMount(async () => {
    console.log('=== C2PA Conformance Tool Initialized ===')
    try {
      await testTrustListFetch()
    } catch (err) {
      console.warn('Trust list fetch test failed:', err)
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

    // Handle file-selected event from ReportViewer
    const handleFileSelectedEvent = (e: Event) => {
      const customEvent = e as CustomEvent<File>
      handleFileSelect({ detail: customEvent.detail } as CustomEvent<File>)
    }

    window.addEventListener('dragover', preventDefaults, false)
    window.addEventListener('drop', handleWindowDrop, false)
    window.addEventListener('file-selected', handleFileSelectedEvent as EventListener)

    // Cleanup
    return () => {
      window.removeEventListener('dragover', preventDefaults, false)
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

  function handleCertificatesUpdated(event: CustomEvent<string[]>) {
    testCertificates = event.detail
  }

  // Global drag and drop handlers
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
    // Only hide overlay if leaving the window entirely
    if (event.relatedTarget === null) {
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

  function handleGlobalDragEnter(event: DragEvent) {
    event.preventDefault()
    event.stopPropagation()
  }

  function resetToHome() {
    report = null
    error = null
    processing = false
    selectedFile = null
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
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-blue-600 dark:bg-blue-700 bg-opacity-95 transition-opacity duration-200">
      <div class="text-center text-white">
        <div class="text-8xl mb-4 animate-bounce">📁</div>
        <p class="text-3xl font-semibold">Drop file to analyze</p>
      </div>
    </div>
  {/if}

  <!-- Navigation Bar (always shown) -->
  <nav class="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 mb-8">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <button
        on:click={resetToHome}
        class="grid grid-cols-3 items-center h-16 gap-4 w-full bg-transparent border-none p-0 cursor-pointer hover:opacity-80 transition-opacity text-left"
        class:cursor-default={!report && !processing}
        class:hover:opacity-100={!report && !processing}
        disabled={!report && !processing}
        aria-label={report || processing ? "Return to home" : "C2PA Verify"}
      >
        <!-- Left: Content Credentials Logo -->
        <div class="flex items-center justify-start">
          <img src="/content_credentials_icon.svg" alt="Content Credentials" class="h-8 w-auto" />
        </div>

        <!-- Center: Title -->
        <div class="flex items-center justify-center">
          <h1 class="text-xl font-bold text-gray-900 dark:text-white text-center">C2PA Verify</h1>
        </div>

        <!-- Right: C2PA Logo -->
        <div class="flex items-center justify-end">
          <img src="/c2pa_icon.svg" alt="C2PA" class="h-8 w-auto" />
        </div>
      </button>
    </div>
  </nav>

  {#if !report && !processing}
    <!-- Hero Section -->
    <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center mb-12">
      <h2 class="text-4xl font-bold text-gray-900 dark:text-white mb-4">
        Content Credentials Validator<br />
        and Conformance Testing Tool
      </h2>
      <p class="text-lg text-gray-600 dark:text-gray-400 mb-8">
        Verify C2PA manifests and test against the official trust lists
      </p>

      <!-- What are Content Credentials -->
      <div class="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-6 mb-8 text-left">
        <h3 class="text-lg font-semibold text-blue-900 dark:text-blue-100 mb-3">What are Content Credentials?</h3>
        <p class="text-gray-700 dark:text-gray-300 mb-3">
          Content Credentials from The Coalition for Content Provenance and Authenticity (C2PA) is the technical standard for digital provenance. It provides verifiable assertions about the origin and history of digital content including images, video, audio, and documents. Here you can:
        </p>
        <ul class="space-y-2 text-gray-700 dark:text-gray-300">
          <li class="flex items-start gap-2">
            <span class="text-blue-600 dark:text-blue-400 mt-1">✓</span>
            <span><strong>Validate signatures</strong> against the official C2PA Conformance Trust Lists</span>
          </li>
          <li class="flex items-start gap-2">
            <span class="text-blue-600 dark:text-blue-400 mt-1">✓</span>
            <span><strong>View manifest details</strong> including actions, ingredients, and other assertions</span>
          </li>
          <li class="flex items-start gap-2">
            <span class="text-blue-600 dark:text-blue-400 mt-1">✓</span>
            <span><strong>Enjoy 100% client-side processing</strong> - your files never leave your device</span>
          </li>
        </ul>
      </div>

      <!-- Upload Area -->
      <div class="mb-8">
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

  <!-- Certificate Manager below nav (when viewing report and certificates exist) -->
  {#if (report || processing) && testCertificates.length > 0}
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-6">
      <CertificateManager
        bind:testCertificates={testCertificates}
        on:certificatesUpdated={handleCertificatesUpdated}
      />
    </div>
  {/if}

  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
    {#if processing}
      <div class="flex flex-col items-center gap-4 py-16">
        <div class="w-16 h-16 border-4 border-blue-200 dark:border-blue-800 border-t-blue-600 dark:border-t-blue-400 rounded-full animate-spin"></div>
        <p class="text-lg text-gray-700 dark:text-gray-300">Processing file...</p>
      </div>
    {/if}

    {#if error}
      <div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6 my-8">
        <h2 class="text-2xl font-semibold text-red-700 dark:text-red-400 mb-2">Error</h2>
        <p class="text-red-600 dark:text-red-300">{error}</p>
      </div>
    {/if}

    {#if report}
      <ReportViewer {report} {usedTestCertificates} file={selectedFile} />
    {/if}
  </div>

  {#if !report && !processing}
    <!-- Footer Information -->
    <div class="max-w-4xl mx-auto mt-16 pt-8 border-t border-gray-200 dark:border-gray-700">
      <div class="grid md:grid-cols-2 gap-8 text-sm text-gray-600 dark:text-gray-400">
        <div>
          <h3 class="font-semibold text-gray-900 dark:text-gray-100 mb-2">About This Tool</h3>
          <p class="mb-2">
            This tool validates C2PA manifests using the official <code class="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-xs">@contentauth/c2pa-web</code> SDK.
          </p>
          <p>
            All processing happens in your browser. Files never leave your device.
          </p>
        </div>
        <div>
          <h3 class="font-semibold text-gray-900 dark:text-gray-100 mb-2">Learn More</h3>
          <ul class="space-y-1">
            <li>
              <a href="https://c2pa.org" target="_blank" rel="noopener noreferrer" class="text-blue-600 dark:text-blue-400 hover:underline">
                C2PA Specification →
              </a>
            </li>
            <li>
              <a href="https://c2pa.org/conformance" target="_blank" rel="noopener noreferrer" class="text-blue-600 dark:text-blue-400 hover:underline">
                Conformance Program →
              </a>
            </li>
          </ul>
        </div>
      </div>
    </div>
  {/if}
</main>

