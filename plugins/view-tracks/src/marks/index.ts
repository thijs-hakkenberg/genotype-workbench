/**
 * One renderer per evidence kind (UI design page, 01 and 02).
 *
 * The palette is mono, so kinds separate by form, not hue: how a mark is
 * filled and how its edges end. A hard end is a known bound; a faded end is
 * an unknown one. Nothing here encodes good or bad.
 */
import type { EvidenceKind, TrackItem, TrackKind } from '@gw/plugin-sdk';
import { alpha, type Palette } from '../palette';
import { strandPoint } from '../helix';

export interface MarkContext {
  ctx: CanvasRenderingContext2D;
  palette: Palette;
  width: number;
  height: number;
  /** Map a 1-based genome position to an x pixel. */
  x(pos: number): number;
  /** Pixels per base. */
  scale: number;
  selectedId: string | null;
}

/** A drawn item's clickable box, for hit testing. */
export interface HitBox {
  item: TrackItem;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface MarkRenderer {
  height(items: TrackItem[]): number;
  draw(m: MarkContext, items: TrackItem[]): HitBox[];
}

const DENSITY_THRESHOLD = 1500;
/** The other strand reads the complement, which is what makes it a copy. */
const COMPLEMENT: Record<string, string> = { A: 'T', T: 'A', C: 'G', G: 'C' };

/** What the helix renderer needs of a row, without depending on who built it. */
interface HelixRow {
  drawn: string;
  call: string | null;
  state: 'reference' | 'measured' | 'heterozygous' | 'no-call';
}
/** Pixels per base at which letters replace marks, for calls and for the reference. */
const LETTERS_ABOVE_PX = 5.5;

function hatch(m: MarkContext, x: number, y: number, w: number, h: number) {
  const { ctx, palette } = m;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = palette.n[700];
  ctx.lineWidth = 1;
  for (let i = -h; i < w + h; i += 3) {
    ctx.beginPath();
    ctx.moveTo(x + i, y + h);
    ctx.lineTo(x + i + h, y);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = palette.n[700];
  ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, w - 1), h - 1);
}

function selectedRing(m: MarkContext, x: number, y: number, w: number, h: number) {
  m.ctx.strokeStyle = m.palette.a[200];
  m.ctx.lineWidth = 1;
  m.ctx.strokeRect(x - 2.5, y - 2.5, w + 5, h + 5);
}

/** Density bars when a window holds too many items to draw one by one. */
function density(m: MarkContext, items: TrackItem[], color: string): HitBox[] {
  const { ctx, width, height } = m;
  const binPx = 3;
  const bins = new Float32Array(Math.ceil(width / binPx) + 1);
  const empty = new Float32Array(bins.length);
  for (const it of items) {
    const b = Math.floor(m.x(it.start) / binPx);
    if (b < 0 || b >= bins.length) continue;
    bins[b]! += 1;
    if (it.state === 'no-call') empty[b]! += 1;
  }
  const max = Math.max(1, ...bins);
  const base = height - 8;
  for (let b = 0; b < bins.length; b++) {
    if (!bins[b]) continue;
    const h = Math.max(2, (bins[b]! / max) * (height - 16));
    ctx.fillStyle = color;
    ctx.fillRect(b * binPx, base - h, binPx - 1, h);
    if (empty[b]) {
      const eh = (empty[b]! / bins[b]!) * h;
      hatch(m, b * binPx, base - h, binPx - 1, eh);
    }
  }
  return [];
}

/** measured — a solid block with hard edges; no-calls hatched; A/T and C/G double-outlined. */
export const measured: MarkRenderer = {
  height: () => 58,
  draw(m, items) {
    const { ctx, palette, height } = m;
    ctx.fillStyle = palette.n[800];
    ctx.fillRect(0, Math.round(height / 2), m.width, 1);
    if (items.length > DENSITY_THRESHOLD) return density(m, items, palette.a[500]);
    const letters = m.scale >= LETTERS_ABOVE_PX; // room for the call's own letters
    const w = items.length > 400 ? 2 : 3;
    const hits: HitBox[] = [];
    if (letters) return calls(m, items);
    for (const it of items) {
      const sel = it.id === m.selectedId;
      const h = sel ? 30 : 20;
      const x = Math.round(m.x(it.start) - w / 2);
      const y = Math.round((height - h) / 2);
      if (it.state === 'no-call') {
        hatch(m, x, y, w, h);
      } else {
        if (it.state === 'strand-ambiguous') {
          ctx.fillStyle = palette.a[800];
          ctx.fillRect(x - 1.5, y - 1.5, w + 3, h + 3);
        }
        ctx.fillStyle = palette.a[400];
        ctx.fillRect(x, y, w, h);
      }
      if (sel) selectedRing(m, x, y, w, h);
      hits.push({ item: it, x0: x - 3, x1: x + w + 3, y0: y, y1: y + h });
    }
    return hits;
  },
};

