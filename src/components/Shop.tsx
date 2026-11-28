// "Fiyat ara": any game, owned or not, by name, with its price in every store.
// The results show each game's cheapest price; a game opens its own page with
// what it is (release, makers, reviews) and the full store list.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BadgePercent, BellRing, ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { useStore } from '../store';
import { api, type Deal, type GamePrices, type ShopHit, type ShopInfo } from '../lib/backend';
import { cheapest, KeyAsk, money, PriceList, samplePrices, ShopMark } from './Stores';
import { steamApp } from './News';
import { FollowButton, TrackedShelf, useIsTracked } from './Track';
import type { Game } from '../data/library';
import { pct } from '../lib/format';

import { t as tr, locale } from '../lib/i18n';
// the last search and the popular picks, kept while the user looks at a game and comes back
let last: { q: string; items: ShopHit[]; apps?: Record<string, boolean> } = { q: '', items: [] };
let picks: ShopHit[] | null = null;
const NO_ART = { banner: null, small: null, boxart: null };
const known = new Map<string, ShopHit>();
const remember = (list: ShopHit[]) => { for (const h of list) known.set(h.gid, { ...h, art: h.art ?? known.get(h.gid)?.art ?? NO_ART }); };
/** the charts: this many games on the page, and this many for one store */
const ALL_CAP = 100;
const STORE_CAP = 50;
const PICKS = 18;

// the store and "on sale only" picks, kept between visits
type Narrow = { shop: number | null; sale: boolean };
const NARROW_KEY = 'tessera.shopNarrow';
function loadNarrow(): Narrow {
  try {
    const v = JSON.parse(localStorage.getItem(NARROW_KEY) ?? 'null');
    if (v && typeof v === 'object') return { shop: typeof v.shop === 'number' ? v.shop : null, sale: v.sale === true };
  } catch { /* no storage */ }
  return { shop: null, sale: false };
}
function saveNarrow(n: Narrow) {
  try { localStorage.setItem(NARROW_KEY, JSON.stringify(n)); } catch { /* no storage */ }
}

/** the price a card shows: the chosen store's, otherwise the cheapest */
function dealOf(h: ShopHit, shop: number | null): Deal | null {
  const deals = h.prices?.deals ?? [];
  return shop == null ? cheapest(deals) : deals.find((d) => d.shopId === shop) ?? null;
}
const passes = (h: ShopHit, n: Narrow) => {
  if (n.shop == null && !n.sale) return true;
  const d = dealOf(h, n.shop);
  return !!d && (!n.sale || d.cut > 0);
};

// the stores the library itself comes from go first when counts tie
const MAIN_SHOPS = [61, 16, 35, 48, 62, 52, 4];

/** the stores that sell something in these results (on sale, when only sales are asked for), the busiest first */
function storesIn(list: ShopHit[], sale = false, cap = Infinity) {
  const m = new Map<number, { id: number; name: string; n: number }>();
  for (const h of list) {
    const seen = new Set<number>();
    for (const d of h.prices?.deals ?? []) {
      if (seen.has(d.shopId) || (sale && d.cut <= 0)) continue;
      seen.add(d.shopId);
      const e = m.get(d.shopId);
      if (e) e.n++; else m.set(d.shopId, { id: d.shopId, name: d.shop, n: 1 });
    }
  }
  const rank = (id: number) => { const i = MAIN_SHOPS.indexOf(id); return i < 0 ? 99 : i; };
  for (const e of m.values()) e.n = Math.min(e.n, cap);
  return [...m.values()].sort((a, b) => b.n - a.n || rank(a.id) - rank(b.id) || a.name.localeCompare(b.name, locale));
}

type StoreCount = { id: number; name: string; n: number };
/** a row wider than its room: the wheel scrolls it sideways, arrows at an end that has more */
function useSideScroll(deps: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ left: false, right: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const look = () => setMore({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
    const wheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      el.scrollBy({ left: e.deltaY, behavior: 'auto' });
    };
    look();
    const ro = new ResizeObserver(look);
    ro.observe(el);
    el.addEventListener('scroll', look, { passive: true });
    el.addEventListener('wheel', wheel, { passive: false });
    return () => { ro.disconnect(); el.removeEventListener('scroll', look); el.removeEventListener('wheel', wheel); };
  }, [deps]);
  const nudge = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.7, behavior: 'smooth' });
  return { ref, more, nudge };
}

