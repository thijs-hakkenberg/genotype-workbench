<script lang="ts">
  import type { ConsentBasis } from '@gw/genotype-store';
  import { app, setActiveKit, svc, refreshEstimate } from '../lib/services.svelte';
  import { fmtBytes, fmtDate, fmtInt, fmtPct } from '../lib/format';

  let confirmDelete = $state<string | null>(null);
  let recording = $state<string | null>(null);
  let basis = $state<ConsentBasis>('recorded-consent');
  let note = $state('');

  async function saveConsent(kitId: string) {
    await svc().store.recordConsent(kitId, basis, note.trim() || undefined);
    recording = null;
    note = '';
  }

  async function remove(id: string) {
    await svc().store.delete(id);
    confirmDelete = null;
    void refreshEstimate();
  }

  const basisLabel = { self: 'Self', 'recorded-consent': 'Recorded consent', none: 'None recorded' } as const;
</script>

<div class="page">
  <div class="page-head">
    <div>
      <div class="card-kicker">Genotype Store</div>
      <h2>Kits</h2>
      <div class="sub">Every kit shows whose DNA it is and who imported it, on one line. Kits are immutable after import.</div>
    </div>
    <div class="actions"><a class="btn btn-primary" href="#/import">Import a raw data file</a></div>
  </div>

  <div class="panel" style="padding:var(--space-3) var(--space-6) var(--space-4)">
    {#if app.kits.length === 0}
      <p class="muted" style="margin:var(--space-3) 0">No kits yet.</p>
    {:else}
      <table class="table">
        <thead><tr><th>Kit</th><th>Data subject</th><th>Custodian</th><th>Consent basis</th><th style="text-align:right">Calls</th><th style="text-align:right">Call rate</th><th></th></tr></thead>
        <tbody>
          {#each app.kits as k (k.kitId)}
            <tr class:sel={k.kitId === app.activeKitId} onclick={() => setActiveKit(k.kitId)}>
              <td>
                <div>{k.label}</div>
                <div class="faint num" style="font-size:11px">imported {fmtDate(k.importedAt)} · {k.importer} · {k.sourceName}</div>
              </td>
              <td>{k.custody.dataSubject}</td>
              <td>{k.custody.custodian}</td>
              <td>
                <span class="tag {k.custody.consentBasis === 'none' ? 'tag-outline' : 'tag-accent'}">{basisLabel[k.custody.consentBasis]}</span>
                {#if k.custody.consentBasis === 'none'}
                  <div class="faint" style="font-size:11px;margin-top:2px">Analysis blocked</div>
                  <button class="btn btn-ghost" type="button" style="margin-top:4px"
                          onclick={(e) => (e.stopPropagation(), (recording = k.kitId))}>Record one</button>
                {:else if k.custody.history?.length}
                  <div class="faint" style="font-size:11px;margin-top:2px">recorded {fmtDate(k.custody.recordedAt)}</div>
                {/if}
              </td>
              <td class="num" style="text-align:right">{fmtInt(k.stats.calls)}</td>
              <td class="num" style="text-align:right">{fmtPct((k.stats.calls - k.stats.noCalls) / k.stats.calls)}</td>
              <td style="text-align:right;white-space:nowrap">
                {#if confirmDelete === k.kitId}
                  <button class="btn btn-secondary" type="button" onclick={(e) => (e.stopPropagation(), remove(k.kitId))}>Delete from this device</button>
                  <button class="btn btn-ghost" type="button" onclick={(e) => (e.stopPropagation(), (confirmDelete = null))}>Keep</button>
                {:else}
                  <button class="btn btn-ghost" type="button" onclick={(e) => (e.stopPropagation(), (confirmDelete = k.kitId))}>Delete…</button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}

    {#if recording}
      {@const k = app.kits.find((x) => x.kitId === recording)}
      <div class="panel" style="margin-top:var(--space-4);background:var(--color-bg)">
        <div class="card-kicker">Consent record</div>
        <h4>On what basis may {k?.custody.dataSubject}'s kit be analysed?</h4>
        <p class="notice" style="margin:0 0 var(--space-4)">
          The custodian records this, and the record says who said so and when. The earlier record is kept, not replaced.
          Nothing about the kit's calls changes.
        </p>
        <div class="field" style="max-width:420px">
          <label for="consent-basis">Basis</label>
          <select id="consent-basis" class="input" bind:value={basis}>
            <option value="recorded-consent">Recorded consent — {k?.custody.dataSubject} agreed to this</option>
            <option value="self">Self — this is the custodian's own DNA</option>
          </select>
        </div>
        <div class="field" style="max-width:420px;margin-top:var(--space-3)">
          <label for="consent-note">How it was given</label>
          <input id="consent-note" class="input" bind:value={note} placeholder="Signed form, 14 March 2026" />
        </div>
        <div class="actions" style="margin-top:var(--space-4)">
          <button class="btn btn-ghost" type="button" onclick={() => (recording = null)}>Cancel</button>
          <button class="btn btn-primary" type="button" onclick={() => saveConsent(recording!)}>Record consent</button>
        </div>
      </div>
    {/if}
  </div>

  <div class="panel" style="margin-top:var(--space-3)">
    <div class="card-kicker">This device</div>
    <h4>Storage</h4>
    <div class="kv" style="max-width:520px">
      <div><span>Used by the workbench</span><span class="num">{app.estimate ? fmtBytes(app.estimate.usage) : '…'}</span></div>
      <div><span>Available to this site</span><span class="num">{app.estimate ? fmtBytes(app.estimate.quota) : '…'}</span></div>
      <div><span>Protected from eviction</span><span>{app.estimate?.persisted ? 'Yes' : 'No — the browser may clear it under storage pressure'}</span></div>
    </div>
    <p class="notice" style="margin:var(--space-4) 0 0">
      Kits and packs live in this browser's private file system for this site only. Clearing site data removes them. Keep
      your original raw data file: it is the source of truth.
    </p>
  </div>
</div>
