<script lang="ts">
  import { createEventDispatcher, onDestroy } from 'svelte'
  import type { ValidationStatus } from '@contentauth/c2pa-web'
  import hljs from 'highlight.js'
  import CertificateManager from './CertificateManager.svelte'
  import ManifestSummary from './ManifestSummary.svelte'
  import type { ConformanceReport, ValidationStatusItem, AssertionSummaryItem, CrJsonManifestEntry } from './types'
  import {
    getAssertionsList,
    getIngredientsFromManifest,
    getSignatureInfo,
    getClaimInfo,
    getActiveManifestValidationStatus
  } from './crjson'
  import { VALIDATION_STATUS } from './constants'

  $: rawJsonHighlighted = (() => {
    try {
      return hljs.highlight(JSON.stringify(report, null, 2), { language: 'json' }).value
    } catch {
      return ''
    }
  })()
  $: if (rawJsonCodeEl && rawJsonHighlighted) {
    rawJsonCodeEl.innerHTML = rawJsonHighlighted
  }

  export let report: ConformanceReport
  export let usedTestCertificates = false
  export let file: File | null = null
  export let testCertificates: string[] = []
  export let testModeEnabled = false
  export let testRootLoaded = false

  const dispatch = createEventDispatcher<{
    newfile: void
    certificatesUpdated: string[]
    testModeChanged: { enabled: boolean; rootLoaded: boolean }
  }>()

  let showRaw = false
  let rawJsonCodeEl: HTMLElement | null = null
  let copied = false
  let copyTimeout: ReturnType<typeof setTimeout> | null = null
  let mediaUrl: string | null = null
  let mediaType: 'image' | 'video' | 'audio' | 'document' | 'unknown' = 'unknown'

  // Only these image types can be rendered by browsers natively
  const BROWSER_PREVIEWABLE_IMAGES = new Set([
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
    'image/avif', 'image/svg+xml', 'image/bmp', 'image/ico', 'image/x-icon',
  ])
  let fileInput: HTMLInputElement
  let validationStatus: ValidationStatusItem[] = []
  let expandedIngredients: Set<number> = new Set()
  let expandedAssertions: Set<number> = new Set()
  let showBackToTop = false

  // Track scroll position for back to top button
  function handleScroll() {
    showBackToTop = window.scrollY > 400
  }

  function toggleIngredient(index: number) {
    if (expandedIngredients.has(index)) {
      expandedIngredients.delete(index)
    } else {
      expandedIngredients.add(index)
    }
    expandedIngredients = expandedIngredients // Trigger reactivity
  }

  function toggleAssertion(index: number) {
    if (expandedAssertions.has(index)) {
      expandedAssertions.delete(index)
    } else {
      expandedAssertions.add(index)
    }
    expandedAssertions = expandedAssertions // Trigger reactivity
  }

  function expandAllAssertions() {
    const list = activeManifest ? getAssertionsList(activeManifest) : []
    expandedAssertions = new Set(list.map((_, i) => i))
  }

  function collapseAllAssertions() {
    expandedAssertions = new Set()
  }

  function expandAllIngredients() {
    const list = activeManifest ? getIngredientsFromManifest(activeManifest) : []
    expandedIngredients = new Set(list.map((_, i) => i))
  }

  function collapseAllIngredients() {
    expandedIngredients = new Set()
  }

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Get ingredient manifest from crJSON manifests array (returns crJSON entry for UI getters)
  function getIngredientManifest(ingredient: { active_manifest?: string; instance_id?: string; [key: string]: unknown }): CrJsonManifestEntry | null {
    const manifests = report.manifests
    if (!manifests || !Array.isArray(manifests)) return null

    const label = ingredient.active_manifest ?? ingredient.instance_id
    if (label) {
      const entry = manifests.find((m: { label: string }) => m.label === label)
      if (entry) return entry
    }

    if (ingredient.instance_id) {
      const entry = manifests.find((m: CrJsonManifestEntry) => {
        const claim = (m.claim ?? m['claim.v2']) as Record<string, unknown> | undefined
        return claim && (claim.instanceID === ingredient.instance_id || claim.instance_id === ingredient.instance_id) || m.label === ingredient.instance_id
      })
      if (entry) return entry
    }

    return null
  }

  // Create object URL for media preview
  $: if (file) {
    if (mediaUrl) {
      URL.revokeObjectURL(mediaUrl)
    }
    mediaUrl = URL.createObjectURL(file)

    // Determine media type
    if (file.type.startsWith('image/')) {
      mediaType = BROWSER_PREVIEWABLE_IMAGES.has(file.type) ? 'image' : 'unknown'
    } else if (file.type.startsWith('video/')) {
      mediaType = 'video'
    } else if (file.type.startsWith('audio/')) {
      mediaType = 'audio'
    } else if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
      mediaType = 'document'
    } else {
      mediaType = 'unknown'
    }
  }

  onDestroy(() => {
    if (mediaUrl) {
      URL.revokeObjectURL(mediaUrl)
      mediaUrl = null
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('scroll', handleScroll)
    }
  })

  // Add scroll listener on mount
  $: if (typeof window !== 'undefined') {
    window.addEventListener('scroll', handleScroll)
  }

  // Active manifest: crJSON puts it first in the array (raw crJSON entry)
  $: activeManifest = report.manifests?.[0] ?? null

  // Read from crJSON locations via getters
  $: assertionsList = activeManifest ? getAssertionsList(activeManifest) : []
  $: ingredientsList = activeManifest ? getIngredientsFromManifest(activeManifest) : []
  $: signatureInfo = activeManifest ? getSignatureInfo(activeManifest) : undefined
  $: claimInfo = activeManifest ? getClaimInfo(activeManifest) : undefined

  // Get validation results from crJSON (document-level or per-manifest from c2pa-rs)
  $: validationResults = getActiveManifestValidationStatus(report)

  // Check if trusted from crJSON validationResults
  $: isTrusted = validationResults?.success?.some((status: ValidationStatus) =>
    status.code === VALIDATION_STATUS.SIGNING_CREDENTIAL_TRUSTED
  ) ?? false

  // Check if signature is using Interim Trust List
  $: usedITL = report.usedITL === true

  // Check if test certificates were actually needed for validation
  // This is determined by validating twice in processFile - once with official TL, once with test certs
  $: actuallyUsedTestCert = report.usedTestCerts === true

  // Build validation status array - show key validation results from success and failure
  $: {
    const successStatuses: ValidationStatusItem[] = validationResults?.success?.filter((status: ValidationStatus) =>
      status.code === VALIDATION_STATUS.SIGNING_CREDENTIAL_TRUSTED ||
      status.code === VALIDATION_STATUS.TIMESTAMP_TRUSTED ||
      status.code === VALIDATION_STATUS.CLAIM_SIGNATURE_VALIDATED
    ).map((status: ValidationStatus) => {
      const isInterim = status.code === VALIDATION_STATUS.SIGNING_CREDENTIAL_TRUSTED && usedITL
      return {
        code: status.code,
        success: true,
        isInterim,
        explanation: status.explanation ?? 'Validation passed'
      }
    }) ?? []

    const failureStatuses: ValidationStatusItem[] = validationResults?.failure?.filter((status: ValidationStatus) =>
      status.code === VALIDATION_STATUS.SIGNING_CREDENTIAL_UNTRUSTED ||
      status.code === VALIDATION_STATUS.TIMESTAMP_UNTRUSTED ||
      status.code === VALIDATION_STATUS.CLAIM_SIGNATURE_INVALID
    ).map((status: ValidationStatus) => ({
      code: status.code,
      success: false,
      isInterim: false,
      explanation: status.explanation ?? 'Validation failed'
    })) ?? []

    validationStatus = [...successStatuses, ...failureStatuses]
  }

  // Certificate validity status derived from validation results
  $: certValidityStatus = (() => {
    if (!validationResults) return 'unknown' as const
    const failure = validationResults.failure ?? []
    const success = validationResults.success ?? []
    const info = validationResults.informational ?? []
    if (failure.some((s: ValidationStatus) => s.code === VALIDATION_STATUS.SIGNING_CREDENTIAL_EXPIRED))
      return 'expired' as const
    const validCodes = [VALIDATION_STATUS.CLAIM_SIGNATURE_INSIDE_VALIDITY, VALIDATION_STATUS.TIME_OF_SIGNING_INSIDE_VALIDITY]
    if ([...success, ...info].some((s: ValidationStatus) => validCodes.includes(s.code as typeof validCodes[number])))
      return 'valid' as const
    return 'unknown' as const
  })()

  // OCSP revocation status derived from validation results
  $: ocspStatus = (() => {
    if (!validationResults) return 'unknown' as const
    const failure = validationResults.failure ?? []
    const success = validationResults.success ?? []
    const info = validationResults.informational ?? []
    if (failure.some((s: ValidationStatus) => s.code === VALIDATION_STATUS.SIGNING_CREDENTIAL_OCSP_REVOKED))
      return 'revoked' as const
    if (success.some((s: ValidationStatus) => s.code === VALIDATION_STATUS.SIGNING_CREDENTIAL_OCSP_NOT_REVOKED))
      return 'not_revoked' as const
    if (info.some((s: ValidationStatus) => s.code === VALIDATION_STATUS.SIGNING_CREDENTIAL_OCSP_INACCESSIBLE))
      return 'inaccessible' as const
    if (info.some((s: ValidationStatus) => s.code === VALIDATION_STATUS.SIGNING_CREDENTIAL_OCSP_SKIPPED))
      return 'no_staple' as const
    return 'unknown' as const
  })()

  function downloadReport() {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `c2pa-report-${Date.now()}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  async function copyToClipboard() {
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2))
    if (copyTimeout) clearTimeout(copyTimeout)
    copied = true
    copyTimeout = setTimeout(() => {
      copied = false
      copyTimeout = null
    }, 2000)
  }

  // Elide long hash-like values for readability
  function elideValue(value: unknown, key?: string): unknown {
    if (typeof value === 'string') {
      // Check if this is a hash-like field based on key name
      const isHashKey = key && (
        key.toLowerCase().includes('hash') ||
        key.toLowerCase().includes('pad') ||
        key === 'identifier'
      )

      // Check if value looks like a hash (long hex string, base64, etc.)
      // But exclude instance_id and document_id patterns
      const looksLikeHash = value.length > 32 && (
        /^[0-9a-fA-F]{32,}$/.test(value) || // Hex hash
        /^[A-Za-z0-9+/]{32,}={0,2}$/.test(value) // Base64
      )

      if (isHashKey || looksLikeHash) {
        return '<elided>'
      }
    } else if (Array.isArray(value)) {
      // Check if it's an array of numbers (binary data)
      if (value.length > 10 && value.every(v => typeof v === 'number' && v >= 0 && v <= 255)) {
        return '<binary data elided>'
      }
      return value.map(v => elideValue(v))
    } else if (typeof value === 'object' && value !== null) {
      const result: Record<string, unknown> = {}
      const obj = value as Record<string, unknown>
      for (const k of Object.keys(obj)) {
        result[k] = elideValue(obj[k], k)
      }
      return result
    }
    return value
  }

  // Format assertion data with elided hashes
  function formatAssertionData(data: unknown): string {
    const elided = elideValue(data)
    return JSON.stringify(elided, null, 2)
  }

  // Get abbreviated digital source type (last part of URL)
  function getAbbreviatedSourceType(url: string): string {
    if (!url) return ''
    const parts = url.split('/')
    return parts[parts.length - 1] || url
  }

  // Extract key-value pairs from assertion data for display
  function extractAssertionSummary(data: unknown): AssertionSummaryItem[] {
    if (!data || typeof data !== 'object') {
      return []
    }

    const summary: AssertionSummaryItem[] = []
    const obj = data as Record<string, unknown>

    // Handle actions specially - show each action separately with specific fields
    const actions = obj.actions
    if (actions && Array.isArray(actions) && actions.length > 0) {
      actions.forEach((action: unknown, index: number) => {
        const act = action as Record<string, unknown>
        const actionName = (act.action as string) || extractMeaningfulValue(action)
        if (actionName !== '') {
          const digitalSourceType = (act.digitalSourceType ?? obj.digitalSourceType) as string | undefined
          const description = act.description as string | undefined
          summary.push({
            key: actions.length > 1 ? `action ${index + 1}` : 'action',
            value: action,
            digitalSourceType,
            isAction: true,
            actionName,
            description
          })
        }
      })
    }

    if (!actions && obj.digitalSourceType) {
      summary.push({ key: 'digitalSourceType', value: obj.digitalSourceType })
    }

    for (const [key, value] of Object.entries(obj)) {
      // Skip actions and digitalSourceType as we handled them above
      if (key === 'actions' || key === 'digitalSourceType') {
        continue
      }

      // Skip undefined and null
      if (typeof value === 'undefined' || value === null) {
        continue
      }

      // For arrays
      if (Array.isArray(value)) {
        if (value.length === 0) {
          continue // Skip empty arrays
        }
        // Check if we can extract meaningful values
        const formatted = formatValue(value)
        if (formatted !== '') {
          summary.push({ key, value })
        }
      }
      // For objects
      else if (typeof value === 'object') {
        const objKeys = Object.keys(value)
        if (objKeys.length === 0) {
          continue // Skip empty objects
        }
        // Check if we can extract meaningful values
        const formatted = formatValue(value)
        if (formatted !== '') {
          summary.push({ key, value })
        }
      }
      // For primitives
      else {
        const formatted = formatValue(value)
        if (formatted !== '') {
          summary.push({ key, value })
        }
      }
    }

    return summary.slice(0, 15) // Increased limit to accommodate multiple actions
  }

  // Format a value for display
  function formatValue(value: unknown): string {
    if (value === null || value === undefined) {
      return ''
    }
    if (typeof value === 'boolean') {
      return value ? 'Yes' : 'No'
    }
    if (typeof value === 'object') {
      if (Array.isArray(value)) {
        if (value.length > 0 && typeof value[0] === 'object') {
          const items = value.map(item => extractMeaningfulValue(item)).filter(s => s !== '')
          return items.length > 0 ? items.join(', ') : ''
        }
        return value.length <= 3 ? value.join(', ') : `[${value.length} items]`
      }
      const extracted = extractMeaningfulValue(value)
      return extracted !== '' ? extracted : ''
    }
    const str = String(value)
    if (str === '[object Object]') {
      return ''
    }
    return str.length > 100 ? str.substring(0, 97) + '...' : str
  }

  // Extract a meaningful string from an object
  function extractMeaningfulValue(obj: unknown): string {
    if (!obj || typeof obj !== 'object') {
      const str = String(obj)
      if (str === '[object Object]') {
        return ''
      }
      return str
    }

    const meaningfulKeys = [
      'action', 'name', 'label', 'title', 'type', 'digitalSourceType',
      'softwareAgent', 'when', 'reason', 'description', 'value', 'version'
    ]

    const record = obj as Record<string, unknown>
    for (const key of meaningfulKeys) {
      if (record[key] !== undefined && record[key] !== null) {
        const value = record[key]
        // If the value is a simple type, return it
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          return String(value)
        }
      }
    }

    if (record.action) {
      return String(record.action)
    }

    const keys = Object.keys(record)
    if (keys.length > 0 && keys.length <= 3) {
      const simpleEntries = keys
        .filter(k => {
          const v = record[k]
          return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
        })
        .map(k => `${k}: ${record[k]}`)

      if (simpleEntries.length > 0) {
        return simpleEntries.join(', ')
      }
    }

    // Don't show anything if we can't extract meaningful data
    return ''
  }

  function handleNewFile() {
    fileInput?.click()
  }

  function handleFileInput(event: Event) {
    const target = event.target as HTMLInputElement
    const files = target.files
    if (files && files.length > 0) {
      dispatch('newfile')
      // The file will be handled by the parent component through the FileUpload event
      window.dispatchEvent(new CustomEvent('file-selected', { detail: files[0] }))
    }
  }
</script>

  <div class="text-left mt-8 animate-fade-in">
  <!-- Prominent Validation Status Banner -->
  <div class="mb-8 bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-2xl p-6 shadow-lg">
    <div class="flex items-center gap-4">
      <div class={`flex-shrink-0 w-16 h-16 rounded-full flex items-center justify-center ${isTrusted ? 'bg-green-100 dark:bg-green-950' : 'bg-red-100 dark:bg-red-950'}`}>
        {#if isTrusted}
          <svg class="w-10 h-10 text-green-600 dark:text-green-400" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
          </svg>
        {:else}
          <svg class="w-10 h-10 text-red-600 dark:text-red-400" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
          </svg>
        {/if}
      </div>
      <div class="flex-1">
        <h3 class="text-xl font-semibold {isTrusted ? 'text-green-900 dark:text-green-100' : 'text-red-900 dark:text-red-100'} mb-1">
          {#if isTrusted}
            {#if usedITL}
              Signature Trusted via ITL ✓
            {:else if actuallyUsedTestCert}
              Signature Trusted via Test Certificate ✓
            {:else}
              Signature Trusted ✓
            {/if}
          {:else}
            Signature Not Trusted
          {/if}
        </h3>
        <p class="text-sm {isTrusted ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}">
          {#if usedITL && isTrusted}
            Validated using Interim Trust List 
            <a
              href="https://c2pa.org/conformance/"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1 ml-2 text-xs underline hover:no-underline"
              title="The Interim Trust List (ITL) contains certificates that are in the process of C2PA certification"
            >
              <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd" />
              </svg>
              What is the ITL?
            </a>
          {:else if actuallyUsedTestCert && isTrusted}
            Validated using custom test certificates - not validated against official C2PA trust lists
          {:else if isTrusted}
            Validated against official C2PA Trust List
          {:else}
            The signing credential could not be validated against known trust lists
          {/if}
        </p>
        {#if usedITL && isTrusted}
          <div class="mt-2 flex items-center gap-2 flex-wrap">
            <span class="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-200 rounded-full text-xs font-semibold">
              <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd" />
              </svg>
              ITL Validated
            </span>
            {#if testModeEnabled}
              <span class="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-200 rounded-full text-xs font-semibold">
                <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
                </svg>
                Test Mode Active
              </span>
            {/if}
          </div>
        {:else if actuallyUsedTestCert && isTrusted}
          <div class="mt-2">
            <span class="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-200 rounded-full text-xs font-semibold">
              <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
              </svg>
              Test Mode
            </span>
          </div>
        {:else if testModeEnabled && isTrusted}
          <div class="mt-2">
            <span class="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-200 rounded-full text-xs font-semibold">
              <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd" />
              </svg>
              Test Mode Active
            </span>
          </div>
        {/if}
      </div>
    </div>
  </div>

  <div class="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-6 gap-4">
    <div>
      <h2 class="text-xl font-semibold text-gray-900 dark:text-white">Conformance Report</h2>
      <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Manifest validation details</p>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <div class="flex items-center gap-1 border border-gray-200 dark:border-gray-600 rounded-lg p-1">
        <button
          class="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors {!showRaw ? 'bg-gray-100 dark:bg-gray-700 font-medium' : ''}"
          on:click={() => showRaw = false}
        >
          Formatted
        </button>
        <button
          class="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors {showRaw ? 'bg-gray-100 dark:bg-gray-700 font-medium' : ''}"
          on:click={() => showRaw = true}
        >
          crJSON
        </button>
      </div>
      <button
        class="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 dark:text-gray-400 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        on:click={downloadReport}
        title="Download report as JSON"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
        Download
      </button>
      <button
        class="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border transition-colors {copied ? 'border-green-500 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}"
        on:click={copyToClipboard}
        title="Copy JSON to clipboard"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
        {copied ? 'Copied!' : 'Copy'}
      </button>
      <button
        class="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors"
        on:click={handleNewFile}
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
        New File
      </button>
    </div>
  </div>

  <!-- Hidden file input -->
  <input
    bind:this={fileInput}
    type="file"
    on:change={handleFileInput}
    accept="image/*,video/*,audio/*,.pdf,.dng,.arw,.cr2,.cr3,.nef,.orf,.rw2"
    class="hidden"
  />

  {#if usedTestCertificates}
    <div class="mb-8 bg-amber-50 dark:bg-amber-950 border border-amber-300 dark:border-amber-800 rounded-2xl p-6 shadow-sm">
      <div class="flex items-start gap-4">
        <div class="flex-shrink-0 w-12 h-12 bg-amber-600 dark:bg-amber-500 rounded-full flex items-center justify-center text-white text-2xl shadow-md">
          ⚠
        </div>
        <div class="flex-1">
          <h3 class="font-bold text-amber-900 dark:text-amber-100 text-lg mb-2">Test Certificate Mode Active</h3>
          <p class="text-sm text-amber-800 dark:text-amber-200 leading-relaxed">
            This validation used custom test certificates. Results may differ from production validation using only the official C2PA trust list.
          </p>
        </div>
      </div>
    </div>
  {/if}

  <!-- Section Navigation -->
  {#if activeManifest}
    <div class="mb-6 flex items-center gap-1 flex-wrap border-b border-gray-200 dark:border-gray-700 pb-4">
      <span class="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mr-2">Jump to:</span>
      <a href="#media-preview" class="text-sm px-2 py-1 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">Media</a>
      <span class="text-gray-300 dark:text-gray-600 select-none">·</span>
      <a href="#validation-status" class="text-sm px-2 py-1 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">Validation</a>
      <span class="text-gray-300 dark:text-gray-600 select-none">·</span>
      <a href="#signature-info" class="text-sm px-2 py-1 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">Signature</a>
      <span class="text-gray-300 dark:text-gray-600 select-none">·</span>
      <a href="#manifest-details" class="text-sm px-2 py-1 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">Manifest</a>
      {#if assertionsList.length > 0}
        <span class="text-gray-300 dark:text-gray-600 select-none">·</span>
        <a href="#assertions" class="text-sm px-2 py-1 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">Assertions ({assertionsList.length})</a>
      {/if}
      {#if ingredientsList.length > 0}
        <span class="text-gray-300 dark:text-gray-600 select-none">·</span>
        <a href="#ingredients" class="text-sm px-2 py-1 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">Ingredients ({ingredientsList.length})</a>
      {/if}
      <span class="text-gray-300 dark:text-gray-600 select-none">·</span>
      <a href="#test-certificates" class="text-sm px-2 py-1 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">Test Certs</a>
    </div>
  {/if}

  <!-- Back to Top Button -->
  {#if showBackToTop}
    <button
      on:click={scrollToTop}
      class="fixed bottom-8 right-8 z-50 p-4 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-2xl transition-all duration-200 hover:scale-110 animate-fade-in"
      aria-label="Back to top"
      title="Back to top"
    >
      <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 10l7-7m0 0l7 7m-7-7v18" />
      </svg>
    </button>
  {/if}

  {#if showRaw}
    <div class="bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-2xl p-8 shadow-lg">
      <div class="flex items-center gap-3 mb-6 pb-4 border-b-2 border-gray-200 dark:border-gray-700">
        <div class="w-10 h-10 bg-gray-800 dark:bg-gray-700 rounded-lg flex items-center justify-center text-white shadow-md">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
          </svg>
        </div>
        <h3 class="text-xl font-semibold text-gray-900 dark:text-white">crJSON Report</h3>
      </div>
      <pre class="hljs bg-gray-900 dark:bg-black border-2 border-gray-700 dark:border-gray-600 rounded-xl p-6 overflow-x-auto text-sm leading-relaxed shadow-inner"><code class="language-json" bind:this={rawJsonCodeEl}></code></pre>
    </div>
  {:else}
    <!-- Media Preview and Validation Status -->
    <div class="mb-8" id="media-preview">
      <div class="bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-2xl p-8 shadow-lg hover:shadow-xl transition-shadow duration-300">
        <div class="flex items-center gap-3 mb-6 pb-4 border-b border-gray-200 dark:border-gray-700">
          <div class="w-10 h-10 bg-gray-800 dark:bg-gray-700 rounded-lg flex items-center justify-center text-white shadow-md">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <h3 class="text-xl font-semibold text-gray-900 dark:text-white">Media Preview</h3>
        </div>

        {#if file && mediaUrl}
          <div class="flex flex-col gap-6">
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div class="bg-gray-50 dark:bg-gray-900 rounded-xl p-4">
                <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-1">Filename</div>
                <p class="text-sm font-medium text-gray-900 dark:text-gray-100 truncate" title={file.name}>{file.name}</p>
              </div>
              <div class="bg-gray-50 dark:bg-gray-900 rounded-xl p-4">
                <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-1">Type</div>
                <p class="text-sm font-medium text-gray-900 dark:text-gray-100">{file.type || 'Unknown'}</p>
              </div>
              <div class="bg-gray-50 dark:bg-gray-900 rounded-xl p-4">
                <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-1">Size</div>
                <p class="text-sm font-medium text-gray-900 dark:text-gray-100">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
              </div>
            </div>

            <div class="bg-gray-50 dark:bg-gray-900 rounded-2xl p-6 flex items-center justify-center min-h-[350px] border border-gray-200 dark:border-gray-700">
              {#if mediaType === 'image'}
                <img src={mediaUrl} alt="Preview" class="max-w-full max-h-[600px] object-contain rounded-xl shadow-lg" />
              {:else if mediaType === 'video'}
                <video src={mediaUrl} controls class="max-w-full max-h-[600px] rounded-xl shadow-lg">
                  <track kind="captions" />
                  Your browser does not support video playback.
                </video>
              {:else if mediaType === 'audio'}
                <div class="w-full max-w-md">
                  <div class="w-20 h-20 mx-auto bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl flex items-center justify-center text-white text-4xl mb-6 shadow-lg">
                    🎵
                  </div>
                  <audio src={mediaUrl} controls class="w-full">
                    Your browser does not support audio playback.
                  </audio>
                </div>
              {:else if mediaType === 'document'}
                <div class="text-center">
                  <div class="w-20 h-20 mx-auto bg-gradient-to-br from-red-500 to-orange-500 rounded-2xl flex items-center justify-center text-white text-4xl mb-6 shadow-lg">
                    📄
                  </div>
                  <p class="text-gray-600 dark:text-gray-400 mb-4 text-lg font-medium">PDF Document</p>
                  <a href={mediaUrl} download={file.name} class="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors shadow-sm">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download PDF
                  </a>
                </div>
              {:else}
                <div class="text-center">
                  <p class="text-gray-700 dark:text-gray-200 text-lg font-semibold mb-2">Preview not available</p>
                  <p class="text-gray-500 dark:text-gray-400 text-sm">
                    {file.type || file.name.split('.').pop()?.toUpperCase() + ' file' || 'This file type'} cannot be displayed in the browser.
                  </p>
                </div>
              {/if}
            </div>
          </div>

          <ManifestSummary
            manifest={activeManifest}
            ingredients={ingredientsList}
            mimeType={file?.type ?? ''}
            {usedITL}
            {isTrusted}
          />
        {:else}
          <div class="text-center py-12 text-gray-500 dark:text-gray-400">
            <div class="text-6xl mb-4">📁</div>
            <p>No media file available</p>
          </div>
        {/if}

      </div>
    </div>

    <div class="space-y-8">
      {#if activeManifest}
        <!-- Validation Status Details Section -->
        <section class="bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-2xl p-8 shadow-lg hover:shadow-xl transition-shadow duration-300" id="validation-status">
          <div class="flex items-center gap-3 mb-6 pb-4 border-b border-gray-200 dark:border-gray-700">
            <div class="w-10 h-10 bg-gray-800 dark:bg-gray-700 rounded-lg flex items-center justify-center text-white shadow-md">
              <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
              </svg>
            </div>
            <h3 class="text-xl font-semibold text-gray-900 dark:text-white">Validation Status Details</h3>
          </div>
          {#if validationStatus && validationStatus.length > 0}
            <div class="space-y-3">
              {#each validationStatus as status}
                <div class={`rounded-xl p-5 border-2 transition-all duration-200 hover:shadow-md ${
                  status.isInterim
                    ? 'bg-blue-50 dark:bg-blue-950 border-blue-300 dark:border-blue-700'
                    : status.success
                      ? 'bg-green-50 dark:bg-green-950 border-green-300 dark:border-green-800'
                      : 'bg-red-50 dark:bg-red-950 border-red-300 dark:border-red-800'
                }`}>
                  <div class="flex items-start gap-3">
                    <div class={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-white text-sm font-bold ${
                      status.isInterim
                        ? 'bg-blue-600 dark:bg-blue-500'
                        : status.success
                          ? 'bg-green-600 dark:bg-green-500'
                          : 'bg-red-600 dark:bg-red-500'
                    }`}>
                      {status.isInterim ? 'i' : status.success ? '✓' : '✕'}
                    </div>
                    <div class="flex-1">
                      <p class="font-bold text-gray-900 dark:text-gray-100 mb-1">
                        {status.code}
                        {#if status.isInterim}
                          <span class="ml-2 px-2 py-0.5 bg-blue-200 dark:bg-blue-800 text-blue-900 dark:text-blue-100 text-xs font-semibold rounded">ITL</span>
                        {/if}
                      </p>
                      {#if status.explanation}
                        <p class={`text-sm leading-relaxed ${
                          status.isInterim
                            ? 'text-blue-800 dark:text-blue-300'
                            : status.success
                              ? 'text-green-800 dark:text-green-300'
                              : 'text-red-800 dark:text-red-300'
                        }`}>{status.explanation}</p>
                      {/if}
                    </div>
                  </div>
                </div>
              {/each}
            </div>
          {:else}
            <div class="bg-gray-50 dark:bg-gray-900 border-2 border-gray-200 dark:border-gray-700 rounded-xl p-6 text-center">
              <p class="text-gray-600 dark:text-gray-400">No validation status available</p>
            </div>
          {/if}
        </section>

        {#if signatureInfo}
          <section class="bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-2xl p-8 shadow-lg hover:shadow-xl transition-shadow duration-300" id="signature-info">
            <div class="flex items-center gap-3 mb-6 pb-4 border-b border-gray-200 dark:border-gray-700">
              <div class="w-10 h-10 bg-gray-800 dark:bg-gray-700 rounded-lg flex items-center justify-center text-white shadow-md">
                <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
                </svg>
              </div>
              <h3 class="text-xl font-semibold text-gray-900 dark:text-white">Signature Information</h3>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
              {#if signatureInfo.common_name}
                <div class="bg-gray-50 dark:bg-gray-900 rounded-xl p-4">
                  <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-2">Common Name</div>
                  <p class="text-sm font-medium text-gray-900 dark:text-gray-100 break-all">{signatureInfo.common_name}</p>
                </div>
              {/if}
              {#if signatureInfo.issuer}
                <div class="bg-gray-50 dark:bg-gray-900 rounded-xl p-4">
                  <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-2">Issuer</div>
                  <p class="text-sm font-medium text-gray-900 dark:text-gray-100 break-all">{signatureInfo.issuer}</p>
                </div>
              {/if}
              {#if signatureInfo.time}
                <div class="bg-gray-50 dark:bg-gray-900 rounded-xl p-4">
                  <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-2">Signed</div>
                  <p class="text-sm font-medium text-gray-900 dark:text-gray-100">{signatureInfo.time}</p>
                </div>
              {/if}
              {#if signatureInfo.alg}
                <div class="bg-gray-50 dark:bg-gray-900 rounded-xl p-4">
                  <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-2">Algorithm</div>
                  <p class="text-sm font-medium text-gray-900 dark:text-gray-100">{signatureInfo.alg}</p>
                </div>
              {/if}

              <!-- Certificate Validity -->
              {#if certValidityStatus !== 'unknown'}
                <div class="bg-gray-50 dark:bg-gray-900 rounded-xl p-4">
                  <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-2">Certificate Validity</div>
                  {#if certValidityStatus === 'valid'}
                    <div class="flex items-center gap-2">
                      <svg class="w-4 h-4 text-green-600 dark:text-green-400 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>
                      <span class="text-sm font-medium text-green-700 dark:text-green-400">Valid at time of signing</span>
                    </div>
                  {:else if certValidityStatus === 'expired'}
                    <div class="flex items-center gap-2">
                      <svg class="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/></svg>
                      <span class="text-sm font-medium text-red-700 dark:text-red-400">Expired at time of signing</span>
                    </div>
                  {/if}
                </div>
              {/if}

              <!-- OCSP Revocation Status -->
              {#if ocspStatus !== 'unknown'}
                <div class="bg-gray-50 dark:bg-gray-900 rounded-xl p-4">
                  <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-2">OCSP Revocation</div>
                  {#if ocspStatus === 'not_revoked'}
                    <div class="flex items-center gap-2">
                      <svg class="w-4 h-4 text-green-600 dark:text-green-400 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>
                      <span class="text-sm font-medium text-green-700 dark:text-green-400">Not revoked</span>
                    </div>
                  {:else if ocspStatus === 'revoked'}
                    <div class="flex items-center gap-2">
                      <svg class="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/></svg>
                      <span class="text-sm font-medium text-red-700 dark:text-red-400">Revoked</span>
                    </div>
                  {:else if ocspStatus === 'no_staple'}
                    <div class="flex items-center gap-2">
                      <svg class="w-4 h-4 text-amber-500 dark:text-amber-400 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
                      <span class="text-sm font-medium text-amber-700 dark:text-amber-400">No OCSP staple present</span>
                    </div>
                  {:else if ocspStatus === 'inaccessible'}
                    <div class="flex items-center gap-2">
                      <svg class="w-4 h-4 text-amber-500 dark:text-amber-400 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
                      <span class="text-sm font-medium text-amber-700 dark:text-amber-400">OCSP server inaccessible</span>
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          </section>
        {/if}

        <section class="bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-2xl p-8 shadow-lg hover:shadow-xl transition-shadow duration-300" id="manifest-details">
          <div class="flex items-center gap-3 mb-6 pb-4 border-b border-gray-200 dark:border-gray-700">
            <div class="w-10 h-10 bg-gray-800 dark:bg-gray-700 rounded-lg flex items-center justify-center text-white shadow-md">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 class="text-xl font-semibold text-gray-900 dark:text-white">Active Manifest</h3>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div class="bg-gray-50 dark:bg-gray-900 rounded-xl p-4">
              <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-2">Claim Generator</div>
              <p class="text-sm font-medium text-gray-900 dark:text-gray-100">
                {#if claimInfo?.claim_generator_info?.length > 0}
                  {claimInfo.claim_generator_info[0].name}
                  {#if claimInfo.claim_generator_info[0].version}
                    <span class="text-blue-600 dark:text-blue-400">v{claimInfo.claim_generator_info[0].version}</span>
                  {/if}
                {:else if claimInfo?.claim_generator}
                  {claimInfo.claim_generator}
                {:else}
                  N/A
                {/if}
              </p>
            </div>
            <div class="bg-gray-50 dark:bg-gray-900 rounded-xl p-4">
              <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-2">Instance ID</div>
              <p class="text-sm font-medium text-gray-900 dark:text-gray-100 break-all font-mono">{claimInfo?.instance_id ?? activeManifest?.label ?? 'N/A'}</p>
            </div>
            {#if activeManifest?.label}
              <div class="bg-gray-50 dark:bg-gray-900 rounded-xl p-4 md:col-span-2">
                <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-2">Label</div>
                <p class="text-sm font-medium text-gray-900 dark:text-gray-100 break-all">{activeManifest.label}</p>
              </div>
            {/if}
          </div>
        </section>

        {#if assertionsList.length > 0}
          <section class="bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-2xl p-8 shadow-lg hover:shadow-xl transition-shadow duration-300" id="assertions">
            <div class="flex items-center gap-3 mb-6 pb-4 border-b border-gray-200 dark:border-gray-700">
              <div class="w-10 h-10 bg-gray-800 dark:bg-gray-700 rounded-lg flex items-center justify-center text-white shadow-md">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
              </div>
              <div class="flex-1">
                <h3 class="text-xl font-semibold text-gray-900 dark:text-white">Assertions</h3>
              </div>
              <div class="flex items-center gap-2">
                <button
                  on:click={expandAllAssertions}
                  class="text-xs px-3 py-1 bg-purple-100 dark:bg-purple-950 hover:bg-purple-200 dark:hover:bg-purple-900 text-purple-700 dark:text-purple-300 rounded-lg transition-colors font-semibold"
                  title="Expand all assertions"
                >
                  Expand All
                </button>
                <button
                  on:click={collapseAllAssertions}
                  class="text-xs px-3 py-1 bg-purple-100 dark:bg-purple-950 hover:bg-purple-200 dark:hover:bg-purple-900 text-purple-700 dark:text-purple-300 rounded-lg transition-colors font-semibold"
                  title="Collapse all assertions"
                >
                  Collapse All
                </button>
                <div class="px-3 py-1 bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 rounded-full text-sm font-bold">
                  {assertionsList.length}
                </div>
              </div>
            </div>
            <div class="space-y-4">
              {#each assertionsList as assertion, index}
                {@const isExpanded = expandedAssertions.has(index)}
                {@const summary = assertion.data ? extractAssertionSummary(assertion.data) : []}
                <div class="bg-gray-50 dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-700 hover:border-purple-300 dark:hover:border-purple-700 transition-colors">
                  <div class="flex items-start gap-3 mb-3">
                    <div class="flex-shrink-0 w-8 h-8 bg-purple-100 dark:bg-purple-950 rounded-lg flex items-center justify-center text-purple-700 dark:text-purple-300 font-bold text-sm">
                      {index + 1}
                    </div>
                    <div class="flex-1">
                      <p class="font-bold text-gray-900 dark:text-gray-100 text-lg">{assertion.label || assertion.url || 'Unknown'}</p>
                      {#if assertion.data}
                        <button
                          on:click={() => toggleAssertion(index)}
                          class="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 transition-colors"
                        >
                          <svg class="w-3 h-3 transition-transform {isExpanded ? 'rotate-90' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                          </svg>
                          {isExpanded ? 'Hide' : 'Show'} raw data
                        </button>
                      {/if}
                    </div>
                  </div>

                  {#if assertion.data}
                    <div class="ml-11">
                      {#if summary.length > 0}
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
                          {#each summary as item}
                            <div class="bg-white dark:bg-gray-800 rounded-lg p-3">
                              {#if item.isAction}
                                <!-- Special display for actions -->
                                <div class="space-y-2">
                                  <div>
                                    <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-1">
                                      {item.key}
                                    </div>
                                    <div class="text-sm font-medium text-gray-900 dark:text-gray-100">
                                      {item.actionName}
                                    </div>
                                  </div>

                                  {#if item.digitalSourceType}
                                    <div>
                                      <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-1">
                                        Digital Source Type
                                      </div>
                                      <a
                                        href={item.digitalSourceType}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        class="text-sm font-medium text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 underline"
                                      >
                                        {getAbbreviatedSourceType(item.digitalSourceType)}
                                      </a>
                                    </div>
                                  {/if}

                                  {#if item.description}
                                    <div>
                                      <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-1">
                                        Description
                                      </div>
                                      <div class="text-sm font-medium text-gray-900 dark:text-gray-100 break-words">
                                        {item.description}
                                      </div>
                                    </div>
                                  {/if}
                                </div>
                              {:else}
                                <!-- Standard display for other fields -->
                                <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-1">
                                  {item.key}
                                </div>
                                <div class="text-sm font-medium text-gray-900 dark:text-gray-100 break-words">
                                  {formatValue(item.value)}
                                </div>
                              {/if}
                            </div>
                          {/each}
                        </div>
                      {/if}

                      {#if isExpanded}
                        <div class="mt-3 animate-fade-in">
                          <div class="flex items-center gap-2 mb-2">
                            <svg class="w-4 h-4 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                            </svg>
                            <span class="text-xs font-bold text-purple-700 dark:text-purple-300 uppercase tracking-wide">Complete Data</span>
                          </div>
                          <pre class="bg-gray-900 dark:bg-black/50 p-4 rounded-lg text-xs overflow-x-auto text-gray-100 dark:text-gray-300 border border-gray-700 leading-relaxed">{formatAssertionData(assertion.data)}</pre>
                        </div>
                      {/if}
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          </section>
        {/if}

        {#if ingredientsList.length > 0}
          <section class="bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-2xl p-8 shadow-lg hover:shadow-xl transition-shadow duration-300" id="ingredients">
            <div class="flex items-center gap-3 mb-6 pb-4 border-b border-gray-200 dark:border-gray-700">
              <div class="w-10 h-10 bg-gray-800 dark:bg-gray-700 rounded-lg flex items-center justify-center text-white shadow-md">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </div>
              <div class="flex-1">
                <h3 class="text-xl font-semibold text-gray-900 dark:text-white">Ingredients</h3>
              </div>
              <div class="flex items-center gap-2">
                <button
                  on:click={expandAllIngredients}
                  class="text-xs px-3 py-1 bg-orange-100 dark:bg-orange-950 hover:bg-orange-200 dark:hover:bg-orange-900 text-orange-700 dark:text-orange-300 rounded-lg transition-colors font-semibold"
                  title="Expand all ingredients"
                >
                  Expand All
                </button>
                <button
                  on:click={collapseAllIngredients}
                  class="text-xs px-3 py-1 bg-orange-100 dark:bg-orange-950 hover:bg-orange-200 dark:hover:bg-orange-900 text-orange-700 dark:text-orange-300 rounded-lg transition-colors font-semibold"
                  title="Collapse all ingredients"
                >
                  Collapse All
                </button>
                <div class="px-3 py-1 bg-orange-100 dark:bg-orange-950 text-orange-700 dark:text-orange-300 rounded-full text-sm font-bold">
                  {ingredientsList.length}
                </div>
              </div>
            </div>
            <div class="space-y-4">
              {#each ingredientsList as ingredient, index}
                {@const ingredientManifest = getIngredientManifest(ingredient)}
                {@const isExpanded = expandedIngredients.has(index)}
                <div class="bg-gray-50 dark:bg-gray-900 rounded-xl p-5 border border-gray-200 dark:border-gray-700 hover:border-orange-300 dark:hover:border-orange-700 transition-colors">
                  <div class="flex items-start gap-3 mb-3">
                    <div class="flex-shrink-0 w-8 h-8 bg-orange-100 dark:bg-orange-950 rounded-lg flex items-center justify-center text-orange-700 dark:text-orange-300 font-bold text-sm">
                      {index + 1}
                    </div>
                    <div class="flex-1">
                      <p class="font-bold text-gray-900 dark:text-gray-100 text-lg">{ingredient.title || ingredient.instance_id || 'Unknown'}</p>
                      {#if ingredientManifest}
                        <button
                          on:click={() => toggleIngredient(index)}
                          class="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-orange-600 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300 transition-colors"
                        >
                          <svg class="w-3 h-3 transition-transform {isExpanded ? 'rotate-90' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                          </svg>
                          {isExpanded ? 'Hide' : 'Show'} manifest details
                        </button>
                      {/if}
                    </div>
                  </div>
                  <div class="ml-11 space-y-3">
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {#if ingredient.relationship}
                        <div class="bg-white dark:bg-gray-800 rounded-lg p-3">
                          <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-1">Relationship</div>
                          <p class="text-sm font-medium text-gray-900 dark:text-gray-100">{ingredient.relationship}</p>
                        </div>
                      {/if}
                      {#if ingredient.format}
                        <div class="bg-white dark:bg-gray-800 rounded-lg p-3">
                          <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-1">Format</div>
                          <p class="text-sm font-medium text-gray-900 dark:text-gray-100">{ingredient.format}</p>
                        </div>
                      {/if}
                    </div>
                    {#if ingredient.document_id}
                      <div class="bg-white dark:bg-gray-800 rounded-lg p-3">
                        <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-1">Document ID</div>
                        <p class="text-sm font-medium text-gray-900 dark:text-gray-100 break-all font-mono">{ingredient.document_id}</p>
                      </div>
                    {/if}
                    {#if ingredient.instance_id && !ingredient.title}
                      <div class="bg-white dark:bg-gray-800 rounded-lg p-3">
                        <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-1">Instance ID</div>
                        <p class="text-sm font-medium text-gray-900 dark:text-gray-100 break-all font-mono">{ingredient.instance_id}</p>
                      </div>
                    {/if}

                    <!-- Ingredient Manifest Information (read from crJSON via getters) -->
                    {#if ingredientManifest && isExpanded}
                      {@const ingClaim = getClaimInfo(ingredientManifest)}
                      {@const ingSig = getSignatureInfo(ingredientManifest)}
                      {@const ingAssertions = getAssertionsList(ingredientManifest)}
                      {@const ingIngredients = getIngredientsFromManifest(ingredientManifest)}
                      <div class="mt-3 pt-3 border-t border-gray-300 dark:border-gray-600 animate-fade-in">
                        <div class="flex items-center gap-2 mb-3">
                          <svg class="w-4 h-4 text-orange-600 dark:text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          <span class="text-xs font-bold text-orange-700 dark:text-orange-300 uppercase tracking-wide">Manifest Details</span>
                        </div>

                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {#if ingClaim?.claim_generator}
                            <div class="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-3">
                              <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-1">Claim Generator</div>
                              <p class="text-sm font-medium text-gray-900 dark:text-gray-100">{ingClaim.claim_generator}</p>
                            </div>
                          {/if}
                          {#if ingClaim?.claim_generator_info?.length > 0}
                            <div class="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-3">
                              <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-1">Claim Generator</div>
                              <p class="text-sm font-medium text-gray-900 dark:text-gray-100">
                                {ingClaim.claim_generator_info[0].name}
                                {#if ingClaim.claim_generator_info[0].version}
                                  <span class="text-orange-600 dark:text-orange-400">v{ingClaim.claim_generator_info[0].version}</span>
                                {/if}
                              </p>
                            </div>
                          {/if}
                          {#if ingSig?.common_name}
                            <div class="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-3">
                              <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-1">Signed By</div>
                              <p class="text-sm font-medium text-gray-900 dark:text-gray-100 break-all">{ingSig.common_name}</p>
                            </div>
                          {/if}
                          {#if ingSig?.time}
                            <div class="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-3">
                              <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-1">Signature Time</div>
                              <p class="text-sm font-medium text-gray-900 dark:text-gray-100">{ingSig.time}</p>
                            </div>
                          {/if}
                          {#if ingSig?.issuer}
                            <div class="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-3">
                              <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-1">Issuer</div>
                              <p class="text-sm font-medium text-gray-900 dark:text-gray-100 break-all">{ingSig.issuer}</p>
                            </div>
                          {/if}
                        </div>

                        {#if ingAssertions.length > 0}
                          <div class="mt-3 bg-orange-50 dark:bg-orange-900/20 rounded-lg p-3">
                            <div class="flex items-center justify-between mb-2">
                              <span class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide">Assertions</span>
                              <span class="px-2 py-1 bg-orange-200 dark:bg-orange-800 text-orange-800 dark:text-orange-200 rounded-full text-xs font-bold">{ingAssertions.length}</span>
                            </div>
                            <div class="space-y-1">
                              {#each ingAssertions.slice(0, 5) as assertion}
                                <div class="text-xs text-gray-700 dark:text-gray-300 font-mono">• {assertion.label || 'Unknown'}</div>
                              {/each}
                              {#if ingAssertions.length > 5}
                                <div class="text-xs text-gray-500 dark:text-gray-500 italic">+ {ingAssertions.length - 5} more...</div>
                              {/if}
                            </div>
                          </div>
                        {/if}

                        {#if ingIngredients.length > 0}
                          <div class="mt-3 bg-orange-50 dark:bg-orange-900/20 rounded-lg p-3">
                            <div class="flex items-center justify-between mb-2">
                              <span class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide">Nested Ingredients</span>
                              <span class="px-2 py-1 bg-orange-200 dark:bg-orange-800 text-orange-800 dark:text-orange-200 rounded-full text-xs font-bold">{ingIngredients.length}</span>
                            </div>
                            <div class="space-y-1">
                              {#each ingIngredients.slice(0, 3) as nestedIngredient}
                                <div class="text-xs text-gray-700 dark:text-gray-300">• {nestedIngredient.title || nestedIngredient.instance_id || 'Unknown'}</div>
                              {/each}
                              {#if ingIngredients.length > 3}
                                <div class="text-xs text-gray-500 dark:text-gray-500 italic">+ {ingIngredients.length - 3} more...</div>
                              {/if}
                            </div>
                          </div>
                        {/if}
                      </div>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          </section>
        {/if}

      {:else}
        <div class="bg-gray-50 dark:bg-gray-900 border-2 border-gray-300 dark:border-gray-700 rounded-2xl p-12 text-center">
          <div class="w-16 h-16 mx-auto bg-gray-300 dark:bg-gray-700 rounded-full flex items-center justify-center text-gray-600 dark:text-gray-400 text-3xl mb-4">
            ⚠
          </div>
          <p class="text-lg font-semibold text-gray-600 dark:text-gray-400">No active manifest found in this file.</p>
        </div>
      {/if}
    </div>
  {/if}

  <!-- Test Certificates Section -->
  <div class="mt-8 pt-8 border-t-2 border-gray-200 dark:border-gray-700" id="test-certificates">
    <h3 class="text-xl font-semibold text-gray-900 dark:text-white mb-4">Test Certificates</h3>
    <p class="text-gray-600 dark:text-gray-400 mb-6">
      Add or remove test certificates to revalidate this file. Changes will immediately regenerate the report with updated validation results.
    </p>
    <CertificateManager
      bind:testCertificates={testCertificates}
      bind:testModeEnabled={testModeEnabled}
      bind:testRootLoaded={testRootLoaded}
      on:certificatesUpdated={(e) => dispatch('certificatesUpdated', e.detail)}
      on:testModeChanged={(e) => dispatch('testModeChanged', e.detail)}
    />
  </div>
</div>
