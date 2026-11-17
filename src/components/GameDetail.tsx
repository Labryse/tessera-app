import { LiveButton } from './Session';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { FolderOpen, Image as ImageIcon, SquarePen, ArrowLeft, Check, ChevronLeft, ChevronRight, Download, Eye, Heart, Lock, Play, Plus, Shapes, X } from 'lucide-react';
import { isLightTheme, useStore } from '../store';
import {
  PLATFORMS, isSystem, lastPlayed, ratingWord, sessionMinutes, totalMinutes, tracksWithTessera,
  type Game, type RatingAxes,
} from '../data/library';
import { sampleHue, tame } from '../lib/accent';
import { Cover, Progress, RatingBar, StatusPicker, useCountUp } from './bits';
import { WeekBars } from './WeekBars';
import { ReviewTab } from './Review';
import { SavesTab } from './Saves';
import { NewsTab, steamApp } from './News';
import { ArtPicker } from './ArtPicker';
import { usePresence } from './Modal';
import { createPortal } from 'react-dom';
import { PlatformLogo } from './PlatformLogo';
import { StoresPanel } from './Stores';
import { api, shotUrl, type ShotFile, type SteamDetails } from '../lib/backend';
import { ago, bytes, clock, duration, gb, int, longDate, score, shortDate, pct } from '../lib/format';

import { t as tr, locale } from '../lib/i18n';
type Tab = 'overview' | 'achievements' | 'sessions' | 'news' | 'notes' | 'review' | 'saves';
const TABS: Tab[] = ['overview', 'achievements', 'sessions', 'notes', 'review', 'saves'];
const AXES: { id: keyof RatingAxes; label: string }[] = [
  { id: 'story', label: tr('Hikâye') },
  { id: 'gameplay', label: tr('Oynanış') },
  { id: 'visuals', label: tr('Görsel') },
  { id: 'audio', label: tr('Ses') },
  { id: 'performance', label: tr('Performans') },
];
const WEEKDAYS = ['pazar', 'pazartesi', tr('salı'), tr('çarşamba'), tr('perşembe'), 'cuma', 'cumartesi'];
const REVIEW = ['', tr('Son Derece Olumsuz'), tr('Çok Olumsuz'), tr('Olumsuz'), tr('Çoğunlukla Olumsuz'), tr('Karışık'), tr('Çoğunlukla Olumlu'), tr('Olumlu'), tr('Çok Olumlu'), tr('Son Derece Olumlu')];

const compact = (n: number) => (n >= 1000 ? tr('{0} bin', (n / 1000).toLocaleString(locale, { maximumFractionDigits: n >= 10000 ? 0 : 1 })) : String(n));

