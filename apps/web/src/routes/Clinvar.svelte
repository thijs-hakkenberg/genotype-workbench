<script lang="ts">
  import { viewName } from '@gw/genotype-store';
  import type { ClinvarRow } from '@gw/annotation-library';
  import { activeKit, app, svc } from '../lib/services.svelte';
  import { route, go } from '../lib/router.svelte';
  import { fmtInt } from '../lib/format';

  type Row = ClinvarRow & { a1: string; a2: string | null; strand_ambiguous: boolean };
  const kit = $derived(activeKit());
  const cls = $derived(route.params.get('class'));
  let rows = $state<Row[] | null>(null);
  const hasClinvar = $derived(app.installed.some((p) => p.manifest.id === 'clinvar'));

  $effect(() => {
    const k = kit;
    const c = cls;
    rows = null;
    if (k && hasClinvar) void svc().library.clinvarForKit(viewName(k.kitId), c, 1000).then((r) => (rows = r));
  });
  const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(Math.max(0, 4 - n));
  const copies = (r: Row) => [r.a1, r.a2].filter((a) => a === r.alt).length;
</script>

<div class="page">
  <div class="page-head">
    <div>
      <div class="card-kicker">ClinVar · curated classification</div>
      <h2>{cls ?? 'All ClinVar records'} for your calls</h2>
      <div class="sub" style="max-width:720px">
        Positions where your call carries the allele a ClinVar record classifies. ClinVar states a panel's or submitter's
        judgement on a date; it is revised over time. This is what the source says, not a diagnosis, and many records
        concern conditions that need two copies or other factors.
      </div>
    </div>
    <div class="actions"><a class="btn btn-secondary" href="#/overview">Back to overview</a></div>
  </div>
  <div class="panel" style="padding:var(--space-3) var(--space-6) var(--space-4)">
    {#if !hasClinvar}
      <p class="muted">Install the ClinVar pack first. <a href="#/packs">Packs</a></p>
    {:else if rows === null}
      <p class="faint">Joining your calls with ClinVar on this device…</p>
    {:else if rows.length === 0}
      <p class="muted">No records.</p>
    {:else}
      <table class="table">
        <thead><tr><th>Position</th><th>rsID</th><th>Allele</th><th>Your call</th><th>Classification</th><th>Review</th><th>Condition</th></tr></thead>
        <tbody>
          {#each rows as r (r.variation_id + r.alt)}
            <tr onclick={() => go(`genome/${r.chrom}:${r.pos - 10000}-${r.pos + 10000}?sel=${r.chrom}:${r.pos}`)}>
              <td class="num" style="white-space:nowrap">chr{r.chrom}:{fmtInt(r.pos)}</td>
              <td>{r.rsid ?? '—'}</td>
              <td class="mono-allele">{r.ref}&gt;{r.alt}</td>
              <td class="mono-allele">{r.a1}{r.a2 ? `/${r.a2}` : ''} <span class="faint" style="font-size:11px;letter-spacing:0">{copies(r) === 2 ? 'both copies' : 'one copy'}{r.strand_ambiguous ? ' · ambiguous strand' : ''}</span></td>
              <td>{r.classification}</td>
              <td class="faint" title={r.review_status ?? ''}>{stars(r.stars)}</td>
              <td style="font-size:12px">{r.conditions.slice(0, 2).join('; ') || '—'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      {#if rows.length >= 1000}<p class="faint" style="font-size:11px">Showing the first 1,000, ordered by review status.</p>{/if}
    {/if}
  </div>
</div>
