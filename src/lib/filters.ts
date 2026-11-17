import { PLATFORMS, STATUSES, TODAY, lastPlayed, totalMinutes, type Game, type PlatformId, type Status } from '../data/library';

import { t, locale } from './i18n';
/** Everything the library can be narrowed by. Inside one group any choice may
    match (Aksiyon or RYO); tags and features must all match (Co-op and Kumanda). */
export interface Filters {
  status: Status[];
  platforms: PlatformId[];
  genres: string[];
  tags: string[];
  features: string[];
  collections: string[];
  install: 'any' | 'installed' | 'remote';
  play: PlayBucket[];
  last: LastBucket | null;
  size: SizeBucket[];
  metacritic: number | null;
  userScore: number | null;
  mine: number | null;
  yearFrom: number | null;
  yearTo: number | null;
  favorite: boolean;
  uncategorized: boolean;
  noted: boolean;
}

export const EMPTY_FILTERS: Filters = {
  status: [], platforms: [], genres: [], tags: [], features: [], collections: [],
  install: 'any', play: [], last: null, size: [], metacritic: null, userScore: null, mine: null,
  yearFrom: null, yearTo: null, favorite: false, uncategorized: false, noted: false,
};

/** filters saved before a field existed still load */
export const withDefaults = (f: Partial<Filters> | null | undefined): Filters => ({ ...EMPTY_FILTERS, ...(f ?? {}) });

export type PlayBucket = 'never' | 'lt2' | '2to10' | '10to50' | '50to200' | 'gt200';
export const PLAY: { id: PlayBucket; label: string; test: (h: number) => boolean }[] = [
  { id: 'never', label: t('Hiç oynanmadı'), test: (h) => h === 0 },
  { id: 'lt2', label: t('2 saatten az'), test: (h) => h > 0 && h < 2 },
  { id: '2to10', label: t('2–10 saat'), test: (h) => h >= 2 && h < 10 },
  { id: '10to50', label: t('10–50 saat'), test: (h) => h >= 10 && h < 50 },
  { id: '50to200', label: t('50–200 saat'), test: (h) => h >= 50 && h < 200 },
  { id: 'gt200', label: t('200 saat üstü'), test: (h) => h >= 200 },
];

const DAY = 86400000;
export type LastBucket = 'week' | 'month' | 'year' | 'over-year' | 'never';
export const LAST: { id: LastBucket; label: string; test: (d: Date | null) => boolean }[] = [
  { id: 'week', label: t('Bu hafta'), test: (d) => !!d && TODAY.getTime() - d.getTime() <= 7 * DAY },
  { id: 'month', label: t('Son 30 gün'), test: (d) => !!d && TODAY.getTime() - d.getTime() <= 30 * DAY },
  { id: 'year', label: t('Son 1 yıl'), test: (d) => !!d && TODAY.getTime() - d.getTime() <= 365 * DAY },
  { id: 'over-year', label: t('1 yıldan uzun'), test: (d) => !!d && TODAY.getTime() - d.getTime() > 365 * DAY },
  { id: 'never', label: t('Hiç açılmadı'), test: (d) => !d },
];

export type SizeBucket = 'lt10' | '10to50' | '50to100' | 'gt100';
export const SIZE: { id: SizeBucket; label: string; test: (gb: number) => boolean }[] = [
  { id: 'lt10', label: t('10 GB altı'), test: (n) => n < 10 },
  { id: '10to50', label: t('10–50 GB'), test: (n) => n >= 10 && n < 50 },
  { id: '50to100', label: t('50–100 GB'), test: (n) => n >= 50 && n < 100 },
  { id: 'gt100', label: t('100 GB üstü'), test: (n) => n >= 100 },
];