function StoreFilter({ stores, value, onChange }: { stores: StoreCount[]; value: Narrow; onChange: (n: Narrow) => void }) {
  // a chosen store stays on the row even when these results have nothing from it
  const list = value.shop != null && !stores.some((x) => x.id === value.shop) ? [...stores, { id: value.shop, name: tr('Seçili mağaza'), n: 0 }] : stores;
  const hide = list.length < 2 && value.shop == null && !value.sale;
  const row = useSideScroll(hide ? 0 : list.length);
  if (hide) return null;
  return (
    <div className="shop-narrow" role="group" aria-label={tr('Mağazaya göre')}>
      <div className="sc-chips">
        <button aria-pressed={value.sale} onClick={() => onChange({ ...value, sale: !value.sale })}><BadgePercent size={14} strokeWidth={1.9} /> {tr('İndirimde')}</button>
      </div>
      <div className={`shop-stores-wrap ${row.more.left ? 'more-left' : ''} ${row.more.right ? 'more-right' : ''}`}>
        <div className="sc-chips shop-stores" ref={row.ref}>
          <button aria-pressed={value.shop == null} onClick={() => onChange({ ...value, shop: null })}>{tr('Tüm mağazalar')}</button>
          {list.map((x) => (
            <button key={x.id} aria-pressed={value.shop === x.id} onClick={(e) => { e.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }); onChange({ ...value, shop: value.shop === x.id ? null : x.id }); }} title={x.name}>
              <ShopMark id={x.id} name={x.name} size={14} /> {x.name} <b className="num">{x.n}</b>
            </button>
          ))}
        </div>
        {row.more.left && <button className="shop-stores-arrow is-left" onClick={() => row.nudge(-1)} aria-label={tr('Önceki mağazalar')} tabIndex={-1}><ChevronLeft size={16} strokeWidth={2} /></button>}
        {row.more.right && <button className="shop-stores-arrow is-right" onClick={() => row.nudge(1)} aria-label={tr('Sonraki mağazalar')} tabIndex={-1}><ChevronRight size={16} strokeWidth={2} /></button>}
      </div>
    </div>
  );
}

