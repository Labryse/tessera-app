// Game controllers through the browser's Gamepad API, turned into a few actions.
// Directions repeat while held (slowly, then faster), buttons fire once per press.
// Nothing is read while Tessera's window is not in focus, so a button pressed in
// a game never reaches Tessera.
import { useEffect, useRef, useState } from 'react';

export type PadAction = 'up' | 'down' | 'left' | 'right' | 'a' | 'b' | 'x' | 'y' | 'lb' | 'rb' | 'start' | 'select';
export type PadKind = 'xbox' | 'ps';

// standard mapping: https://w3c.github.io/gamepad/#remapping
const BUTTONS: [number, PadAction][] = [[0, 'a'], [1, 'b'], [2, 'x'], [3, 'y'], [4, 'lb'], [5, 'rb'], [8, 'select'], [9, 'start'], [16, 'start']];
const DIRS: [PadAction, (p: Gamepad) => boolean][] = [
  ['up', (p) => !!p.buttons[12]?.pressed || (p.axes[1] ?? 0) < -0.55],
  ['down', (p) => !!p.buttons[13]?.pressed || (p.axes[1] ?? 0) > 0.55],
  ['left', (p) => !!p.buttons[14]?.pressed || (p.axes[0] ?? 0) < -0.55],
  ['right', (p) => !!p.buttons[15]?.pressed || (p.axes[0] ?? 0) > 0.55],
];
const FIRST = 380;
const REPEAT = 130;
const FAST = 70;

export const kindOf = (id: string): PadKind => (/054c|playstation|dualsense|dualshock|wireless controller/i.test(id) ? 'ps' : 'xbox');

const pads = () => (navigator.getGamepads?.() ?? []).filter((p): p is Gamepad => !!p && p.connected);

/** calls `on` with each action while `enabled`; tells which kind of controller was used last */
export function usePad(on: (a: PadAction) => void, enabled = true) {
  const handler = useRef(on);
  handler.current = on;
  const [kind, setKind] = useState<PadKind | null>(() => {
    const p = pads()[0];
    return p ? kindOf(p.id) : null;
  });

  useEffect(() => {
    if (!enabled || !('getGamepads' in navigator)) return;
    const was = new Map<string, boolean>();
    const held = new Map<string, { since: number; next: number; n: number }>();
    let raf = 0;
    let first = true;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const focused = document.hasFocus() && !document.hidden;
      for (const p of pads()) {
        const fire = (a: PadAction) => {
          if (!focused) return;
          setKind((k) => (k === kindOf(p.id) ? k : kindOf(p.id)));
          handler.current(a);
        };
        for (const [i, a] of BUTTONS) {
          const key = `${p.index}:${i}`;
          const down = !!p.buttons[i]?.pressed;
          // a button already held when the mode opened (the one that opened it) does not count
          if (down && !was.get(key) && !first) fire(a);
          was.set(key, down);
        }
        for (const [a, test] of DIRS) {
          const key = `${p.index}:${a}`;
          if (!test(p)) { held.delete(key); continue; }
          const h = held.get(key);
          if (!h) {
            held.set(key, { since: now, next: now + FIRST, n: 0 });
            if (!first) fire(a);
          } else if (now >= h.next) {
            h.n += 1;
            h.next = now + (h.n > 6 ? FAST : REPEAT);
            fire(a);
          }
        }
      }
      first = false;
    };
    raf = requestAnimationFrame(loop);
    const connected = (e: GamepadEvent) => setKind(kindOf(e.gamepad.id));
    const gone = () => { if (!pads().length) setKind(null); };
    window.addEventListener('gamepadconnected', connected);
    window.addEventListener('gamepaddisconnected', gone);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('gamepadconnected', connected);
      window.removeEventListener('gamepaddisconnected', gone);
    };
  }, [enabled]);

  return kind;
}

/** a soft tick for moving around, a lower one for going back; quiet on purpose */
let ctx: AudioContext | null = null;
export function tick(kind: 'move' | 'select' | 'back', volume: number) {
  if (volume <= 0) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const f = kind === 'move' ? 1320 : kind === 'select' ? 880 : 520;
    o.type = 'sine';
    o.frequency.setValueAtTime(f, t);
    if (kind === 'select') o.frequency.exponentialRampToValueAtTime(f * 1.5, t + 0.08);
    if (kind === 'back') o.frequency.exponentialRampToValueAtTime(f * 0.7, t + 0.08);
    const peak = volume * (kind === 'move' ? 0.035 : 0.06);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === 'move' ? 0.06 : 0.14));
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.16);
  } catch { /* no audio: stay silent */ }
}
