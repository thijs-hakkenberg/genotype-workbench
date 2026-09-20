<script lang="ts">
  import type { Chrom, PackManifest } from '@gw/plugin-sdk';
  import { REF_CHECK_LABELS, formatCall, type CallRow, type Kit } from '@gw/genotype-store';
  import { pickTranscript, relateAllele, type Annotations, type FrequencyRow, type ProteinRow } from '@gw/annotation-library';
  import { CONSEQUENCE_WORDS, consequenceOf, type Consequence } from '@gw/protein';
  import StructurePanel from './StructurePanel.svelte';
  import { app, svc } from '../services.svelte';
  import { fmtDate, fmtInt, fmtP } from '../format';

  let { kit, chrom, pos }: { kit: Kit | null; chrom: Chrom; pos: number } = $props();

  let call = $state<CallRow | null>(null);
  let ann = $state<Annotations | null>(null);
  let loading = $state(true);
  let copied = $state(false);
  let showAllGwas = $state(false);
  let failed = $state('');
  let coding = $state<{ consequence: Consequence | null; symbol: string; transcriptName: string | null; protein: ProteinRow | null; altBase: string | null } | null>(null);

  $effect(() => {
    const k = kit;
    const c = chrom;
    const p = pos;
    loading = true;
    showAllGwas = false;
    const { store, library } = svc();
    failed = '';
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

  // What this position does to a protein, computed here from the gene's coding
  // blocks and the reference bases: deterministic bookkeeping, not a judgement.
  $effect(() => {
    const c = chrom;
    const p = pos;
    const call = callForCoding;
    coding = null;
    const { library } = svc();
    void (async () => {
      const genes = await library.codingTranscriptsAt(c, p);
      const tx = pickTranscript(genes);
      if (!tx) return;
      const sequence = await library.sequenceIn({ chrom: c, start: p - 3000, end: p + 3000 });
      if (!sequence) return;
      const protein = await library.proteinFor(tx.transcript_id, tx.symbol);
      const alt = call?.alt ?? null;
      const consequence = alt ? consequenceOf(tx, sequence, p, alt) : null;
      if (c !== chrom || p !== pos) return;
      coding = { consequence, symbol: tx.symbol, transcriptName: tx.transcript_name ?? null, protein, altBase: alt };
    })();
  });

  // The allele to translate: the call's non-reference base, else what a pack records here.
  const callForCoding = $derived.by(() => {
    const alt = [call?.a1, call?.a2].find((a) => a && ref && a !== ref && 'ACGT'.includes(a));
    return { alt: alt ?? ann?.clinvar[0]?.alt ?? null };
  });

  const packOf = (role: string) => app.installed.find((p) => p.manifest.role === role)?.manifest;
  const ref = $derived(call?.ref ?? ann?.clinvar[0]?.ref ?? ann?.frequencies[0]?.rows[0]?.ref ?? null);
  const alt = $derived.by(() => {
    const fromCall = [call?.a1, call?.a2].find((a) => a && ref && a !== ref && 'ACGT'.includes(a));
    return fromCall ?? ann?.clinvar[0]?.alt ?? ann?.frequencies[0]?.rows[0]?.alt ?? null;
  });
  const key = $derived(ref ? `GRCh37:${chrom}:${pos}:${ref}${alt ? `:${alt}` : ''}` : `GRCh37:${chrom}:${pos}`);
  const rsid = $derived(call?.rsid ?? ann?.clinvar.find((c) => c.rsid)?.rsid ?? ann?.gwas[0]?.rsid ?? null);
  const siteAlleles = $derived([
    ref,
    ...(ann?.clinvar.map((c) => c.alt) ?? []),
    ...(ann?.frequencies.flatMap((f) => f.rows.map((r) => r.alt)) ?? []),
  ]);
  const gwasShown = $derived(showAllGwas ? (ann?.gwas ?? []) : (ann?.gwas.slice(0, 4) ?? []));
  const nothingKnown = $derived(
    ann && !ann.clinvar.length && !ann.gwas.length && !ann.frequencies.length && !ann.genes.length,
  );

  const carries = (allele: string) => {
    if (!call || call.is_nocall) return null;
    return [call.a1, call.a2].filter((a) => a === allele).length;
  };
  const copiesText = (n: number | null, allele: string) =>
    n == null ? 'No call here' : n === 0 ? `Your call does not carry ${allele}` : `Your call carries ${allele} on ${n === 2 ? 'both copies' : call?.a2 ? 'one copy' : 'its one copy'}`;
  const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(Math.max(0, 4 - n));
  const vcv = (id: number) => `VCV${String(id).padStart(9, '0')}`;
  const pct = (v: number) => `${(v * 100).toFixed(v < 0.01 ? 2 : 1)}%`;
  const groupsOf = (m: PackManifest) => m.frequencyGroups ?? [];

  async function copyKey() {
    await navigator.clipboard.writeText(key);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }

  function band(r: FrequencyRow) {
    return { lo: r.af_lo * 100, hi: r.af_hi * 100, v: r.af * 100 };
  }
</script>

<div class="card-kicker">Selected</div>
<h4 style="margin:6px 0 2px">{rsid ?? `chr${chrom}:${fmtInt(pos)}`}</h4>
<div class="faint num" style="font-size:11px">GRCh37 chr{chrom}:{fmtInt(pos)}{ref ? ` · reference ${ref}` : ''}{ann?.genes.length ? ` · ${ann.genes.map((g) => g.symbol).join(', ')}` : ''}</div>

{#if failed}
  <div class="error-box" style="margin-top:var(--space-6)">Could not read this position: {failed}</div>
{:else if loading && !ann}
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
    {#if ann?.geneticMap}
      <div title="Interpolated from the {ann.geneticMap.pack.source.short} map">
        <span>Genetic position</span><span class="num">{ann.geneticMap.cm.toFixed(2)} cM · {ann.geneticMap.pack.source.short}</span>
      </div>
    {/if}
    {#each ann?.merges ?? [] as mg (mg.old_rsid + mg.new_rsid)}
      <div><span>dbSNP</span><span>{mg.old_rsid} was merged into {mg.new_rsid}{mg.build ? ` (build ${mg.build})` : ''}</span></div>
    {/each}
  </div>

  <div style="display:flex;flex-direction:column;gap:var(--space-3);margin-top:var(--space-6)">
    {#each ann?.genes ?? [] as g (g.gene_id)}
      <div class="evidence">
        <span class="mk mk-documentary"></span>
        <div>
          <div class="title">{g.symbol} <span class="faint" style="font-size:11px">{g.biotype.replaceAll('_', ' ')} · {g.strand === '-' ? 'minus' : 'plus'} strand</span></div>
          <div class="what">This position lies inside the gene's span ({fmtInt(g.start)}–{fmtInt(g.end)}), transcript {g.transcript_name ?? g.transcript_id}.</div>
          <div class="cite">{g.gene_id} · pack {packOf('genes')?.id} {packOf('genes')?.version} · {packOf('genes')?.licence}</div>
        </div>
      </div>
    {/each}

    {#each ann?.clinvar ?? [] as c (c.variation_id + c.alt)}
      <div class="evidence classification">
        <span class="mk mk-classification"></span>
        <div>
          <div class="title">ClinVar classification: {c.classification}</div>
          <div class="what">{c.ref}&gt;{c.alt}</div>
          <div class="what">{copiesText(carries(c.alt), c.alt)}{call?.strand_ambiguous ? ' — strand-ambiguous call, joined with lower confidence' : ''}</div>
          {#each c.conditions as name, i (name + i)}
            {@const mondo = c.condition_mondo?.[i] ? ann?.conditions[c.condition_mondo[i]!] : undefined}
            <details class="what" style="margin-top:4px">
              <summary>{mondo?.name ?? name}</summary>
              {#if mondo?.definition}<div style="margin:4px 0">{mondo.definition}</div>{/if}
              {#if mondo?.synonyms.length}<div class="faint">Also called {mondo.synonyms.slice(0, 3).join('; ')}</div>{/if}
              <div class="faint">
                {#if mondo}<a href="https://monarchinitiative.org/{mondo.mondo_id}" target="_blank" rel="noreferrer noopener">{mondo.mondo_id}</a>{/if}
                {#each mondo?.orphanet ?? [] as o (o)} · <a href="https://www.orpha.net/en/disease/detail/{o}" target="_blank" rel="noreferrer noopener">Orphanet {o}</a>{/each}
                {#each mondo?.omim ?? [] as o (o)} · <a href="https://omim.org/entry/{o}" target="_blank" rel="noreferrer noopener">OMIM {o}</a>{/each}
                {#if !mondo}{packOf('conditions') ? 'No Mondo record for this name' : 'Install the Mondo pack for a plain-language definition'}{/if}
              </div>
            </details>
          {/each}
          <div class="cite">
            <span title="ClinVar review status">{stars(c.stars)}</span> {c.review_status ?? ''}<br />
            {vcv(c.variation_id)} · pack clinvar {packOf('classification')?.version} · {packOf('classification')?.licence}
            {#if ann && Object.keys(ann.conditions).length} · condition names: Mondo {packOf('conditions')?.version}, CC BY 4.0{/if}
          </div>
        </div>
      </div>
    {/each}

    {#each ann?.frequencies ?? [] as f (f.pack.id)}
      {#each f.rows as r (r.alt)}
        {@const b = band(r)}
        <div class="evidence">
          <span class="mk mk-frequency"></span>
          <div style="flex:1;min-width:0">
            <div class="title num">{r.alt}: {pct(r.af)} of {f.pack.source.short} chromosomes</div>
            <div class="bar-freq" style="margin:var(--space-2) 0" title="Sampling interval {pct(r.af_lo)}–{pct(r.af_hi)}">
              <span class="share" style="width:{b.lo}%"></span>
              <span class="fade" style="left:{b.lo}%;width:{Math.max(0.5, b.hi - b.lo)}%"></span>
              <span class="tick" style="left:{b.v}%"></span>
            </div>
            <div class="what">How common this allele is in the sampled population ({pct(r.af_lo)}–{pct(r.af_hi)}). A fact about that population, not about you. {copiesText(carries(r.alt), r.alt)}.</div>
            {#if groupsOf(f.pack).length}
              <details class="what">
                <summary>By population group</summary>
                <div class="kv num" style="font-size:11px;gap:2px;margin-top:4px">
                  {#each [...groupsOf(f.pack)].sort((x, y) => ((r[y.key as `af_${string}`] ?? -1) - (r[x.key as `af_${string}`] ?? -1))) as grp (grp.key)}
                    {#if r[grp.key as `af_${string}`] != null}<div><span>{grp.label}</span><span>{pct(r[grp.key as `af_${string}`] as number)}</span></div>{/if}
                  {/each}
                </div>
              </details>
            {/if}
            <div class="cite">AC {fmtInt(r.ac)} / AN {fmtInt(r.an)} · pack {f.pack.id} {f.pack.version} · {f.pack.licence}</div>
          </div>
        </div>
      {/each}
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
          <div class="cite">{a.first_author} {a.pub_date?.slice(0, 4)} · PMID {a.pubmed_id} · {a.study_accession} · pack gwas-catalog {packOf('association')?.version} · CC0</div>
        </div>
      </div>
    {/each}
    {#if (ann?.gwas.length ?? 0) > 4}
      <button class="btn btn-ghost" type="button" onclick={() => (showAllGwas = !showAllGwas)}>
        {showAllGwas ? 'Show fewer associations' : `Show all ${ann?.gwas.length} associations, strongest first`}
      </button>
    {/if}

    {#if coding?.consequence}
      {@const c = coding.consequence}
      <div class="evidence">
        <span class="mk mk-documentary"></span>
        <div style="flex:1;min-width:0">
          <div class="title">
            {coding.symbol} {c.hgvsP}
            <span class="faint" style="font-size:11px">· {c.kind.replace('-', ' ')}</span>
          </div>
          <div class="what">
            Codon {c.residue} reads {c.refCodon} in the reference and {c.altCodon} with {coding.altBase} here, giving
            {CONSEQUENCE_WORDS[c.kind]}.
            {#if callForCoding.alt && !(call && [call.a1, call.a2].includes(callForCoding.alt))}
              Your call does not carry {coding.altBase}; this is what that allele would do.
            {/if}
          </div>
          <div class="cite">
            Computed on this device from {packOf('genes')?.source.short} coding blocks and the {packOf('sequence')?.source.short}
            sequence · transcript {coding.transcriptName ?? c.transcriptId}
            {#if coding.protein} · {coding.protein.accession} ({coding.protein.length} residues, UniProt CC BY 4.0){/if}
          </div>
          {#if coding.protein}
            <StructurePanel
              accession={coding.protein.accession}
              proteinName={coding.protein.name || coding.symbol}
              residue={c.residue}
              caption={`Residue ${c.residue} of ${coding.protein.length ?? '?'}, marked in the accent colour`}
            />
          {/if}
        </div>
      </div>
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