const norm = (s: string) => s.toLowerCase().replace(/[™®©:'’.\-–—!?,]/g, '').replace(/\s+/g, ' ').trim();

/** the library's copy of a store game, by Steam app or by name */
function owned(games: Game[], title: string, appid?: number | null) {
  const n = norm(title);
  return games.find((g) => (appid != null && steamApp(g) === appid) || norm(g.title) === n) ?? null;
}

const TYPE: Record<string, string> = { dlc: tr('Ek paket'), package: tr('Paket'), bundle: tr('Paket'), game: '' };

// SAMPLE: the browser demo cannot reach IsThereAnyDeal
const steamArt = (a: number) => `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${a}/header.jpg`;
const SAMPLE: { title: string; appid: number; type?: string }[] = [
  { title: tr('Crimson Desert'), appid: 3321460 },
  { title: tr('Hollow Knight: Silksong'), appid: 1030300 },
  { title: tr('ELDEN RING NIGHTREIGN'), appid: 2622380 },
  { title: tr('Hades II'), appid: 1145350 },
  { title: tr('Baldur’s Gate 3'), appid: 1086940 },
  { title: tr('Baldur’s Gate 3 - Digital Deluxe Edition'), appid: 1086940, type: 'dlc' },
  { title: tr('Cyberpunk 2077'), appid: 1091500 },
  { title: tr('ELDEN RING'), appid: 1245620 },
  { title: tr('The Witcher 3: Wild Hunt'), appid: 292030 },
  { title: tr('Red Dead Redemption 2'), appid: 1174180 },
  { title: tr('Stardew Valley'), appid: 413150 },
  { title: tr('Terraria'), appid: 105600 },
  { title: tr('Hollow Knight'), appid: 367520 },
  { title: tr('Sekiro: Shadows Die Twice'), appid: 814380 },
  { title: tr('Resident Evil 4'), appid: 2050650 },
  { title: tr('God of War'), appid: 1593500 },
  { title: tr('Ghost of Tsushima'), appid: 2215430 },
  { title: tr('Hogwarts Legacy'), appid: 990080 },
  { title: tr('Black Myth: Wukong'), appid: 2358720 },
  { title: tr('Valheim'), appid: 892970 },
  { title: tr('DARK SOULS III'), appid: 374320 },
  { title: tr('The Elder Scrolls V: Skyrim Special Edition'), appid: 489830 },
  { title: tr('Marvel’s Spider-Man Remastered'), appid: 1817070 },
  { title: tr('Hades'), appid: 1145360 },
];
const sampleHit = (s: (typeof SAMPLE)[number]): ShopHit => {
  const p = samplePrices(s.title);
  return { gid: `sample:${s.title}`, title: s.title, type: s.type ?? 'game', mature: false, art: { banner: steamArt(s.appid), small: steamArt(s.appid), boxart: null }, prices: { deals: p.deals ?? [], low: p.low ?? null } };
};
function sampleSearch(q: string): ShopHit[] {
  const n = norm(q);
  return SAMPLE.filter((s) => norm(s.title).includes(n)).map(sampleHit);
}
function sampleGame(gid: string): { info: ShopInfo; prices: GamePrices } {
  const title = gid.replace(/^sample:/, '');
  const s = SAMPLE.find((x) => x.title === title) ?? SAMPLE[0];
  return {
    info: {
      gid, title, type: s.type ?? 'game', appid: s.appid, earlyAccess: false, art: { banner: steamArt(s.appid), small: steamArt(s.appid), boxart: null },
      tags: [tr('Aksiyon'), tr('Açık dünya'), 'RPG'], releaseDate: '2026-03-19', developers: [tr('Örnek Stüdyo')], publishers: [tr('Örnek Yayıncı')],
      reviews: [{ source: tr('Steam'), score: 86, count: 41230, url: null }, { source: tr('Metascore'), score: 82, count: null, url: null }],
    },
    prices: samplePrices(title),
  };
}

export function ShopView({ gid }: { gid?: string }) {
  return gid ? <ShopGame gid={gid} /> : <ShopSearch />;
}

/** one game: its art with the cheapest price under it */
function ShopCard({ h, i, big = false, shop = null }: { h: ShopHit; i: number; big?: boolean; shop?: number | null }) {
  const { go, games } = useStore();
  const best = h.prices ? dealOf(h, shop) : null;
  // with one store chosen, a cheaper price elsewhere is still worth a line
  const low = shop != null && h.prices ? cheapest(h.prices.deals) : null;
  const elsewhere = low && best && low.shopId !== best.shopId && low.currency === best.currency && low.price < best.price ? low : null;
  const mine = owned(games, h.title);
  const kind = TYPE[h.type ?? ''] ?? '';
  const art = h.art ?? NO_ART;
  const src = big ? art.banner ?? art.small : art.small ?? art.banner;
  const tracked = useIsTracked(h.gid);
  return (
    <button className={`shop-card ${big ? 'is-big' : ''}`} style={{ '--i': Math.min(i, 14) } as React.CSSProperties} onClick={() => go({ name: 'shop', gid: h.gid })}>
      <span className="shop-art">
        {src ? <img src={src} alt="" loading="lazy" /> : <span className="shop-art-none">{h.title}</span>}
        {(kind || mine) && (
          <span className="shop-tags">
            {kind && <span className="shop-kind">{kind}</span>}
            {mine && <span className="shop-kind is-owned">{tr('Kütüphanende')}</span>}
          </span>
        )}
        {tracked && <span className="shop-bell" aria-label={tr('Takip ediliyor')}><BellRing size={13} strokeWidth={2} /></span>}
        {best ? (
          <span className={`wl-tag ${best.cut > 0 ? 'is-sale' : ''} ${big ? 'is-big' : ''}`}>
            {best.cut > 0 && <span className="wl-cut num">−{pct(best.cut)}</span>}
            <span className="wl-amount">
              {best.cut > 0 && <s className="num">{money(best.regular, best.currency)}</s>}
              <b className="num">{money(best.price, best.currency)}</b>
            </span>
          </span>
        ) : h.prices ? <span className="wl-tag is-none">{tr('Satışta değil')}</span> : null}
      </span>
      <span className="shop-body">
        <span className="shop-name" title={h.title}>{h.title}</span>
        {best && !elsewhere && <span className="shop-store"><ShopMark id={best.shopId} name={best.shop} size={13} /> {shop != null ? best.shop : tr('En ucuz: {0}', best.shop)}</span>}
        {elsewhere && <span className="shop-store"><ShopMark id={elsewhere.shopId} name={elsewhere.shop} size={13} /> {tr('Daha ucuzu: {0} · {1}', elsewhere.shop, money(elsewhere.price, elsewhere.currency))}</span>}
      </span>
    </button>
  );
}

function ShopSearch() {
  const { demo, games, openSettings } = useStore();
  const [q, setQ] = useState(last.q);
  const [items, setItems] = useState<ShopHit[]>(last.items);
  const [hasKey, setHasKey] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // the term the shown results belong to ("nothing found" only once a search answered)
  const [done, setDone] = useState(last.q);
  const [popular, setPopular] = useState<ShopHit[] | null>(picks);
  const [narrow, setNarrowState] = useState<Narrow>(loadNarrow);
  const setNarrow = (n: Narrow) => { setNarrowState(n); saveNarrow(n); };
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);

  // this week's best sellers and most played that the user does not own, in chart order
  useEffect(() => {
    if (picks) return;
    let live = true;
    (async () => {
      try {
        const r = demo ? { hasKey: true, items: SAMPLE.filter((s) => s.type !== 'dlc').map(sampleHit) } : await api.shopPopular();
        if (!live) return;
        setHasKey(r.hasKey);
        let list = r.items.filter((h) => !owned(games, h.title, h.appid)).map((h) => ({ ...h, art: h.art ?? NO_ART }));
        remember(list);
        picks = list;
        setPopular(list);
        if (demo) return;
        // Steam and GOG charts bring their own pictures; the rest are asked for in small batches
        const bare = list.filter((h) => !h.art.banner && !h.art.small).map((h) => h.gid).slice(0, 160);
        for (let i = 0; i < bare.length && live; i += 40) {
          const art = await api.shopArt(bare.slice(i, i + 40)).catch(() => ({} as Record<string, ShopHit['art']>));
          if (!live) return;
          list = list.map((h) => (art[h.gid] ? { ...h, art: art[h.gid] } : h));
          remember(list);
          picks = list;
          setPopular(list);
        }
      } catch (e) { if (live) setError(String(e)); }
    })();
    return () => { live = false; };
  }, [demo]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const term = q.trim();
    if (term === last.q && items === last.items && term) return;
    if (term.length < 2) { setItems([]); setDone(''); last = { q: term, items: [] }; return; }
    let live = true;
    const t = window.setTimeout(async () => {
      setBusy(true); setError(null);
      try {
        const r = demo ? { hasKey: true, items: sampleSearch(term), apps: { 61: true } } : await api.shopSearch(term);
        if (!live) return;
        setHasKey(r.hasKey); setItems(r.items); setDone(term);
        remember(r.items);
        last = { q: term, items: r.items, apps: r.apps };
      } catch (e) { if (live) setError(String(e)); }
      if (live) setBusy(false);
    }, 380);
    return () => { live = false; window.clearTimeout(t); };
  }, [q, demo]); // eslint-disable-line react-hooks/exhaustive-deps

  // games first, add-ons after; the search's own order within each
  const sorted = useMemo(() => [...items].sort((a, b) => Number(a.type !== 'game') - Number(b.type !== 'game')), [items]);
  const searching = q.trim().length >= 2;
  const stores = useMemo(() => (searching ? storesIn(items, narrow.sale) : storesIn(popular ?? [], narrow.sale, STORE_CAP)), [searching, items, popular, narrow.sale]);
  const shown = sorted.filter((h) => passes(h, narrow));
  const shownPopular = (popular ?? []).filter((h) => passes(h, narrow)).slice(0, narrow.shop != null ? STORE_CAP : ALL_CAP);
  const narrowed = narrow.shop != null || narrow.sale;
  const storeName = narrow.shop != null ? stores.find((x) => x.id === narrow.shop)?.name ?? null : null;
  const nothingHere = (
    <p className="muted shop-none">
      {storeName
        ? narrow.sale ? tr('{0} mağazasında bunlardan indirimde olan yok.', storeName) : tr('Bunların hiçbiri {0} mağazasında satılmıyor.', storeName)
        : narrow.sale ? tr('Bunlardan indirimde olan yok.') : tr('Bunların hiçbiri seçili mağazada satılmıyor.')}
    </p>
  );
  const backdrop = (popular ?? []).map((h) => h.art?.banner ?? h.art?.small).filter(Boolean).slice(0, 5) as string[];

  return (
    <div className="page shop-page">
      <div className="sc-ambient" aria-hidden="true">{backdrop[0] && <img src={backdrop[0]} alt="" />}</div>
      <section className="shop-hero">
        <div className="shop-hero-art" aria-hidden="true">
          {backdrop.map((src, i) => <img key={src} src={src} alt="" style={{ '--i': i } as React.CSSProperties} />)}
        </div>
        <div className="shop-hero-body">
          <h1>{tr('Fiyat ara')}</h1>
          <label className="shop-search">
            <Search size={19} strokeWidth={1.8} />
            <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Oyun ara')} aria-label={tr('Oyun adı')} />
            {busy && <span className="shop-busy" aria-label={tr('Aranıyor')}><i /><i /><i /></span>}
            {q && !busy && <button className="shop-clear" onClick={() => { setQ(''); input.current?.focus(); }} aria-label={tr('Aramayı temizle')}><X size={15} strokeWidth={1.8} /></button>}
          </label>
        </div>
      </section>

      {!hasKey && <div className="panel shop-empty"><KeyAsk onAdd={() => openSettings('accounts')} /></div>}
      {error && <div className="panel shop-empty"><p className="muted">{error}</p></div>}

      {hasKey && (searching ? items.length > 0 : !!popular?.length) && <StoreFilter stores={stores} value={narrow} onChange={setNarrow} />}

      {searching ? (
        <>
          {hasKey && !error && done && done === q.trim() && !busy && items.length === 0 && (
            <p className="muted shop-none">“{q.trim()}{tr('” için bir oyun bulunamadı.')}</p>
          )}
          {narrowed && items.length > 0 && shown.length === 0 && nothingHere}
          <div className="shop-grid">
            {shown.map((h, i) => <ShopCard key={h.gid} h={h} i={i} shop={narrow.shop} />)}
          </div>
        </>
      ) : hasKey && (
        <>
        <TrackedShelf />
        <section className="shop-popular" aria-label={tr('Popüler')}>
          <div className="shop-section-head">
            <h2 className="sc-title">{tr('Popüler')}</h2>
            {shownPopular.length > 0 && <span className="muted small num">{tr('{0} oyun', shownPopular.length)}</span>}
          </div>
          {!popular && <div className="shop-grid shop-feature">{Array.from({ length: 7 }, (_, i) => <span key={i} className={`shop-skel ${i === 0 ? 'is-big' : ''}`} />)}</div>}
          {narrowed && !!popular?.length && shownPopular.length === 0 && nothingHere}
          {popular && (
            <div className="shop-grid shop-feature">
              {shownPopular.map((h, i) => <ShopCard key={h.gid} h={h} i={i} big={i === 0 && !narrowed} shop={narrow.shop} />)}
            </div>
          )}
        </section>
        </>
      )}
    </div>
  );
}

