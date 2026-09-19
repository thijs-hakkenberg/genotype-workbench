<script lang="ts">
  import type { NetworkRequest, PromptAnswer } from '@gw/plugin-host';
  import { app } from '../services.svelte';
  import { fmtBytes } from '../format';

  let { request }: { request: NetworkRequest & { answer(a: PromptAnswer): void } } = $props();
  const kits = $derived(app.kits);
</script>

<div class="dialog-backdrop" role="presentation">
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="grant-title">
    <div class="card-kicker">Grant requested</div>
    <div class="dialog-title" id="grant-title">{request.plugin.title} {request.plugin.version}</div>
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
  </div>
</div>
