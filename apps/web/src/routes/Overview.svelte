<script lang="ts">
  import type { DensityBin } from '@gw/genotype-store';
  import { viewName } from '@gw/genotype-store';
  import type { CallOverlap } from '@gw/annotation-library';
  import { app, activeKit, svc } from '../lib/services.svelte';
  import { go } from '../lib/router.svelte';
  import { fmtDate, fmtInt, fmtPct } from '../lib/format';
  import CoverageMap from '../lib/components/CoverageMap.svelte';

  const BIN = 1_000_000;
  const kit = $derived(activeKit());
  let bins = $state<DensityBin[]>([]);
  let overlap = $state<CallOverlap[]>([]);
  const annotationPacks = $derived(app.installed.filter((p) => !p.manifest.core));
  const hasClinvar = $derived(app.installed.some((p) => p.manifest.role === 'classification'));

  $effect(() => {
    const k = kit;
    bins = [];
    if (k) void svc().store.density(k.kitId, BIN).then((b) => (bins = b));
  });

  $effect(() => {
    const k = kit;
    overlap = [];
    if (k && hasClinvar) void svc().library.clinvarOverlap(viewName(k.kitId)).then((o) => (overlap = o));
  });

  const s = $derived(kit?.stats);
  const checked = $derived(
    s ? s.refChecks.match + s.refChecks['hom-non-ref'] + s.refChecks['complement-only'] + s.refChecks.mismatch : 0,
  );
  const consistent = $derived(s ? s.refChecks.match + s.refChecks['hom-non-ref'] : 0);
  const callRate = $derived(s ? (s.calls - s.noCalls) / s.calls : 0);
</script>

