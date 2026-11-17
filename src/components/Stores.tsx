// Prices in every store (from IsThereAnyDeal): the game page panel, and the
// small "cheapest elsewhere" line on wishlist cards. A click opens the store's
// app on that game when it is installed, otherwise the shop's page in the browser.
import { useEffect, useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { useStore } from '../store';
import { api, type Deal, type GamePrices } from '../lib/backend';
import { isSystem, type Game } from '../data/library';
import { PlatformLogo } from './PlatformLogo';
import { steamApp } from './News';
import { pct } from '../lib/format';

import { t as tr, locale } from '../lib/i18n';
// IsThereAnyDeal shop id → Tessera's store mark
const MARKS: Record<number, string> = { 61: 'steam', 16: 'epic', 35: 'gog', 48: 'xbox', 62: 'ubisoft', 52: 'ea', 4: 'battlenet' };
// stores whose app Tessera can open on a game page
// only Steam opens in its app; other stores open IsThereAnyDeal's link as given
const APP_SHOPS = new Set([61]);

export function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: amount % 1 === 0 ? 0 : 2 }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function ShopMark({ id, name, size = 16 }: { id: number; name: string; size?: number }) {
  const mark = MARKS[id];
  if (mark) return <PlatformLogo id={mark} size={size} />;
  return <span className="shop-mono" style={{ width: size, height: size, fontSize: size * 0.62 }} aria-hidden="true">{name.slice(0, 1)}</span>;
}

/** the cheapest deal among those in the most common currency (prices in different currencies are not compared) */
export function cheapest(deals: Deal[]): Deal | null {
  if (!deals.length) return null;
  const count = new Map<string, number>();
  for (const d of deals) count.set(d.currency, (count.get(d.currency) ?? 0) + 1);
  const cur = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return deals.filter((d) => d.currency === cur).reduce((a, b) => (b.price < a.price ? b : a));
}

/** opens the store's app on the game when installed, otherwise its page in the browser */
export async function openDeal(d: Pick<Deal, 'shopId' | 'url'>, gid?: string | null, appid?: number | null) {
  try {
    await api.storeOpen(d.shopId, d.url, gid ?? null, appid ?? null);
  } catch {
    window.open(d.url, '_blank', 'noopener');
  }
}

export const opensApp = (shopId: number, apps?: Record<string, boolean>) => APP_SHOPS.has(shopId) && !!apps?.[String(shopId)];

// SAMPLE: the browser demo cannot reach IsThereAnyDeal
export function samplePrices(title: string): GamePrices {
  const seed = [...title].reduce((a, c) => a + c.charCodeAt(0), 0);
  const base = 9.99 + (seed % 5) * 10;
  const mk = (shop: string, shopId: number, cut: number, drm: string[] = []): Deal => {
    const price = Math.round(base * (1 - cut / 100) * 100) / 100;
    return { shop, shopId, price, regular: base, cut, currency: 'USD', storeLow: Math.round(base * 0.25 * 100) / 100, voucher: null, drm, url: 'https://isthereanydeal.com/' };
  };
  const deals = [mk(tr('Steam'), 61, seed % 3 === 0 ? 50 : 0, [tr('Steam')]), mk('GOG', 35, 35), mk(tr('Epic Game Store'), 16, 0), mk(tr('Fanatical'), 6, 42, [tr('Steam')]), mk(tr('GreenManGaming'), 36, 30, [tr('Steam')]), mk(tr('Humble Store'), 37, 20, [tr('Steam')])]
    .sort((a, b) => a.price - b.price);
  return { found: true, hasKey: true, gid: 'sample', deals, low: { price: Math.round(base * 0.2 * 100) / 100, currency: 'USD' }, checkedAt: Math.floor(Date.now() / 1000) - 3600, apps: { 61: true, 16: false, 48: true } };
}

