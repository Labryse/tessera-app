// "Geniş ekran": Tessera for a TV and a controller. Tabs across the top (LB/RB):
// the library, the wishlist, price search, updates, friends and stats, each as
// shelves of big tiles with the focused one's art filling the screen. A opens a
// page, B goes back. Works with a controller, the keyboard and the mouse.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MonitorUp } from 'lucide-react';
import { useStore } from '../store';
import { tick, usePad, type PadAction, type PadKind } from '../lib/pad';
import { playChime } from '../lib/chime';
import { Mark, useNow } from './bits';
import { clock, elapsed } from './Session';
import { BigTab, TABS, type TabId } from './BigTabs';
import { t as tr, locale } from '../lib/i18n';

// ---------------------------------------------------------------- button glyphs

const PS_SHAPE: Record<string, ReactNode> = {
  a: <path d="M7 7l10 10M17 7L7 17" />,
  b: <circle cx="12" cy="12" r="5.5" />,
  x: <rect x="7" y="7" width="10" height="10" rx="0.5" />,
  y: <path d="M12 6.5l6 10H6z" />,
};
const KEYS: Record<string, string> = { a: tr('Enter'), b: tr('Esc'), x: 'I', y: 'F', lb: 'Q', rb: 'E' };
export type GlyphId = 'a' | 'b' | 'x' | 'y' | 'lb' | 'rb';

export function Glyph({ b, kind }: { b: GlyphId; kind: PadKind | null }) {
  if (!kind) return <kbd className="big-key">{KEYS[b]}</kbd>;
  if (b === 'lb' || b === 'rb') return <span className="big-glyph is-bumper">{kind === 'ps' ? (b === 'lb' ? 'L1' : 'R1') : b.toUpperCase()}</span>;
  if (kind === 'ps') {
    return (
      <span className="big-glyph">
        <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">{PS_SHAPE[b]}</svg>
      </span>
    );
  }
  return <span className="big-glyph">{b.toUpperCase()}</span>;
}

// ---------------------------------------------------------------- the shell

const INTRO_MS = 1750;
const OUT_MS = 420;

/** what the active tab answers to; true when it used the button */
export type Handler = (a: PadAction) => boolean;

