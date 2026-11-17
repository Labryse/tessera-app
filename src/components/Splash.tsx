// The startup: nine tiles fly in from wherever they were and settle into the
// mosaic, the name rises letter by letter, then the room opens onto the library.
import { useEffect, useState, type CSSProperties } from 'react';
import { useStore } from '../store';
import { playChime } from '../lib/chime';

import { t as tr, reopened } from '../lib/i18n';
// where each tile starts: x, y (px), rotation (deg)
const FROM: [number, number, number][] = [
  [-150, -90, -38], [10, -160, 24], [170, -70, 41],
  [-190, 20, 18], [0, 0, 0], [200, 30, -27],
  [-130, 140, 33], [-10, 170, -19], [150, 120, 29],
];
const ORDER = [4, 1, 5, 7, 3, 0, 2, 8, 6]; // centre first, then around
const NAME = tr('Tessera');

export function Splash() {
  const { prefs, splashKey } = useStore();
  const first = splashKey === 0;
  // started with Windows, hidden in the tray: no show, no sound
  const quiet = first && (window as { __TESSERA_HIDDEN__?: boolean }).__TESSERA_HIDDEN__ === true;
  const [phase, setPhase] = useState<'play' | 'out' | 'done'>(() => ((first && !prefs.startupAnim) || quiet || (first && reopened) ? 'done' : 'play'));
  const [run, setRun] = useState(splashKey);

  // replay from Settings
  if (run !== splashKey) { setRun(splashKey); setPhase('play'); }

  useEffect(() => {
    if (phase !== 'play') return;
    const quick = prefs.motion === 'reduced';
    if (prefs.startupSound) playChime(prefs.volume);
    const out = window.setTimeout(() => setPhase('out'), quick ? 700 : 2350);
    return () => window.clearTimeout(out);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, run]);

  useEffect(() => {
    if (phase !== 'out') return;
    const t = window.setTimeout(() => setPhase('done'), 520);
    return () => window.clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'play') return;
    const skip = () => setPhase('out');
    window.addEventListener('keydown', skip, { once: true });
    return () => window.removeEventListener('keydown', skip);
  }, [phase]);

  if (phase === 'done') return null;
  return (
    <div className={`splash ${phase === 'out' ? 'is-out' : ''} ${prefs.motion === 'reduced' ? 'is-quick' : ''}`} onClick={() => setPhase('out')} key={run} aria-hidden="true">
      <span className="splash-breath" />
      <div className="splash-center">
        <div className="splash-grid">
          {FROM.map(([x, y, r], i) => (
            <span
              key={i}
              className={`splash-tile ${i === 4 ? 'is-accent' : ''}`}
              style={{ '--x': `${x}px`, '--y': `${y}px`, '--r': `${r}deg`, '--d': `${ORDER.indexOf(i) * 85}ms` } as CSSProperties}
            />
          ))}
        </div>
        <div className="splash-name">
          {[...NAME].map((c, i) => <span key={i} style={{ '--d': `${980 + i * 45}ms` } as CSSProperties}>{c}</span>)}
        </div>
      </div>
    </div>
  );
}
