// "Ne oynasam?" — a small ritual rather than a form: a column of covers rolls
// like a slot reel, slows down and settles on one game; the room behind takes
// on that game's art.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { BellOff, Shuffle, Download, ExternalLink, Play, X } from 'lucide-react';
import { useStore } from '../store';
import { PLATFORMS, isSystem, lastPlayed, totalMinutes, type Game } from '../data/library';
import { Modal } from './Modal';
import { Cover } from './bits';
import { ago, duration } from '../lib/format';

import { t as tr, locale } from '../lib/i18n';
type Pool = 'queue' | 'half' | 'all';
type Len = 'any' | 'evening' | 'weekend' | 'long';
type Pace = 'evening' | 'weekend' | 'long';

const POOLS: { id: Pool; label: string }[] = [
  { id: 'all', label: tr('Hepsi') },
  { id: 'queue', label: tr('Hiç başlamadıklarım') },
  { id: 'half', label: tr('Yarım kalanlar') },
];
const LENS: { id: Len; label: string; hint: string }[] = [
  { id: 'any', label: tr('Fark etmez'), hint: '' },
  { id: 'evening', label: tr('Bir akşamlık'), hint: tr('Kısa oyunlar ve tek oturumda keyif veren türler: roguelike, maç tabanlı, arcade') },
  { id: 'weekend', label: tr('Hafta sonuluk'), hint: tr('Birkaç oturumda bitecek hikâye ve macera oyunları') },
  { id: 'long', label: tr('Uzun soluklu'), hint: tr('RYO, açık dünya, strateji, hayatta kalma, inşa') },
];

// Steam tags (Turkish names, as Tessera stores them) that say how long a game asks of you
const LONG = new Set(['RYO', 'Aksiyon RYO', 'JRYO', 'CRPG', 'Stratejik RYO', 'Açık Dünya', 'Açık Dünya Hayatta Kalma İnşa',
  'Devasa Çok Oyunculu', 'Devasa Çok Oyunculu RYO', 'Şehir Kurma', 'Koloni Simülatörü', 'Otomasyon', 'Büyük Strateji', '4X',
  'Sandbox', 'Hayatta Kalma', 'Üs İnşa Etme', 'Souls-like', 'Metroidvania', 'Yaşam Simülatörü', 'Çiftçilik Simülatörü',
  'Zengin Evren', 'Üretim', 'Yönetim', 'Rol Yapma', 'Strateji',
  'RPG', 'Action RPG', 'JRPG', 'Strategy RPG', 'Open World', 'Open World Survival Craft', 'Massively Multiplayer', 'MMORPG', 'City Builder', 'Colony Sim',
  'Automation', 'Grand Strategy', 'Survival', 'Base Building', 'Life Sim', 'Farming Sim', 'Lore-Rich', 'Crafting', 'Management', 'Role-Playing', 'Strategy']);
const EVENING = new Set(['Kısa', 'Rogue-like', 'Rogue-lite', 'Aksiyon Roguelike', 'Arcade', 'Basit Eğlence', 'Battle Royale', 'E-spor',
  'Rekabetçi', 'PvP', 'Arena Nişancısı', 'Spor', 'Yarış', 'Dövüş', '2D Dövüş', 'Ritim', 'Kart Oyunu', 'Parti', 'Parti Oyunu',
  'Puan Yarışı', 'Mermi Cehennemi', 'Otomatik Savaş', 'Kutu Oyunu', 'Takım Tabanlı', 'Extraction Shooter',
  'Short', 'Action Roguelike', 'Casual', 'eSports', 'Competitive', 'Arena Shooter', 'Sports', 'Racing', 'Fighting', '2D Fighter', 'Rhythm', 'Card Game',
  'Party', 'Party Game', 'Score Attack', 'Bullet Hell', 'Auto Battler', 'Board Game', 'Team-Based']);
const WEEKEND = new Set(['Görsel Roman', 'Yürüme Simülatörü', 'Kaçış Odası', 'Zengin Hikâye', 'Macera', 'Platform', 'Bulmaca Platform',
  '2D Platform', '3D Platform', 'Psikolojik Korku', 'Gizem', 'Sinematik', 'Atmosferik', 'Bulmaca', 'Duygusal', 'Kendi Maceranı Seç',
  'Hikâye Odaklı', 'Gizlilik', 'Hayatta Kalma - Korku', 'Point & Click',
  'Visual Novel', 'Walking Simulator', 'Escape Room', 'Story Rich', 'Adventure', 'Platformer', 'Puzzle Platformer', '2D Platformer', '3D Platformer',
  'Psychological Horror', 'Mystery', 'Cinematic', 'Atmospheric', 'Puzzle', 'Emotional', 'Choose Your Own Adventure', 'Stealth', 'Survival Horror']);

