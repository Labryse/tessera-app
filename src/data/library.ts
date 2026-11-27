// Sample library for the Tessera prototype.
//
// Real: the Steam games and GBA ROMs found on this PC's desktop, their store text,
// art and achievement lists (pulled by scripts/fetch-*.mjs).
// SAMPLE (replace with real sync data): play times, sessions, statuses, ratings,
// notes, which achievements are unlocked, the non-Steam stores the stand-in
// titles are attributed to, and the GBA ROMs other than FireRed and Unbound.

import steamMeta from './steam-meta.json';
import achData from './achievements.json';

import { lang, t as tr } from '../lib/i18n';
export type PlatformId = 'steam' | 'xbox' | 'battlenet' | 'ubisoft' | 'ea' | 'epic' | 'gog' | 'local'
  | 'gba' | 'gb' | 'gbc' | 'nes' | 'snes' | 'n64' | 'nds' | 'genesis' | 'ps1' | 'ps2' | 'psp' | 'gc';

export const isSystem = (p: PlatformId) => PLATFORMS[p]?.kind === 'system';
/** handhelds whose games are shown as cartridges */
export const CARTRIDGE = new Set<PlatformId>(['gba', 'gb', 'gbc']);

export interface Platform {
  id: PlatformId;
  name: string;
  kind: 'store' | 'system';
  /** does the platform itself report play time? if not, Tessera counts it */
  reportsTime: boolean;
  short: string;
}

export const PLATFORMS: Record<PlatformId, Platform> = {
  steam: { id: 'steam', name: tr('Steam'), kind: 'store', reportsTime: true, short: tr('Steam') },
  xbox: { id: 'xbox', name: tr('Xbox'), kind: 'store', reportsTime: true, short: tr('Xbox') },
  battlenet: { id: 'battlenet', name: tr('Battle.net'), kind: 'store', reportsTime: false, short: tr('Battle.net') },
  ubisoft: { id: 'ubisoft', name: tr('Ubisoft Connect'), kind: 'store', reportsTime: false, short: tr('Ubisoft') },
  ea: { id: 'ea', name: tr('EA app'), kind: 'store', reportsTime: true, short: 'EA' },
  epic: { id: 'epic', name: tr('Epic Games'), kind: 'store', reportsTime: true, short: tr('Epic') },
  gog: { id: 'gog', name: 'GOG', kind: 'store', reportsTime: false, short: 'GOG' },
  local: { id: 'local', name: tr('Diğer oyunlar'), kind: 'store', reportsTime: false, short: 'PC' },
  gba: { id: 'gba', name: tr('Game Boy Advance'), kind: 'system', reportsTime: false, short: 'GBA' },
  gb: { id: 'gb', name: tr('Game Boy'), kind: 'system', reportsTime: false, short: 'GB' },
  gbc: { id: 'gbc', name: tr('Game Boy Color'), kind: 'system', reportsTime: false, short: 'GBC' },
  nes: { id: 'nes', name: 'NES', kind: 'system', reportsTime: false, short: 'NES' },
  snes: { id: 'snes', name: tr('Super Nintendo'), kind: 'system', reportsTime: false, short: 'SNES' },
  n64: { id: 'n64', name: tr('Nintendo 64'), kind: 'system', reportsTime: false, short: 'N64' },
  nds: { id: 'nds', name: tr('Nintendo DS'), kind: 'system', reportsTime: false, short: 'DS' },
  genesis: { id: 'genesis', name: tr('Mega Drive'), kind: 'system', reportsTime: false, short: 'MD' },
  ps1: { id: 'ps1', name: tr('PlayStation'), kind: 'system', reportsTime: false, short: 'PS1' },
  ps2: { id: 'ps2', name: tr('PlayStation 2'), kind: 'system', reportsTime: false, short: 'PS2' },
  psp: { id: 'psp', name: 'PSP', kind: 'system', reportsTime: false, short: 'PSP' },
  gc: { id: 'gc', name: tr('GameCube'), kind: 'system', reportsTime: false, short: 'GC' },
};

export type Status = 'playing' | 'played' | 'backlog' | 'paused' | 'completed' | 'hundred' | 'endless' | 'dropped';

export const STATUSES: { id: Status; label: string; hint: string }[] = [
  { id: 'playing', label: tr('Oynuyor'), hint: tr('Şu sıralar açıp kapatıyorum') },
  { id: 'played', label: tr('Oynandı'), hint: tr('Açtım, henüz bir karar vermedim') },
  { id: 'backlog', label: tr('Sırada'), hint: tr('Başlamadım, sıraya aldım') },
  { id: 'paused', label: tr('Ara verdim'), hint: tr('Yarım kaldı, döneceğim') },
  { id: 'completed', label: tr('Bitirdim'), hint: tr('Ana hikâye tamam') },
  { id: 'hundred', label: lang === 'tr' ? '%100' : '100%', hint: tr('Her şeyi yaptım') },
  { id: 'endless', label: tr('Sonu yok'), hint: tr('Çok oyunculu, sandbox, bitmeyen türden') },
  { id: 'dropped', label: tr('Bıraktım'), hint: tr('Bir daha açmam') },
];

