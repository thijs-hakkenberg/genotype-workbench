<script lang="ts">
  import { parseRegion } from '@gw/plugin-sdk/genome';
  import { app, activeKit, setActiveKit, svc } from '../services.svelte';
  import { go } from '../router.svelte';

  let query = $state('');
  let message = $state('');
  const kit = $derived(activeKit());

  async function search(e: SubmitEvent) {
    e.preventDefault();
    message = '';
    const q = query.trim();
    if (!q) return;
    const region = parseRegion(q);
    if (region) return go(`genome/${region.chrom}:${region.start}-${region.end}`);
    const { store, library } = svc();
    if (/^(rs|i)\d+$/i.test(q)) {
      const call = kit ? await store.findRsid(kit.kitId, q) : null;
      const at = call ?? (await library.findRsid(q));
      if (at) return go(`genome/${at.chrom}:${at.pos - 10_000}-${at.pos + 10_000}?sel=${at.chrom}:${at.pos}`);
      message = `${q} is not in this kit or in any installed pack`;
      return;
    }
    const gene = await library.findGene(q);
    if (gene) {
      const pad = Math.round((gene.end - gene.start) * 0.15) + 2000;
      return go(`genome/${gene.chrom}:${gene.start - pad}-${gene.end + pad}`);
    }
    message = library.has('genes-ensembl75')
      ? `No region, rsID or gene called “${q}”`
      : 'Install the gene models pack to search by gene name';
  }
</script>

<header class="nav topbar">
  <div class="nav-brand">Genotype Workbench <small>v0.1</small></div>
  {#if kit}
    <label class="kit-pill" title="Active kit">
      <span class="swatch"></span>
      <select value={app.activeKitId} onchange={(e) => setActiveKit((e.target as HTMLSelectElement).value)} aria-label="Active kit">
        {#each app.kits as k (k.kitId)}
          <option value={k.kitId}>{k.label}</option>
        {/each}
      </select>
      <span class="tag tag-neutral" style="font-size:10px;padding:1px 7px">
        {kit.custody.dataSubject === 'Self' ? 'Self' : kit.custody.dataSubject}
      </span>
    </label>
  {:else if app.phase === 'ready'}
    <a class="btn btn-secondary" href="#/import">Import a raw data file</a>
  {/if}
  <form class="searchbox" onsubmit={search} role="search">
    <input class="input" type="search" placeholder="chr2:136,600,000-136,620,000 · rs4988235 · LCT" bind:value={query}
      aria-label="Go to a region, rsID or gene" title={message || 'Region, rsID or gene symbol'} />
    {#if app.networkHosts.length}
      <div class="netstate granted" title="Hosts granted: {app.networkHosts.join(', ')}">
        <span class="dot"></span>Network: {app.networkHosts.join(', ')}
      </div>
    {:else}
      <div class="netstate"><span class="dot"></span>Offline · no network grants</div>
    {/if}
  </form>
  {#if message}
    <div class="faint" style="font-size:11px;width:100%;text-align:right" role="status">{message}</div>
  {/if}
</header>