export function GameDetail({ id }: { id: string }) {
  const { byId, back, launch, update, theme, demo, setMatchFor, playing } = useStore();
  const g = byId.get(id);
  const [tab, setTab] = useState<Tab>(() => {
    const t = window.location.hash.split('/')[2] as Tab | undefined;
    return t && TABS.includes(t) ? t : 'overview';
  });
  const [vars, setVars] = useState<CSSProperties>({});
  const [shownId, setShownId] = useState(id);
  if (shownId !== id) { setShownId(id); setTab('overview'); }

  useEffect(() => {
    if (!g?.cover) { setVars({}); return; }
    let alive = true;
    const dark = !isLightTheme(theme);
    sampleHue(g.cover).then((hsl) => {
      if (!alive) return;
      const t = tame(hsl, dark);
      setVars({ '--accent': t.accent, '--accent-ink': t.accentInk, '--accent-wash': t.wash } as CSSProperties);
    });
    return () => { alive = false; };
  }, [g?.cover, theme]);

  // sliding underline under the active tab
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [bar, setBar] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const el = tabRefs.current[tab];
    if (el) setBar({ x: el.offsetLeft + 8, w: el.offsetWidth - 16 });
  }, [tab, id]);

  const [faved, setFaved] = useState(0);

  // desktop: achievements from Steam when the page opens
  const [achNote, setAchNote] = useState<string | null>(null);
  const gid = g?.id;
  const needsAch = !demo && g?.platform === 'steam' && !g.achievements && !!g.externalId;
  useEffect(() => {
    if (!needsAch || !gid) return;
    let alive = true;
    setAchNote('loading');
    api.steamAchievements(Number(gid.replace('steam:', ''))).then((r) => {
      if (!alive) return;
      if ('list' in r) {
        if (!r.list.length) { setAchNote('none'); return; }
        const list = r.list.map((a) => ({ ...a, unlockedAt: a.unlockedAt ? new Date(a.unlockedAt * 1000).toISOString() : null }));
        update(gid, { achievements: { total: list.length, unlocked: list.filter((a) => a.unlockedAt).length, list } });
        setAchNote(null);
      } else if ('needsKey' in r) {
        setAchNote(r.total ? `key:${r.total}` : 'none');
      } else {
        setAchNote(`err:${r.error}`);
      }
    }).catch((err) => alive && setAchNote(`err:${String(err)}`));
    return () => { alive = false; };
  }, [needsAch, gid, update]);

  const needsRa = !demo && !!g && isSystem(g.platform) && !g.achievements && !!g.rom;
  useEffect(() => {
    if (!needsRa || !gid) return;
    let alive = true;
    setAchNote('loading');
    api.raAchievements(gid).then((r) => {
      if (!alive) return;
      if (r.needsAccount) { setAchNote('ra-account'); return; }
      if (r.none) { setAchNote('ra-none'); return; }
      if ('list' in r && r.list) {
        const list = r.list.map((a) => ({ ...a, unlockedAt: a.unlockedAt ? String(a.unlockedAt) : null }));
        if (!list.length) { setAchNote('ra-none'); return; }
        update(gid, { achievements: { total: list.length, unlocked: list.filter((a) => a.unlockedAt).length, list } });
        setAchNote(`ra:${r.user ?? ''}`);
      } else if ('error' in r) {
        setAchNote(`err:${r.error}`);
      }
    }).catch((err) => alive && setAchNote(`err:${String(err)}`));
    return () => { alive = false; };
  }, [needsRa, gid, update]);

  const [artOpen, setArtOpen] = useState(false);

  // desktop: a ROM's story, developer and date come from Wikipedia the first time it opens
  const { refresh } = useStore();
  const romNeedsText = !demo && !!g && isSystem(g.platform) && !g.description && !!g.rom;
  useEffect(() => {
    if (!romNeedsText || !gid) return;
    api.romDetails(gid).then((changed) => { if (changed) refresh(); }).catch(() => {});
  }, [romNeedsText, gid, refresh]);

  // desktop: the long store text, genres and the review summary
  const [details, setDetails] = useState<SteamDetails | null>(null);
  const sid = g?.steamAppId;
  useEffect(() => {
    setDetails(null);
    if (demo || !sid) return;
    let alive = true;
    api.steamAppDetails(sid).then((d) => { if (alive) setDetails(d); }).catch(() => {});
    return () => { alive = false; };
  }, [demo, sid]);

  // desktop: games whose launcher gave no size get their folder measured once
  const needsSize = !demo && !!g && g.installed && !g.sizeGB && !isSystem(g.platform) && !!g.installDir;
  useEffect(() => {
    if (!needsSize || !gid) return;
    api.measureSize(gid).then((b) => { if (b) update(gid, { sizeGB: b / 1024 ** 3 }); }).catch(() => {});
  }, [needsSize, gid, update]);

  if (!g) return <div className="page"><p>{tr('Oyun bulunamadı.')}</p></div>;
  const live = playing.find((p) => p.gameId === g.id);
  const art = g.hero ?? g.header ?? g.cover;
  const coverAsHero = !g.hero && !g.header && !!g.cover;
  const isRetro = isSystem(g.platform);
  const genres = g.genres.length ? g.genres : details?.genres ?? [];
  const size = isRetro && g.rom ? bytes(g.rom.sizeBytes) : g.installed && g.sizeGB ? gb(g.sizeGB) : null;
  const needs = !g.installed && details?.storageGB ? gb(details.storageGB) : null;
  const meta = g.metacritic ?? details?.metacritic ?? null;
  const rv = details?.reviews;
  const rvPct = rv?.total ? Math.round(((rv.positive ?? 0) / rv.total) * 100) : null;

  return (
    <div className="detail" style={vars}>
      {g.cover && <div className="detail-ambient" style={{ backgroundImage: `url("${g.cover}")` }} aria-hidden="true" />}
      <div className={`hero ${isRetro ? 'is-pixel' : ''} ${coverAsHero ? 'is-cover' : ''}`}>
        {art && <img key={art} src={art} alt="" className="hero-art" />}
        <div className="hero-scrim" />
        <button className="hero-back" onClick={back}><ArrowLeft size={16} strokeWidth={1.8} /> {tr('Geri')}</button>
        <div className="hero-brand">
          {g.logo ? <img key={g.logo} src={g.logo} alt={g.title} className="hero-logo" onError={(ev) => { ev.currentTarget.style.display = 'none'; }} /> : null}
        </div>
      </div>

      <header className="dh">
        <div className="dh-cover"><Cover game={g} /></div>
        <div className="dh-main">
          <h1>{g.title}</h1>
          <p className="dh-meta">
            <span className="dh-plat"><PlatformLogo id={g.platform} size={14} /> {PLATFORMS[g.platform].name}</span>
            {g.mergedFrom && g.mergedFrom.slice(1).map((c) => (
              <span key={c.id} className="dh-plat is-copy" title={tr('{0}’de de var', PLATFORMS[c.platform].name)}><PlatformLogo id={c.platform} size={14} /> {PLATFORMS[c.platform].short}</span>
            ))}
            {g.installed
              ? <span className="ok">{tr('Yüklü')}</span>
              : <span>{tr('Yüklü değil')}</span>}
          </p>
          {live?.presence && <p className="dh-presence" title={tr('Oyunun şu an paylaştığı bilgi')}>{live.presence}</p>}
          <dl className="dh-facts">
            {g.developer !== '—' && <div><dt>{tr('Geliştirici')}</dt><dd>{g.developer}</dd></div>}
            {g.publisher !== '—' && g.publisher !== g.developer && <div><dt>{tr('Yayıncı')}</dt><dd>{g.publisher}</dd></div>}
            {g.release !== '—' && <div><dt>{tr('Çıkış')}</dt><dd>{g.release}</dd></div>}
            {genres.length > 0 && <div><dt>{tr('Tür')}</dt><dd>{genres.slice(0, 3).join(', ')}</dd></div>}
            {size && <div><dt>{tr('Boyut')}</dt><dd className="num">{size}</dd></div>}
            {needs && <div><dt>{tr('Gereken alan')}</dt><dd className="num">{needs}</dd></div>}
            {rv?.score ? <div><dt>{tr('Steam incelemeleri')}</dt><dd>{REVIEW[rv.score]}{rvPct != null && <span className="muted"> · {pct(rvPct)} ({compact(rv.total ?? 0)})</span>}</dd></div> : null}
            {meta != null && <div><dt>{tr('Metacritic')}</dt><dd className="num">{meta}</dd></div>}
          </dl>
        </div>
        <div className="dh-side">
          <div className="dh-actions">
            {!demo && (
              <button className="icon-btn icon-btn-lg" aria-label={tr('Görselleri değiştir')} title={tr('Görselleri değiştir')} onClick={() => setArtOpen(true)}>
                <ImageIcon size={17} strokeWidth={1.7} />
              </button>
            )}
            {g.platform !== 'steam' && !demo && (
              <button className="icon-btn icon-btn-lg" aria-label={tr('Bilgileri eşleştir')} title={tr('Bilgileri eşleştir')} onClick={() => setMatchFor(g.id)}>
                <SquarePen size={17} strokeWidth={1.7} />
              </button>
            )}
            <button
              key={faved}
              className={`icon-btn icon-btn-lg heart ${g.favorite ? 'is-on' : ''} ${faved ? 'pop' : ''}`}
              aria-pressed={g.favorite}
              aria-label={g.favorite ? tr('Favorilerden çıkar') : tr('Favorilere ekle')}
              onClick={() => { update(g.id, { favorite: !g.favorite }); setFaved((n) => n + 1); }}
            >
              <Heart size={18} strokeWidth={1.7} fill={g.favorite ? 'currentColor' : 'none'} />
            </button>
            {live ? (
              <LiveButton g={g} since={live.since} />
            ) : (
              <button className="btn btn-accent btn-lg" onClick={() => launch(g)}>
                {g.installed ? <><Play size={17} strokeWidth={2} fill="currentColor" /> {tr('Oyna')}</> : <><Download size={17} strokeWidth={1.8} /> {tr('Kur')}</>}
              </button>
            )}
          </div>
          <TagRow g={g} />
        </div>
      </header>

      <div className="tabs" role="tablist" aria-label={tr('Oyun bölümleri')}>
        {([
          ['overview', tr('Genel bakış'), null],
          ['achievements', tr('Başarımlar'), g.achievements ? `${g.achievements.unlocked}/${g.achievements.total}` : achNote?.startsWith('key:') ? achNote.slice(4) : null],
          ['sessions', tr('Oturumlar'), g.sessions.length || null],
          ...(steamApp(g) != null ? [['news', tr('Haberler'), null] as [Tab, string, null]] : []),
          ['notes', tr('Notlar'), g.notes.length || null],
          ['review', tr('İnceleme'), null],
          ...(g.rom && !demo ? [['saves', tr('Kayıtlar'), null] as [Tab, string, null]] : []),
        ] as [Tab, string, string | number | null][]).map(([k, label, n]) => (
          <button key={k} ref={(el) => { tabRefs.current[k] = el; }} role="tab" aria-selected={tab === k}
            className={`tab ${tab === k ? 'is-on' : ''}`} onClick={() => setTab(k)}>
            {label}{n != null && <span className="tab-n">{n}</span>}
          </button>
        ))}
        {bar && <span className="tab-bar" style={{ transform: `translateX(${bar.x}px)`, width: bar.w }} />}
      </div>

      <div className="detail-body" key={tab}>
        {tab === 'overview' && <Overview g={g} about={details?.about ?? g.aboutHtml ?? ''} onTab={setTab} />}
        {tab === 'achievements' && <Achievements g={g} note={achNote} />}
        {tab === 'sessions' && <Sessions g={g} />}
        {tab === 'news' && <NewsTab g={g} />}
        {tab === 'notes' && <Notes g={g} />}
        {tab === 'review' && <ReviewTab g={g} />}
        {tab === 'saves' && <SavesTab g={g} />}
      </div>
      {!demo && <ArtPicker g={g} open={artOpen} onClose={() => setArtOpen(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------- header pieces

function TagRow({ g }: { g: Game }) {
  const { update, collections } = useStore();
  const [adding, setAdding] = useState(false);
  const [val, setVal] = useState('');
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setMenu(false); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menu]);
  const commit = () => {
    const v = val.trim();
    if (v && !g.tags.includes(v)) update(g.id, (x) => ({ tags: [...x.tags, v] }));
    setVal(''); setAdding(false);
  };
  return (
    <div className="dh-tags">
      {g.tags.map((t) => (
        <span key={t} className="tag">
          {t}
          <button className="tag-x" aria-label={tr('{0} etiketini kaldır', t)} onClick={() => update(g.id, (x) => ({ tags: x.tags.filter((y) => y !== t) }))}><X size={11} strokeWidth={2} /></button>
        </span>
      ))}
      {adding ? (
        <input className="tag-input" autoFocus value={val} onChange={(e) => setVal(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setVal(''); setAdding(false); } }}
          aria-label={tr('Yeni etiket')} />
      ) : (
        <button className="tag tag-add" onClick={() => setAdding(true)}><Plus size={12} strokeWidth={2} /> {tr('Etiket')}</button>
      )}
      <div className="coll-pick" ref={ref}>
        <button className={`tag tag-add ${g.collections.length ? 'has' : ''}`} aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
          <Shapes size={12} strokeWidth={2} /> {tr('Kategori')}{g.collections.length ? ` · ${g.collections.length}` : ''}
        </button>
        {menu && (
          <div className="coll-menu" role="menu">
            {collections.filter((c) => !c.filter).length === 0 && <p className="muted small">{tr('Kenar çubuğundan kategori oluştur.')}</p>}
            {collections.filter((c) => !c.filter).map((c) => {
              const on = g.collections.includes(c.id);
              return (
                <button key={c.id} role="menuitemcheckbox" aria-checked={on} className={`coll-item ${on ? 'is-on' : ''}`}
                  onClick={() => update(g.id, (x) => ({ collections: on ? x.collections.filter((y) => y !== c.id) : [...x.collections, c.id] }))}>
                  <span className="coll-box">{on && <Check size={12} strokeWidth={2.4} />}</span>{c.id}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- overview

type Block = { k: 'h' | 'p' | 'ul'; t?: string; items?: string[] };

/** store HTML → tidy blocks. Inline tags (links, bold) stay inside their paragraph;
    only real block tags and line breaks start a new one. Images are dropped. */
function toBlocks(html: string): Block[] {
  if (!html) return [];
  const marked = html
    .replace(/<img[^>]*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<h[1-6][^>]*>/gi, '\n\u0001H')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n\u0001L')
    .replace(/<\/(p|div|li|ul|ol)>/gi, '\n')
    .replace(/<(p|div|ul|ol)(\s[^>]*)?>/gi, '\n');
  const text = new DOMParser().parseFromString(marked, 'text/html').body.textContent ?? '';
  const out: Block[] = [];
  for (const raw of text.split('\n')) {
    const head = raw.trimStart();
    const t = head.replace(/^\u0001[HL]/, '').replace(/\s+/g, ' ').trim();
    if (!t) continue;
    if (head.startsWith('\u0001H')) out.push({ k: 'h', t });
    else if (head.startsWith('\u0001L')) {
      const last = out[out.length - 1];
      if (last?.k === 'ul') last.items!.push(t); else out.push({ k: 'ul', items: [t] });
    } else out.push({ k: 'p', t });
  }
  return out;
}

function About({ g, about }: { g: Game; about: string }) {
  const [open, setOpen] = useState(false);
  const [tall, setTall] = useState(false);
  const inner = useRef<HTMLDivElement>(null);
  const blocks = useMemo(() => toBlocks(about), [about]);
  useLayoutEffect(() => {
    const el = inner.current;
    setTall(!!el && el.scrollHeight > el.clientHeight + 24);
  }, [blocks]);
  return (
    <div className="about-text">
      {g.description && <p className="about-lede">{g.description}</p>}
      {blocks.length > 0 && (
        <div className={`about-long ${open ? 'is-open' : ''} ${tall ? 'is-tall' : ''}`}>
          <div className="about-long-inner" ref={inner}>
            {blocks.map((b, i) => b.k === 'h'
              ? <h3 key={i}>{b.t}</h3>
              : b.k === 'ul'
                ? <ul key={i} className={`about-list ${b.items!.length > 3 && b.items!.every((x) => x.length < 110) ? 'is-cols' : ''}`}>{b.items!.map((x, j) => <li key={j}>{x}</li>)}</ul>
                : <p key={i}>{b.t}</p>)}
          </div>
          {(tall || open) && <button className="link about-more" onClick={() => setOpen((v) => !v)}>{open ? tr('Daha az') : tr('Devamını oku')}</button>}
        </div>
      )}
      {!g.description && blocks.length === 0 && <p className="muted">{tr('Açıklama yok.')}</p>}
    </div>
  );
}

/** Steam screenshots come in sizes; the strip takes the small one, the viewer the full one */
const shotSize = (url: string, size: '' | '.600x338' | '.116x65') =>
  /steamstatic\.com\/.*\/ss_[0-9a-f]+\.jpg/.test(url) ? url.replace(/\.jpg(\?.*)?$/, `${size}.jpg$1`) : url;

function Gallery({ shots, thumbs, pixel }: { shots: string[]; thumbs?: string[]; pixel: boolean }) {
  const [at, setAt] = useState<number | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  // warm the cache: small versions now, full ones right after (store pictures only; local ones are instant)
  useEffect(() => {
    if (thumbs) return;
    shots.forEach((s) => { const i = new Image(); i.src = shotSize(s, '.600x338'); });
    const t = window.setTimeout(() => shots.forEach((s) => { const i = new Image(); i.src = shotSize(s, ''); }), 1200);
    return () => window.clearTimeout(t);
  }, [shots, thumbs]);
  if (!shots.length) return null;
  const scroll = (dir: number) => strip.current?.scrollBy({ left: dir * strip.current.clientWidth * 0.8, behavior: 'smooth' });
  return (
    <section className="shots">
      <div className="shots-strip" ref={strip}>
        {shots.map((s, i) => (
          <button key={s} className={`shots-item ${pixel ? 'is-pixel' : ''}`} onClick={() => setAt(i)} aria-label={tr('Ekran görüntüsü {0}', i + 1)}>
            <img src={thumbs?.[i] ?? shotSize(s, '.600x338')} alt="" decoding="async" loading={thumbs ? 'lazy' : undefined} />
          </button>
        ))}
      </div>
      {shots.length > 4 && (
        <>
          <button className="shots-nav is-prev" aria-label={tr('Önceki görseller')} onClick={() => scroll(-1)}><ChevronLeft size={18} /></button>
          <button className="shots-nav is-next" aria-label={tr('Sonraki görseller')} onClick={() => scroll(1)}><ChevronRight size={18} /></button>
        </>
      )}
      <Viewer shots={shots} thumbs={thumbs} at={at} setAt={setAt} pixel={pixel} />
    </section>
  );
}

/** full-screen viewer: the picture as large as the window allows, a filmstrip below */
function Viewer({ shots, thumbs, at, setAt, pixel }: { shots: string[]; thumbs?: string[]; at: number | null; setAt: (i: number | null) => void; pixel: boolean }) {
  const { mounted, leaving } = usePresence(at != null);
  const [last, setLast] = useState(0);
  if (at != null && at !== last) setLast(at);
  const i = at ?? last;
  useEffect(() => {
    if (at == null) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setAt((at + 1) % shots.length);
      if (e.key === 'ArrowLeft') setAt((at - 1 + shots.length) % shots.length);
      if (e.key === 'Escape') setAt(null);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [at, shots.length, setAt]);
  if (!mounted) return null;
  return createPortal(
    <div className={`viewer2 ${leaving ? 'is-leaving' : ''}`} role="dialog" aria-label={tr('Ekran görüntüleri')} onMouseDown={() => setAt(null)}>
      <div className="viewer2-bg" style={{ backgroundImage: `url("${thumbs?.[i] ?? shotSize(shots[i], '.600x338')}")` }} aria-hidden="true" />
      <div className="viewer2-top" onMouseDown={(e) => e.stopPropagation()}>
        <span className="num">{i + 1} / {shots.length}</span>
        <button className="viewer2-btn" aria-label={tr('Kapat')} onClick={() => setAt(null)}><X size={18} /></button>
      </div>
      <div className="viewer2-stage">
        <button className="viewer2-btn viewer2-side is-prev" aria-label={tr('Önceki')} onMouseDown={(e) => e.stopPropagation()} onClick={() => setAt((i - 1 + shots.length) % shots.length)}><ChevronLeft size={22} /></button>
        <img key={i} src={shotSize(shots[i], '')} alt="" className={`viewer2-img ${pixel ? 'is-pixel' : ''}`} onMouseDown={(e) => e.stopPropagation()} />
        <button className="viewer2-btn viewer2-side is-next" aria-label={tr('Sonraki')} onMouseDown={(e) => e.stopPropagation()} onClick={() => setAt((i + 1) % shots.length)}><ChevronRight size={22} /></button>
      </div>
      <div className="viewer2-film" onMouseDown={(e) => e.stopPropagation()}>
        {shots.map((s, k) => (
          <button key={s} className={`viewer2-thumb ${k === i ? 'is-on' : ''}`} onClick={() => setAt(k)} aria-label={tr('Görsel {0}', k + 1)}>
            <img src={thumbs?.[k] ?? shotSize(s, '.116x65')} alt="" loading="lazy" />
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}

function rhythmFacts(g: Game) {
  const s = g.sessions;
  if (!s.length) return null;
  const longest = s.reduce((a, x) => (x.minutes > a.minutes ? x : a), s[0]);
  const days = [...new Set(s.map((x) => new Date(x.start).toDateString()))].map((d) => new Date(d).getTime()).sort((a, b) => a - b);
  let streak = 1, best = 1;
  for (let i = 1; i < days.length; i++) {
    streak = Math.round((days[i] - days[i - 1]) / 86400000) === 1 ? streak + 1 : 1;
    best = Math.max(best, streak);
  }
  const perDay = new Array(7).fill(0);
  for (const x of s) perDay[new Date(x.start).getDay()] += x.minutes;
  return { longest, best, fav: WEEKDAYS[perDay.indexOf(Math.max(...perDay))] };
}

const LIVE_GAMES: Record<number, string> = {
  730: tr('Maçtayken harita, mod, skor ve K/D/A burada ve kenar çubuğunda görünür. Açınca oyunun cfg klasörüne küçük bir ayar dosyası yazılır; bilgi yalnızca bu bilgisayardaki Tessera’ya gider. Oyun açıksa yeniden başlat.'),
  570: tr('Maçtayken kahraman, seviye, K/D/A ve maç süresi burada ve kenar çubuğunda görünür. Açınca oyunun cfg klasörüne küçük bir ayar dosyası yazılır; bilgi yalnızca bu bilgisayardaki Tessera’ya gider. Oyun açıksa yeniden başlat.'),
  252950: tr('Maçtayken skor, kalan süre ve golleriyle kurtarışların görünür. Açınca Rocket League’in kendi istatistik ayarı açılır (saniyede 2 güncelleme, yalnızca bu bilgisayarda). Oyun açıksa yeniden başlat.'),
};

/** a game owned in more than one store: every copy, each with its own button */
function Copies({ g }: { g: Game }) {
  const { launch, demo } = useStore();
  if (!g.mergedFrom) return null;
  return (
    <section className="panel copies">
      <div className="panel-head">
        <h2 className="panel-title">{tr('Kopyalar')}</h2>
        <span className="muted small">{tr('Süre hepsinin toplamı')}</span>
      </div>
      <ul className="copies-list">
        {g.mergedFrom.map((c) => (
          <li key={c.id}>
            <PlatformLogo id={c.platform} size={18} />
            <span className="copies-text">
              <span className="copies-name">{PLATFORMS[c.platform].name}</span>
              <span className="muted small">
                {c.installed ? <span className="ok">{tr('Yüklü')}</span> : tr('Yüklü değil')}
                {totalMinutes(c) > 0 ? <> · {duration(totalMinutes(c), { compact: true })}</> : null}
              </span>
            </span>
            {!demo && (
              <button className={`btn btn-sm ${c.installed ? 'btn-accent' : ''}`} onClick={() => launch(c)}>
                {c.installed ? <><Play size={14} strokeWidth={2} fill="currentColor" /> {tr('Oyna')}</> : <><Download size={14} strokeWidth={1.8} /> {tr('Kur')}</>}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** CS2, Dota 2, Rocket League: turn on the game's own live match data */
function LiveSetup({ g }: { g: Game }) {
  const { demo, notify } = useStore();
  const appid = steamApp(g) ?? (/rocket league/i.test(g.title) ? 252950 : null);
  const [state, setState] = useState<{ available: boolean; on: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (demo || appid == null || !LIVE_GAMES[appid]) return;
    api.liveStatus().then((l) => setState(l.find((x) => x.appid === appid) ?? null)).catch(() => {});
  }, [appid, demo]);
  if (appid == null || !LIVE_GAMES[appid] || !state?.available) return null;
  const toggle = async () => {
    setBusy(true);
    try {
      await api.liveSet(appid, !state.on);
      setState({ ...state, on: !state.on });
      notify(state.on ? tr('Canlı maç bilgisi kapatıldı') : tr('Canlı maç bilgisi açıldı'));
    } catch (e) { notify(String(e)); }
    setBusy(false);
  };
  return (
    <section className="panel live-setup">
      <div className="panel-head">
        <h2 className="panel-title">{tr('Canlı maç bilgisi')}</h2>
        <button className={`btn btn-sm ${state.on ? '' : 'btn-accent'}`} onClick={toggle} disabled={busy} aria-pressed={state.on}>{state.on ? tr('Kapat') : tr('Aç')}</button>
      </div>
      <p className="muted small">{state.on ? <><span className="ok">{tr('Açık.')}</span> </> : null}{LIVE_GAMES[appid]}</p>
    </section>
  );
}

/** the user's own Steam screenshots of this game, from this PC */
function MyShots({ g }: { g: Game }) {
  const { demo, notify } = useStore();
  const [list, setList] = useState<ShotFile[]>([]);
  const [online, setOnline] = useState<{ full: string; thumb: string; page: string }[]>([]);
  const [from, setFrom] = useState<'pc' | 'profile'>('pc');
  useEffect(() => {
    if (demo) return;
    let alive = true;
    setList([]); setOnline([]); setFrom('pc');
    api.gameScreenshots(g.id).then((v) => alive && setList(v)).catch(() => {});
    api.profileScreenshots(g.id).then((v) => alive && setOnline(v)).catch(() => {});
    return () => { alive = false; };
  }, [g.id, demo]);
  const side = from === 'pc' && list.length ? 'pc' : online.length ? 'profile' : 'pc';
  const full = useMemo(() => (side === 'pc' ? list.map((x) => shotUrl(x.full)) : online.map((x) => x.full)), [side, list, online]);
  const thumbs = useMemo(() => (side === 'pc' ? list.map((x) => shotUrl(x.thumb ?? x.full)) : online.map((x) => x.thumb)), [side, list, online]);
  if (!list.length && !online.length) return null;
  return (
    <section className="my-shots" aria-label={tr('Senin ekran görüntülerin')}>
      <div className="my-shots-head">
        <h2 className="section-title">{tr('Senin ekran görüntülerin')}</h2>
        <div className="segmented segmented-text" role="group" aria-label={tr('Nereden')}>
          {list.length > 0 && <button aria-pressed={side === 'pc'} onClick={() => setFrom('pc')}>{tr('Bu bilgisayar')} <span className="muted num">{list.length}</span></button>}
          {online.length > 0 && <button aria-pressed={side === 'profile'} onClick={() => setFrom('profile')}>{tr('Steam profili')} <span className="muted num">{online.length}</span></button>}
        </div>
        {side === 'pc' ? (
          <button className="btn btn-ghost btn-sm" onClick={() => api.openScreenshots(g.id).catch(() => notify(tr('Klasör açılamadı')))}>
            <FolderOpen size={14} strokeWidth={1.8} /> {tr('Klasörü aç')}
          </button>
        ) : (
          <button className="btn btn-ghost btn-sm" onClick={() => api.openUrl(online[0].page.replace(/filedetails.*/, '')).catch(() => {})}>
            <FolderOpen size={14} strokeWidth={1.8} /> {tr('Steam’de aç')}
          </button>
        )}
      </div>
      <Gallery key={side} shots={full} thumbs={thumbs} pixel={false} />
    </section>
  );
}

function Overview({ g, about, onTab }: { g: Game; about: string; onTab: (t: Tab) => void }) {
  const ach = g.achievements;
  const rare = ach?.list?.filter((a) => a.unlockedAt).sort((a, b) => (a.percent ?? 100) - (b.percent ?? 100)).slice(0, 4) ?? [];
  const note = g.notes[0];
  const facts = rhythmFacts(g);
  return (
    <div className="ov">
      <About g={g} about={about} />
      <Gallery shots={g.screenshots} pixel={isSystem(g.platform)} />
      <MyShots g={g} />
      <Copies g={g} />
      <LiveSetup g={g} />
      <StoresPanel g={g} />

      <section className="ov-play" aria-label={tr('Oynama')}>
        <PlayPanel g={g} />
        <section className="panel rhythm">
          <div className="panel-head">
            <h2 className="panel-title">{tr('Oynama ritmi')}</h2>
            <span className="muted small">{tr('Son 26 hafta')}</span>
          </div>
          <WeekBars sessions={g.sessions} label={tr('{0} haftalık oynama', g.title)} empty={g.importedMinutes ? tr('Tessera’dan açtığın oturumlar burada görünecek') : tr('Henüz oturum yok')} />
          {facts && (
            <dl className="rhythm-facts">
              <div><dt>{tr('En uzun')}</dt><dd className="num">{duration(facts.longest.minutes)}</dd></div>
              <div><dt>{tr('En uzun seri')}</dt><dd className="num">{facts.best} {tr('gün')}</dd></div>
              <div><dt>{tr('En çok')}</dt><dd>{facts.fav}</dd></div>
            </dl>
          )}
        </section>
        <RecordPanel g={g} />
      </section>

      {(rare.length > 0 || note || g.rom || g.review) && (
        <div className="split">
          {g.review && (
            <section className="panel">
              <div className="panel-head">
                <h2 className="panel-title">{tr('İncelemen')}</h2>
                <button className="link" onClick={() => onTab('review')}>{tr('Aç')}</button>
              </div>
              <p className="rv-mini">
                {g.review.verdict && <strong>{g.review.verdict === 'yes' ? tr('Tavsiye ederim. ') : g.review.verdict === 'no' ? tr('Tavsiye etmem. ') : tr('Kararsızım. ')}</strong>}
                {g.review.text.slice(0, 220)}{g.review.text.length > 220 ? '…' : ''}
              </p>
            </section>
          )}
          {rare.length > 0 && (
            <section className="panel">
              <div className="panel-head">
                <h2 className="panel-title">{tr('En nadir başarımların')}</h2>
                <button className="link" onClick={() => onTab('achievements')}>{tr('Tümü')}</button>
              </div>
              <ul className="ach-mini">
                {rare.map((a) => (
                  <li key={a.api}>
                    {a.icon && <img src={a.icon} alt="" />}
                    <span className="ach-mini-name">{a.name}</span>
                    <span className="num muted">{pct(a.percent?.toLocaleString(locale))}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {note && (
            <section className="panel">
              <div className="panel-head">
                <h2 className="panel-title">{tr('Son not')}</h2>
                <button className="link" onClick={() => onTab('notes')}>{tr('Notlar')}</button>
              </div>
              <p className="note-date">{shortDate(note.date)}, {clock(note.date)}</p>
              <SpoilerText text={note.text} spoiler={note.spoiler} />
            </section>
          )}
          {g.rom && <RomPanel g={g} />}
        </div>
      )}
    </div>
  );
}

function PlayPanel({ g }: { g: Game }) {
  const t = totalMinutes(g);
  const shown = useCountUp(t);
  const lp = lastPlayed(g);
  return (
    <section className="panel play">
      <h2 className="panel-title">{tr('Oynama')}</h2>
      <div className="playtime">
        <span className="playtime-value num">{t ? duration(Math.round(shown), { compact: t >= 6000 }) : tr('0 dk')}</span>
      </div>
      <dl className="facts">
        <div><dt>{tr('Son oynama')}</dt><dd>{lp ? ago(lp) : t ? '—' : tr('Hiç')}</dd></div>
        <div><dt>{tr('Oturum')}</dt><dd className="num">{g.sessions.length ? tr('{0} · ort. {1}', g.sessions.length, duration(Math.round(sessionMinutes(g) / g.sessions.length))) : '—'}</dd></div>
        <div><dt>{tr('Süre kaynağı')}</dt><dd>{tracksWithTessera(g) ? tr('Tessera') : PLATFORMS[g.platform].name}</dd></div>
        {g.hltb != null && <div><dt>{tr('Ana hikâye')}</dt><dd className="num">~{g.hltb} {tr('sa')}</dd></div>}
      </dl>
      {g.hltb != null && g.status !== 'endless' && (
        <div className="hltb">
          <Progress value={Math.min(t / 60, g.hltb)} total={g.hltb} label={tr('Ana hikâyeye göre ilerleme')} />
          <span className="muted small">{t / 60 >= g.hltb ? tr('Ana hikâye süresini geçtin') : pct(Math.round((t / 60 / g.hltb) * 100))}</span>
        </div>
      )}
    </section>
  );
}

function RecordPanel({ g }: { g: Game }) {
  const { update } = useStore();
  const [preview, setPreview] = useState<number | null>(null);
  const hasAxes = AXES.some((a) => g.axes[a.id] != null);
  const [axesOpen, setAxesOpen] = useState(hasAxes);
  const shownScore = preview ?? g.rating;

  return (
    <section className="panel record">
      <h2 className="panel-title">{tr('Senin kaydın')}</h2>
      <StatusPicker value={g.status} onChange={(s) => update(g.id, { status: s })} />
      <div className="record-score">
        <div className="record-score-num">
          <span className={`record-score-value num ${preview != null ? 'is-preview' : ''}`}>{shownScore != null ? score(shownScore) : '–'}</span>
          <span className="record-score-word">{ratingWord(shownScore)}</span>
        </div>
        <RatingBar size="lg" value={g.rating} onHover={setPreview} onChange={(v) => update(g.id, { rating: v })} />
      </div>
      {axesOpen ? (
        <div className="record-axes">
          {AXES.map((a) => (
            <div key={a.id} className="axis">
              <span className="axis-label">{a.label}</span>
              <RatingBar size="sm" value={g.axes[a.id] ?? null} onChange={(v) => update(g.id, (x) => ({ axes: { ...x.axes, [a.id]: v ?? undefined } }))} />
              <span className="num axis-v">{g.axes[a.id] != null ? score(g.axes[a.id]!) : '–'}</span>
            </div>
          ))}
        </div>
      ) : (
        <button className="link-btn" onClick={() => setAxesOpen(true)}><Plus size={14} strokeWidth={1.8} /> {tr('Ayrıntılı puan')}</button>
      )}
    </section>
  );
}

function SpoilerText({ text, spoiler }: { text: string; spoiler?: boolean }) {
  const [shown, setShown] = useState(!spoiler);
  if (shown) return <p className="note-text">{text}</p>;
  return (
    <button className="spoiler" onClick={() => setShown(true)}>
      <span className="spoiler-text" aria-hidden="true">{text}</span>
      <span className="spoiler-label"><Eye size={14} strokeWidth={1.7} /> {tr('Spoiler')}</span>
    </button>
  );
}

// ---------------------------------------------------------------- tabs

function Achievements({ g, note }: { g: Game; note?: string | null }) {
  const raUser = note?.startsWith('ra:') ? note.slice(3) : null;
  const { openSettings } = useStore();
  const [filter, setFilter] = useState<'all' | 'open' | 'locked'>('all');
  const [sort, setSort] = useState<'rarity' | 'date'>('rarity');
  const [reveal, setReveal] = useState<Set<string>>(new Set());
  const ach = g.achievements;

  const list = useMemo(() => {
    if (!ach?.list) return [];
    const l = ach.list.filter((a) => filter === 'all' || (filter === 'open' ? a.unlockedAt : !a.unlockedAt));
    return [...l].sort((a, b) => sort === 'rarity'
      ? (a.percent ?? 100) - (b.percent ?? 100)
      : (b.unlockedAt ?? '').localeCompare(a.unlockedAt ?? ''));
  }, [ach, filter, sort]);

  if (!ach && note && !note.startsWith('ra:')) {
    return (
      <div className="panel empty-panel">
        {note === 'loading' && <p>{tr('Yükleniyor…')}</p>}
        {note === 'none' && <p>{tr('Bu oyunda başarım yok.')}</p>}
        {note.startsWith('err:') && <p>{tr('Başarımlar alınamadı:')} {note.slice(4)}</p>}
        {note === 'ra-none' && <p>{tr('Bu oyunun RetroAchievements’ta başarım seti yok.')}</p>}
        {note === 'ra-account' && (
          <>
            <p>{tr('Retro başarımlar RetroAchievements’tan gelir. Ücretsiz hesabını bağla, ilerlemen burada görünsün.')}</p>
            <button className="btn btn-sm" onClick={() => openSettings('accounts')}>{tr('Hesap bağla')}</button>
          </>
        )}
        {note.startsWith('key:') && (
          <>
            <p>{note.slice(4)} {tr('başarım. Açtıklarını görmek için Steam Web API anahtarı gerekli.')}</p>
            <button className="btn btn-sm" onClick={() => openSettings('accounts')}>{tr('Anahtar ekle')}</button>
          </>
        )}
      </div>
    );
  }
  if (!ach) {
    return <div className="panel empty-panel"><p>{isSystem(g.platform) ? tr('Retro başarımlar (RetroAchievements) henüz yok.') : tr('Başarım bilgisi yok.')}</p></div>;
  }
  const rarest = ach.list?.filter((a) => a.unlockedAt).sort((a, b) => (a.percent ?? 100) - (b.percent ?? 100))[0];

  return (
    <div className="stack">
      <section className="panel ach-summary">
        <div className="ach-count">
          <span className="playtime-value num">{ach.unlocked}<span className="muted"> / {ach.total}</span></span>
          <span className="muted">{pct(Math.round((ach.unlocked / ach.total) * 100))}</span>
        </div>
        <Progress value={ach.unlocked} total={ach.total} label={tr('Başarım ilerlemesi')} />
        {rarest && <p className="muted">{tr('En nadiri')} <strong className="ink">{rarest.name}</strong> · {pct(rarest.percent?.toLocaleString(locale))}</p>}
        {raUser && <p className="muted small">{tr('RetroAchievements ·')} {raUser}{tr('. Başarım kazanmak için oyunu RetroArch gibi destekleyen bir emülatörde oyna.')}</p>}
      </section>

      {ach.list && (
        <>
          <div className="toolbar toolbar-tight">
            <div className="chips">
              {([['all', tr('Hepsi')], ['open', tr('Açılanlar')], ['locked', tr('Kilitli')]] as const).map(([k, l]) => (
                <button key={k} className={`chip ${filter === k ? 'is-on' : ''}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>
              ))}
            </div>
            <label className="field">
              <span className="sr-only">{tr('Sırala')}</span>
              <select value={sort} onChange={(e) => setSort(e.target.value as 'rarity' | 'date')}>
                <option value="rarity">{tr('En nadirden')}</option>
                <option value="date">{tr('Tarihe göre')}</option>
              </select>
            </label>
          </div>
          <ul className="ach-list">
            {list.map((a, i) => {
              const hidden = a.hidden && !a.unlockedAt && !reveal.has(a.api);
              return (
                <li key={a.api} className={a.unlockedAt ? 'is-open' : 'is-locked'} style={{ '--i': Math.min(i, 14) } as CSSProperties}>
                  <span className="ach-icon">
                    {a.icon && <img src={a.icon} alt="" loading="lazy" />}
                    {!a.unlockedAt && <Lock size={13} strokeWidth={2} className="ach-lock" />}
                  </span>
                  <span className="ach-text">
                    <span className="ach-name">{hidden ? tr('Gizli başarım') : a.name}</span>
                    <span className="ach-desc">
                      {hidden ? <button className="link" onClick={() => setReveal((s) => new Set(s).add(a.api))}>{tr('Göster')}</button> : a.description || '—'}
                    </span>
                  </span>
                  <span className="ach-rarity">
                    <span className="num">{a.percent != null ? pct(a.percent.toLocaleString(locale)) : '—'}</span>
                    <span className="rarity-bar"><span style={{ width: `${Math.max(2, a.percent ?? 0)}%` }} /></span>
                  </span>
                  <span className="ach-date muted">{a.unlockedAt ? shortDate(a.unlockedAt) : tr('Kilitli')}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

function Sessions({ g }: { g: Game }) {
  const rows = [...g.sessions].reverse();
  const said = rows.some((s) => s.presence);
  return (
    <div className="stack">
      <p className="muted">
        {g.sessions.length ? <>{g.sessions.length} {tr('oturum ·')} {duration(sessionMinutes(g))}</> : <>{tr('Henüz oturum yok.')}</>}
        {g.importedMinutes > 0 && <> {tr('· öncesi')} {PLATFORMS[g.platform].name}{tr('’e göre')} {int(Math.round(g.importedMinutes / 60))} {tr('sa')}</>}
      </p>
      {rows.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{tr('Tarih')}</th><th>{tr('Başlangıç')}</th><th>{tr('Bitiş')}</th>{said && <th>{tr('Kaldığın yer')}</th>}<th className="r">{tr('Süre')}</th></tr></thead>
            <tbody>
              {rows.slice(0, 40).map((s) => {
                const end = new Date(new Date(s.start).getTime() + s.minutes * 60000);
                return (
                  <tr key={s.start}>
                    <td>{longDate(s.start)}</td>
                    <td className="num">{clock(s.start)}</td>
                    <td className="num">{clock(end)}</td>
                    {said && <td className="sess-presence" title={s.presence}>{s.presence ?? ''}</td>}
                    <td className="r num">{duration(s.minutes)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length > 40 && <p className="muted table-foot">{tr('Son 40 /')} {rows.length}</p>}
        </div>
      )}
    </div>
  );
}

function Notes({ g }: { g: Game }) {
  const { update } = useStore();
  const [text, setText] = useState('');
  const [spoiler, setSpoiler] = useState(false);
  const add = () => {
    if (!text.trim()) return;
    update(g.id, (x) => ({ notes: [{ id: crypto.randomUUID(), date: new Date().toISOString(), text: text.trim(), spoiler }, ...x.notes] }));
    setText(''); setSpoiler(false);
  };
  return (
    <div className="stack notes">
      <section className="panel composer">
        <label className="sr-only" htmlFor="note">{tr('Yeni not')}</label>
        <textarea id="note" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={tr('Not yaz…')}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) add(); }} />
        <div className="composer-foot">
          <label className="check"><input type="checkbox" checked={spoiler} onChange={(e) => setSpoiler(e.target.checked)} /> {tr('Spoiler')}</label>
          <button className="btn btn-primary btn-sm" onClick={add} disabled={!text.trim()}>{tr('Ekle')} <kbd className="kbd-on-primary">{tr('Ctrl ↵')}</kbd></button>
        </div>
      </section>
      {g.notes.length === 0 ? (
        <p className="muted">{tr('Henüz not yok.')}</p>
      ) : (
        <ol className="journal">
          {g.notes.map((n) => (
            <li key={n.id}>
              <p className="note-date">{longDate(n.date)} · {clock(n.date)}</p>
              <SpoilerText text={n.text} spoiler={n.spoiler} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function RomPanel({ g }: { g: Game }) {
  const r = g.rom!;
  return (
    <section className="panel">
      <h2 className="panel-title">{tr('ROM')}</h2>
      <dl className="facts">
        <div><dt>{tr('Dosya')}</dt><dd className="break">{r.file}</dd></div>
        <div><dt>{tr('Boyut')}</dt><dd className="num">{bytes(r.sizeBytes)}</dd></div>
        <div><dt>{tr('Bölge')}</dt><dd>{r.region}</dd></div>
        <div><dt>{tr('Tanıma')}</dt><dd>{r.match ? <>{r.db ?? tr('No-Intro')}{r.match.crc && <span className="muted num"> {tr('· CRC')} {r.match.crc}</span>}</> : <span className="warn">{tr('Veritabanında yok')}</span>}</dd></div>
        {r.romhack && <div><dt>{tr('Yama')}</dt><dd className="break">{r.romhack.patch}</dd></div>}
        {r.dbName && r.dbName !== g.title && <div><dt>{tr('Veritabanı adı')}</dt><dd className="break">{r.dbName}</dd></div>}
      </dl>
    </section>
  );
}