interface CallRowLike {
  a1?: string | null;
  a2?: string | null;
  ref?: string | null;
  is_nocall?: boolean;
}

/**
 * Deep zoom: the kit's own bases, letter by letter. A base that differs from
 * the reference is drawn in the accent, one that matches in the neutral ramp;
 * a no-call keeps the hatched form.
 */
function calls(m: MarkContext, items: TrackItem[]): HitBox[] {
  const { ctx, palette, height } = m;
  const hits: HitBox[] = [];
  const size = Math.min(15, Math.max(7, m.scale * 0.95));
  ctx.font = `500 ${size}px ${palette.font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const it of items) {
    const r = (it.row ?? {}) as CallRowLike;
    const cx = m.x(it.start) + m.scale / 2;
    const sel = it.id === m.selectedId;
    const alleles = [r.a1, r.a2].filter((a): a is string => !!a);
    const rows = r.is_nocall || alleles.length === 0 ? ['—'] : [...new Set(alleles)];
    const top = height / 2 - (rows.length - 1) * (size * 0.62);
    if (r.is_nocall) {
      hatch(m, cx - m.scale / 2 + 1, height / 2 - 10, Math.max(3, m.scale - 2), 20);
    } else {
      rows.forEach((base, i) => {
        const differs = r.ref ? base !== r.ref : false;
        ctx.fillStyle = sel ? palette.a[100] : differs ? palette.a[300] : palette.n[400];
        ctx.fillText(base, cx, top + i * size * 1.24);
      });
    }
    if (sel) {
      ctx.strokeStyle = palette.a[200];
      ctx.strokeRect(cx - m.scale / 2, height / 2 - 16, Math.max(6, m.scale), 32);
    }
    hits.push({ item: it, x0: cx - m.scale / 2, x1: cx + m.scale / 2, y0: 0, y1: height });
  }
  ctx.textAlign = 'start';
  return hits;
}

interface GeneRowLike {
  strand?: string;
  exon_starts?: number[];
  exon_ends?: number[];
  cds_start?: number | null;
  cds_end?: number | null;
}

/** documentary — ruled lines in the neutral ramp, never the accent. */
export const documentary: MarkRenderer = {
  height(items) {
    return 20 + Math.min(lanes(items).lanes, 4) * 26;
  },
  draw(m, items) {
    const { ctx, palette } = m;
    const { assign } = lanes(items, m);
    const hits: HitBox[] = [];
    ctx.font = `10px ${palette.font}`;
    ctx.textBaseline = 'top';
    items.forEach((it, i) => {
      const lane = assign[i]!;
      if (lane >= 4) return;
      const y = 12 + lane * 26;
      const x0 = Math.max(-2, m.x(it.start));
      const x1 = Math.min(m.width + 2, m.x(it.end + 1));
      const r = it.row as GeneRowLike;
      const sel = it.id === m.selectedId;
      ctx.fillStyle = sel ? palette.n[400] : palette.n[700];
      ctx.fillRect(x0, y + 4, Math.max(1, x1 - x0), 1.5);
      const starts = r.exon_starts ?? [];
      const ends = r.exon_ends ?? [];
      for (let e = 0; e < starts.length; e++) {
        const s = starts[e]!;
        const en = ends[e]!;
        const coding = r.cds_start != null && r.cds_end != null && en >= r.cds_start && s <= r.cds_end;
        const ex0 = m.x(s);
        const ex1 = m.x(en + 1);
        if (ex1 < 0 || ex0 > m.width) continue;
        const h = coding ? 9 : 5;
        ctx.fillRect(ex0, y + 5 - h / 2 + 0.5, Math.max(1, ex1 - ex0), h);
      }
      const arrow = r.strand === '-' ? '←' : '→';
      ctx.fillStyle = sel ? palette.n[200] : palette.n[400];
      const label = `${it.label ?? ''} ${arrow}`;
      ctx.fillText(label, Math.max(2, Math.min(x0, m.width - ctx.measureText(label).width - 2)), y + 11);
      hits.push({ item: it, x0, x1: Math.max(x1, x0 + 40), y0: y, y1: y + 24 });
    });
    return hits;
  },
};

function lanes(items: TrackItem[], m?: MarkContext): { lanes: number; assign: number[] } {
  const ends: number[] = [];
  const assign: number[] = [];
  for (const it of items) {
    const start = m ? m.x(it.start) : it.start;
    const labelEnd = m ? Math.max(m.x(it.end + 1), start + 8 + (it.label?.length ?? 0) * 6) : it.end;
    let lane = ends.findIndex((e) => e + (m ? 6 : 0) < start);
    if (lane === -1) {
      lane = ends.length;
      ends.push(labelEnd);
    } else ends[lane] = labelEnd;
    assign.push(lane);
  }
  return { lanes: Math.max(1, ends.length), assign };
}

/** curated-classification — an outline around a judgement, never filled. */
export const classification: MarkRenderer = {
  height: () => 46,
  draw(m, items) {
    const { ctx, palette, height } = m;
    const hits: HitBox[] = [];
    const crowded = items.length > 120;
    ctx.font = `500 9px ${palette.font}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    let lastX = -Infinity;
    let stack = 0;
    for (const it of items) {
      const cx = m.x(it.start);
      stack = cx - lastX < (crowded ? 3 : 22) ? stack + 1 : 0;
      lastX = cx;
      if (stack > 2) continue;
      const sel = it.id === m.selectedId;
      const reviewed = (it.weight ?? 0) >= 1;
      ctx.strokeStyle = sel ? palette.a[200] : reviewed ? palette.a[400] : palette.n[500];
      ctx.lineWidth = sel ? 1.5 : 1;
      if (crowded) {
        const y = 10 + stack * 10;
        ctx.strokeRect(Math.round(cx) - 2.5, y + 0.5, 5, 7);
        hits.push({ item: it, x0: cx - 4, x1: cx + 4, y0: y, y1: y + 8 });
        continue;
      }
      const label = it.label ?? '·';
      const w = Math.max(14, ctx.measureText(label).width + 8);
      const y = 8 + stack * 12;
      const x = Math.round(cx - w / 2) + 0.5;
      ctx.beginPath();
      ctx.roundRect(x, y + 0.5, w, 14, 2);
      ctx.stroke();
      ctx.fillStyle = reviewed ? palette.a[200] : palette.n[300];
      ctx.fillText(label, cx, y + 8);
      hits.push({ item: it, x0: x, x1: x + w, y0: y, y1: y + 15 });
    }
    ctx.textAlign = 'start';
    ctx.fillStyle = palette.n[800];
    ctx.fillRect(0, height - 1, m.width, 1);
    return hits;
  },
};