export function ratingWord(v: number | null): string {
  if (v == null) return tr('Puanlanmadı');
  if (v >= 10) return tr('Başyapıt');
  if (v >= 9) return tr('Harika');
  if (v >= 8) return tr('Çok iyi');
  if (v >= 7) return tr('İyi');
  if (v >= 6) return tr('Fena değil');
  if (v >= 5) return tr('Vasat');
  if (v >= 4) return tr('Zayıf');
  if (v >= 2.5) return tr('Kötü');
  return tr('Berbat');
}
export const statusLabel = (s: Status) => STATUSES.find((x) => x.id === s)!.label;

/** presence: the last thing the game said about itself during the session */
export interface Session { start: string; minutes: number; presence?: string }
export interface Note { id: string; date: string; text: string; spoiler?: boolean }
export interface Achievement {
  api: string; name: string; description: string; hidden: boolean;
  icon: string | null; percent: number | null; unlockedAt: string | null;
}
export type Verdict = 'yes' | 'mixed' | 'no';
export interface Review {
  text: string;
  verdict: Verdict | null;
  pros: string[];
  cons: string[];
  updatedAt: string;
  /** play time when it was written */
  playedMinutes: number;
}
export interface RatingAxes { story?: number; gameplay?: number; visuals?: number; audio?: number; performance?: number }

export interface RomInfo {
  file: string; folder: string; sizeBytes: number; region: string;
  dbName?: string; db?: string;
  match: { db: 'No-Intro'; crc: string } | null;
  romhack?: { base: string; patch: string };
  save?: string;
  snap?: string; title?: string;
}

export interface Game {
  id: string;
  title: string;
  platform: PlatformId;
  installed: boolean;
  sizeGB: number | null;
  cover: string | null;
  hero: string | null;
  logo: string | null;
  header: string | null;
  description: string;
  developer: string;
  publisher: string;
  release: string;
  year: number | null;
  genres: string[];
  tags: string[];
  collections: string[];
  status: Status;
  rating: number | null; // 0–10, half steps
  axes: RatingAxes;
  favorite: boolean;
  /** minutes the platform reported before Tessera started tracking */
  importedMinutes: number;
  sessions: Session[];
  achievements: { total: number; list: Achievement[] | null; unlocked: number } | null;
  hltb: number | null; // hours, main story
  metacritic: number | null;
  /** the store's own tags ("Roguelike", "Zengin Hikâye"…); `tags` are the user's */
  storeTags: string[];
  /** what the game supports: single, coop, controller, cloud… (lib/filters FEATURES) */
  features: string[];
  /** share of positive Steam reviews, 0–100 */
  userScore: number | null;
  reviewCount: number | null;
  releasedAt?: string | null;
  screenshots: string[];
  notes: Note[];
  addedAt: string;
  rom?: RomInfo;
  /** id on the store (Steam appid…) */
  externalId?: string;
  /** last played as reported by the platform, for games Tessera has no sessions of */
  lastPlayedAt?: string | null;
  installDir?: string | null;
  /** the same game on Steam (for art, store text and reviews) */
  steamAppId?: number;
  /** longer text from Wikipedia, as simple HTML paragraphs */
  aboutHtml?: string;
  review?: Review | null;
  /** the same game in other stores, folded into this card (this copy first) */
  mergedFrom?: Game[];
  /** when the user marked it finished (Bitirdim / %100) */
  finishedAt?: string | null;
  /** pictures the user picked (SteamGridDB) over the store's own */
  art?: { cover?: string; hero?: string; logo?: string } | null;
}

// ---------------------------------------------------------------------------
// deterministic random so the sample sessions are stable between reloads
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const TODAY = new Date();
/** Tessera's own tracking started here (sample) */
export const TRACKING_SINCE = new Date('2026-05-14T00:00:00');

const DAY = 86400000;
const iso = (d: Date) => d.toISOString();

/**
 * Sessions between `from` and `until`: `perWeek` sessions on average, each about
 * `avg` minutes. Evenings, more on weekends.
 */
function makeSessions(seed: number, perWeek: number, avg: number, from: Date, until: Date = TODAY): Session[] {
  const r = rng(seed);
  const out: Session[] = [];
  for (let t = from.getTime(); t < until.getTime(); t += DAY) {
    const d = new Date(t);
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    const p = (perWeek / 7) * (weekend ? 1.6 : 0.8);
    if (r() < p) {
      const hour = weekend ? 13 + Math.floor(r() * 9) : 19 + Math.floor(r() * 4);
      const start = new Date(t);
      start.setHours(hour, Math.floor(r() * 60), 0, 0);
      if (start > TODAY) continue;
      const minutes = Math.max(12, Math.round(avg * (0.45 + r() * 1.1)));
      out.push({ start: iso(start), minutes });
    }
  }
  return out;
}