const SNOOZE_KEY = 'tessera.snoozed';
const readSnoozed = (): Record<string, number> => {
  try { return JSON.parse(localStorage.getItem(SNOOZE_KEY) ?? '{}') as Record<string, number>; } catch { return {}; }
};

const remaining = (g: Game) => (g.hltb != null ? Math.max(0, g.hltb - totalMinutes(g) / 60) : null);

/** how long a game asks of you: from its HowLongToBeat time when known, else from its strongest Steam tags */
function pace(g: Game): { pace: Pace; from: 'hltb' | 'tags' } | null {
  const r = remaining(g);
  if (r != null) return { pace: r <= 4 ? 'evening' : r <= 15 ? 'weekend' : 'long', from: 'hltb' };
  // Steam lists tags most-voted first; the first few carry the game's character
  const top = [...g.storeTags.slice(0, 10), ...g.genres];
  if (top.some((t) => LONG.has(t)) && !top.slice(0, 4).some((t) => EVENING.has(t))) return { pace: 'long', from: 'tags' };
  if (top.some((t) => EVENING.has(t))) return { pace: 'evening', from: 'tags' };
  if (top.some((t) => WEEKEND.has(t))) return { pace: 'weekend', from: 'tags' };
  return null;
}

function fits(g: Game, pool: Pool, len: Len, installedOnly: boolean, snoozed: Record<string, number>) {
  if (isSystem(g.platform)) return false;
  if ((snoozed[g.id] ?? 0) > Date.now()) return false;
  if (installedOnly && !g.installed) return false;
  if (pool === 'queue' && g.status !== 'backlog') return false;
  if (pool === 'half' && g.status !== 'paused' && g.status !== 'played') return false;
  if (pool === 'all' && !['backlog', 'paused', 'played', 'playing'].includes(g.status)) return false;
  if (len === 'any') return true;
  return pace(g)?.pace === len;
}

function reasons(g: Game): string[] {
  const out: string[] = [];
  const t = totalMinutes(g);
  const lp = lastPlayed(g);
  if ((g.status === 'paused' || g.status === 'played') && t > 0) out.push(tr('{0} oynayıp ara vermiştin{1}.', duration(t, { compact: true }), lp ? tr(', son kez {0}', ago(lp).toLocaleLowerCase(locale)) : ''));
  else if (g.status === 'playing') out.push(tr('Şu sıralar oynuyorsun{0}.', lp ? tr(', son kez {0}', ago(lp).toLocaleLowerCase(locale)) : ''));
  else if (!t) out.push(tr('Hiç açmadın; {0} kütüphanende bekliyor.', ago(g.addedAt).toLocaleLowerCase(locale).replace(' önce', 'dır')));
  const r = remaining(g);
  const p = pace(g);
  if (r != null && r > 0) out.push(tr('Ana hikâyenin bitmesine ortalama ~{0} saat var.', Math.ceil(r)));
  else if (p?.from === 'tags') {
    out.push(p.pace === 'evening' ? tr('Tek oturumda keyif veren türden.') : p.pace === 'weekend' ? tr('Birkaç oturumda bitecek türden.') : tr('Uzun soluklu, içine gömüleceğin türden.'));
  }
  out.push(g.installed ? tr('Yüklü, hemen başlayabilirsin.') : tr('Önce kurulması gerekiyor.'));
  return out;
}

const shuffle = <T,>(a: T[]) => {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
};

const REEL_MS = 950;
const REEL_LEN = 16;

/** one cover in the reel: eager, so nothing is blank while it rolls */
function ReelCover({ g }: { g: Game }) {
  return g.cover
    ? <img className="cover-img" src={g.cover} alt="" decoding="async" draggable={false} />
    : <div className="cover-fallback"><div className="cover-fallback-text"><span className="cover-fallback-title">{g.title}</span></div></div>;
}

