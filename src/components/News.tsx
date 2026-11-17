// Official announcements and patch notes from Steam: per game, and one feed for the
// games the user actually plays. The feed reads like an event page: the newest post
// large on top, the rest as picture cards, every post readable inside the app.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { BookOpen, ExternalLink, Wrench } from 'lucide-react';
import { useStore } from '../store';
import { lastPlayed, type Game } from '../data/library';
import { api, type NewsItem } from '../lib/backend';
import { Cover } from './bits';
import { Modal } from './Modal';
import { ago, longDate } from '../lib/format';
import { t } from '../lib/i18n';

/** the Steam appid behind a game, if any */
export function steamApp(g: Game): number | null {
  if (g.platform === 'steam') {
    const n = Number(g.externalId ?? g.id);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return g.steamAppId ?? null;
}

// SAMPLE: the browser demo cannot reach Steam
function sampleNews(g: Game): NewsItem[] {
  const d = (days: number) => Math.round(Date.now() / 1000 - days * 86400);
  const body = (s: string) => `${s}\n\n${t('Yama notlarının tamamı Steam’deki duyuruda.')}`;
  return [
    { id: `${g.id}-1`, title: t('Yama 1.0.4 yayında'), url: 'https://store.steampowered.com', date: d(1 + (g.title.length % 4)), image: null, patch: true,
      summary: t('Kayıtların bozulmasına yol açan bir hata giderildi, kumandayla menüde gezinme düzeltildi ve birkaç çökme sorunu çözüldü.'),
      body: body(t('Kayıtların bozulmasına yol açan bir hata giderildi, kumandayla menüde gezinme düzeltildi ve birkaç çökme sorunu çözüldü.')) },
    { id: `${g.id}-2`, title: t('Kış güncellemesi: yeni bölge ve müzik'), url: 'https://store.steampowered.com', date: d(9 + (g.title.length % 5)), image: g.hero ?? g.header, patch: false,
      summary: t('Yeni bir bölge, üç yeni düşman ve stüdyonun canlı konser kaydı. Ayrıntılar ve geliştirici notları duyuruda.'),
      body: body(t('Yeni bir bölge, üç yeni düşman ve stüdyonun canlı konser kaydı. Ayrıntılar ve geliştirici notları duyuruda.')) },
    { id: `${g.id}-3`, title: t('Hotfix 1.0.3'), url: 'https://store.steampowered.com', date: d(31), image: null, patch: true,
      summary: t('Performans iyileştirmeleri, yükleme ekranında takılma sorunu giderildi.') },
  ];
}

function useGameNews(g: Game) {
  const { demo } = useStore();
  const [items, setItems] = useState<NewsItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setItems(null); setError(null);
    if (demo) { setItems(sampleNews(g)); return; }
    api.gameNews(g.id).then((v) => alive && setItems(v)).catch((e) => alive && setError(String(e)));
    return () => { alive = false; };
  }, [g, demo]);
  return { items, error };
}

const open = (url: string) => { api.openUrl(url).catch(() => window.open(url, '_blank', 'noopener')); };
const when = (n: NewsItem) => new Date(n.date * 1000);
/** the post's own picture, or the game's art */
const picture = (n: NewsItem, g?: Game) => n.image ?? g?.hero ?? g?.header ?? null;

interface Post { n: NewsItem; g?: Game }

/** a picture that gives way to the game's art when it does not load, or when it is a
 *  thin heading strip (some posts open with one) that would be blown up on a card */
function Art({ src, fallback, className = '' }: { src: string | null; fallback?: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  const url = failed ? fallback ?? null : src;
  if (!url) return <span className={`nw-art-none ${className}`} />;
  return (
    <img className={className} src={url} alt="" loading="lazy" onError={() => setFailed(true)}
      onLoad={(e) => { const i = e.currentTarget; if (!failed && i.naturalWidth > i.naturalHeight * 4) setFailed(true); }} />
  );
}

function Meta({ p, onGame }: { p: Post; onGame?: () => void }) {
  return (
    <span className="nw-meta">
      {p.g && (
        <button className="nw-game" onClick={(e) => { e.stopPropagation(); onGame?.(); }} title={p.g.title}>
          <Cover game={p.g} className="nw-game-cover" /> <span>{p.g.title}</span>
        </button>
      )}
      <time dateTime={when(p.n).toISOString()} title={longDate(when(p.n))}>{ago(when(p.n))}</time>
    </span>
  );
}

/** the newest post, large */
function Feature({ p, onRead, onGame }: { p: Post; onRead: () => void; onGame?: () => void }) {
  const src = picture(p.n, p.g);
  return (
    <article className="nw-feature" onClick={onRead}>
      <Art src={src} fallback={p.g?.hero ?? p.g?.header} className="nw-feature-img" />
      <div className="nw-feature-shade" />
      <div className="nw-feature-body">
        <Meta p={p} onGame={onGame} />
        {p.n.patch && <span className="nw-badge"><Wrench size={12} strokeWidth={2} /> {t('Yama')}</span>}
        <h2 className="nw-feature-title">{p.n.title}</h2>
        {p.n.summary && <p className="nw-feature-text">{p.n.summary}</p>}
        <span className="nw-actions">
          <button className="btn btn-accent" onClick={(e) => { e.stopPropagation(); onRead(); }}><BookOpen size={15} strokeWidth={1.8} /> {t('Oku')}</button>
          <button className="btn nw-ghost" onClick={(e) => { e.stopPropagation(); open(p.n.url); }}><ExternalLink size={14} strokeWidth={1.8} /> {t('Steam’de aç')}</button>
        </span>
      </div>
    </article>
  );
}

function Card({ p, i, onRead, onGame }: { p: Post; i: number; onRead: () => void; onGame?: () => void }) {
  return (
    <article className="nw-card" style={{ '--i': Math.min(i, 12) } as CSSProperties} onClick={onRead} tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onRead(); }}>
      <span className="nw-card-art">
        <Art src={picture(p.n, p.g)} fallback={p.g?.hero ?? p.g?.header} />
        {p.n.patch && <span className="nw-badge"><Wrench size={11} strokeWidth={2} /> {t('Yama')}</span>}
      </span>
      <span className="nw-card-body">
        <Meta p={p} onGame={onGame} />
        <span className="nw-card-title">{p.n.title}</span>
        {p.n.summary && <span className="nw-card-text">{p.n.summary}</span>}
      </span>
    </article>
  );
}