function ShopGame({ gid }: { gid: string }) {
  const { demo, go, back, games, openSettings } = useStore();
  const [data, setData] = useState<{ hasKey: boolean; info: ShopInfo | null; prices?: GamePrices } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (demo) { setData({ hasKey: true, ...sampleGame(gid) }); return; }
    let live = true;
    api.shopGame(gid).then((r) => { if (live) setData(r); }).catch((e) => { if (live) setError(String(e)); });
    return () => { live = false; };
  }, [gid, demo]);

  const hit = known.get(gid);
  const info = data?.info;
  const title = info?.title ?? hit?.title ?? '';
  const art = info?.art.banner ?? hit?.art.banner ?? null;
  const mine = title ? owned(games, title, info?.appid) : null;
  const year = info?.releaseDate ? new Date(info.releaseDate) : null;
  const upcoming = year ? year.getTime() > Date.now() : false;
  const reviews = (info?.reviews ?? []).filter((r) => r.score != null);

  return (
    <div className="page shop-game">
      <button className="btn btn-ghost shop-back" onClick={back}><ArrowLeft size={16} strokeWidth={1.8} /> {tr('Fiyat ara')}</button>

      <header className="shop-head">
        <div className="shop-head-art">{art ? <img src={art} alt="" /> : <span>{title}</span>}</div>
        <div className="shop-head-text">
          <h1>{title || <span className="muted">{tr('Yükleniyor…')}</span>}</h1>
          {info && (
            <p className="shop-facts">
              {year && <span>{upcoming ? tr('Çıkış ') : ''}{year.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })}</span>}
              {info.earlyAccess && <span>{tr('Erken erişim')}</span>}
              {info.developers.length > 0 && <span>{info.developers.slice(0, 2).join(', ')}</span>}
              {info.publishers.length > 0 && info.publishers[0] !== info.developers[0] && <span>{info.publishers[0]}</span>}
            </p>
          )}
          {reviews.length > 0 && (
            <p className="shop-reviews">
              {reviews.slice(0, 3).map((r) => (
                <span key={r.source}><strong className="num">{r.source === 'Steam' ? pct(r.score) : r.score}</strong> <span className="muted">{r.source}{r.count ? tr(' · {0} inceleme', r.count.toLocaleString(locale)) : ''}</span></span>
              ))}
            </p>
          )}
          {info && info.tags.length > 0 && <p className="shop-taglist">{info.tags.slice(0, 5).map((t) => <span key={t} className="shop-tag">{t}</span>)}</p>}
          <div className="shop-acts">
            {data?.hasKey && <FollowButton gid={gid} title={title} art={info?.art.banner ?? info?.art.small ?? hit?.art.small ?? null} />}
            {mine && (
              <button className="btn btn-sm shop-mine" onClick={() => go({ name: 'game', id: mine.id })}>{tr('Kütüphanende var · oyuna git')}</button>
            )}
          </div>
        </div>
      </header>

      <section className="panel stores" aria-label={tr('Mağazalardaki fiyatlar')}>
        <div className="panel-head">
          <h2 className="panel-title">{tr('Mağazalar')}</h2>
          {(data?.prices?.deals?.length ?? 0) > 1 ? <span className="muted small">{data!.prices!.deals!.length} {tr('mağaza')}</span> : null}
        </div>
        {!data && !error && <div className="stores-skel" aria-hidden="true"><span /><span /><span /></div>}
        {error && <p className="muted small">{error}</p>}
        {data && !data.hasKey && <KeyAsk onAdd={() => openSettings('accounts')} />}
        {data?.prices && <PriceList data={data.prices} appid={info?.appid ?? null} />}
      </section>
    </div>
  );
}

