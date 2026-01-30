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

<div class="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
  <div class="flex-1">
    <h3 class="font-semibold text-amber-900 dark:text-amber-100 mb-2 flex items-center gap-2">
      <span class="text-2xl">⚠️</span>
      <span>Test Certificates (Conformance Testing)</span>
    </h3>
    <p class="text-sm text-amber-800 dark:text-amber-200 mb-3">
      Upload test certificates to include in the Trust List. Test certificates are session-only and clearly marked in results.
    </p>

      <div class="flex items-center justify-between gap-4">
        <div>
          {#if testCertificates.length > 0}
            <span class="text-sm text-amber-800 dark:text-amber-200 font-medium">
              {testCertificates.length} test {testCertificates.length === 1 ? 'certificate' : 'certificates'} loaded
            </span>
          {/if}
        </div>
        <button
          class="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors font-medium text-sm whitespace-nowrap"
          on:click={handleClick}
        >
          Upload Test Certificate
        </button>
      </div>

      {#if testCertificates.length > 0}
        <div class="mt-3 space-y-2">
          {#each testCertificates as cert, index}
            <div class="flex items-center justify-between bg-white dark:bg-amber-950 rounded p-2 text-sm">
              <span class="text-amber-900 dark:text-amber-100 font-mono truncate flex-1">
                Test Certificate #{index + 1}
              </span>
              <button
                class="text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 ml-2"
                on:click={() => removeCertificate(index)}
                title="Remove certificate"
              >
                ✕
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
