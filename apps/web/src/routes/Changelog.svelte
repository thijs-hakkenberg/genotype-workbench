<script lang="ts">
  /** What changed, from the CHANGELOG.md in the repository. */
  import { fragments, parseChangelog } from '../lib/changelog';
  import { app } from '../lib/services.svelte';

  const releases = parseChangelog();
  const current = __APP_VERSION__;
</script>

<div class="page">
  <div class="page-head">
    <div style="max-width:760px">
      <div class="card-kicker">Genotype Workbench</div>
      <h2>What changed</h2>
      <div class="sub">
        Milestones follow the roadmap in the architecture notes. The version here is the workbench's own: the locus
        version shown beside each kit records which normalizer produced that kit's calls, and moves only when that
        code does — currently {app.locusVersion || '…'}.
      </div>
    </div>
  </div>

  {#each releases as release (release.version)}
    <section class="panel" style="margin-bottom:var(--space-3)">
      <div class="card-kicker">
        {release.date}{release.version === current ? ' · running now' : ''}
      </div>
      <h4 style="display:flex;align-items:center;gap:var(--space-3)">
        <span class="num">{release.version}</span>
        {#if release.version === current}<span class="tag tag-accent">This version</span>{/if}
      </h4>
      {#if release.summary}<p class="sub" style="margin:0 0 var(--space-4)">{release.summary}</p>{/if}

      {#each release.sections as section, s (s)}
        {#if section.title}
          <div class="card-kicker" style="margin-top:var(--space-4)">{section.title}</div>
        {/if}
        <ul style="margin:var(--space-2) 0 0;padding-left:1.1em;line-height:1.7">
          {#each section.items as item, i (i)}
            <li>
              {#each fragments(item) as f, j (j)}
                {#if f.style === 'strong'}<strong>{f.text}</strong>
                {:else if f.style === 'code'}<span class="num">{f.text}</span>
                {:else}{f.text}{/if}
              {/each}
            </li>
          {/each}
        </ul>
      {/each}
    </section>
  {/each}

  <p class="notice">
    The same file lives at <span class="num">CHANGELOG.md</span> in the repository, so what you read here and what a
    reader sees there are never out of step.
  </p>
</div>
