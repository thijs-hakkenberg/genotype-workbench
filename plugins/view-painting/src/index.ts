/**
 * view-painting: every chromosome at once, with shared stretches painted on.
 *
 * The track view answers "what is at this position". This one answers "where,
 * across the whole genome", which a window a few hundred kilobases wide cannot
 * show. Both draw from the same design rules: form carries the meaning, colour
 * only distinguishes, and an uncertain edge is drawn as one.
 *
 * ADR-0016 records why this is an in-house canvas rather than Gosling: the
 * hard/faded end rule is the whole point of drawing a segment, and no general
 * genomics renderer expresses it.
 */
import { GRCH37 } from '@gw/plugin-sdk/genome';
import type { Region, TrackItem, TrackKind, TrackSource, ViewHandle, ViewOptions, PluginManifest } from '@gw/plugin-sdk';
import { alpha, readPalette, type Palette } from '@gw/view-tracks';
import manifestJson from '../manifest.json';

export const manifest = manifestJson as PluginManifest;

/** Drawn by default; the caller narrows this to whatever it actually analysed. */
const DEFAULT_CHROMS = GRCH37.filter((c) => c.chrom !== 'Y' && c.chrom !== 'MT').map((c) => c.chrom);

const ROW_H = 26;
const BAR_H = 13;
const GAP = 8;
const LABEL_W = 34;
const PAD = 12;
/** A 7 cM segment is only a couple of pixels wide; never let one vanish. */
const MIN_PX = 3;

interface Row {
  chrom: string;
  length: number;
  centromere: number | null;
  y: number;
}

export interface PaintingOptions extends Omit<ViewOptions, 'region'> {
  region?: Region;
  /**
   * Which chromosomes to draw.
   *
   * Only ever the ones the analysis looked at. An empty chromosome drawn
   * beside full ones reads as "nothing found here", so drawing one that was
   * never examined states a finding that was never made.
   */
  chroms?: string[];
}

export class PaintingView implements ViewHandle {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private palette: Palette;
  private tracks: TrackSource[];
  private items = new Map<string, TrackItem[]>();
  private rows: Row[] = [];
  private observer: ResizeObserver;
  private hover: { item: TrackItem; chrom: string } | null = null;
  private tooltip: HTMLDivElement;
  private generation = 0;

  private chroms: typeof GRCH37;
  private longest: number;

  constructor(private el: HTMLElement, tracks: TrackSource[], private options: PaintingOptions = {}) {
    this.tracks = tracks;
    const wanted = new Set(options.chroms ?? DEFAULT_CHROMS);
    this.chroms = GRCH37.filter((c) => wanted.has(c.chrom));
    this.longest = Math.max(...this.chroms.map((c) => c.length), 1);
    this.palette = readPalette(el);

    el.style.position = 'relative';
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'display:block;width:100%;cursor:default';
    el.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    this.tooltip = document.createElement('div');
    this.tooltip.style.cssText =
      'position:absolute;pointer-events:none;display:none;padding:6px 9px;font-size:11px;z-index:2;'
      + 'border-radius:var(--radius-sm);background:var(--color-neutral-900);color:var(--color-text);'
      + 'box-shadow:var(--shadow-md);max-width:260px';
    el.appendChild(this.tooltip);

    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerleave', this.onLeave);
    this.canvas.addEventListener('click', this.onClick);

    this.observer = new ResizeObserver(() => this.draw());
    this.observer.observe(el);
    void this.load();
  }

  setRegion(): void {
    // The whole genome is always in view; there is no window to move.
  }

  setTracks(tracks: TrackSource[]): void {
    this.tracks = tracks;
    void this.load();
  }

  refreshPalette(): void {
    this.palette = readPalette(this.el);
    this.draw();
  }

  destroy(): void {
    this.observer.disconnect();
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerleave', this.onLeave);
    this.canvas.removeEventListener('click', this.onClick);
    this.el.replaceChildren();
  }

  /** Every track, for every chromosome, in one pass. */
  private async load() {
    const generation = ++this.generation;
    const next = new Map<string, TrackItem[]>();
    await Promise.all(
      this.tracks.map(async (t) => {
        const all: TrackItem[] = [];
        for (const c of this.chroms) {
          const items = await t.itemsIn({ chrom: c.chrom as Region['chrom'], start: 1, end: c.length });
          for (const i of items) all.push({ ...i, row: { ...(i.row as object), chrom: c.chrom } });
        }
        next.set(t.descriptor.id, all);
      }),
    );
    if (generation !== this.generation) return; // a newer load overtook this one
    this.items = next;
    this.draw();
  }

  private layout(width: number): number {
    this.rows = this.chroms.map((c, i) => ({
      chrom: c.chrom,
      length: c.length,
      centromere: c.centromereMb,
      y: PAD + i * (ROW_H + GAP),
    }));
    void width;
    return PAD * 2 + this.chroms.length * (ROW_H + GAP);
  }

  private scaleFor(width: number) {
    const usable = width - LABEL_W - PAD * 2;
    return (bp: number) => (bp / this.longest) * usable;
  }

