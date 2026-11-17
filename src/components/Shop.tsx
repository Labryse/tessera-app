// "Fiyat ara": any game, owned or not, by name, with its price in every store.
// The results show each game's cheapest price; a game opens its own page with
// what it is (release, makers, reviews) and the full store list.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BellRing, Search, Shuffle, X } from 'lucide-react';
import { useStore } from '../store';
import { api, type GamePrices, type ShopHit, type ShopInfo } from '../lib/backend';
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
const PICKS = 18;

const norm = (s: string) => s.toLowerCase().replace(/[™®©:'’.\-–—!?,]/g, '').replace(/\s+/g, ' ').trim();

/** the library's copy of a store game, by Steam app or by name */
function owned(games: Game[], title: string, appid?: number | null) {
  const n = norm(title);
  return games.find((g) => (appid != null && steamApp(g) === appid) || norm(g.title) === n) ?? null;
}

const TYPE: Record<string, string> = { dlc: tr('Ek paket'), package: tr('Paket'), bundle: tr('Paket'), game: '' };

function shuffle<T>(a: T[]) {
  const v = [...a];
  for (let i = v.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [v[i], v[j]] = [v[j], v[i]]; }
  return v;
}

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
function ShopCard({ h, i, big = false }: { h: ShopHit; i: number; big?: boolean }) {
  const { go, games } = useStore();
  const best = h.prices ? cheapest(h.prices.deals) : null;
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
        {best && <span className="shop-store"><ShopMark id={best.shopId} name={best.shop} size={13} /> {tr('En ucuz: {0}', best.shop)}</span>}
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
  const [roll, setRoll] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);

  // popular games the user does not own, a different handful each time
  useEffect(() => {
    if (picks && roll === 0) return;
    let live = true;
    (async () => {
      try {
        const r = demo ? { hasKey: true, items: SAMPLE.filter((s) => s.type !== 'dlc').map(sampleHit) } : await api.shopPopular();
        if (!live) return;
        setHasKey(r.hasKey);
        const chosen = shuffle(r.items.filter((h) => !owned(games, h.title))).slice(0, PICKS).map((h) => ({ ...h, art: h.art ?? NO_ART }));
        remember(chosen);
        picks = chosen;
        setPopular(chosen);
        if (demo || !chosen.length) return;
        const art = await api.shopArt(chosen.map((h) => h.gid));
        if (!live) return;
        const withArt = chosen.map((h) => ({ ...h, art: art[h.gid] ?? h.art }));
        remember(withArt);
        picks = withArt;
        setPopular(withArt);
      } catch (e) { if (live) setError(String(e)); }
    })();
    return () => { live = false; };
  }, [roll, demo]); // eslint-disable-line react-hooks/exhaustive-deps

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

      {searching ? (
        <>
          {hasKey && !error && done && done === q.trim() && !busy && items.length === 0 && (
            <p className="muted shop-none">“{q.trim()}{tr('” için bir oyun bulunamadı.')}</p>
          )}
          <div className="shop-grid">
            {sorted.map((h, i) => <ShopCard key={h.gid} h={h} i={i} />)}
          </div>
        </>
      ) : hasKey && (
        <>
        <TrackedShelf />
        <section className="shop-popular" aria-label={tr('Popüler')}>
          <div className="shop-section-head">
            <h2 className="sc-title">{tr('Popüler')}</h2>
            <button className="btn btn-ghost btn-sm" onClick={() => setRoll((n) => n + 1)}><Shuffle size={14} strokeWidth={1.8} /> {tr('Başkaları')}</button>
          </div>
          {!popular && <div className="shop-grid shop-feature">{Array.from({ length: 7 }, (_, i) => <span key={i} className={`shop-skel ${i === 0 ? 'is-big' : ''}`} />)}</div>}
          {popular && (
            <div className="shop-grid shop-feature" key={roll}>
              {popular.map((h, i) => <ShopCard key={h.gid} h={h} i={i} big={i === 0} />)}
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
    const chosen = shuffle(r.items.filter((h) => !owned(games, h.title))).slice(0, PICKS).map((h) => ({ ...h, art: h.art ?? NO_ART }));
    if (!demo && chosen.length) {
      const art = await api.shopArt(chosen.map((h) => h.gid)).catch(() => ({} as Record<string, ShopHit['art']>));
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