/** what Steam says a game supports, in plain words */
export const FEATURES: { id: string; label: string }[] = [
  { id: 'single', label: t('Tek oyunculu') },
  { id: 'multi', label: t('Çok oyunculu') },
  { id: 'coop', label: t('Co-op') },
  { id: 'online-coop', label: t('Çevrimiçi co-op') },
  { id: 'local-coop', label: t('Aynı ekranda co-op') },
  { id: 'split', label: t('Bölünmüş ekran') },
  { id: 'pvp', label: t('PvP') },
  { id: 'mmo', label: 'MMO' },
  { id: 'controller', label: t('Tam kumanda desteği') },
  { id: 'controller-partial', label: t('Kısmi kumanda desteği') },
  { id: 'deck-verified', label: t('Steam Deck doğrulandı') },
  { id: 'deck-playable', label: t('Steam Deck oynanabilir') },
  { id: 'vr', label: 'VR' },
  { id: 'achievements', label: t('Başarımlar') },
  { id: 'cloud', label: t('Bulut kaydı') },
  { id: 'workshop', label: t('Atölye (mod)') },
  { id: 'cards', label: t('Koleksiyon kartları') },
  { id: 'remote-together', label: t('Birlikte uzaktan oyna') },
  { id: 'family', label: t('Aile paylaşımı') },
];
export const featureLabel = (id: string) => FEATURES.find((f) => f.id === id)?.label ?? id;

export const METACRITIC_STEPS = [60, 75, 85, 90];
export const USER_STEPS = [70, 80, 90, 95];
export const MINE_STEPS = [6, 7, 8, 9];

/** genres too broad to say what a game is like */
const NOT_A_GENRE = new Set(['Bağımsız Yapımcı', 'Bağımsız', 'Erken Erişim', 'Oynaması Ücretsiz', 'Free to Play', 'Free To Play', 'Indie', 'Early Access']);
export const primaryGenre = (g: Game) => g.genres.find((x) => !NOT_A_GENRE.has(x)) ?? g.genres[0] ?? null;

const hoursOf = (g: Game) => totalMinutes(g) / 60;

export function matches(g: Game, f: Filters): boolean {
  if (f.status.length && !f.status.includes(g.status)) return false;
  if (f.platforms.length && !f.platforms.includes(g.platform)) return false;
  if (f.genres.length && !f.genres.some((x) => g.genres.includes(x))) return false;
  if (f.tags.length && !f.tags.every((x) => g.storeTags.includes(x) || g.tags.includes(x))) return false;
  if (f.features.length && !f.features.every((x) => g.features.includes(x))) return false;
  if (f.collections.length && !f.collections.some((x) => g.collections.includes(x))) return false;
  if (f.install === 'installed' && !g.installed) return false;
  if (f.install === 'remote' && g.installed) return false;
  if (f.play.length && !f.play.some((b) => PLAY.find((p) => p.id === b)?.test(hoursOf(g)))) return false;
  if (f.last && !LAST.find((p) => p.id === f.last)?.test(lastPlayed(g))) return false;
  if (f.size.length && !(g.installed && g.sizeGB != null && f.size.some((b) => SIZE.find((p) => p.id === b)?.test(g.sizeGB!)))) return false;
  if (f.metacritic != null && (g.metacritic ?? -1) < f.metacritic) return false;
  if (f.userScore != null && (g.userScore ?? -1) < f.userScore) return false;
  if (f.mine != null && (g.rating ?? -1) < f.mine) return false;
  if (f.yearFrom != null && (g.year == null || g.year < f.yearFrom)) return false;
  if (f.yearTo != null && (g.year == null || g.year > f.yearTo)) return false;
  if (f.favorite && !g.favorite) return false;
  if (f.uncategorized && g.collections.length > 0) return false;
  if (f.noted && g.notes.length === 0 && !g.review) return false;
  return true;
}

