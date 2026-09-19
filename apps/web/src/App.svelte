<script lang="ts">
  import { onMount } from 'svelte';
  import { app, boot } from './lib/services.svelte';
  import { route } from './lib/router.svelte';
  import Header from './lib/components/Header.svelte';
  import SideNav from './lib/components/SideNav.svelte';
  import GrantDialog from './lib/components/GrantDialog.svelte';
  import Overview from './routes/Overview.svelte';
  import Genome from './routes/Genome.svelte';
  import Import from './routes/Import.svelte';
  import Kits from './routes/Kits.svelte';
  import Packs from './routes/Packs.svelte';
  import Plugins from './routes/Plugins.svelte';
  import Clinvar from './routes/Clinvar.svelte';

  onMount(boot);
</script>

<div class="shell">
  <Header />
  <div class="body">
    <SideNav />
    <main>
      {#if app.phase === 'booting'}
        <div class="page">
          <div class="card-kicker">Starting</div>
          <h4 style="margin:6px 0">{app.bootStep}…</h4>
          <p class="notice">Everything runs in this browser. Nothing you import leaves this device.</p>
        </div>
      {:else if app.phase === 'failed'}
        <div class="page">
          <div class="card-kicker">Could not start</div>
          <h4 style="margin:6px 0 var(--space-4)">The workbench could not open its local storage</h4>
          <div class="error-box">{app.error}</div>
          <p class="notice" style="margin-top:var(--space-4)">
            Genotype Workbench keeps kits in the browser's private file system. Private windows and some browsers block it.
          </p>
        </div>
      {:else if route.page === 'genome'}
        <Genome />
      {:else if route.page === 'import'}
        <Import />
      {:else if route.page === 'kits'}
        <Kits />
      {:else if route.page === 'packs'}
        <Packs />
      {:else if route.page === 'plugins'}
        <Plugins />
      {:else if route.page === 'clinvar'}
        <Clinvar />
      {:else}
        <Overview />
      {/if}
    </main>
  </div>
</div>

{#if app.grantRequest}
  <GrantDialog request={app.grantRequest} />
{/if}
