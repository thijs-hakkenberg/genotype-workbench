<script lang="ts">
  import type { Chrom } from '@gw/plugin-sdk';
  import { REF_CHECK_LABELS, formatCall, type CallRow, type Kit } from '@gw/genotype-store';
  import { GNOMAD_GROUPS, relateAllele, type Annotations, type GnomadRow } from '@gw/annotation-library';
  import { app, svc } from '../services.svelte';
  import { fmtDate, fmtInt, fmtP } from '../format';

  let { kit, chrom, pos }: { kit: Kit | null; chrom: Chrom; pos: number } = $props();

  let call = $state<CallRow | null>(null);
  let ann = $state<Annotations | null>(null);
  let loading = $state(true);
  let copied = $state(false);
  let showAllGwas = $state(false);

  $effect(() => {
    const k = kit;
    const c = chrom;
    const p = pos;
    loading = true;
    showAllGwas = false;
    const { store, library } = svc();
    void Promise.all([k ? store.callAt(k.kitId, c, p) : Promise.resolve(null), library.annotationsAt(c, p)]).then(([cr, a]) => {
      if (c !== chrom || p !== pos) return;
      call = cr;
      ann = a;
      loading = false;
    });
  });

  const pack = (id: string) => app.installed.find((p) => p.manifest.id === id)?.manifest;
  const ref = $derived(call?.ref ?? ann?.clinvar[0]?.ref ?? ann?.gnomad[0]?.ref ?? null);
  const alt = $derived.by(() => {
    const fromCall = [call?.a1, call?.a2].find((a) => a && ref && a !== ref && 'ACGT'.includes(a));
    return fromCall ?? ann?.clinvar[0]?.alt ?? ann?.gnomad[0]?.alt ?? null;
  });
  const key = $derived(ref ? `GRCh37:${chrom}:${pos}:${ref}${alt ? `:${alt}` : ''}` : `GRCh37:${chrom}:${pos}`);
  const rsid = $derived(call?.rsid ?? ann?.clinvar.find((c) => c.rsid)?.rsid ?? ann?.gwas[0]?.rsid ?? null);
  const siteAlleles = $derived([ref, ...(ann?.clinvar.map((c) => c.alt) ?? []), ...(ann?.gnomad.map((g) => g.alt) ?? [])]);
  const gwasShown = $derived(showAllGwas ? (ann?.gwas ?? []) : (ann?.gwas.slice(0, 4) ?? []));
  const nothingKnown = $derived(
    ann && !ann.clinvar.length && !ann.gwas.length && !ann.gnomad.length && !ann.genes.length,
  );

  const carries = (allele: string) => {
    if (!call || call.is_nocall) return null;
    return [call.a1, call.a2].filter((a) => a === allele).length;
  };
  const copiesText = (n: number | null, allele: string) =>
    n == null ? 'No call here' : n === 0 ? `Your call does not carry ${allele}` : `Your call carries ${allele} on ${n === 2 ? 'both copies' : call?.a2 ? 'one copy' : 'its one copy'}`;
  const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(Math.max(0, 4 - n));
  const vcv = (id: number) => `VCV${String(id).padStart(9, '0')}`;

  async function copyKey() {
    await navigator.clipboard.writeText(key);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }

  function gnomadBand(g: GnomadRow) {
    return { left: g.af_lo * 100, width: Math.max(0.6, (g.af_hi - g.af_lo) * 100), tick: g.af * 100 };
  }
</script>

<div class="card-kicker">Selected</div>
<h4 style="margin:6px 0 2px">{rsid ?? `chr${chrom}:${fmtInt(pos)}`}</h4>
<div class="faint num" style="font-size:11px">GRCh37 chr{chrom}:{fmtInt(pos)}{ref ? ` · reference ${ref}` : ''}{ann?.genes.length ? ` · ${ann.genes.map((g) => g.symbol).join(', ')}` : ''}</div>

