// A controller in the ordinary window: the d-pad or left stick moves the focus to
// the nearest control in that direction, A presses it, B closes what is open or goes
// back, LB and RB jump between the menu and the page, the right stick scrolls.
// Start and the guide button ask before opening the wide-screen mode.
import { useEffect, useRef } from 'react';
import { usePad, type PadAction } from './pad';

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** what the pad moves within: the top-most open window, else the whole app */
function scope(): HTMLElement {
  const layers = document.querySelectorAll<HTMLElement>('.modal-root, [role="menu"], .ctx-menu');
  return layers.length ? layers[layers.length - 1] : document.body;
}

function shown(el: HTMLElement) {
  if (el.closest('[aria-hidden="true"], [inert]')) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const s = getComputedStyle(el);
  return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
}

const candidates = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(shown);

/** the nearest control in a direction: one level with the focus first, then distance along it, then off to the side */
function nearest(from: DOMRect, dir: 'up' | 'down' | 'left' | 'right', list: HTMLElement[], self: Element | null) {
  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  let best: HTMLElement | null = null;
  let score = Infinity;
  for (const el of list) {
    if (el === self || el.contains(self)) continue;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    let along: number, side: number;
    if (dir === 'down') { if (r.top < from.bottom - 4 && y <= cy + 4) continue; along = Math.max(0, r.top - from.bottom); side = Math.abs(x - cx); }
    else if (dir === 'up') { if (r.bottom > from.top + 4 && y >= cy - 4) continue; along = Math.max(0, from.top - r.bottom); side = Math.abs(x - cx); }
    else if (dir === 'right') { if (r.left < from.right - 4 && x <= cx + 4) continue; along = Math.max(0, r.left - from.right); side = Math.abs(y - cy); }
    else { if (r.right > from.left + 4 && x >= cx - 4) continue; along = Math.max(0, from.left - r.right); side = Math.abs(y - cy); }
    // something level with the focus (sharing its row or column) wins over something off to the side
    const level = dir === 'left' || dir === 'right' ? r.top < from.bottom - 2 && r.bottom > from.top + 2 : r.left < from.right - 2 && r.right > from.left + 2;
    const s = along + (level ? side * 0.2 : side * 3 + 60);
    if (s < score) { score = s; best = el; }
  }
  return best;
}

function put(el: HTMLElement | null) {
  if (!el) return false;
  document.documentElement.classList.add('pad-nav');
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  return true;
}

/** the first thing worth landing on: the page's own content before the menu */
function start(root: HTMLElement) {
  const list = candidates(root);
  const inPage = list.filter((el) => el.closest('.sheet'));
  const onScreen = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; };
  return inPage.find(onScreen) ?? list.find(onScreen) ?? list[0] ?? null;
}

export function usePadNav(opts: { enabled: boolean; back: () => void; askBig: () => void; bigAsked: boolean; openBig: () => void; closeAsk: () => void }) {
  const o = useRef(opts);
  o.current = opts;

  const act = (a: PadAction) => {
    const { back, askBig, bigAsked, openBig, closeAsk } = o.current;
    if (bigAsked) {
      if (a === 'a' || a === 'start' || a === 'guide') openBig();
      if (a === 'b') closeAsk();
      return;
    }
    if (a === 'start' || a === 'guide') { askBig(); return; }
    const root = scope();
    const cur = document.activeElement instanceof HTMLElement && document.activeElement !== document.body && root.contains(document.activeElement)
      ? document.activeElement : null;
    if (a === 'up' || a === 'down' || a === 'left' || a === 'right') {
      // a text field keeps left and right for its cursor
      if (cur && (a === 'left' || a === 'right') && cur instanceof HTMLInputElement && cur.type !== 'checkbox' && cur.type !== 'range' && cur.value) return;
      if (!cur) { put(start(root)); return; }
      put(nearest(cur.getBoundingClientRect(), a, candidates(root), cur));
      return;
    }
    if (a === 'a') {
      if (!cur) { put(start(root)); return; }
      document.documentElement.classList.add('pad-nav');
      if (cur instanceof HTMLInputElement && cur.type !== 'checkbox' && cur.type !== 'radio') return;
      cur.click();
      return;
    }
    if (a === 'b') {
      if (root !== document.body) {
        (cur ?? document).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return;
      }
      back();
      return;
    }
    if (a === 'lb') {
      const nav = document.querySelector<HTMLElement>('.sidebar .nav-item.is-active') ?? document.querySelector<HTMLElement>('.sidebar .nav-item');
      put(nav);
      return;
    }
    if (a === 'rb') {
      const sheet = document.querySelector<HTMLElement>('.sheet');
      if (sheet) put(start(sheet));
    }
  };

  usePad(act, opts.enabled);

  // the right stick scrolls whatever is open
  useEffect(() => {
    if (!opts.enabled || !('getGamepads' in navigator)) return;
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (!document.hasFocus()) return;
      for (const p of navigator.getGamepads?.() ?? []) {
        const y = p?.axes[3] ?? 0;
        if (Math.abs(y) < 0.25) continue;
        const root = scope();
        const box = root === document.body
          ? document.querySelector<HTMLElement>('.sheet-scroll')
          : [...root.querySelectorAll<HTMLElement>('*')].find((el) => el.scrollHeight > el.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(el).overflowY));
        box?.scrollBy({ top: y * 22 });
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [opts.enabled]);

  // the ring around the focus is for the pad and the keyboard; the mouse hides it again
  useEffect(() => {
    const off = () => document.documentElement.classList.remove('pad-nav');
    window.addEventListener('mousedown', off, true);
    window.addEventListener('mousemove', off, { passive: true });
    return () => { window.removeEventListener('mousedown', off, true); window.removeEventListener('mousemove', off); };
  }, []);
}