/** a post read inside the app */
function Reader({ p, onClose }: { p: Post | null; onClose: () => void }) {
  const last = useRef<Post | null>(null);
  if (p) last.current = p;
  const q = p ?? last.current;
  const src = q ? picture(q.n, q.g) : null;
  const text = q ? (q.n.body || q.n.summary || '') : '';
  return (
    <Modal open={!!p} onClose={onClose} label={q?.n.title ?? t('Haber')} size="lg" ambient={src} className="nw-reader">
      {q && (
        <article className="nw-read">
          {src && <div className="nw-read-art"><Art src={src} fallback={q.g?.hero ?? q.g?.header} /></div>}
          <Meta p={q} />
          <h2 className="nw-read-title">{q.n.title}</h2>
          <div className="nw-read-text">{text.split('\n\n').map((para, k) => <p key={k} className={para.startsWith('• ') ? 'is-item' : ''}>{para}</p>)}</div>
          <div className="nw-read-foot">
            <button className="btn btn-accent" onClick={() => open(q.n.url)}><ExternalLink size={14} strokeWidth={1.8} /> {t('Steam’de aç')}</button>
          </div>
        </article>
      )}
    </Modal>
  );
}

function Kind({ value, onChange, counts }: { value: boolean; onChange: (v: boolean) => void; counts: [number, number] }) {
  return (
    <div className="sc-chips" role="group" aria-label={t('Haber türü')}>
      <button aria-pressed={!value} onClick={() => onChange(false)}>{t('Hepsi')} <b className="num">{counts[0]}</b></button>
      <button aria-pressed={value} onClick={() => onChange(true)}><Wrench size={13} strokeWidth={2} /> {t('Yamalar')} <b className="num">{counts[1]}</b></button>
    </div>
  );
}

/** game page: the game's own announcements */
export function NewsTab({ g }: { g: Game }) {
  const { items, error } = useGameNews(g);
  const [onlyPatches, setOnlyPatches] = useState(false);
  const [reading, setReading] = useState<Post | null>(null);
  if (error) return <div className="panel empty-panel"><p>{t('Haberler alınamadı. İnternet bağlantını kontrol et.')}</p></div>;
  if (!items) return <div className="nw-grid">{[0, 1, 2].map((k) => <span key={k} className="nw-skel" />)}</div>;
  if (!items.length) return <div className="panel empty-panel"><p>{t('Bu oyunun Steam’de duyurusu yok.')}</p></div>;
  const list = onlyPatches ? items.filter((n) => n.patch) : items;
  return (
    <div className="stack">
      <div className="nw-bar"><Kind value={onlyPatches} onChange={setOnlyPatches} counts={[items.length, items.filter((n) => n.patch).length]} /></div>
      <div className="nw-grid">
        {list.map((n, i) => <Card key={n.id} p={{ n, g }} i={i} onRead={() => setReading({ n, g })} />)}
      </div>
      {!list.length && <p className="muted">{t('Son duyurular arasında yama notu yok.')}</p>}
      <Reader p={reading} onClose={() => setReading(null)} />
    </div>
  );
}

const FEED_DAYS = 45;
const FEED_GAMES = 40;

/** the games worth following: installed, favourites, or played lately */
function followed(games: Game[]): Game[] {
  const cutoff = Date.now() - 120 * 86400000;
  return games
    .filter((g) => steamApp(g) != null && (g.installed || g.favorite || (lastPlayed(g)?.getTime() ?? 0) > cutoff || g.status === 'playing'))
    .sort((a, b) => (lastPlayed(b)?.getTime() ?? 0) - (lastPlayed(a)?.getTime() ?? 0))
    .slice(0, FEED_GAMES);
}

