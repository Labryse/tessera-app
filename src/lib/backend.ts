// Bridge to the Rust side. In a plain browser (npm run dev without Tauri) there is
// no backend, and the app runs on the sample library instead.

import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import type { Game, PlatformId, Status } from '../data/library';
import { monthShort } from './format';

export const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export interface GameRow {
  id: string;
  platform: string;
  externalId: string;
  title: string;
  installed: boolean;
  installDir: string | null;
  sizeBytes: number | null;
  playtimeMin: number;
  lastPlayed: number | null;
  meta: Record<string, unknown> | null;
  user: Partial<UserData> | null;
  addedAt: number;
  sessions: { start: number; minutes: number; presence?: string }[];
}

/** presence: what the game says about itself right now ("Ranked · Dust II") */
export interface LiveSession { gameId: string; title: string; since: number; presence?: string | null }
export interface PresenceEvent { gameId: string; text: string | null }
/** a Steam announcement; date in seconds */
/** one of the user's own screenshots: paths on this PC, time in seconds */
export interface ShotFile { full: string; thumb: string | null; at: number }
/** a local screenshot as the window can load it */
export const shotUrl = (path: string) => convertFileSrc(path, 'shot');
/** a wishlisted game with its price; prices in cents, times in seconds */
export interface WishItem {
  appid: number; name: string; cover: string | null; header: string | null;
  release: number | null; comingSoon: boolean; comingSoonText: string | null; free: boolean;
  price: number | null; original: number | null; formatted: string | null; formattedOriginal: string | null;
  discount: number; discountEnds: number | null; userScore: number | null; reviewCount: number | null;
  priority: number; added: number; lowest: number | null; lowestFormatted: string | null;
  /** Steam gave no data this time; this is what was seen last */
  stale?: boolean;
}
/** one store's offer, from IsThereAnyDeal */
export interface Deal {
  shop: string; shopId: number; price: number; regular: number; cut: number; currency: string;
  storeLow: number | null; voucher: string | null; drm: string[]; url: string;
}
export interface PriceData { gid?: string; deals: Deal[]; low: { price: number; currency: string } | null; checkedAt?: number }
export interface GamePrices extends Partial<PriceData> { found: boolean; hasKey: boolean; apps?: Record<string, boolean> }
export interface ShopArt { banner: string | null; small: string | null; boxart: string | null }
/** a game found by the price search; type is game, dlc, package… */
export interface ShopHit { gid: string; title: string; type: string | null; mature: boolean; art: ShopArt; prices?: PriceData; appid?: number | null; from?: string }
export interface ShopInfo {
  gid: string; title: string; type: string | null; art: ShopArt; appid: number | null; earlyAccess: boolean; tags: string[];
  releaseDate: string | null; developers: string[]; publishers: string[];
  reviews: { source: string; score: number | null; count: number | null; url: string | null }[];
}
export interface WishPrices { hasKey: boolean; items: Record<string, PriceData>; apps?: Record<string, boolean> }

export interface WishData { items: WishItem[]; checkedAt: number; country: string }
export interface WishChange { appid: number; kind: 'sale' | 'released'; name: string; discount?: number; price?: string }
/** a Steam friend; state is Steam's own word (in-game, online, away, offline…) */
export interface Friend {
  account: number | string; name: string; state: string; game: string | null; appid: number | null;
  presence: string | null; avatar: string | null; note: string | null;
  /** Xbox only */
  gamertag?: string | null; gamerscore?: number | null; titleId?: string | null;
}
/** life in the background */
export interface ShellPrefs { closeToTray: boolean; notifyWishlist: boolean; notifySessions: boolean; notifyTracked: boolean; autostart: boolean }
/** a game followed from "Fiyat ara" */
export interface Tracked {
  gid: string; title: string; art: string | null; added: number;
  /** the user's price to wait for */
  target: number | null;
  /** best price when followed, and now */
  base: number | null; price: number | null; regular?: number; cut?: number; currency?: string; shop?: string; shopId?: number;
  low?: { price: number; currency: string } | null; checkedAt?: number;
}
export interface NewsItem { id: string; title: string; url: string; date: number; image: string | null; summary: string; body?: string; patch: boolean }
export interface SessionEvent { kind: 'start' | 'end'; gameId: string; title: string; since: number; minutes: number }

