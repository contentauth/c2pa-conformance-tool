<script lang="ts">
  import { createEventDispatcher, onDestroy } from 'svelte'
  import ManifestSummary from './ManifestSummary.svelte'
  import RubricsPanel from './RubricsPanel.svelte'
  import OverviewPanel from './OverviewPanel.svelte'
  import JsonViewer from './JsonViewer.svelte'
  import type { ConformanceReport, ValidationStatusItem, AssertionSummaryItem, CrJsonManifestEntry, ManifestValidationGroup } from './types'
  import type { ManifestSignalsResult } from './rubrics/types'
  import {
    getAssertionsList,
    getIngredientsFromManifest,
    getSignatureInfo,
    getClaimInfo,
    getActiveManifestValidationStatus,
    getAllValidationFailures,
    getManifestValidationStatus
  } from './crjson'
  import { evaluateReportSignals } from './summarySignals'
  import { VALIDATION_STATUS, VALIDATION_FAILURE_DESCRIPTIONS } from './constants'

  export let report: ConformanceReport
  export let usedTestCertificates = false
  export let file: File | null = null

  const dispatch = createEventDispatcher<{
    newfile: void
  }>()

  type ReportTab = 'summary' | 'report' | 'crjson' | 'rubrics'
  let activeTab: ReportTab = 'summary'

  const tabHeadings: Record<ReportTab, { title: string; subtitle: string }> = {
    summary:  { title: 'Overview',           subtitle: 'Content Credentials summary' },
    report:   { title: 'Conformance Report', subtitle: 'Manifest validation details' },
    crjson:   { title: 'crJSON Output',      subtitle: 'crJSON-formatted validation results' },
    rubrics:  { title: 'Asset Rubrics',      subtitle: 'Check crJSON against rubrics' },
  }
  $: heading = tabHeadings[activeTab]
  let copied = false
  let copyTimeout: ReturnType<typeof setTimeout> | null = null
  let mediaUrl: string | null = null
  let mediaType: 'image' | 'video' | 'audio' | 'document' | 'sidecar' | 'unknown' = 'unknown'

  // Only these image types can be rendered by browsers natively
  const BROWSER_PREVIEWABLE_IMAGES = new Set([
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
    'image/avif', 'image/svg+xml', 'image/bmp', 'image/ico', 'image/x-icon',
  ])
  let fileInput: HTMLInputElement
  let expandedIngredients: Set<number> = new Set()
  let expandedAssertions: Set<number> = new Set()
  let showBackToTop = false

  // Track scroll position for back to top button
  function handleScroll() {
    showBackToTop = window.scrollY > 400
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

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Create object URL for media preview
  $: if (file) {
    if (mediaUrl) {
      URL.revokeObjectURL(mediaUrl)
    }
    mediaUrl = URL.createObjectURL(file)

    // Determine media type. Sidecar detection is first since `.c2pa` files
    // typically arrive with an empty or `application/octet-stream` MIME, so
    // the name check is doing most of the work.
    const lowerName = file.name.toLowerCase()
    if (file.type === 'application/c2pa' || lowerName.endsWith('.c2pa')) {
      mediaType = 'sidecar'
    } else if (file.type.startsWith('image/')) {
      mediaType = BROWSER_PREVIEWABLE_IMAGES.has(file.type) ? 'image' : 'unknown'
    } else if (file.type.startsWith('video/')) {
      mediaType = 'video'
    } else if (file.type.startsWith('audio/')) {
      mediaType = 'audio'
    } else if (file.type === 'application/pdf' || lowerName.endsWith('.pdf')) {
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
  $: assertionsList = activeManifest ? getAssertionsList(activeManifest).filter(a => !a.label.includes('hash.data')) : []
  $: ingredientsList = activeManifest ? getIngredientsFromManifest(activeManifest) : []
  $: signatureInfo = activeManifest ? getSignatureInfo(activeManifest) : undefined
  $: claimInfo = activeManifest ? getClaimInfo(activeManifest) : undefined

  // Per-manifest signal hits powering the rubric-driven sentence in the
  // summary card. Re-evaluated whenever `report` changes; null while the
  // async load is in flight or if the rubric couldn't be loaded.
  let activeManifestSignals: ManifestSignalsResult | null = null
  $: {
    activeManifestSignals = null
    if (report) {
      const reportSnapshot = report
      evaluateReportSignals(reportSnapshot).then((result) => {
        // Guard against a stale resolution clobbering a newer report's value.
        if (report === reportSnapshot) {
          activeManifestSignals = result?.manifests[0] ?? null
        }
      })
    }
  }

  // Get validation results from crJSON (document-level or per-manifest from c2pa-rs)
  $: validationResults = getActiveManifestValidationStatus(report)

  // Get all validation failures from the report (including active and ingredients)
  $: failures = report ? getAllValidationFailures(report) : []

  // Check if trusted from crJSON validationResults (must have trusted code AND no failures)
  $: isTrusted = (validationResults?.success?.some((status) =>
    status.code === VALIDATION_STATUS.SIGNING_CREDENTIAL_TRUSTED
  ) ?? false) && failures.length === 0

  function getFailureDescription(code: string, explanation?: string): string {
    return VALIDATION_FAILURE_DESCRIPTIONS[code] ?? explanation ?? `Validation failed (Code: ${code})`
  }

  // Gate for the Rubrics tab: trusted signature is enough.
  //
  // We deliberately do NOT require an empty failure array. The rubrics
  // Check if signature is using Interim Trust List
  $: usedITL = report.usedITL === true

  // Check if test certificates were actually needed for validation
  // This is determined by validating twice in processFile - once with official TL, once with test certs
  $: actuallyUsedTestCert = report.usedTestCerts === true

  // Build validation status array - show all failures first (active & ingredients), then key successes
  // Build validation status grouped by manifest
  $: validationGroups = (() => {
    if (!report || !report.manifests) return []

    return report.manifests.map((m, i) => {
      const isActive = i === 0
      const sigInfo = getSignatureInfo(m)
      const status = getManifestValidationStatus(report, m, isActive)

      const success: ValidationStatusItem[] = status?.success?.filter((s) =>
        s.code === VALIDATION_STATUS.SIGNING_CREDENTIAL_TRUSTED ||
        s.code === VALIDATION_STATUS.TIMESTAMP_TRUSTED ||
        s.code === VALIDATION_STATUS.CLAIM_SIGNATURE_VALIDATED ||
        s.code === 'timeStamp.validated'
      ).map((s) => {
        const isInterim = s.code === VALIDATION_STATUS.SIGNING_CREDENTIAL_TRUSTED && usedITL
        return {
          code: s.code,
          success: true,
          isInterim,
          explanation: s.explanation ?? 'Validation passed'
        }
      }) ?? []

      const failure: ValidationStatusItem[] = status?.failure?.map((f) => ({
        code: f.code,
        success: false,
        isInterim: false,
        explanation: getFailureDescription(f.code, f.explanation)
      })) ?? []

      const informational: ValidationStatusItem[] = status?.informational?.map((inf) => ({
        code: inf.code,
        success: true,
        isInformational: true,
        explanation: inf.explanation ?? 'Informational'
      })) ?? []

      return {
        label: m.label,
        isActive,
        index: i,
        sigInfo,
        success,
        failure,
        informational
      }
    }).filter(group => group.success.length > 0 || group.failure.length > 0 || group.informational.length > 0)
  })()

  // Certificate validity status derived from validation results
  $: certValidityStatus = (() => {
    if (!validationResults) return 'unknown' as const
    const failure = validationResults.failure ?? []
    const success = validationResults.success ?? []
    const info = validationResults.informational ?? []
    if (failure.some((s) => s.code === VALIDATION_STATUS.SIGNING_CREDENTIAL_EXPIRED))
      return 'expired' as const
    const validCodes = [VALIDATION_STATUS.CLAIM_SIGNATURE_INSIDE_VALIDITY, VALIDATION_STATUS.TIME_OF_SIGNING_INSIDE_VALIDITY]
    if ([...success, ...info].some((s) => validCodes.includes(s.code as typeof validCodes[number])))
      return 'valid' as const
    return 'unknown' as const
  })()

  // OCSP revocation status derived from validation results
  $: ocspStatus = (() => {
    if (!validationResults) return 'unknown' as const
    const failure = validationResults.failure ?? []
    const success = validationResults.success ?? []
    const info = validationResults.informational ?? []
    if (failure.some((s) => s.code === VALIDATION_STATUS.SIGNING_CREDENTIAL_OCSP_REVOKED))
      return 'revoked' as const
    if (success.some((s) => s.code === VALIDATION_STATUS.SIGNING_CREDENTIAL_OCSP_NOT_REVOKED))
      return 'not_revoked' as const
    if (info.some((s) => s.code === VALIDATION_STATUS.SIGNING_CREDENTIAL_OCSP_INACCESSIBLE))
      return 'inaccessible' as const
    if (info.some((s) => s.code === VALIDATION_STATUS.SIGNING_CREDENTIAL_OCSP_SKIPPED))
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

  <div class="text-left mt-8 animate-fade-in flex-1 flex flex-col min-h-0 {activeTab !== 'summary' ? 'mb-8' : ''}">
  <!-- Prominent Validation Status Banner -->
  <div class="mb-8 bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-2xl p-6 shadow-sm">
    <div class="flex items-center gap-4">
      <div class={`flex-shrink-0 w-16 h-16 rounded-full flex items-center justify-center ${isTrusted ? 'bg-green-100 dark:bg-green-900/30' : 'bg-red-100 dark:bg-red-900/30'}`}>
        {#if isTrusted}
          <svg class="w-10 h-10 text-green-600 dark:text-green-300" viewBox="0 0 24 24" fill="currentColor"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M11.998 2l.118 .007l.059 .008l.061 .013l.111 .034a.993 .993 0 0 1 .217 .112l.104 .082l.255 .218a11 11 0 0 0 7.189 2.537l.342 -.01a1 1 0 0 1 1.005 .717a13 13 0 0 1 -9.208 16.25a1 1 0 0 1 -.502 0a13 13 0 0 1 -9.209 -16.25a1 1 0 0 1 1.005 -.717a11 11 0 0 0 7.531 -2.527l.263 -.225l.096 -.075a.993 .993 0 0 1 .217 -.112l.112 -.034a.97 .97 0 0 1 .119 -.021l.115 -.007zm3.71 7.293a1 1 0 0 0 -1.415 0l-3.293 3.292l-1.293 -1.292l-.094 -.083a1 1 0 0 0 -1.32 1.497l2 2l.094 .083a1 1 0 0 0 1.32 -.083l4 -4l.083 -.094a1 1 0 0 0 -.083 -1.32z" /></svg>
        {:else}
          <svg class="w-10 h-10 text-red-600 dark:text-red-300" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
          </svg>
        {/if}
      </div>
      <div class="flex-1">
        <h3 class="text-xl font-semibold {isTrusted ? 'text-green-900 dark:text-green-300' : 'text-red-900 dark:text-red-300'} mb-1">
          {#if isTrusted}
            {#if usedITL}
              Signature Trusted via ITL
            {:else if actuallyUsedTestCert}
              Signature Trusted via Test Certificate
            {:else}
              Signature Trusted
            {/if}
          {:else}
            {#if failures.length > 0}
              Validation Failed ✕
            {:else}
              Signature Not Trusted
            {/if}
          {/if}
        </h3>
        <div class="text-sm {isTrusted ? 'text-green-700 dark:text-gray-300' : 'text-red-700 dark:text-gray-300'}">
          {#if usedITL && isTrusted}
            Validated using Interim Trust List 
            <a
              href="https://c2pa.org/conformance/"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1 ml-2 text-xs underline hover:no-underline"
              title="The Interim Trust List (ITL) contains certificates that are in the process of C2PA certification"
            >
              <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd" />
              </svg>
              What is the ITL?
            </a>
          {:else if actuallyUsedTestCert && isTrusted}
            Validated using custom test certificates - not validated against official C2PA trust lists
          {:else if isTrusted}
            Validated against official C2PA Trust List
          {:else}
            {#if failures.length > 0}
              <span class="font-semibold">Validation failed with the following errors:</span>
              <div class="mt-2 space-y-1 text-xs font-mono bg-red-50/50 dark:bg-gray-900/50 p-4 rounded-lg border border-red-100 dark:border-gray-700 w-full">
                {#each failures as failure}
                  <div class="flex items-start gap-2">
                    <span class="text-red-500 mt-1">✕</span>
                    <div class="flex-1 text-left">
                      <span class="font-bold">{failure.code}:</span>
                      <span class="text-gray-700 dark:text-gray-300">{getFailureDescription(failure.code, failure.explanation)}</span>
                    </div>
                  </div>
                {/each}
              </div>
            {:else}
              The signing credential could not be validated against known trust lists
            {/if}
          {/if}
        </div>
        {#if usedITL && isTrusted}
          <div class="mt-2 flex items-center gap-2 flex-wrap">
            <span class="inline-flex items-center gap-2 px-4 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 rounded-full text-xs font-semibold">
              <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd" />
              </svg>
              ITL Validated
            </span>
          </div>
        {:else if actuallyUsedTestCert && isTrusted}
          <div class="mt-2">
            <span class="inline-flex items-center gap-2 px-4 py-1 bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 rounded-full text-xs font-semibold">
              <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
              </svg>
              Test Mode
            </span>
          </div>
        {/if}
      </div>
    </div>
  </div>

  <div class="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-6 gap-4">
    <div>
      <h2 class="text-xl font-semibold text-[#1e293b] dark:text-white">{heading.title}</h2>
      <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">{heading.subtitle}</p>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <button
        class="btn-outline-gray {activeTab === 'summary' ? 'is-selected' : ''}"
        on:click={() => activeTab = 'summary'}
      >
        Summary
      </button>
      <button
        class="btn-outline-gray {activeTab === 'report' ? 'is-selected' : ''}"
        on:click={() => activeTab = 'report'}
      >
        Report
      </button>
      <button
        class="btn-outline-gray {activeTab === 'crjson' ? 'is-selected' : ''}"
        on:click={() => activeTab = 'crjson'}
      >
        crJSON
      </button>
      <button
        class="btn-outline-gray {activeTab === 'rubrics' ? 'is-selected' : ''}"
        on:click={() => activeTab = 'rubrics'}
        title="Evaluate this manifest against selectable rubrics"
      >
        Rubrics
      </button>
      <button
        class="btn btn-primary"
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
    <div class="mb-8 bg-amber-50 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 rounded-2xl p-6 shadow-sm">
      <div class="flex items-start gap-4">
        <div class="flex-shrink-0 w-12 h-12 bg-amber-600 dark:bg-amber-700 rounded-full flex items-center justify-center text-white text-2xl shadow-sm">
          ⚠
        </div>
        <div class="flex-1">
          <h3 class="font-bold text-amber-900 dark:text-amber-300 text-lg mb-2">Test Certificate Mode Active</h3>
          <p class="text-sm text-amber-800 dark:text-amber-300 leading-relaxed">
            This validation used custom test certificates. Results may differ from production validation using only the official C2PA trust list.
          </p>
        </div>
      </div>
    </div>
  {/if}

  <!-- Section Navigation — only relevant on the Formatted tab (anchors live there) -->
  {#if activeManifest && activeTab === 'report'}
    <div class="mb-6 flex items-center gap-1 flex-wrap">
      <span class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mr-2">Jump to:</span>
      <a href="#media-preview" class="text-sm px-2 py-1 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-200 transition-colors">Media</a>
      <span class="text-gray-300 dark:text-gray-600 select-none">·</span>
      <a href="#validation-status" class="text-sm px-2 py-1 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-200 transition-colors">Validation</a>
      <span class="text-gray-300 dark:text-gray-600 select-none">·</span>
      <a href="#signature-info" class="text-sm px-2 py-1 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-200 transition-colors">Signature</a>
      <span class="text-gray-300 dark:text-gray-600 select-none">·</span>
      <a href="#manifest-details" class="text-sm px-2 py-1 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-200 transition-colors">Manifest</a>
      {#if assertionsList.length > 0}
        <span class="text-gray-300 dark:text-gray-600 select-none">·</span>
        <a href="#assertions" class="text-sm px-2 py-1 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-200 transition-colors">Assertions ({assertionsList.length})</a>
      {/if}
    </div>
  {/if}

  <!-- Back to Top Button -->
  {#if showBackToTop}
    <button
      on:click={scrollToTop}
      class="fixed bottom-8 right-8 z-50 p-4 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg transition-all duration-200 hover:scale-110 animate-fade-in"
      aria-label="Back to top"
      title="Back to top"
    >
      <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M12 5v6m0 3v1.5m0 3v.5" /><path d="M16 9l-4 -4" /><path d="M8 9l4 -4" /></svg>
    </button>
  {/if}

  {#if activeTab === 'summary'}
    <div class="bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm overflow-hidden flex-1 flex flex-col min-h-0 mb-6">
      <OverviewPanel {report} {file} />
    </div>
  {:else if activeTab === 'crjson'}
    <div class="bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-2xl p-8 shadow-sm">
      <div class="flex items-center justify-between gap-4 mb-6">
        <div class="flex items-center gap-4">
          <div class="w-10 h-10 bg-gray-800 dark:bg-gray-700 rounded-lg flex items-center justify-center text-white shadow-sm">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
          </div>
          <h3 class="text-xl font-semibold text-[#1e293b] dark:text-white">crJSON Report</h3>
        </div>
        <div class="flex items-center gap-2">
          <button
            class="btn-outline-gray"
            on:click={downloadReport}
            title="Download report as JSON"
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2" /><path d="M7 11l5 5l5 -5" /><path d="M12 4l0 12" /></svg>
            Download
          </button>
          <button
            class="inline-flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-lg border-2 transition-colors {copied ? 'border-green-500 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}"
            on:click={copyToClipboard}
            title="Copy JSON to clipboard"
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M7 9.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667l0 -8.666" /><path d="M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1" /></svg>
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>
      <pre class="hljs bg-gray-900 dark:bg-black border-2 border-gray-700 dark:border-gray-600 rounded-2xl p-6 overflow-x-auto text-sm leading-relaxed shadow-inner"><code class="language-json"><JsonViewer value={report} /></code></pre>
    </div>
  {:else if activeTab === 'rubrics'}
    <div class="w-full">
      <RubricsPanel {report} />
    </div>
  {:else}
    <!-- Media Preview and Validation Status -->
    <div class="mb-8" id="media-preview">
      <div class="bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-2xl p-8 shadow-sm">
        <div class="flex items-center gap-4 mb-6">
          <div class="w-10 h-10 bg-gray-800 dark:bg-gray-700 rounded-lg flex items-center justify-center text-white shadow-sm">
            {#if mediaType === 'sidecar'}
              <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z" /><path d="M9 17h6" /><path d="M9 13h6" /></svg>
            {:else}
              <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M15 8h.01" /><path d="M3 6a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v12a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3v-12" /><path d="M3 16l5 -5c.928 -.893 2.072 -.893 3 0l5 5" /><path d="M14 14l1 -1c.928 -.893 2.072 -.893 3 0l3 3" /></svg>
            {/if}
          </div>
          <h3 class="text-xl font-semibold text-[#1e293b] dark:text-white">
            {mediaType === 'sidecar' ? 'Sidecar File' : 'Media Preview'}
          </h3>
        </div>

        {#if file && mediaUrl}
          <div class="flex flex-col gap-6">
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div class="bg-gray-50 dark:bg-gray-900 rounded-2xl p-4">
                <div class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Filename</div>
                <p class="text-sm font-medium text-[#1e293b] dark:text-gray-100 truncate" title={file.name}>{file.name}</p>
              </div>
              <div class="bg-gray-50 dark:bg-gray-900 rounded-2xl p-4">
                <div class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Type</div>
                <p class="text-sm font-medium text-[#1e293b] dark:text-gray-100">
                  {mediaType === 'sidecar' ? 'application/c2pa (sidecar)' : (file.type || 'Unknown')}
                </p>
              </div>
              <div class="bg-gray-50 dark:bg-gray-900 rounded-2xl p-4">
                <div class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Size</div>
                <p class="text-sm font-medium text-[#1e293b] dark:text-gray-100">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
              </div>
            </div>

            <div class="bg-gray-50 dark:bg-gray-900 rounded-2xl p-6 flex items-center justify-center min-h-[350px] border-2 border-gray-200 dark:border-gray-600">
              {#if mediaType === 'image'}
                <img src={mediaUrl} alt="Preview" class="max-w-full max-h-[600px] object-contain rounded-2xl shadow-lg" />
              {:else if mediaType === 'video'}
                <video src={mediaUrl} controls class="max-w-full max-h-[600px] rounded-2xl shadow-lg">
                  <track kind="captions" />
                  Your browser does not support video playback.
                </video>
              {:else if mediaType === 'audio'}
                <div class="w-full max-w-md">
                  <div class="w-20 h-20 mx-auto bg-gradient-to-br from-blue-500 to-blue-500 dark:from-blue-700 dark:to-blue-700 rounded-2xl flex items-center justify-center text-white mb-6 shadow-lg">
                    <svg class="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                      <path d="M3 17a3 3 0 1 0 6 0a3 3 0 0 0-6 0"/><path d="M6 17v-13l12-2v13"/><path d="M15 15a3 3 0 1 0 6 0a3 3 0 0 0-6 0"/>
                    </svg>
                  </div>
                  <audio src={mediaUrl} controls class="w-full">
                    Your browser does not support audio playback.
                  </audio>
                </div>
              {:else if mediaType === 'document'}
                <div class="text-center">
                  <div class="w-20 h-20 mx-auto bg-gradient-to-br from-blue-500 to-blue-600 dark:from-blue-700 dark:to-blue-800 rounded-2xl flex items-center justify-center text-white mb-6 shadow-lg">
                    <svg class="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                      <path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z"/><path d="M9 17h6"/><path d="M9 13h6"/>
                    </svg>
                  </div>
                  <p class="text-gray-600 dark:text-gray-400 mb-4 text-lg font-medium">PDF Document</p>
                  <a href={mediaUrl} download={file.name} class="btn btn-primary">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download PDF
                  </a>
                </div>
              {:else if mediaType === 'sidecar'}
                <div class="text-center max-w-md">
                  <div class="w-20 h-20 mx-auto bg-gradient-to-br from-blue-500 to-blue-600 dark:from-gray-600 dark:to-gray-700 rounded-2xl flex items-center justify-center text-white mb-6 shadow-lg">
                    <svg class="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z" /><path d="M9 17h6" /><path d="M9 13h6" /></svg>
                  </div>
                  <p class="text-[#1e293b] dark:text-gray-100 mb-2 text-lg font-semibold">Standalone manifest sidecar</p>
                  <p class="text-sm text-gray-600 dark:text-gray-400 leading-relaxed mb-4">
                    This is a <code class="font-mono text-xs bg-gray-200 dark:bg-gray-700 px-2 py-1 rounded">.c2pa</code> file &mdash; a
                    C2PA manifest store detached from its referenced asset. No embedded media to preview; the manifest&rsquo;s
                    contents are shown below.
                  </p>
                  <a href={mediaUrl} download={file.name} class="btn btn-primary">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Download .c2pa
                  </a>
                </div>
              {:else}
                <div class="text-center">
                  <div class="w-20 h-20 mx-auto bg-gradient-to-br from-gray-400 to-gray-500 dark:from-gray-600 dark:to-gray-700 rounded-2xl flex items-center justify-center text-white mb-6 shadow-lg">
                    {#if file.type.startsWith('image/') || /\.(heic|heif|tiff?|avci|avcs)$/i.test(file.name)}
                      <svg class="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                        <path d="M15 8h.01"/><path d="M3 6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6z"/><path d="M3 16l5-5c.928-.893 2.072-.893 3 0l5 5"/><path d="M14 14l1-1c.928-.893 2.072-.893 3 0l3 3"/>
                      </svg>
                    {:else}
                      <svg class="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                        <path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z"/>
                      </svg>
                    {/if}
                  </div>
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
            signals={activeManifestSignals}
            {usedITL}
            {isTrusted}
          />
        {:else}
          <div class="text-center py-12 text-gray-500 dark:text-gray-400">
            <div class="text-5xl mb-4">📁</div>
            <p>No media file available</p>
          </div>
        {/if}

      </div>
    </div>

    <div class="space-y-8">
      {#if activeManifest}
        <!-- Validation Status Details Section -->
        <section class="bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-2xl p-8 shadow-sm" id="validation-status">
          <div class="flex items-center gap-4 mb-6">
            <div class="w-10 h-10 bg-gray-800 dark:bg-gray-700 rounded-lg flex items-center justify-center text-white shadow-sm">
              <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M11.46 20.846a12 12 0 0 1 -7.96 -14.846a12 12 0 0 0 8.5 -3a12 12 0 0 0 8.5 3a12 12 0 0 1 -.09 7.06" /><path d="M15 19l2 2l4 -4" /></svg>
            </div>
            <h3 class="text-xl font-semibold text-[#1e293b] dark:text-white">Validation Status Details</h3>
          </div>
          {#if validationGroups && validationGroups.length > 0}
            <div class="space-y-6">
              {#each validationGroups as group}
                <div class="manifest-group-card border border-gray-200 dark:border-gray-700 rounded-2xl p-6 bg-gray-50/30 dark:bg-gray-900/10 shadow-sm">
                  <h4 class="font-bold text-[#1e293b] dark:text-white mb-4 flex items-center gap-2 flex-wrap">
                    {#if group.isActive}
                      <span class="badge bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-300">Active Asset</span>
                    {:else}
                      <span class="badge bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-300">Ingredient {group.index}</span>
                    {/if}
                    <span class="text-xs font-mono text-gray-500 dark:text-gray-500 truncate max-w-xs md:max-w-md" title={group.label}>{group.label}</span>
                    {#if group.sigInfo?.common_name}
                      <span class="text-xs font-medium text-gray-500 dark:text-gray-400 ml-auto">
                        signed by <span class="font-semibold text-gray-700 dark:text-gray-300">{group.sigInfo.common_name}</span>
                      </span>
                    {/if}
                  </h4>

                  <div class="space-y-4">
                    <!-- Failures -->
                    {#each group.failure as status}
                      <div class="rounded-2xl p-4 border bg-red-50/50 dark:bg-gray-900/30 border-red-100 dark:border-red-900/30 text-red-800 dark:text-red-300">
                         <div class="flex items-start gap-4">
                           <span class="flex-shrink-0 w-5 h-5 rounded-full bg-red-600 dark:bg-red-800 text-white flex items-center justify-center text-xs font-bold">✕</span>
                           <div class="flex-1 text-left">
                             <span class="font-bold text-xs font-mono block sm:inline mb-1 sm:mb-0 mr-2">{status.code}</span>
                             <p class="text-sm leading-relaxed mt-1 text-red-700 dark:text-red-400">{status.explanation}</p>
                           </div>
                         </div>
                      </div>
                    {/each}

                    <!-- Successes -->
                    {#each group.success as status}
                      <div class="rounded-2xl p-4 border bg-green-50/50 dark:bg-gray-900/30 border-green-100 dark:border-green-900/30 text-green-800 dark:text-green-300">
                         <div class="flex items-start gap-4">
                           <span class="flex-shrink-0 w-5 h-5 rounded-full bg-green-700 dark:bg-green-800 text-white flex items-center justify-center text-xs font-bold">✓</span>
                           <div class="flex-1 text-left">
                             <span class="font-bold text-xs font-mono block sm:inline mb-1 sm:mb-0 mr-2">{status.code}</span>
                             {#if status.isInterim}
                               <span class="ml-2 badge bg-blue-100 dark:bg-gray-700 text-blue-900 dark:text-gray-100">ITL</span>
                             {/if}
                             <p class="text-sm leading-relaxed mt-1 text-green-700 dark:text-green-400">{status.explanation}</p>
                           </div>
                         </div>
                      </div>
                    {/each}

                    <!-- Informationals -->
                    {#each group.informational as status}
                      <div class="rounded-2xl p-4 border bg-blue-100 dark:bg-gray-900/30 border-blue-100 dark:border-blue-900/30 text-blue-800 dark:text-blue-300">
                         <div class="flex items-start gap-4">
                           <span class="flex-shrink-0 w-5 h-5 rounded-full bg-blue-600 dark:bg-blue-800 text-white flex items-center justify-center text-xs font-bold">i</span>
                           <div class="flex-1 text-left">
                             <span class="font-bold text-xs font-mono block sm:inline mb-1 sm:mb-0 mr-2">{status.code}</span>
                             <p class="text-sm leading-relaxed mt-1 text-blue-700 dark:text-blue-400">{status.explanation}</p>
                           </div>
                         </div>
                      </div>
                    {/each}
                  </div>
                </div>
              {/each}
            </div>
          {:else}
            <div class="bg-gray-50 dark:bg-gray-900 border-2 border-gray-200 dark:border-gray-700 rounded-2xl p-6 text-center">
              <p class="text-gray-600 dark:text-gray-400">No validation status available</p>
            </div>
          {/if}
        </section>

        {#if signatureInfo}
          <section class="bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-2xl p-8 shadow-sm" id="signature-info">
            <div class="flex items-center gap-4 mb-6">
              <div class="w-10 h-10 bg-gray-800 dark:bg-gray-700 rounded-lg flex items-center justify-center text-white shadow-sm">
                <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M5 7.2a2.2 2.2 0 0 1 2.2 -2.2h1a2.2 2.2 0 0 0 1.55 -.64l.7 -.7a2.2 2.2 0 0 1 3.12 0l.7 .7c.412 .41 .97 .64 1.55 .64h1a2.2 2.2 0 0 1 2.2 2.2v1c0 .58 .23 1.138 .64 1.55l.7 .7a2.2 2.2 0 0 1 0 3.12l-.7 .7a2.2 2.2 0 0 0 -.64 1.55v1a2.2 2.2 0 0 1 -2.2 2.2h-1a2.2 2.2 0 0 0 -1.55 .64l-.7 .7a2.2 2.2 0 0 1 -3.12 0l-.7 -.7a2.2 2.2 0 0 0 -1.55 -.64h-1a2.2 2.2 0 0 1 -2.2 -2.2v-1a2.2 2.2 0 0 0 -.64 -1.55l-.7 -.7a2.2 2.2 0 0 1 0 -3.12l.7 -.7a2.2 2.2 0 0 0 .64 -1.55v-1" /><path d="M9 12l2 2l4 -4" /></svg>
              </div>
              <h3 class="text-xl font-semibold text-[#1e293b] dark:text-white">Signature Information</h3>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
              {#if signatureInfo.common_name}
                <div class="bg-gray-50 dark:bg-gray-900 rounded-2xl p-4">
                  <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-2">Common Name</div>
                  <p class="text-sm font-medium text-[#1e293b] dark:text-gray-100 break-all">{signatureInfo.common_name}</p>
                </div>
              {/if}
              {#if signatureInfo.issuer}
                <div class="bg-gray-50 dark:bg-gray-900 rounded-2xl p-4">
                  <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-2">Issuer</div>
                  <p class="text-sm font-medium text-[#1e293b] dark:text-gray-100 break-all">{signatureInfo.issuer}</p>
                </div>
              {/if}
              {#if signatureInfo.time}
                <div class="bg-gray-50 dark:bg-gray-900 rounded-2xl p-4">
                  <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-2">Signed</div>
                  <p class="text-sm font-medium text-[#1e293b] dark:text-gray-100">{signatureInfo.time}</p>
                </div>
              {/if}
              <!-- Certificate Validity -->
              {#if certValidityStatus !== 'unknown'}
                <div class="bg-gray-50 dark:bg-gray-900 rounded-2xl p-4">
                  <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-2">Certificate Validity</div>
                  {#if certValidityStatus === 'valid'}
                    <div class="flex items-center gap-2">
                      <svg class="w-4 h-4 text-green-600 dark:text-green-300 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M17 3.34a10 10 0 1 1 -14.995 8.984l-.005 -.324l.005 -.324a10 10 0 0 1 14.995 -8.336zm-1.293 5.953a1 1 0 0 0 -1.32 -.083l-.094 .083l-3.293 3.292l-1.293 -1.292l-.094 -.083a1 1 0 0 0 -1.403 1.403l.083 .094l2 2l.094 .083a1 1 0 0 0 1.226 0l.094 -.083l4 -4l.083 -.094a1 1 0 0 0 -.083 -1.32z" /></svg>
                      <span class="text-sm font-medium text-green-700 dark:text-green-300">Valid at time of signing</span>
                    </div>
                  {:else if certValidityStatus === 'expired'}
                    <div class="flex items-center gap-2">
                      <svg class="w-4 h-4 text-red-600 dark:text-red-300 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/></svg>
                      <span class="text-sm font-medium text-red-700 dark:text-red-300">Expired at time of signing</span>
                    </div>
                  {/if}
                </div>
              {/if}

              <!-- OCSP Revocation Status -->
              {#if ocspStatus !== 'unknown'}
                <div class="bg-gray-50 dark:bg-gray-900 rounded-2xl p-4">
                  <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-2">OCSP Revocation</div>
                  {#if ocspStatus === 'not_revoked'}
                    <div class="flex items-center gap-2">
                      <svg class="w-4 h-4 text-green-600 dark:text-green-300 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M17 3.34a10 10 0 1 1 -14.995 8.984l-.005 -.324l.005 -.324a10 10 0 0 1 14.995 -8.336zm-1.293 5.953a1 1 0 0 0 -1.32 -.083l-.094 .083l-3.293 3.292l-1.293 -1.292l-.094 -.083a1 1 0 0 0 -1.403 1.403l.083 .094l2 2l.094 .083a1 1 0 0 0 1.226 0l.094 -.083l4 -4l.083 -.094a1 1 0 0 0 -.083 -1.32z" /></svg>
                      <span class="text-sm font-medium text-green-700 dark:text-green-300">Not revoked</span>
                    </div>
                  {:else if ocspStatus === 'revoked'}
                    <div class="flex items-center gap-2">
                      <svg class="w-4 h-4 text-red-600 dark:text-red-300 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/></svg>
                      <span class="text-sm font-medium text-red-700 dark:text-red-300">Revoked</span>
                    </div>
                  {:else if ocspStatus === 'no_staple'}
                    <div class="flex items-center gap-2">
                      <svg class="w-4 h-4 text-amber-500 dark:text-amber-300 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
                      <span class="text-sm font-medium text-amber-700 dark:text-amber-300">No OCSP staple present</span>
                    </div>
                  {:else if ocspStatus === 'inaccessible'}
                    <div class="flex items-center gap-2">
                      <svg class="w-4 h-4 text-amber-500 dark:text-amber-300 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
                      <span class="text-sm font-medium text-amber-700 dark:text-amber-300">OCSP server inaccessible</span>
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          </section>
        {/if}

        <section class="bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-2xl p-8 shadow-sm" id="manifest-details">
          <div class="flex items-center gap-4 mb-6">
            <div class="w-10 h-10 bg-gray-800 dark:bg-gray-700 rounded-lg flex items-center justify-center text-white shadow-sm">
              <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2" /><path d="M9 9l1 0" /><path d="M9 13l6 0" /><path d="M9 17l6 0" /></svg>
            </div>
            <h3 class="text-xl font-semibold text-[#1e293b] dark:text-white">Active Manifest</h3>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div class="bg-gray-50 dark:bg-gray-900 rounded-2xl p-4">
              <div class="text-xs font-semibold text-gray-500 dark:text-gray-500 uppercase tracking-wide mb-2">Claim Generator</div>
              <p class="text-sm font-medium text-[#1e293b] dark:text-gray-100">
                {#if claimInfo?.claim_generator_info?.[0]?.name}
                  {claimInfo.claim_generator_info[0].name}
                  {#if claimInfo.claim_generator_info[0].version}
                    <span class="text-blue-600 dark:text-blue-300">v{claimInfo.claim_generator_info[0].version}</span>
                  {/if}
                {:else if claimInfo?.claim_generator}
                  {claimInfo.claim_generator}
                {:else}
                  N/A
                {/if}
              </p>
            </div>
          </div>
        </section>

        {#if assertionsList.length > 0}
          <section class="bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-2xl p-8 shadow-sm" id="assertions">
            <div class="flex items-center gap-4 mb-6">
              <div class="w-10 h-10 bg-gray-800 dark:bg-gray-700 rounded-lg flex items-center justify-center text-white shadow-sm">
                <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M9 5h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2h-2" /><path d="M9 5a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2" /><path d="M9 14l2 2l4 -4" /></svg>
              </div>
              <div class="flex-1">
                <h3 class="text-xl font-semibold text-[#1e293b] dark:text-white">Assertions ({assertionsList.length})</h3>
              </div>
              <div class="flex items-center gap-2">
                <button
                  on:click={expandAllAssertions}
                  class="btn-outline-gray"
                  title="Expand all assertions"
                >
                  Expand All
                </button>
                <button
                  on:click={collapseAllAssertions}
                  class="btn-outline-gray"
                  title="Collapse all assertions"
                >
                  Collapse All
                </button>
              </div>
            </div>
            <div class="space-y-6">
              {#each assertionsList as assertion, index}
                {@const isExpanded = expandedAssertions.has(index)}
                {@const summary = assertion.data ? extractAssertionSummary(assertion.data) : []}
                <div class="bg-gray-50 dark:bg-gray-900 rounded-2xl p-6 border border-gray-200 dark:border-gray-700">
                  <div class="flex items-start gap-4 mb-4">
                    <div class="flex-shrink-0 w-8 h-8 bg-blue-100 dark:bg-gray-800 rounded-lg flex items-center justify-center text-blue-700 dark:text-gray-300 font-bold text-sm">
                      {index + 1}
                    </div>
                    <div class="flex-1">
                      <p class="font-bold text-[#1e293b] dark:text-gray-100 text-lg">{assertion.label || 'Unknown'}</p>
                      {#if assertion.data}
                        <button
                          on:click={() => toggleAssertion(index)}
                          class="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-gray-400 hover:text-blue-700 dark:hover:text-gray-300 transition-colors"
                        >
                          <svg class="w-4 h-4 transition-transform {isExpanded ? 'rotate-90' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
                          {#each summary as item}
                            <div class="bg-white dark:bg-gray-800 rounded-lg p-4 {item.key === 'ocspVals' ? 'sm:col-span-2' : ''}">
                              {#if item.isAction}
                                <!-- Special display for actions -->
                                <div class="space-y-2">
                                  <div>
                                    <div class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
                                      {item.key}
                                    </div>
                                    <div class="text-sm font-medium text-[#1e293b] dark:text-gray-100">
                                      {item.actionName}
                                    </div>
                                  </div>

                                  {#if item.digitalSourceType}
                                    <div>
                                      <div class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
                                        Digital Source Type
                                      </div>
                                      <a
                                        href={item.digitalSourceType}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        class="text-sm font-medium text-blue-600 dark:text-gray-400 hover:text-blue-700 dark:hover:text-gray-300 underline"
                                      >
                                        {getAbbreviatedSourceType(item.digitalSourceType)}
                                      </a>
                                    </div>
                                  {/if}

                                  {#if item.description}
                                    <div>
                                      <div class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
                                        Description
                                      </div>
                                      <div class="text-sm font-medium text-[#1e293b] dark:text-gray-100 break-words">
                                        {item.description}
                                      </div>
                                    </div>
                                  {/if}
                                </div>
                              {:else}
                                <!-- Standard display for other fields -->
                                <div class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
                                  {item.key}
                                </div>
                                <div class="text-sm font-medium text-[#1e293b] dark:text-gray-100 break-words">
                                  {formatValue(item.value)}
                                </div>
                              {/if}
                            </div>
                          {/each}
                        </div>
                      {/if}

                      {#if isExpanded}
                        <div class="mt-4 animate-fade-in">
                          <div class="flex items-center gap-2 mb-2">
                            <svg class="w-4 h-4 text-blue-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                            </svg>
                            <span class="text-xs font-bold text-blue-700 dark:text-gray-300 uppercase tracking-wide">Complete Data</span>
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

</div>
