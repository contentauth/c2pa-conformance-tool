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
        ? 'border-blue-400 bg-blue-50 dark:bg-gray-700/40 shadow-md'
        : 'border-gray-400 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-gray-700/50'
    }`}
    on:dragover={handleDragOver}
    on:dragleave={handleDragLeave}
    on:drop={handleDrop}
    role="button"
    tabindex="0"
    on:click={handleClick}
    on:keydown={(e) => e.key === 'Enter' && handleClick()}
  >
    
    <!-- Content -->
    <div class="relative">
      <div class={`text-8xl text-center mb-6 transition-transform duration-200 ${dragOver ? 'scale-110' : 'group-hover:scale-110'}`}>
        <div class="inline-flex items-center justify-center w-24 h-24 bg-gradient-to-br from-blue-100 to-indigo-100 dark:from-gray-700/50 dark:to-gray-700/50 rounded-2xl shadow-inner text-blue-900 dark:text-gray-300">
          <svg xmlns="http://www.w3.org/2000/svg" width="50%" height="50%" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icons-tabler-outline icon-tabler-cloud-upload"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M7 18a4.6 4.4 0 0 1 0 -9a5 4.5 0 0 1 11 2h1a3.5 3.5 0 0 1 0 7h-1" /><path d="M9 15l3 -3l3 3" /><path d="M12 12l0 9" /></svg>
        </div>
      </div>
      <p class="text-2xl font-bold text-[#444] dark:text-white text-center mb-3">
        {dragOver ? 'Drop it here!' : 'Drop a file or click to browse'}
      </p>
      <p class="text-base text-gray-600 dark:text-gray-400 text-center max-w-md mx-auto">
        Supports images, videos, audio, and PDF documents with C2PA manifests
      </p>
      
      <!-- File type badges -->
      <div class="flex items-center justify-center gap-2 mt-6 flex-wrap">
        <span class="px-3 py-1 bg-gray-100 group-hover:bg-white dark:group-hover:bg-gray-600 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-full text-xs font-medium transition duration-200">Images</span>
        <span class="px-3 py-1 bg-gray-100 group-hover:bg-white dark:group-hover:bg-gray-600 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-full text-xs font-medium transition duration-200">Videos</span>
        <span class="px-3 py-1 bg-gray-100 group-hover:bg-white dark:group-hover:bg-gray-600 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-full text-xs font-medium transition duration-200">Audio</span>
        <span class="px-3 py-1 bg-gray-100 group-hover:bg-white dark:group-hover:bg-gray-600 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-full text-xs font-medium transition duration-200">PDFs</span>
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