export interface AccountRow {
  platform: string;
  externalId: string;
  displayName: string | null;
  method: 'openid' | 'local' | 'scan';
  connectedAt: number;
  lastSync: number | null;
  hasKey: boolean;
  gameCount: number;
}

export interface LocalSteamAccount { steamid: string; persona: string; mostRecent: boolean; hasLocalData: boolean }
export interface SyncReport { total: number; added: number; installed: number; usedKey: boolean; localData: boolean; warning: string | null }

/** the parts of a game that are the user's own and survive every sync */
export type UserData = Pick<Game, 'status' | 'rating' | 'axes' | 'favorite' | 'tags' | 'collections' | 'notes' | 'review' | 'art' | 'finishedAt'>;
export const userData = (g: Game): UserData => ({
  status: g.status, rating: g.rating, axes: g.axes, favorite: g.favorite, tags: g.tags, collections: g.collections, notes: g.notes,
  review: g.review ?? null,
  art: g.art ?? null,
  finishedAt: g.finishedAt ?? null,
});

export const api = {
  listGames: () => invoke<GameRow[]>('list_games'),
  listAccounts: () => invoke<AccountRow[]>('list_accounts'),
  setUserData: (id: string, user: UserData) => invoke<void>('set_user_data', { id, user }),
  disconnect: (platform: string, removeGames: boolean) => invoke<void>('disconnect', { platform, removeGames }),
  launch: (id: string) => invoke<'launched' | 'install' | 'restored'>('launch_game', { id }),
  openUrl: (url: string) => invoke<void>('open_url', { url }),
  openSteam: (path: string) => invoke<void>('open_steam', { path }),
  gameNews: (id: string) => invoke<NewsItem[]>('game_news', { id }),
  updateCheck: () => invoke<{ configured: boolean; current: string; available?: boolean; version?: string; notes?: string | null }>('update_check'),
  updateInstall: () => invoke<void>('update_install'),
  takeStartupNote: () => invoke<string | null>('take_startup_note'),
  shellPrefs: () => invoke<ShellPrefs>('shell_prefs'),
  shellSet: (key: keyof ShellPrefs, on: boolean) => invoke<void>('shell_set', { key, on }),
  liveStatus: () => invoke<{ appid: number; available: boolean; on: boolean }[]>('live_status'),
  liveSet: (appid: number, on: boolean) => invoke<void>('live_set', { appid, on }),
  steamFriends: () => invoke<{ friends: Friend[]; checkedAt: number }>('steam_friends'),
  xboxFriends: () => invoke<{ friends: Friend[]; checkedAt: number }>('xbox_friends'),
  xboxStatus: () => invoke<boolean>('xbox_status'),
  xboxSetKey: (key: string | null) => invoke<void>('xbox_set_key', { key }),
  itadStatus: () => invoke<{ hasKey: boolean; own: boolean }>('itad_status'),
  itadSetKey: (key: string | null) => invoke<void>('itad_set_key', { key }),
  gamePrices: (id: string) => invoke<GamePrices>('game_prices', { id }),
  shopSearch: (q: string) => invoke<{ hasKey: boolean; items: ShopHit[]; apps?: Record<string, boolean> }>('shop_search', { q }),
  shopPopular: () => invoke<{ hasKey: boolean; items: ShopHit[]; apps?: Record<string, boolean> }>('shop_popular'),
  shopArt: (gids: string[]) => invoke<Record<string, ShopArt>>('shop_art', { gids }),
  errorInfo: () => invoke<{ version: string; os: string; repo: string | null; log: string }>('error_info'),
  errorClear: () => invoke<void>('error_clear'),
  themeList: () => invoke<import('./customThemes').CustomTheme[]>('theme_list'),
  themeSave: (theme: object, id: string | null) => invoke<string>('theme_save', { theme, id }),
  themeImport: (path: string) => invoke<string>('theme_import', { path }),
  themeExport: (id: string, path: string) => invoke<void>('theme_export', { id, path }),
  themeDelete: (id: string) => invoke<void>('theme_delete', { id }),
  themeFolder: () => invoke<void>('theme_folder'),
  imageData: (url: string) => invoke<string>('image_data', { url }),
  savePng: (path: string, data: string) => invoke<void>('save_png', { path, data }),
  trackList: () => invoke<Tracked[]>('track_list'),
  trackAdd: (gid: string, title: string, art: string | null) => invoke<Tracked[]>('track_add', { gid, title, art }),
  trackRemove: (gid: string) => invoke<Tracked[]>('track_remove', { gid }),
  trackTarget: (gid: string, target: number | null) => invoke<Tracked[]>('track_target', { gid, target }),
  shopGame: (gid: string) => invoke<{ hasKey: boolean; info: ShopInfo | null; prices: GamePrices }>('shop_game', { gid }),
  wishlistPrices: (appids: number[]) => invoke<WishPrices>('wishlist_prices', { appids }),
  storeOpen: (shop: number, url: string, gid: string | null, appid: number | null) => invoke<'app' | 'web'>('store_open', { shop, url, gid, appid }),
  wishlistSaved: () => invoke<WishData | null>('wishlist_saved'),
  wishlistRefresh: () => invoke<WishData & { changes: WishChange[] }>('wishlist_refresh'),
  gameScreenshots: (id: string) => invoke<ShotFile[]>('game_screenshots', { id }),
  profileScreenshots: (id: string) => invoke<{ full: string; thumb: string; page: string }[]>('profile_screenshots', { id }),
  openScreenshots: (id: string) => invoke<void>('open_screenshots', { id }),
  steamDetect: () => invoke<{ clientFound: boolean; accounts: LocalSteamAccount[] }>('steam_detect'),
  steamSignIn: () => invoke<{ steamid: string; persona: string | null }>('steam_sign_in'),
  steamConnect: (steamid: string, persona: string | null, method: 'openid' | 'local', apiKey: string | null) =>
    invoke<void>('steam_connect', { steamid, persona, method, apiKey }),
  steamSetKey: (key: string | null) => invoke<void>('steam_set_key', { key }),
  steamSync: () => invoke<SyncReport>('steam_sync'),
  steamCollections: () => invoke<{ collections: { name: string; apps: number[] }[]; favorites: number[] }>('steam_collections'),
  linkStore: (platform: string) => invoke<SyncReport>('link_store', { platform }),
  refreshStores: () => invoke<number>('refresh_stores'),
  fillMissing: () => invoke<number>('fill_missing'),
  measureSize: (id: string) => invoke<number | null>('measure_size', { id }),
  /** one round of filling tags, features and scores; 0 when nothing is left */
  enrichLibrary: () => invoke<number>('enrich_library'),
  steamAchievements: (appid: number) => invoke<SteamAch>('steam_achievements', { appid }),
  steamAppDetails: (appid: number) => invoke<SteamDetails>('steam_app_details', { appid }),
  scanInstalled: () => invoke<Found[]>('scan_installed'),
  scanGuess: (item: Found) => invoke<Candidate | null>('scan_guess', { item }),
  importFound: (items: Found[]) => invoke<number>('import_found', { items }),
  matchCandidates: (query: string) => invoke<Candidate[]>('match_candidates', { query }),
  addGame: (path: string, title: string | null, candidate: Candidate | null) => invoke<string>('add_game', { path, title, candidate }),
  rematch: (id: string, candidate: Candidate | null) => invoke<void>('rematch', { id, candidate }),
  retroSystems: () => invoke<RetroSystem[]>('retro_systems'),
  listEmulators: () => invoke<Emulator[]>('list_emulators'),
  detectEmulators: () => invoke<FoundEmu[]>('detect_emulators'),
  addEmulator: (path: string) => invoke<Emulator>('add_emulator', { path }),
  removeEmulator: (id: string) => invoke<void>('remove_emulator', { id }),
  openEmulator: (id: string) => invoke<void>('open_emulator', { id }),
  setEmulatorArgs: (id: string, args: string) => invoke<void>('set_emulator_args', { id, args }),
  listRomFolders: () => invoke<RomFolder[]>('list_rom_folders'),
  setFolderEmulator: (id: number, emulatorId: string | null) => invoke<void>('set_folder_emulator', { id, emulatorId }),
  addRomFolder: (path: string, system: string, emulatorId: string | null) => invoke<RomScan>('add_rom_folder', { path, system, emulatorId }),
  rescanRomFolder: (id: number) => invoke<RomScan>('rescan_rom_folder', { id }),
  removeRomFolder: (id: number, removeGames: boolean) => invoke<void>('remove_rom_folder', { id, removeGames }),
  romDetails: (id: string) => invoke<boolean>('rom_details', { id }),
  saveInfo: (id: string) => invoke<SaveInfo>('save_info', { id }),
  saveBackup: (id: string) => invoke<boolean>('save_backup', { id }),
  saveRestore: (id: string, snapshot: string) => invoke<void>('save_restore', { id, snapshot }),
  saveDelete: (id: string, snapshot: string) => invoke<void>('save_delete', { id, snapshot }),
  saveSyncSettings: () => invoke<SyncSettings>('save_sync_settings'),
  setSaveCloud: (dir: string | null) => invoke<SyncReport2>('set_save_cloud', { dir }),
  driveInstallClient: (path: string) => invoke<void>('drive_install_client', { path }),
  driveConnect: () => invoke<SyncReport2>('drive_connect'),
  driveDisconnect: () => invoke<void>('drive_disconnect'),
  syncSavesNow: () => invoke<SyncReport2>('sync_saves_now'),
  exportLibrary: (path: string, extra: unknown) => invoke<number>('export_library', { path, extra }),
  importLibrary: (path: string) => invoke<{ matched: number; missing: number; sessions: number; extra: { collections?: unknown; prefs?: unknown } | null }>('import_library', { path }),
  raStatus: () => invoke<string | null>('ra_status'),
  raConnect: (user: string, key: string) => invoke<string>('ra_connect', { user, key }),
  raDisconnect: () => invoke<void>('ra_disconnect'),
  raAchievements: (id: string) => invoke<SteamAch & { raGameId?: number; user?: string; none?: boolean; needsAccount?: boolean }>('ra_achievements', { id }),
  sgdbStatus: () => invoke<boolean>('sgdb_status'),
  sgdbSetKey: (key: string | null) => invoke<void>('sgdb_set_key', { key }),
  sgdbImages: (id: string, kind: 'grid' | 'hero' | 'logo') => invoke<{ url: string; thumb: string; author: string }[]>('sgdb_images', { id, kind }),
  trackingState: () => invoke<{ all: boolean; live: LiveSession[] }>('tracking_state'),
  setTrackingAll: (all: boolean) => invoke<void>('set_tracking_all', { all }),
};

