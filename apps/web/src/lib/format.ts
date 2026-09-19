export const fmtInt = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString('en-US'));

export function fmtPct(n: number, digits = 1): string {
  return `${(n * 100).toFixed(digits)}%`;
}

export function fmtBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} kB`;
  return `${n} B`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** p-values span hundreds of orders of magnitude; show them as a×10⁻ⁿ. */
export function fmtP(p: number | null, mlog?: number | null): string {
  if (p == null && mlog == null) return '—';
  const exp = p && p > 0 ? Math.floor(Math.log10(p)) : -Math.ceil(mlog ?? 0);
  const mant = p && p > 0 ? p / 10 ** exp : 1;
  const sup = String(exp).replace(/-/g, '⁻').replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[+d]!);
  return `${mant.toFixed(mant < 9.95 ? 1 : 0)}×10${sup}`;
}