/** statistical-association — a point inside a plume; the plume is the study population. */
export const association: MarkRenderer = {
  height: () => 70,
  draw(m, items) {
    const { ctx, palette, height } = m;
    const hits: HitBox[] = [];
    const top = 10;
    const bottom = height - 8;
    const maxW = Math.max(8, ...items.map((i) => Math.min(i.weight ?? 0, 60)));
    const y = (w: number) => bottom - (Math.sqrt(Math.min(w, 60)) / Math.sqrt(maxW)) * (bottom - top);
    ctx.fillStyle = palette.n[800];
    ctx.fillRect(0, bottom, m.width, 1);
    // genome-wide significance line, p = 5e-8
    const gw = y(7.3);
    ctx.setLineDash([2, 3]);
    ctx.strokeStyle = palette.n[700];
    ctx.beginPath();
    ctx.moveTo(0, gw + 0.5);
    ctx.lineTo(m.width, gw + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const it of items) {
      const cx = m.x(it.start);
      const cy = y(it.weight ?? 0);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 11);
      g.addColorStop(0, alpha(palette.a[500], 0.28));
      g.addColorStop(1, alpha(palette.a[500], 0));
      ctx.fillStyle = g;
      ctx.fillRect(cx - 11, cy - 11, 22, 22);
    }
    for (const it of items) {
      const cx = m.x(it.start);
      const cy = y(it.weight ?? 0);
      const sel = it.id === m.selectedId;
      ctx.fillStyle = sel ? palette.a[100] : palette.a[300];
      ctx.beginPath();
      ctx.arc(cx, cy, sel ? 3.5 : 2.2, 0, Math.PI * 2);
      ctx.fill();
      if (sel) {
        ctx.strokeStyle = palette.a[200];
        ctx.beginPath();
        ctx.arc(cx, cy, 6, 0, Math.PI * 2);
        ctx.stroke();
      }
      hits.push({ item: it, x0: cx - 5, x1: cx + 5, y0: cy - 5, y1: cy + 5 });
    }
    return hits;
  },
};