/** one removable pill per active choice */
export interface Pill { key: string; label: string; clear: (f: Filters) => Filters }
export function pills(f: Filters): Pill[] {
  const out: Pill[] = [];
  const list = <K extends 'status' | 'platforms' | 'genres' | 'tags' | 'features' | 'collections' | 'play' | 'size'>(k: K, label: (v: Filters[K][number]) => string) => {
    for (const v of f[k] as Filters[K][number][]) {
      out.push({ key: `${k}:${v}`, label: label(v), clear: (x) => ({ ...x, [k]: (x[k] as unknown[]).filter((y) => y !== v) }) });
    }
  };
  list('status', (v) => STATUSES.find((s) => s.id === v)?.label ?? v);
  list('platforms', (v) => PLATFORMS[v].name);
  list('genres', (v) => v);
  list('tags', (v) => `#${v}`);
  list('features', featureLabel);
  list('collections', (v) => t('Kategori: {0}', v));
  list('play', (v) => PLAY.find((p) => p.id === v)!.label);
  list('size', (v) => SIZE.find((p) => p.id === v)!.label);
  if (f.install !== 'any') out.push({ key: 'install', label: f.install === 'installed' ? t('Yüklü') : t('Yüklü değil'), clear: (x) => ({ ...x, install: 'any' }) });
  if (f.last) out.push({ key: 'last', label: t('Son oynama: {0}', LAST.find((p) => p.id === f.last)!.label.toLocaleLowerCase(locale)), clear: (x) => ({ ...x, last: null }) });
  if (f.metacritic != null) out.push({ key: 'mc', label: t('Metacritic {0}+', f.metacritic), clear: (x) => ({ ...x, metacritic: null }) });
  if (f.userScore != null) out.push({ key: 'us', label: t('Steam kullanıcıları %{0}+', f.userScore), clear: (x) => ({ ...x, userScore: null }) });
  if (f.mine != null) out.push({ key: 'mine', label: t('Puanım {0}+', f.mine), clear: (x) => ({ ...x, mine: null }) });
  if (f.yearFrom != null || f.yearTo != null) {
    const label = f.yearFrom != null && f.yearTo != null ? `${f.yearFrom}–${f.yearTo}` : f.yearFrom != null ? t('{0} ve sonrası', f.yearFrom) : t('{0} ve öncesi', f.yearTo);
    out.push({ key: 'year', label: t('Çıkış: {0}', label), clear: (x) => ({ ...x, yearFrom: null, yearTo: null }) });
  }
  if (f.favorite) out.push({ key: 'fav', label: t('Favoriler'), clear: (x) => ({ ...x, favorite: false }) });
  if (f.uncategorized) out.push({ key: 'uncat', label: t('Kategorisi olmayanlar'), clear: (x) => ({ ...x, uncategorized: false }) });
  if (f.noted) out.push({ key: 'noted', label: t('Notu ya da yorumu olanlar'), clear: (x) => ({ ...x, noted: false }) });
  return out;
}
export const activeCount = (f: Filters) => pills(f).length;

// ---------------------------------------------------------------- sorting and grouping
export type SortId = 'recent' | 'title' | 'time' | 'rating' | 'metacritic' | 'userScore' | 'release' | 'added' | 'size' | 'genre';
export const SORTS: { id: SortId; label: string }[] = [
  { id: 'recent', label: t('Son oynanan') },
  { id: 'title', label: t('Ada göre') },
  { id: 'time', label: t('Oynama süresi') },
  { id: 'rating', label: t('Puanım') },
  { id: 'metacritic', label: t('Metacritic') },
  { id: 'userScore', label: t('Steam kullanıcı puanı') },
  { id: 'release', label: t('Çıkış tarihi') },
  { id: 'added', label: t('Eklenme tarihi') },
  { id: 'size', label: t('Boyut') },
  { id: 'genre', label: t('Türe göre') },
];

const recentKey = (g: Game) => lastPlayed(g)?.getTime() ?? new Date(g.addedAt).getTime() / 1000;
const releaseKey = (g: Game) => (g.releasedAt ? Date.parse(g.releasedAt) : g.year != null ? new Date(g.year, 0).getTime() : null);

