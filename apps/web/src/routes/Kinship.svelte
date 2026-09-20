<script lang="ts">
  /**
   * Two kits, compared on this device.
   *
   * The page states what it is doing before it asks for anything, names both
   * people, and reports a list of relationships rather than one. Nothing here
   * is a conclusion about who anyone is.
   */
  import { onDestroy } from 'svelte';
  import type { TrackSource } from '@gw/plugin-sdk';
  import { PaintingView } from '@gw/view-painting';
  import { app, activeKit, compareKit, setCompareKit, svc } from '../lib/services.svelte';
  import { forgetKinship, kinshipFor, type KinshipRun } from '../lib/kinship';
  import { go } from '../lib/router.svelte';
  import { fmtInt } from '../lib/format';

  const kit = $derived(activeKit());
  const other = $derived(compareKit());
  const others = $derived(app.kits.filter((k) => k.kitId !== app.activeKitId));
  const hasMap = $derived(app.installed.some((p) => p.manifest.role === 'genetic-map'));

  let run = $state<KinshipRun | null>(null);
  let error = $state('');
  let running = $state(false);
  let host = $state<HTMLDivElement | null>(null);
  let view: PaintingView | null = null;

  async function compare() {
    const [a, b] = [kit, other];
    if (!a || !b) return;
    running = true;
    error = '';
    run = null;
    try {
      run = await kinshipFor(a, b);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      running = false;
    }
  }

  function retry() {
    if (kit && other) forgetKinship(kit, other);
    void compare();
  }

  /** The segments as a track the painting view can draw. */
  function tracks(): TrackSource[] {
    const segments = run?.result?.segments ?? [];
    return [
      {
        descriptor: {
          id: 'kinship:shared',
          kind: 'segment',
          build: 'GRCh37',
          source: 'analysis-kinship',
          version: '0.3.0',
          evidenceKind: 'probabilistic-estimate',
          title: `Shared with ${other?.label ?? ''}`,
          emptyMessage: 'No shared stretch long enough to report',
        },
        itemsIn: async (region) =>
          segments
            .filter((s) => s.chrom === region.chrom && s.end >= region.start && s.start <= region.end)
            .map((s) => ({
              id: `${s.chrom}:${s.start}-${s.end}`,
              start: s.start,
              end: s.end,
              label: `${s.cm.toFixed(1)} cM on chromosome ${s.chrom} · ${fmtInt(s.snps)} markers`,
              row: s,
            })),
      },
    ];
  }

  $effect(() => {
    if (!host) return;
    const t = tracks();
    if (!view) {
      view = new PaintingView(host, t, {
        // Only what was compared: autosomes. Drawing X empty beside full
        // autosomes would read as "nothing shared here", which is a finding
        // this analysis never made.
        chroms: AUTOSOMES,
        onSelect: (_d, item) => {
          const s = item.row as { chrom: string; start: number; end: number };
          go(`genome/${s.chrom}:${s.start}-${s.end}`);
        },
      });
    } else {
      view.setTracks(t);
    }
  });

  onDestroy(() => view?.destroy());

  // Comparing a different pair invalidates what is on screen.
  $effect(() => {
    void app.activeKitId;
    void app.compareKitId;
    run = null;
    error = '';
  });

  const AUTOSOMES = Array.from({ length: 22 }, (_, i) => String(i + 1));
  const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
</script>

