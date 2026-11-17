// What each tab of the wide-screen mode shows. Every tab is shelves of tiles; a tile
// opens a page with its buttons. The library has covers, the others wide art,
// friends their avatars, stats big numbers. One browser drives them all.
import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { BarChart3, Bell, BellRing, Delete, ExternalLink, Gamepad2, Heart, LibraryBig, MessageSquare, Newspaper, Play, Search, Store, Tag, User, Users, Wrench } from 'lucide-react';
import { useStore } from '../store';
import { isSystem, lastPlayed, PLATFORMS, totalMinutes, type Game, type PlatformId } from '../data/library';
import { ago, duration, int, pct } from '../lib/format';
import { tick, type PadAction, type PadKind } from '../lib/pad';
import { api, type Friend, type ShopHit } from '../lib/backend';
import { Cover } from './bits';
import { SessionBar, clock, elapsed, typicalMinutes, usually } from './Session';
import { Glyph, type Handler } from './BigPicture';
import { PriceTag, facts as wishFacts, heroArt, openSteam } from './Wishlist';
import { useFeed } from './News';
import { shopData } from './Shop';
import { cheapest, money, openDeal } from './Stores';
import { follow, unfollow, useTracked } from './Track';
import { fetchFriends } from './Friends';
import { steam, steamId } from './FriendMenu';
import { t as tr, locale } from '../lib/i18n';

export type TabId = 'library' | 'wishlist' | 'shop' | 'news' | 'friends' | 'stats';
const ic = { size: 18, strokeWidth: 1.8 } as const;
export const TABS: { id: TabId; label: string; icon: ReactNode }[] = [
  { id: 'library', label: tr('Kütüphane'), icon: <LibraryBig {...ic} /> },
  { id: 'wishlist', label: tr('İstek listesi'), icon: <Heart {...ic} /> },
  { id: 'shop', label: tr('Fiyat ara'), icon: <Tag {...ic} /> },
  { id: 'news', label: tr('Güncellemeler'), icon: <Newspaper {...ic} /> },
  { id: 'friends', label: tr('Arkadaşlar'), icon: <Users {...ic} /> },
  { id: 'stats', label: tr('İstatistikler'), icon: <BarChart3 {...ic} /> },
];

export interface BigAction { id: string; label: string; run: () => void; primary?: boolean; icon?: ReactNode }
type Shape = 'cover' | 'wide' | 'person' | 'stat';
export interface BigItem {
  key: string;
  title: string;
  game?: Game;
  art?: string | null;
  bg?: string | null;
  bgFallback?: string | null;
  logo?: string | null;
  sub?: string;
  /** on the tile (a price, a badge) */
  tag?: ReactNode;
  /** under the title when focused, and on the page */
  meta?: string[];
  live?: ReactNode;
  text?: string;
  facts?: [string, string][];
  shots?: string[];
  /** the page's buttons; without them A runs pick */
  actions?: BigAction[];
  pick?: () => void;
  /** Y on the tile and on the page */
  y?: { label: string; run: () => void };
  /** more for the page, asked when it opens */
  load?: () => Promise<Partial<BigItem>>;
  running?: boolean;
  /** drawn on a wide tile that has no art */
  icon?: ReactNode;
}
export interface BigShelf { id: string; label: string; items: BigItem[]; shape: Shape }

interface TabProps { tab: TabId; kind: PadKind | null; now: number; handler: MutableRefObject<Handler | null>; onExit: () => void }

export function BigTab(p: TabProps) {
  switch (p.tab) {
    case 'library': return <LibraryTab {...p} />;
    case 'wishlist': return <WishTab {...p} />;
    case 'shop': return <ShopTab {...p} />;
    case 'news': return <NewsTab {...p} />;
    case 'friends': return <FriendsTab {...p} />;
    case 'stats': return <StatsTab {...p} />;
  }
}

// ---------------------------------------------------------------- the browser

interface BrowserProps extends TabProps {
  shelves: BigShelf[];
  loading?: boolean;
  empty?: string;
  /** asked before the shelves (a keyboard on top) */
  intercept?: Handler;
  overlay?: ReactNode;
  /** the shelf to jump to when it appears (search results) */
  focusShelf?: string | null;
}

const plain = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function Backdrop({ item }: { item: BigItem | null }) {
  const src = item ? item.bg ?? item.art ?? null : null;
  const [failed, setFailed] = useState<string | null>(null);
  const url = src && failed === src ? item?.bgFallback ?? null : src;
  return (
    <div className="big-bg" aria-hidden="true">
      {url && <img key={url} src={url} alt="" className={item && item.game && !item.game.hero && !item.game.header ? 'is-cover' : item && !item.bg ? 'is-soft' : ''} onError={() => setFailed(src)} />}
    </div>
  );
}

