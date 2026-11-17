import { flushSync } from 'react-dom';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { COLLECTIONS, GAMES, type Game, type PlatformId } from './data/library';
import { foldCopies } from './lib/copies';
import { api, fromRow, isDesktop, userData, type AccountRow, type LiveSession, type SessionEvent, type PresenceEvent, type WishData } from './lib/backend';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { duration } from './lib/format';
import type { Filters } from './lib/filters';

import { t as tr, locale } from './lib/i18n';
/** a category: games the user put in it, or (dynamic) every game matching saved filters */
export interface Collection { id: string; description: string; filter?: Filters }

export type Scope =
  | { kind: 'all' }
  | { kind: 'installed' }
  | { kind: 'favorites' }
  | { kind: 'platform'; id: PlatformId }
  | { kind: 'collection'; id: string }
  | { kind: 'smart'; id: string };

export type Route =
  | { name: 'library'; scope: Scope }
  | { name: 'game'; id: string; from?: Route }
  | { name: 'system'; id: PlatformId }
  | { name: 'stats' }
  | { name: 'emulators' }
  | { name: 'year'; year: number }
  | { name: 'news' }
  | { name: 'wishlist' }
  | { name: 'friends' }
  | { name: 'shop'; gid?: string };

export type SettingsSection = 'appearance' | 'accounts' | 'saves' | 'startup' | 'library' | 'data' | 'about';