  private draw() {
    const width = this.el.clientWidth || 800;
    const height = this.layout(width);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.height = `${height}px`;
    const { ctx, palette } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const x = this.scaleFor(width);
    const left = LABEL_W + PAD;

    for (const row of this.rows) {
      const top = row.y + (ROW_H - BAR_H) / 2;

      ctx.font = `10px ${palette.font}`;
      ctx.fillStyle = palette.n[500];
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(row.chrom, LABEL_W, row.y + ROW_H / 2);

      // The chromosome itself: a neutral outline, split at the centromere.
      ctx.fillStyle = palette.n[900];
      ctx.strokeStyle = palette.n[700];
      ctx.lineWidth = 1;
      this.chromosomePath(ctx, left, top, x(row.length), BAR_H, row.centromere === null ? null : x(row.centromere * 1e6));
      ctx.fill();
      ctx.stroke();

      for (const track of this.tracks) {
        for (const item of this.items.get(track.descriptor.id) ?? []) {
          if ((item.row as { chrom?: string }).chrom !== row.chrom) continue;
          this.paint(ctx, item, left, top, x);
        }
      }
    }
  }

  /** A rounded bar with a waist at the centromere. */
  private chromosomePath(
    ctx: CanvasRenderingContext2D,
    left: number,
    top: number,
    width: number,
    height: number,
    centromere: number | null,
  ) {
    ctx.beginPath();
    const r = height / 2;
    ctx.roundRect(left, top, Math.max(width, 2), height, r);
    if (centromere !== null && centromere > 4 && centromere < width - 4) {
      // Pinch the outline rather than drawing a coloured band: the centromere
      // is a fact about the chromosome, not a finding about this person.
      ctx.moveTo(left + centromere - 3, top);
      ctx.lineTo(left + centromere, top + height / 2);
      ctx.lineTo(left + centromere - 3, top + height);
      ctx.moveTo(left + centromere + 3, top);
      ctx.lineTo(left + centromere, top + height / 2);
      ctx.lineTo(left + centromere + 3, top + height);
    }
  }

  /**
   * One shared stretch.
   *
   * Where an end is known — a mismatch bounds it — the paint stops square.
   * Where the run merely left the chip, the paint fades out, because the true
   * end is somewhere further on and nobody knows where.
   */
  private paint(
    ctx: CanvasRenderingContext2D,
    item: TrackItem,
    left: number,
    top: number,
    x: (bp: number) => number,
  ) {
    const x0 = left + x(item.start);
    const x1 = Math.max(left + x(item.end), x0 + MIN_PX);
    const row = item.row as { startKnown?: boolean; endKnown?: boolean };
    const fade = Math.min(10, (x1 - x0) / 3);
    const accent = this.palette.a[400]!;

    const gradient = ctx.createLinearGradient(x0, 0, x1, 0);
    const startKnown = row.startKnown !== false;
    const endKnown = row.endKnown !== false;
    gradient.addColorStop(0, alpha(accent, startKnown ? 1 : 0));
    if (!startKnown && x1 - x0 > 0) gradient.addColorStop(fade / (x1 - x0), alpha(accent, 1));
    if (!endKnown && x1 - x0 > 0) gradient.addColorStop(1 - fade / (x1 - x0), alpha(accent, 1));
    gradient.addColorStop(1, alpha(accent, endKnown ? 1 : 0));

    ctx.fillStyle = gradient;
    ctx.fillRect(x0, top + 2, x1 - x0, BAR_H - 4);

    // A hard end is also a line, so it reads as a boundary at any width.
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1;
    if (startKnown) line(ctx, x0 + 0.5, top, BAR_H);
    if (endKnown) line(ctx, x1 - 0.5, top, BAR_H);
  }

  private hit(px: number, py: number): { item: TrackItem; chrom: string } | null {
    const width = this.el.clientWidth || 800;
    const x = this.scaleFor(width);
    const left = LABEL_W + PAD;
    for (const row of this.rows) {
      if (py < row.y || py > row.y + ROW_H) continue;
      for (const track of this.tracks) {
        for (const item of this.items.get(track.descriptor.id) ?? []) {
          if ((item.row as { chrom?: string }).chrom !== row.chrom) continue;
          const x0 = left + x(item.start);
          const x1 = Math.max(left + x(item.end), x0 + MIN_PX);
          if (px >= x0 - 2 && px <= x1 + 2) return { item, chrom: row.chrom };
        }
      }
    }
    return null;
  }

  private onMove = (e: PointerEvent) => {
    const rect = this.canvas.getBoundingClientRect();
    const found = this.hit(e.clientX - rect.left, e.clientY - rect.top);
    this.canvas.style.cursor = found ? 'pointer' : 'default';
    if (!found) return this.onLeave();
    this.hover = found;
    this.tooltip.textContent = found.item.label ?? '';
    this.tooltip.style.display = 'block';
    this.tooltip.style.left = `${Math.min(e.clientX - rect.left + 12, rect.width - 260)}px`;
    this.tooltip.style.top = `${e.clientY - rect.top + 14}px`;
  };

  private onLeave = () => {
    this.hover = null;
    this.tooltip.style.display = 'none';
  };

  private onClick = () => {
    if (!this.hover) return;
    const track = this.tracks[0];
    if (track) this.options.onSelect?.(track.descriptor, this.hover.item);
  };
}

function line(ctx: CanvasRenderingContext2D, x: number, top: number, height: number) {
  ctx.beginPath();
  ctx.moveTo(x, top + 1);
  ctx.lineTo(x, top + height - 1);
  ctx.stroke();
}

export const viewPainting = {
  manifest,
  supports: (kind: TrackKind) => kind === 'segment',
  mount: (el: HTMLElement, tracks: TrackSource[], options: ViewOptions) => new PaintingView(el, tracks, options),
};