{#if loading && !ann}
  <p class="faint" style="font-size:12px;margin-top:var(--space-6)">Reading…</p>
{:else}
  <div class="evidence" style="margin:var(--space-6) 0 var(--space-4)">
    <span class={call?.is_nocall ? 'mk-nocall' : call?.strand_ambiguous ? 'mk-ambig' : 'mk-measured'} style={call?.is_nocall || call?.strand_ambiguous ? 'width:12px;height:12px' : ''}></span>
    <div>
      <div class="what" style="margin:0">Your call · measured</div>
      <div class="mono-allele" style="font-size:22px;font-family:var(--font-heading)">{call ? formatCall(call) : 'Not on this chip'}</div>
    </div>
  </div>

  <div class="kv" style="font-size:12px">
    <div><span>Locus key</span><span class="num" style="font-size:11px">{key}</span></div>
    {#if call}
      <div><span>Strand</span><span>Plus</span></div>
      <div><span>Ambiguous</span><span>{call.strand_ambiguous ? 'Yes — A/T or C/G' : 'No'}</span></div>
      <div><span>Reference check</span><span>{REF_CHECK_LABELS[call.ref_check]}</span></div>
      {#if call.a1 && ref && call.a1 !== ref && !call.is_nocall}
        <div><span>Compared with GRCh37</span><span>Differs from the GRCh37 reference</span></div>
      {/if}
      <div><span>Source</span><span>{kit?.vendorLabel} {kit?.chipVersion ?? ''}</span></div>
      <div><span>Normalizer</span><span>locus {kit?.locusVersion}</span></div>
    {/if}
  </div>

  <div style="display:flex;flex-direction:column;gap:var(--space-3);margin-top:var(--space-6)">
    {#each ann?.genes ?? [] as g (g.gene_id)}
      <div class="evidence">
        <span class="mk mk-documentary"></span>
        <div>
          <div class="title">{g.symbol} <span class="faint" style="font-size:11px">{g.biotype.replaceAll('_', ' ')} · {g.strand === '-' ? 'minus' : 'plus'} strand</span></div>
          <div class="what">This position lies inside the gene's span ({fmtInt(g.start)}–{fmtInt(g.end)}), transcript {g.transcript_name ?? g.transcript_id}.</div>
          <div class="cite">{g.gene_id} · pack genes-ensembl75 · {pack('genes-ensembl75')?.licence}</div>
        </div>
      </div>
    {/each}

    {#each ann?.clinvar ?? [] as c (c.variation_id + c.alt)}
      <div class="evidence classification">
        <span class="mk mk-classification"></span>
        <div>
          <div class="title">ClinVar classification: {c.classification}</div>
          <div class="what">
            {c.ref}&gt;{c.alt}{c.conditions.length ? ` · ${c.conditions.slice(0, 3).join('; ')}${c.conditions.length > 3 ? ` +${c.conditions.length - 3}` : ''}` : ''}
          </div>
          <div class="what">{copiesText(carries(c.alt), c.alt)}{call?.strand_ambiguous ? ' — strand-ambiguous call, joined with lower confidence' : ''}</div>
          <div class="cite">
            <span title="ClinVar review status">{stars(c.stars)}</span> {c.review_status ?? ''}<br />
            {vcv(c.variation_id)} · pack clinvar {pack('clinvar')?.version} · {pack('clinvar')?.licence}
          </div>
        </div>
      </div>
    {/each}

    {#each ann?.gnomad ?? [] as g (g.alt)}
      {@const band = gnomadBand(g)}
      <div class="evidence">
        <span class="mk mk-estimate"></span>
        <div style="flex:1;min-width:0">
          <div class="title num">Allele frequency, {g.alt}: {g.af.toFixed(3)} ({g.af_lo.toFixed(3)}–{g.af_hi.toFixed(3)}, all gnomAD genomes)</div>
          <div class="bar-est" style="margin:var(--space-2) 0">
            <span class="band" style="left:{band.left}%;width:{band.width}%"></span>
            <span class="tick" style="left:{band.tick}%"></span>
          </div>
          <div class="what">Sampling-dependent — frequency varies by reference panel. {copiesText(carries(g.alt), g.alt)}.</div>
          <details class="what">
            <summary>By genetic-ancestry group</summary>
            <div class="kv num" style="font-size:11px;gap:2px;margin-top:4px">
              {#each GNOMAD_GROUPS as grp (grp.key)}
                {#if g[grp.key] != null}<div><span>{grp.label}</span><span>{(g[grp.key] as number).toFixed(3)}</span></div>{/if}
              {/each}
            </div>
          </details>
          <div class="cite">AC {fmtInt(g.ac)} / AN {fmtInt(g.an)} · gnomAD v2.1.1 · pack gnomad-chip · {pack('gnomad-chip')?.licence}</div>
        </div>
      </div>
    {/each}

    {#each gwasShown as a (a.study_accession + a.trait + a.p_text + a.pubmed_id)}
      {@const rel = a.risk_allele ? relateAllele(a.risk_allele, call, siteAlleles) : null}
      <div class="evidence">
        <span class="mk mk-association"></span>
        <div>
          <div class="title">Associated with {a.trait}</div>
          <div class="what">
            p = {fmtP(a.p_value, a.p_mlog)}{a.effect != null ? ` · ${a.effect_kind === 'beta' ? 'β' : 'odds ratio'} ${a.effect}` : ''}{a.p_text ? ` ${a.p_text}` : ''}
            {#if a.initial_sample}<br />Study population: {a.initial_sample}{/if}
          </div>
          {#if rel}
            <div class="what">
              Reported allele {a.risk_allele}{rel.basis === 'complement' ? ` (${rel.plus} on the plus strand)` : ''}{rel.basis === 'ambiguous' ? ' — A/T or C/G site, strand cannot be inferred' : ''}{rel.basis === 'unplaced' ? ' — fits neither strand at this site' : ''}.
              {#if rel.basis !== 'ambiguous' && rel.basis !== 'unplaced'}{copiesText(rel.copies, rel.plus)}.{/if}
            </div>
          {/if}
          <div class="what">GWAS Catalog · population-level association, not a statement about you</div>
          <div class="cite">{a.first_author} {a.pub_date?.slice(0, 4)} · PMID {a.pubmed_id} · {a.study_accession} · pack gwas-catalog {pack('gwas-catalog')?.version} · CC0</div>
        </div>
      </div>
    {/each}
    {#if (ann?.gwas.length ?? 0) > 4}
      <button class="btn btn-ghost" type="button" onclick={() => (showAllGwas = !showAllGwas)}>
        {showAllGwas ? 'Show fewer associations' : `Show all ${ann?.gwas.length} associations`}
      </button>
    {/if}

    {#if nothingKnown}
      <div class="evidence empty">
        <div>
          <div class="title" style="color:var(--color-neutral-300)">Nothing is known about this position in your installed packs</div>
          <div class="what">
            {app.installed.filter((p) => !p.manifest.core).length === 0
              ? 'Classifications, frequencies and associations arrive with packs, each with its citation.'
              : 'None of the installed packs has a record at this position.'}
            <a href="#/packs">Browse Pack Index</a>
          </div>
        </div>
      </div>
    {/if}
  </div>

  <div style="display:flex;flex-direction:column;gap:var(--space-2);margin-top:var(--space-4)">
    <button class="btn btn-secondary btn-block" type="button" style="margin:0" onclick={copyKey}>{copied ? 'Copied' : 'Copy locus key'}</button>
  </div>
  {#if kit}
    <p class="faint" style="font-size:10px;margin-top:var(--space-4)">Kit imported {fmtDate(kit.importedAt)} · {kit.importer}</p>
  {/if}
{/if}
