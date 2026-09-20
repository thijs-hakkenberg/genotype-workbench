<script lang="ts">
  /**
   * The helix seen end-on, looking straight down the axis.
   *
   * The track beside the other evidence shows the molecule from the side. This
   * is the same geometry from the other direction, where the turn is the
   * shape: base pairs stack away from you, each one about a tenth of a turn
   * further round, which is why the ten or so nearest form a rosette.
   *
   * Drawn from the same B-form parameters as the track, so the two views
   * cannot disagree. Mol* will render the atoms here later (ADR-0017).
   */
  import type { Chrom } from '@gw/plugin-sdk';
  import { B_DNA, lengthOf, readPalette, strandOffsetDeg, strandPoint, turnsIn } from '@gw/view-tracks';
  import { viewName, type Kit } from '@gw/genotype-store';
  import { svc } from '../services.svelte';

  let { kit, chrom, pos }: { kit: Kit | null; chrom: Chrom; pos: number } = $props();

  /** Base pairs either side of the selected one. */
  const SPAN = 12;

  let canvas = $state<HTMLCanvasElement | null>(null);
  let rows = $state<{ start: number; drawn: string; state: string; call: string | null }[]>([]);
  let note = $state('');

  $effect(() => {
    const c = chrom;
    const p = pos;
    const k = kit;
    rows = [];
    note = '';
    const track = svc().library.helixTrack(k ? viewName(k.kitId) : null);
    if (!track) {
      note = 'Install the reference sequence pack to see the molecule.';
      return;
    }
    void track
      .itemsIn({ chrom: c, start: p - SPAN, end: p + SPAN })
      .then((items) => {
        rows = items.map((it) => ({ start: it.start, ...(it.row as { drawn: string; state: string; call: string | null }) }));
        if (rows.length === 0) note = 'No reference bases here: that pack covers coding exons and chip positions.';
      })
      .catch((e: unknown) => (note = e instanceof Error ? e.message : String(e)));
  });

  $effect(() => {
    const el = canvas;
    const data = rows;
    if (!el || data.length === 0) return;
    const palette = readPalette(el);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = 236;
    el.width = size * dpr;
    el.height = size * dpr;
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    const ctx = el.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    const cx = size / 2;
    const cy = size / 2;
    const radius = size * 0.36;

    // The backbones, which end-on are simply the circle they wind around.
    ctx.strokeStyle = palette.n[800];
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Furthest first, so the nearest base pair ends up on top.
    const ordered = [...data].sort((a, b) => Math.abs(b.start - pos) - Math.abs(a.start - pos));
    for (const row of ordered) {
      const away = Math.abs(row.start - pos);
      if (away > SPAN) continue;
      const a = strandPoint(row.start, 0);
      const b = strandPoint(row.start, 1);
      const here = row.start === pos;
      const known = row.state === 'measured';
      const ambiguous = row.state === 'heterozygous';
      // Distance down the axis reads as fade: further away, fainter.
      const strength = Math.max(0.08, 1 - away / (SPAN + 2));
      const ink = here || known || ambiguous ? palette.a[400]! : palette.n[400]!;

      ctx.globalAlpha = here ? 1 : strength * 0.75;
      ctx.strokeStyle = ink;
      ctx.lineWidth = here ? 2.6 : known || ambiguous ? 1.6 : 1;
      ctx.beginPath();
      ctx.moveTo(cx + a.across * radius, cy + a.depth * radius);
      ctx.lineTo(cx + b.across * radius, cy + b.depth * radius);
      ctx.stroke();

      if (here) {
        ctx.globalAlpha = 1;
        ctx.font = `600 13px ${palette.font}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const pull = 1.16;
        ctx.fillStyle = palette.a[300]!;
        ctx.fillText(row.drawn, cx + a.across * radius * pull, cy + a.depth * radius * pull);
        ctx.fillStyle = palette.n[400]!;
        const complement: Record<string, string> = { A: 'T', T: 'A', C: 'G', G: 'C' };
        ctx.fillText(complement[row.drawn] ?? 'N', cx + b.across * radius * pull, cy + b.depth * radius * pull);
        ctx.textAlign = 'start';
      }
    }
    ctx.globalAlpha = 1;
  });

  const here = $derived(rows.find((r) => r.start === pos));
  const shown = $derived(rows.filter((r) => Math.abs(r.start - pos) <= SPAN).length);
</script>

<div class="helix-card">
  <div class="helix-figure">
    {#if note}
      <p class="faint" style="font-size:11px;margin:0">{note}</p>
    {:else}
      <canvas bind:this={canvas} aria-label="The double helix seen end-on, looking down its axis"></canvas>
    {/if}
  </div>
  <div class="helix-facts">
    <div class="kv">
      <div><span>Seen</span><span>End-on, down the axis</span></div>
      <div><span>Base pairs shown</span><span class="num">{shown}</span></div>
      <div><span>That is</span><span class="num">{lengthOf(shown).nm.toFixed(1)} nm · {turnsIn(shown).toFixed(1)} turns</span></div>
      <div><span>Turn</span><span class="num">{B_DNA.perTurn} bp · {B_DNA.riseA} Å rise</span></div>
      <div><span>Across</span><span class="num">{B_DNA.diameterA} Å</span></div>
      <div>
        <span>Grooves</span>
        <span class="num">{B_DNA.minorGrooveA} Å / {B_DNA.majorGrooveA} Å · {strandOffsetDeg().toFixed(0)}° apart</span>
      </div>
    </div>
    {#if here?.state === 'heterozygous'}
      <p class="notice" style="margin:var(--space-3) 0 0">
        Your two copies differ here ({here.call?.[0]}/{here.call?.[1]}), and chip data is unphased, so neither base can
        be placed on this molecule. The reference base is drawn.
      </p>
    {:else if here?.state === 'measured'}
      <p class="notice" style="margin:var(--space-3) 0 0">
        Both your copies read {here.drawn} here, so either molecule carries it. The rest of the bases shown are the
        reference: the chip reads positions, not stretches.
      </p>
    {:else}
      <p class="notice" style="margin:var(--space-3) 0 0">
        A ribbon model from published B-form measurements, not an atomic structure, and not a picture of your own
        molecule: the bases shown are the GRCh37 reference except where your chip read one.
      </p>
    {/if}
  </div>
</div>

<style>
  .helix-card {
    display: flex;
    gap: var(--space-5);
    flex-wrap: wrap;
    align-items: flex-start;
  }
  .helix-figure {
    min-width: 236px;
  }
  .helix-facts {
    flex: 1;
    min-width: 260px;
  }
  canvas {
    display: block;
    border-radius: var(--radius-sm);
    background: var(--color-bg);
  }
</style>
