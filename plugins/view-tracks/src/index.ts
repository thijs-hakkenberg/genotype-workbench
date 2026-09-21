/**
 * view-tracks: the base genome view (ADR-0004, iteration 1 note).
 *
 * Framework-free: it mounts into any element, draws each track with the
 * renderer for its evidence kind, and reports region changes and selections.
 */
import type {
  PluginManifest,
  Region,
  TrackItem,
  TrackKind,
  TrackSource,
  ViewHandle,
  ViewOptions,
  ViewPlugin,
} from '@gw/plugin-sdk';
import { EVIDENCE_KINDS } from '@gw/plugin-sdk';
import { clampRegion, formatWidth } from '@gw/plugin-sdk/genome';
import manifestJson from '../manifest.json';
import { BINS_HEIGHT, KIND_RENDERERS, RENDERERS, drawBins, type HitBox, type MarkContext } from './marks';
import { readPalette, type Palette } from './palette';

export { RENDERERS } from './marks';
export { alpha, readPalette, type Palette } from './palette';
export * from './helix';

export const manifest = manifestJson as PluginManifest;

export interface TrackViewHandle extends ViewHandle {
  setSelected(id: string | null): void;
  /** Redraw after the page theme changed. */
  refreshPalette(): void;
}

interface Row {
  source: TrackSource;
  items: TrackItem[];
  error: string | null;
  loading: boolean;
  el: HTMLDivElement;
  label: HTMLDivElement;
  canvas: HTMLCanvasElement;
  hits: HitBox[];
}

const RULER_H = 26;
const LABEL_W = 176;

export class TrackView implements TrackViewHandle {
  private root: HTMLDivElement;
  private ruler: HTMLCanvasElement;
  private rows: Row[] = [];
  private region: Region;
  private selectedId: string | null;
  private palette: Palette;
  private fetchSeq = 0;
  private abort: AbortController | null = null;
  private resize: ResizeObserver;
  private tooltip: HTMLDivElement;
  private drag: { x: number; region: Region; moved: boolean } | null = null;
  private raf = 0;

  constructor(private el: HTMLElement, tracks: TrackSource[], private options: ViewOptions) {
    this.region = clampRegion(options.region);
    this.selectedId = options.selectedId ?? null;
    this.palette = readPalette(el);
    this.root = document.createElement('div');
    this.root.className = 'gw-tracks';
    this.root.style.cssText = 'position:relative;user-select:none;touch-action:none';
    const rulerRow = document.createElement('div');
    rulerRow.style.cssText = `display:grid;grid-template-columns:${LABEL_W}px 1fr;background:var(--color-neutral-900)`;
    const rulerLabel = document.createElement('div');
    rulerLabel.style.cssText = 'font-size:10px;color:var(--color-neutral-500);padding:6px 16px;border-right:1px solid var(--color-divider)';
    rulerLabel.textContent = 'GRCh37';
    this.ruler = document.createElement('canvas');
    this.ruler.style.cssText = `display:block;width:100%;height:${RULER_H}px;cursor:grab`;
    rulerRow.append(rulerLabel, this.ruler);
    this.root.append(rulerRow);
    this.tooltip = document.createElement('div');
    this.tooltip.style.cssText =
      'position:absolute;pointer-events:none;display:none;z-index:5;max-width:320px;padding:6px 9px;font-size:11px;line-height:1.4;' +
      'border-radius:var(--radius-sm);background:var(--color-neutral-900);color:var(--color-text);box-shadow:var(--shadow-md)';
    this.root.append(this.tooltip);
    el.append(this.root);
    this.bindPointer(this.ruler);
    this.setTracks(tracks);
    this.resize = new ResizeObserver(() => this.schedule());
    this.resize.observe(this.root);
  }

  setRegion(region: Region): void {
    const r = clampRegion(region);
    if (r.chrom === this.region.chrom && r.start === this.region.start && r.end === this.region.end) return;
    this.region = r;
    this.load();
  }

  setTracks(tracks: TrackSource[]): void {
    for (const r of this.rows) r.el.remove();
    this.rows = tracks.map((source) => this.makeRow(source));
    this.load();
  }

  setSelected(id: string | null): void {
    this.selectedId = id;
    this.schedule();
  }

  refreshPalette(): void {
    this.palette = readPalette(this.el);
    this.schedule();
  }

  destroy(): void {
    this.abort?.abort();
    this.resize.disconnect();
    cancelAnimationFrame(this.raf);
    this.root.remove();
  }