/** probabilistic-estimate — a band that fades out at both ends, with a tick at the likeliest value. */
export const estimate: MarkRenderer = {
  height: () => 64,
  draw(m, items) {
    const { ctx, palette, height } = m;
    const hits: HitBox[] = [];
    const top = 8;
    const bottom = height - 8;
    const y = (v: number) => bottom - v * (bottom - top);
    ctx.fillStyle = palette.n[800];
    ctx.fillRect(0, bottom, m.width, 1);
    ctx.fillStyle = palette.n[600];
    ctx.font = `9px ${palette.font}`;
    ctx.textBaseline = 'middle';
    ctx.fillText('1', 2, top);
    ctx.fillText('0', 2, bottom - 5);
    const w = items.length > 300 ? 2 : 4;
    for (const it of items) {
      const cx = m.x(it.start);
      const lo = it.lo ?? it.value ?? 0;
      const hi = it.hi ?? it.value ?? 0;
      const pad = 6; // the fade extends past the bounds: they are not exactly known
      const y0 = y(Math.min(1, hi)) - pad;
      const y1 = y(Math.max(0, lo)) + pad;
      const g = ctx.createLinearGradient(0, y0, 0, y1);
      g.addColorStop(0, alpha(palette.a[500], 0));
      g.addColorStop(0.35, alpha(palette.a[500], 0.55));
      g.addColorStop(0.65, alpha(palette.a[500], 0.55));
      g.addColorStop(1, alpha(palette.a[500], 0));
      ctx.fillStyle = g;
      ctx.fillRect(cx - w / 2, y0, w, y1 - y0);
      const sel = it.id === m.selectedId;
      ctx.fillStyle = sel ? palette.a[100] : palette.a[300];
      ctx.fillRect(cx - w / 2 - 2, Math.round(y(it.value ?? 0)) - 0.5, w + 4, sel ? 2 : 1.5);
      if (sel) selectedRing(m, cx - w / 2, y0 + pad, w, y1 - y0 - 2 * pad);
      hits.push({ item: it, x0: cx - 5, x1: cx + 5, y0, y1 });
    }
    return hits;
  },
};

/**
 * population-frequency — a framed column filled to the allele's share. The
 * frame is the sampled population (a known size, so hard edges); the top of
 * the fill fades across the sampling interval, because that bound is not
 * exactly known. It never reads as a measurement of, or estimate about, you.
 */
