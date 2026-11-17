// The layout part of a theme: where the menu sits (left, right, a top bar, a thin rail),
// a game list column beside the page, the covers, the game page, the parts that are
// shown at all, the order of the menu and any line of text renamed. Sizes and hiding
// are CSS; where things sit is read by the shell through useLayout().
import { useSyncExternalStore } from 'react';
import { setOverrides, t } from './i18n';
import type { GroupId } from './filters';

export type NavPlace = 'left' | 'right' | 'top' | 'rail';
export type ListPlace = 'off' | 'left' | 'right';
export type CoverShape = 'portrait' | 'landscape' | 'square';

export interface LayoutSet {
  /** menu width when it is a column */
  sidebar?: number;
  nav?: NavPlace;
  /** icons beside menu entries (a top bar has none unless asked) */
  navIcons?: boolean;
  /** height of one menu entry */
  navItem?: number;
  /** the game list column (library and game pages) */
  list?: ListPlace;
  listWidth?: number;
  listArt?: 'cover' | 'header' | 'none';
  listGroup?: GroupId;
  listRow?: number;
  /** the page as a floating card, or flush with the window */
  sheet?: 'card' | 'flat';
  /** content width cap (0: the whole width) */
  pageWidth?: number;
  view?: 'grid' | 'list';
  cover?: number;
  shape?: CoverShape;
  titles?: 'show' | 'hide' | 'over';
  play?: boolean;
  tileGap?: number;
  /** game page picture height */
  hero?: number;
  hide?: string[];
  order?: string[];
  sections?: string[];
  /** a line as shown → what to show instead */
  texts?: Record<string, string>;
}

// ---------------------------------------------------------------- what can be hidden

export interface Feature { id: string; label: string; sel: string }
export interface FeatureGroup { title: string; items: Feature[] }

export const FEATURES: FeatureGroup[] = [
  {
    title: t('Menü'),
    items: [
      { id: 'brand', label: t('Logo'), sel: '.sidebar .brand' },
      { id: 'search', label: t('Arama'), sel: '.sidebar .search-trigger' },
      { id: 'counts', label: t('Oyun sayıları'), sel: '.sidebar .nav-count' },
      { id: 'kbd', label: t('Kısayol ipuçları'), sel: '.sidebar kbd, .search-trigger kbd' },
      { id: 'stores', label: t('Mağazalar'), sel: '.sidebar [data-nav="stores"]' },
      { id: 'retro', label: t('Retro'), sel: '.sidebar [data-nav="retro"]' },
      { id: 'categories', label: t('Kategoriler'), sel: '.sidebar [data-nav="categories"]' },
      { id: 'smart', label: t('Akıllı listeler'), sel: '.sidebar [data-nav="smart"]' },
      { id: 'nowplaying', label: t('Şu an oynanan'), sel: '.sidebar .now-playing' },
      { id: 'big', label: t('Geniş ekran'), sel: '.sidebar [data-nav="big"]' },
    ],
  },
  {
    title: t('Kütüphane'),
    items: [
      { id: 'libTitle', label: t('Başlık satırı'), sel: '.page > .title-row' },
      { id: 'libActions', label: t('Başlıktaki butonlar'), sel: '.page > .title-row .title-actions' },
      { id: 'finding', label: t('Özet cümlesi'), sel: '.page > .finding' },
      { id: 'continue', label: t('Kaldığın yerden'), sel: '.page > .continue' },
      { id: 'chips', label: t('Durum etiketleri'), sel: '.lib-controls .chips' },
      { id: 'libSearch', label: t('Listede ara'), sel: '.lib-controls .field-search' },
      { id: 'filters', label: t('Filtreler'), sel: '.lib-controls .btn-filter' },
      { id: 'sortbar', label: t('Sıralama satırı'), sel: '.lib-controls .toolbar-tight' },
      { id: 'tileMeta', label: t('Kapak altı bilgi'), sel: '.cover-grid .tile-meta' },
      { id: 'retroShelf', label: t('Retro rafı'), sel: '.page > .shelf' },
    ],
  },
  {
    title: t('Oyun sayfası'),
    items: [
      { id: 'ambient', label: t('Arkadaki renk'), sel: '.detail-ambient' },
      { id: 'heroLogo', label: t('Oyun logosu'), sel: '.hero-brand' },
      { id: 'heroBack', label: t('Geri butonu'), sel: '.hero-back' },
      { id: 'detailCover', label: t('Kapak'), sel: '.dh-cover' },
      { id: 'facts', label: t('Bilgiler'), sel: '.dh-facts' },
      { id: 'tags', label: t('Etiketler'), sel: '.dh-tags' },
      { id: 'shots', label: t('Ekran görüntüleri'), sel: '.detail .shots' },
    ],
  },
  {
    title: t('Oyun listesi'),
    items: [
      { id: 'listSearch', label: t('Listede ara'), sel: '.game-list .gl-search' },
      { id: 'listHead', label: t('Liste başlığı'), sel: '.game-list .gl-head' },
    ],
  },
];
const FEATURE_SEL = new Map(FEATURES.flatMap((g) => g.items.map((f) => [f.id, f.sel] as const)));