  private makeRow(source: TrackSource): Row {
    const d = source.descriptor;
    const el = document.createElement('div');
    el.style.cssText = `display:grid;grid-template-columns:${LABEL_W}px 1fr;border-top:1px solid var(--color-divider)`;
    const label = document.createElement('div');
    label.style.cssText =
      'padding:10px 16px;border-right:1px solid var(--color-divider);display:flex;gap:8px;align-items:flex-start;min-width:0';
    const mark = document.createElement('span');
    mark.style.cssText = markSwatch(d.evidenceKind);
    const text = document.createElement('div');
    text.style.cssText = 'min-width:0';
    const title = document.createElement('div');
    title.style.cssText = 'font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    title.textContent = d.title;
    const sub = document.createElement('div');
    sub.style.cssText = 'font-size:10px;color:var(--color-neutral-500);line-height:1.35';
    sub.textContent = `${EVIDENCE_KINDS[d.evidenceKind].short} · ${d.source} · ${d.version}`;
    sub.title = `${EVIDENCE_KINDS[d.evidenceKind].meaning}${d.licence ? ` Licence: ${d.licence}.` : ''}`;
    text.append(title, sub);
    label.append(mark, text);
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;width:100%;cursor:grab';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `${d.title} track`);
    el.append(label, canvas);
    this.root.insertBefore(el, this.tooltip);
    const row: Row = { source, items: [], error: null, loading: true, el, label, canvas, hits: [] };
    this.bindPointer(canvas, row);
    return row;
  }

  private load() {
    this.options.onRegionChange?.(this.region);
    const seq = ++this.fetchSeq;
    this.abort?.abort();
    const abort = (this.abort = new AbortController());
    for (const row of this.rows) {
      row.loading = true;
      row.source
        .itemsIn(this.region, abort.signal)
        .then((items) => {
          if (seq !== this.fetchSeq) return;
          row.items = items;
          row.error = null;
        })
        .catch((e: unknown) => {
          if (seq !== this.fetchSeq || abort.signal.aborted) return;
          row.error = e instanceof Error ? e.message : String(e);
          row.items = [];
        })
        .finally(() => {
          if (seq !== this.fetchSeq) return;
          row.loading = false;
          this.schedule();
        });
    }
    this.schedule();
  }