export interface Emulator { id: string; kind: string; name: string; path: string; args: string; systems: string[]; icon: string | null }
export interface FoundEmu { kind: string; name: string; path: string; systems: string[]; icon: string | null }
export interface RomFolder { id: number; path: string; system: string; emulatorId: string | null; games: number }
export interface RetroSystem { id: string; name: string; exts: string[]; cartridge: boolean }
export interface RomScan { total: number; added: number; matched: number; restored: number }
export interface SaveSnapshot {
  id: string; gameId: string; title: string; system: string; created: number; machine: string; reason: string; hash: string;
  files: { ext: string; size: number }[]; local: boolean; cloud: boolean;
}
export interface SaveInfo { local: { name: string; ext: string; size: number; modified: number }[]; snapshots: SaveSnapshot[]; cloud: string | null; driveError: string | null }
export interface SyncReport2 { sent: number; received: number }
export interface SyncSettings {
  cloudDir: string | null;
  suggested: string | null;
  drive: { configured: boolean; email: string | null; error: string | null };
  games: CloudGame[];
}
export interface CloudGame { gameId: string; title: string; system: string; latest: number; machine: string; count: number }

export interface Candidate {
  source: 'steam' | 'wiki';
  id: string;
  title: string;
  subtitle: string | null;
  image: string | null;
}