const date = (s: string) => new Date(s + 'T12:00:00');

type Meta = { media: Record<string, boolean>; store: null | {
  name: string; short: string; developers: string[]; publishers: string[]; release: string | null;
  genres: string[]; metacritic: number | null; achievements: number; screenshots: string[];
  /** the same store text in English */
  en?: { short: string; release: string | null; genres: string[] };
} };
const META = steamMeta as unknown as Record<string, Meta>;
const ACH = achData as unknown as Record<string, { api: string; name: string; description: string; hidden: boolean; icon: string; percent: number | null }[]>;

interface Spec {
  appid: number;
  platform: PlatformId;
  installed: boolean;
  size?: number;
  status: Status;
  rating?: number;
  axes?: RatingAxes;
  imported: number; // minutes
  activity?: [perWeek: number, avgMinutes: number, fromISO?: string, untilISO?: string];
  unlocked?: number;
  hltb?: number;
  tags?: string[];
  collections?: string[];
  favorite?: boolean;
  added: string;
  title?: string;
  notes?: Note[];
}

const SPECS: Spec[] = [
  { appid: 1145350, platform: 'steam', installed: true, size: 11.4, status: 'playing', rating: 9.5,
    axes: { story: 9, gameplay: 10, visuals: 9.5, audio: 10, performance: 9 },
    imported: 2210, activity: [4.2, 74, '2026-09-25'], unlocked: 31, hltb: 38, favorite: true,
    tags: [tr('Roguelite'), tr('Mitoloji'), tr('Tek oturumluk')], collections: [tr('Roguelite akşamları')], added: '2024-05-06',
    notes: [
      { id: 'n1', date: '2026-11-08T23:40:00', text: tr('Chronos’u ilk kez yendim. Hecate’nin Kehanet’i ile Sorcery gücü çok iyi gitti, bir dahaki koşuda Aphrodite + Hestia dene.') },
      { id: 'n2', date: '2026-10-19T22:10:00', text: tr('Yüzey rotasında Polyphemus’a kadar gelip öldüm. Gece Kalkanı’nı yükseltmeden yüzeye çıkma.'), spoiler: true },
    ] },
  { appid: 2457220, platform: 'steam', installed: true, size: 74.2, status: 'playing', rating: 8,
    axes: { story: 8, gameplay: 8.5, visuals: 9, audio: 7.5, performance: 6.5 },
    imported: 1180, activity: [2.2, 95, '2026-10-01'], unlocked: 19, hltb: 29, tags: [tr('Hikâye'), tr('Açık dünya')],
    collections: [tr('Bir gün bitireceğim')], added: '2025-02-18' },
  { appid: 4126040, platform: 'steam', installed: true, size: 27.9, status: 'playing',
    imported: 0, activity: [3.5, 60, '2026-09-16'], unlocked: 12, tags: [tr('Yaratık toplama'), tr('Ücretsiz')], added: '2026-09-15' },
  { appid: 4656000, platform: 'steam', installed: true, size: 3.6, status: 'playing', rating: 8.5,
    imported: 0, activity: [1.6, 70, '2026-09-04'], unlocked: 9, hltb: 6, tags: [tr('Co-op'), tr('Parti')],
    collections: [tr('Ekip gecesi')], added: '2026-09-02' },
  { appid: 548430, platform: 'steam', installed: true, size: 3.9, status: 'endless', rating: 9.5,
    axes: { gameplay: 10, visuals: 8, audio: 9.5, performance: 9.5 },
    imported: 11850, activity: [1.4, 85, '2026-05-14'], unlocked: 51, favorite: true, tags: [tr('Co-op'), tr('Rock and Stone')],
    collections: [tr('Ekip gecesi')], added: '2020-05-13' },
  { appid: 570, platform: 'steam', installed: true, size: 41.3, status: 'endless', rating: 8,
    imported: 95210, activity: [2.5, 48, '2026-05-14'], tags: [tr('Rekabetçi'), tr('Takım')], added: '2013-07-09' },
  { appid: 105600, platform: 'steam', installed: true, size: 0.7, status: 'endless', rating: 9.5,
    imported: 17320, activity: [0.6, 130, '2026-05-14', '2026-08-30'], unlocked: 88, favorite: true,
    tags: [tr('Sandbox'), tr('Co-op')], collections: [tr('Ekip gecesi')], added: '2015-11-26' },
  { appid: 1281930, platform: 'steam', installed: true, size: 0.3, status: 'endless',
    imported: 5920, activity: [0.5, 140, '2026-05-14', '2026-08-30'], tags: [tr('Mod'), tr('Calamity')], added: '2020-05-16' },
  { appid: 294100, platform: 'steam', installed: true, size: 1.6, status: 'endless', rating: 9.5,
    imported: 14230, activity: [0.7, 150, '2026-06-01', '2026-10-12'], tags: [tr('Koloni'), tr('Uzun oturum')], added: '2018-10-17' },
  { appid: 108600, platform: 'steam', installed: true, size: 6.8, status: 'endless', rating: 8.5,
    imported: 8540, activity: [0.5, 110, '2026-07-01', '2026-09-20'], tags: [tr('Hayatta kalma'), tr('Co-op')],
    collections: [tr('Ekip gecesi')], added: '2021-12-10' },
  { appid: 588650, platform: 'steam', installed: true, size: 1.1, status: 'completed', rating: 9,
    axes: { gameplay: 10, visuals: 9, audio: 8.5, performance: 10 },
    imported: 6180, unlocked: 74, hltb: 21, tags: [tr('Roguelite'), tr('Metroidvania')], collections: [tr('Roguelite akşamları')], added: '2019-03-02' },
  { appid: 1057090, platform: 'steam', installed: true, size: 11.9, status: 'hundred', rating: 10,
    axes: { story: 9.5, gameplay: 10, visuals: 10, audio: 10, performance: 8.5 },
    imported: 1530, unlocked: 37, hltb: 12, favorite: true, tags: [tr('Metroidvania'), tr('Hikâye')], added: '2020-03-11',
    notes: [{ id: 'n3', date: '2025-01-04T01:15:00', text: tr('%100 bitti. Kaçış sahneleri (özellikle Mora) oyunun zirvesi. Müzik listesi telefona.') }] },
  { appid: 774361, platform: 'steam', installed: true, size: 2.4, status: 'completed', rating: 9,
    imported: 1960, unlocked: 33, hltb: 14, tags: [tr('Metroidvania'), tr('Zor')], collections: [tr('Kısa ve öz')], added: '2019-09-12' },
  { appid: 394970, platform: 'steam', installed: true, size: 0.4, status: 'completed', rating: 8,
    imported: 720, unlocked: 17, hltb: 5, tags: [tr('Gizlilik'), tr('Piksel')], collections: [tr('Kısa ve öz')], added: '2017-06-25' },
  { appid: 977950, platform: 'steam', installed: true, size: 0.9, status: 'paused', rating: 7.5,
    imported: 1260, activity: [0.4, 25, '2026-06-10', '2026-07-30'], unlocked: 21, hltb: 8, tags: [tr('Ritim')],
    collections: [tr('Kısa ve öz')], added: '2021-02-01' },
  { appid: 582660, platform: 'steam', installed: true, size: 96.1, status: 'paused', rating: 7,
    imported: 9180, tags: ['MMO'], added: '2018-05-24' },
  { appid: 397540, platform: 'steam', installed: true, size: 128.5, status: 'paused', rating: 7.5,
    imported: 3090, unlocked: 38, hltb: 23, tags: [tr('Co-op'), tr('Looter shooter')], collections: [tr('Ekip gecesi'), tr('Bir gün bitireceğim')], added: '2020-03-13' },
  { appid: 375480, platform: 'steam', installed: true, size: 0.8, status: 'paused', rating: 7,
    imported: 2380, unlocked: 41, hltb: 25, tags: ['ARPG', tr('Piksel')], added: '2020-08-21' },
  { appid: 1282100, platform: 'steam', installed: true, size: 63.7, status: 'paused', rating: 8,
    imported: 2860, unlocked: 27, hltb: 18, tags: [tr('Co-op'), tr('Soulslike')], collections: [tr('Ekip gecesi'), tr('Bir gün bitireceğim')], added: '2023-07-25' },
  { appid: 211820, platform: 'steam', installed: true, size: 3.4, status: 'dropped', rating: 6.5,
    imported: 1300, unlocked: 14, tags: [tr('Sandbox')], added: '2016-07-22' },
  { appid: 1171690, platform: 'steam', installed: true, size: 34.0, status: 'dropped', rating: 5.5,
    imported: 480, unlocked: 6, tags: [tr('Co-op')], added: '2024-10-21' },

  // stand-ins for other stores (art comes from the same Steam CDN in this prototype)
  { appid: 2344520, platform: 'battlenet', installed: true, size: 88.2, status: 'playing', rating: 7.5,
    imported: 0, activity: [2.4, 80, '2026-10-08'], unlocked: 0, tags: ['ARPG', tr('Sezon')], added: '2023-06-06' },
  { appid: 2357570, platform: 'battlenet', installed: false, status: 'endless', rating: 6,
    imported: 0, activity: [0.6, 45, '2026-05-14', '2026-07-12'], tags: [tr('Rekabetçi')], added: '2022-10-04' },
  { appid: 2751000, platform: 'ubisoft', installed: true, size: 29.4, status: 'playing', rating: 8.5,
    imported: 0, activity: [1.8, 70, '2026-10-20'], hltb: 25, tags: [tr('Metroidvania')], added: '2024-01-18' },
  { appid: 3035570, platform: 'ubisoft', installed: false, status: 'backlog', imported: 0, hltb: 16,
    tags: [tr('Gizlilik'), tr('Açık dünya')], collections: [tr('Bir gün bitireceğim')], added: '2024-12-24' },
  { appid: 1551360, platform: 'xbox', installed: false, status: 'paused', rating: 8.5, imported: 2640,
    unlocked: 61, tags: [tr('Yarış'), tr('Açık dünya')], added: '2021-11-09' },
  { appid: 976730, platform: 'xbox', installed: false, status: 'backlog', imported: 0, hltb: 50,
    tags: ['FPS', tr('Seri')], collections: [tr('Bir gün bitireceğim')], added: '2023-02-14' },
  { appid: 1716740, platform: 'xbox', installed: false, status: 'dropped', rating: 6, imported: 1150,
    unlocked: 12, tags: [tr('Uzay'), 'RYO'], added: '2023-09-01' },
  { appid: 1328670, platform: 'ea', installed: false, status: 'backlog', imported: 0, hltb: 66,
    tags: [tr('Hikâye'), tr('Seri')], collections: [tr('Bir gün bitireceğim')], added: '2022-08-11' },
  { appid: 1774580, platform: 'ea', installed: false, status: 'backlog', imported: 0, hltb: 22,
    tags: [tr('Aksiyon-macera')], added: '2024-04-19' },
  { appid: 990080, platform: 'epic', installed: false, status: 'completed', rating: 7.5, imported: 2930,
    unlocked: 38, hltb: 26, tags: [tr('Açık dünya'), tr('Büyü')], added: '2023-02-10' },
];

