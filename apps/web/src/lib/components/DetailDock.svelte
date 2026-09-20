<script lang="ts">
  /**
   * What every installed pack says about the selected position, laid out
   * across the width under the tracks: the call, the classification, the
   * frequency and the protein side by side, studies below.
   */
  import type { Chrom, PackManifest } from '@gw/plugin-sdk';
  import { REF_CHECK_LABELS, formatCall, type CallRow, type Kit } from '@gw/genotype-store';
  import { pickTranscript, relateAllele, type Annotations, type FrequencyRow, type ProteinRow } from '@gw/annotation-library';
  import { CONSEQUENCE_WORDS, consequenceOf, type Consequence } from '@gw/protein';
  import { app, svc } from '../services.svelte';
  import { fmtInt, fmtP } from '../format';
  import StructurePanel from './StructurePanel.svelte';

  let { kit, chrom, pos, onclose }: { kit: Kit | null; chrom: Chrom; pos: number; onclose?: () => void } = $props();

  let call = $state<CallRow | null>(null);
  let ann = $state<Annotations | null>(null);
  let loading = $state(true);
  let failed = $state('');
  let copied = $state(false);
  let showAllGwas = $state(false);
  let coding = $state<{ consequence: Consequence | null; symbol: string; transcriptName: string | null; protein: ProteinRow | null; altBase: string | null } | null>(null);

  $effect(() => {
    const k = kit;
    const c = chrom;
    const p = pos;
    loading = true;
    failed = '';
    showAllGwas = false;
    const { store, library } = svc();
    void (async () => {
      try {
        const cr = k ? await store.callAt(k.kitId, c, p) : null;
        const a = await library.annotationsAt(c, p, cr?.rsid ? [cr.rsid] : []);
        if (c !== chrom || p !== pos) return;
        call = cr;
        ann = a;
      } catch (e) {
        console.error(e);
        if (c === chrom && p === pos) failed = e instanceof Error ? e.message : String(e);
      } finally {
        if (c === chrom && p === pos) loading = false;
      }
    })();
  });

  $effect(() => {
    const c = chrom;
    const p = pos;
    const want = callForCoding;
    coding = null;
    const { library } = svc();
    void (async () => {
      const genes = await library.codingTranscriptsAt(c, p);
      const tx = pickTranscript(genes);
      if (!tx) return;
      const sequence = await library.sequenceIn({ chrom: c, start: p - 3000, end: p + 3000 });
      if (!sequence) return;
      const protein = await library.proteinFor(tx.transcript_id, tx.symbol);
      const consequence = want.alt ? consequenceOf(tx, sequence, p, want.alt) : null;
      if (c !== chrom || p !== pos) return;
      coding = { consequence, symbol: tx.symbol, transcriptName: tx.transcript_name ?? null, protein, altBase: want.alt };
    })();
  });

  const packOf = (role: string) => app.installed.find((p) => p.manifest.role === role)?.manifest;
  const ref = $derived(call?.ref ?? ann?.clinvar[0]?.ref ?? ann?.frequencies[0]?.rows[0]?.ref ?? null);
  const callForCoding = $derived.by(() => {
    const alt = [call?.a1, call?.a2].find((a) => a && ref && a !== ref && 'ACGT'.includes(a));
    return { alt: alt ?? ann?.clinvar[0]?.alt ?? null };
  });
  const alt = $derived(callForCoding.alt);
  const key = $derived(ref ? `GRCh37:${chrom}:${pos}:${ref}${alt ? `:${alt}` : ''}` : `GRCh37:${chrom}:${pos}`);
  const rsid = $derived(call?.rsid ?? ann?.clinvar.find((c) => c.rsid)?.rsid ?? ann?.gwas[0]?.rsid ?? null);
  const siteAlleles = $derived([ref, ...(ann?.clinvar.map((c) => c.alt) ?? []), ...(ann?.frequencies.flatMap((f) => f.rows.map((r) => r.alt)) ?? [])]);
  const gwasShown = $derived(showAllGwas ? (ann?.gwas ?? []) : (ann?.gwas.slice(0, 3) ?? []));
  const nothingKnown = $derived(ann && !ann.clinvar.length && !ann.gwas.length && !ann.frequencies.length && !ann.genes.length);

  const carries = (allele: string) => {
    if (!call || call.is_nocall) return null;
    return [call.a1, call.a2].filter((a) => a === allele).length;
  };
  const copiesText = (n: number | null, allele: string) =>
    n == null ? 'No call here' : n === 0 ? `Your call does not carry ${allele}` : `Your call carries ${allele} on ${n === 2 ? 'both copies' : call?.a2 ? 'one copy' : 'its one copy'}`;
  const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(Math.max(0, 4 - n));
  const vcv = (id: number) => `VCV${String(id).padStart(9, '0')}`;
  const pct = (v: number) => `${(v * 100).toFixed(v < 0.01 ? 2 : 1)}%`;

  async function copyKey() {
    await navigator.clipboard.writeText(key);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }
