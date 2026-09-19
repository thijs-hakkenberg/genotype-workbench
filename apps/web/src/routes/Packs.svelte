<script lang="ts">
  import { DOMAIN_LABELS, EVIDENCE_KINDS, type PackManifest } from '@gw/plugin-sdk';
  import { NetworkNotGranted } from '@gw/plugin-host';
  import { app, refreshIndex, refreshEstimate, svc } from '../lib/services.svelte';
  import { fmtBytes, fmtDate, fmtInt } from '../lib/format';

  let busy = $state<Record<string, number>>({});
  let errors = $state<Record<string, string>>({});

  const installedVersion = (id: string) => app.installed.find((p) => p.manifest.id === id)?.manifest;
  const available = $derived(app.index?.packs ?? []);
  const listed = $derived([
    ...available,
    ...app.installed.map((p) => p.manifest).filter((m) => !available.some((a) => a.id === m.id)),
  ]);

  async function install(m: PackManifest) {
    errors[m.id] = '';
    busy[m.id] = 0;
    try {
      await svc().library.install(m, (done, total) => (busy[m.id] = done / total));
      void refreshEstimate();
    } catch (e) {
      errors[m.id] = e instanceof NetworkNotGranted ? 'Not installed: network access was not granted.' : e instanceof Error ? e.message : String(e);
    } finally {
      delete busy[m.id];
    }
  }

  async function remove(id: string) {
    await svc().library.remove(id);
    void refreshEstimate();
  }

  const mark = { measured: 'mk-measured', 'curated-classification': 'mk-classification', 'statistical-association': 'mk-association', 'probabilistic-estimate': 'mk-estimate', documentary: 'mk-documentary' } as const;
</script>

<div class="page">
  <div class="page-head">
    <div>
      <div class="card-kicker">Annotation library</div>
      <h2>Packs</h2>
      <div class="sub" style="max-width:720px">
        Public databanks arrive as whole packs from the signed Pack Index at {svc().library.indexHost}. Each is downloaded in
        full, checked against the index's SHA-256, and joined with your calls on this device. No variant is ever looked up
        remotely, so no source learns what you carry.
      </div>
    </div>
    <div class="actions"><button class="btn btn-secondary" type="button" onclick={refreshIndex}>Refresh index</button></div>
  </div>

  {#if app.indexError}
    <div class="error-box" style="margin-bottom:var(--space-4)">
      {app.indexError}
      <div class="faint" style="font-size:12px;margin-top:4px">Build packs locally with <code>pnpm packs:build</code>; the dev server serves them at /packs/.</div>
    </div>
  {/if}
  {#if app.index}
    <p class="faint num" style="font-size:11px;margin:0 0 var(--space-3)">Index signed (Ed25519, verified) · generated {fmtDate(app.index.generatedAt)}</p>
  {/if}

  <div style="display:flex;flex-direction:column;gap:var(--space-3)">
    {#each listed as m (m.id)}
      {@const inst = installedVersion(m.id)}
      {@const kind = EVIDENCE_KINDS[m.evidenceKind]}
      <div class="panel">
        <div style="display:flex;gap:var(--space-4);align-items:flex-start;flex-wrap:wrap">
          <span class={mark[m.evidenceKind]} style="margin-top:6px"></span>
          <div style="flex:1;min-width:260px">
            <div style="display:flex;gap:var(--space-3);align-items:baseline;flex-wrap:wrap">
              <h4 style="margin:0">{m.title}</h4>
              <span class="faint num" style="font-size:12px">{m.id} {m.version}</span>
              {#if m.core}<span class="tag tag-neutral">core · ships with the app</span>{/if}
            </div>
            <p class="muted" style="font-size:13px;margin:var(--space-2) 0">{m.description}</p>
            <div class="faint num" style="font-size:12px;line-height:1.6">
              {DOMAIN_LABELS[m.scientificDomain]} · {kind.label} evidence · {m.licence} · signed · {fmtBytes(m.size)} · {fmtInt(m.rows)} rows · {m.build}
              <br />Source: <a href={m.source.url} rel="noreferrer noopener" target="_blank">{m.source.name}</a>{m.sourceDate ? ` (${fmtDate(m.sourceDate)})` : ''} · {m.citation}
            </div>
            {#if errors[m.id]}<div class="error-box" style="margin-top:var(--space-3)">{errors[m.id]}</div>{/if}
            {#if busy[m.id] !== undefined}
              <div class="progress" style="margin-top:var(--space-3)"><span style="width:{(busy[m.id] ?? 0) * 100}%"></span></div>
            {/if}
          </div>
          <div style="display:flex;gap:var(--space-2);align-items:center">
            {#if inst}
              {#if inst.sha256 !== m.sha256 && available.some((a) => a.id === m.id)}
                <button class="btn btn-primary" type="button" disabled={busy[m.id] !== undefined} onclick={() => install(m)}>Update to {m.version}</button>
              {:else}
                <span class="tag tag-accent">Installed {inst.version}</span>
              {/if}
              {#if !m.core}<button class="btn btn-ghost" type="button" onclick={() => remove(m.id)}>Remove</button>{/if}
            {:else if !m.core}
              <button class="btn btn-primary" type="button" disabled={busy[m.id] !== undefined} onclick={() => install(m)}>
                {busy[m.id] !== undefined ? 'Downloading…' : `Install · ${fmtBytes(m.size)}`}
              </button>
            {/if}
          </div>
        </div>
      </div>
    {:else}
      <p class="muted">No packs are listed yet.</p>
    {/each}
  </div>
  <p class="notice" style="margin-top:var(--space-6);max-width:720px">
    Licence sits beside the size because it decides whether a pack can ship first-party. Share-alike and non-commercial
    sources only ever ship as separate packs.
  </p>
</div>
