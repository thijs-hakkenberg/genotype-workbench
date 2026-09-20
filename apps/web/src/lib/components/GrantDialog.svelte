<script lang="ts">
  /**
   * Two kinds of grant, one dialog.
   *
   * A network grant names the host and says that nothing about you is sent. A
   * kit grant names the actual kits and their data subjects — never a category
   * like "your data" — because someone consenting on a relative's behalf
   * should be able to read the sentence aloud to them
   * (docs/…/Genotype Workbench UI.dc.html section 04).
   */
  import type { GrantRequest, PromptAnswer } from '@gw/plugin-host';
  import { app } from '../services.svelte';
  import { go } from '../router.svelte';
  import { fmtBytes } from '../format';

  let { request }: { request: GrantRequest & { answer(a: PromptAnswer): void } } = $props();
  const kits = $derived(app.kits);

  const subjects = (list: { dataSubject: string; label: string }[]) =>
    list.map((k) => `${k.label} · ${k.dataSubject}`).join(' · ');

  function recordConsent() {
    request.answer('deny');
    go('kits');
  }
</script>

<div class="dialog-backdrop" role="presentation">
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="grant-title">
    <div class="card-kicker">Grant requested</div>
    <div class="dialog-title" id="grant-title">{request.plugin.title} {request.plugin.version}</div>

    {#if request.kind === 'kits'}
      <div class="dialog-body">
        <p style="margin:0 0 var(--space-4)">
          This plugin is asking to read whole kits. Grants are scoped and revocable, and nothing leaves this device.
        </p>
        <div class="kv" style="margin-bottom:var(--space-4)">
          <div>
            <span>Read {request.kits.length} kit{request.kits.length === 1 ? '' : 's'} in full</span>
            <span>{subjects(request.kits)}</span>
          </div>
          <div><span>Purpose</span><span>{request.purpose}</span></div>
          <div>
            <span>No network access</span>
            <span>{request.plugin.permissions?.network?.length ? request.plugin.permissions.network.join(', ') : 'The manifest lists no hosts'}</span>
          </div>
        </div>
        {#if request.excluded.length}
          <p class="notice" style="margin:0">
            {subjects(request.excluded)}
            {request.excluded.length === 1 ? 'is' : 'are'} excluded: no consent record.
            <button class="btn btn-ghost" type="button" onclick={recordConsent}>Record one</button>
          </p>
        {/if}
      </div>
      <div class="dialog-actions">
        <button class="btn btn-ghost" type="button" onclick={() => request.answer('deny')}>Deny</button>
        <button class="btn btn-primary" type="button" onclick={() => request.answer('session')}>Grant for this session</button>
      </div>
    {:else}
      <div class="dialog-body">
        <p style="margin:0 0 var(--space-4)">
          This plugin is asking to reach the network. Grants are scoped and revocable.
        </p>
        <div class="kv" style="margin-bottom:var(--space-4)">
          <div><span>Host</span><span class="num">{request.host}</span></div>
          <div><span>Purpose</span><span>{request.purpose}</span></div>
          {#if request.bytes}
            <div><span>Size</span><span class="num">{fmtBytes(request.bytes)}</span></div>
            {#if app.estimate}<div><span>Storage left for this site</span><span class="num">{fmtBytes(Math.max(0, app.estimate.quota - app.estimate.usage))}</span></div>{/if}
          {/if}
          <div><span>Sends</span><span>Nothing about you: the whole pack is downloaded, so which variants you carry is never sent</span></div>
          <div><span>Kits read</span><span>{kits.length ? 'None — joins happen on this device' : 'None'}</span></div>
        </div>
      </div>
      <div class="dialog-actions">
        <button class="btn btn-ghost" type="button" onclick={() => request.answer('deny')}>Deny</button>
        <button class="btn btn-secondary" type="button" onclick={() => request.answer('session')}>Grant for this session</button>
        <button class="btn btn-primary" type="button" onclick={() => request.answer('persistent')}>Grant until revoked</button>
      </div>
    {/if}
  </div>
</div>
