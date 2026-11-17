// Languages. Turkish is written straight into the code and is its own key: t('Oyna')
// looks the text up in the English table and falls back to the Turkish when a line
// is missing, so nothing ever shows blank. {0}, {1}… are filled from the arguments;
// an English line can be a function when it needs a plural.
//
// The language is read once, before anything renders; changing it reloads the window,
// so even tables built when a module loads come out in the right language.
import { en } from '../i18n/en';

export type Lang = 'tr' | 'en';
export const LANGS: { id: Lang; name: string }[] = [
  { id: 'tr', name: 'Türkçe' },
  { id: 'en', name: 'English' },
];

const KEY = 'tessera.lang';

function first(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'tr' || v === 'en') return v;
  } catch { /* storage unavailable */ }
  const nav = typeof navigator !== 'undefined' ? navigator.language.toLowerCase() : 'tr';
  return nav.startsWith('tr') ? 'tr' : 'en';
}

export const lang: Lang = first();
/** for dates, numbers and sorting */
export const locale = lang === 'tr' ? 'tr-TR' : 'en-US';

if (typeof document !== 'undefined') document.documentElement.lang = lang;

/** set when this load is a language change: the startup show is skipped */
export const reopened: string | null = typeof window !== 'undefined' ? (() => { try { return sessionStorage.getItem('tessera.reopen'); } catch { return null; } })() : null;

export type Line = string | ((a: unknown[]) => string);

const fill = (s: string, a: unknown[]) => (a.length ? s.replace(/\{(\d+)\}/g, (_, i: string) => String(a[Number(i)] ?? '')) : s);

/** lines the English table does not have yet (shown in the browser console while developing) */
const missing = new Set<string>();

/** lines a theme renames: the line as shown → what to show instead */
let overrides: Map<string, string> = new Map();
export function setOverrides(m: Record<string, string>) { overrides = new Map(Object.entries(m)); }

function base(s: string, a: unknown[]): string {
  if (lang === 'en') {
    const e = en[s];
    if (typeof e === 'function') return e(a);
    if (typeof e === 'string') return fill(e, a);
    if (import.meta.env.DEV && !missing.has(s)) { missing.add(s); console.debug('[i18n] missing:', s); }
  }
  return fill(s, a);
}

export function t(s: string, ...a: unknown[]): string {
  const out = base(s, a);
  return overrides.size ? overrides.get(out) ?? out : out;
}

/** English plural helper for table lines: plural(n, 'game') → "1 game", "3 games" */
export const plural = (n: unknown, one: string, many = `${one}s`) => `${n} ${Number(n) === 1 ? one : many}`;

const REOPEN = 'tessera.reopen';

/** what was open before the language changed: it opens again after the reload, without the startup show */
export function takeReopen(): string | null {
  try {
    const v = sessionStorage.getItem(REOPEN);
    if (v) sessionStorage.removeItem(REOPEN);
    return v;
  } catch { return null; }
}

/** remembers the choice, tells the Rust side (errors, notifications) and reloads;
    reopen names what to show again afterwards ("welcome:0", "settings:appearance") */
export async function setLang(next: Lang, reopen?: string) {
  try { localStorage.setItem(KEY, next); } catch { /* storage unavailable */ }
  try { sessionStorage.setItem(REOPEN, reopen ?? 'quiet'); } catch { /* storage unavailable */ }
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    if ('__TAURI_INTERNALS__' in window) await invoke('set_lang', { lang: next });
  } catch { /* browser demo */ }
  window.location.reload();
}

/** the Rust side learns the language at every start too (it may have been changed while it was off) */
export async function syncLang() {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    if ('__TAURI_INTERNALS__' in window) await invoke('set_lang', { lang });
  } catch { /* browser demo */ }
}