/** larger first; games with no value always last, whichever way */
export function sortGames(list: Game[], sort: SortId, asc: boolean): Game[] {
  const byTitle = (a: Game, b: Game) => a.title.localeCompare(b.title, locale);
  const num = (f: (g: Game) => number | null) => (a: Game, b: Game) => {
    const x = f(a), y = f(b);
    if (x == null && y == null) return byTitle(a, b);
    if (x == null) return 1;
    if (y == null) return -1;
    return (asc ? x - y : y - x) || byTitle(a, b);
  };
  const by: Record<SortId, (a: Game, b: Game) => number> = {
    recent: num(recentKey),
    title: (a, b) => (asc ? byTitle(a, b) : byTitle(b, a)),
    time: num((g) => totalMinutes(g)),
    rating: num((g) => g.rating),
    metacritic: num((g) => g.metacritic),
    userScore: num((g) => g.userScore),
    release: num(releaseKey),
    added: num((g) => new Date(g.addedAt).getTime()),
    size: num((g) => (g.installed ? g.sizeGB : null)),
    genre: (a, b) => {
      const x = primaryGenre(a), y = primaryGenre(b);
      if (!x !== !y) return x ? -1 : 1;
      return (x && y ? (asc ? x.localeCompare(y, locale) : y.localeCompare(x, locale)) : 0) || byTitle(a, b);
    },
  };
  // for names A→Z is the natural first direction, for numbers biggest first
  return [...list].sort(by[sort]);
}

export type GroupId = 'none' | 'genre' | 'platform' | 'status' | 'year' | 'metacritic' | 'install' | 'collection';
export const GROUPS: { id: GroupId; label: string }[] = [
  { id: 'none', label: t('Gruplama yok') },
  { id: 'genre', label: t('Türe göre') },
  { id: 'platform', label: t('Mağazaya göre') },
  { id: 'status', label: t('Duruma göre') },
  { id: 'year', label: t('Çıkış yılına göre') },
  { id: 'metacritic', label: t('Metacritic aralığına göre') },
  { id: 'install', label: t('Yüklü / değil') },
  { id: 'collection', label: t('Kategoriye göre') },
];

const mcBand = (n: number | null) => n == null ? null : n >= 90 ? t('90 ve üstü') : n >= 80 ? '80–89' : n >= 70 ? '70–79' : n >= 60 ? '60–69' : t('60 altı');
const MC_ORDER = [t('90 ve üstü'), '80–89', '70–79', '60–69', t('60 altı')];
const STATUS_ORDER = STATUSES.map((s) => s.label);

/** keeps the order of the sorted list inside each group; a game in two
    categories shows in both */
export function groupGames(list: Game[], group: GroupId): { key: string; games: Game[] }[] {
  if (group === 'none') return [{ key: '', games: list }];
  const keysOf = (g: Game): string[] => {
    switch (group) {
      case 'genre': { const p = primaryGenre(g); return [p ?? t('Türü bilinmeyen')]; }
      case 'platform': return [PLATFORMS[g.platform].name];
      case 'status': return [STATUSES.find((s) => s.id === g.status)?.label ?? g.status];
      case 'year': return [g.year != null ? String(g.year) : t('Tarihi bilinmeyen')];
      case 'metacritic': return [mcBand(g.metacritic) ?? t('Metacritic puanı yok')];
      case 'install': return [g.installed ? t('Yüklü') : t('Yüklü değil')];
      case 'collection': return g.collections.length ? g.collections : [t('Kategorisi olmayanlar')];
      default: return [''];
    }
  };
  const map = new Map<string, Game[]>();
  for (const g of list) for (const k of keysOf(g)) map.set(k, [...(map.get(k) ?? []), g]);
  const last = new Set([t('Türü bilinmeyen'), t('Tarihi bilinmeyen'), t('Metacritic puanı yok'), t('Kategorisi olmayanlar')]);
  const rank = (k: string): number => {
    if (last.has(k)) return 1e9;
    if (group === 'year') return -Number(k);
    if (group === 'metacritic') return MC_ORDER.indexOf(k);
    if (group === 'status') return STATUS_ORDER.indexOf(k);
    if (group === 'install') return k === t('Yüklü') ? 0 : 1;
    return -(map.get(k)?.length ?? 0); // biggest groups first
  };
  return [...map.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0], locale))
    .map(([key, games]) => ({ key, games }));
}

/** how many games in a list carry each value, most first */
export function tally(list: Game[], of: (g: Game) => string[]): [string, number][] {
  const m = new Map<string, number>();
  for (const g of list) for (const v of new Set(of(g))) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], locale));
}
