// Small colour helpers for the theme studio: reading #hex and rgb() strings, HSV for the
// picker, contrast for the readability marks and a palette made from one accent.

export interface Rgba { r: number; g: number; b: number; a: number }

const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));

/** #rgb, #rgba, #rrggbb, #rrggbbaa, rgb() and rgba(); null when it is none of them */
export function parse(v: string | null | undefined): Rgba | null {
  if (!v) return null;
  const s = v.trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  m = s.match(/^color\(srgb ([^)]+)\)$/);
  if (m) {
    const p = m[1].split(/[\s/]+/).filter(Boolean).map(Number);
    if (p.length < 3 || p.some((x) => Number.isNaN(x))) return null;
    return { r: p[0] * 255, g: p[1] * 255, b: p[2] * 255, a: p.length > 3 ? clamp(p[3]) : 1 };
  }
  m = s.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map((x) => (x.endsWith('%') ? Number(x.slice(0, -1)) / 100 : Number(x)));
    if (p.length < 3 || p.some((x) => Number.isNaN(x))) return null;
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? clamp(p[3]) : 1 };
  }
  return null;
}

const h2 = (n: number) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');
export function hex({ r, g, b, a }: Rgba) {
  return `#${h2(r)}${h2(g)}${h2(b)}${a < 0.998 ? h2(a * 255) : ''}`;
}

/** any CSS colour (var(), color-mix …) as the page draws it now */
export function resolve(v: string): Rgba | null {
  const direct = parse(v);
  if (direct) return direct;
  if (typeof document === 'undefined') return null;
  const probe = document.createElement('span');
  probe.style.color = v;
  document.body.appendChild(probe);
  const c = getComputedStyle(probe).color;
  probe.remove();
  return parse(c);
}

export function withAlpha(v: string, a: number) {
  const c = parse(v);
  return c ? hex({ ...c, a: clamp(a) }) : v;
}

// ---------------------------------------------------------------- HSV / HSL

export function toHsv({ r, g, b }: Rgba) {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
  let h = 0;
  if (d) {
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

export function fromHsv(h: number, s: number, v: number, a = 1): Rgba {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255;
  };
  return { r: f(5), g: f(3), b: f(1), a };
}

export function fromHsl(h: number, s: number, l: number, a = 1): Rgba {
  const k = (n: number) => (n + h / 30) % 12;
  const q = s * Math.min(l, 1 - l);
  const f = (n: number) => (l - q * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))) * 255;
  return { r: f(0), g: f(8), b: f(4), a };
}

export function toHsl(c: Rgba) {
  const { h, s, v } = toHsv(c);
  const l = v * (1 - s / 2);
  return { h, s: l === 0 || l === 1 ? 0 : (v - l) / Math.min(l, 1 - l), l };
}

// ---------------------------------------------------------------- contrast

/** a colour seen over another (for see-through pages) */
export function over(top: Rgba, under: Rgba): Rgba {
  const a = top.a;
  return { r: top.r * a + under.r * (1 - a), g: top.g * a + under.g * (1 - a), b: top.b * a + under.b * (1 - a), a: 1 };
}

function lum({ r, g, b }: Rgba) {
  const f = (c: number) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrast(a: Rgba, b: Rgba) {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

export const isDark = (c: Rgba) => lum(c) < 0.2;

// ---------------------------------------------------------------- a palette from one colour

/** every colour of a theme from its accent, dark or light */
export function paletteFrom(accent: string, dark: boolean): Record<string, string> {
  const a = parse(accent) ?? { r: 120, g: 150, b: 200, a: 1 };
  const { h, s } = toHsl(a);
  const tint = Math.min(0.28, s * 0.3);
  const n = (l: number, sat = tint, alpha = 1) => hex(fromHsl(h, sat, l, alpha));
  const ink = contrast(a, { r: 255, g: 255, b: 255, a: 1 }) >= contrast(a, { r: 10, g: 10, b: 10, a: 1 }) ? '#ffffff' : n(0.09, 0.4);
  if (dark) {
    return {
      ground: n(0.06), surface: n(0.085), raised: n(0.12), active: n(0.155), border: n(0.14), rule: n(0.11), control: n(0.22),
      text: n(0.93, 0.12), muted: n(0.72, 0.1), faint: n(0.6, 0.08),
      accent: hex({ ...a, a: 1 }), accentInk: ink, accentWash: n(0.16, Math.min(0.5, s * 0.6)),
      primary: n(0.93, 0.12), primaryInk: n(0.06), positive: hex(fromHsl(148, 0.45, 0.64)), negative: hex(fromHsl(6, 0.72, 0.72)),
    };
  }
  return {
    ground: n(0.935), surface: n(0.985), raised: n(0.95), active: n(0.9), border: n(0.885), rule: n(0.92), control: n(0.79),
    text: n(0.1, 0.12), muted: n(0.34, 0.08), faint: n(0.42, 0.06),
    accent: hex({ ...a, a: 1 }), accentInk: ink, accentWash: n(0.91, Math.min(0.6, s * 0.7)),
    primary: n(0.12, 0.12), primaryInk: n(0.985), positive: hex(fromHsl(148, 0.45, 0.33)), negative: hex(fromHsl(6, 0.6, 0.42)),
  };
}

/** a random accent that is pleasant to look at */
export function randomAccent() {
  const h = Math.floor(Math.random() * 360);
  return hex(fromHsl(h, 0.55 + Math.random() * 0.35, 0.55 + Math.random() * 0.12));
}
