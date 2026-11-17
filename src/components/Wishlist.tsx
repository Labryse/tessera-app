// The Steam wishlist with prices, as a sale page: the best deal large on top, then
// what is on sale, what is out and what is coming, each card with its price tag on
// the art and the cheapest other store under it.
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { CalendarClock, ExternalLink, RefreshCw, Sparkles, Tag } from 'lucide-react';
import { useStore } from '../store';
import { api, type WishItem, type WishPrices } from '../lib/backend';
import { cheapest, money, openDeal, opensApp, samplePrices, ShopMark } from './Stores';
import { ago, shortDate } from '../lib/format';
import { t, locale } from '../lib/i18n';

type Sort = 'priority' | 'discount' | 'price' | 'release' | 'added';
type Show = 'all' | 'sale' | 'out' | 'soon';

const SORTS: { id: Sort; label: string }[] = [
  { id: 'priority', label: t('Steam’deki sıra') },
  { id: 'discount', label: t('İndirim oranı') },
  { id: 'price', label: t('Fiyat') },
  { id: 'release', label: t('Çıkış tarihi') },
  { id: 'added', label: t('Eklenme') },
];

const storeUrl = (appid: number) => `https://store.steampowered.com/app/${appid}`;
export const heroArt = (appid: number) => `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/library_hero.jpg`;
/** the Steam app on the game's store page when Steam is installed, otherwise the page in the browser */
export const openSteam = (appid: number) => openDeal({ shopId: 61, url: storeUrl(appid) }, null, appid);

/** Steam sends placeholders such as text_tba for games without a date */
export function soonText(s: string | null) {
  if (!s || s === 'text_comingsoon' || (s.startsWith('text_') && s !== 'text_tba')) return t('Yakında');
  if (s === 'text_tba') return t('Duyurulacak');
  return s;
}

const onSale = (w: WishItem) => w.discount > 0;
const isOut = (w: WishItem) => !w.comingSoon;

function sorted(list: WishItem[], sort: Sort) {
  const v = [...list];
  if (sort === 'discount') v.sort((a, b) => b.discount - a.discount || a.priority - b.priority);
  if (sort === 'price') v.sort((a, b) => (a.free ? 0 : a.price ?? Infinity) - (b.free ? 0 : b.price ?? Infinity));
  if (sort === 'release') v.sort((a, b) => (b.release ?? 0) - (a.release ?? 0));
  if (sort === 'added') v.sort((a, b) => b.added - a.added);
  if (sort === 'priority') v.sort((a, b) => a.priority - b.priority);
  return v;
}

/** the price tag drawn on the art, like a store's sale capsule */
export function PriceTag({ w, big = false }: { w: WishItem; big?: boolean }) {
  if (w.comingSoon) return <span className={`wl-tag is-soon ${big ? 'is-big' : ''}`}><CalendarClock size={big ? 15 : 13} strokeWidth={2} /> {soonText(w.comingSoonText)}</span>;
  if (w.free) return <span className={`wl-tag ${big ? 'is-big' : ''}`}><b>{t('Ücretsiz')}</b></span>;
  if (w.price == null) return <span className={`wl-tag is-none ${big ? 'is-big' : ''}`}>{t('Satışta değil')}</span>;
  return (
    <span className={`wl-tag ${onSale(w) ? 'is-sale' : ''} ${big ? 'is-big' : ''}`}>
      {onSale(w) && <span className="wl-cut num">−%{w.discount}</span>}
      <span className="wl-amount">
        {onSale(w) && w.formattedOriginal && <s className="num">{w.formattedOriginal}</s>}
        <b className="num">{w.formatted}</b>
      </span>
    </span>
  );
}

/** the cheapest store when it is not Steam */
function Elsewhere({ w, prices }: { w: WishItem; prices: WishPrices | null }) {
  const p = prices?.items[String(w.appid)];
  const best = p && cheapest(p.deals);
  if (!p || !best || !prices) return null;
  if (best.shopId === 61) return <span className="wl-else is-steam"><ShopMark id={61} name="Steam" size={12} /> {t('En ucuzu Steam')}</span>;
  const app = opensApp(best.shopId, prices.apps);
  return (
    <button className="wl-else" onClick={(e) => { e.stopPropagation(); void openDeal(best, p.gid, null); }} title={app ? t('{0} uygulamasında aç', best.shop) : t('{0} sayfasını tarayıcıda aç', best.shop)}>
      <ShopMark id={best.shopId} name={best.shop} size={12} />
      <span>{best.shop}</span>
      <b className="num">{money(best.price, best.currency)}</b>
      {best.cut > 0 && <span className="num wl-else-cut">−%{best.cut}</span>}
    </button>
  );
}

