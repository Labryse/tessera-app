// Games followed from "Fiyat ara": the list, the follow button with the price to wait
// for, and the shelf above the popular picks. The Rust side asks their prices again
// every few hours and notifies when one gets cheaper.
import { useEffect, useState, type CSSProperties } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Bell, BellRing, TrendingDown, X } from 'lucide-react';
import { useStore } from '../store';
import { api, isDesktop, type Tracked } from '../lib/backend';
import { cheapest, money, samplePrices, ShopMark } from './Stores';

import { t } from '../lib/i18n';
// one list for every component on screen
let list: Tracked[] | null = null;
const subs = new Set<(l: Tracked[]) => void>();
const publish = (l: Tracked[]) => { list = l; subs.forEach((f) => f(l)); };

// SAMPLE: in the browser demo the list lives in memory, with made-up prices
function sampleTrack(gid: string, title: string, art: string | null): Tracked {
  const best = cheapest(samplePrices(title).deals ?? []);
  return { gid, title, art, added: Math.floor(Date.now() / 1000), target: null, base: best ? best.regular : null, price: best?.price ?? null, regular: best?.regular, cut: best?.cut, currency: best?.currency, shop: best?.shop, shopId: best?.shopId };
}

export function useTracked() {
  const [l, setL] = useState<Tracked[]>(list ?? []);
  useEffect(() => {
    subs.add(setL);
    if (list === null) {
      if (isDesktop) api.trackList().then(publish).catch(() => publish([]));
      else publish([]);
    }
    return () => { subs.delete(setL); };
  }, []);
  return l;
}

/** the Rust side checked the prices again */
export function useTrackedEvents() {
  useEffect(() => {
    if (!isDesktop) return;
    const off = listen<Tracked[]>('tracked', ({ payload }) => { if (Array.isArray(payload)) publish(payload); });
    return () => { void off.then((f) => f()); };
  }, []);
}

export async function follow(gid: string, title: string, art: string | null) {
  if (!isDesktop) { publish([sampleTrack(gid, title, art), ...(list ?? [])]); return; }
  publish(await api.trackAdd(gid, title, art));
}
export async function unfollow(gid: string) {
  if (!isDesktop) { publish((list ?? []).filter((x) => x.gid !== gid)); return; }
  publish(await api.trackRemove(gid));
}
async function setTarget(gid: string, target: number | null) {
  if (!isDesktop) { publish((list ?? []).map((x) => (x.gid === gid ? { ...x, target } : x))); return; }
  publish(await api.trackTarget(gid, target));
}

/** how much cheaper than when it was followed (0 when not) */
const drop = (x: Tracked) => (x.base && x.price != null && x.price < x.base ? Math.round((1 - x.price / x.base) * 100) : 0);

/** "Takip et" on a game's page; once followed, the price to wait for */
export function FollowButton({ gid, title, art }: { gid: string; title: string; art: string | null }) {
  const { notify } = useStore();
  const tracked = useTracked();
  const mine = tracked.find((x) => x.gid === gid);
  const [busy, setBusy] = useState(false);
  const [target, setTargetText] = useState(mine?.target != null ? String(mine.target) : '');
  useEffect(() => { setTargetText(mine?.target != null ? String(mine.target) : ''); }, [mine?.target]);

  const toggle = async () => {
    setBusy(true);
    try {
      if (mine) { await unfollow(gid); notify(t('Takip bırakıldı')); }
      else { await follow(gid, title, art); notify(t('Takip ediliyor · ucuzlayınca haber verilecek')); }
    } catch (e) { notify(String(e)); }
    setBusy(false);
  };
  const saveTarget = () => {
    const n = Number(target.replace(',', '.'));
    const next = target.trim() && n > 0 ? n : null;
    if (next === (mine?.target ?? null)) return;
    setTarget(gid, next).catch((e) => notify(String(e)));
  };

  return (
    <div className="follow">
      <button className={`btn btn-sm ${mine ? 'is-following' : 'btn-accent'}`} onClick={toggle} disabled={busy || !title} aria-pressed={!!mine}>
        {mine ? <BellRing size={15} strokeWidth={1.8} /> : <Bell size={15} strokeWidth={1.8} />}
        {mine ? t('Takip ediliyor') : t('Takip et')}
      </button>
      {mine && (
        <label className="follow-target">
          <span>{t('Hedef fiyat')}</span>
          <input inputMode="decimal" value={target} placeholder={mine.price != null ? String(Math.floor(mine.price)) : '—'}
            onChange={(e) => setTargetText(e.target.value.replace(/[^\d.,]/g, ''))} onBlur={saveTarget}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} aria-label={t('Hedef fiyat')} />
          <span className="muted">{mine.currency ?? 'USD'}</span>
        </label>
      )}
    </div>
  );
}

/** the shelf of followed games on "Fiyat ara" */
export function TrackedShelf() {
  const { go } = useStore();
  const tracked = useTracked();
  if (!tracked.length) return null;
  return (
    <section className="tracked" aria-label={t('Takip ettiklerin')}>
      <h2 className="sc-title">{t('Takip ettiklerin')}<span className="num">{tracked.length}</span></h2>
      <div className="tracked-row">
        {tracked.map((x, i) => {
          const d = drop(x);
          const hit = x.target != null && x.price != null && x.price <= x.target;
          return (
            <div key={x.gid} className={`tracked-card ${d > 0 || hit ? 'is-down' : ''}`} style={{ '--i': i } as CSSProperties}>
              <button className="tracked-open" onClick={() => go({ name: 'shop', gid: x.gid })}>
                <span className="tracked-art">{x.art ? <img src={x.art} alt="" loading="lazy" /> : <span>{x.title}</span>}</span>
                <span className="tracked-body">
                  <span className="tracked-name" title={x.title}>{x.title}</span>
                  {x.price != null ? (
                    <span className="tracked-price">
                      {x.shopId != null && x.shop && <ShopMark id={x.shopId} name={x.shop} size={12} />}
                      <strong className="num">{money(x.price, x.currency ?? 'USD')}</strong>
                      {d > 0 && <span className="tracked-drop num"><TrendingDown size={12} strokeWidth={2} /> %{d}</span>}
                    </span>
                  ) : <span className="muted small">{t('Satışta değil')}</span>}
                  {x.target != null && <span className={`tracked-goal ${hit ? 'is-hit' : ''}`}>{t('Hedef')} <span className="num">{money(x.target, x.currency ?? 'USD')}</span></span>}
                </span>
              </button>
              <button className="icon-btn tracked-x" onClick={() => void unfollow(x.gid)} aria-label={t('{0} takibini bırak', x.title)}><X size={14} strokeWidth={1.8} /></button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** a small bell on a card of a followed game */
export function useIsTracked(gid: string) {
  return useTracked().some((x) => x.gid === gid);
}
