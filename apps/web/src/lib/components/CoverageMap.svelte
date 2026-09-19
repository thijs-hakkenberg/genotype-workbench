<script lang="ts">
  import { GRCH37 } from '@gw/plugin-sdk/genome';
  import type { DensityBin } from '@gw/genotype-store';
  import { go } from '../router.svelte';

  /** Probe density per chromosome, drawn to GRCh37 length and split at the centromere. */
  let { bins, binSize }: { bins: DensityBin[]; binSize: number } = $props();

  const maxLen = GRCH37[0]!.length;
  const rows = $derived.by(() => {
    const byChrom = new Map<string, DensityBin[]>();
    for (const b of bins) (byChrom.get(b.chrom) ?? byChrom.set(b.chrom, []).get(b.chrom)!).push(b);
    const peak = Math.max(1, ...bins.map((b) => b.calls));
    return GRCH37.filter((c) => c.chrom !== 'MT').map((c) => {
      const list = byChrom.get(c.chrom) ?? [];
      const n = Math.ceil(c.length / binSize);
      const cells = new Float32Array(n);
      let total = 0;
      for (const b of list) {
        if (b.bin < n) cells[b.bin] = b.calls / peak;
        total += b.calls;
      }
      return { ...c, cells, total, pct: (c.length / maxLen) * 100 };
    });
  });

  function paint(canvas: HTMLCanvasElement, cells: Float32Array) {
    const draw = (cells: Float32Array) => {
      const cs = getComputedStyle(canvas);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const dpr = devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext('2d')!;
      ctx.scale(dpr, dpr);
      ctx.fillStyle = cs.getPropertyValue('--color-neutral-900');
      ctx.fillRect(0, 0, w, h);
      const accent = cs.getPropertyValue('--color-accent-500');
      const step = w / cells.length;
      for (let i = 0; i < cells.length; i++) {
        const v = cells[i]!;
        if (v <= 0) continue;
        ctx.globalAlpha = 0.25 + 0.75 * Math.min(1, v * 1.4);
        ctx.fillStyle = accent;
        ctx.fillRect(i * step, 0, Math.max(1, step - 0.5), h);
      }
      ctx.globalAlpha = 1;
    };
    draw(cells);
    const ro = new ResizeObserver(() => draw(cells));
    ro.observe(canvas);
    return { update: (c: Float32Array) => draw(c), destroy: () => ro.disconnect() };
  }
</script>

<div class="coverage">
  {#each rows as r (r.chrom)}
    <button type="button" class="row" onclick={() => go(`genome/${r.chrom}:1-${r.length}`)} title="Open chromosome {r.chrom}">
      <span class="name num">{r.chrom}</span>
      <span class="track">
        <span class="bar" style="width:{r.pct.toFixed(2)}%">
          <canvas use:paint={r.cells} aria-label="Probe density on chromosome {r.chrom}"></canvas>
          {#if r.centromereMb}
            <span class="cen" style="left:{((r.centromereMb * 1e6) / r.length) * 100}%"></span>
          {/if}
        </span>
      </span>
      <span class="count num">{r.total >= 1000 ? `${(r.total / 1000).toFixed(1)}k` : r.total}</span>
    </button>
  {/each}
</div>

<style>
  .coverage { display: grid; grid-template-columns: 1fr 1fr; gap: 0 var(--space-8); }
  .row { display: flex; align-items: center; gap: 10px; width: 100%; padding: 4px 6px; border: 0; background: transparent; cursor: pointer; border-radius: var(--radius-sm); color: inherit; }
  .row:hover { box-shadow: inset 0 0 0 1px var(--color-accent-700); }
  .name { width: 26px; flex: none; text-align: right; font-size: 11px; color: var(--color-neutral-400); }
  .track { flex: 1; min-width: 0; display: block; }
  .bar { position: relative; display: block; height: 11px; min-width: 14px; }
  canvas { display: block; width: 100%; height: 11px; border-radius: 2px; }
  .cen { position: absolute; top: -1px; bottom: -1px; width: 4px; margin-left: -2px; background: var(--color-bg); box-shadow: inset 0 0 0 1px var(--color-neutral-700); }
  .count { width: 52px; flex: none; text-align: right; font-size: 10px; color: var(--color-neutral-500); }
  @media (max-width: 900px) { .coverage { grid-template-columns: 1fr; } }
</style>