</script>

<div class="dock">
  <div class="dock-head">
    <span class={call?.is_nocall ? 'mk-nocall' : call?.strand_ambiguous ? 'mk-ambig' : 'mk-measured'} style="width:12px;height:12px;flex:none"></span>
    <h4 style="margin:0">{rsid ?? `chr${chrom}:${fmtInt(pos)}`}</h4>
    <span class="mono-allele" style="font-size:18px">{call ? formatCall(call) : 'Not on this chip'}</span>
    <span class="faint num" style="font-size:11px">chr{chrom}:{fmtInt(pos)}{ref ? ` · reference ${ref}` : ''}</span>
    {#if coding?.consequence}
      <span class="tag tag-neutral">{coding.symbol} {coding.consequence.hgvsP}</span>
    {:else if ann?.genes.length}
      <span class="tag tag-neutral">{ann.genes.map((g) => g.symbol).join(', ')}</span>
    {/if}
    {#if ann?.clinvar.length}<span class="tag tag-outline">ClinVar {stars(ann.clinvar[0]!.stars)}</span>{/if}
    <div style="margin-left:auto;display:flex;gap:var(--space-2);align-items:center">
      <button class="btn btn-ghost" type="button" onclick={copyKey}>{copied ? 'Copied' : 'Copy locus key'}</button>
      {#if onclose}<button class="btn btn-ghost" type="button" onclick={onclose} aria-label="Close details">Close</button>{/if}
    </div>
  </div>

  {#if failed}
    <div class="error-box" style="margin:var(--space-4)">Could not read this position: {failed}</div>
  {:else if loading && !ann}
    <p class="faint" style="font-size:12px;padding:var(--space-4)">Reading…</p>
  {:else}
    <div class="cards">
      <section class="card-plain">
        <div class="card-kicker">Your call · measured</div>
        <div class="mono-allele" style="font-size:26px;font-family:var(--font-heading);margin:var(--space-2) 0">{call ? formatCall(call) : '—'}</div>
        <div class="kv" style="font-size:12px">
          <div><span>Locus key</span><span class="num" style="font-size:11px">{key}</span></div>
          {#if call}
            <div><span>Strand</span><span>Plus</span></div>
            <div><span>Ambiguous</span><span>{call.strand_ambiguous ? 'Yes — A/T or C/G' : 'No'}</span></div>
            <div><span>Reference check</span><span>{REF_CHECK_LABELS[call.ref_check]}</span></div>
            <div><span>Source</span><span>{kit?.vendorLabel} {kit?.chipVersion ?? ''} · locus {kit?.locusVersion}</span></div>
          {/if}
          {#if ann?.geneticMap}
            <div><span>Genetic position</span><span class="num">{ann.geneticMap.cm.toFixed(2)} cM · {ann.geneticMap.pack.source.short}</span></div>
          {/if}
          {#each ann?.merges ?? [] as mg (mg.old_rsid + mg.new_rsid)}
            <div><span>dbSNP</span><span>{mg.old_rsid} → {mg.new_rsid}{mg.build ? ` (build ${mg.build})` : ''}</span></div>
          {/each}
        </div>
        {#each ann?.genes ?? [] as g (g.gene_id)}
          <div class="faint" style="font-size:11px;margin-top:var(--space-3)">
            In {g.symbol} ({g.biotype.replaceAll('_', ' ')}, {g.strand === '-' ? 'minus' : 'plus'} strand), transcript {g.transcript_name ?? g.transcript_id} · {packOf('genes')?.source.short}
          </div>
        {/each}
      </section>

      {#if ann?.clinvar.length}
        <section class="card-plain classification">
          <div class="card-kicker">ClinVar · curated classification</div>
          {#each ann.clinvar as c, ci (c.variation_id + c.alt + ci)}
            <div style="margin-top:var(--space-3)">
              <div style="font-size:13px">{c.classification} <span class="faint">{c.ref}&gt;{c.alt}</span></div>
              <div class="faint" style="font-size:11px">{copiesText(carries(c.alt), c.alt)}</div>
              {#each c.conditions.slice(0, 6) as name, i (name + i)}
                {@const mondo = c.condition_mondo?.[i] ? ann?.conditions[c.condition_mondo[i]!] : undefined}
                <details class="cond"><summary>{mondo?.name ?? name}</summary>
                  {#if mondo?.definition}<div>{mondo.definition}</div>{/if}
                  <div class="faint">
                    {#if mondo}<a href="https://monarchinitiative.org/{mondo.mondo_id}" target="_blank" rel="noreferrer noopener">{mondo.mondo_id}</a>{/if}
                    {#each mondo?.orphanet ?? [] as o (o)} · <a href="https://www.orpha.net/en/disease/detail/{o}" target="_blank" rel="noreferrer noopener">Orphanet {o}</a>{/each}
                    {#each mondo?.omim ?? [] as o (o)} · <a href="https://omim.org/entry/{o}" target="_blank" rel="noreferrer noopener">OMIM {o}</a>{/each}
                  </div>
                </details>
              {/each}
              {#if c.conditions.length > 6}<div class="faint" style="font-size:11px">and {c.conditions.length - 6} more conditions</div>{/if}
              <div class="cite">{stars(c.stars)} {c.review_status ?? ''} · {vcv(c.variation_id)} · pack clinvar {packOf('classification')?.version} · CC0</div>
            </div>
          {/each}
        </section>
      {/if}

      {#each ann?.frequencies ?? [] as f (f.pack.id)}
        <section class="card-plain">
          <div class="card-kicker">{f.pack.source.short} · population frequency</div>
          {#each f.rows as r, ri (r.alt + ri)}
            <div style="margin-top:var(--space-3)">
              <div class="num" style="font-size:13px">{r.alt}: {pct(r.af)} of chromosomes <span class="faint">({pct(r.af_lo)}–{pct(r.af_hi)})</span></div>
              <div class="bar-freq" style="margin:var(--space-2) 0">
                <span class="share" style="width:{r.af_lo * 100}%"></span>
                <span class="fade" style="left:{r.af_lo * 100}%;width:{Math.max(0.5, (r.af_hi - r.af_lo) * 100)}%"></span>
                <span class="tick" style="left:{r.af * 100}%"></span>
              </div>
              <div class="faint" style="font-size:11px">A fact about that population, not about you. {copiesText(carries(r.alt), r.alt)}.</div>
              {#if f.pack.frequencyGroups?.length}
                <div class="groups num">
                  {#each [...f.pack.frequencyGroups].sort((x, y) => ((r[y.key as `af_${string}`] ?? -1) - (r[x.key as `af_${string}`] ?? -1))) as grp (grp.key)}
                    {#if r[grp.key as `af_${string}`] != null}
                      <span><span class="faint">{grp.label}</span> {pct(r[grp.key as `af_${string}`] as number)}</span>
                    {/if}
                  {/each}
                </div>
              {/if}
              <div class="cite">AC {fmtInt(r.ac)} / AN {fmtInt(r.an)} · pack {f.pack.id} {f.pack.version} · {f.pack.licence}</div>
            </div>
          {/each}
        </section>
      {/each}

      {#if coding?.consequence}
        {@const c = coding.consequence}
        <section class="card-plain wide">
          <div class="card-kicker">Protein · computed on this device</div>
          <div style="font-size:13px;margin-top:var(--space-2)">{coding.symbol} {c.hgvsP} <span class="faint">· {c.kind.replace('-', ' ')}</span></div>
          <div class="faint" style="font-size:11px">
            Codon {c.residue} reads {c.refCodon} in the reference and {c.altCodon} with {coding.altBase} here, giving {CONSEQUENCE_WORDS[c.kind]}.
          </div>
          <div class="cite">
            From {packOf('genes')?.source.short} coding blocks and the {packOf('sequence')?.source.short} sequence · transcript
            {coding.transcriptName ?? c.transcriptId}{coding.protein ? ` · ${coding.protein.accession}, ${coding.protein.length} residues` : ''}
          </div>
          {#if coding.protein}
            <StructurePanel
              accession={coding.protein.accession}
              proteinName={coding.protein.name || coding.symbol}
              residue={c.residue}
              caption={`Residue ${c.residue} of ${coding.protein.length ?? '?'}, marked in the accent colour`}
            />
          {/if}
        </section>
      {/if}

      {#if nothingKnown}
        <section class="card-plain">
          <div class="card-kicker">Nothing here yet</div>
          <p class="faint" style="font-size:12px;margin:var(--space-2) 0 0">
            None of the installed packs has a record at this position.
            {#if app.installed.filter((p) => !p.manifest.core).length === 0}<a href="#/packs">Browse the Pack Index</a>{/if}
          </p>
        </section>
      {/if}
    </div>

    {#if ann?.gwas.length}
      <div class="studies">
        <div class="card-kicker" style="margin-bottom:var(--space-2)">
          GWAS Catalog · {ann.gwas.length} association{ann.gwas.length === 1 ? '' : 's'}, strongest first · population-level, not a statement about you
        </div>
        <div class="study-row">
          {#each gwasShown as a, i (a.study_accession + a.trait + a.pubmed_id + i)}
            {@const rel = a.risk_allele ? relateAllele(a.risk_allele, call, siteAlleles) : null}
            <div class="study">
              <div style="font-size:12px">{a.trait}</div>
              <div class="faint num" style="font-size:11px">
                p = {fmtP(a.p_value, a.p_mlog)}{a.effect != null ? ` · ${a.effect_kind === 'beta' ? 'β' : 'OR'} ${a.effect}` : ''}
              </div>
              {#if rel}
                <div class="faint" style="font-size:11px">
                  Allele {a.risk_allele}{rel.basis === 'complement' ? ` (${rel.plus} on the plus strand)` : ''}{rel.basis === 'ambiguous' ? ' — strand cannot be inferred' : ''}.
                  {#if rel.basis !== 'ambiguous' && rel.basis !== 'unplaced'}{copiesText(rel.copies, rel.plus)}.{/if}
                </div>
              {/if}
              <div class="cite">{a.first_author} {a.pub_date?.slice(0, 4)} · PMID {a.pubmed_id}{a.initial_sample ? ` · ${a.initial_sample.slice(0, 60)}` : ''}</div>
            </div>
          {/each}
          {#if ann.gwas.length > 3}
            <button class="btn btn-ghost" type="button" onclick={() => (showAllGwas = !showAllGwas)}>
              {showAllGwas ? 'Show fewer' : `Show all ${ann.gwas.length}`}
            </button>
          {/if}
        </div>
      </div>
    {/if}
  {/if}
</div>

<style>
  .dock { border-top: 1px solid var(--color-divider); background: var(--color-surface); }
  .dock-head { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; padding: var(--space-3) var(--space-6); border-bottom: 1px solid var(--color-divider); }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(270px, 1fr)); gap: var(--space-3); padding: var(--space-4) var(--space-6); align-items: start; }
  .card-plain { background: var(--color-neutral-900); border-radius: var(--radius-sm); padding: var(--space-4); min-width: 0; }
  .card-plain.classification { background: transparent; box-shadow: inset 0 0 0 1px var(--color-accent-700); }
  .card-plain.wide { grid-column: span 2; }
  .cite { font-size: 10px; color: var(--color-neutral-500); margin-top: 6px; line-height: 1.45; }
  .cond { font-size: 11px; color: var(--color-neutral-400); margin-top: 4px; }
  .cond > div { margin: 3px 0; }
  .groups { display: flex; flex-wrap: wrap; gap: 4px var(--space-3); font-size: 11px; margin-top: var(--space-2); }
  .studies { padding: 0 var(--space-6) var(--space-4); }
  .study-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: var(--space-3); align-items: start; }
  .study { background: var(--color-neutral-900); border-radius: var(--radius-sm); padding: var(--space-3); }
  @media (max-width: 900px) {
    .card-plain.wide { grid-column: auto; }
    .cards, .studies { padding-left: 16px; padding-right: 16px; }
  }
</style>