const cleanTitle = (s: string) => s.replace(/[®™]/g, '').replace(/^REMNANT II/, 'Remnant II').replace(/^STAR WARS/, 'Star Wars').trim();

/** store "genres" that are not genres */
const NOT_GENRES = new Set(['Erken Erişim', 'Oynaması Ücretsiz', 'Early Access', 'Free To Play', 'Free to Play']);

function yearOf(release: string | null): number | null {
  const m = release?.match(/(\d{4})/);
  return m ? Number(m[1]) : null;
}

function buildAchievements(spec: Spec, store: Meta['store'], sessions: Session[], added: string) {
  const list = ACH[String(spec.appid)];
  const total = list ? list.length : store?.achievements ?? 0;
  if (!total) return null;
  const unlocked = Math.min(spec.unlocked ?? 0, total);
  if (!list) return { total, unlocked, list: null };
  // the most common achievements are the ones a player unlocks first
  const order = [...list].sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0));
  const span0 = date(added).getTime();
  const lastSession = sessions.length ? new Date(sessions[sessions.length - 1].start).getTime() : span0 + 200 * DAY;
  const span1 = Math.max(lastSession, span0 + DAY);
  const unlockedSet = new Map<string, string>();
  order.slice(0, unlocked).forEach((a, i) => {
    const t = span0 + ((span1 - span0) * (i + 1)) / (unlocked + 1);
    unlockedSet.set(a.api, new Date(t).toISOString());
  });
  return {
    total,
    unlocked,
    list: list.map((a) => ({
      api: a.api, name: a.name, description: a.description, hidden: a.hidden,
      icon: `/media/${spec.appid}/ach/${a.icon}`, percent: a.percent,
      unlockedAt: unlockedSet.get(a.api) ?? null,
    })),
  };
}

