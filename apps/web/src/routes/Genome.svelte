<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { Chrom, Region, TrackDescriptor, TrackItem, TrackSource } from '@gw/plugin-sdk';
  import { EVIDENCE_KINDS, SEQUENCE_BELOW_BP } from '@gw/plugin-sdk';
  import { CHROM_LENGTH, GRCH37, clampRegion, formatRegion, formatWidth, parseRegion } from '@gw/plugin-sdk/genome';
  import { TrackView, markSwatch } from '@gw/view-tracks';
  import { formatCall, viewName, type CallRow } from '@gw/genotype-store';
  import { app, activeKit, svc } from '../lib/services.svelte';
  import { route, go } from '../lib/router.svelte';
  import { fmtInt } from '../lib/format';
  import DetailDock from '../lib/components/DetailDock.svelte';

  const DEFAULT = '2:136590000-136625000'; // LCT/MCM6, the lactase-persistence region
  const kit = $derived(activeKit());
  const region = $derived<Region>(parseRegion(route.arg || DEFAULT) ?? parseRegion(DEFAULT)!);
  const width = $derived(region.end - region.start + 1);
  const sel = $derived.by(() => {
    const m = (route.params.get('sel') ?? '').match(/^(\w+):(\d+)$/);
    return m ? { chrom: m[1] as Chrom, pos: Number(m[2]) } : null;
  });
  const chromLen = $derived(CHROM_LENGTH.get(region.chrom)!);

  let host = $state<HTMLDivElement>();
  let view: TrackView | null = null;
  let calls = $state<CallRow[]>([]);
  let callCount = $state<number | null>(null);

  const PACK_SLOTS = [
    { role: 'genes', title: 'Gene models', kind: 'documentary' as const },
    { role: 'classification', title: 'ClinVar', kind: 'curated-classification' as const },
    { role: 'association', title: 'GWAS Catalog', kind: 'statistical-association' as const },
    { role: 'frequency', title: 'Population frequency', kind: 'population-frequency' as const },
    { role: 'sequence', title: 'Reference sequence, protein and the double helix', kind: 'documentary' as const },
  ];
  const missing = $derived(PACK_SLOTS.filter((s) => !app.installed.some((p) => p.manifest.role === s.role)));
  const hasSequence = $derived(app.installed.some((p) => p.manifest.role === 'sequence'));

  function tracks(): TrackSource[] {
    const { store, library } = svc();
    const t: TrackSource[] = [];
    if (kit) t.push(store.trackSource(kit.kitId));
    // The molecule last: it is what everything above is a reading of.
    const helix = library.helixTrack(kit ? viewName(kit.kitId) : null);
    return [...t, ...library.trackSources(), ...(helix ? [helix] : [])];
  }

  let seeking = $state(false);
  let moleculeNote = $state('');

  /**
   * Jump to somewhere the molecule can actually be drawn.
   *
   * Zooming in place almost never works: the sequence pack covers coding exons
   * and chip positions, which is a great many small islands rather than a
   * continuous genome, so an arbitrary few hundred bases usually falls in a
   * gap. This finds the nearest stretch that has sequence, preferring one of
   * this kit's own calls.
   */
  async function showMolecule() {
    seeking = true;
    moleculeNote = '';
    try {
      const from = sel?.pos ?? Math.round((region.start + region.end) / 2);
      const found = await svc().library.moleculeWindow(region.chrom, from, kit ? viewName(kit.kitId) : null);
      if (found) navigate(found, false);
      else moleculeNote = `No reference sequence on chromosome ${region.chrom}: that pack covers coding exons and chip positions.`;
    } catch (e) {
      moleculeNote = e instanceof Error ? e.message : String(e);
    } finally {
      seeking = false;
    }
  }

  function navigate(r: Region, replace = true) {
    const c = clampRegion(r);
    const q = route.params.get('sel') ? `?sel=${route.params.get('sel')}` : '';
    go(`genome/${c.chrom}:${c.start}-${c.end}${q}`, replace);
  }

  function select(chrom: Chrom, pos: number) {
    go(`genome/${region.chrom}:${region.start}-${region.end}?sel=${chrom}:${pos}`, true);
  }

  function onSelect(track: TrackDescriptor, item: TrackItem) {
    if (track.evidenceKind === 'documentary') {
      const pad = Math.round((item.end - item.start) * 0.15) + 2000;
      return navigate({ chrom: region.chrom, start: item.start - pad, end: item.end + pad }, false);
    }
    select(region.chrom, item.start);
  }

  // Mount once the element exists; re-point on region, track and selection changes.
  $effect(() => {
    if (!host || view) return;
    view = new TrackView(host, tracks(), {
      region,
      onRegionChange: (r) => {
        if (r.chrom !== region.chrom || r.start !== region.start || r.end !== region.end) navigate(r);
      },
      onSelect,
      selectedId: sel ? `${sel.chrom}:${sel.pos}` : undefined,
    });
  });
  $effect(() => view?.setRegion(region));
  $effect(() => {
    void app.installed.length;
    void app.activeKitId;
    view?.setTracks(tracks());
  });
  $effect(() => view?.setSelected(sel ? `${sel.chrom}:${sel.pos}` : null));
  onDestroy(() => view?.destroy());

  $effect(() => {
    const k = kit;
    const r = region;
    calls = [];
    callCount = null;
    if (!k) return;
    void svc().store.callsIn(k.kitId, r, 5001).then((rows) => {
      if (r !== region) return;
      callCount = rows.length;
      calls = rows.slice(0, 250);
    });
  });

  function zoomTo(bp: number) {
    const mid = sel && sel.chrom === region.chrom ? sel.pos : Math.round((region.start + region.end) / 2);
    navigate({ chrom: region.chrom, start: mid - bp / 2, end: mid + bp / 2 }, false);
  }

  function stripClick(e: MouseEvent) {
    const el = e.currentTarget as HTMLElement;
    const frac = (e.clientX - el.getBoundingClientRect().left) / el.clientWidth;
    const mid = Math.round(frac * chromLen);
    navigate({ chrom: region.chrom, start: mid - width / 2, end: mid + width / 2 }, false);
  }

  const stripLeft = $derived((region.start / chromLen) * 100);
  const stripWidth = $derived(Math.max(0.3, (width / chromLen) * 100));
  const centromere = $derived(GRCH37.find((c) => c.chrom === region.chrom)?.centromereMb);
