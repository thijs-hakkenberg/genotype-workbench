<script lang="ts">
  import type { HaplogroupResult } from '@gw/analysis-haplogroups';
  import { activeKit, app } from '../lib/services.svelte';
  import { lineagesFor, type LineageResult, type Lineages } from '../lib/lineages';
  import { fmtInt } from '../lib/format';

  const kit = $derived(activeKit());
  let lineages = $state<Lineages | null>(null);
  let error = $state('');
  const trees = $derived(app.installed.filter((p) => p.manifest.role === 'haplotree-mt' || p.manifest.role === 'haplotree-y').length);

  $effect(() => {
    const k = kit;
    void trees;
    lineages = null;
    error = '';
    if (k) lineagesFor(k).then((l) => (lineages = l)).catch((e: unknown) => (error = e instanceof Error ? e.message : String(e)));
  });

  const TITLES = {
    mt: { kicker: 'Maternal line · mtDNA', line: "your mother's mother's mother's line" },
    y: { kicker: 'Paternal line · Y-DNA', line: "your father's father's father's line" },
  };
  const derivedCount = (r: HaplogroupResult) => r.path.flatMap((s) => s.markers).filter((m) => m.state === 'derived').length;
  const conflictCount = (r: HaplogroupResult) => r.path.flatMap((s) => s.markers).filter((m) => m.state === 'ancestral').length;
</script>

<div class="page">
  <div class="page-head">
    <div style="max-width:760px">
      <div class="card-kicker">Analysis · haplogroups</div>
      <h2>Lineages</h2>
      <div class="sub">
        A haplogroup places one line of descent on a published tree of human mitochondrial or Y-chromosome lineages. It
        traces a single ancestor in each generation, a tiny share of your ancestry, and is the best match for the
        positions your chip reads, so it is an estimate shown with its support.
      </div>
    </div>
  </div>

  {#if !kit}
    <p class="muted">Import a kit first.</p>
  {:else if trees === 0}
    <div class="evidence empty">
      <div>
        <div class="title">No haplogroup tree installed</div>
        <div class="what">Install the mtDNA (PhyloTree 17) and Y-DNA (YFull YTree) tree packs from <a href="#/packs">Packs</a>.</div>
      </div>
    </div>
  {:else if error}
    <div class="error-box">{error}</div>
  {:else if !lineages}
    <p class="faint">Matching {kit.label} against the trees on this device…</p>
  {:else if lineages.blocked}
    <div class="error-box">{lineages.blocked} <a href="#/kits">Custody records</a></div>
  {:else}
    <div class="grid-2">
      {#each [['mt', lineages.mt], ['y', lineages.y]] as [line, l] (line)}
        {@const lr = l as LineageResult | null}
        {@const t = TITLES[line as 'mt' | 'y']}
        <div class="panel">
          <div class="card-kicker">{t.kicker}</div>
          {#if !lr}
            <h4 class="muted">No tree installed</h4>
            <p class="notice">Install the {line === 'mt' ? 'mtDNA' : 'Y-DNA'} tree pack from <a href="#/packs">Packs</a>.</p>
          {:else if !lr.result.best}
            <h4 class="muted">Not placed</h4>
            <p class="notice">{lr.result.note}</p>
          {:else}
            {@const r = lr.result}
            <div style="display:flex;align-items:center;gap:var(--space-3);margin:6px 0 var(--space-2)">
              <span class="mk-estimate" style="margin:0" title="Estimate: the best match for the positions read"></span>
              <h3 style="margin:0">{r.best}</h3>
            </div>
            <div class="what muted" style="font-size:12px">Best-matching haplogroup for {t.line}.</div>
            <div class="kv" style="font-size:12px;margin-top:var(--space-4)">
              <div><span>Positions read</span><span class="num">{fmtInt(r.positionsRead)} {line === 'mt' ? 'mitochondrial' : 'Y'} calls · {fmtInt(r.informative)} on the tree</span></div>
              <div><span>Support on the path</span><span class="num">{derivedCount(r)} defining markers carried{conflictCount(r) ? ` · ${conflictCount(r)} not carried` : ''}</span></div>
              {#if r.note}<div><span>Note</span><span>{r.note}</span></div>{/if}
            </div>
            <details style="margin-top:var(--space-4)">
              <summary class="muted" style="font-size:12px">
                {line === 'mt' ? 'Path from the rCRS reference to this branch, with each defining marker' : 'Path from the root, with each defining marker'}
              </summary>
              {#if line === 'mt'}
                <p class="faint" style="font-size:11px;margin:var(--space-2) 0 0">
                  PhyloTree is written relative to the rCRS reference sequence, which is itself haplogroup H2a2a1, so the
                  path starts there rather than at the tree's root.
                </p>
              {/if}
              <div style="display:flex;flex-direction:column;gap:6px;margin-top:var(--space-3)">
                {#each r.path.filter((s) => s.markers.length) as step (step.name)}
                  <div style="font-size:11px">
                    <span style="font-size:12px">{step.name}</span>
                    <span style="display:inline-flex;flex-wrap:wrap;gap:3px;margin-left:6px;vertical-align:middle">
                      {#each step.markers as mk, i (mk.label + i)}
                        <span class="marker {mk.state}" title={mk.state === 'derived' ? 'Carried' : mk.state === 'ancestral' ? 'Not carried' : 'Not read by the chip'}>{mk.label}</span>
                      {/each}
                    </span>
                  </div>
                {/each}
              </div>
              <div class="legend" style="background:transparent;padding:var(--space-3) 0 0">
                <span><span class="marker derived">x</span>carried</span>
                <span><span class="marker ancestral">x</span>not carried</span>
                <span><span class="marker unread">x</span>not read by the chip</span>
              </div>
            </details>
            {#if r.candidates.length > 1}
              <div class="faint" style="font-size:11px;margin-top:var(--space-3)">
                Nearby candidates: {r.candidates.slice(0, 5).map((c) => c.name).join(', ')}
              </div>
            {/if}
          {/if}
          {#if lr}
            <div class="faint" style="font-size:10px;margin-top:var(--space-4)">
              {lr.pack.source.short} {lr.pack.version} · {lr.pack.licence}
              {#if lr.pack.licenceClass === 'unverified'}<span class="tag tag-outline" style="font-size:9px">licence unverified</span>{/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
    <p class="notice" style="margin-top:var(--space-6);max-width:760px">
      Haplogroups are not ancestry percentages or ethnicity. Many populations share them, and a chip reads only some of
      the defining positions, so a deeper branch may exist than the one shown.
    </p>
  {/if}
</div>

<style>
  .marker { font-size: 10px; padding: 0 5px; border-radius: 3px; line-height: 16px; font-variant-numeric: tabular-nums; }
  .marker.derived { background: var(--color-accent-800); color: var(--color-accent-100); }
  .marker.ancestral { box-shadow: inset 0 0 0 1px var(--color-neutral-500); color: var(--color-neutral-300); }
  .marker.unread { color: var(--color-neutral-600); box-shadow: inset 0 0 0 1px var(--color-neutral-800); }
</style>