export function facts(w: WishItem) {
  const out: string[] = [];
  if (w.userScore != null && w.userScore > 0 && (w.reviewCount ?? 0) > 0) out.push(t('%{0} olumlu', w.userScore));
  if (!w.comingSoon && w.release) out.push(String(new Date(w.release * 1000).getFullYear()));
  if (w.lowest != null && w.price != null && w.lowest < w.price && w.lowestFormatted) out.push(t('en düşük {0}', w.lowestFormatted));
  return out;
}

function Card({ w, i, prices }: { w: WishItem; i: number; prices: WishPrices | null }) {
  const f = facts(w);
  return (
    <article className={`wl-card ${onSale(w) ? 'is-sale' : ''}`} style={{ '--i': Math.min(i, 14) } as CSSProperties} onClick={() => openSteam(w.appid)}
      tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') openSteam(w.appid); }} aria-label={t('{0} mağaza sayfası', w.name)}>
      <span className="wl-art">
        {w.header ? <img src={w.header} alt="" loading="lazy" /> : <span className="wl-art-none">{w.name}</span>}
        <PriceTag w={w} />
      </span>
      <span className="wl-body">
        <span className="wl-name" title={w.name}>{w.name}</span>
        <span className="wl-facts">
          {w.stale && <span title={t('Steam bu kez bilgi vermedi, son görülen fiyat ·')}>⟲</span>}
          {onSale(w) && w.discountEnds ? <span className="wl-ends">{t('{0} tarihine kadar', shortDate(new Date(w.discountEnds * 1000)))}</span> : null}
          {f.map((x) => <span key={x}>{x}</span>)}
        </span>
        <Elsewhere w={w} prices={prices} />
      </span>
    </article>
  );
}

/** the best deal of the list (or the first wish), large */
function Spotlight({ w, prices }: { w: WishItem; prices: WishPrices | null }) {
  const [src, setSrc] = useState(heroArt(w.appid));
  useEffect(() => setSrc(heroArt(w.appid)), [w.appid]);
  return (
    <article className="nw-feature wl-spot" onClick={() => openSteam(w.appid)}>
      <img className="nw-feature-img" src={src} alt="" onError={() => setSrc(w.header ?? '')} />
      <div className="nw-feature-shade" />
      <div className="nw-feature-body">
        <span className="nw-badge">{onSale(w) ? <><Tag size={12} strokeWidth={2} /> {t('İstek listendeki en iyi fırsat')}</> : <><Sparkles size={12} strokeWidth={2} /> {t('Listenin başında')}</>}</span>
        <h2 className="nw-feature-title">{w.name}</h2>
        <PriceTag w={w} big />
        <span className="wl-spot-facts">
          {onSale(w) && w.discountEnds ? <span>{t('İndirim {0} tarihine kadar', shortDate(new Date(w.discountEnds * 1000)))}</span> : null}
          {facts(w).map((x) => <span key={x}>{x}</span>)}
        </span>
        <span className="nw-actions">
          <button className="btn btn-accent" onClick={(e) => { e.stopPropagation(); openSteam(w.appid); }}><ExternalLink size={14} strokeWidth={1.8} /> {t('Mağazada aç')}</button>
          <Elsewhere w={w} prices={prices} />
        </span>
      </div>
    </article>
  );
}