  private schedule() {
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.draw());
  }

  private context(canvas: HTMLCanvasElement, height: number): MarkContext | null {
    const width = canvas.clientWidth;
    if (width === 0) return null;
    const dpr = window.devicePixelRatio || 1;
    canvas.style.height = `${height}px`;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const { start, end } = this.region;
    const scale = width / (end - start + 1);
    return {
      ctx,
      palette: this.palette,
      width,
      height,
      scale,
      x: (pos) => (pos - start) * scale,
      selectedId: this.selectedId,
    };
  }

  private draw() {
    this.drawRuler();
    for (const row of this.rows) {
      const kind = row.source.descriptor.evidenceKind;
      const renderer = KIND_RENDERERS[row.source.descriptor.kind] ?? RENDERERS[kind];
      const binned = row.items[0]?.count != null;
      const height = binned ? BINS_HEIGHT : renderer.height(row.items);
      const m = this.context(row.canvas, height);
      if (!m) continue;
      row.hits = !row.items.length ? [] : binned ? drawBins(m, row.items, kind) : renderer.draw(m, row.items);
      if (row.error || (!row.loading && row.items.length === 0)) {
        m.ctx.font = `11px ${this.palette.font}`;
        m.ctx.fillStyle = this.palette.n[500];
        m.ctx.textBaseline = 'middle';
        const empty = row.source.descriptor.emptyMessage ?? 'Nothing in this window';
        const message = row.error ? `Could not read this track: ${row.error}` : empty;
        m.ctx.fillText(message, 12, height / 2);
        // Also on the element: text painted into a canvas is invisible to a
        // screen reader, and an empty track has something to say.
        row.canvas.setAttribute('aria-label', `${row.source.descriptor.title}: ${message}`);
      } else {
        // Not "0 drawn" while a query is still running: that is a claim about
        // the window, and it has not been read yet.
        row.canvas.setAttribute(
          'aria-label',
          row.loading
            ? `${row.source.descriptor.title}: reading this window`
            : `${row.source.descriptor.title}: ${row.items.length} drawn in this window`,
        );
      }
      row.label.style.opacity = row.loading ? '0.6' : '1';
    }
  }

  private drawRuler() {
    const m = this.context(this.ruler, RULER_H);
    if (!m) return;
    const { ctx, palette, width } = m;
    const { start, end } = this.region;
    const span = end - start + 1;
    const step = niceStep(span / Math.max(1, width / 110));
    ctx.font = `10px ${palette.font}`;
    ctx.textBaseline = 'top';
    ctx.fillStyle = palette.n[400];
    ctx.strokeStyle = palette.n[700];
    const w = formatWidth(span);
    const reserved = width - ctx.measureText(w).width - 14;
    for (let p = Math.ceil(start / step) * step; p <= end; p += step) {
      const x = Math.round(m.x(p)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, RULER_H - 6);
      ctx.lineTo(x, RULER_H);
      ctx.stroke();
      const text = p.toLocaleString('en-US');
      const tw = ctx.measureText(text).width;
      if (x + 3 + tw < reserved) ctx.fillText(text, x + 3, 7);
    }
    ctx.fillStyle = palette.n[500];
    ctx.fillText(w, width - ctx.measureText(w).width - 6, 7);
  }

  private bindPointer(canvas: HTMLCanvasElement, row?: Row) {
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      this.drag = { x: e.clientX, region: this.region, moved: false };
      canvas.style.cursor = 'grabbing';
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.drag) {
        const dx = e.clientX - this.drag.x;
        if (Math.abs(dx) > 3) this.drag.moved = true;
        if (this.drag.moved) {
          const bpPerPx = (this.drag.region.end - this.drag.region.start + 1) / canvas.clientWidth;
          const shift = Math.round(-dx * bpPerPx);
          this.region = clampRegion({ ...this.drag.region, start: this.drag.region.start + shift, end: this.drag.region.end + shift });
          this.schedule();
        }
        return;
      }
      if (row) this.hover(e, canvas, row);
    });
    const end = (e: PointerEvent) => {
      if (!this.drag) return;
      const moved = this.drag.moved;
      this.drag = null;
      canvas.style.cursor = 'grab';
      if (moved) this.load();
      else if (row) this.click(e, canvas, row);
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', () => (this.tooltip.style.display = 'none'));
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const frac = (e.clientX - rect.left) / rect.width;
        const { start, end } = this.region;
        const span = end - start + 1;
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
          const shift = Math.round((e.deltaX / rect.width) * span);
          this.setRegion({ ...this.region, start: start + shift, end: end + shift });
          return;
        }
        const factor = Math.exp(e.deltaY * 0.0022);
        const newSpan = Math.max(60, Math.round(span * factor));
        const anchor = start + frac * span;
        const ns = Math.round(anchor - frac * newSpan);
        this.setRegion({ chrom: this.region.chrom, start: ns, end: ns + newSpan });
      },
      { passive: false },
    );
  }

  private hit(e: PointerEvent, canvas: HTMLCanvasElement, row: Row): HitBox | undefined {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let best: HitBox | undefined;
    let bestD = Infinity;
    for (const h of row.hits) {
      if (x < h.x0 || x > h.x1 || y < h.y0 - 6 || y > h.y1 + 6) continue;
      const d = Math.abs((h.x0 + h.x1) / 2 - x);
      if (d < bestD) [best, bestD] = [h, d];
    }
    return best;
  }

  private hover(e: PointerEvent, canvas: HTMLCanvasElement, row: Row) {
    const h = this.hit(e, canvas, row);
    if (!h) {
      this.tooltip.style.display = 'none';
      canvas.style.cursor = 'grab';
      return;
    }
    canvas.style.cursor = 'pointer';
    const rootRect = this.root.getBoundingClientRect();
    this.tooltip.textContent = `${h.item.label ?? h.item.id} · ${h.item.start.toLocaleString('en-US')}`;
    this.tooltip.style.display = 'block';
    this.tooltip.style.left = `${Math.min(e.clientX - rootRect.left + 12, rootRect.width - 200)}px`;
    this.tooltip.style.top = `${e.clientY - rootRect.top + 14}px`;
  }

  private click(e: PointerEvent, canvas: HTMLCanvasElement, row: Row) {
    const h = this.hit(e, canvas, row);
    if (!h) return;
    if (h.item.count != null) {
      // A density bin: zoom in on it rather than selecting it.
      const mid = (h.item.start + h.item.end) / 2;
      const span = Math.max(20_000, (h.item.end - h.item.start + 1) * 4);
      this.setRegion({ chrom: this.region.chrom, start: mid - span / 2, end: mid + span / 2 });
      return;
    }
    this.selectedId = h.item.id;
    this.schedule();
    this.options.onSelect?.(row.source.descriptor, h.item);
  }
}

function niceStep(raw: number): number {
  const p = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
  const n = raw / p;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p;
}

/** The small legend swatch next to a track name, one form per evidence kind. */
export function markSwatch(kind: keyof typeof EVIDENCE_KINDS): string {
  const base = 'width:10px;height:10px;margin-top:4px;flex:none;border-radius:2px;display:block;';
  switch (kind) {
    case 'measured':
      return base + 'background:var(--color-accent-400)';
    case 'curated-classification':
      return base + 'border:1.5px solid var(--color-accent-400)';
    case 'statistical-association':
      return base + 'border-radius:50%;background:radial-gradient(circle,var(--color-accent-300) 0 22%,color-mix(in srgb,var(--color-accent-500) 35%,transparent) 30%,transparent 72%)';
    case 'probabilistic-estimate':
      return base + 'background:linear-gradient(to right,transparent,var(--color-accent-500),transparent)';
    case 'population-frequency':
      return base + 'box-shadow:inset 0 0 0 1px var(--color-neutral-500);background:linear-gradient(to top,color-mix(in srgb,var(--color-accent-500) 70%,transparent) 45%,transparent 45%)';
    case 'documentary':
      return base + 'background:repeating-linear-gradient(to bottom,var(--color-neutral-400) 0 1.5px,transparent 1.5px 4px)';
  }
}

export const viewTracks: ViewPlugin = {
  manifest,
  supports: (kind: TrackKind) => ['variant', 'feature', 'signal', 'sequence', 'protein', 'segment', 'helix'].includes(kind),
  mount: (el, tracks, options) => new TrackView(el, tracks, options),
};