/** store tags, features and a user score for the sample library */
function sampleFacts(spec: Spec, genres: string[]): Pick<Game, 'storeTags' | 'features' | 'userScore' | 'reviewCount'> {
  const tags = [...(spec.tags ?? []), ...genres.filter((g) => !NOT_GENRES.has(g))];
  const coop = tags.some((t) => /co-op|parti|takım|mmo|rekabet/i.test(t));
  const features = ['single', 'achievements', 'cloud', 'family'];
  if (coop) features.push('multi', 'coop', 'online-coop');
  if (spec.appid % 3 !== 0) features.push('controller');
  else features.push('controller-partial');
  if (spec.appid % 2 === 0) features.push('deck-verified');
  else if (spec.appid % 5 !== 0) features.push('deck-playable');
  if (tags.includes('Mod') || spec.appid % 4 === 0) features.push('workshop');
  return { storeTags: tags, features, userScore: 72 + ((spec.appid * 7) % 26), reviewCount: 1000 + (spec.appid % 90000) };
}

const steamGames: Game[] = SPECS.map((spec, i) => {
  const m = META[String(spec.appid)];
  const s = m?.store && lang === 'en' && m.store.en ? { ...m.store, ...m.store.en } : m?.store;
  const media = m?.media ?? {};
  const p = `/media/${spec.appid}`;
  const sessions = spec.activity
    ? makeSessions(spec.appid + i, spec.activity[0], spec.activity[1],
        spec.activity[2] ? date(spec.activity[2]) : TRACKING_SINCE,
        spec.activity[3] ? date(spec.activity[3]) : TODAY)
    : [];
  // SAMPLE: what the game said at the end of its latest sessions
  if (spec.appid === 1145350) {
    [tr('Erebus · 2. bölge'), tr('Oceanus · Gece 13'), tr('Tartarus · Chronos ile savaşta')].forEach((p, k, all) => {
      const at = sessions.length - all.length + k;
      if (at >= 0) sessions[at] = { ...sessions[at], presence: p };
    });
  }
  return {
    id: String(spec.appid),
    title: cleanTitle(spec.title ?? s?.name ?? String(spec.appid)),
    platform: spec.platform,
    installed: spec.installed,
    sizeGB: spec.size ?? null,
    cover: media.cover ? `${p}/cover.jpg` : null,
    hero: media.hero ? `${p}/hero.jpg` : null,
    logo: media.logo ? `${p}/logo.png` : null,
    header: media.header || spec.appid === 4126040 || spec.appid === 4656000 ? `${p}/header.jpg` : null,
    description: s?.short ?? '',
    developer: s?.developers?.[0]?.replace(', Inc.', '') ?? '—',
    publisher: s?.publishers?.[0]?.replace(', Inc.', '') ?? '—',
    release: s?.release ?? '—',
    year: yearOf(s?.release ?? null),
    genres: (s?.genres ?? []).filter((g) => !NOT_GENRES.has(g)),
    tags: spec.tags ?? [],
    collections: spec.collections ?? [],
    status: spec.status,
    rating: spec.rating ?? null,
    axes: spec.axes ?? {},
    favorite: !!spec.favorite,
    importedMinutes: spec.imported,
    sessions,
    // SAMPLE: finished games were finished at their last session
    finishedAt: (spec.status === 'completed' || spec.status === 'hundred') && sessions.length ? sessions[sessions.length - 1].start : null,
    achievements: buildAchievements(spec, s ?? null, sessions, spec.added),
    hltb: spec.hltb ?? null,
    metacritic: s?.metacritic ?? null,
    ...sampleFacts(spec, s?.genres ?? []),
    screenshots: s?.screenshots ?? [],
    notes: spec.notes ?? [],
    addedAt: spec.added,
  };
});