export function WishlistView() {
  const { wishlist, refreshWishlist, demo, accounts } = useStore();
  const [sort, setSort] = useState<Sort>('priority');
  const [show, setShow] = useState<Show>('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = useMemo(() => wishlist?.items ?? [], [wishlist]);
  const counts: Record<Show, number> = { all: items.length, sale: items.filter(onSale).length, out: items.filter(isOut).length, soon: items.filter((w) => w.comingSoon).length };
  const steam = demo || accounts.some((a) => a.platform === 'steam');
  // every store's price for the whole list, two requests in all (cached for a few hours)
  const [prices, setPrices] = useState<WishPrices | null>(null);
  const ids = useMemo(() => items.map((w) => w.appid).join(','), [items]);
  useEffect(() => {
    if (!ids) return;
    if (demo) {
      // SAMPLE: the browser demo cannot reach IsThereAnyDeal
      setPrices({ hasKey: true, apps: { 61: true }, items: Object.fromEntries(items.map((w) => { const p = samplePrices(w.name); return [String(w.appid), { gid: 'sample', deals: p.deals ?? [], low: p.low ?? null }]; })) });
      return;
    }
    let live = true;
    api.wishlistPrices(ids.split(',').map(Number)).then((p) => { if (live) setPrices(p); }).catch(() => {});
    return () => { live = false; };
  }, [ids, demo]); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = async () => {
    setBusy(true); setError(null);
    try { await refreshWishlist(true); } catch (e) { setError(String(e)); }
    setBusy(false);
  };

  const spot = useMemo(() => {
    const sale = [...items].filter(onSale).sort((a, b) => b.discount - a.discount)[0];
    return sale ?? sorted(items, 'priority').find(isOut) ?? items[0] ?? null;
  }, [items]);
  const sections: [Show, string, WishItem[]][] = show === 'all'
    ? [['sale', t('İndirimde'), items.filter(onSale)], ['out', t('Çıkmış'), items.filter((w) => isOut(w) && !onSale(w))], ['soon', t('Yakında'), items.filter((w) => w.comingSoon)]]
    : [[show, '', items.filter((w) => (show === 'sale' ? onSale(w) : show === 'out' ? isOut(w) : w.comingSoon))]];
  const TILES: { id: Show; label: string }[] = [
    { id: 'all', label: t('Hepsi') }, { id: 'sale', label: t('İndirimde') }, { id: 'out', label: t('Çıkmış') }, { id: 'soon', label: t('Yakında') },
  ];

  return (
    <div className="page wl-page">
      <div className="sc-ambient" aria-hidden="true">{spot && <img src={spot.header ?? ''} alt="" />}</div>
      <header className="sc-head">
        <div>
          <h1>{t('İstek listesi')}</h1>
          <p className="title-meta">
            {wishlist?.checkedAt ? <>{t('son bakış')} {ago(new Date(wishlist.checkedAt * 1000)).toLocaleLowerCase(locale)}</> : null}
          </p>
        </div>
        {steam && !demo && (
          <button className="btn" onClick={reload} disabled={busy}>
            <RefreshCw size={15} strokeWidth={1.8} className={busy ? 'spin' : ''} /> {busy ? t('Bakılıyor…') : t('Fiyatları yenile')}
          </button>
        )}
      </header>

      {steam && !demo && prices && !prices.hasKey && items.length > 0 && (
        <p className="wish-hint muted small">{t('Başka mağazalarda daha ucuzu var mı görmek için Ayarlar → Hesaplar’dan IsThereAnyDeal anahtarı ekle.')}</p>
      )}
      {!steam && <div className="panel empty-panel"><p>{t('İstek listesi için Steam hesabını bağla. Liste Steam profilinden okunur; anahtar gerekmez.')}</p></div>}
      {error && <div className="panel empty-panel"><p>{error}</p></div>}

      {spot && show === 'all' && <Spotlight w={spot} prices={prices} />}

      {items.length > 0 && (
        <div className="wl-bar">
          <div className="wl-tiles" role="group" aria-label={t('Göster')}>
            {TILES.map((x) => (
              <button key={x.id} className={`wl-tile is-${x.id}`} aria-pressed={show === x.id} onClick={() => setShow(x.id)} disabled={x.id !== 'all' && counts[x.id] === 0}>
                <b className="num">{counts[x.id]}</b>
                <span>{x.label}</span>
              </button>
            ))}
          </div>
          <label className="wl-sort">
            <span>{t('Sırala')}</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label={t('Sırala')}>
              {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
        </div>
      )}

      {sections.map(([id, label, list]) => list.length > 0 && (
        <section key={id} className={label ? 'sc-section' : ''}>
          {label && <h2 className="sc-title">{label}<span className="num">{list.length}</span></h2>}
          <div className="wl-grid">
            {sorted(list, sort).map((w, i) => <Card key={w.appid} w={w} i={i} prices={prices} />)}
          </div>
        </section>
      ))}
      {items.length > 0 && sections.every(([, , l]) => l.length === 0) && <p className="muted">{t('Bu seçimde oyun yok.')}</p>}
    </div>
  );
}