export interface Prefs {
  startupAnim: boolean;
  startupSound: boolean;
  /** 0–1 */
  volume: number;
  motion: 'full' | 'reduced';
  coverSize: 's' | 'm' | 'l';
  dimRemote: boolean;
  defaultView: 'grid' | 'list';
  /** one card for a game owned in several stores */
  mergeCopies: boolean;
  /** Start on a controller opens the wide-screen mode */
  padOpensBig: boolean;
  /** the first-run guide was seen */
  welcomed: boolean;
  /** an error the window did not handle offers a bug report */
  offerReports: boolean;
}
export const DEFAULT_PREFS: Prefs = {
  startupAnim: true, startupSound: true, volume: 0.6, motion: 'full', coverSize: 'm', dimRemote: true, defaultView: 'grid', mergeCopies: true, padOpensBig: true, welcomed: false, offerReports: true,
};
const readPrefs = (): Prefs => {
  try {
    const raw = localStorage.getItem('tessera.prefs');
    if (raw) return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch { /* storage unavailable */ }
  return DEFAULT_PREFS;
};

export interface GameMenu { x: number; y: number; id: string }

export type ThemeId = 'graphite' | 'linen' | 'sorbet' | 'synth' | 'bauhaus' | 'abyss' | 'ember';
/** themes on a light ground */
export const isLightTheme = (t: ThemeId) => t === 'linen' || t === 'sorbet' || t === 'bauhaus';
export const THEMES: { id: ThemeId; name: string; note: string; swatch: [string, string, string] }[] = [
  { id: 'graphite', name: tr('Graphite'), note: tr('Koyu, nötr'), swatch: ['#141414', '#2a2a2a', '#a9bdd1'] },
  { id: 'linen', name: tr('Linen'), note: tr('Açık, kâğıt'), swatch: ['#efeeeb', '#e2e0dc', '#3a6585'] },
  { id: 'sorbet', name: tr('Sorbet'), note: tr('Pastel, yumuşak'), swatch: ['#f6f0fb', '#ffd9e6', '#8455c4'] },
  { id: 'synth', name: tr('Synth'), note: tr('Neon, gece'), swatch: ['#0b0817', '#261c47', '#ff4fd8'] },
  { id: 'bauhaus', name: tr('Bauhaus'), note: tr('Geometrik, kâğıt'), swatch: ['#efe8da', '#161514', '#d63a2b'] },
  { id: 'abyss', name: tr('Abyss'), note: tr('Derin deniz'), swatch: ['#031018', '#0c2a36', '#4fe0c6'] },
  { id: 'ember', name: tr('Ember'), note: tr('Sıcak, kor'), swatch: ['#130e0b', '#251c16', '#ff9c52'] },
];

interface Store {
  games: Game[];
  byId: Map<string, Game>;
  update: (id: string, patch: Partial<Game> | ((g: Game) => Partial<Game>)) => void;
  route: Route;
  go: (r: Route) => void;
  back: () => void;
  theme: ThemeId;
  setTheme: (t: ThemeId) => void;
  launch: (g: Game) => void;
  toast: string | null;
  openPicker: () => void;
  pickerOpen: boolean;
  closePicker: () => void;
  collections: Collection[];
  addCollection: (name: string, filter?: Filters) => boolean;
  renameCollection: (from: string, to: string) => boolean;
  removeCollection: (name: string) => void;
  setCollectionFilter: (name: string, filter: Filters) => void;
  /** puts games in a category (or takes them out) */
  fileGames: (ids: string[], name: string, on: boolean) => void;
  /** what a backup carries besides the database: collections, preferences, theme */
  backupExtra: () => { collections: Collection[]; prefs: Prefs; theme: ThemeId };
  applyBackupExtra: (x: { collections?: unknown; prefs?: unknown; theme?: unknown } | null) => void;
  notify: (msg: string) => void;
  /** connected store accounts (desktop only) */
  accounts: AccountRow[];
  refresh: () => Promise<void>;
  loaded: boolean;
  /** true when running in a plain browser on the sample library */
  demo: boolean;
  settings: SettingsSection | null;
  openSettings: (s?: SettingsSection) => void;
  closeSettings: () => void;
  prefs: Prefs;
  setPref: <K extends keyof Prefs>(k: K, v: Prefs[K]) => void;
  menu: GameMenu | null;
  openMenu: (m: GameMenu) => void;
  closeMenu: () => void;
  /** the Steam wishlist with prices, as last seen */
  wishlist: WishData | null;
  /** asks Steam again (at most every six hours unless forced) and tells what went on sale */
  refreshWishlist: (force?: boolean) => Promise<void>;
  /** games running right now (the tracker's view) */
  playing: LiveSession[];
  trackAll: boolean;
  setTrackAll: (v: boolean) => void;
  scanOpen: boolean;
  setScanOpen: (v: boolean) => void;
  addOpen: boolean;
  setAddOpen: (v: boolean) => void;
  matchFor: string | null;
  setMatchFor: (id: string | null) => void;
  /** the wide-screen mode for a TV and a controller */
  big: boolean;
  setBig: (v: boolean) => void;
  /** bump to replay the startup sequence */
  splashKey: number;
  replaySplash: () => void;
}

const Ctx = createContext<Store | null>(null);

// SAMPLE: a wishlist for the browser demo (made-up prices)
function sampleWishlist(): WishData {
  const now = Math.round(Date.now() / 1000);
  const base = { cover: null, comingSoonText: null, free: false, original: null, formattedOriginal: null, discountEnds: null, reviewCount: 1200, lowest: null, lowestFormatted: null };
  const pick = (id: number) => `/media/${id}/header.jpg`;
  return {
    checkedAt: now - 3 * 3600, country: 'TR',
    items: [
      { ...base, appid: 4126040, name: tr('Aniimo'), header: pick(4126040), release: now - 40 * 86400, comingSoon: false, price: 1499, original: 2999, formatted: '$14.99', formattedOriginal: '$29.99', discount: 50, discountEnds: now + 5 * 86400, userScore: 88, priority: 0, added: now - 200 * 86400, lowest: 1499, lowestFormatted: '$14.99' },
      { ...base, appid: 4656000, name: tr('Örnek Oyun'), header: pick(4656000), release: null, comingSoon: true, comingSoonText: '2027', price: null, formatted: null, discount: 0, userScore: null, priority: 1, added: now - 90 * 86400 },
      { ...base, appid: 1145350, name: tr('Hades II'), header: pick(1145350), release: now - 400 * 86400, comingSoon: false, price: 2999, formatted: '$29.99', discount: 0, userScore: 95, priority: 2, added: now - 30 * 86400, lowest: 2249, lowestFormatted: '$22.49' },
      { ...base, appid: 1057090, name: 'Ori and the Will of the Wisps', header: pick(1057090), release: now - 1900 * 86400, comingSoon: false, price: 749, original: 2999, formatted: '$7.49', formattedOriginal: '$29.99', discount: 75, discountEnds: now + 2 * 86400, userScore: 96, priority: 3, added: now - 60 * 86400 },
      { ...base, appid: 2457220, name: 'Avowed', header: pick(2457220), release: now - 280 * 86400, comingSoon: false, price: 4999, formatted: '$49.99', discount: 0, userScore: 78, priority: 4, added: now - 20 * 86400 },
      { ...base, appid: 582660, name: 'Black Desert', header: pick(582660), release: now - 2500 * 86400, comingSoon: false, price: 999, original: 1999, formatted: '$9.99', formattedOriginal: '$19.99', discount: 50, discountEnds: now + 9 * 86400, userScore: 74, priority: 5, added: now - 120 * 86400 },
      { ...base, appid: 2344520, name: 'Diablo IV', header: pick(2344520), release: null, comingSoon: true, comingSoonText: 'text_tba', price: null, formatted: null, discount: 0, userScore: 0, reviewCount: 0, priority: 6, added: now - 10 * 86400 },
    ],
  };
}

/** deep links for development: #game/1145350, #system/gba, #stats, #emulators, #platform/steam */
function routeFromHash(): Route[] {
  const [kind, id] = window.location.hash.replace(/^#\/?/, '').split('/');
  if (kind === 'game' && id) return [{ name: 'game', id }];
  if (kind === 'system') return [{ name: 'system', id: 'gba' }];
  if (kind === 'stats') return [{ name: 'stats' }];
  if (kind === 'emulators') return [{ name: 'emulators' }];
  if (kind === 'news') return [{ name: 'news' }];
  if (kind === 'wishlist') return [{ name: 'wishlist' }];
  if (kind === 'friends') return [{ name: 'friends' }];
  if (kind === 'shop') return [{ name: 'shop', gid: id || undefined }];
  if (kind === 'platform' && id) return [{ name: 'library', scope: { kind: 'platform', id: id as PlatformId } }];
  return [];
}

const readTheme = (): ThemeId => {
  const q = new URLSearchParams(window.location.search).get('theme') as ThemeId | null;
  if (q && THEMES.some((x) => x.id === q)) return q;
  try {
    const t = localStorage.getItem('tessera.theme') as ThemeId | null;
    if (t && THEMES.some((x) => x.id === t)) return t;
  } catch { /* storage unavailable */ }
  return 'graphite';
};

const readCollections = (): Collection[] => {
  if (!isDesktop) return COLLECTIONS;
  try {
    const raw = localStorage.getItem('tessera.collections');
    if (raw) return JSON.parse(raw) as Collection[];
  } catch { /* storage unavailable */ }
  return [];
};

export function StoreProvider({ children }: { children: ReactNode }) {
  // desktop app: the user's own library from the local database (empty on first run);
  // plain browser: the sample library, so the UI can be worked on without the backend
  const [prefs, setPrefs] = useState<Prefs>(readPrefs);
  const [raw, setGames] = useState<Game[]>(isDesktop ? [] : GAMES);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [loaded, setLoaded] = useState(!isDesktop);
  const gamesRef = useRef(raw);
  gamesRef.current = raw;

  const refresh = useCallback(async () => {
    if (!isDesktop) return;
    const [rows, accs] = await Promise.all([api.listGames(), api.listAccounts()]);
    setGames(rows.map(fromRow));
    setAccounts(accs);
    setLoaded(true);
  }, []);
  useEffect(() => { refresh().catch(() => setLoaded(true)); }, [refresh]);
  const [history, setHistory] = useState<Route[]>(() => [{ name: 'library', scope: { kind: 'all' } }, ...(isDesktop ? [] : routeFromHash())]);
  const [theme, setThemeState] = useState<ThemeId>(readTheme);
  const [toast, setToast] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(() => !isDesktop && window.location.hash === '#picker');

  // what the screens show: copies of one game folded into one card (unless turned off)
  const games = useMemo(() => (prefs.mergeCopies ? foldCopies(raw) : raw), [raw, prefs.mergeCopies]);
  const byId = useMemo(() => {
    const m = new Map(raw.map((g) => [g.id, g]));
    for (const g of games) m.set(g.id, g);
    return m;
  }, [raw, games]);
  const route = history[history.length - 1];

  const update = useCallback<Store['update']>((id, patch) => {
    const cur = gamesRef.current.find((g) => g.id === id);
    if (!cur) return;
    const next = { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) };
    // the day a game is marked finished is kept, for the yearly recap
    const done = (st: Game['status']) => st === 'completed' || st === 'hundred';
    if (done(next.status) && !done(cur.status) && !next.finishedAt) next.finishedAt = new Date().toISOString();
    if (!done(next.status) && done(cur.status)) next.finishedAt = null;
    setGames((gs) => gs.map((g) => (g.id === id ? next : g)));
    if (isDesktop) {
      const before = JSON.stringify(userData(cur));
      const after = userData(next);
      if (JSON.stringify(after) !== before) api.setUserData(id, after).catch(() => { /* shown on next load */ });
    }
  }, []);

  const go = useCallback((r: Route) => {
    setHistory((h) => [...h.slice(-30), r]);
    document.querySelector('.sheet-scroll')?.scrollTo({ top: 0 });
  }, []);
  const back = useCallback(() => setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h)), []);

  const setTheme = useCallback((t: ThemeId) => {
    // one snapshot crossfade instead of animating every element's colours
    const apply = () => {
      document.documentElement.dataset.theme = t;
      flushSync(() => setThemeState(t));
    };
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    if (doc.startViewTransition && !document.documentElement.classList.contains('reduce-motion')) doc.startViewTransition(apply);
    else apply();
    try { localStorage.setItem('tessera.theme', t); } catch { /* ignore */ }
  }, []);

  const toastTimer = useRef<number | undefined>(undefined);
  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  // a game installed while Tessera sat in the background shows up when it comes back
  const lastStoreCheck = useRef(0);
  useEffect(() => {
    if (!isDesktop) return;
    const onFocus = () => {
      if (!lastStoreCheck.current || Date.now() - lastStoreCheck.current < 45_000) return;
      lastStoreCheck.current = Date.now();
      api.refreshStores()
        .then(async (added) => { await refresh(); if (added > 0) notify(tr('{0} yeni oyun eklendi', added)); })
        .catch(() => {});
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [notify, refresh]);

  // stores connected by scanning pick up what was installed or removed since last time
  useEffect(() => {
    if (!isDesktop) return;
    const t = window.setTimeout(() => {
      (async () => {
        const added = await api.refreshStores().catch(() => 0);
        if (added > 0) notify(tr('{0} yeni oyun eklendi', added));
        await refresh();
        lastStoreCheck.current = Date.now();
        // games still without a page get looked up by name, a dozen per round
        for (let round = 0; round < 5; round++) {
          const n = await api.fillMissing().catch(() => 0);
          if (n === 0) break;
          await refresh();
          notify(tr('{0} oyunun bilgileri bulundu', n));
        }
        // tags, features and scores for the filters; quiet, it only adds detail
        for (let round = 0, since = 0; round < 40; round++) {
          const n = await api.enrichLibrary().catch(() => 0);
          if (n === 0) break;
          since += n;
          if (round === 0 || since >= 60) { await refresh(); since = 0; }
        }
        await refresh();
      })();
    }, 2500);
    return () => window.clearTimeout(t);
  }, [notify, refresh]);

  const launch = useCallback((g: Game) => {
    const how = g.platform === 'gba' ? tr('mGBA ile açılıyor') : g.installed ? tr('Başlatılıyor') : tr('Kurulum başlatılıyor');
    if (!isDesktop) { notify(`${how}: ${g.title}`); return; }
    api.launch(g.id)
      .then((r) => notify(r === 'install' ? tr('Steam’de kurulum açıldı: {0}', g.title) : r === 'restored' ? tr('Buluttaki kayıt yüklendi · {0} açılıyor', g.title) : tr('Başlatılıyor: {0}', g.title)))
      .catch((err) => notify(String(err)));
  }, [notify]);

  const [savedCollections, setCollections] = useState<Collection[]>(readCollections);
  // a collection named on any game counts too, so nothing gets lost
  const collections = useMemo(() => {
    const names = new Set(savedCollections.map((c) => c.id));
    const extra = [...new Set(games.flatMap((g) => g.collections))].filter((n) => !names.has(n))
      .map((id) => ({ id, description: tr('Senin kategorin') }));
    return [...savedCollections, ...extra];
  }, [savedCollections, games]);
  const saveCollections = (next: Collection[]) => {
    try { localStorage.setItem('tessera.collections', JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  };
  const taken = (name: string, except?: string) => {
    const k = name.toLocaleLowerCase(locale);
    return collections.some((c) => c.id !== except && c.id.toLocaleLowerCase(locale) === k);
  };
  const addCollection = (name: string, filter?: Filters) => {
    const id = name.trim();
    if (!id || taken(id)) return false;
    setCollections((cs) => saveCollections([...cs, { id, description: filter ? tr('Dinamik kategori') : tr('Senin kategorin'), ...(filter ? { filter } : {}) }]));
    return true;
  };
  const renameCollection = (from: string, to: string) => {
    const id = to.trim();
    if (!id || id === from) return false;
    if (taken(id, from)) return false;
    setCollections((cs) => {
      const has = cs.some((c) => c.id === from);
      const list = has ? cs : [...cs, { id: from, description: tr('Senin kategorin') }];
      return saveCollections(list.map((c) => (c.id === from ? { ...c, id } : c)));
    });
    for (const g of gamesRef.current) {
      if (g.collections.includes(from)) update(g.id, (x) => ({ collections: x.collections.map((c) => (c === from ? id : c)) }));
    }
    setHistory((h) => h.map((r) => (r.name === 'library' && r.scope.kind === 'collection' && r.scope.id === from ? { ...r, scope: { kind: 'collection', id } } : r)));
    return true;
  };
  const removeCollection = (name: string) => {
    setCollections((cs) => saveCollections(cs.filter((c) => c.id !== name)));
    for (const g of gamesRef.current) {
      if (g.collections.includes(name)) update(g.id, (x) => ({ collections: x.collections.filter((c) => c !== name) }));
    }
    setHistory((h) => {
      const next = h.filter((r) => !(r.name === 'library' && r.scope.kind === 'collection' && r.scope.id === name));
      return next.length ? next : [{ name: 'library', scope: { kind: 'all' } }];
    });
  };
  const setCollectionFilter = (name: string, filter: Filters) =>
    setCollections((cs) => saveCollections(cs.map((c) => (c.id === name ? { ...c, filter } : c))));
  const fileGames = (ids: string[], name: string, on: boolean) => {
    for (const id of ids) {
      update(id, (x) => ({
        collections: on ? (x.collections.includes(name) ? x.collections : [...x.collections, name]) : x.collections.filter((c) => c !== name),
      }));
    }
  };

  const [settings, setSettings] = useState<SettingsSection | null>(() => (!isDesktop && window.location.hash.startsWith('#settings') ? (window.location.hash.split('/')[1] as SettingsSection) || 'appearance' : null));
  const openSettings = useCallback((sec: SettingsSection = 'appearance') => setSettings(sec), []);
  const closeSettings = useCallback(() => setSettings(null), []);

  const setPref = useCallback(<K extends keyof Prefs>(k: K, v: Prefs[K]) => {
    setPrefs((p) => {
      const next = { ...p, [k]: v };
      try { localStorage.setItem('tessera.prefs', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);
  const backupExtra = () => ({ collections: savedCollections, prefs, theme });
  const applyBackupExtra = (x: { collections?: unknown; prefs?: unknown; theme?: unknown } | null) => {
    if (!x) return;
    if (Array.isArray(x.collections)) {
      const incoming = (x.collections as Collection[]).filter((c) => c && typeof c.id === 'string');
      setCollections((cs) => {
        const have = new Set(cs.map((c) => c.id.toLocaleLowerCase(locale)));
        const next = [...cs, ...incoming.filter((c) => !have.has(c.id.toLocaleLowerCase(locale)))];
        try { localStorage.setItem('tessera.collections', JSON.stringify(next)); } catch { /* ignore */ }
        return next;
      });
    }
    if (x.prefs && typeof x.prefs === 'object') {
      setPrefs((p) => {
        const next = { ...p, ...(x.prefs as Partial<Prefs>) };
        try { localStorage.setItem('tessera.prefs', JSON.stringify(next)); } catch { /* ignore */ }
        return next;
      });
    }
    if (typeof x.theme === 'string' && THEMES.some((t) => t.id === x.theme)) setTheme(x.theme as ThemeId);
  };

  useEffect(() => {
    const r = document.documentElement;
    r.classList.toggle('reduce-motion', prefs.motion === 'reduced');
    r.classList.toggle('dim-remote', prefs.dimRemote);
    r.dataset.cover = prefs.coverSize;
  }, [prefs]);

  const [menu, setMenu] = useState<GameMenu | null>(null);
  const [splashKey, setSplashKey] = useState(0);
  const [big, setBigState] = useState(() => !isDesktop && window.location.hash === '#big');
  const setBig = useCallback((v: boolean) => {
    setBigState(v);
    if (isDesktop) getCurrentWindow().setFullscreen(v).catch(() => {});
  }, []);
  const [scanOpen, setScanOpen] = useState(false);
  const [playing, setPlaying] = useState<LiveSession[]>([]);
  // SAMPLE: ?live in the browser demo shows a game as running, to see how that looks
  useEffect(() => {
    if (isDesktop || !new URLSearchParams(location.search).has('live')) return;
    const g = games.find((x) => x.sessions.filter((v) => v.minutes >= 5).length >= 3);
    if (g) setPlaying([{ gameId: g.id, title: g.title, since: Math.floor(Date.now() / 1000) - 52 * 60, presence: tr('Ana menüde') }]);
  }, [games.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const [wishlist, setWishlist] = useState<WishData | null>(() => (isDesktop ? null : sampleWishlist()));
  const wishChecked = useRef(0);
  const refreshWishlist = useCallback(async (force = false) => {
    if (!isDesktop) return;
    const last = Math.max(wishChecked.current, (wishlist?.checkedAt ?? 0) * 1000);
    if (!force && Date.now() - last < 6 * 3600_000) return;
    wishChecked.current = Date.now();
    const r = await api.wishlistRefresh();
    setWishlist(r);
    const sale = r.changes.filter((c) => c.kind === 'sale');
    const out = r.changes.filter((c) => c.kind === 'released');
    if (sale.length) notify(sale.length === 1 ? tr('İstek listende: {0} %{1} indirimde', sale[0].name, sale[0].discount) : tr('İstek listende {0} oyun indirime girdi', sale.length));
    else if (out.length) notify(out.length === 1 ? tr('İstek listendeki {0} çıktı', out[0].name) : tr('İstek listende {0} oyun çıktı', out.length));
  }, [wishlist, notify]);
  // a newer Tessera, when an update address is set: said once a start
  useEffect(() => {
    if (!isDesktop) return;
    const t = window.setTimeout(() => {
      api.updateCheck().then((u) => { if (u.available) notify(tr('Tessera {0} hazır · Ayarlar → Hakkında’dan güncelle', u.version)); }).catch(() => {});
    }, 30_000);
    return () => window.clearTimeout(t);
  }, [notify]);
  // a note from the start (a repaired database), said once
  useEffect(() => {
    if (!isDesktop) return;
    const t = window.setTimeout(() => { api.takeStartupNote().then((n) => { if (n) notify(n); }).catch(() => {}); }, 3500);
    return () => window.clearTimeout(t);
  }, [notify]);
  // the saved list right away; a fresh look once the library has settled
  useEffect(() => {
    if (!isDesktop) return;
    api.wishlistSaved().then((w) => { if (w && Array.isArray(w.items)) setWishlist(w); }).catch(() => {});
  }, []);
  // Tessera checks the wishlist itself every six hours (and notifies); the page follows
  useEffect(() => {
    if (!isDesktop) return;
    const off = listen<WishData>('wishlist', ({ payload }) => { if (payload && Array.isArray(payload.items)) setWishlist(payload); });
    const pick = listen('open-picker', () => setPickerOpen(true));
    return () => { off.then((f) => f()); pick.then((f) => f()); };
  }, []);
  const [trackAll, setTrackAllState] = useState(true);
  const setTrackAll = useCallback((v: boolean) => {
    setTrackAllState(v);
    if (isDesktop) api.setTrackingAll(v).catch(() => {});
  }, []);

  // the tracker tells us when a game starts and stops
  useEffect(() => {
    if (!isDesktop) return;
    api.trackingState().then((t) => { setPlaying(t.live); setTrackAllState(t.all); }).catch(() => {});
    const off = listen<SessionEvent>('session', ({ payload: p }) => {
      if (p.kind === 'start') {
        setPlaying((l) => [...l.filter((x) => x.gameId !== p.gameId), { gameId: p.gameId, title: p.title, since: p.since }]);
        notify(tr('Oturum başladı · {0}', p.title));
      } else {
        setPlaying((l) => l.filter((x) => x.gameId !== p.gameId));
        if (p.minutes > 0) notify(tr('{0} · {1} oynandı', p.title, duration(p.minutes)));
        refresh().catch(() => {});
      }
    });
    const offPresence = listen<PresenceEvent>('presence', ({ payload: p }) => {
      setPlaying((l) => l.map((x) => (x.gameId === p.gameId ? { ...x, presence: p.text } : x)));
    });
    return () => { off.then((f) => f()); offPresence.then((f) => f()); };
  }, [notify, refresh]);
  const [addOpen, setAddOpen] = useState(false);
  const [matchFor, setMatchFor] = useState<string | null>(null);

  const value: Store = {
    games, byId, update, route, go, back, theme, setTheme, launch, toast,
    pickerOpen, openPicker: () => setPickerOpen(true), closePicker: () => setPickerOpen(false),
    collections, addCollection, renameCollection, removeCollection, setCollectionFilter, fileGames, backupExtra, applyBackupExtra, notify, accounts, refresh, loaded, demo: !isDesktop,
    settings, openSettings, closeSettings, prefs, setPref,
    menu, openMenu: setMenu, closeMenu: () => setMenu(null),
    splashKey, replaySplash: () => setSplashKey((k) => k + 1), big, setBig,
    playing, trackAll, setTrackAll, wishlist, refreshWishlist,
    scanOpen, setScanOpen, addOpen, setAddOpen, matchFor, setMatchFor,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error(tr('StoreProvider missing'));
  return s;
}