/** the main menu entries, in their usual order */
export const MENU: { id: string; label: string }[] = [
  { id: 'all', label: t('Tüm oyunlar') }, { id: 'installed', label: t('Yüklü') }, { id: 'favorites', label: t('Favoriler') },
  { id: 'stats', label: t('İstatistikler') }, { id: 'news', label: t('Güncellemeler') }, { id: 'wishlist', label: t('İstek listesi') },
  { id: 'shop', label: t('Fiyat ara') }, { id: 'friends', label: t('Arkadaşlar') },
];
/** the blocks of the menu column, in their usual order */
export const SECTIONS: { id: string; label: string }[] = [
  { id: 'brand', label: t('Logo') }, { id: 'search', label: t('Arama') }, { id: 'menu', label: t('Ana menü') },
  { id: 'stores', label: t('Mağazalar') }, { id: 'retro', label: t('Retro') }, { id: 'categories', label: t('Kategoriler') },
  { id: 'foot', label: t('Alt kısım') },
];
const MENU_IDS = new Set(MENU.map((m) => m.id));
const SECTION_IDS = new Set(SECTIONS.map((m) => m.id));

// ---------------------------------------------------------------- ready-made layouts

export const PRESETS: { id: string; label: string; layout: LayoutSet }[] = [
  { id: 'tessera', label: t('Tessera'), layout: {} },
  {
    id: 'topbar', label: t('Üst menü ve oyun listesi'),
    layout: { nav: 'top', list: 'left', listWidth: 280, listArt: 'header', listRow: 30, sheet: 'flat', hero: 420, shape: 'portrait', titles: 'hide', tileGap: 14, cover: 150, hide: ['kbd', 'counts', 'finding'] },
  },
  {
    id: 'details', label: t('Liste ve ayrıntı'),
    layout: { nav: 'left', list: 'left', listWidth: 300, listArt: 'cover', listRow: 34, listGroup: 'platform', sheet: 'flat', hero: 260, sidebar: 200, navItem: 30 },
  },
  {
    id: 'rail', label: t('İnce şerit'),
    layout: { nav: 'rail', list: 'off', sheet: 'card', titles: 'over', cover: 170, tileGap: 12 },
  },
  {
    id: 'right', label: t('Sağda menü'),
    layout: { nav: 'right', list: 'off' },
  },
  {
    id: 'shelf', label: t('Geniş kapaklar'),
    layout: { nav: 'top', list: 'off', shape: 'landscape', cover: 300, titles: 'over', sheet: 'flat', pageWidth: 1600, hide: ['chips', 'sortbar', 'finding'] },
  },
];

// ---------------------------------------------------------------- as CSS

const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const one = <T extends string>(v: unknown, of: readonly T[]): T | null => (of.includes(v as T) ? (v as T) : null);

export function cleanLayout(ly: LayoutSet | null | undefined) {
  const l = ly ?? {};
  return {
    nav: one(l.nav, ['left', 'right', 'top', 'rail'] as const) ?? 'left',
    list: one(l.list, ['off', 'left', 'right'] as const) ?? 'off',
  };
}

