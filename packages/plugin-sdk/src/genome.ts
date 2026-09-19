import type { Chrom, Region } from './index';

/** GRCh37 chromosomes in canonical order, with length and centromere midpoint (Mb, UCSC hg19 cytoBand). */
export const GRCH37: { chrom: Chrom; length: number; centromereMb: number | null }[] = [
  { chrom: '1', length: 249_250_621, centromereMb: 125.0 },
  { chrom: '2', length: 243_199_373, centromereMb: 93.3 },
  { chrom: '3', length: 198_022_430, centromereMb: 91.0 },
  { chrom: '4', length: 191_154_276, centromereMb: 50.4 },
  { chrom: '5', length: 180_915_260, centromereMb: 48.4 },
  { chrom: '6', length: 171_115_067, centromereMb: 61.0 },
  { chrom: '7', length: 159_138_663, centromereMb: 59.9 },
  { chrom: '8', length: 146_364_022, centromereMb: 45.6 },
  { chrom: '9', length: 141_213_431, centromereMb: 49.0 },
  { chrom: '10', length: 135_534_747, centromereMb: 40.2 },
  { chrom: '11', length: 135_006_516, centromereMb: 53.7 },
  { chrom: '12', length: 133_851_895, centromereMb: 35.8 },
  { chrom: '13', length: 115_169_878, centromereMb: 17.9 },
  { chrom: '14', length: 107_349_540, centromereMb: 17.6 },
  { chrom: '15', length: 102_531_392, centromereMb: 19.0 },
  { chrom: '16', length: 90_354_753, centromereMb: 36.6 },
  { chrom: '17', length: 81_195_210, centromereMb: 24.0 },
  { chrom: '18', length: 78_077_248, centromereMb: 17.2 },
  { chrom: '19', length: 59_128_983, centromereMb: 26.5 },
  { chrom: '20', length: 63_025_520, centromereMb: 27.5 },
  { chrom: '21', length: 48_129_895, centromereMb: 13.2 },
  { chrom: '22', length: 51_304_566, centromereMb: 14.7 },
  { chrom: 'X', length: 155_270_560, centromereMb: 60.6 },
  { chrom: 'Y', length: 59_373_566, centromereMb: 12.5 },
  { chrom: 'MT', length: 16_569, centromereMb: null },
];

export const CHROM_LENGTH = new Map(GRCH37.map((c) => [c.chrom, c.length]));

/** Numeric code shared with the Rust core: 1..22, X=23, Y=24, MT=25. */
export function chromCode(chrom: Chrom): number {
  return chrom === 'X' ? 23 : chrom === 'Y' ? 24 : chrom === 'MT' ? 25 : Number(chrom);
}

export function chromFromCode(code: number): Chrom | null {
  if (code >= 1 && code <= 22) return String(code) as Chrom;
  return code === 23 ? 'X' : code === 24 ? 'Y' : code === 25 ? 'MT' : null;
}

export function parseChrom(s: string): Chrom | null {
  const t = s.trim().replace(/^chr/i, '').toUpperCase();
  if (t === 'M') return 'MT';
  return (CHROM_LENGTH.has(t as Chrom) ? t : null) as Chrom | null;
}

/** Parse `chr2:136,600,000-136,620,000`, `2:136600000` or `chr2`. */
export function parseRegion(text: string, defaultWidth = 20_000): Region | null {
  const m = text.trim().replace(/[,\s]/g, '').match(/^(?:chr)?([0-9]{1,2}|X|Y|MT?)(?::(\d+)(?:[-–](\d+))?)?$/i);
  if (!m) return null;
  const chrom = parseChrom(m[1]!);
  if (!chrom) return null;
  const len = CHROM_LENGTH.get(chrom)!;
  if (!m[2]) return { chrom, start: 1, end: len };
  let start = Number(m[2]);
  let end = m[3] ? Number(m[3]) : start;
  if (end < start) [start, end] = [end, start];
  if (!m[3]) {
    start = Math.max(1, start - defaultWidth / 2);
    end = start + defaultWidth;
  }
  return clampRegion({ chrom, start, end });
}

export function clampRegion(r: Region): Region {
  const len = CHROM_LENGTH.get(r.chrom)!;
  const width = Math.min(Math.max(r.end - r.start, 50), len - 1);
  let start = Math.round(r.start);
  if (start < 1) start = 1;
  if (start + width > len) start = len - width;
  return { chrom: r.chrom, start, end: start + width };
}

export function formatRegion(r: Region): string {
  const f = (n: number) => n.toLocaleString('en-US');
  return `chr${r.chrom}:${f(r.start)}–${f(r.end)}`;
}

export function formatWidth(bp: number): string {
  if (bp >= 1e6) return `${+(bp / 1e6).toFixed(bp >= 1e7 ? 0 : 1)} Mb`;
  if (bp >= 1e3) return `${+(bp / 1e3).toFixed(bp >= 1e4 ? 0 : 1)} kb`;
  return `${bp} bp`;
}