// ---------------------------------------------------------------------------
// Game Boy Advance (mGBA)
export const GBA_FOLDER = lang === 'tr' ? 'C:\\Oyunlar\\GBA' : 'C:\\Games\\GBA';
export const EMULATORS = [
  {
    id: 'mgba', name: 'mGBA', version: '0.10.5', path: lang === 'tr' ? 'C:\\Emulatorler\\mGBA\\mGBA.exe' : 'C:\\Emulators\\mGBA\\mGBA.exe',
    systems: ['gba'] as PlatformId[], args: '"{rom}" -f', extensions: ['.gba', '.gb', '.gbc', '.zip', '.7z'],
    retroAchievements: false,
  },
];

interface RomSpec {
  slug: string | null; title: string; file: string; size: number; region: string; crc: string | null;
  dev: string; pub: string; year: number; genres: string[]; desc: string; status: Status;
  rating?: number; activity?: [number, number, string, string?]; imported?: number; hltb?: number;
  romhack?: { base: string; patch: string }; save?: string; sample?: boolean; tags?: string[]; added: string;
  notes?: Note[];
}

const ROMS: RomSpec[] = [
  { slug: null, title: tr('Pokémon Unbound'), file: tr('Pokemon Unbound.gba'), size: 33554432, region: tr('Romhack'), crc: null,
    dev: tr('Skeli'), pub: tr('Hayran yapımı'), year: 2021, genres: ['RYO', tr('Yaratık toplama')],
    desc: tr('FireRed tabanlı, kendi bölgesi Borrius’ta geçen hayran yapımı bir ROM hack. Yeni hikâye, Mega Evrim, Z-Hareketleri ve zorluk seçenekleri ekliyor.'),
    status: 'playing', rating: 9, activity: [3.1, 65, '2026-10-27'], hltb: 60,
    romhack: { base: tr('Pokemon - FireRed Version (USA)'), patch: tr('Pokemon Unbound Official.ups') },
    save: tr('Pokemon Unbound.sav'), tags: [tr('Romhack'), tr('Türkçe yama denemesi')], added: '2026-10-27',
    notes: [{ id: 'n4', date: '2026-11-06T22:30:00', text: tr('Üçüncü rozet. Takım: Rillaboom, Gardevoir, Corviknight. Türkçe yama (deneme02) 2. şehirde bir diyalogda takılıyor, bildir.') }] },
  { slug: 'firered', title: tr('Pokémon FireRed'), file: tr('Pokemon - FireRed Version (USA).gba'), size: 16777216, region: 'ABD', crc: 'DD88761C',
    dev: tr('Game Freak'), pub: tr('Nintendo'), year: 2004, genres: ['RYO', tr('Yaratık toplama')],
    desc: tr('Kanto bölgesinde geçen ilk nesil Pokémon oyunlarının Game Boy Advance için yeniden yapımı. Kablosuz adaptör desteği ve Sevii Adaları eklendi.'),
    status: 'paused', rating: 8, activity: [5, 50, '2026-10-27', '2026-11-01'], hltb: 26, tags: [tr('Klasik')], added: '2026-10-27' },
  { slug: 'emerald', title: tr('Pokémon Emerald'), file: tr('Pokemon - Emerald Version (USA, Europe).gba'), size: 16777216, region: tr('ABD, Avrupa'), crc: '1F1C08FB',
    dev: tr('Game Freak'), pub: tr('Nintendo'), year: 2004, genres: ['RYO', tr('Yaratık toplama')],
    desc: tr('Hoenn bölgesinin genişletilmiş sürümü. Savaş Sınırı, Team Magma ile Aqua’nın birlikte yer aldığı hikâye ve animasyonlu sprite’lar.'),
    status: 'backlog', hltb: 32, sample: true, added: '2026-10-28' },
  { slug: 'minishcap', title: tr('The Legend of Zelda: The Minish Cap'), file: tr('Legend of Zelda, The - The Minish Cap (USA).gba'), size: 16777216, region: 'ABD', crc: 'B4BD50E4',
    dev: tr('Flagship'), pub: tr('Nintendo'), year: 2004, genres: [tr('Aksiyon'), tr('Macera')],
    desc: tr('Link, konuşan şapkası Ezlo sayesinde küçülüp Minish halkının dünyasına iniyor. Capcom’un Flagship ekibinin elinden, el konsolundaki en derli toplu Zelda’lardan biri.'),
    status: 'completed', rating: 9, imported: 0, activity: [2.8, 55, '2026-05-20', '2026-06-25'], hltb: 13, sample: true, tags: [tr('Klasik')], added: '2026-05-20' },
  { slug: 'zeromission', title: tr('Metroid: Zero Mission'), file: tr('Metroid - Zero Mission (USA).gba'), size: 8388608, region: 'ABD', crc: '5DE8536A',
    dev: tr('Nintendo R&D1'), pub: tr('Nintendo'), year: 2004, genres: [tr('Aksiyon'), tr('Metroidvania')],
    desc: tr('İlk Metroid’in baştan yapımı. Zebes’e iniş, yeni bölümler ve hikâyeyi genişleten Zero Suit bölümü.'),
    status: 'completed', rating: 9.5, activity: [3, 45, '2026-07-02', '2026-07-14'], hltb: 6, sample: true, tags: [tr('Kısa ve öz')], added: '2026-07-02' },
  { slug: 'aria', title: tr('Castlevania: Aria of Sorrow'), file: tr('Castlevania - Aria of Sorrow (USA).gba'), size: 8388608, region: 'ABD', crc: '35536183',
    dev: tr('Konami'), pub: tr('Konami'), year: 2003, genres: [tr('Aksiyon'), tr('Metroidvania')],
    desc: tr('2035’te Soma Cruz, bir güneş tutulması sırasında Drakula’nın şatosuna düşer. Düşmanların ruhlarını toplayıp güçlerini kullanır.'),
    status: 'backlog', hltb: 9, sample: true, added: '2026-10-28' },
  { slug: 'goldensun', title: tr('Golden Sun'), file: tr('Golden Sun (USA, Europe).gba'), size: 8388608, region: tr('ABD, Avrupa'), crc: '1E3AC2AA',
    dev: tr('Camelot'), pub: tr('Nintendo'), year: 2001, genres: ['RYO'],
    desc: tr('Psynergy denen elementel güçleri kullanan gençlerin, Alkimi’nin uyanışını durdurma yolculuğu. Bulmacalı zindanlar ve Djinn sistemi.'),
    status: 'backlog', hltb: 25, sample: true, added: '2026-10-28' },
  { slug: 'advancewars', title: tr('Advance Wars'), file: tr('Advance Wars (USA).gba'), size: 8388608, region: 'ABD', crc: '9DCCFAA9',
    dev: tr('Intelligent Systems'), pub: tr('Nintendo'), year: 2001, genres: [tr('Strateji')],
    desc: tr('Sıra tabanlı taktik savaş. Komutanların özel güçleri, sis savaşı ve harita editörü.'),
    status: 'backlog', hltb: 21, sample: true, added: '2026-10-28' },
  { slug: 'fireemblem', title: tr('Fire Emblem'), file: tr('Fire Emblem (USA, Australia).gba'), size: 16777216, region: tr('ABD, Avustralya'), crc: '2B4B2A25',
    dev: tr('Intelligent Systems'), pub: tr('Nintendo'), year: 2003, genres: [tr('Strateji'), 'RYO'],
    desc: 'Lyn, Eliwood ve Hector’un hikâyesi. Kalıcı ölümün olduğu sıra tabanlı taktik RYO; serinin Batı’ya çıkan ilk oyunu.',
    status: 'backlog', hltb: 30, sample: true, added: '2026-10-28' },
  { slug: 'mother3', title: tr('Mother 3'), file: tr('Mother 3 (Japan) [T-En by Chewy, Jeffman and Tomato].gba'), size: 33554432, region: tr('Japonya · İng. çeviri'), crc: '42AC9CB9',
    dev: tr('Brownie Brown, HAL'), pub: tr('Nintendo'), year: 2006, genres: ['RYO'],
    desc: 'Earthbound’un Japonya’da kalmış devamı. Lucas’ın ailesinin başına gelenler ve Tazmily Köyü’nün değişimi; hayran çevirisiyle oynanıyor.',
    status: 'backlog', hltb: 30, sample: true, tags: [tr('Çeviri')], added: '2026-10-28' },
];