export function layoutCss(ly: LayoutSet | null | undefined, R: string): string[] {
  if (!ly) return [];
  const out: string[] = [];
  const vars: string[] = [];
  const { nav } = cleanLayout(ly);
  if (ly.sidebar != null && nav !== 'rail') vars.push(`--sidebar: ${num(ly.sidebar, 160, 360, 236)}px;`);
  if (ly.listWidth != null) vars.push(`--list-w: ${num(ly.listWidth, 180, 480, 280)}px;`);
  if (ly.listRow != null) vars.push(`--list-row: ${num(ly.listRow, 22, 64, 32)}px;`);
  if (ly.cover != null) vars.push(`--cover-min: ${num(ly.cover, 80, 420, 156)}px;`);
  if (ly.tileGap != null) { const g = num(ly.tileGap, 0, 48, 20); vars.push(`--tile-gap-x: ${g}px; --tile-gap-y: ${Math.round(g * 1.2)}px;`); }
  if (ly.pageWidth) vars.push(`--page-w: ${num(ly.pageWidth, 720, 2600, 0)}px;`);
  if (ly.hero != null) vars.push(`--hero-h: ${num(ly.hero, 60, 640, 340)}px;`);
  if (ly.navItem != null) vars.push(`--nav-item: ${num(ly.navItem, 24, 56, 32)}px;`);
  if (vars.length) out.push(`${R} { ${vars.join(' ')} }`);
  // the cover grid is set on html by the cover size setting: the theme's size wins
  if (ly.cover != null) out.push(`${R} .cover-grid { --cover-min: ${num(ly.cover, 80, 420, 156)}px; }`);

  if (ly.sheet === 'flat') {
    out.push(`${R} .app[data-list] { column-gap: 0 !important; padding-inline: 0 !important; }`);
    out.push(`${R} .app[data-nav='top'] > .sidebar { border-bottom: 1px solid var(--border); }`);
    out.push(`${R} .app .sheet, ${R} .app .game-list { margin: 0 !important; border-radius: 0 !important; border-width: 0 !important; box-shadow: none !important; }`);
    out.push(`${R} .app .game-list { border-inline-end: 1px solid var(--border) !important; }`);
    out.push(`${R} .app[data-list='right'] .game-list { border-inline-end-width: 0 !important; border-inline-start: 1px solid var(--border) !important; }`);
  }
  if (ly.navIcons === false && nav !== 'rail') out.push(`${R} .sidebar .nav-icon { display: none !important; }`);
  if (ly.navIcons === true && nav === 'top') out.push(`${R} .sidebar .nav-icon { display: grid !important; }`);

  switch (ly.shape) {
    case 'landscape': out.push(`${R} .cover-grid .tile-cover { aspect-ratio: 460 / 215; }`); break;
    case 'square': out.push(`${R} .cover-grid .tile-cover { aspect-ratio: 1; }`); break;
  }
  switch (ly.titles) {
    case 'hide': out.push(`${R} .cover-grid .tile-text { display: none; }`); break;
    case 'over':
      out.push(`${R} .cover-grid .tile-text { position: absolute; left: 0; right: 0; bottom: 0; z-index: 2; padding: 26px 12px 10px; border-radius: 0 0 var(--radius-cover) var(--radius-cover); background: linear-gradient(to top, rgba(var(--scrim), 0.92), transparent); color: #fff; opacity: 0; transform: translateY(4px); transition: opacity 0.2s, transform 0.2s; pointer-events: none; }`);
      out.push(`${R} .cover-grid .tile:hover .tile-text, ${R} .cover-grid .tile:focus-within .tile-text { opacity: 1; transform: none; }`);
      out.push(`${R} .cover-grid .tile-text .tile-meta { color: rgba(255, 255, 255, 0.75); }`);
      out.push(`${R} .cover-grid .tile-play { z-index: 3; }`);
      break;
  }
  if (ly.play === false) out.push(`${R} .cover-grid .tile-play { display: none; }`);

  const hide = (ly.hide ?? []).map((id) => FEATURE_SEL.get(id) ?? (MENU_IDS.has(id) ? `.nav > [data-nav='${id}']` : null)).filter((s): s is string => !!s);
  if (hide.length) out.push(`${hide.flatMap((s) => s.split(',').map((p) => `${R} ${p.trim()}`)).join(', ')} { display: none !important; }`);
  if (ly.hide?.includes('detailCover')) out.push(`${R} .dh { grid-template-columns: minmax(0, 1fr) minmax(220px, 340px) !important; }`);

  (ly.order ?? []).filter((id) => MENU_IDS.has(id)).forEach((id, i) => out.push(`${R} .nav > [data-nav='${id}'] { order: ${i + 1}; }`));
  (ly.sections ?? []).filter((id) => SECTION_IDS.has(id)).forEach((id, i) => out.push(`${R} .sidebar > [data-nav='${id}'] { order: ${i + 1}; }`));
  return out;
}

// ---------------------------------------------------------------- live

const EMPTY: LayoutSet = {};
let shown: LayoutSet = EMPTY;
let shownKey = '{}';
const subs = new Set<() => void>();

/** the layout now on screen (the saved theme's, or the studio's draft) */
export function showLayout(ly: LayoutSet | null | undefined) {
  const key = JSON.stringify(ly ?? {});
  if (key === shownKey) return;
  shownKey = key;
  shown = ly ?? EMPTY;
  const texts: Record<string, string> = {};
  for (const [k, v] of Object.entries(shown.texts ?? {})) if (typeof v === 'string' && v.trim() && k) texts[k] = v.slice(0, 120);
  setOverrides(texts);
  subs.forEach((f) => f());
}

export function useLayout(): LayoutSet {
  return useSyncExternalStore(
    (f) => { subs.add(f); return () => { subs.delete(f); }; },
    () => shown,
  );
}
