<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import type { ConformanceReport, ParsedCertificateItem, ManifestCertificateGroup, OcspResponseData } from './types'
  import {
    checkCertificateOcsp,
    checkAllCertificatesOcsp,
    computeOcspBatchSummary,
  } from './ocsp/client'

  export let report: ConformanceReport
  export let ocspStatusMap: Map<string, OcspResponseData> = new Map()

  const dispatch = createEventDispatcher<{
    statusChange: { statusMap: Map<string, OcspResponseData> }
  }>()

  let isCheckingAll = false
  let checkProgress = { completed: 0, total: 0 }
  let expandedPems: Set<string> = new Set()
  let copiedPemId: string | null = null
  let copiedCurlId: string | null = null
  let copyTimeout: ReturnType<typeof setTimeout> | null = null

  $: certGroups = report.extractedCertificates || []
  $: allCerts = report.allCertificates || certGroups.flatMap(g => g.certificates)
  $: batchSummary = computeOcspBatchSummary(allCerts, ocspStatusMap, isCheckingAll)

  function togglePem(id: string) {
    if (expandedPems.has(id)) {
      expandedPems.delete(id)
    } else {
      expandedPems.add(id)
    }
    expandedPems = new Set(expandedPems)
  }

  async function copyText(text: string, type: 'pem' | 'curl', id: string) {
    if (copyTimeout) clearTimeout(copyTimeout)
    await navigator.clipboard.writeText(text)
    if (type === 'pem') {
      copiedPemId = id
    } else {
      copiedCurlId = id
    }
    copyTimeout = setTimeout(() => {
      copiedPemId = null
      copiedCurlId = null
    }, 2000)
  }

  async function handleCheckSingleOcsp(certItem: ParsedCertificateItem) {
    ocspStatusMap.set(certItem.id, {
      status: 'checking',
      queriedAt: new Date().toISOString(),
    })
    ocspStatusMap = new Map(ocspStatusMap)
    dispatch('statusChange', { statusMap: ocspStatusMap })

    const result = await checkCertificateOcsp(certItem, { forceRefresh: true })
    ocspStatusMap.set(certItem.id, result)
    ocspStatusMap = new Map(ocspStatusMap)
    dispatch('statusChange', { statusMap: ocspStatusMap })
  }

  async function handleCheckAllOcsp() {
    if (isCheckingAll) return
    isCheckingAll = true

    const eligible = allCerts.filter(c => !!c.ocspResponderUrl)
    checkProgress = { completed: 0, total: eligible.length }

    for (const c of allCerts) {
      if (c.ocspResponderUrl) {
        ocspStatusMap.set(c.id, {
          status: 'checking',
          queriedAt: new Date().toISOString(),
        })
      }
    }
    ocspStatusMap = new Map(ocspStatusMap)
    dispatch('statusChange', { statusMap: ocspStatusMap })

    try {
      const results = await checkAllCertificatesOcsp(allCerts, {
        forceRefresh: true,
        onProgress: (completed, total) => {
          checkProgress = { completed, total }
        },
      })
      for (const [id, res] of results.entries()) {
        ocspStatusMap.set(id, res)
      }
      ocspStatusMap = new Map(ocspStatusMap)
      dispatch('statusChange', { statusMap: ocspStatusMap })
    } finally {
      isCheckingAll = false
    }
  }

  function formatDate(isoStr?: string): string {
    if (!isoStr) return 'N/A'
    try {
      const d = new Date(isoStr)
      return d.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short',
      })
    } catch {
      return isoStr
    }
  }
</script>