const gbaGames: Game[] = ROMS.map((r, i) => {
  const sessions = r.activity
    ? makeSessions(9000 + i, r.activity[0], r.activity[1], date(r.activity[2]), r.activity[3] ? date(r.activity[3]) : TODAY)
    : [];
  return {
    id: tr('gba-{0}', r.slug ?? 'unbound'),
    finishedAt: (r.status === 'completed' || r.status === 'hundred') && sessions.length ? sessions[sessions.length - 1].start : null,
    title: r.title,
    platform: 'gba',
    installed: true,
    sizeGB: r.size / 1024 ** 3,
    cover: r.slug ? `/media/gba/${r.slug}-box.png` : null,
    hero: r.slug ? `/media/gba/${r.slug}-snap.png` : null,
    logo: null,
    header: null,
    description: r.desc,
    developer: r.dev,
    publisher: r.pub,
    release: String(r.year),
    year: r.year,
    genres: r.genres,
    tags: r.tags ?? [],
    collections: [],
    status: r.status,
    rating: r.rating ?? null,
    axes: {},
    favorite: false,
    importedMinutes: r.imported ?? 0,
    sessions,
    achievements: null,
    hltb: r.hltb ?? null,
    metacritic: null, storeTags: [], features: [], userScore: null, reviewCount: null,
    screenshots: r.slug ? [`/media/gba/${r.slug}-title.png`, `/media/gba/${r.slug}-snap.png`].filter((s) => !s.includes('mother3-title')) : [],
    notes: r.notes ?? [],
    addedAt: r.added,
    rom: {
      file: r.file,
      folder: GBA_FOLDER,
      sizeBytes: r.size,
      region: r.region,
      match: r.crc ? { db: 'No-Intro' as const, crc: r.crc } : null,
      romhack: r.romhack,
      save: r.save,
      snap: r.slug ? `/media/gba/${r.slug}-snap.png` : undefined,
      title: r.slug && r.slug !== 'mother3' ? `/media/gba/${r.slug}-title.png` : undefined,
    },
  };
});

