<script lang="ts">
  export let value: unknown
  export let objKey: string | null = null // set when rendered as an object property
  export let comma = false                // whether to append a trailing comma
  export let depth = 0

  const COLLAPSE_STRING = 200      // chars before truncating a string
  const COLLAPSE_COLLECTION = 20  // items/keys before collapsing array or object

  let stringExpanded = false
  let collectionExpanded = false

  $: type = value === null ? 'null'
    : Array.isArray(value) ? 'array'
    : typeof value

  $: arrayItems = type === 'array' ? (value as unknown[]) : []
  $: objectEntries = type === 'object' && value !== null
    ? Object.entries(value as Record<string, unknown>)
    : []

  $: collectionSize = type === 'array' ? arrayItems.length : objectEntries.length

  $: needsCollapse = (type === 'array' || type === 'object')
    && collectionSize > COLLAPSE_COLLECTION

  $: isLongString = type === 'string' && (value as string).length > COLLAPSE_STRING

  $: openBracket = type === 'array' ? '[' : '{'
  $: closeBracket = type === 'array' ? ']' : '}'
  $: noun = type === 'array'
    ? `${collectionSize} item${collectionSize === 1 ? '' : 's'}`
    : `${collectionSize} key${collectionSize === 1 ? '' : 's'}`

  function pad(d: number) {
    return '  '.repeat(d)
  }
</script>

<!--
  Renders one JSON value, optionally preceded by its object key.
  All coloring uses the existing hljs-* CSS classes from github-dark.

  Whitespace control: every inter-element boundary uses HTML comments to
  suppress the whitespace that Svelte otherwise emits between template nodes.
  This matters because the parent is a <pre> element.
-->

<!--  Optional key prefix  -->{#if objKey !== null}<span class="hljs-attr">"{objKey}"</span><span class="hljs-punctuation">: </span>{/if}<!--
--><!--  null  -->{#if type === 'null'}<span class="hljs-literal hljs-keyword">null</span><!--
--><!--  boolean  -->{:else if type === 'boolean'}<span class="hljs-literal hljs-keyword">{String(value)}</span><!--
--><!--  number  -->{:else if type === 'number'}<span class="hljs-number">{value}</span><!--
--><!--  string  -->{:else if type === 'string'}<!--
  -->{#if isLongString && !stringExpanded}<!--
    --><span class="hljs-string">"</span><!--
    --><span class="hljs-string">{(value as string).slice(0, COLLAPSE_STRING)}</span><!--
    --><button class="hljs-string cursor-pointer hover:brightness-125 underline decoration-dotted" title="Show full string ({(value as string).length} chars)" on:click={() => { stringExpanded = true }}>… [{(value as string).length - COLLAPSE_STRING} more chars]</button><!--
    --><span class="hljs-string">"</span><!--
  -->{:else if isLongString && stringExpanded}<!--
    --><span class="hljs-string">"{value as string}"</span><!--
    --> <button class="text-xs opacity-40 hover:opacity-70 cursor-pointer" title="Collapse" on:click={() => { stringExpanded = false }}>[▲ collapse]</button><!--
  -->{:else}<!--
    --><span class="hljs-string">"{value as string}"</span><!--
  -->{/if}<!--
--><!--  array / object  -->{:else if type === 'array' || type === 'object'}<!--
  -->{#if collectionSize === 0}<!--
    --><span class="hljs-punctuation">{openBracket}{closeBracket}</span><!--
  -->{:else if needsCollapse && !collectionExpanded}<!--
    --><button class="cursor-pointer hover:brightness-125" title="Click to expand ({noun})" on:click={() => { collectionExpanded = true }}><span class="hljs-punctuation">{openBracket}</span><span class="opacity-50"> ▶ {noun} </span><span class="hljs-punctuation">{closeBracket}</span></button><!--
  -->{:else}<!--
    --><span class="hljs-punctuation">{openBracket}</span><!--
    -->{#if needsCollapse} <button class="text-xs opacity-40 hover:opacity-70 cursor-pointer" title="Collapse" on:click={() => { collectionExpanded = false }}>[▼ collapse]</button>{/if}<!--
    -->{#if type === 'array'}<!--
      -->{#each arrayItems as item, i}{"\n"}{pad(depth + 1)}<svelte:self value={item} depth={depth + 1} comma={i < arrayItems.length - 1} />{/each}<!--
    -->{:else}<!--
      -->{#each objectEntries as [k, v], i}{"\n"}{pad(depth + 1)}<svelte:self value={v} objKey={k} depth={depth + 1} comma={i < objectEntries.length - 1} />{/each}<!--
    -->{/if}<!--
    -->{"\n"}{pad(depth)}<span class="hljs-punctuation">{closeBracket}</span><!--
  -->{/if}<!--
-->{/if}<!--  end type switch
-->{#if comma}<span class="hljs-punctuation">,</span>{/if}