/** every store's price, cheapest marked; a click opens the store (its app when installed) */
export function PriceList({ data, appid }: { data: GamePrices; appid: number | null }) {
  const [all, setAll] = useState(false);
  const deals = data.deals ?? [];
  const best = cheapest(deals);
  const shown = all ? deals : deals.slice(0, 5);
  return (
    <>
      {deals.length === 0 && <p className="muted small">{tr('Şu an hiçbir mağazada satılmıyor.')}</p>}
      {deals.length > 0 && (
        <ul className="stores-list">
          {shown.map((d) => {
            const app = opensApp(d.shopId, data.apps);
            const key = d.drm.length && !d.drm.some((x) => d.shop.toLowerCase().startsWith(x.toLowerCase())) ? tr('{0} anahtarı', d.drm.join(', ')) : null;
            return (
              <li key={d.shopId}>
                <button className={`store-row ${d === best ? 'is-best' : ''}`} onClick={() => openDeal(d, data.gid, d.shopId === 61 ? appid : null)}
                  title={app ? tr('{0} uygulamasında aç', d.shop) : tr('{0} sayfasını tarayıcıda aç', d.shop)}>
                  <span className="store-mark"><ShopMark id={d.shopId} name={d.shop} size={17} /></span>
                  <span className="store-text">
                    <span className="store-name">{d.shop}{d === best && <span className="store-best">{tr('En ucuz')}</span>}</span>
                    {(key || d.voucher) && (
                      <span className="muted small">
                        {key}
                        {key && d.voucher ? ' · ' : null}
                        {d.voucher ? <>{tr('kod')} <strong className="num">{d.voucher}</strong></> : null}
                      </span>
                    )}
                  </span>
                  <span className="store-price">
                    {d.cut > 0 && <span className="wish-off num">−{pct(d.cut)}</span>}
                    {d.cut > 0 && <s className="muted num">{money(d.regular, d.currency)}</s>}
                    <span className="num">{money(d.price, d.currency)}</span>
                  </span>
                  <ExternalLink size={14} strokeWidth={1.7} className="store-go" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {deals.length > 5 && (
        <button className="link stores-more" onClick={() => setAll((v) => !v)}>{all ? tr('Daha az göster') : tr('{0} mağaza daha', deals.length - 5)}</button>
      )}
      <p className="stores-foot muted small">
        {data.low ? <>{tr('Gördüğü en düşük fiyat')} <span className="num">{money(data.low.price, data.low.currency)}</span> · </> : null}
        {tr('Fiyatlar')}{' '}
        <button className="link link-inline" onClick={() => api.openUrl('https://isthereanydeal.com/').catch(() => {})}>{tr('IsThereAnyDeal')}</button>
        {tr('’dan, Türkiye için')}
      </p>
    </>
  );
}

/** "Mağazalar" on the game page: every store's price, cheapest marked */
export function StoresPanel({ g }: { g: Game }) {
  const { demo, openSettings } = useStore();
  const [data, setData] = useState<GamePrices | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const system = isSystem(g.platform);
  useEffect(() => {
    if (system) return;
    setData(null); setError(null);
    if (demo) { setData(samplePrices(g.title)); return; }
    let live = true;
    api.gamePrices(g.id).then((p) => { if (live) setData(p); }).catch((e) => { if (live) setError(String(e)); });
    return () => { live = false; };
  }, [g.id, demo, system, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  if (system || (data && !data.found)) return null;
  const deals = data?.deals ?? [];

  return (
    <section className="panel stores" aria-label={tr('Mağazalardaki fiyatlar')}>
      <div className="panel-head">
        <h2 className="panel-title">{tr('Mağazalar')}</h2>
        {deals.length > 1 ? <span className="muted small">{deals.length} {tr('mağaza')}</span> : null}
      </div>

      {!data && !error && <div className="stores-skel" aria-hidden="true"><span /><span /><span /></div>}
      {error && (
        <p className="muted small">{error} <button className="link link-inline" onClick={() => setTick((t) => t + 1)}><RefreshCw size={12} strokeWidth={1.8} /> {tr('Tekrar dene')}</button></p>
      )}
      {data && !data.hasKey && <KeyAsk onAdd={() => openSettings('accounts')} />}
      {data?.hasKey && <PriceList data={data} appid={steamApp(g)} />}
    </section>
  );
}

export function KeyAsk({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="stores-key">
      <p className="muted small">{tr('Mağazalardaki fiyatları ve en ucuzunu görmek için IsThereAnyDeal anahtarı ekle. Ücretsiz; bir kez eklenir.')}</p>
      <button className="btn btn-sm" onClick={onAdd}>{tr('Anahtar ekle')}</button>
    </div>
  );
}