export const GAMES: Game[] = [...steamGames, ...gbaGames];

export const COLLECTIONS = [
  { id: tr('Ekip gecesi'), description: tr('Arkadaşlarla co-op') },
  { id: tr('Roguelite akşamları'), description: tr('Bir koşu, sonra yatağa') },
  { id: tr('Kısa ve öz'), description: tr('15 saatin altında biten') },
  { id: tr('Bir gün bitireceğim'), description: tr('Söz verilmiş oyunlar') },
];

export const SMART_COLLECTIONS = [
  { id: 'never', label: tr('Hiç açılmamış'), rule: tr('Süre 0 dk') },
  { id: 'stale', label: tr('Yüklü ama unutulmuş'), rule: tr('Yüklü · oynanmış, 60 günden uzun süredir açılmadı') },
];

// ---------------------------------------------------------------------------
// derived values (always computed from the rows above)
export const sessionMinutes = (g: Game) => g.sessions.reduce((a, s) => a + s.minutes, 0);
/** Platforms that report time (Steam) already include the sessions Tessera saw,
    so their total is the larger of the two; elsewhere the two add up. */
export const totalMinutes = (g: Game): number =>
  g.mergedFrom
    ? g.mergedFrom.reduce((a, c) => a + totalMinutes(c), 0)
    : PLATFORMS[g.platform].reportsTime && g.importedMinutes > 0
      ? Math.max(g.importedMinutes, sessionMinutes(g))
      : g.importedMinutes + sessionMinutes(g);
export const lastPlayed = (g: Game): Date | null => {
  const fromSessions = g.sessions.length ? new Date(g.sessions[g.sessions.length - 1].start) : null;
  const reported = g.lastPlayedAt ? new Date(g.lastPlayedAt) : null;
  if (fromSessions && reported) return fromSessions > reported ? fromSessions : reported;
  return fromSessions ?? reported;
};
export const tracksWithTessera = (g: Game) => !PLATFORMS[g.platform].reportsTime;

export function minutesBetween(games: Game[], from: Date, to: Date = new Date()) {
  let sum = 0;
  for (const g of games) for (const s of g.sessions) {
    const t = new Date(s.start);
    if (t >= from && t <= to) sum += s.minutes;
  }
  return sum;
}

console.assert(
  GAMES.every((g) => !g.achievements || g.achievements.unlocked <= g.achievements.total),
  tr('unlocked achievements exceed total'),
);
console.assert(
  GAMES.every((g) => !g.achievements?.list || g.achievements.list.filter((a) => a.unlockedAt).length === g.achievements.unlocked),
  tr('unlocked list does not match count'),
);