export interface Found {
  source: string;
  externalId: string;
  title: string;
  installDir: string | null;
  sizeBytes: number | null;
  launch: string | null;
  known: boolean;
  origin: 'desktop' | 'start' | 'manual' | null;
  guess: Candidate | null;
  /** the guess is still being looked up */
  pending?: boolean;
}

export interface SteamDetails {
  about: string;
  genres: string[];
  metacritic: number | null;
  website: string | null;
  /** space the store page asks for, in GB */
  storageGB?: number | null;
  reviews: { score: number | null; positive: number | null; total: number | null };
}

export type SteamAch =
  | { needsKey: true; total: number }
  | { error: string }
  | { list: { api: string; name: string; description: string; hidden: boolean; icon: string | null; percent: number | null; unlockedAt: number | null }[] };

const DAY = 86400000;

function defaultStatus(minutes: number, last: Date | null, platform: string): Status {
  // a game found on disk without play time is still one you have, not one you queued
  if (!minutes) return platform === 'steam' ? 'backlog' : 'played';
  if (last && Date.now() - last.getTime() < 21 * DAY) return 'playing';
  return 'played';
}

const s = (v: unknown) => (typeof v === 'string' && v ? v : null);
const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export function fromRow(r: GameRow): Game {
  const m = r.meta ?? {};
  const u = r.user ?? {};
  const last = r.lastPlayed && r.lastPlayed > 0 ? new Date(r.lastPlayed * 1000) : null;
  const rel = typeof m.release === 'number' && m.release > 0 ? new Date(m.release * 1000) : null;
  return {
    id: r.id,
    title: r.title,
    platform: r.platform as PlatformId,
    installed: r.installed,
    sizeGB: r.sizeBytes ? r.sizeBytes / 1024 ** 3 : null,
    // a picture the user chose wins over the store's
    cover: u.art?.cover ?? s(m.cover),
    hero: u.art?.hero ?? s(m.hero),
    logo: u.art?.logo ?? s(m.logo),
    header: s(m.header),
    description: s(m.short) ?? '',
    developer: arr(m.developers)[0] ?? '—',
    publisher: arr(m.publishers)[0] ?? '—',
    release: rel ? `${rel.getDate()} ${monthShort(rel.getMonth())} ${rel.getFullYear()}` : '—',
    year: rel ? rel.getFullYear() : null,
    genres: arr(m.genres).length ? arr(m.genres) : arr(m.tagGenres),
    storeTags: arr(m.storeTags),
    features: arr(m.features),
    userScore: typeof m.userScore === 'number' ? m.userScore : null,
    reviewCount: typeof m.reviewCount === 'number' ? m.reviewCount : null,
    releasedAt: rel ? rel.toISOString() : null,
    tags: u.tags ?? [],
    collections: u.collections ?? [],
    status: u.status ?? defaultStatus(r.playtimeMin, last, r.platform),
    rating: u.rating ?? null,
    axes: u.axes ?? {},
    favorite: !!u.favorite,
    importedMinutes: r.playtimeMin,
    sessions: (r.sessions ?? []).map((x) => ({ start: new Date(x.start * 1000).toISOString(), minutes: x.minutes, ...(x.presence ? { presence: x.presence } : {}) })),
    achievements: null,
    hltb: null,
    metacritic: typeof m.metacritic === 'number' ? m.metacritic : null,
    screenshots: arr(m.screenshots),
    notes: u.notes ?? [],
    review: u.review ?? null,
    art: u.art ?? null,
    finishedAt: u.finishedAt ?? null,
    rom: m.rom && typeof m.rom === 'object' ? (() => {
      const r = m.rom as Record<string, unknown>;
      const match = r.match as { db?: string; crc?: string } | null;
      return {
        file: String(r.file ?? ''), folder: String(r.folder ?? ''), sizeBytes: Number(r.sizeBytes ?? 0),
        region: s(r.region) ?? '—', match: match ? { db: 'No-Intro' as const, crc: match.crc ?? '' } : null,
        dbName: s(r.dbName) ?? undefined, db: match?.db,
      };
    })() : undefined,
    addedAt: new Date(r.addedAt * 1000).toISOString().slice(0, 10),
    externalId: r.externalId,
    lastPlayedAt: last ? last.toISOString() : null,
    installDir: r.installDir,
    aboutHtml: s(m.aboutHtml) ?? undefined,
    steamAppId: r.platform === 'steam' ? Number(r.externalId) : typeof m.steamAppId === 'number' ? m.steamAppId : undefined,
  };
}