export const frequency: MarkRenderer = {
  height: () => 64,
  draw(m, items) {
    const { ctx, palette, height } = m;
    const hits: HitBox[] = [];
    const top = 8;
    const bottom = height - 8;
    const y = (v: number) => bottom - v * (bottom - top);
    ctx.fillStyle = palette.n[600];
    ctx.font = `9px ${palette.font}`;
    ctx.textBaseline = 'middle';
    ctx.fillText('100%', 2, top);
    ctx.fillText('0', 2, bottom - 5);
    const w = items.length > 300 ? 3 : 6;
    for (const it of items) {
      const cx = m.x(it.start);
      const x = Math.round(cx - w / 2) + 0.5;
      const sel = it.id === m.selectedId;
      const v = Math.min(1, Math.max(0, it.value ?? 0));
      const lo = Math.max(0, it.lo ?? v);
      const hi = Math.min(1, it.hi ?? v);
      ctx.strokeStyle = sel ? palette.a[200] : palette.n[600];
      ctx.lineWidth = 1;
      ctx.strokeRect(x, top + 0.5, w, bottom - top);
      // solid share up to the lower bound, then a fade across [lo, hi]
      ctx.fillStyle = alpha(palette.a[500], 0.7);
      ctx.fillRect(x + 0.5, y(lo), w - 1, bottom - y(lo));
      if (hi > lo) {
        const g = ctx.createLinearGradient(0, y(hi), 0, y(lo));
        g.addColorStop(0, alpha(palette.a[500], 0));
        g.addColorStop(1, alpha(palette.a[500], 0.7));
        ctx.fillStyle = g;
        ctx.fillRect(x + 0.5, y(hi), w - 1, y(lo) - y(hi));
      }
      ctx.fillStyle = sel ? palette.a[100] : palette.a[300];
      ctx.fillRect(x - 1, Math.round(y(v)) - 0.5, w + 2, 1.5);
      hits.push({ item: it, x0: x - 3, x1: x + w + 3, y0: top, y1: bottom });
    }
    return hits;
  },
};

/** The reference bases: letters when there is room, a quiet ruler below that. */
/**
 * segment — a stretch two kits match across, drawn with honest ends.
 *
 * A segment is a span, not a point, so it is a bar. The ends carry the
 * finding: where a mismatch bounds the match, the bar stops square, because
 * the match demonstrably ends there; where the run simply left the chip, it
 * fades, because the true end is further on and unknown. This is the edge rule
 * applied to a case where both kinds of end genuinely occur.
 */
export const segment: MarkRenderer = {
  height: (items) => 18 + lanes(items).lanes * 16,
  draw(m, items) {
    const { ctx, palette } = m;
    const hits: HitBox[] = [];
    const { assign } = lanes(items, m);
    items.forEach((it, i) => {
      const y = 10 + assign[i]! * 16;
      const x0 = m.x(it.start);
      const x1 = Math.max(m.x(it.end), x0 + 3);
      const row = it.row as { startKnown?: boolean; endKnown?: boolean };
      const startKnown = row.startKnown !== false;
      const endKnown = row.endKnown !== false;
      const fade = Math.min(14, (x1 - x0) / 3);
      const sel = it.id === m.selectedId;
      const color = sel ? palette.a[300]! : palette.a[500]!;

      const g = ctx.createLinearGradient(x0, 0, x1, 0);
      g.addColorStop(0, alpha(color, startKnown ? 0.85 : 0));
      if (!startKnown && x1 > x0) g.addColorStop(fade / (x1 - x0), alpha(color, 0.85));
      if (!endKnown && x1 > x0) g.addColorStop(1 - fade / (x1 - x0), alpha(color, 0.85));
      g.addColorStop(1, alpha(color, endKnown ? 0.85 : 0));
      ctx.fillStyle = g;
      ctx.fillRect(x0, y, x1 - x0, 9);

      ctx.fillStyle = color;
      if (startKnown) ctx.fillRect(x0, y - 2, 1.5, 13);
      if (endKnown) ctx.fillRect(x1 - 1.5, y - 2, 1.5, 13);
      if (sel) selectedRing(m, x0, y - 2, x1 - x0, 13);
      hits.push({ item: it, x0, x1, y0: y - 2, y1: y + 11 });
    });
    return hits;
  },
};

/**
 * helix — the molecule itself, as a ribbon model.
 *
 * Two backbones winding round a shared axis with the base pairs between them,
 * drawn from the published B-form parameters (see ../helix.ts), so the turn,
 * the right-handedness and the unequal grooves are real rather than stylised.
 * Depth is carried by weight and fade: a strand in front is solid, the same
 * strand behind is thin and faint, and they swap every half turn.
 *
 * What is drawn on it is not all equally known, and the forms say which. A
 * position the chip read where both copies agree carries your own base, marked
 * as measured. A position where your two copies differ carries the reference
 * base and both of your letters beside it: chip data is unphased, so placing
 * either one on this molecule would be a guess about which parent it came
 * from. Everything else is the reference standing in, in the neutral ramp.
 */