<div class="page">
  <div class="page-head">
    <div style="max-width:760px">
      <div class="card-kicker">Analysis · kinship</div>
      <h2>Shared DNA</h2>
      <div class="sub">
        Compares two kits on this device to find the stretches where they match, and offers the relationships that much
        sharing is consistent with — always a list, because several relationships produce the same amount. Nothing is
        sent anywhere, and no kit is read without a consent record.
      </div>
    </div>
  </div>

  {#if !kit}
    <p class="muted">Import a kit first. <a href="#/import">Import a raw data file</a></p>
  {:else if others.length === 0}
    <div class="evidence empty">
      <div>
        <div class="title">Only one kit on this device</div>
        <div class="what">
          Shared segments need two people. Import a relative's file — with their consent recorded — and this page can
          compare them. <a href="#/import">Import a raw data file</a>
        </div>
      </div>
    </div>
  {:else}
    <section class="panel">
      <div class="card-kicker">Compare</div>
      <h4>{kit.label} with…</h4>
      <div style="display:flex;gap:var(--space-3);align-items:flex-end;flex-wrap:wrap">
        <div class="field" style="min-width:280px">
          <label for="compare-kit">Second kit</label>
          <select id="compare-kit" class="input" value={app.compareKitId ?? ''}
                  onchange={(e) => setCompareKit((e.target as HTMLSelectElement).value || null)}>
            <option value="">Choose a kit…</option>
            {#each others as k (k.kitId)}
              <option value={k.kitId}>
                {k.label} · {k.custody.dataSubject}{k.custody.consentBasis === 'none' ? ' — no consent recorded' : ''}
              </option>
            {/each}
          </select>
        </div>
        <button class="btn btn-primary" type="button" disabled={!other || running} onclick={compare}>
          {running ? 'Comparing…' : 'Compare on this device'}
        </button>
      </div>
      {#if other && other.custody.consentBasis === 'none'}
        <p class="notice" style="margin:var(--space-4) 0 0">
          No consent is recorded for {other.custody.dataSubject}'s kit, so no analysis may read it.
          <a href="#/kits">Record one</a>
        </p>
      {:else if !hasMap}
        <p class="notice" style="margin:var(--space-4) 0 0">
          No genetic map is installed, so segment lengths would be inferred from base pairs rather than measured in
          centimorgans. <a href="#/packs">Install the HapMap genetic map</a>
        </p>
      {/if}
    </section>

    {#if error}
      <div class="error-box" style="margin-top:var(--space-3)">{error}</div>
    {:else if run?.blocked}
      <div class="error-box" style="margin-top:var(--space-3)">
        {run.blocked}
        <button class="btn btn-ghost" type="button" onclick={retry}>Ask again</button>
      </div>
    {:else if run?.result}
      {@const r = run.result}
      <div class="grid-2" style="margin-top:var(--space-3)">
        <section class="panel">
          <div class="card-kicker">What they share</div>
          <h4>{r.totalCm.toFixed(0)} cM across {fmtInt(r.segments.length)} stretch{r.segments.length === 1 ? '' : 'es'}</h4>
          <div class="kv">
            <div><span>Longest stretch</span><span class="num">{r.longestCm.toFixed(1)} cM</span></div>
            <div><span>Positions compared</span><span class="num">{fmtInt(r.loci)}</span></div>
            <div>
              <span>Completely different</span>
              <span class="num">{pct(r.coefficient.ibs0Rate)}</span>
            </div>
            <div><span>Kinship coefficient</span><span class="num">{r.coefficient.phi.toFixed(4)}</span></div>
            <div>
              <span>Measured against</span>
              <span>{run.map ? `${run.map.source.short} ${run.map.version} · ${run.map.licence}` : 'base pairs (no genetic map)'}</span>
            </div>
          </div>
          <p class="notice" style="margin:var(--space-4) 0 0">
            Computed on this device by analysis-kinship {r.options.minCm} cM minimum · {fmtInt(r.options.minSnps)} markers
            minimum. Nothing about either kit was sent anywhere.
          </p>
        </section>

        <section class="panel">
          <div class="card-kicker">Consistent with</div>
          <h4>{r.candidates.length ? `${r.candidates.length} relationship${r.candidates.length === 1 ? '' : 's'}` : 'No close relationship'}</h4>
          {#if r.candidates.length}
            <table class="table">
              <tbody>
                {#each r.candidates as c, i (c.label + i)}
                  <tr>
                    <td>{c.label}</td>
                    <td class="faint" style="font-size:11px">degree {c.degree}</td>
                    <td class="num faint" style="text-align:right;white-space:nowrap">
                      {fmtInt(c.cmRange[0])}–{fmtInt(c.cmRange[1])} cM
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {:else}
            <p class="faint">
              These two share less than the closest band this analysis reports. That is what two unrelated people look
              like, and also what distant cousins look like: beyond about second cousins, shared DNA runs out before
              the relationship does.
            </p>
          {/if}
          <p class="notice" style="margin:var(--space-4) 0 0">
            A population-level estimate from shared DNA, not a statement about who anyone is. An estimate is proposed,
            never recorded as a fact.
          </p>
        </section>
      </div>

      <section class="panel" style="margin-top:var(--space-3)">
        <div class="card-kicker">Chromosome painting</div>
        <h4>Where the sharing sits</h4>
        <div class="sub" style="margin-bottom:var(--space-3)">
          Each bar is a chromosome, drawn to its GRCh37 length and pinched at the centromere. A square end is a boundary
          a mismatch proves; a faded end means the stretch ran out of chip and continues somewhere unknown. Click a
          stretch to open it in the genome view.
        </div>
        <p class="notice" style="margin:0 0 var(--space-4)">
          Autosomes only. A shared stretch on the X chromosome means something different depending on each person's sex,
          and the Y and mitochondrial chromosomes do not recombine at all, so none of them belongs in a centimorgan
          total. The <a href="#/lineages">Lineages</a> page reads those instead.
        </p>
        <div bind:this={host}></div>
        {#if !r.segments.length}
          <p class="faint" style="margin-top:var(--space-3)">No stretch long enough to report.</p>
        {/if}
      </section>

      <section class="panel" style="margin-top:var(--space-3)">
        <div class="card-kicker">What this cannot tell you</div>
        <ul style="margin:var(--space-3) 0 0;padding-left:1.1em;line-height:1.7">
          {#each r.notes as note, i (i)}
            <li class="faint">{note}</li>
          {/each}
        </ul>
      </section>
    {/if}
  {/if}
</div>