export function Picker() {
  const { games, pickerOpen, closePicker, go, launch, prefs } = useStore();
  const [pool, setPool] = useState<Pool>('all');
  const [len, setLen] = useState<Len>('any');
  const [installedOnly, setInstalledOnly] = useState(false);
  const [snoozed, setSnoozed] = useState(readSnoozed);
  const [order, setOrder] = useState<Game[]>([]);
  const [reel, setReel] = useState<{ strip: Game[]; next: Game[] } | null>(null);
  const [landed, setLanded] = useState(0);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const stripRef = useRef<HTMLDivElement>(null);
  const anim = useRef<Animation | null>(null);

  const candidates = useMemo(
    () => games.filter((g) => fits(g, pool, len, installedOnly, snoozed)),
    [games, pool, len, installedOnly, snoozed],
  );

  // covers are fetched ahead, so the reel never rolls through empty frames
  useEffect(() => {
    if (!pickerOpen) return;
    for (const g of candidates.slice(0, 60)) if (g.cover) { const i = new Image(); i.src = g.cover; }
  }, [pickerOpen, candidates]);

  const pick = order[0] ?? null;

  const roll = useCallback(() => {
    anim.current?.cancel();
    const next = shuffle(candidates);
    if (!next.length) { setReel(null); setOrder([]); return; }
    if (prefs.motion === 'reduced' || next.length < 2) {
      setReel(null); setOrder(next); setLanded((n) => n + 1);
      return;
    }
    // the reel starts on what is showing now and ends on the new pick
    const filler = next.slice(1);
    const strip: Game[] = [];
    if (order[0]) strip.push(order[0]);
    for (let i = 0; strip.length < REEL_LEN - 1; i++) strip.push(filler[i % filler.length]);
    strip.push(next[0]);
    setReel({ strip, next });
  }, [candidates, prefs.motion, order]);

  // run the reel once its covers are on the page
  useLayoutEffect(() => {
    const el = stripRef.current;
    if (!reel || !el) return;
    const step = el.firstElementChild ? (el.firstElementChild as HTMLElement).offsetHeight + 14 : 0;
    const end = -(reel.strip.length - 1) * step;
    const a = el.animate(
      [
        { transform: 'translateY(0)', filter: 'blur(0px)' },
        { transform: `translateY(${end * 0.35}px)`, filter: 'blur(1.4px)', offset: 0.25 },
        { transform: `translateY(${end * 0.92}px)`, filter: 'blur(0.4px)', offset: 0.7 },
        { transform: `translateY(${end}px)`, filter: 'blur(0px)' },
      ],
      { duration: REEL_MS, easing: 'cubic-bezier(0.3, 0.1, 0.25, 1)', fill: 'forwards' },
    );
    anim.current = a;
    let done = false;
    const land = () => {
      if (done) return;
      done = true;
      setOrder(reel.next);
      setReel(null);
      setLanded((n) => n + 1);
    };
    a.finished.then(land).catch(() => { /* cancelled by a newer roll */ });
    // a window in the background gets no frames: land anyway
    const safety = window.setTimeout(land, REEL_MS + 400);
    return () => { done = true; window.clearTimeout(safety); a.cancel(); };
  }, [reel]);

  // a fresh roll every time the window opens or the filters change
  useEffect(() => {
    if (pickerOpen) roll();
    else { anim.current?.cancel(); setReel(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickerOpen, pool, len, installedOnly]);

  const rolling = !!reel;
  const others = order.slice(1, 5);
  const shown = rolling ? null : pick;

  const promote = (g: Game) => { setOrder((o) => [g, ...o.filter((x) => x.id !== g.id)]); setLanded((n) => n + 1); };
  const snooze = (g: Game) => {
    const next = { ...snoozed, [g.id]: Date.now() + 14 * 86400000 };
    setSnoozed(next);
    try { localStorage.setItem(SNOOZE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    setOrder((o) => o.filter((x) => x.id !== g.id));
  };

  useEffect(() => {
    if (!pickerOpen) return;
    const key = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'SELECT') return;
      if (e.key === ' ') { e.preventDefault(); if (!rolling) roll(); }
      if (e.key === 'Enter' && pick && !rolling) { e.preventDefault(); closePicker(); launch(pick); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [pickerOpen, roll, pick, rolling, closePicker, launch]);

  const ambient = pick ? pick.hero ?? pick.cover : null;
  const hasAny = rolling || !!pick;

  return (
    <Modal open={pickerOpen} onClose={closePicker} label={tr('Ne oynasam?')} size="xl" ambient={rolling ? null : ambient} className="picker2" bare>
      <div className="p2-top">
        <div>
          <h2 className="p2-heading">{tr('Ne oynasam?')}</h2>
          <p className="muted small">{candidates.length} {tr('oyun arasından ·')} <kbd>{tr('Boşluk')}</kbd> {tr('yeniden karıştır ·')} <kbd>{tr('Enter')}</kbd> {tr('oyna')}</p>
        </div>
        <button className="icon-btn modal-close" data-close aria-label={tr('Kapat')} onClick={closePicker}><X size={16} strokeWidth={1.7} /></button>
      </div>

      {hasAny ? (
        <div className="p2-body">
          <div
            className="p2-stage"
            onMouseMove={(e) => {
              if (rolling) return;
              const r = e.currentTarget.getBoundingClientRect();
              setTilt({ x: ((e.clientY - r.top) / r.height - 0.5) * -10, y: ((e.clientX - r.left) / r.width - 0.5) * 12 });
            }}
            onMouseLeave={() => setTilt({ x: 0, y: 0 })}
          >
            {rolling ? (
              <div className="p2-window" aria-hidden>
                <div className="p2-strip" ref={stripRef}>
                  {reel.strip.map((g, i) => <div key={i} className="p2-cover p2-slot"><ReelCover g={g} /></div>)}
                </div>
              </div>
            ) : shown && (
              <div
                key={`land-${landed}`}
                className="p2-cover is-landed"
                style={{ '--rx': `${tilt.x}deg`, '--ry': `${tilt.y}deg` } as CSSProperties}
              >
                <Cover game={shown} />
              </div>
            )}
          </div>

          <div className={`p2-info ${rolling ? 'is-dim' : ''}`} key={`info-${landed}-${rolling}`} aria-live="polite">
            {rolling || !shown ? (
              <span className="p2-kicker">{tr('Karıştırılıyor…')}</span>
            ) : (
              <>
                <span className="p2-kicker">{tr('Bu akşam için önerim')}</span>
                <span className="p2-title">{shown.title}</span>
                <span className="muted">{PLATFORMS[shown.platform].name}{shown.developer !== '—' ? ` · ${shown.developer}` : ''}{shown.year ? ` · ${shown.year}` : ''}</span>
                <ul className="p2-reasons">
                  {reasons(shown).map((r) => <li key={r}>{r}</li>)}
                </ul>
                <div className="p2-actions">
                  <button className="btn btn-accent btn-lg" onClick={() => { closePicker(); launch(shown); }}>
                    {shown.installed ? <><Play size={17} strokeWidth={2} fill="currentColor" /> {tr('Oyna')}</> : <><Download size={17} strokeWidth={1.8} /> {tr('Kur')}</>}
                  </button>
                  <button className="btn btn-lg p2-roll" onClick={roll}><Shuffle size={17} strokeWidth={1.7} /> {tr('Karıştır')}</button>
                  <button className="btn btn-ghost" onClick={() => { closePicker(); go({ name: 'game', id: shown.id }); }}><ExternalLink size={15} strokeWidth={1.7} /> {tr('Sayfası')}</button>
                  <button className="btn btn-ghost" onClick={() => snooze(shown)} title={tr('İki hafta önerilmez')}><BellOff size={15} strokeWidth={1.7} /> {tr('Şimdi değil')}</button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="p2-empty">
          <p>{tr('Bu seçimlere uyan oyun yok.')}</p>
          {len !== 'any' && <p className="small">{tr('Süre tahmini Steam etiketlerinden geliyor; etiketi olmayan oyunlar yalnızca “Fark etmez”de çıkar.')}</p>}
          <button className="btn" onClick={() => { setPool('all'); setLen('any'); setInstalledOnly(false); }}>{tr('Seçimleri sıfırla')}</button>
        </div>
      )}

      <div className="p2-foot">
        <div className="p2-filters">
          <div className="segmented segmented-text" role="group" aria-label={tr('Hangi oyunlardan')}>
            {POOLS.map((p) => <button key={p.id} aria-pressed={pool === p.id} onClick={() => setPool(p.id)}>{p.label}</button>)}
          </div>
          <div className="segmented segmented-text" role="group" aria-label={tr('Ne kadar vaktin var')}>
            {LENS.map((l) => <button key={l.id} aria-pressed={len === l.id} title={l.hint || undefined} onClick={() => setLen(l.id)}>{l.label}</button>)}
          </div>
          <label className="check"><input type="checkbox" checked={installedOnly} onChange={(e) => setInstalledOnly(e.target.checked)} /> {tr('Sadece yüklüler')}</label>
        </div>
        {others.length > 0 && !rolling && (
          <div className="p2-others">
            <span className="sub-label">{tr('Ya da')}</span>
            {others.map((g, i) => (
              <button key={g.id} className="p2-other" onClick={() => promote(g)} aria-label={g.title} title={g.title} style={{ '--i': i } as CSSProperties}>
                <Cover game={g} />
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