{#if !kit}
  <div class="page" style="max-width:760px">
    <div class="card-kicker">Genotype Workbench</div>
    <h2 style="margin:6px 0 var(--space-3)">Bring your own raw DNA file</h2>
    <p class="muted" style="max-width:600px">
      Import a 23andMe raw data export. It is read, normalized and stored in this browser: nothing is uploaded, and no
      network request is made unless you grant one. Then explore it on a genome view and join it to public databanks, which
      arrive as whole downloaded packs.
    </p>
    <div style="display:flex;gap:var(--space-2);margin-top:var(--space-6)">
      <a class="btn btn-primary" href="#/import">Import a raw data file</a>
      <a class="btn btn-secondary" href="#/packs">See available packs</a>
    </div>
    <p class="notice" style="margin-top:var(--space-8)">
      Information, not diagnosis: the workbench shows what sources say about a position, with citations. It computes no
      personal risk score and no clinical interpretation.
    </p>
  </div>
{:else if s}
  <div class="page">
    <div class="page-head">
      <div style="flex:1;min-width:280px">
        <div class="card-kicker">Kit overview</div>
        <h2>{kit.label}</h2>
        <div class="sub">
          Imported {fmtDate(kit.importedAt)} · {kit.importer} · normalized on locus {kit.locusVersion} · source SHA-256
          {kit.sourceSha256.slice(0, 4)}…{kit.sourceSha256.slice(-4)}
        </div>
      </div>
      <div class="actions">
        <a class="btn btn-secondary" href="#/kits">Custody record</a>
        <button class="btn btn-primary" type="button" onclick={() => go('genome/2:136590000-136625000')}>Open genome view</button>
      </div>
    </div>

    <div class="grid-4">
      <div class="card elev-sm stat">
        <div class="label">Calls stored</div>
        <div class="value">{fmtInt(s.calls)}</div>
        <div class="bar-hard"><span style="width:100%"></span></div>
        <div class="note">One per locus, plus strand, GRCh37</div>
      </div>
      <div class="card elev-sm stat">
        <div class="label">Call rate</div>
        <div class="value">{fmtPct(callRate)}</div>
        <div class="bar-hard"><span style="width:{callRate * 100}%"></span></div>
        <div class="note">{fmtInt(s.noCalls)} no-calls kept, not dropped</div>
      </div>
      <div class="card elev-sm stat">
        <div class="label">Strand-ambiguous</div>
        <div class="value">{fmtInt(s.strandAmbiguous)}</div>
        <div class="bar-hard ambig"><span style="width:{Math.max(1, (s.strandAmbiguous / s.calls) * 100)}%"></span></div>
        <div class="note">A/T and C/G — {fmtPct(s.strandAmbiguous / s.calls)} of calls, flagged</div>
      </div>
      <div class="card elev-sm stat">
        <div class="label">Reference checked</div>
        <div class="value">{checked ? fmtPct(consistent / checked, 2) : '—'}</div>
        <div class="bar-hard"><span style="width:{checked ? (consistent / checked) * 100 : 0}%"></span></div>
        <div class="note">
          {#if kit.referencePack}
            Consistent with GRCh37 at {fmtInt(checked)} checked loci · {fmtInt(s.refChecks['complement-only'])} probable flips
          {:else}
            Imported without the reference pack
          {/if}
        </div>
      </div>
    </div>

    <div class="panel" style="margin-top:var(--space-8)">
      <div style="display:flex;align-items:baseline;gap:var(--space-4);margin-bottom:var(--space-6);flex-wrap:wrap">
        <h4 style="margin:0">Coverage across the genome</h4>
        <span class="muted" style="font-size:12px">Where the chip put probes. Density, not sequence — a chip reads about 0.02% of the genome.</span>
        <span class="faint" style="margin-left:auto;font-size:11px">Click a chromosome to open it</span>
      </div>
      <CoverageMap {bins} binSize={BIN} />
      <div class="legend" style="margin-top:var(--space-6);background:transparent;padding:var(--space-4) 0 0;border-top:1px solid var(--color-divider)">
        <span><span style="width:22px;height:9px;border-radius:2px;background:linear-gradient(to right,var(--color-neutral-900),var(--color-accent-500));display:block"></span>Probe density per Mb</span>
        <span><span style="width:6px;height:9px;background:var(--color-bg);box-shadow:inset 0 0 0 1px var(--color-neutral-700);display:block"></span>Centromere</span>
        <span style="margin-left:auto">Bar length is chromosome length on GRCh37</span>
      </div>
    </div>

    <div class="grid-2" style="margin-top:var(--space-3)">
      <div class="panel">
        <div class="card-kicker">Custody</div>
        <h4>{kit.custody.dataSubject === 'Self' ? 'This kit is your own' : `This kit is ${kit.custody.dataSubject}'s`}</h4>
        <div class="kv">
          <div><span>Data subject</span><span>{kit.custody.dataSubject}</span></div>
          <div><span>Custodian</span><span>{kit.custody.custodian}</span></div>
          <div><span>Consent basis</span><span><span class="tag {kit.custody.consentBasis === 'none' ? 'tag-outline' : 'tag-accent'}">{kit.custody.consentBasis === 'self' ? 'Self' : kit.custody.consentBasis === 'recorded-consent' ? 'Recorded consent' : 'None recorded'}</span></span></div>
          <div><span>Recorded</span><span class="num">{fmtDate(kit.custody.recordedAt)}</span></div>
        </div>
        <p class="faint" style="font-size:12px;margin:var(--space-4) 0 0">A relative's kit needs a consent record before any analysis may read it.</p>
      </div>

      <div class="panel" style="display:flex;flex-direction:column">
        <div class="card-kicker">Annotation library</div>
        {#if annotationPacks.length === 0}
          <h4>No packs installed</h4>
          <p class="muted" style="font-size:13px;margin:0 0 var(--space-4);max-width:400px">
            Your calls are stored and viewable on their own. Annotation arrives as whole signed packs, downloaded in full and
            joined on this device — never by looking a variant up remotely.
          </p>
          <div style="margin-top:auto;display:flex;gap:var(--space-2)">
            <a class="btn btn-secondary" href="#/packs">Browse Pack Index</a>
          </div>
        {:else}
          <h4>{annotationPacks.length} pack{annotationPacks.length === 1 ? '' : 's'} joined locally</h4>
          {#if hasClinvar}
            <div class="notice" style="margin-bottom:var(--space-3)">
              Your calls that carry an allele ClinVar has a record for, by ClinVar classification. This lists what ClinVar
              says; it is not a diagnosis. Most records concern rare conditions and many are revised over time.
            </div>
            <table class="table" style="font-size:13px">
              <tbody>
                {#each overlap as o (o.classification)}
                  <tr onclick={() => go(`clinvar?class=${encodeURIComponent(o.classification)}`)}>
                    <td>{o.classification}</td><td class="num" style="text-align:right">{fmtInt(o.n)}</td>
                  </tr>
                {:else}
                  <tr><td class="faint">Joining…</td></tr>
                {/each}
              </tbody>
            </table>
          {/if}
          <div style="margin-top:auto;padding-top:var(--space-4);display:flex;gap:var(--space-2)">
            <a class="btn btn-secondary" href="#/packs">Manage packs</a>
            {#if hasClinvar}<a class="btn btn-ghost" href="#/clinvar">All ClinVar records for your calls</a>{/if}
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}
