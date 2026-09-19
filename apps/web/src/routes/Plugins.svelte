<script lang="ts">
  import { app, svc } from '../lib/services.svelte';
  import { fmtDate } from '../lib/format';

  const grantsFor = (id: string) => app.grants.filter((g) => g.pluginId === id);
</script>

<div class="page">
  <div class="page-head">
    <div>
      <div class="card-kicker">Plugin Host</div>
      <h2>Plugins</h2>
      <div class="sub">Everything beyond the core is a plugin. None reaches the network unless its manifest lists a host and you grant it.</div>
    </div>
  </div>
  <div style="display:flex;flex-direction:column;gap:var(--space-3)">
    {#each app.plugins as p (p.id)}
      <div class="panel">
        <div style="display:flex;gap:var(--space-4);align-items:baseline;flex-wrap:wrap">
          <h4 style="margin:0">{p.title}</h4>
          <span class="faint num" style="font-size:12px">{p.id} {p.version} · host API {p.hostApi}</span>
          <span style="margin-left:auto;display:flex;gap:6px">
            {#each p.capabilities as c (c)}<span class="tag tag-neutral">{c}</span>{/each}
            {#if p.firstParty}<span class="tag tag-outline">first party</span>{/if}
          </span>
        </div>
        {#if p.description}<p class="muted" style="font-size:13px;margin:var(--space-3) 0 0">{p.description}</p>{/if}
        <div class="kv" style="margin-top:var(--space-4);max-width:640px;font-size:12px">
          <div><span>Network</span><span>{p.permissions?.network?.length ? `may ask for: ${p.permissions.network.map((h) => (h === 'self' ? location.host : h)).join(', ')}` : 'none — the manifest lists no hosts'}</span></div>
          {#each grantsFor(p.id) as g (g.id)}
            <div>
              <span>Granted {g.scope === 'session' ? 'for this session' : 'until revoked'} · {fmtDate(g.grantedAt)}</span>
              <span>{g.networkHosts?.join(', ')} <button class="btn btn-ghost" type="button" onclick={() => svc().host.revoke(g.id)}>Revoke</button></span>
            </div>
          {/each}
        </div>
      </div>
    {/each}
  </div>
</div>
