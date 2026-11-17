// Themes people make: a built-in theme as the base, and on top of it every colour, the
// type, corners, surfaces, the backdrop, the touches (buttons, menu, covers, titles),
// rules for single parts of the window and free CSS. The active one is written into
// one <style> on <head>; a copy is kept in local storage so the first paint has it.
import { useEffect, useState } from 'react';
import { api, isDesktop } from './backend';
import { hex, parse } from './color';
import { layoutCss, showLayout, type LayoutSet } from './layout';

export type { LayoutSet };

export const COLOR_KEYS = [
  'ground', 'surface', 'raised', 'border', 'text', 'muted', 'accent', 'accentInk', 'positive', 'negative',
  'active', 'rule', 'control', 'faint', 'accentWash', 'primary', 'primaryInk', 'coverShade',
] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];
/** the ones left empty follow the others */
export const FINE_KEYS: ColorKey[] = ['active', 'rule', 'control', 'faint', 'accentWash', 'primary', 'primaryInk', 'coverShade'];

export interface Radii { sheet?: number; card?: number; cover?: number; control?: number; chip?: number }
export interface TypeSet {
  body?: string | null;
  heading?: string | null;
  /** the whole window, in per cent */
  scale?: number;
  bodyWeight?: number;
  weight?: number;
  /** heading letter spacing, thousandths of an em */
  tracking?: number;
  caps?: boolean;
}
export interface FontFile { name: string; data: string }
export interface SurfaceSet {
  blur?: number;
  border?: number;
  shadow?: number;
  glow?: boolean;
  /** the space around the page */
  gap?: number;
}
export type BackdropKind = 'base' | 'solid' | 'gradient' | 'mesh' | 'image';
export type PatternKind = 'none' | 'grid' | 'dots' | 'lines' | 'diagonal' | 'noise';
export interface Backdrop {
  kind: BackdropKind;
  colors?: string[];
  angle?: number;
  image?: string | null;
  fit?: 'cover' | 'contain' | 'tile';
  dim?: number;
  blur?: number;
  pattern?: PatternKind;
  patternColor?: string;
  patternSize?: number;
  patternOpacity?: number;
}
export interface Touches {
  button?: 'base' | 'flat' | 'gradient' | 'glow' | 'outline' | 'soft';
  nav?: 'base' | 'fill' | 'bar' | 'glow' | 'outline' | 'pill';
  hover?: 'base' | 'lift' | 'ring' | 'glow' | 'zoom' | 'none';
  heading?: 'base' | 'plain' | 'accent' | 'gradient';
  /** the second colour of gradients (the first is the accent) */
  second?: string;
  scrollbar?: 'base' | 'thin' | 'accent' | 'hidden';
}
export const RULE_PROPS = [
  'background', 'color', 'border-color', 'border-width', 'border-radius', 'box-shadow', 'opacity',
  'font-size', 'font-weight', 'letter-spacing', 'text-transform', 'backdrop-filter', 'filter', 'display',
] as const;
export type RuleProp = (typeof RULE_PROPS)[number];
export interface Rule { sel: string; label?: string; props: Partial<Record<RuleProp, string>> }

export interface CustomTheme {
  id: string;
  name: string;
  author?: string | null;
  /** a built-in theme id: its backdrop and touches stay unless replaced */
  base: string;
  colors: Partial<Record<ColorKey, string>>;
  radii?: Radii | null;
  type?: TypeSet | null;
  fonts?: FontFile[] | null;
  surface?: SurfaceSet | null;
  backdrop?: Backdrop | null;
  touches?: Touches | null;
  layout?: LayoutSet | null;
  rules?: Rule[] | null;
  css?: string | null;
  /** older files: one corner size and a raw background */
  radius?: number | null;
  background?: string | null;
}

const ACTIVE = 'tessera.customTheme';
const DEMO_LIST = 'tessera.customThemes';

