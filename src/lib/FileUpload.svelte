<script lang="ts">
  import { createEventDispatcher } from 'svelte'

  export let compact = false

  const dispatch = createEventDispatcher<{ fileselect: File }>()

  let dragOver = false
  let fileInput: HTMLInputElement

  function handleDragOver(event: DragEvent) {
    event.preventDefault()
    dragOver = true
  }

  function handleDragLeave() {
    dragOver = false
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault()
    dragOver = false

    const files = event.dataTransfer?.files
    if (files && files.length > 0) {
      dispatch('fileselect', files[0])
    }
  }

  function handleFileInput(event: Event) {
    const target = event.target as HTMLInputElement
    const files = target.files
    if (files && files.length > 0) {
      dispatch('fileselect', files[0])
    }
  }

  function handleClick() {
    fileInput?.click()
  }
</script>

{#if compact}
  <button
    class="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors duration-200 shadow-sm whitespace-nowrap"
    on:click={handleClick}
  >
    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
    Browse Files
  </button>
  <input
    bind:this={fileInput}
    type="file"
    on:change={handleFileInput}
    accept="image/*,video/*,audio/*,.pdf,.dng,.arw,.cr2,.cr3,.nef,.orf,.rw2"
    class="hidden"
  />
{:else}
  <div
    class={`relative border-2 border-dashed rounded-2xl p-12 sm:p-16 cursor-pointer transition-colors duration-200 group ${
      dragOver
        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 shadow-md'
        : 'border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-blue-400 hover:bg-gray-50/50 dark:hover:bg-gray-700/50'
    }`}
    on:dragover={handleDragOver}
    on:dragleave={handleDragLeave}
    on:drop={handleDrop}
    role="button"
    tabindex="0"
    on:click={handleClick}
    on:keydown={(e) => e.key === 'Enter' && handleClick()}
  >
    <!-- Animated background gradient -->
    <div class="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-purple-500/5 dark:from-blue-500/10 dark:to-purple-500/10 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
    
    <!-- Content -->
    <div class="relative">
      <div class={`text-8xl text-center mb-6 transition-transform duration-300 ${dragOver ? 'scale-110' : 'group-hover:scale-110'}`}>
        <div class="inline-flex items-center justify-center w-24 h-24 bg-gradient-to-br from-blue-100 to-indigo-100 dark:from-blue-900/50 dark:to-indigo-900/50 rounded-2xl shadow-inner">
          <svg class="w-12 h-12 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
        </div>
      </div>
      <p class="text-2xl font-bold text-gray-900 dark:text-white text-center mb-3">
        {dragOver ? 'Drop it here!' : 'Drop a file or click to browse'}
      </p>
      <p class="text-base text-gray-600 dark:text-gray-400 text-center max-w-md mx-auto">
        Supports images, videos, audio, and PDF documents with C2PA manifests
      </p>
      
      <!-- File type badges -->
      <div class="flex items-center justify-center gap-2 mt-6 flex-wrap">
        <span class="px-3 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-full text-xs font-medium">Images</span>
        <span class="px-3 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-full text-xs font-medium">Videos</span>
        <span class="px-3 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-full text-xs font-medium">Audio</span>
        <span class="px-3 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-full text-xs font-medium">PDFs</span>
      </div>
    </div>

    <input
      bind:this={fileInput}
      type="file"
      on:change={handleFileInput}
      accept="image/*,video/*,audio/*,.pdf,.dng,.arw,.cr2,.cr3,.nef,.orf,.rw2"
      class="hidden"
    />
  </div>
{/if}