function Tile({ it, shape, on, onClick }: { it: BigItem; shape: Shape; on: boolean; onClick: () => void }) {
  const cls = `big-tile is-${shape} ${on ? 'is-focus' : ''} ${it.game && isSystem(it.game.platform) ? 'is-box' : ''}`;
  if (shape === 'cover') {
    return (
      <button className={cls} tabIndex={-1} aria-current={on || undefined} aria-label={it.title} onClick={onClick}>
        {it.game ? <Cover game={it.game} /> : it.art ? <img className="cover-img" src={it.art} alt="" /> : null}
        {it.running && <span className="big-tile-live" aria-label={tr('açık')} />}
      </button>
    );
  }
  if (shape === 'stat') {
    return (
      <button className={cls} tabIndex={-1} aria-current={on || undefined} onClick={onClick}>
        <span className="big-stat-num num">{it.title}</span>
        <span className="big-stat-label">{it.sub}</span>
      </button>
    );
  }
  if (shape === 'person') {
    return (
      <button className={cls} tabIndex={-1} aria-current={on || undefined} aria-label={it.title} onClick={onClick}>
        <span className="big-person-face">{it.art ? <img src={it.art} alt="" /> : <span>{it.title.slice(0, 1)}</span>}</span>
        <span className="big-person-name">{it.title}</span>
        {it.sub && <span className="big-person-sub">{it.sub}</span>}
      </button>
    );
  }
  return (
    <button className={cls} tabIndex={-1} aria-current={on || undefined} aria-label={it.title} onClick={onClick}>
      <span className="big-wide-art">
        {it.art ? <img src={it.art} alt="" loading="lazy" /> : <span className={`big-wide-none ${it.icon ? 'has-icon' : ''}`}>{it.icon}{it.title}</span>}
        {it.tag && <span className="big-wide-tag">{it.tag}</span>}
      </span>
      <span className="big-wide-cap">
        <span className="big-wide-title">{it.title}</span>
        {it.sub && <span className="big-wide-sub">{it.sub}</span>}
      </span>
    </button>
  );
}

