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
    class="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors duration-200 shadow-sm hover:shadow-md whitespace-nowrap"
    on:click={handleClick}
  >
    📁 Browse Files
  </button>
  <input
    bind:this={fileInput}
    type="file"
    on:change={handleFileInput}
    accept="image/*,video/*,audio/*,.pdf"
    class="hidden"
  />
{:else}
  <div
    class={`border-2 border-dashed rounded-xl p-12 cursor-pointer transition-all duration-300 hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 ${
      dragOver
        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
        : 'border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800'
    }`}
    on:dragover={handleDragOver}
    on:dragleave={handleDragLeave}
    on:drop={handleDrop}
    role="button"
    tabindex="0"
    on:click={handleClick}
    on:keydown={(e) => e.key === 'Enter' && handleClick()}
  >
    <div class="text-7xl text-center mb-4">📁</div>
    <p class="text-xl font-medium text-gray-900 dark:text-white text-center mb-2">Drop a file here or click to select</p>
    <p class="text-sm text-gray-500 dark:text-gray-400 text-center">Supports images, videos, audio, and documents with C2PA manifests</p>

    <input
      bind:this={fileInput}
      type="file"
      on:change={handleFileInput}
      accept="image/*,video/*,audio/*,.pdf"
      class="hidden"
    />
  </div>
{/if}