/** the feed for the games the user plays, loaded six games at a time */
export function useFeed() {
  const { games, demo } = useStore();
  const follow = useMemo(() => followed(games), [games]);
  const [got, setGot] = useState<{ g: Game; n: NewsItem }[]>([]);
  const [done, setDone] = useState(0);
  const started = useRef('');
  useEffect(() => {
    const key = follow.map((g) => g.id).join(',');
    if (started.current === key) return;
    started.current = key;
    setGot([]); setDone(0);
    let alive = true;
    const queue = [...follow];
    const since = Date.now() / 1000 - FEED_DAYS * 86400;
    // each game's news is cached for a few hours
    const worker = async () => {
      for (let g = queue.shift(); g && alive; g = queue.shift()) {
        const list = demo ? sampleNews(g).slice(0, 2) : await api.gameNews(g.id).catch(() => [] as NewsItem[]);
        if (!alive) return;
        const game = g;
        setGot((x) => [...x, ...list.filter((n) => n.date >= since).map((n) => ({ g: game, n }))]);
        setDone((d) => d + 1);
      }
    };
    for (let i = 0; i < 6; i++) void worker();
    return () => { alive = false; started.current = ''; };
  }, [follow, demo]);
  const all = useMemo(() => [...got].sort((a, b) => b.n.date - a.n.date), [got]);
  return { follow, all, loading: done < follow.length, done };
}

/** one feed: what changed lately in the games you play */
export function NewsView() {
  const { go } = useStore();
  const { follow, all, loading, done } = useFeed();
  const [onlyPatches, setOnlyPatches] = useState(false);
  const [game, setGame] = useState<string | null>(null);
  const [reading, setReading] = useState<Post | null>(null);

  // the games that posted something, busiest first
  const posters = useMemo(() => {
    const m = new Map<string, { g: Game; n: number }>();
    for (const x of all) m.set(x.g.id, { g: x.g, n: (m.get(x.g.id)?.n ?? 0) + 1 });
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [all]);
  const list = all.filter((x) => (!onlyPatches || x.n.patch) && (!game || x.g.id === game));
  const [lead, ...rest] = list;
  const week = Date.now() / 1000 - 7 * 86400;
  const groups: [string, typeof rest][] = [
    [t('Bu hafta'), rest.filter((x) => x.n.date >= week)],
    [t('Daha önce'), rest.filter((x) => x.n.date < week)],
  ];
  const toGame = (g: Game) => go({ name: 'game', id: g.id });

  return (
    <div className="page nw-page">
      <div className="sc-ambient" aria-hidden="true">{lead && <Art src={picture(lead.n, lead.g)} fallback={lead.g.hero} />}</div>
      <header className="sc-head">
        <div>
          <h1>{t('Güncellemeler')}</h1>
          <p className="title-meta">
            {follow.length} {t('oyun · son')} {FEED_DAYS} {t('gün')}
            {loading && <> · {done}/{follow.length} {t('bakıldı')}</>}
          </p>
        </div>
        <Kind value={onlyPatches} onChange={setOnlyPatches} counts={[all.length, all.filter((x) => x.n.patch).length]} />
      </header>

      {posters.length > 1 && (
        <div className="nw-games" role="group" aria-label={t('Oyuna göre')}>
          <button className={`nw-pick ${!game ? 'is-on' : ''}`} onClick={() => setGame(null)}><span className="nw-pick-all">{t('Tümü')}</span></button>
          {posters.map(({ g, n }) => (
            <button key={g.id} className={`nw-pick ${game === g.id ? 'is-on' : ''}`} onClick={() => setGame(game === g.id ? null : g.id)} title={g.title}>
              <Cover game={g} className="nw-pick-cover" />
              <b className="num">{n}</b>
            </button>
          ))}
        </div>
      )}

      {follow.length === 0 && <div className="panel empty-panel"><p>{t('Takip edilecek Steam oyunu yok. Steam hesabını bağlayınca yüklü ve oynadığın oyunların duyuruları burada toplanır.')}</p></div>}
      {!loading && follow.length > 0 && list.length === 0 && <div className="panel empty-panel"><p>{t('Son')} {FEED_DAYS} {t('günde')} {onlyPatches ? t('yama notu') : t('duyuru')} {t('yok.')}</p></div>}
      {loading && all.length === 0 && <><span className="nw-skel is-big" /><div className="nw-grid">{[0, 1, 2].map((k) => <span key={k} className="nw-skel" />)}</div></>}

      {lead && <Feature key={`${lead.g.id}-${lead.n.id}`} p={lead} onRead={() => setReading(lead)} onGame={() => toGame(lead.g)} />}
      {groups.map(([label, items]) => items.length > 0 && (
        <section key={label} className="sc-section">
          <h2 className="sc-title">{label}<span className="num">{items.length}</span></h2>
          <div className="nw-grid">
            {items.map((p, i) => <Card key={`${p.g.id}-${p.n.id}`} p={p} i={i} onRead={() => setReading(p)} onGame={() => toGame(p.g)} />)}
          </div>
        </section>
      ))}
      <Reader p={reading} onClose={() => setReading(null)} />
    </div>
  );
}