export const helix: MarkRenderer = {
  height: () => 132,
  draw(m, items) {
    const { ctx, palette, height } = m;
    const cy = height / 2;
    const radius = height * 0.3;

    if (m.scale < 3) {
      ctx.font = `11px ${palette.font}`;
      ctx.fillStyle = palette.n[600];
      ctx.textBaseline = 'middle';
      ctx.fillText('Zoom in to see the double helix', 12, cy);
      return [];
    }

    const visible = items.filter((it) => {
      const x = m.x(it.start);
      return x > -m.scale * 2 && x < m.width + m.scale * 2;
    });
    if (visible.length === 0) return [];

    const hits: HitBox[] = [];
    const letters = m.scale >= 9;
    const cxOf = (pos: number) => m.x(pos) + m.scale / 2;
    const yOf = (across: number) => cy + across * radius;
    const fade = (depth: number) => 0.22 + 0.78 * ((depth + 1) / 2);

    // Sampled finer than one point per base pair: a turn is only 10.5 bases, so
    // joining the bases directly draws a polygon rather than a curve.
    const from = visible[0]!.start;
    const to = visible[visible.length - 1]!.start;
    type Run = { points: { x: number; y: number }[]; front: boolean };
    const backbone = (strand: 0 | 1): Run[] => {
      const runs: Run[] = [];
      let run: Run | null = null;
      for (let pos = from; pos <= to + 1e-6; pos += 0.2) {
        const sp = strandPoint(pos, strand);
        const point = { x: cxOf(pos), y: yOf(sp.across) };
        const front = sp.depth >= 0;
        if (!run || run.front !== front) {
          if (run) {
            run.points.push(point); // meet at the crossing, so there is no gap
            runs.push(run);
          }
          run = { points: [point], front };
        } else {
          run.points.push(point);
        }
      }
      if (run) runs.push(run);
      return runs;
    };

    const stroke = (runs: Run[]) => {
      for (const run of runs) {
        if (run.points.length < 2) continue;
        // The strands are told apart by depth, not by colour: the near one is
        // solid, the far one thin and faint, and they trade places each half
        // turn. Colour stays free to mean what it means everywhere else.
        ctx.strokeStyle = alpha(palette.n[300]!, run.front ? 0.92 : 0.26);
        ctx.lineWidth = run.front ? 2.4 : 1.1;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(run.points[0]!.x, run.points[0]!.y);
        for (const pt of run.points.slice(1)) ctx.lineTo(pt.x, pt.y);
        ctx.stroke();
      }
    };

    const runs = [...backbone(0), ...backbone(1)];
    stroke(runs.filter((r) => !r.front));

    for (const it of visible) {
      const row = it.row as HelixRow;
      const cx = cxOf(it.start);
      const a = strandPoint(it.start, 0);
      const b = strandPoint(it.start, 1);
      const known = row.state === 'measured';
      const ambiguous = row.state === 'heterozygous';
      const ink = known || ambiguous ? palette.a[400]! : palette.n[500]!;
      const depth = (a.depth + b.depth) / 2;

      ctx.strokeStyle = alpha(ink, fade(depth) * (known || ambiguous ? 1 : 0.45));
      ctx.lineWidth = known || ambiguous ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(cx, yOf(a.across));
      ctx.lineTo(cx, yOf(b.across));
      ctx.stroke();

      // Two copies that disagree: the rung is doubled, the way anything
      // unresolved is doubled elsewhere.
      if (ambiguous) {
        ctx.lineWidth = 1.4;
        for (const dx of [-2.2, 2.2]) {
          ctx.beginPath();
          ctx.moveTo(cx + dx, yOf(a.across));
          ctx.lineTo(cx + dx, yOf(b.across));
          ctx.stroke();
        }
      }
      hits.push({ item: it, x0: cx - m.scale / 2, x1: cx + m.scale / 2, y0: 0, y1: height });
    }

    stroke(runs.filter((r) => r.front));

    if (letters) {
      const size = Math.min(13, Math.max(8, m.scale * 0.72));
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const it of visible) {
        const row = it.row as HelixRow;
        const cx = cxOf(it.start);
        const a = strandPoint(it.start, 0);
        const b = strandPoint(it.start, 1);
        const known = row.state === 'measured';
        const ambiguous = row.state === 'heterozygous';

        // A base sits just inside its own backbone, and is legible over it.
        const write = (text: string, across: number, depth: number, colour: string, weight: number) => {
          const y = yOf(across * 0.58);
          ctx.font = `${weight >= 600 ? '600 ' : ''}${size}px ${palette.font}`;
          ctx.lineWidth = 3;
          ctx.strokeStyle = alpha(palette.bg, 0.85);
          ctx.strokeText(text, cx, y);
          ctx.fillStyle = alpha(colour, fade(depth));
          ctx.fillText(text, cx, y);
        };

        write(row.drawn, a.across, a.depth, known ? palette.a[300]! : palette.n[300]!, known ? 600 : 400);
        write(COMPLEMENT[row.drawn] ?? 'N', b.across, b.depth, palette.n[500]!, 400);

        if (ambiguous && row.call) {
          // Both of your letters, beside the rung rather than on it: neither
          // one can be placed on this molecule.
          ctx.font = `600 ${Math.max(8, size - 2)}px ${palette.font}`;
          ctx.lineWidth = 3;
          ctx.strokeStyle = alpha(palette.bg, 0.9);
          const label = `${row.call[0]}/${row.call[1]}`;
          ctx.strokeText(label, cx, height - 8);
          ctx.fillStyle = palette.a[300]!;
          ctx.fillText(label, cx, height - 8);
        }
        if (it.id === m.selectedId) selectedRing(m, cx - m.scale / 2, 2, Math.max(m.scale, 3), height - 4);
      }
      ctx.textAlign = 'start';
    }
    return hits;
  },
};