</script>

<div class="genome">
  <div class="toolbar">
    <div style="display:flex;align-items:baseline;gap:var(--space-3);min-width:0">
      <h4 class="num" style="margin:0;white-space:nowrap">{formatRegion(region)}</h4>
      <span class="tag tag-neutral">GRCh37</span>
    </div>
    <span class="muted num" style="font-size:12px">
      {formatWidth(width)} · {callCount == null ? '…' : callCount > 5000 ? 'over 5,000' : fmtInt(callCount)} calls in view
      {#if hasSequence}· <button type="button" class="linkish" onclick={showMolecule} disabled={seeking}>{seeking ? 'looking…' : width > SEQUENCE_BELOW_BP ? 'take me to bases, codons and the molecule' : 'take me to the molecule'}</button>{/if}
      {#if moleculeNote}<br /><span class="faint">{moleculeNote}</span>{/if}
    </span>
    <div style="margin-left:auto;display:flex;gap:var(--space-2);align-items:center">
      <div class="seg" role="radiogroup" aria-label="Window width">
        {#each [1e2, 2e4, 2e5, 2e6] as bp (bp)}
          <label class="seg-opt"><input type="radio" name="zoom" checked={Math.abs(width - bp) < bp * 0.05} onchange={() => zoomTo(bp)} />{formatWidth(bp)}</label>
        {/each}
      </div>
      <a class="btn btn-secondary" href="#/packs">Add track</a>
      <a class="btn btn-secondary" href="#/overview">Back to overview</a>
    </div>
  </div>

  <div class="chips">
    <span class="kicker-plain" style="flex:none">Chromosome</span>
    <div style="display:flex;gap:3px;flex:1;min-width:0">
      {#each GRCH37 as c (c.chrom)}
        <button type="button" class="chip num" class:active={c.chrom === region.chrom}
          onclick={() => navigate({ chrom: c.chrom, start: 1, end: c.length }, false)}>{c.chrom}</button>
      {/each}
    </div>
  </div>

  <div style="padding:var(--space-4) var(--space-8) 0">
    <div class="strip" role="button" tabindex="0" onclick={stripClick} onkeydown={() => {}} aria-label="Chromosome {region.chrom}: click to move the window">
      <div class="strip-bar"></div>
      {#if centromere}<div class="strip-cen" style="left:{((centromere * 1e6) / chromLen) * 100}%"></div>{/if}
      <div class="strip-view" style="left:{stripLeft}%;width:{stripWidth}%"></div>
      <div class="strip-label" style="left:0">chr{region.chrom} p</div>
      <div class="strip-label" style="right:0">q {(chromLen / 1e6).toFixed(1)} Mb</div>
    </div>
  </div>

  <div class="board">
    <div class="tracks-wrap">
      <div class="panel" style="padding:0;overflow:hidden">
        <div bind:this={host}></div>
        {#each missing as m (m.role)}
          <div class="missing">
            <div class="label">
              <span style={markSwatch(m.kind) + ';opacity:.5'}></span>
              <div>
                <div style="font-size:13px;color:var(--color-neutral-400)">{m.title}</div>
                <div style="font-size:10px;color:var(--color-neutral-500)">{EVIDENCE_KINDS[m.kind].short} · no pack installed</div>
              </div>
            </div>
            <div style="display:flex;align-items:center;padding-left:var(--space-6);font-size:12px;color:var(--color-neutral-500)">
              Install a pack to join reference knowledge here.&nbsp;<a href="#/packs">Browse Pack Index</a>
            </div>
          </div>
        {/each}
        <div class="legend">
          <span><span class="mk-call"></span>Call</span>
          <span><span class="mk-nocall"></span>No-call</span>
          <span><span class="mk-ambig"></span>Strand-ambiguous</span>
          <span><span class="mk-classification" style="width:10px;height:10px"></span>Classification</span>
          <span><span class="mk-association" style="width:12px;height:12px"></span>Association</span>
          <span><span class="mk-frequency" style="width:8px;height:10px"></span>Population frequency</span>
          <span><span class="mk-estimate" style="margin:0"></span>Estimated bounds</span>
          <span style="margin-left:auto">view-tracks 0.1 · Arrow from DuckDB · drag to pan, scroll to zoom</span>
        </div>
      </div>
    </div>

    {#if sel}
      <DetailDock {kit} chrom={sel.chrom} pos={sel.pos} onclose={() => go(`genome/${region.chrom}:${region.start}-${region.end}`, true)} />
    {:else}
      <div class="hint">
        <span class="faint">Click a mark in any track, or a row below, to see what every installed pack says about that position.</span>
        {#if !kit}<a class="btn btn-secondary" href="#/import">Import a raw data file</a>{/if}
      </div>
    {/if}

    <details class="calls" open={!sel}>
      <summary>
        Calls in view{callCount == null ? '' : ` · ${callCount > 5000 ? 'over 5,000' : fmtInt(callCount)}`}
      </summary>
      {#if calls.length === 0}
        <p class="faint" style="font-size:12px;margin:var(--space-3) var(--space-6)">
          {callCount === 0 ? 'The chip has no probes in this window.' : kit ? 'Reading…' : 'No kit imported yet.'}
        </p>
      {:else}
        <div style="padding:0 var(--space-6) var(--space-4)">
          <table class="table">
            <thead><tr><th>Position</th><th>rsID</th><th>Ref</th><th>Call</th><th>State</th></tr></thead>
            <tbody>
              {#each calls as c (c.pos + c.rsid)}
                <tr class:sel={sel?.pos === c.pos && sel?.chrom === c.chrom} onclick={() => select(c.chrom, c.pos)}>
                  <td class="num" style="color:var(--color-neutral-300)">{fmtInt(c.pos)}</td>
                  <td>{c.rsid}</td>
                  <td class="muted">{c.ref ?? '—'}</td>
                  <td class="mono-allele">{formatCall(c)}</td>
                  <td class="muted" style="font-size:12px">
                    {c.is_nocall ? 'No-call' : c.strand_ambiguous ? 'Strand-ambiguous' : c.ref_check === 'complement-only' ? 'Probable strand flip' : 'Measured'}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
          {#if (callCount ?? 0) > calls.length}
            <p class="faint num" style="font-size:11px;margin:var(--space-3) 0 0">Showing the first {calls.length}; zoom in to list the rest.</p>
          {/if}
        </div>
      {/if}
    </details>
  </div>
</div>

<style>
  .genome { display: flex; flex-direction: column; min-height: 100%; }
  .toolbar { padding: var(--space-4) var(--space-8); border-bottom: 1px solid var(--color-divider); display: flex; align-items: center; gap: var(--space-6); flex-wrap: wrap; }
  .chips { padding: var(--space-3) var(--space-8); border-bottom: 1px solid var(--color-divider); display: flex; align-items: center; gap: var(--space-3); }
  .chip { flex: 1; min-width: 0; padding: 4px 0; border: 0; cursor: pointer; font-size: 10px; border-radius: 3px; background: var(--color-neutral-900); color: var(--color-neutral-400); }
  .chip:hover { color: var(--color-text); }
  .chip.active { background: var(--color-accent-800); color: var(--color-accent-100); }
  .linkish { border: 0; background: transparent; color: var(--color-accent); cursor: pointer; font: inherit; padding: 0; text-decoration: underline; text-underline-offset: 3px; }
  .strip { position: relative; height: 30px; margin-bottom: var(--space-3); cursor: pointer; }
  .strip-bar { position: absolute; left: 0; right: 0; top: 14px; height: 9px; border-radius: 2px; background: repeating-linear-gradient(to right, var(--color-neutral-700) 0 1px, transparent 1px 5px), var(--color-neutral-900); }
  .strip-cen { position: absolute; top: 12px; width: 4px; height: 13px; margin-left: -2px; background: var(--color-bg); box-shadow: inset 0 0 0 1px var(--color-neutral-700); }
  .strip-view { position: absolute; top: 8px; height: 21px; min-width: 2px; background: color-mix(in srgb, var(--color-accent-400) 25%, transparent); box-shadow: inset 0 0 0 1px var(--color-accent-400); border-radius: 1px; }
  .strip-label { position: absolute; top: 0; font-size: 10px; color: var(--color-neutral-500); }
  .board { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; }
  .tracks-wrap { padding: 0 var(--space-8) var(--space-3); }
  .hint { display: flex; align-items: center; gap: var(--space-4); padding: var(--space-4) var(--space-8); border-top: 1px solid var(--color-divider); font-size: 13px; }
  .calls { border-top: 1px solid var(--color-divider); }
  .calls > summary { padding: var(--space-3) var(--space-6); font-size: 12px; color: var(--color-neutral-400); cursor: pointer; }
  .calls > summary:hover { color: var(--color-text); }
  .missing { display: grid; grid-template-columns: 176px 1fr; border-top: 1px solid var(--color-divider); min-height: 46px; }
  .missing .label { padding: 10px 16px; border-right: 1px solid var(--color-divider); display: flex; gap: 8px; align-items: flex-start; }
  @media (max-width: 1100px) {
    .chips { overflow-x: auto; }
    .chip { min-width: 22px; }
    .tracks-wrap { padding: 0 16px var(--space-3); }
  }
</style>
