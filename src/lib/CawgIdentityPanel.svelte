<script lang="ts">
  import type { ConformanceReport } from './types'
  import { getCawgIdentities, sigTypeDisplayName, CAWG_STATE_LABEL, type CawgIdentity } from './cawg'
  import { evaluateCawgChecks, CAWG_CHECK_OUTCOME_LABEL, type CawgCheckOutcome } from './cawgChecks'

  export let report: ConformanceReport

  // One entry per CAWG identity assertion, across the active manifest and ingredients
  $: entries = (report.manifests ?? []).flatMap((m, i) =>
    getCawgIdentities(report, m).map((identity: CawgIdentity) => ({
      identity,
      manifestIndex: i,
      checks: evaluateCawgChecks(identity)
    }))
  )

  const OUTCOME_STYLE: Record<CawgCheckOutcome, { icon: string; badge: string }> = {
    passed: { icon: '✓', badge: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300' },
    failed: { icon: '✕', badge: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300' },
    not_assessed: { icon: '—', badge: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300' },
    not_applicable: { icon: '—', badge: 'bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400' }
  }
</script>

{#if entries.length > 0}
  <section class="bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-2xl p-8 shadow-sm" id="creator-identity">
    <div class="flex items-center gap-4 mb-2">
      <div class="w-10 h-10 bg-gray-800 dark:bg-gray-700 rounded-lg flex items-center justify-center text-white shadow-sm">
        <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0"/><path d="M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2"/></svg>
      </div>
      <h3 class="text-xl font-semibold text-[#1e293b] dark:text-white">Creator identity</h3>
    </div>
    <p class="text-sm text-gray-500 dark:text-gray-400 mb-6">
      CAWG identity assertions name who stands behind this content. Their trust is separate from the C2PA signature above.
    </p>

    <div class="space-y-6">
      {#each entries as { identity, manifestIndex, checks } (`${manifestIndex}:${identity.label}`)}
        <div class="cawg-check-group border border-gray-200 dark:border-gray-700 rounded-2xl p-6 bg-gray-50/30 dark:bg-gray-900/10" data-label={identity.label}>
          <h4 class="font-bold text-[#1e293b] dark:text-white mb-4 flex items-center gap-2 flex-wrap">
            <span class="badge bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-300">
              {manifestIndex === 0 ? 'Active Asset' : `Ingredient ${manifestIndex}`}
            </span>
            <span class="text-xs font-mono text-gray-500">{identity.label}</span>
            <span class="text-sm font-semibold text-gray-800 dark:text-gray-200">{identity.displayName ?? 'Unnamed identity'}</span>
            <span class="text-xs font-medium text-gray-500 dark:text-gray-400 ml-auto">
              {sigTypeDisplayName(identity.sigType)} · {CAWG_STATE_LABEL[identity.state]}
            </span>
          </h4>

          <ul class="divide-y divide-gray-200 dark:divide-gray-700">
            {#each checks as check (check.id)}
              <li class="py-3 flex items-start gap-3" data-check={check.id} data-outcome={check.outcome}>
                <span class="flex-shrink-0 mt-0.5 badge {OUTCOME_STYLE[check.outcome].badge}">
                  {OUTCOME_STYLE[check.outcome].icon} {CAWG_CHECK_OUTCOME_LABEL[check.outcome]}
                </span>
                <div class="flex-1 min-w-0 text-left">
                  <p class="text-sm font-medium text-gray-800 dark:text-gray-200">
                    {check.title} <code class="text-xs text-gray-500 dark:text-gray-400">{check.id}</code>
                  </p>
                  {#if check.evidence.length > 0}
                    <p class="text-xs font-mono text-gray-600 dark:text-gray-300 mt-1 break-words">{check.evidence.join(', ')}</p>
                  {/if}
                  {#if check.detail}
                    <p class="text-sm text-gray-600 dark:text-gray-400 mt-1">{check.detail}</p>
                  {/if}
                  <p class="text-xs text-gray-400 dark:text-gray-500 mt-1">Reference: {check.reference}</p>
                </div>
              </li>
            {/each}
          </ul>
        </div>
      {/each}
    </div>
  </section>
{/if}