export function BigPicture() {
  const { big, setBig, playing, prefs, byId } = useStore();
  const [tab, setTab] = useState<TabId>('library');
  const [leaving, setLeaving] = useState(false);
  const [leaveAt, setLeaveAt] = useState(0);
  // up from the top row lands on the way back to the desktop, in the top bar
  const [onExit, setOnExit] = useState(false);
  // on screen at all, and which part of its life: the opening, the view, the closing
  const [shown, setShown] = useState(big);
  const [phase, setPhase] = useState<'intro' | 'on' | 'out'>('on');
  const now = useNow(1000);
  const root = useRef<HTMLDivElement>(null);
  const handler = useRef<Handler | null>(null);
  const still = prefs.motion === 'reduced' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const sound = (k: 'move' | 'select' | 'back') => tick(k, prefs.volume);

  useEffect(() => {
    if (big) {
      setShown(true); setLeaving(false); setOnExit(false); setTab('library');
      root.current?.focus();
      if (still) { setPhase('on'); return; }
      setPhase('intro');
      if (prefs.startupSound) playChime(prefs.volume * 0.8);
      const t = window.setTimeout(() => setPhase('on'), INTRO_MS);
      return () => window.clearTimeout(t);
    }
    if (!shown) return;
    if (still) { setShown(false); return; }
    setPhase('out');
    const t = window.setTimeout(() => setShown(false), OUT_MS);
    return () => window.clearTimeout(t);
  }, [big]); // eslint-disable-line react-hooks/exhaustive-deps

  const switchTab = (d: number) => {
    const i = TABS.findIndex((x) => x.id === tab);
    const next = TABS[(i + d + TABS.length) % TABS.length];
    sound('move');
    setTab(next.id);
  };

  const act = (a: PadAction) => {
    if (!big || phase !== 'on') return;
    if (leaving) {
      if (a === 'a') { if (leaveAt === 0) { sound('select'); setBig(false); } else { sound('back'); setLeaving(false); } }
      if (a === 'b') { sound('back'); setLeaving(false); }
      if (a === 'left' || a === 'right') { sound('move'); setLeaveAt((v) => 1 - v); }
      return;
    }
    if (onExit) {
      if (a === 'a') { sound('select'); setLeaveAt(0); setLeaving(true); }
      if (a === 'down' || a === 'b') { sound('back'); setOnExit(false); }
      if (a === 'lb') { setOnExit(false); switchTab(-1); }
      if (a === 'rb') { setOnExit(false); switchTab(1); }
      return;
    }
    if (handler.current?.(a)) return;
    if (a === 'up') { sound('move'); setOnExit(true); return; }
    if (a === 'lb') { switchTab(-1); return; }
    if (a === 'rb') { switchTab(1); return; }
    if (a === 'b' || a === 'select' || a === 'guide') { sound('back'); setLeaveAt(0); setLeaving(true); }
  };

  const kind = usePad(act, big && phase === 'on');

  // the keyboard does the same (typing goes to a focused text field)
  useEffect(() => {
    if (!big) return;
    const map: Record<string, PadAction> = {
      ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'a', Escape: 'b', Backspace: 'b',
      f: 'y', F: 'y', i: 'x', I: 'x', q: 'lb', Q: 'lb', e: 'rb', E: 'rb', PageUp: 'lb', PageDown: 'rb',
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F11') return;
      const typing = e.target instanceof HTMLInputElement;
      if (typing && !['ArrowUp', 'ArrowDown', 'Enter', 'Escape'].includes(e.key)) return;
      const a = map[e.key];
      if (!a) return;
      e.preventDefault(); e.stopPropagation();
      act(a);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  if (!shown) return null;
  const time = new Date(now).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const running = playing[0] ? { s: playing[0], g: byId.get(playing[0].gameId) } : null;
  const at = TABS.findIndex((x) => x.id === tab);

  return (
    <div className={`big is-${phase} ${still ? 'is-still' : ''} ${onExit ? 'is-top' : ''}`} ref={root} tabIndex={-1} role="application" aria-label={tr('Geniş ekran')}>
      <BigTab key={tab} tab={tab} kind={kind} now={now} handler={handler} onExit={() => { setLeaveAt(0); setLeaving(true); }} />

      <header className="big-top">
        <span className="big-brand"><Mark /> {tr('Tessera')}</span>
        <nav className="big-tabs" aria-label={tr('Bölümler')}>
          <button className="big-tabs-step" onClick={() => switchTab(-1)} aria-label={tr('Önceki bölüm')}><Glyph b="lb" kind={kind} /></button>
          {TABS.map((x, i) => (
            <button key={x.id} className={`big-tab ${x.id === tab ? 'is-on' : ''}`} aria-current={x.id === tab || undefined}
              style={{ '--d': i - at } as React.CSSProperties} onClick={() => { sound('move'); setTab(x.id); }}>
              {x.icon}<span>{x.label}</span>
            </button>
          ))}
          <button className="big-tabs-step" onClick={() => switchTab(1)} aria-label={tr('Sonraki bölüm')}><Glyph b="rb" kind={kind} /></button>
        </nav>
        <span className="big-top-right">
          {running && (
            <span className="big-running">
              <span className="big-running-title">{running.g?.title ?? running.s.title}</span>
              <span className="num">{clock(elapsed(running.s.since, now))}</span>
            </span>
          )}
          <span className="big-time num">{time}</span>
          <button className={"big-exit" + (onExit ? " is-focus" : "")} onClick={() => { setLeaveAt(0); setLeaving(true); }} onMouseEnter={() => setOnExit(false)} aria-label={tr('Masaüstüne dön')}>
            <MonitorUp strokeWidth={1.8} aria-hidden="true" /><span>{tr('Masaüstü')}</span>
          </button>
        </span>
      </header>

      {leaving && (
        <div className="big-confirm-wrap">
          <div className="big-confirm" role="alertdialog" aria-label={tr('Geniş ekrandan çık')}>
            <p>{tr('Masaüstü görünümüne dönülsün mü?')}</p>
            <div className="big-confirm-actions">
              <button className={`big-action ${leaveAt === 0 ? 'is-focus' : ''}`} onClick={() => setBig(false)} onMouseEnter={() => setLeaveAt(0)}><Glyph b="a" kind={kind} /> {tr('Dön')}</button>
              <button className={`big-action ${leaveAt === 1 ? 'is-focus' : ''}`} onClick={() => setLeaving(false)} onMouseEnter={() => setLeaveAt(1)}><Glyph b="b" kind={kind} /> {tr('Kal')}</button>
            </div>
          </div>
        </div>
      )}

      {phase === 'intro' && (
        <div className="big-intro" aria-hidden="true">
          <span className="big-intro-mark"><i /><i /><i /><i /></span>
          <span className="big-intro-word">{tr('Tessera')}</span>
        </div>
      )}
    </div>
  );
}