function ShelfBrowser({ shelves, loading, empty, kind, handler, onExit, intercept, overlay, focusShelf }: BrowserProps) {
  const { prefs } = useStore();
  const [row, setRow] = useState(0);
  const [cols, setCols] = useState<Record<string, number>>({});
  const [page, setPage] = useState<BigItem | null>(null);
  const [extra, setExtra] = useState<Partial<BigItem> | null>(null);
  const [pageAt, setPageAt] = useState(0);
  const text = useRef<HTMLDivElement>(null);
  const sound = (k: 'move' | 'select' | 'back') => tick(k, prefs.volume);

  // jump to a shelf that just appeared (search results)
  useEffect(() => {
    if (!focusShelf) return;
    const i = shelves.findIndex((s) => s.id === focusShelf);
    if (i >= 0) { setRow(i); setCols((m) => ({ ...m, [focusShelf]: 0 })); }
  }, [focusShelf]); // eslint-disable-line react-hooks/exhaustive-deps

  const r = Math.min(row, Math.max(0, shelves.length - 1));
  const shelf = shelves[r];
  const col = shelf ? Math.min(cols[shelf.id] ?? 0, shelf.items.length - 1) : 0;
  const focused = shelf?.items[col] ?? null;
  // the page keeps the live version of its item (a favourite toggled, a follow)
  const live = page ? shelves.flatMap((s) => s.items).find((x) => x.key === page.key) ?? page : null;
  const pg = live ? { ...live, ...extra, actions: extra?.actions ?? live.actions } : null;
  const actions = pg?.actions ?? [];

  const openPage = (it: BigItem) => {
    if (!it.actions && !it.load) { sound('select'); it.pick?.(); return; }
    sound('select'); setPage(it); setExtra(null); setPageAt(0);
    if (it.load) { const key = it.key; it.load().then((x) => setPage((p) => { if (p?.key === key) setExtra(x); return p; })).catch(() => {}); }
  };

  const act = (a: PadAction): boolean => {
    if (intercept?.(a)) return true;
    if (pg) {
      if (a === 'b') { sound('back'); setPage(null); return true; }
      if (a === 'left') { sound('move'); setPageAt((v) => Math.max(0, v - 1)); return true; }
      if (a === 'right') { sound('move'); setPageAt((v) => Math.min(actions.length - 1, v + 1)); return true; }
      if (a === 'up' || a === 'down') { text.current?.scrollBy({ top: a === 'down' ? 160 : -160, behavior: 'smooth' }); return true; }
      if (a === 'a') { const x = actions[Math.min(pageAt, actions.length - 1)]; if (x) { sound('select'); x.run(); } return true; }
      if (a === 'y' && pg.y) { sound('select'); pg.y.run(); return true; }
      return a !== 'lb' && a !== 'rb';
    }
    if (!shelf) return false;
    const setCol = (c: number) => setCols((m) => ({ ...m, [shelf.id]: c }));
    if (a === 'left') { if (col > 0) { sound('move'); setCol(col - 1); } return true; }
    if (a === 'right') { if (col < shelf.items.length - 1) { sound('move'); setCol(col + 1); } return true; }
    if (a === 'up') { if (r > 0) { sound('move'); setRow(r - 1); } return true; }
    if (a === 'down') { if (r < shelves.length - 1) { sound('move'); setRow(r + 1); } return true; }
    if ((a === 'a' || a === 'x') && focused) { openPage(focused); return true; }
    if (a === 'y' && focused?.y) { sound('select'); focused.y.run(); return true; }
    return false;
  };
  handler.current = act;
  useEffect(() => () => { handler.current = null; }, [handler]);

  const shown = pg ?? focused;
  return (
    <div className={`big-view ${pg ? 'is-page' : ''}`}>
      <Backdrop item={shown} />
      <div className="big-scrim" aria-hidden="true" />

      {shown && !pg && (
        <section className="big-info" key={shown.key} aria-live="polite">
          {shown.logo ? <img className="big-logo" src={shown.logo} alt={shown.title} /> : <h1 className="big-title">{shown.title}</h1>}
          {shown.meta && shown.meta.length > 0 && <p className="big-meta">{shown.meta.map((m) => <span key={m}>{m}</span>)}</p>}
          {shown.tag && shelf?.shape === 'wide' && <div className="big-info-tag">{shown.tag}</div>}
          {shown.live}
        </section>
      )}

      <div className="big-shelves" style={{ '--row': r } as React.CSSProperties} aria-hidden={!!pg}>
        {shelves.map((s, si) => {
          const c = Math.min(cols[s.id] ?? 0, s.items.length - 1);
          return (
            <section key={s.id} className={`big-shelf is-${s.shape} ${si === r ? 'is-on' : si < r ? 'is-past' : ''}`} aria-label={s.label} style={{ '--s': Math.max(0, si - r) } as React.CSSProperties}>
              <h2 className="big-shelf-title">{s.label}{s.shape !== 'stat' && <span className="num">{s.items.length}</span>}</h2>
              <div className="big-row" style={{ '--off': Math.max(0, c - 1) } as React.CSSProperties}>
                {s.items.map((x, i) => (
                  <Tile key={x.key} it={x} shape={s.shape} on={si === r && i === c}
                    onClick={() => { if (si === r && i === c) openPage(x); else { sound('move'); setRow(si); setCols((m) => ({ ...m, [s.id]: i })); } }} />
                ))}
              </div>
            </section>
          );
        })}
        {shelves.length === 0 && <p className="big-empty">{loading ? tr('Yükleniyor…') : empty ?? tr('Burada henüz bir şey yok.')}</p>}
      </div>

      {pg && (
        <section className="big-page" key={pg.key} aria-label={pg.title}>
          <div className="big-page-main">
            {pg.logo ? <img className="big-logo" src={pg.logo} alt={pg.title} /> : <h1 className="big-title">{pg.title}</h1>}
            {pg.meta && pg.meta.length > 0 && <p className="big-meta">{pg.meta.map((m) => <span key={m}>{m}</span>)}</p>}
            {pg.tag && <div className="big-info-tag">{pg.tag}</div>}
            {pg.live}
            <div className="big-page-actions" role="menu">
              {actions.map((x, i) => (
                <button key={x.id} role="menuitem" className={`big-action ${x.primary ? 'is-primary' : ''} ${i === pageAt ? 'is-focus' : ''}`}
                  onClick={x.run} onMouseEnter={() => setPageAt(i)}>
                  {i === pageAt ? <Glyph b="a" kind={kind} /> : x.icon}{x.label}
                </button>
              ))}
              {pg.load && !extra && <span className="big-action is-wait">{tr('Yükleniyor…')}</span>}
            </div>
            {pg.text && <div className="big-page-desc is-scroll" ref={text}>{plain(pg.text).length > 0 && pg.text.split('\n\n').map((p, k) => <p key={k}>{plain(p)}</p>)}</div>}
          </div>
          {pg.facts && pg.facts.length > 0 && (
            <dl className="big-page-facts">
              {pg.facts.map(([dt, dd]) => <div key={dt}><dt>{dt}</dt><dd className="num">{dd}</dd></div>)}
            </dl>
          )}
          {pg.shots && pg.shots.length > 0 && (
            <div className="big-page-shots" aria-hidden="true">
              {pg.shots.slice(0, 4).map((s, i) => <img key={s} src={s} alt="" style={{ '--k': i } as React.CSSProperties} />)}
            </div>
          )}
        </section>
      )}

      {overlay}

      <footer className="big-hints">
        {pg ? (
          <>
            {actions.length > 1 && <span className="big-hint-quiet">{tr('◂ ▸ Seç')}</span>}
            {actions[pageAt] && <button onClick={() => actions[pageAt]?.run()}><Glyph b="a" kind={kind} /> {actions[pageAt].label}</button>}
            {pg.y && <button onClick={() => pg.y?.run()}><Glyph b="y" kind={kind} /> {pg.y.label}</button>}
            <button onClick={() => { sound('back'); setPage(null); }}><Glyph b="b" kind={kind} /> {tr('Geri')}</button>
          </>
        ) : (
          <>
            {focused && <button onClick={() => openPage(focused)}><Glyph b="a" kind={kind} /> {tr('Aç')}</button>}
            {focused?.y && <button onClick={() => focused.y?.run()}><Glyph b="y" kind={kind} /> {focused.y.label}</button>}
            <span className="big-hint-quiet"><Glyph b="lb" kind={kind} /><Glyph b="rb" kind={kind} /> {tr('Bölüm')}</span>
            <button onClick={onExit}><Glyph b="b" kind={kind} /> {tr('Çık')}</button>
          </>
        )}
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------- library

function LiveLine({ g, since, now }: { g: Game; since: number; now: number }) {
  const secs = elapsed(since, now);
  const typical = typicalMinutes(g);
  return (
    <div className="big-live">
      <span className="big-live-clock num">{clock(secs)}</span>
      <span className="big-live-note">{typical ? usually(typical) : tr('bu oturum')}</span>
      {typical ? <SessionBar secs={secs} typical={typical} className="big-live-bar" /> : null}
    </div>
  );
}

const byRecent = (a: Game, b: Game) => (lastPlayed(b)?.getTime() ?? 0) - (lastPlayed(a)?.getTime() ?? 0);
const byTitle = (a: Game, b: Game) => a.title.localeCompare(b.title, locale);

/** a game as a tile and its page */
function useGameItem(now: number) {
  const { launch, update, playing, setBig, go } = useStore();
  return (g: Game): BigItem => {
    const live = playing.find((p) => p.gameId === g.id);
    const mins = totalMinutes(g);
    const last = lastPlayed(g);
    const meta = [
      PLATFORMS[g.platform].name,
      ...(mins > 0 ? [`${duration(mins)} ${tr('oynandı')}`] : []),
      ...(last ? [`${tr('Son:')} ${ago(last).toLocaleLowerCase(locale)}`] : []),
      ...(!g.installed && !isSystem(g.platform) ? [tr('Yüklü değil')] : []),
      ...(g.achievements && g.achievements.total > 0 ? [`${g.achievements.unlocked}/${g.achievements.total} ${tr('başarım')}`] : []),
    ];
    const facts: [string, string][] = [
      [tr('Oynama'), mins ? duration(mins) : '—'],
      [tr('Son oynama'), last ? ago(last) : '—'],
      ...(g.achievements && g.achievements.total > 0 ? [[tr('Başarımlar'), `${g.achievements.unlocked}/${g.achievements.total}`] as [string, string]] : []),
      ...(g.rating != null ? [[tr('Puanın'), `${g.rating}/10`] as [string, string]] : []),
      ...(g.sessions.length > 0 ? [[tr('Oturum'), String(g.sessions.length)] as [string, string]] : []),
    ];
    const fav = { label: g.favorite ? tr('Favoriden çıkar') : tr('Favori'), run: () => update(g.id, { favorite: !g.favorite }) };
    return {
      key: `game:${g.id}`, title: g.title, game: g, bg: g.hero ?? g.header ?? g.cover, logo: g.logo, meta, facts, shots: g.screenshots,
      text: g.description ?? undefined, running: !!live,
      live: live ? <LiveLine g={g} since={live.since} now={now} /> : undefined,
      y: fav,
      actions: [
        { id: 'play', label: live ? tr('Oyun açık') : g.installed ? tr('Oyna') : tr('Kur'), primary: true, icon: <Play size={16} strokeWidth={2} />, run: () => { if (!live) launch(g); } },
        { id: 'fav', label: g.favorite ? tr('Favorilerden çıkar') : tr('Favorilere ekle'), icon: <Heart size={16} strokeWidth={1.8} />, run: fav.run },
        { id: 'desk', label: tr('Masaüstünde aç'), icon: <ExternalLink size={16} strokeWidth={1.8} />, run: () => { setBig(false); go({ name: 'game', id: g.id }); } },
      ],
    };
  };
}

function LibraryTab(p: TabProps) {
  const { games, demo } = useStore();
  const item = useGameItem(p.now);
  const shelves = useMemo((): BigShelf[] => {
    const pc = games.filter((g) => !isSystem(g.platform));
    const retro = (Object.keys(PLATFORMS) as PlatformId[])
      .filter((x) => PLATFORMS[x].kind === 'system')
      .map((x) => ({ id: x, label: PLATFORMS[x].name, games: games.filter((g) => g.platform === x && (demo || g.installed)).sort(byTitle) }));
    return [
      { id: 'recent', label: tr('Kaldığın yerden'), games: games.filter((g) => lastPlayed(g)).sort(byRecent).slice(0, 16) },
      { id: 'installed', label: tr('Yüklü'), games: pc.filter((g) => g.installed).sort(byRecent) },
      { id: 'favorites', label: tr('Favoriler'), games: games.filter((g) => g.favorite).sort(byRecent) },
      ...retro,
      { id: 'all', label: tr('Tüm oyunlar'), games: pc.slice().sort(byTitle) },
    ].filter((s) => s.games.length > 0).map((s) => ({ id: s.id, label: s.label, shape: 'cover' as const, items: s.games.map(item) }));
  }, [games, demo, p.now]); // eslint-disable-line react-hooks/exhaustive-deps
  return <ShelfBrowser {...p} shelves={shelves} empty={tr('Kütüphane boş.')} />;
}

// ---------------------------------------------------------------- wishlist

function WishTab(p: TabProps) {
  const { wishlist } = useStore();
  const shelves = useMemo((): BigShelf[] => {
    const items = wishlist?.items ?? [];
    const one = (w: (typeof items)[number]): BigItem => ({
      key: `wish:${w.appid}`, title: w.name, art: w.header, bg: heroArt(w.appid), bgFallback: w.header,
      tag: <PriceTag w={w} />, meta: wishFacts(w),
      actions: [{ id: 'store', label: tr('Mağazada aç'), primary: true, icon: <Store size={16} strokeWidth={1.8} />, run: () => openSteam(w.appid) }],
    });
    return [
      { id: 'sale', label: tr('İndirimde'), shape: 'wide' as const, items: items.filter((w) => w.discount > 0).sort((a, b) => b.discount - a.discount).map(one) },
      { id: 'out', label: tr('Çıkmış'), shape: 'wide' as const, items: items.filter((w) => !w.comingSoon && !(w.discount > 0)).sort((a, b) => a.priority - b.priority).map(one) },
      { id: 'soon', label: tr('Yakında'), shape: 'wide' as const, items: items.filter((w) => w.comingSoon).map(one) },
    ].filter((s) => s.items.length > 0);
  }, [wishlist]);
  return <ShelfBrowser {...p} shelves={shelves} empty={tr('İstek listesi için Steam hesabını bağla. Liste Steam profilinden okunur; anahtar gerekmez.')} />;
}

// ---------------------------------------------------------------- price search

const KEYS_ROWS = ['1234567890', 'QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
const KB_SPECIAL = ['space', 'del', 'go'] as const;

/** letters to pick with the d-pad; a real keyboard types straight in */
function Keyboard({ q, setQ, at, kind }: { q: string; setQ: (v: string) => void; at: [number, number]; kind: PadKind | null }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const rows: string[][] = [...KEYS_ROWS.map((r) => r.split('')), [...KB_SPECIAL]];
  return (
    <div className="big-kb-wrap">
      <div className="big-kb" role="dialog" aria-label={tr('Oyun ara')}>
        <label className="big-kb-field">
          <Search size={22} strokeWidth={2} />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Oyun ara')} />
        </label>
        <div className="big-kb-keys">
          {rows.map((row, ri) => (
            <div key={ri} className="big-kb-row">
              {row.map((k, ki) => {
                const on = at[0] === ri && at[1] === ki;
                const label = k === 'space' ? tr('Boşluk') : k === 'del' ? <Delete size={20} strokeWidth={2} /> : k === 'go' ? tr('Ara') : k;
                return (
                  <button key={k} className={`big-kb-key ${on ? 'is-focus' : ''} is-${k.length > 1 ? k : 'char'}`}
                    onClick={() => setQ(k === 'space' ? `${q} ` : k === 'del' ? q.slice(0, -1) : k === 'go' ? q : q + k.toLowerCase())}>
                    {label}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <p className="big-kb-hints"><Glyph b="x" kind={kind} /> {tr('Sil')} <Glyph b="b" kind={kind} /> {tr('Kapat')}</p>
      </div>
    </div>
  );
}

function ShopTab(p: TabProps) {
  const { demo, games, notify } = useStore();
  const tracked = useTracked();
  const [popular, setPopular] = useState<ShopHit[] | null>(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<ShopHit[] | null>(null);
  const [kb, setKb] = useState(false);
  const [at, setAt] = useState<[number, number]>([1, 0]);
  const [jump, setJump] = useState<string | null>(null);

  useEffect(() => { shopData.popular(demo, games).then(setPopular).catch(() => setPopular([])); }, [demo]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults(null); return; }
    let live = true;
    const t = window.setTimeout(() => { shopData.search(term, demo).then((r) => { if (live) setResults(r); }).catch(() => {}); }, 350);
    return () => { live = false; window.clearTimeout(t); };
  }, [q, demo]);

  const hitItem = (h: ShopHit): BigItem => {
    const best = h.prices ? cheapest(h.prices.deals) : null;
    const art = h.art?.banner ?? h.art?.small ?? null;
    const isTracked = tracked.some((x) => x.gid === h.gid);
    const fol = { label: isTracked ? tr('Takibi bırak') : tr('Takip et'), run: () => { (isTracked ? unfollow(h.gid) : follow(h.gid, h.title, art)).then(() => notify(isTracked ? tr('Takip bırakıldı') : tr('Takip ediliyor · ucuzlayınca haber verilecek'))).catch((e) => notify(String(e))); } };
    return {
      key: `shop:${h.gid}`, title: h.title, art, bg: h.art?.banner ?? art,
      tag: best ? <span className={`wl-tag ${best.cut > 0 ? 'is-sale' : ''}`}>{best.cut > 0 && <span className="wl-cut num">−{pct(best.cut)}</span>}<span className="wl-amount"><b className="num">{money(best.price, best.currency)}</b></span></span> : undefined,
      sub: best ? tr('En ucuz: {0}', best.shop) : undefined,
      meta: best ? [tr('En ucuz: {0}', best.shop)] : [],
      y: fol,
      load: async () => {
        const r = await shopData.game(h.gid, demo);
        const deals = r.prices?.deals ?? [];
        const info = r.info;
        return {
          meta: [
            ...(info?.releaseDate ? [new Date(info.releaseDate).getFullYear().toString()] : []),
            ...(info?.developers?.length ? [info.developers.slice(0, 2).join(', ')] : []),
            ...(info?.tags?.length ? [info.tags.slice(0, 3).join(' · ')] : []),
          ],
          actions: [
            ...deals.slice(0, 5).map((d, i) => ({
              id: `deal${i}`, primary: i === 0, icon: <Store size={16} strokeWidth={1.8} />,
              label: `${d.shop} · ${money(d.price, d.currency)}${d.cut > 0 ? ` (−%${d.cut})` : ''}`,
              run: () => { void openDeal(d, r.prices?.gid ?? h.gid, null); },
            })),
            { id: 'follow', label: fol.label, icon: isTracked ? <BellRing size={16} strokeWidth={1.8} /> : <Bell size={16} strokeWidth={1.8} />, run: fol.run },
          ],
          facts: r.prices?.low ? [[tr('Gördüğü en düşük fiyat'), money(r.prices.low.price, r.prices.low.currency)]] : undefined,
        };
      },
    };
  };

  const shelves: BigShelf[] = [
    {
      id: 'search', label: tr('Ara'), shape: 'wide',
      items: [{ key: 'search', title: q ? `“${q}”` : tr('Oyun ara'), icon: <Search size={40} strokeWidth={1.8} />, pick: () => { setAt([1, 0]); setKb(true); } }],
    },
    ...(results ? [{ id: 'results', label: tr('Sonuçlar'), shape: 'wide' as const, items: results.map(hitItem) }] : []),
    ...(tracked.length ? [{
      id: 'tracked', label: tr('Takip ettiklerin'), shape: 'wide' as const,
      items: tracked.map((x) => hitItem({ gid: x.gid, title: x.title, type: 'game', mature: false, art: { banner: x.art, small: x.art, boxart: null }, prices: x.price != null ? { deals: [{ shop: x.shop ?? '', shopId: x.shopId ?? 0, price: x.price, regular: x.regular ?? x.price, cut: x.cut ?? 0, currency: x.currency ?? 'USD', storeLow: null, voucher: null, drm: [], url: '' }], low: null } : undefined })),
    }] : []),
    ...(popular && popular.length ? [{ id: 'popular', label: tr('Popüler'), shape: 'wide' as const, items: popular.map(hitItem) }] : []),
  ];

  const rows = [...KEYS_ROWS.map((r) => r.length), KB_SPECIAL.length];
  const intercept: Handler = (a) => {
    if (!kb) return false;
    const [r, c] = at;
    const key = r < KEYS_ROWS.length ? KEYS_ROWS[r][c] : KB_SPECIAL[c];
    const sound = (k: 'move' | 'select' | 'back') => tick(k, 0.5);
    if (a === 'up' && r > 0) { sound('move'); setAt([r - 1, Math.min(c, rows[r - 1] - 1)]); }
    if (a === 'down' && r < rows.length - 1) { sound('move'); setAt([r + 1, Math.min(c, rows[r + 1] - 1)]); }
    if (a === 'left' && c > 0) { sound('move'); setAt([r, c - 1]); }
    if (a === 'right' && c < rows[r] - 1) { sound('move'); setAt([r, c + 1]); }
    if (a === 'x') setQ((v) => v.slice(0, -1));
    if (a === 'a') {
      sound('select');
      if (key === 'space') setQ((v) => `${v} `);
      else if (key === 'del') setQ((v) => v.slice(0, -1));
      else if (key === 'go') { setKb(false); setJump(`results:${Date.now()}`); }
      else setQ((v) => v + key.toLowerCase());
    }
    if (a === 'b') { sound('back'); setKb(false); if (q.trim().length >= 2) setJump(`results:${Date.now()}`); }
    return true;
  };

  return (
    <ShelfBrowser {...p} shelves={shelves} loading={!popular} intercept={intercept} focusShelf={jump ? 'results' : null}
      overlay={kb ? <Keyboard q={q} setQ={setQ} at={at} kind={p.kind} /> : null} />
  );
}

// ---------------------------------------------------------------- updates

function NewsTab(p: TabProps) {
  const { all, loading } = useFeed();
  const week = Date.now() / 1000 - 7 * 86400;
  const one = (x: (typeof all)[number]): BigItem => {
    const art = x.n.image ?? x.g.hero ?? x.g.header ?? null;
    return {
      key: `news:${x.g.id}:${x.n.id}`, title: x.n.title, art, bg: art, bgFallback: x.g.hero,
      sub: `${x.g.title} · ${ago(new Date(x.n.date * 1000))}`,
      tag: x.n.patch ? <span className="nw-badge"><Wrench size={12} strokeWidth={2} /> {tr('Yama')}</span> : undefined,
      meta: [x.g.title, ago(new Date(x.n.date * 1000))],
      text: x.n.body || x.n.summary,
      actions: [{ id: 'steam', label: tr('Steam’de aç'), primary: true, icon: <ExternalLink size={16} strokeWidth={1.8} />, run: () => { api.openUrl(x.n.url).catch(() => window.open(x.n.url, '_blank')); } }],
    };
  };
  const shelves: BigShelf[] = [
    { id: 'week', label: tr('Bu hafta'), shape: 'wide' as const, items: all.filter((x) => x.n.date >= week).map(one) },
    { id: 'before', label: tr('Daha önce'), shape: 'wide' as const, items: all.filter((x) => x.n.date < week).map(one) },
  ].filter((s) => s.items.length > 0);
  return <ShelfBrowser {...p} shelves={shelves} loading={loading} empty={tr('Takip edilecek Steam oyunu yok. Steam hesabını bağlayınca yüklü ve oynadığın oyunların duyuruları burada toplanır.')} />;
}

// ---------------------------------------------------------------- friends

const steamHeader = (appid: number) => `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/library_hero.jpg`;

function FriendsTab(p: TabProps) {
  const { demo, accounts } = useStore();
  const [list, setList] = useState<Friend[] | null>(null);
  const steamOn = demo || accounts.some((a) => a.platform === 'steam');
  useEffect(() => {
    if (!steamOn) { setList([]); return; }
    let live = true;
    const load = () => fetchFriends('steam', demo).then((f) => { if (live) setList(f); }).catch(() => { if (live) setList([]); });
    void load();
    const t = window.setInterval(load, 60_000);
    return () => { live = false; window.clearInterval(t); };
  }, [steamOn, demo]);

  const one = (f: Friend): BigItem => {
    const id = steamId(f);
    return {
      key: `friend:${f.account}`, title: f.name, art: f.avatar, bg: f.appid ? steamHeader(f.appid) : null,
      sub: f.game ?? f.note ?? (f.state === 'offline' ? tr('Çevrimdışı') : tr('Çevrimiçi')),
      meta: [f.game ? `${tr('Oyunda')} · ${f.game}` : f.note ?? tr('Çevrimiçi'), ...(f.presence ? [f.presence] : [])],
      actions: [
        ...(id ? [{ id: 'chat', label: tr('Mesaj gönder'), primary: true, icon: <MessageSquare size={16} strokeWidth={1.8} />, run: () => steam(`friends/message/${id}`) }] : []),
        ...(id ? [{ id: 'profile', label: tr('Profili görüntüle'), icon: <User size={16} strokeWidth={1.8} />, run: () => steam(`url/SteamIDPage/${id}`) }] : []),
        ...(f.appid ? [
          { id: 'run', label: tr('Oyunu başlat'), icon: <Gamepad2 size={16} strokeWidth={1.8} />, run: () => steam(`run/${f.appid}`) },
          { id: 'store', label: tr('Mağaza sayfası'), icon: <Store size={16} strokeWidth={1.8} />, run: () => steam(`store/${f.appid}`) },
        ] : []),
      ],
    };
  };
  const all = list ?? [];
  const shelves: BigShelf[] = [
    { id: 'ingame', label: tr('Oyunda'), shape: 'person' as const, items: all.filter((f) => f.state === 'in-game').map(one) },
    { id: 'online', label: tr('Çevrimiçi'), shape: 'person' as const, items: all.filter((f) => f.state !== 'in-game' && f.state !== 'offline').map(one) },
    { id: 'offline', label: tr('Çevrimdışı'), shape: 'person' as const, items: all.filter((f) => f.state === 'offline').slice(0, 40).map(one) },
  ].filter((s) => s.items.length > 0);
  return <ShelfBrowser {...p} shelves={shelves} loading={list === null} empty={steamOn ? tr('Arkadaş yok.') : tr('Arkadaşlarını görmek için Steam hesabını bağla.')} />;
}

// ---------------------------------------------------------------- stats

function StatsTab(p: TabProps) {
  const { games } = useStore();
  const item = useGameItem(p.now);
  const shelves = useMemo((): BigShelf[] => {
    const minutes = games.reduce((a, g) => a + totalMinutes(g), 0);
    const weekAgo = Date.now() - 7 * 86400000;
    const week = games.reduce((a, g) => a + g.sessions.filter((s) => new Date(s.start).getTime() >= weekAgo).reduce((x, s) => x + s.minutes, 0), 0);
    const finished = games.filter((g) => g.status === 'completed' || g.status === 'hundred');
    const ach = games.reduce((a, g) => a + (g.achievements?.unlocked ?? 0), 0);
    const never = games.filter((g) => totalMinutes(g) === 0).length;
    const top = [...games].filter((g) => totalMinutes(g) > 0).sort((a, b) => totalMinutes(b) - totalMinutes(a)).slice(0, 15);
    const bg = top[0] ? top[0].hero ?? top[0].header : null;
    const stat = (k: string, n: string, label: string): BigItem => ({ key: `stat:${k}`, title: n, sub: label, meta: [label], bg });
    return [
      {
        id: 'summary', label: tr('Özet'), shape: 'stat' as const, items: [
          stat('total', duration(minutes, { compact: true }), tr('Toplam oynama')),
          stat('week', duration(week), tr('Bu hafta')),
          stat('games', int(games.length), tr('Oyun')),
          stat('finished', int(finished.length), tr('Bitirilen')),
          stat('ach', int(ach), tr('Başarım')),
          stat('never', int(never), tr('Hiç açılmamış')),
        ],
      },
      { id: 'top', label: tr('En çok oynadıkların'), shape: 'cover' as const, items: top.map(item) },
      { id: 'done', label: tr('Bitirdiklerin'), shape: 'cover' as const, items: finished.map(item) },
    ].filter((s) => s.items.length > 0);
  }, [games, p.now]); // eslint-disable-line react-hooks/exhaustive-deps
  return <ShelfBrowser {...p} shelves={shelves} />;
}