export const sequence: MarkRenderer = {
  height: () => 30,
  draw(m, items) {
    const { ctx, palette, height } = m;
    const y = height / 2;
    if (m.scale < 2.2) {
      ctx.font = `11px ${palette.font}`;
      ctx.fillStyle = palette.n[600];
      ctx.textBaseline = 'middle';
      ctx.fillText('Zoom in to read the bases', 12, y);
      return [];
    }
    const letters = m.scale >= LETTERS_ABOVE_PX;
    const size = Math.min(14, Math.max(7, m.scale * 0.95));
    ctx.font = `${size}px ${palette.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const it of items) {
      const seq = String((it.row as { seq?: string }).seq ?? '');
      for (let i = 0; i < seq.length; i++) {
        const pos = it.start + i;
        const cx = m.x(pos) + m.scale / 2;
        if (cx < -m.scale || cx > m.width + m.scale) continue;
        if (letters) {
          ctx.fillStyle = palette.n[400];
          ctx.fillText(seq[i]!, cx, y);
        } else {
          ctx.fillStyle = palette.n[800];
          ctx.fillRect(m.x(pos) + 0.5, y - 5, Math.max(1, m.scale - 1), 10);
        }
      }
    }
    ctx.textAlign = 'start';
    return [];
  },
};

interface CodonRowLike {
  residue?: number;
  aa?: string;
  codon?: string;
  blocks?: [number, number][];
  symbol?: string;
  strand?: string;
}

/** Codons as blocks along the transcript, with their amino acid when it fits. */
export const protein: MarkRenderer = {
  height: () => 34,
  draw(m, items) {
    const { ctx, palette, height } = m;
    const hits: HitBox[] = [];
    const y = 9;
    const h = 16;
    const size = 10;
    ctx.font = `${size}px ${palette.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const it of items) {
      const r = (it.row ?? {}) as CodonRowLike;
      const sel = it.id === m.selectedId;
      const blocks = r.blocks ?? [[it.start, it.end]];
      const even = (r.residue ?? 0) % 2 === 0;
      ctx.fillStyle = sel ? palette.a[800] : even ? palette.n[800] : palette.n[900];
      let widest = { w: 0, cx: 0 };
      for (const [bs, be] of blocks) {
        const x0 = m.x(bs);
        const w = m.x(be + 1) - x0;
        ctx.fillRect(x0, y, Math.max(1, w - 0.5), h);
        if (w > widest.w) widest = { w, cx: x0 + w / 2 };
      }
      if (widest.w >= size * 1.1 && r.aa) {
        ctx.fillStyle = sel ? palette.a[100] : r.aa === '*' ? palette.n[300] : palette.n[400];
        ctx.fillText(r.aa, widest.cx, y + h / 2);
      }
      hits.push({ item: it, x0: m.x(it.start), x1: m.x(it.end + 1), y0: y, y1: y + h });
    }
    if (items.length) {
      const first = (items[0]!.row ?? {}) as CodonRowLike;
      ctx.textAlign = 'start';
      ctx.font = `10px ${palette.font}`;
      ctx.fillStyle = palette.n[500];
      ctx.fillText(`${first.symbol ?? ''} ${first.strand === '-' ? '←' : '→'} · residue ${first.residue ?? ''}…`, 4, height - 6);
    }
    ctx.textAlign = 'start';
    return hits;
  },
};

