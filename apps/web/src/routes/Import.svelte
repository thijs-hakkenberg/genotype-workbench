<script lang="ts">
  import { ImportRefused, type ConsentBasis, type PreparedImport } from '@gw/genotype-store';
  import { app, setActiveKit, svc, refreshEstimate, spaceFor } from '../lib/services.svelte';
  import { go } from '../lib/router.svelte';
  import { fmtBytes, fmtInt, fmtPct } from '../lib/format';

  type Phase = 'pick' | 'reading' | 'review' | 'saving';
  let phase = $state<Phase>('pick');
  let error = $state('');
  let over = $state(false);
  let fileName = $state('');
  let rowsRead = $state(0);
  let rowsExpected = $state(1);
  let prepared = $state<PreparedImport | null>(null);
  let input = $state<HTMLInputElement>();

  // Custody form (ADR-0009): whose DNA, who imported it, on what basis.
  let label = $state('');
  let own = $state(true);
  let subjectName = $state('');
  let custodian = $state('Self');
  let basis = $state<ConsentBasis>('recorded-consent');
  let note = $state('');

  const hasReference = $derived(app.installed.some((p) => p.manifest.id === 'reference-grch37'));
  const stats = $derived(prepared?.meta.stats);
  const checked = $derived(
    stats ? stats.refChecks.match + stats.refChecks['hom-non-ref'] + stats.refChecks['complement-only'] + stats.refChecks.mismatch : 0,
  );
  const canSave = $derived(!!prepared && (own || subjectName.trim().length > 0) && custodian.trim().length > 0);

  async function read(file: File) {
    error = '';
    // A stored kit is Parquet, about a third of the text file; the check is generous.
    const space = await spaceFor(file.size);
    if (!space.ok) {
      error = `Not enough storage to keep this kit: about ${fmtBytes(space.needed)} is needed and this site has ${fmtBytes(space.available)} left. Remove a pack or kit, or free disk space.`;
      return;
    }
    fileName = file.name;
    rowsRead = 0;
    rowsExpected = Math.max(1, file.size / 22);
    phase = 'reading';
    try {
      const { store, library } = svc();
      const reference = await library.referenceColumns();
      prepared = await store.prepare(file, reference, (n) => (rowsRead = n));
      const m = prepared.meta;
      label = `${own ? 'Me' : subjectName || 'Kit'} — ${m.vendorLabel} ${m.chipVersion ?? ''}`.trim();
      phase = 'review';
    } catch (e) {
      error = e instanceof ImportRefused || e instanceof Error ? e.message : String(e);
      phase = 'pick';
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    over = false;
    const f = e.dataTransfer?.files[0];
    if (f) void read(f);
  }

  async function save() {
    if (!prepared || !canSave) return;
    phase = 'saving';
    try {
      const kit = await svc().store.save(prepared, label, {
        dataSubject: own ? 'Self' : subjectName.trim(),
        custodian: custodian.trim(),
        consentBasis: own ? 'self' : basis,
        consentNote: note.trim() || undefined,
        recordedAt: new Date().toISOString(),
      });
      setActiveKit(kit.kitId);
      void refreshEstimate();
      go('overview');
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      phase = 'review';
    }
  }

  $effect(() => {
    if (prepared && phase === 'review') {
      const m = prepared.meta;
      label = `${own ? 'Me' : subjectName.trim() || 'Relative'} — ${m.vendorLabel} ${m.chipVersion ?? ''}`.trim();
    }
  });
</script>

<div class="page" style="max-width:880px">
  <div class="card-kicker">Import</div>
  <h2 style="margin:6px 0 var(--space-2)">Normalizing — the one place correctness is decided</h2>
  <p class="muted" style="font-size:13px;max-width:640px">
    Your file is read and normalized in this browser by the locus normalizer ({app.locusVersion || '…'}, WASM worker). It is
    never uploaded. Calls are stored on the plus strand of GRCh37; no-calls are kept, and A/T or C/G calls are flagged.
  </p>

  {#if !hasReference}
    <div class="evidence empty" style="margin:var(--space-4) 0">
      <div>
        <div class="title">The GRCh37 reference pack is not installed</div>
        <div class="what">
          Calls can still be imported, but they will not be checked against the reference base, so strand flips cannot be caught.
          {app.indexError}
        </div>
      </div>
    </div>
  {/if}

  {#if error}
    <div class="error-box" role="alert" style="margin:var(--space-4) 0">{error}</div>
  {/if}

  {#if phase === 'pick'}
    <div
      class="dropzone"
      class:over
      role="button"
      tabindex="0"
      style="margin-top:var(--space-6)"
      ondragover={(e) => (e.preventDefault(), (over = true))}
      ondragleave={() => (over = false)}
      ondrop={onDrop}
      onclick={() => input?.click()}
      onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && input?.click()}
    >
      <span class="mk-measured" style="width:14px;height:14px"></span>
      <h4 style="margin:4px 0 0">Drop a raw data file</h4>
      <div class="muted" style="font-size:13px">23andMe raw data (chips v3–v5, build 37) — the .txt or .zip-extracted file</div>
      <div class="faint" style="font-size:12px">Read in this browser. Never uploaded.</div>
      <input bind:this={input} type="file" accept=".txt,.tsv,text/plain" hidden
        onchange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) void read(f); }} />
    </div>
  {:else if phase === 'reading'}
    <div class="panel" style="margin-top:var(--space-6)">
      <div class="card-kicker">Reading {fileName}</div>
      <h4 class="num">Normalizing {fmtInt(rowsRead)} rows…</h4>
      <div class="progress"><span style="width:{Math.min(100, (rowsRead / rowsExpected) * 100)}%"></span></div>
      <div class="faint" style="font-size:11px;margin-top:var(--space-2)">locus {app.locusVersion} · WASM worker</div>
    </div>
  {:else if prepared && stats}
    {@const m = prepared.meta}
    <div class="panel" style="margin-top:var(--space-6)">
      <div class="card-kicker">Detected</div>
      <h4 style="margin:6px 0 2px">{m.vendorLabel} {m.chipVersion ?? '(chip not recognised)'} · {m.build}</h4>
      <div class="faint num" style="font-size:12px;margin-bottom:var(--space-6)">
        {fileName} · {m.chipLabel ?? ''} · chip {m.chipBasis} · {m.importer} · SHA-256 {m.sourceSha256.slice(0, 4)}…{m.sourceSha256.slice(-4)}
      </div>

      <div class="grid-2" style="gap:var(--space-4) var(--space-8)">
        <div class="kv">
          <div><span>Rows read</span><span class="num">{fmtInt(stats.rowsRead)}</span></div>
          <div><span>Calls stored</span><span class="num">{fmtInt(stats.calls)}</span></div>
          <div><span>No-calls</span><span class="num">{fmtInt(stats.noCalls)} · kept, not dropped</span></div>
          <div><span>Strand-ambiguous</span><span class="num">{fmtInt(stats.strandAmbiguous)} · flagged</span></div>
          <div><span>Duplicate probes merged</span><span class="num">{fmtInt(stats.duplicatesMerged)}{stats.duplicateConflicts ? ` · ${fmtInt(stats.duplicateConflicts)} conflicting, set to no-call` : ''}</span></div>
          <div><span>Rows rejected</span><span class="num">{fmtInt(stats.rejected)}</span></div>
        </div>
        <div class="kv">
          <div><span>Checked against GRCh37</span><span class="num">{hasReference ? fmtInt(checked) : 'not checked'}</span></div>
          <div><span>Contains the reference base</span><span class="num">{fmtInt(stats.refChecks.match)}{checked ? ` · ${fmtPct(stats.refChecks.match / checked, 2)}` : ''}</span></div>
          <div><span>Differs on both copies</span><span class="num">{fmtInt(stats.refChecks['hom-non-ref'])}</span></div>
          <div><span>Probable strand flip</span><span class="num">{fmtInt(stats.refChecks['complement-only'])} · flagged, not flipped</span></div>
          <div><span>Fits neither strand</span><span class="num">{fmtInt(stats.refChecks.mismatch)}</span></div>
          <div><span>Chip indels (I/D)</span><span class="num">{fmtInt(stats.refChecks['indel-unresolved'])}</span></div>
        </div>
      </div>
      {#if m.rejectedExamples.length}
        <details style="margin-top:var(--space-4);font-size:12px">
          <summary class="muted">Rejected rows ({m.rejectedExamples.length} shown)</summary>
          <ul class="faint num">
            {#each m.rejectedExamples as r (r.line)}<li>line {r.line}: {r.reason}</li>{/each}
          </ul>
        </details>
      {/if}
    </div>

    <div class="panel" style="margin-top:var(--space-3)">
      <div class="card-kicker">Custody record required</div>
      <h4>Whose DNA is this, and who may read it?</h4>
      <div style="display:flex;flex-direction:column;gap:var(--space-4)">
        <div style="display:flex;gap:var(--space-6);flex-wrap:wrap">
          <label class="radio"><input type="radio" name="own" checked={own} onchange={() => (own = true)} /><span class="dot"></span>My own DNA</label>
          <label class="radio"><input type="radio" name="own" checked={!own} onchange={() => (own = false)} /><span class="dot"></span>Someone else's (a relative)</label>
        </div>
        {#if !own}
          <div class="field"><label for="subject">Data subject — whose DNA</label>
            <input id="subject" class="input" bind:value={subjectName} placeholder="e.g. M. Bakker" /></div>
          <div class="field"><label for="basis">Consent basis</label>
            <div class="seg" id="basis">
              <label class="seg-opt"><input type="radio" name="basis" checked={basis === 'recorded-consent'} onchange={() => (basis = 'recorded-consent')} />Recorded consent</label>
              <label class="seg-opt"><input type="radio" name="basis" checked={basis === 'none'} onchange={() => (basis = 'none')} />None recorded</label>
            </div>
          </div>
          <div class="field"><label for="note">Consent note</label>
            <input id="note" class="input" bind:value={note} placeholder="How and when consent was given" /></div>
          {#if basis === 'none'}
            <p class="notice" style="margin:0">Without a consent record this kit can be viewed, but no analysis may read it.</p>
          {/if}
        {/if}
        <div class="grid-2">
          <div class="field"><label for="custodian">Custodian — who imported it</label>
            <input id="custodian" class="input" bind:value={custodian} /></div>
          <div class="field"><label for="label">Kit label</label>
            <input id="label" class="input" bind:value={label} /></div>
        </div>
      </div>
      <div style="display:flex;gap:var(--space-2);margin-top:var(--space-6)">
        <button class="btn btn-primary" type="button" disabled={!canSave || phase === 'saving'} onclick={save}>
          {phase === 'saving' ? 'Storing…' : 'Store kit on this device'}
        </button>
        <button class="btn btn-ghost" type="button" onclick={() => ((prepared = null), (phase = 'pick'))}>Choose another file</button>
      </div>
    </div>
  {/if}
</div>
