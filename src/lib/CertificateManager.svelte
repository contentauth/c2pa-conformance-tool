<script lang="ts">
  import { createEventDispatcher } from 'svelte'

  export let testCertificates: string[] = []

  const dispatch = createEventDispatcher<{
    certificatesUpdated: string[]
  }>()

  let fileInput: HTMLInputElement

  function handleFileSelect(event: Event) {
    const input = event.target as HTMLInputElement
    const files = input.files
    if (!files || files.length === 0) return

    const file = files[0]
    const reader = new FileReader()

    reader.onload = (e) => {
      const content = e.target?.result as string
      if (content && (content.includes('BEGIN CERTIFICATE') || content.includes('BEGIN TRUSTED CERTIFICATE'))) {
        testCertificates = [...testCertificates, content]
        dispatch('certificatesUpdated', testCertificates)
        console.log('✅ Test certificate added:', file.name)
      } else {
        alert('Invalid certificate file. Please upload a PEM-encoded certificate.')
      }
    }

    reader.readAsText(file)
    input.value = '' // Reset input
  }

  function removeCertificate(index: number) {
    testCertificates = testCertificates.filter((_, i) => i !== index)
    dispatch('certificatesUpdated', testCertificates)
  }

  function handleClick() {
    fileInput.click()
  }
</script>

<div class="bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 border-2 border-amber-300 dark:border-amber-700 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow duration-300">
  <div class="flex-1">
    <div class="flex items-start gap-3 mb-3">
      <div class="flex-shrink-0 w-10 h-10 bg-amber-600 dark:bg-amber-500 rounded-lg flex items-center justify-center">
        <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      </div>
      <div class="flex-1">
        <h3 class="font-bold text-amber-900 dark:text-amber-100 text-lg">
          Test Certificates
        </h3>
        <p class="text-sm text-amber-800/90 dark:text-amber-200/90 mt-1">
          Upload test certificates for conformance testing. Session-only and clearly marked in results.
        </p>
      </div>
    </div>

    <div class="flex items-center justify-between gap-4 mt-4">
      <div>
        {#if testCertificates.length > 0}
          <span class="inline-flex items-center gap-2 px-3 py-1 bg-amber-200 dark:bg-amber-800/50 text-amber-900 dark:text-amber-100 rounded-full text-sm font-semibold">
            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
            </svg>
            {testCertificates.length} {testCertificates.length === 1 ? 'certificate' : 'certificates'} loaded
          </span>
        {/if}
      </div>
      <button
        class="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 text-white rounded-lg transition-all duration-200 font-semibold text-sm whitespace-nowrap shadow-md hover:shadow-lg transform hover:scale-105"
        on:click={handleClick}
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        Upload Certificate
      </button>
    </div>

    {#if testCertificates.length > 0}
      <div class="mt-4 space-y-2">
        {#each testCertificates as cert, index}
          <div class="flex items-center justify-between bg-white/70 dark:bg-amber-950/50 backdrop-blur-sm rounded-lg p-3 text-sm border border-amber-200 dark:border-amber-800 hover:bg-white dark:hover:bg-amber-950 transition-colors group">
            <div class="flex items-center gap-3 flex-1">
              <div class="w-8 h-8 bg-amber-100 dark:bg-amber-800 rounded-lg flex items-center justify-center">
                <svg class="w-4 h-4 text-amber-700 dark:text-amber-300" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clip-rule="evenodd" />
                </svg>
              </div>
              <span class="text-amber-900 dark:text-amber-100 font-medium">
                Test Certificate #{index + 1}
              </span>
            </div>
            <button
              class="flex items-center justify-center w-8 h-8 text-amber-600 dark:text-amber-400 hover:text-white hover:bg-amber-600 dark:hover:bg-amber-700 rounded-lg transition-all duration-200 opacity-0 group-hover:opacity-100"
              on:click={() => removeCertificate(index)}
              title="Remove certificate"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<input
  bind:this={fileInput}
  type="file"
  accept=".pem,.crt,.cer"
  on:change={handleFileSelect}
  class="hidden"
/>