/** Tracks whose kind decides the form, whatever their evidence kind. */
export const KIND_RENDERERS: Partial<Record<TrackKind, MarkRenderer>> = {
  sequence,
  protein,
  segment,
  helix,
};

export const RENDERERS: Record<EvidenceKind, MarkRenderer> = {
  measured,
  documentary,
  'curated-classification': classification,
  'statistical-association': association,
  'probabilistic-estimate': estimate,
  'population-frequency': frequency,
};

/**
 * Binned density for wide windows, in the evidence kind's own form: measured
 * bins are solid, classifications outlined, associations soft plumes,
 * estimates fade out at the top. Height is the record count per bin.
 */
export const BINS_HEIGHT = 46;

export function drawBins(m: MarkContext, items: TrackItem[], kind: EvidenceKind): HitBox[] {
  const { ctx, palette, height } = m;
  const max = Math.max(1, ...items.map((i) => i.count ?? 0));
  const base = height - 6;
  const hits: HitBox[] = [];
  ctx.fillStyle = palette.n[800];
  ctx.fillRect(0, base, m.width, 1);
  for (const it of items) {
    const x0 = m.x(it.start);
    const w = Math.max(1, m.x(it.end + 1) - x0 - 0.5);
    const h = Math.max(2, Math.sqrt((it.count ?? 0) / max) * (height - 12));
    const y = base - h;
    switch (kind) {
      case 'measured': {
        ctx.fillStyle = palette.a[500];
        ctx.fillRect(x0, y, w, h);
        if (it.value) hatch(m, x0, base - Math.max(1, (it.value / (it.count ?? 1)) * h), w, Math.max(1, (it.value / (it.count ?? 1)) * h));
        break;
      }
      case 'curated-classification':
        ctx.strokeStyle = (it.weight ?? 0) >= 1 ? palette.a[400] : palette.n[500];
        ctx.lineWidth = 1;
        ctx.strokeRect(x0 + 0.5, y + 0.5, Math.max(0, w - 1), h - 1);
        break;
      case 'statistical-association': {
        const g = ctx.createLinearGradient(0, y, 0, base);
        g.addColorStop(0, alpha(palette.a[500], 0.05));
        g.addColorStop(1, alpha(palette.a[500], 0.6));
        ctx.fillStyle = g;
        ctx.fillRect(x0, y, w, h);
        break;
      }
      case 'probabilistic-estimate': {
        const g = ctx.createLinearGradient(0, y, 0, base);
        g.addColorStop(0, alpha(palette.a[500], 0));
        g.addColorStop(1, alpha(palette.a[500], 0.55));
        ctx.fillStyle = g;
        ctx.fillRect(x0, y, w, h);
        break;
      }
      case 'population-frequency':
        ctx.strokeStyle = palette.n[600];
        ctx.lineWidth = 1;
        ctx.strokeRect(x0 + 0.5, y + 0.5, Math.max(0, w - 1), h - 1);
        ctx.fillStyle = alpha(palette.a[500], 0.45);
        ctx.fillRect(x0 + 0.5, y + h / 2, Math.max(0, w - 1), h / 2);
        break;
      case 'documentary':
        ctx.fillStyle = palette.n[600];
        ctx.fillRect(x0, y, w, h);
        break;
    }
    hits.push({ item: it, x0, x1: x0 + Math.max(w, 3), y0: 0, y1: height });
  }
  return hits;
}
