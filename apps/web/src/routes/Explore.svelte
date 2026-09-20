<script lang="ts">
  /**
   * Where to start, drawn from what the installed packs say about this kit.
   * Every list is ordered by how well established its evidence is — review
   * status, p-value, frequency — never by how important it might be for you.
   */
  import { viewName } from '@gw/genotype-store';
  import { consequenceOf, type Consequence } from '@gw/protein';
  import { relateAllele, type ClinvarForKitRow, type FrequencyRow, type GeneRow, type GwasRow } from '@gw/annotation-library';
  import { activeKit, app, svc } from '../lib/services.svelte';
  import { go, route } from '../lib/router.svelte';
  import { fmtInt, fmtP } from '../lib/format';

  const kit = $derived(activeKit());
  const has = (role: string) => app.installed.some((p) => p.manifest.role === role);

  let clinvar = $state<ClinvarForKitRow[] | null>(null);
  let associations = $state<(GwasRow & { a1: string; a2: string | null; ref: string | null })[] | null>(null);
  let rare = $state<(FrequencyRow & { a1: string; a2: string | null; rsid: string })[] | null>(null);
  let genes = $state<(GeneRow & { calls: number })[]>([]);
  let geneQuery = $state('');

  type Coding = { pos: number; chrom: string; rsid: string; symbol: string; consequence: Consequence };
  let coding = $state<Coding[] | null>(null);
  let codingState = $state<'idle' | 'scanning' | 'done'>('idle');
  let codingNote = $state('');

  $effect(() => {
    const k = kit;
    void app.installed.length;
    clinvar = associations = rare = null;
    if (!k) return;
    const view = viewName(k.kitId);
    const { library } = svc();
    void library.clinvarForKit(view, null, 25).then((r) => (clinvar = r));
    void library.topAssociationsForKit(view, 25).then((r) => (associations = r));
    void library.rarestAllelesForKit(view, 0.02, 25).then((r) => (rare = r));
  });

  $effect(() => {
    const q = geneQuery.trim();
    const k = kit;
    if (q.length < 2) {
      genes = [];
      return;
    }
    void svc().library.genesWithCalls(k ? viewName(k.kitId) : null, q).then((g) => (genes = g));
  });

  /** Translating every coding call takes a moment, so it runs on request. */
  async function scanCoding() {
    const k = kit;
    if (!k) return;
    codingState = 'scanning';
    codingNote = '';
    try {
      const { candidates, sequence, total } = await svc().library.codingCandidates(viewName(k.kitId));
      const out: Coding[] = [];
      for (const c of candidates) {
        const alt = [c.a1, c.a2].find((a) => a && a !== c.ref && 'ACGT'.includes(a));
        if (!alt) continue;
        const consequence = consequenceOf(c, sequence, c.pos, alt);
        if (consequence && consequence.kind !== 'synonymous') out.push({ pos: c.pos, chrom: c.chrom, rsid: c.rsid, symbol: c.symbol, consequence });
      }
      const rank = { nonsense: 0, 'stop-lost': 1, 'start-lost': 2, missense: 3, synonymous: 4, unknown: 5 } as const;
      out.sort((a, b) => rank[a.consequence.kind] - rank[b.consequence.kind] || a.symbol.localeCompare(b.symbol));
      coding = out;
      const capped = candidates.length < total ? ` Scanned the first ${fmtInt(candidates.length)}.` : '';
      codingNote = `${fmtInt(total)} of your calls sit in a coding block and differ from the reference;`
        + ` ${fmtInt(out.length)} of those scanned change an amino acid, the rest are synonymous.${capped}`;
    } catch (e) {
      codingNote = e instanceof Error ? e.message : String(e);
    } finally {
      codingState = 'done';
    }
  }

  const open = (chrom: string, pos: number, pad = 60) => go(`genome/${chrom}:${pos - pad}-${pos + pad}?sel=${chrom}:${pos}`);
  const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(Math.max(0, 4 - n));
  const pct = (v: number) => `${(v * 100).toFixed(v < 0.01 ? 2 : 1)}%`;
  const copies = (a1: string, a2: string | null, allele: string) => [a1, a2].filter((a) => a === allele).length;

  $effect(() => {
    if (route.params.get('scan') === 'coding' && codingState === 'idle' && kit) void scanCoding();
  });