/** the same data for the wide-screen mode */
export const shopData = {
  async popular(demo: boolean, games: Game[]): Promise<ShopHit[]> {
    if (picks) return picks;
    const r = demo ? { hasKey: true, items: SAMPLE.filter((s) => s.type !== 'dlc').map(sampleHit) } : await api.shopPopular();
    const chosen = r.items.filter((h) => !owned(games, h.title, h.appid)).slice(0, PICKS).map((h) => ({ ...h, art: h.art ?? NO_ART }));
    const bare = chosen.filter((h) => !h.art.banner && !h.art.small).map((h) => h.gid);
    if (!demo && bare.length) {
      const art = await api.shopArt(bare).catch(() => ({} as Record<string, ShopHit['art']>));
      picks = chosen.map((h) => ({ ...h, art: art[h.gid] ?? h.art }));
    } else picks = chosen;
    remember(picks);
    return picks;
  },
  async search(q: string, demo: boolean): Promise<ShopHit[]> {
    const items = demo ? sampleSearch(q) : (await api.shopSearch(q)).items;
    remember(items);
    return items;
  },
  async game(gid: string, demo: boolean): Promise<{ hasKey: boolean; info: ShopInfo | null; prices?: GamePrices }> {
    return demo ? { hasKey: true, ...sampleGame(gid) } : api.shopGame(gid);
  },
  known: (gid: string) => known.get(gid),
};