<section class="bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-2xl p-8 shadow-sm" id="signature-info">
  <!-- Section Header & Global Action Bar -->
  <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-gray-200 dark:border-gray-700">
    <div class="flex items-center gap-4">
      <div class="w-10 h-10 bg-gray-800 dark:bg-gray-700 rounded-lg flex items-center justify-center text-white shadow-sm">
        <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
          <path d="M5 7.2a2.2 2.2 0 0 1 2.2 -2.2h1a2.2 2.2 0 0 0 1.55 -.64l.7 -.7a2.2 2.2 0 0 1 3.12 0l.7 .7c.412 .41 .97 .64 1.55 .64h1a2.2 2.2 0 0 1 2.2 2.2v1c0 .58 .23 1.138 .64 1.55l.7 .7a2.2 2.2 0 0 1 0 3.12l-.7 .7a2.2 2.2 0 0 0 -.64 1.55v1a2.2 2.2 0 0 1 -2.2 2.2h-1a2.2 2.2 0 0 0 -1.55 .64l-.7 .7a2.2 2.2 0 0 1 -3.12 0l-.7 -.7a2.2 2.2 0 0 0 -1.55 -.64h-1a2.2 2.2 0 0 1 -2.2 -2.2v-1a2.2 2.2 0 0 0 -.64 -1.55l-.7 -.7a2.2 2.2 0 0 1 0 -3.12l.7 -.7a2.2 2.2 0 0 0 .64 -1.55v-1" />
          <path d="M9 12l2 2l4 -4" />
        </svg>
      </div>
      <div>
        <h3 class="text-xl font-semibold text-[#1e293b] dark:text-white">Signatures & Certificate Validation</h3>
        <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">X.509 certificate chains, AIA endpoints, and live OCSP revocation status</p>
      </div>
    </div>

    <!-- Master Action Button & Summary Pill -->
    <div class="flex items-center gap-3 flex-wrap">
      {#if batchSummary.withOcspResponder > 0}
        <div class="text-xs font-semibold px-3 py-1.5 rounded-lg border flex items-center gap-2
          {batchSummary.revokedCount > 0
            ? 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
            : batchSummary.checkedCount === batchSummary.withOcspResponder && batchSummary.goodCount === batchSummary.withOcspResponder
              ? 'bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300'
              : 'bg-gray-100 dark:bg-gray-700/50 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300'}">
          {#if isCheckingAll}
            <span class="inline-block w-2 h-2 rounded-full bg-blue-600 animate-ping"></span>
            <span>Checking OCSP ({checkProgress.completed}/{checkProgress.total})...</span>
          {:else if batchSummary.revokedCount > 0}
            <span>🔴 {batchSummary.revokedCount} Revoked · {batchSummary.goodCount} Good</span>
          {:else if batchSummary.checkedCount > 0}
            <span>🟢 {batchSummary.goodCount}/{batchSummary.withOcspResponder} Checked (Good)</span>
          {:else}
            <span>⚪ {batchSummary.withOcspResponder} OCSP {batchSummary.withOcspResponder === 1 ? 'responder' : 'responders'} available</span>
          {/if}
        </div>

        <button
          class="btn btn-primary text-xs px-3 py-2 flex items-center gap-1.5 disabled:opacity-50"
          on:click={handleCheckAllOcsp}
          disabled={isCheckingAll}
          title="Query OCSP responders for all certificates across all manifests"
        >
          {#if isCheckingAll}
            <svg class="animate-spin w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="none">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>Checking All...</span>
          {:else}
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
              <path d="M13 3l0 7l6 0l-8 11l0 -7l-6 0z" />
            </svg>
            <span>Check All OCSP</span>
          {/if}
        </button>
      {/if}
    </div>
  </div>

  {#if certGroups.length > 0}
    <div class="space-y-6">
      {#each certGroups as group}
        <div class="border border-gray-200 dark:border-gray-700 rounded-2xl p-6 bg-gray-50/40 dark:bg-gray-900/20 shadow-sm">
          <!-- Manifest Header -->
          <div class="flex items-center justify-between gap-4 mb-4 pb-3 border-b border-gray-200 dark:border-gray-700 flex-wrap">
            <div class="flex items-center gap-2 flex-wrap">
              {#if group.manifestRole === 'active'}
                <span class="badge bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-300 font-semibold">Active Manifest</span>
              {:else}
                <span class="badge bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-300 font-semibold">Ingredient {group.manifestIndex}</span>
              {/if}
              <span class="text-xs font-mono text-gray-500 dark:text-gray-400 truncate max-w-xs md:max-w-md" title={group.manifestLabel}>
                {group.manifestLabel}
              </span>
            </div>

            {#if group.signerCommonName || group.signerOrg}
              <span class="text-xs text-gray-500 dark:text-gray-400">
                Signed by <span class="font-bold text-gray-800 dark:text-gray-200">{group.signerCommonName || group.signerOrg}</span>
              </span>
            {/if}
          </div>

          <!-- Certificate Cards in this Manifest -->
          <div class="space-y-4">
            {#each group.certificates as certItem (certItem.id)}
              {@const ocspData = ocspStatusMap.get(certItem.id)}
              {@const isPemExpanded = expandedPems.has(certItem.id)}
              <div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 shadow-sm space-y-4">
                <!-- Cert Title and Role -->
                <div class="flex items-start justify-between gap-3 flex-wrap">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="px-2 py-0.5 text-xs font-bold rounded-md bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                      {certItem.certificateRole === 'claim_signer' ? 'Claim Signer' : 'Timestamp Authority (TSA)'}
                    </span>
                    <span class="text-sm font-bold text-[#1e293b] dark:text-white">
                      {certItem.subjectCommonName || certItem.subject}
                    </span>
                  </div>

                  <!-- Live OCSP Status Badge & Single Check Button -->
                  <div class="flex items-center gap-2 flex-wrap">
                    {#if certItem.ocspResponderUrl}
                      {#if !ocspData || ocspData.status === 'pending'}
                        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                          <span class="w-2 h-2 rounded-full bg-gray-400"></span>
                          Not Checked
                        </span>
                      {:else if ocspData.status === 'checking'}
                        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                          <span class="w-2 h-2 rounded-full bg-blue-500 animate-ping"></span>
                          Checking...
                        </span>
                      {:else if ocspData.status === 'good'}
                        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold rounded-lg bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800">
                          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12l5 5l10 -10"/></svg>
                          Good (Not Revoked)
                        </span>
                      {:else if ocspData.status === 'revoked'}
                        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold rounded-lg bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
                          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6l-12 12"/><path d="M6 6l12 12"/></svg>
                          Revoked
                        </span>
                      {:else if ocspData.status === 'unknown'}
                        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                          <span class="w-2 h-2 rounded-full bg-amber-500"></span>
                          Unknown Status
                        </span>
                      {:else if ocspData.status === 'error'}
                        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800" title={ocspData.errorMessage}>
                          <span class="w-2 h-2 rounded-full bg-amber-500"></span>
                          Inaccessible
                        </span>
                      {/if}

                      <button
                        class="btn-outline-gray text-xs px-2.5 py-1 flex items-center gap-1 hover:border-blue-400 dark:hover:border-blue-500"
                        on:click={() => handleCheckSingleOcsp(certItem)}
                        disabled={ocspData?.status === 'checking'}
                        title="Query OCSP responder for this certificate"
                      >
                        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4"/><path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"/></svg>
                        <span>{ocspData ? 'Re-check' : 'Check OCSP'}</span>
                      </button>
                    {:else}
                      <span class="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                        No AIA OCSP URL
                      </span>
                    {/if}
                  </div>
                </div>

                <!-- Revocation Alert Box (if revoked) -->
                {#if ocspData?.status === 'revoked'}
                  <div class="bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-800 rounded-lg p-3 text-xs text-red-800 dark:text-red-200 flex items-start gap-2.5">
                    <svg class="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4"/><path d="M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0z"/><path d="M12 16h.01"/></svg>
                    <div>
                      <p class="font-bold">This certificate has been revoked by its issuing authority.</p>
                      <p class="mt-0.5 text-red-700 dark:text-red-300">
                        Revocation Time: <span class="font-mono font-bold">{formatDate(ocspData.revokedAt)}</span>
                        {#if ocspData.revocationReason}
                          · Reason: <span class="font-bold">{ocspData.revocationReason}</span>
                        {/if}
                      </p>
                    </div>
                  </div>
                {/if}

                <!-- Details Grid -->
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div class="bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
                    <span class="font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide block mb-1">Subject</span>
                    <p class="font-mono text-[#1e293b] dark:text-gray-200 break-all">{certItem.subject}</p>
                  </div>
                  <div class="bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
                    <span class="font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide block mb-1">Issuer</span>
                    <p class="font-mono text-[#1e293b] dark:text-gray-200 break-all">{certItem.issuer}</p>
                  </div>
                  <div class="bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
                    <span class="font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide block mb-1">Serial Number</span>
                    <p class="font-mono text-[#1e293b] dark:text-gray-200 break-all">{certItem.serialNumber}</p>
                  </div>
                  <div class="bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
                    <span class="font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide block mb-1">Validity Period</span>
                    <p class="text-[#1e293b] dark:text-gray-200">
                      {formatDate(certItem.notBefore)} &rarr; {formatDate(certItem.notAfter)}
                      {#if certItem.isExpired}
                        <span class="ml-1 text-red-600 font-bold">(Expired)</span>
                      {/if}
                    </p>
                  </div>
                  {#if certItem.ocspResponderUrl}
                    <div class="bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
                      <span class="font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide block mb-1">AIA OCSP Responder</span>
                      <a href={certItem.ocspResponderUrl} target="_blank" rel="noopener noreferrer" class="text-blue-600 dark:text-blue-400 underline font-mono break-all inline-flex items-center gap-1">
                        {certItem.ocspResponderUrl}
                        <svg class="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6"/><path d="M11 13l9 -9"/><path d="M15 4h5v5"/></svg>
                      </a>
                    </div>
                  {/if}
                  {#if certItem.caIssuersUrl}
                    <div class="bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
                      <span class="font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide block mb-1">AIA CA Issuers</span>
                      <a href={certItem.caIssuersUrl} target="_blank" rel="noopener noreferrer" class="text-blue-600 dark:text-blue-400 underline font-mono break-all inline-flex items-center gap-1">
                        {certItem.caIssuersUrl}
                        <svg class="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6"/><path d="M11 13l9 -9"/><path d="M15 4h5v5"/></svg>
                      </a>
                    </div>
                  {/if}
                </div>

                <!-- OCSP Response Detailed Window (if checked) -->
                {#if ocspData && (ocspData.status === 'good' || ocspData.status === 'revoked' || ocspData.status === 'unknown')}
                  <div class="bg-gray-50 dark:bg-gray-900/60 rounded-lg p-3 border border-gray-200 dark:border-gray-700 text-xs flex flex-wrap items-center justify-between gap-3">
                    <div class="flex items-center gap-4 flex-wrap text-gray-600 dark:text-gray-300">
                      {#if ocspData.thisUpdate}
                        <span>This Update: <strong class="text-gray-800 dark:text-gray-200">{formatDate(ocspData.thisUpdate)}</strong></span>
                      {/if}
                      {#if ocspData.nextUpdate}
                        <span>Next Update: <strong class="text-gray-800 dark:text-gray-200">{formatDate(ocspData.nextUpdate)}</strong></span>
                      {/if}
                      {#if ocspData.responderName}
                        <span>Responder: <strong class="text-gray-800 dark:text-gray-200">{ocspData.responderName}</strong></span>
                      {/if}
                    </div>

                    {#if ocspData.curlCommand}
                      <button
                        class="btn-outline-gray text-xs px-2 py-1 inline-flex items-center gap-1"
                        on:click={() => copyText(ocspData.curlCommand || '', 'curl', certItem.id)}
                        title="Copy curl command to query this OCSP responder via terminal"
                      >
                        <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 8m0 2a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2z"/><path d="M16 8v-2a2 2 0 0 0 -2 -2h-8a2 2 0 0 0 -2 2v8a2 2 0 0 0 2 2h2"/></svg>
                        <span>{copiedCurlId === certItem.id ? 'Copied curl!' : 'Copy curl'}</span>
                      </button>
                    {/if}
                  </div>
                {/if}

                <!-- Actions: PEM Toggle & Copy -->
                <div class="flex items-center gap-2 pt-1">
                  <button
                    class="text-xs text-blue-600 dark:text-blue-400 hover:underline font-semibold inline-flex items-center gap-1"
                    on:click={() => togglePem(certItem.id)}
                  >
                    <svg class="w-3.5 h-3.5 transition-transform {isPemExpanded ? 'rotate-90' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6l-6 6"/></svg>
                    <span>{isPemExpanded ? 'Hide Certificate PEM' : 'View Certificate PEM'}</span>
                  </button>
                </div>

                <!-- Collapsible PEM block -->
                {#if isPemExpanded}
                  <div class="relative mt-2 animate-fade-in">
                    <button
                      class="absolute top-2 right-2 btn-outline-gray text-xs px-2.5 py-1 z-10"
                      on:click={() => copyText(certItem.targetCertPem, 'pem', certItem.id)}
                    >
                      {copiedPemId === certItem.id ? 'Copied PEM!' : 'Copy PEM'}
                    </button>
                    <pre class="bg-gray-900 dark:bg-black p-4 rounded-lg text-xs font-mono text-gray-200 overflow-x-auto leading-relaxed border border-gray-700">{certItem.targetCertPem}</pre>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {:else}
    <div class="bg-gray-50 dark:bg-gray-900 border-2 border-gray-200 dark:border-gray-700 rounded-2xl p-6 text-center">
      <p class="text-gray-600 dark:text-gray-400">No signing certificates found in manifest store.</p>
    </div>
  {/if}
</section>