</script>

<div class="page">
  <div class="page-head">
    <div style="max-width:760px">
      <div class="card-kicker">Explore</div>
      <h2>Where to start</h2>
      <div class="sub">
        Built from what your installed packs say about your own calls. Each list is ordered by how well established the
        evidence is — ClinVar's review status, a study's p-value, how common an allele is — never by how important it
        might be for you. Nothing here is a diagnosis or a risk estimate.
      </div>
    </div>
  </div>

  {#if !kit}
    <p class="muted">Import a kit first. <a href="#/import">Import a raw data file</a></p>
  {:else}
    <div class="grid-2">
      <section class="panel">
        <div class="card-kicker">Best-reviewed ClinVar records for your calls</div>
        <h4>Best review status first{clinvar && clinvar.length > 12 ? ` · 12 of ${fmtInt(clinvar.length)}` : ''}</h4>
        {#if !has('classification')}
          <p class="notice">Install the ClinVar pack. <a href="#/packs">Packs</a></p>
        {:else if !clinvar}
          <p class="faint">Joining on this device…</p>
        {:else}
          <table class="table">
            <tbody>
              {#each clinvar.slice(0, 12) as r, i (r.variation_id + r.alt + i)}
                <tr onclick={() => open(r.chrom, r.pos)}>
                  <td style="width:70px" class="faint">{stars(r.stars)}</td>
                  <td>{r.classification}<div class="faint" style="font-size:11px">{r.conditions.slice(0, 2).join('; ') || '—'}</div></td>
                  <td class="num" style="text-align:right;white-space:nowrap">
                    {r.rsid ?? `chr${r.chrom}:${fmtInt(r.pos)}`}
                    <div class="faint mono-allele" style="font-size:11px">{r.a1}{r.a2 ? `/${r.a2}` : ''}</div>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
          <a class="btn btn-ghost" href="#/clinvar">All ClinVar records for your calls</a>
        {/if}
      </section>

      <section class="panel">
        <div class="card-kicker">Strongest associations you carry an allele for</div>
        <h4>Smallest p-value first{associations && associations.length > 12 ? ` · 12 of ${fmtInt(associations.length)}` : ''}</h4>
        {#if !has('association')}
          <p class="notice">Install the GWAS Catalog pack. <a href="#/packs">Packs</a></p>
        {:else if !associations}
          <p class="faint">Joining on this device…</p>
        {:else}
          <table class="table">
            <tbody>
              {#each associations.slice(0, 12) as a, i (a.study_accession + a.trait + a.pos + i)}
                {@const rel = a.risk_allele ? relateAllele(a.risk_allele, { a1: a.a1, a2: a.a2, is_nocall: false }, [a.ref]) : null}
                <tr onclick={() => open(a.chrom, a.pos)}>
                  <td>{a.trait}<div class="faint" style="font-size:11px">{a.first_author} {a.pub_date?.slice(0, 4)}</div></td>
                  <td class="num" style="text-align:right;white-space:nowrap">
                    p = {fmtP(a.p_value, a.p_mlog)}
                    <div class="faint" style="font-size:11px">{rel ? `${rel.plus} × ${rel.copies ?? 0}` : ''}</div>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
          <p class="notice" style="margin:var(--space-3) 0 0">Population-level associations, not statements about you.</p>
        {/if}
      </section>

      <section class="panel">
        <div class="card-kicker">Rarest alleles you carry</div>
        <h4>Under 2% in {app.installed.find((p) => p.manifest.role === 'frequency')?.manifest.source.short ?? 'the frequency pack'}{rare && rare.length > 12 ? ` · 12 of ${fmtInt(rare.length)}` : ''}</h4>
        {#if !has('frequency')}
          <p class="notice">Install a frequency pack. <a href="#/packs">Packs</a></p>
        {:else if !rare}
          <p class="faint">Joining on this device…</p>
        {:else}
          <table class="table">
            <tbody>
              {#each rare.slice(0, 12) as r, i (r.pos + r.alt + i)}
                <tr onclick={() => open(r.chrom, r.pos)}>
                  <td class="num">{r.rsid || `chr${r.chrom}:${fmtInt(r.pos)}`}</td>
                  <td class="mono-allele">{r.ref}&gt;{r.alt} <span class="faint" style="font-size:11px">{copies(r.a1, r.a2, r.alt) === 2 ? 'both copies' : 'one copy'}</span></td>
                  <td class="num" style="text-align:right">{pct(r.af)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
          <p class="notice" style="margin:var(--space-3) 0 0">
            Rare is not the same as harmful: most rare alleles do nothing in particular. A chip also mis-reads rare
            positions more often than common ones, so a single rare call is weak evidence on its own.
          </p>
        {/if}
      </section>

      <section class="panel">
        <div class="card-kicker">Coding changes in your calls</div>
        <h4>{coding ? `${fmtInt(coding.length)} change an amino acid` : 'Not scanned yet'}</h4>
        {#if !has('sequence') || !has('genes')}
          <p class="notice">Install the sequence and gene packs. <a href="#/packs">Packs</a></p>
        {:else if codingState === 'scanning'}
          <p class="faint">Translating every coding call on this device…</p>
        {:else}
          {#if !coding}
            <p class="notice" style="margin:0 0 var(--space-3)">
              Reads every call that sits in a coding block and differs from the reference, and translates it here. Takes a few seconds.
            </p>
            <button class="btn btn-primary" type="button" onclick={scanCoding}>Scan my calls</button>
          {:else}
            <table class="table">
              <tbody>
                {#each coding.slice(0, 12) as c, i (c.pos + c.symbol + i)}
                  <tr onclick={() => open(c.chrom, c.pos)}>
                    <td>{c.symbol} <span class="faint">{c.consequence.hgvsP}</span></td>
                    <td class="faint" style="font-size:11px">{c.consequence.kind.replace('-', ' ')}</td>
                    <td class="num faint" style="text-align:right;font-size:11px">{c.rsid}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
          {#if codingNote}<p class="faint" style="font-size:11px;margin-top:var(--space-3)">{codingNote}</p>{/if}
          {#if coding?.length}
            <p class="notice" style="margin:var(--space-3) 0 0">
              Stop changes are listed first because they are the largest change to a protein, not because they matter
              most to you. Chips mis-read rare positions relatively often, so treat a single call with care.
            </p>
          {/if}
        {/if}
      </section>
    </div>

    <section class="panel" style="margin-top:var(--space-3)">
      <div class="card-kicker">Browse by gene</div>
      <h4>Find a gene, see how many of your calls it covers</h4>
      <div class="field" style="max-width:420px">
        <input class="input" placeholder="MTHFR, LCT, BRCA1…" bind:value={geneQuery} aria-label="Search genes" />
      </div>
      {#if genes.length}
        <table class="table" style="margin-top:var(--space-3)">
          <thead><tr><th>Gene</th><th>Kind</th><th>Position</th><th style="text-align:right">Your calls</th></tr></thead>
          <tbody>
            {#each genes as g (g.gene_id)}
              <tr onclick={() => go(`genome/${g.chrom}:${g.start - 2000}-${g.end + 2000}`)}>
                <td>{g.symbol}<div class="faint" style="font-size:11px">{g.gene_id}</div></td>
                <td class="faint">{g.biotype.replaceAll('_', ' ')}</td>
                <td class="num faint">chr{g.chrom}:{fmtInt(g.start)}–{fmtInt(g.end)}</td>
                <td class="num" style="text-align:right">{fmtInt(g.calls)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else if geneQuery.trim().length >= 2}
        <p class="faint" style="margin-top:var(--space-3)">No gene matches “{geneQuery}”.</p>
      {/if}
    </section>
  {/if}
</div>
