<script lang="ts">
  import { app } from '../services.svelte';
  import { route } from '../router.svelte';

  const items = $derived([
    { page: 'overview', label: 'Overview', badge: '' },
    { page: 'genome', label: 'Genome view', badge: '' },
    { page: 'lineages', label: 'Lineages', badge: '' },
    { page: 'kits', label: 'Kits', badge: String(app.kits.length) },
    { page: 'packs', label: 'Packs', badge: String(app.installed.filter((p) => !p.manifest.core).length) },
    { page: 'plugins', label: 'Plugins', badge: String(app.plugins.length) },
  ]);
</script>

<nav class="sidenav" aria-label="Sections">
  {#each items as item (item.page)}
    <a href={`#/${item.page}`} aria-current={route.page === item.page || (route.page === 'clinvar' && item.page === 'overview') ? 'page' : undefined}>
      <span class="mark"></span>
      <span>{item.label}</span>
      <span class="badge">{item.badge}</span>
    </a>
  {/each}
  <div class="foot num">
    {app.kits.length} kit{app.kits.length === 1 ? '' : 's'} · {app.installed.filter((p) => !p.manifest.core).length} packs<br />
    locus {app.locusVersion || '…'} · GRCh37
  </div>
</nav>
