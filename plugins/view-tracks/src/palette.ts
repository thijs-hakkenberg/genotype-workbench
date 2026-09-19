/** Colours come from the Nocturne tokens on the page, never hard-coded. */
export interface Palette {
  bg: string;
  surface: string;
  text: string;
  divider: string;
  n: Record<100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900, string>;
  a: Record<100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900, string>;
  font: string;
}

export function readPalette(el: Element): Palette {
  const cs = getComputedStyle(el);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  const ramp = (role: string) =>
    Object.fromEntries([100, 200, 300, 400, 500, 600, 700, 800, 900].map((s) => [s, v(`--color-${role}-${s}`)])) as Palette['n'];
  return {
    bg: v('--color-bg'),
    surface: v('--color-surface'),
    text: v('--color-text'),
    divider: v('--color-divider'),
    n: ramp('neutral'),
    a: ramp('accent'),
    font: v('--font-body') || 'system-ui, sans-serif',
  };
}

const rgbCache = new Map<string, [number, number, number]>();
let probe: CanvasRenderingContext2D | null = null;

/** Resolve any CSS colour the canvas understands (hex, oklch, ...) to RGB. */
function rgb(color: string): [number, number, number] {
  let v = rgbCache.get(color);
  if (v) return v;
  probe ??= Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', {
    willReadFrequently: true,
  })!;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = color;
  probe.fillRect(0, 0, 1, 1);
  const d = probe.getImageData(0, 0, 1, 1).data;
  v = [d[0]!, d[1]!, d[2]!];
  rgbCache.set(color, v);
  return v;
}

/** A token colour with alpha, for gradients (plumes and faded ends). */
export function alpha(color: string, a: number): string {
  const [r, g, b] = rgb(color);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