export const cssVar = (k: ColorKey) => `--${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

/** CSS from a theme file may not reach the network or run anything */
export function safeCss(css: string) {
  return css
    .replace(/@import[^;]*;?/gi, '')
    .replace(/url\(\s*(['"]?)(?!data:)[^)]*\)/gi, 'none')
    .replace(/expression\s*\(/gi, '(')
    .replace(/javascript:/gi, '')
    .replace(/<\/?style[^>]*>/gi, '')
    .slice(0, 40000);
}
/** one value inside a declaration */
const val = (v: string) => safeCss(String(v)).replace(/[;{}<>]/g, '').slice(0, 300);
/** a colour from a theme file, or null */
const col = (v: unknown) => {
  if (typeof v !== 'string') return null;
  const c = parse(v);
  if (c) return hex(c);
  return /^(var\(--[a-z-]+\)|transparent|currentcolor)$/i.test(v.trim()) ? v.trim() : null;
};
/** a font family name */
export const fontName = (v: unknown) => (typeof v === 'string' ? v.replace(/[^\p{L}\p{N} _.'-]/gu, '').trim().slice(0, 64) : '');
/** a selector for one rule */
export const cleanSel = (v: unknown) => (typeof v === 'string' ? v.replace(/[{}<>;@\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 240) : '');
const dataUrl = (v: unknown, kinds: RegExp) => (typeof v === 'string' && kinds.test(v) && !/[)'"\s]/.test(v) ? v : null);
const IMAGE = /^data:image\/(png|jpe?g|webp|gif|avif);base64,/i;
const FONT = /^data:(font\/(ttf|otf|woff2?)|application\/(font-woff2?|x-font-ttf|x-font-otf|octet-stream|vnd\.ms-opentype));base64,/i;

const DERIVED: Partial<Record<ColorKey, string>> = {
  active: 'color-mix(in srgb, var(--raised) 88%, var(--text))',
  rule: 'color-mix(in srgb, var(--border) 70%, var(--surface))',
  control: 'color-mix(in srgb, var(--border) 78%, var(--text))',
  faint: 'color-mix(in srgb, var(--muted) 85%, var(--ground))',
  accentWash: 'color-mix(in srgb, var(--accent) 16%, var(--surface))',
  primary: 'var(--text)',
  primaryInk: 'var(--ground)',
};

const R = ':root[data-custom][data-theme]';
const MESH_AT = ['6% 4%', '96% 12%', '70% 104%', '18% 96%', '50% 50%'];

function backdropCss(b: Backdrop, ground: string): string[] {
  const out: string[] = [];
  const cs = (b.colors ?? []).map(col).filter((c): c is string => !!c).slice(0, 5);
  const fixed = 'background-attachment: fixed;';
  if (b.kind === 'solid' && cs[0]) out.push(`${R} body { background: ${cs[0]}; }`);
  if (b.kind === 'gradient' && cs.length) {
    const stops = cs.length === 1 ? `${cs[0]}, ${cs[0]}` : cs.join(', ');
    out.push(`${R} body { background: linear-gradient(${num(b.angle, 0, 360, 160)}deg, ${stops}); ${fixed} }`);
  }
  if (b.kind === 'mesh' && cs.length) {
    const blobs = cs.map((c, i) => `radial-gradient(46vw 40vw at ${MESH_AT[i]}, ${c} 0%, transparent 70%)`).join(', ');
    out.push(`${R} body { background: ${blobs}, ${ground}; ${fixed} }`);
  }
  const img = dataUrl(b.image, IMAGE);
  if (b.kind === 'image' && img) {
    const fit = b.fit === 'contain' ? 'center / contain no-repeat' : b.fit === 'tile' ? 'top left / auto repeat' : 'center / cover no-repeat';
    const blur = num(b.blur, 0, 40, 0);
    const dim = num(b.dim, 0, 95, 30);
    out.push(`${R} body { background: ${ground}; }`);
    out.push(`${R} body::before { content: ''; position: fixed; inset: ${blur ? -blur * 2 : 0}px; z-index: -2; pointer-events: none;
      background: linear-gradient(color-mix(in srgb, var(--ground) ${dim}%, transparent), color-mix(in srgb, var(--ground) ${dim}%, transparent)), url("${img}") ${fit}; ${blur ? `filter: blur(${blur}px);` : ''} }`);
  }
  const p = b.pattern ?? 'none';
  if (p !== 'none') {
    const c = col(b.patternColor) ?? 'var(--text)';
    const s = num(b.patternSize, 6, 120, 40);
    const o = num(b.patternOpacity, 0, 100, 8) / 100;
    const ink = `color-mix(in srgb, ${c} ${Math.round(o * 100)}%, transparent)`;
    const bg: Record<Exclude<PatternKind, 'none'>, string> = {
      grid: `repeating-linear-gradient(0deg, ${ink} 0 1px, transparent 1px ${s}px), repeating-linear-gradient(90deg, ${ink} 0 1px, transparent 1px ${s}px)`,
      dots: `radial-gradient(circle at 1px 1px, ${ink} 0 1.2px, transparent 1.6px) 0 0 / ${s}px ${s}px`,
      lines: `repeating-linear-gradient(0deg, ${ink} 0 1px, transparent 1px ${s}px)`,
      diagonal: `repeating-linear-gradient(45deg, ${ink} 0 1px, transparent 1px ${s}px)`,
      noise: `repeating-radial-gradient(circle at 17% 32%, ${ink} 0 0.6px, transparent 0.8px ${Math.max(3, s / 8)}px), repeating-radial-gradient(circle at 73% 61%, ${ink} 0 0.6px, transparent 0.8px ${Math.max(4, s / 6)}px)`,
    };
    out.push(`${R} body::after { content: ''; position: fixed; inset: 0; z-index: -1; pointer-events: none; background: ${bg[p]}; }`);
  }
  return out;
}

function touchesCss(t: Touches): string[] {
  const out: string[] = [];
  const two = col(t.second) ?? 'color-mix(in srgb, var(--accent) 55%, var(--text))';
  const grad = `linear-gradient(135deg, var(--accent), ${two})`;
  const btn = `${R} .btn-accent, ${R} .btn-primary`;
  switch (t.button) {
    case 'flat': out.push(`${btn} { background: var(--accent); color: var(--accent-ink); border-color: transparent; box-shadow: none; }`); break;
    case 'gradient': out.push(`${btn} { background: ${grad}; color: var(--accent-ink); border-color: transparent; box-shadow: none; }`); break;
    case 'glow': out.push(`${btn} { background: var(--accent); color: var(--accent-ink); border-color: transparent; box-shadow: 0 0 22px color-mix(in srgb, var(--accent) 55%, transparent); }`); break;
    case 'outline': out.push(`${btn} { background: transparent; color: var(--accent); border: 1.5px solid var(--accent); box-shadow: none; }`, `${R} .btn-accent:hover, ${R} .btn-primary:hover { background: var(--accent-wash); }`); break;
    case 'soft': out.push(`${btn} { background: var(--accent-wash); color: var(--accent); border-color: transparent; box-shadow: none; }`); break;
  }
  const nav = `${R} .nav-item.is-active`;
  switch (t.nav) {
    case 'fill': out.push(`${nav} { background: var(--accent-wash); color: var(--accent); box-shadow: none; }`); break;
    case 'bar': out.push(`${nav} { background: var(--active); color: var(--text); box-shadow: inset 3px 0 0 var(--accent); }`); break;
    case 'glow': out.push(`${nav} { background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 26%, transparent), transparent); color: var(--text); box-shadow: inset 2px 0 0 var(--accent); }`); break;
    case 'outline': out.push(`${nav} { background: transparent; color: var(--accent); box-shadow: inset 0 0 0 1.5px var(--accent); }`); break;
    case 'pill': out.push(`${nav} { background: var(--accent); color: var(--accent-ink); box-shadow: none; border-radius: 999px; }`); break;
  }
  const hov = `${R} .tile-hit:hover .tile-cover`;
  switch (t.hover) {
    case 'lift': out.push(`${hov} { transform: translateY(-5px); box-shadow: 0 16px 30px -12px rgba(0, 0, 0, 0.55); }`); break;
    case 'ring': out.push(`${hov} { transform: none; box-shadow: 0 0 0 2px var(--accent); }`); break;
    case 'glow': out.push(`${hov} { transform: translateY(-2px); box-shadow: 0 0 0 1px var(--accent), 0 0 28px color-mix(in srgb, var(--accent) 45%, transparent); }`); break;
    case 'zoom': out.push(`${hov} { transform: scale(1.045); box-shadow: 0 14px 28px -12px rgba(0, 0, 0, 0.5); }`); break;
    case 'none': out.push(`${hov} { transform: none; box-shadow: none; }`); break;
  }
  const h = `${R} h1`;
  switch (t.heading) {
    case 'plain': out.push(`${h} { background: none; color: var(--text); -webkit-text-fill-color: currentColor; }`); break;
    case 'accent': out.push(`${h} { background: none; color: var(--accent); -webkit-text-fill-color: currentColor; }`); break;
    case 'gradient': out.push(`${h} { background: linear-gradient(90deg, var(--accent), ${two}); -webkit-background-clip: text; background-clip: text; color: transparent; -webkit-text-fill-color: transparent; }`); break;
  }
  switch (t.scrollbar) {
    case 'thin': out.push(`${R} .sheet-scroll::-webkit-scrollbar { width: 6px; } ${R} .sheet-scroll::-webkit-scrollbar-thumb { border-width: 1px; }`); break;
    case 'accent': out.push(`${R} .sheet-scroll::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--accent) 60%, var(--surface)); }`); break;
    case 'hidden': out.push(`${R} .sheet-scroll { scrollbar-width: none; } ${R} .sheet-scroll::-webkit-scrollbar { display: none; }`); break;
  }
  return out;
}

const SHADOWS: Record<string, string> = {
  none: 'none',
  soft: '0 10px 30px -10px rgba(0, 0, 0, 0.35)',
  deep: '0 24px 60px -16px rgba(0, 0, 0, 0.6)',
  glow: '0 0 0 1px color-mix(in srgb, var(--accent) 50%, transparent), 0 0 30px color-mix(in srgb, var(--accent) 35%, transparent)',
  flat: '6px 6px 0 var(--text)',
};
export const SHADOW_KEYS = Object.keys(SHADOWS);

/** a rule's value as it goes into CSS */
function ruleValue(p: RuleProp, v: string): string | null {
  switch (p) {
    case 'background': case 'color': case 'border-color': return col(v);
    case 'border-width': return `${num(Number(v), 0, 12, 1)}px !important; border-style: solid`;
    case 'border-radius': return `${num(Number(v), 0, 60, 0)}px`;
    case 'box-shadow': return SHADOWS[v] ?? null;
    case 'opacity': return String(num(Number(v), 0, 100, 100) / 100);
    case 'font-size': return `${num(Number(v), 50, 250, 100)}%`;
    case 'font-weight': return String(Math.round(num(Number(v), 100, 900, 400)));
    case 'letter-spacing': return `${num(Number(v), -100, 300, 0) / 1000}em`;
    case 'text-transform': return ['none', 'uppercase', 'lowercase', 'capitalize'].includes(v) ? v : null;
    case 'backdrop-filter': return `blur(${num(Number(v), 0, 60, 0)}px)`;
    case 'filter': return /^(saturate|grayscale|brightness|contrast|hue-rotate|sepia|invert|blur)\([0-9.]+(%|deg|px)?\)( (saturate|grayscale|brightness|contrast|hue-rotate|sepia|invert|blur)\([0-9.]+(%|deg|px)?\))*$/.test(v) ? v : null;
    case 'display': return v === 'none' ? 'none' : null;
  }
}

/** the whole theme as CSS */
export function compile(t: CustomTheme): string {
  const vars: string[] = [];
  const set = (p: string, v: string) => vars.push(`${p}: ${v};`);
  for (const k of COLOR_KEYS) {
    const v = col(t.colors?.[k]);
    if (v) set(cssVar(k), v);
    else if (DERIVED[k]) set(cssVar(k), DERIVED[k]!);
  }
  const g = col(t.colors?.ground);
  if (g) { const c = parse(g)!; set('--scrim', `${Math.round(c.r * 0.6)}, ${Math.round(c.g * 0.6)}, ${Math.round(c.b * 0.6)}`); }
  // corners: the old single size, or each one
  const r = t.radii ?? (t.radius != null ? { card: t.radius, sheet: t.radius + 6, cover: Math.max(0, t.radius - 4), control: Math.max(0, t.radius - 4) } : null);
  if (r) {
    if (r.sheet != null) set('--radius-sheet', `${num(r.sheet, 0, 48, 16)}px`);
    if (r.card != null) set('--radius-card', `${num(r.card, 0, 40, 14)}px`);
    if (r.cover != null) set('--radius-cover', `${num(r.cover, 0, 40, 8)}px`);
    if (r.control != null) set('--radius-control', `${num(r.control, 0, 30, 10)}px`);
    if (r.chip != null) set('--radius-chip', `${num(r.chip, 0, 999, 999)}px`);
  }
  const out: string[] = [];
  for (const f of (t.fonts ?? []).slice(0, 4)) {
    const n = fontName(f?.name);
    const d = dataUrl(f?.data, FONT);
    if (n && d) out.push(`@font-face { font-family: "${n}"; src: url("${d}"); font-display: swap; }`);
  }
  const ty = t.type ?? {};
  const body = fontName(ty.body);
  const head = fontName(ty.heading);
  if (body) set('--font', `"${body}", 'Hanken Grotesk Variable', 'Segoe UI', system-ui, sans-serif`);
  set('--font-heading', head ? `"${head}", var(--font)` : 'var(--font)');
  out.push(`${R} { ${vars.join(' ')} }`);

  if (ty.scale != null && ty.scale !== 100) {
    const z = num(ty.scale, 80, 130, 100) / 100;
    out.push(`${R} .app { zoom: ${z}; height: ${100 / z}vh; }`);
  }
  if (ty.bodyWeight != null) out.push(`${R} body { font-weight: ${num(ty.bodyWeight, 300, 600, 400)}; }`);
  const hd = `${R} h1, ${R} h2, ${R} .section-title, ${R} .modal-title, ${R} .sc-title`;
  const hs: string[] = [];
  if (head) hs.push('font-family: var(--font-heading);');
  if (ty.weight != null) hs.push(`font-weight: ${num(ty.weight, 200, 900, 650)};`);
  if (ty.tracking != null) hs.push(`letter-spacing: ${num(ty.tracking, -80, 200, -15) / 1000}em;`);
  if (ty.caps) hs.push('text-transform: uppercase;');
  if (hs.length) out.push(`${hd} { ${hs.join(' ')} }`);

  const su = t.surface ?? {};
  const sheet: string[] = [];
  if (su.blur) sheet.push(`backdrop-filter: blur(${num(su.blur, 0, 60, 0)}px) saturate(1.15);`);
  if (su.border != null) sheet.push(`border-width: ${num(su.border, 0, 6, 1)}px;`);
  if (su.shadow != null || su.glow) {
    const s = num(su.shadow, 0, 100, 0) / 100;
    sheet.push(`box-shadow: ${s ? `0 ${Math.round(8 + s * 30)}px ${Math.round(20 + s * 70)}px rgba(0, 0, 0, ${(0.1 + s * 0.5).toFixed(2)})` : '0 0 0 0 transparent'}${su.glow ? ', 0 0 0 1px color-mix(in srgb, var(--accent) 40%, transparent), 0 0 60px color-mix(in srgb, var(--accent) 22%, transparent)' : ''};`);
  }
  if (su.gap != null) out.push(`${R} { --gap: ${num(su.gap, 0, 32, 8)}px; }`);
  if (sheet.length) out.push(`${R} .sheet { ${sheet.join(' ')} }`);
  if (su.border != null) out.push(`${R} .panel, ${R} .btn, ${R} .set-group { border-width: ${num(su.border, 0, 6, 1)}px; }`);

  if (t.backdrop && t.backdrop.kind !== 'base') out.push(...backdropCss(t.backdrop, g ?? 'var(--ground)'));
  else if (t.backdrop?.pattern && t.backdrop.pattern !== 'none') out.push(...backdropCss(t.backdrop, g ?? 'var(--ground)'));
  else if (!t.backdrop && t.background) out.push(`${R} body { background: ${val(t.background)}; background-attachment: fixed; }`);

  if (t.touches) out.push(...touchesCss(t.touches));
  out.push(...layoutCss(t.layout, R));

  for (const rule of (t.rules ?? []).slice(0, 300)) {
    const sel = cleanSel(rule?.sel);
    if (!sel) continue;
    const decl: string[] = [];
    for (const p of RULE_PROPS) {
      const v = rule.props?.[p];
      if (v == null || v === '') continue;
      const cv = ruleValue(p, String(v));
      if (cv) decl.push(`${p}: ${cv} !important;`);
    }
    if (decl.length) out.push(`${sel.split(',').map((s) => `${R} ${s.trim()}`).join(', ')} { ${decl.join(' ')} }`);
  }
  const css = out.join('\n');
  return t.css ? `${css}\n${safeCss(t.css)}` : css;
}

let styleEl: HTMLStyleElement | null = null;

/** puts a theme on the page (null takes it off) */
export function applyCustom(t: CustomTheme | null) {
  const root = document.documentElement;
  styleEl?.remove();
  document.querySelectorAll('style#custom-theme').forEach((el) => el.remove());
  styleEl = null;
  delete root.dataset.custom;
  showLayout(t?.layout);
  if (!t) return;
  root.dataset.theme = t.base;
  root.dataset.custom = t.id;
  styleEl = document.createElement('style');
  styleEl.id = 'custom-theme';
  styleEl.textContent = compile(t);
  document.head.appendChild(styleEl);
}

function readActive(): CustomTheme | null {
  try {
    const raw = localStorage.getItem(ACTIVE);
    return raw ? (JSON.parse(raw) as CustomTheme) : null;
  } catch { return null; }
}

// the first paint already in the theme's look
let active: CustomTheme | null = typeof window !== 'undefined' ? readActive() : null;
if (active && typeof document !== 'undefined') applyCustom(active);

const subs = new Set<() => void>();
const changed = () => subs.forEach((f) => f());

export function activeCustom() { return active; }

/** sets (or clears) the active shared theme */
export function setCustom(t: CustomTheme | null) {
  active = t;
  try { if (t) localStorage.setItem(ACTIVE, JSON.stringify(t)); else localStorage.removeItem(ACTIVE); } catch { /* too large for storage: it still applies now */ }
  applyCustom(t);
  changed();
}

// ---------------------------------------------------------------- the list

function demoList(): CustomTheme[] {
  try { return JSON.parse(localStorage.getItem(DEMO_LIST) ?? '[]') as CustomTheme[]; } catch { return []; }
}

export async function listThemes(): Promise<CustomTheme[]> {
  return isDesktop ? api.themeList() : demoList();
}

export async function saveTheme(t: Omit<CustomTheme, 'id'>, id?: string): Promise<string> {
  if (isDesktop) return api.themeSave(t, id ?? null);
  const l = demoList();
  const nid = id ?? `${t.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`;
  const next = [...l.filter((x) => x.id !== nid), { ...t, id: nid }];
  localStorage.setItem(DEMO_LIST, JSON.stringify(next));
  return nid;
}

export async function deleteTheme(id: string) {
  if (isDesktop) return api.themeDelete(id);
  localStorage.setItem(DEMO_LIST, JSON.stringify(demoList().filter((x) => x.id !== id)));
}

/** the shared themes, refreshed by bump() */
export function useCustomThemes() {
  const [list, setList] = useState<CustomTheme[]>([]);
  const [tick, setTick] = useState(0);
  const [, force] = useState(0);
  useEffect(() => { listThemes().then(setList).catch(() => setList([])); }, [tick]);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    subs.add(f);
    return () => { subs.delete(f); };
  }, []);
  return { list, active, bump: () => setTick((n) => n + 1) };
}

/** the colours on screen now, as #rrggbb(aa) (a new theme starts from the current look) */
export function currentColors(): Record<ColorKey, string> {
  const cs = getComputedStyle(document.documentElement);
  const probe = document.createElement('span');
  document.body.appendChild(probe);
  const read = (v: string) => {
    probe.style.color = '';
    probe.style.color = v.trim();
    const c = getComputedStyle(probe).color;
    const m = c.match(/-?\d+(\.\d+)?(e-?\d+)?/g);
    if (!m) return '#808080';
    // color-mix comes back as color(srgb 0–1 …), the rest as rgb(0–255 …)
    const scale = c.startsWith('color(') ? 255 : 1;
    const [r, g, b] = m.slice(0, 3).map((n) => Number(n) * scale);
    const a = c.startsWith('color(') ? (c.includes('/') ? Number(m[3]) : 1) : (m.length > 3 ? Number(m[3]) : 1);
    return hex({ r, g, b, a });
  };
  const out = {} as Record<ColorKey, string>;
  for (const k of COLOR_KEYS) out[k] = read(cs.getPropertyValue(cssVar(k)) || '#808080');
  probe.remove();
  return out;
}

/** a theme from a pasted code or file, with only what a theme may carry */
export function fromCode(raw: string): Omit<CustomTheme, 'id'> | null {
  let v: Record<string, unknown>;
  try { v = JSON.parse(raw.trim()); } catch { return null; }
  if (!v || typeof v !== 'object' || typeof v.name !== 'string' || typeof v.colors !== 'object') return null;
  const { id: _id, ...rest } = v as unknown as CustomTheme;
  void _id;
  return { ...rest, name: String(rest.name).slice(0, 60) };
}

/** the background a theme card shows */
export function previewBackground(t: CustomTheme): string {
  const b = t.backdrop;
  const g = t.colors.ground ?? '#222';
  const cs = (b?.colors ?? []).filter(Boolean);
  if (b?.kind === 'solid' && cs[0]) return cs[0];
  if (b?.kind === 'gradient' && cs.length) return `linear-gradient(${b.angle ?? 160}deg, ${cs.length === 1 ? `${cs[0]}, ${cs[0]}` : cs.join(', ')})`;
  if (b?.kind === 'mesh' && cs.length) return `${cs.map((c, i) => `radial-gradient(70% 70% at ${MESH_AT[i]}, ${c} 0%, transparent 70%)`).join(', ')}, ${g}`;
  if (b?.kind === 'image' && b.image && IMAGE.test(b.image)) return `linear-gradient(color-mix(in srgb, ${g} ${b.dim ?? 30}%, transparent), color-mix(in srgb, ${g} ${b.dim ?? 30}%, transparent)), url("${b.image}") center / cover`;
  return t.background ?? g;
}
