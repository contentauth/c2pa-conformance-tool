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

    window.addEventListener('dragover', preventDefaults, false)
    window.addEventListener('drop', handleWindowDrop, false)

    // Cleanup
    return () => {
      window.removeEventListener('dragover', preventDefaults, false)
      window.removeEventListener('drop', handleWindowDrop, false)
    }
  })

  async function handleFileSelect(event: CustomEvent<File>) {
    const file = event.detail
    console.log('📄 File selected:', file.name, file.type, file.size, 'bytes')

    processing = true
    error = null
    report = null
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

  {#if !report && !processing}
    <!-- Hero Section -->
    <div class="max-w-4xl mx-auto text-center mb-12">
      <h1 class="text-5xl font-bold text-gray-900 dark:text-white mb-6">C2PA Conformance Testing Tool</h1>
      <p class="text-xl text-gray-600 dark:text-gray-400 mb-8">
        Verify the authenticity and provenance of digital content using the official C2PA specification
      </p>

      <div class="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-6 mb-8 text-left">
        <h2 class="text-lg font-semibold text-blue-900 dark:text-blue-100 mb-3">What is C2PA?</h2>
        <p class="text-gray-700 dark:text-gray-300 mb-3">
          The Coalition for Content Provenance and Authenticity (C2PA) is a technical standard that provides transparency about the origin and history of digital content.
        </p>
        <ul class="space-y-2 text-gray-700 dark:text-gray-300">
          <li class="flex items-start gap-2">
            <span class="text-blue-600 dark:text-blue-400 mt-1">✓</span>
            <span><strong>Validate signatures</strong> against the official C2PA Conformance Trust List</span>
          </li>
          <li class="flex items-start gap-2">
            <span class="text-blue-600 dark:text-blue-400 mt-1">✓</span>
            <span><strong>View detailed manifests</strong> including assertions, ingredients, and provenance information</span>
          </li>
          <li class="flex items-start gap-2">
            <span class="text-blue-600 dark:text-blue-400 mt-1">✓</span>
            <span><strong>100% client-side processing</strong> - your files never leave your device</span>
          </li>
        </ul>
      </div>

      <!-- Test Certificate Manager -->
      <div class="mb-8">
        <CertificateManager
          bind:testCertificates={testCertificates}
          on:certificatesUpdated={handleCertificatesUpdated}
        />
      </div>
    </div>

    <!-- Upload Area -->
    <div class="max-w-2xl mx-auto">
      <FileUpload on:fileselect={handleFileSelect} compact={false} />
    </div>
  {:else}
    <!-- Compact Header when viewing report -->
    <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 mb-8">
      <div class="flex-1">
        <h1 class="text-3xl font-bold text-gray-900 dark:text-white mb-2">C2PA Conformance Testing Tool</h1>
        <p class="text-gray-600 dark:text-gray-400">Verify digital content authenticity and provenance</p>
      </div>
      <FileUpload on:fileselect={handleFileSelect} compact={true} />
    </div>
  {/if}

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
    <ReportViewer {report} {usedTestCertificates} />
  {/if}

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
            <li>
              <a href="https://contentauthenticity.org" target="_blank" rel="noopener noreferrer" class="text-blue-600 dark:text-blue-400 hover:underline">
                Content Authenticity Initiative →
              </a>
            </li>
          </ul>
        </div>
      </div>
    </div>
  {/if}
</main>

