// Summary cards to share: a year, a month, the genres or one game, drawn on a
// canvas in three shapes (square, story, wide) so the picture can be copied or
// saved as a PNG and posted anywhere. Nothing leaves the computer on its own.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Copy, Download, Type } from 'lucide-react';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { useStore } from '../store';
import { Modal } from './Modal';
import { api, isDesktop } from '../lib/backend';
import { gameCard, genreCard, genresCard, genreTotals, monthCard, periods, yearCard, type CardData, type Scope } from '../lib/share';
import { monthLong } from '../lib/format';
import { t as tr, locale } from '../lib/i18n';

type Size = 'square' | 'story' | 'wide';
const SIZES: Record<Size, { w: number; h: number; label: string }> = {
  square: { w: 1080, h: 1080, label: tr('Kare') },
  story: { w: 1080, h: 1920, label: tr('Hikâye') },
  wide: { w: 1200, h: 630, label: tr('Geniş') },
};
const SIZE_KEY = 'tessera.shareSize';

// ---------------------------------------------------------------- opening it from anywhere
export interface ShareInit { scope: Scope; year?: number; month?: number; genre?: string | null; gameId?: string }
// the last choice stays after closing, so the window can play its exit with it
let snap: { open: boolean; init: (ShareInit & { n: number }) | null } = { open: false, init: null };
let opened = 0;
const subs = new Set<() => void>();
const ping = () => subs.forEach((f) => f());
export function openShare(init: ShareInit) { snap = { open: true, init: { ...init, n: ++opened } }; ping(); }
const closeShare = () => { snap = { open: false, init: snap.init }; ping(); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

export function ShareHost() {
  const { open, init } = useSyncExternalStore(subscribe, () => snap);
  return (
    <Modal open={open} onClose={closeShare} label={tr('Özet kartı')} title={tr('Özet kartı')} size="xl" className="share-modal">
      {init && <ShareBody key={init.n} init={init} />}
    </Modal>
  );
}

// ---------------------------------------------------------------- pictures
const pictures = new Map<string, Promise<HTMLImageElement | null>>();
/** an image the canvas may hand back; on the desktop the backend fetches it */
function picture(url: string | null | undefined): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  let p = pictures.get(url);
  if (!p) {
    p = (async () => {
      let src = url;
      if (isDesktop && url.startsWith('https://')) {
        try { src = await api.imageData(url); } catch { return null; }
      }
      const img = await new Promise<HTMLImageElement | null>((res) => {
        const i = new Image();
        if (!src.startsWith('data:')) i.crossOrigin = 'anonymous';
        i.onload = () => res(i);
        i.onerror = () => res(null);
        i.src = src;
      });
      if (!img) return null;
      // a picture that would lock the canvas is left out
      try {
        const t = document.createElement('canvas');
        t.width = t.height = 1;
        const x = t.getContext('2d')!;
        x.drawImage(img, 0, 0, 1, 1);
        x.getImageData(0, 0, 1, 1);
      } catch { return null; }
      return img;
    })();
    pictures.set(url, p);
  }
  return p;
}

// ---------------------------------------------------------------- drawing
interface Pen { c: CanvasRenderingContext2D; W: number; H: number; family: string; accent: string }
const WHITE = (a: number) => `rgba(255, 255, 255, ${a})`;
const font = (pen: Pen, px: number, weight = 600) => `${weight} ${px}px ${pen.family}`;

function fit(c: CanvasRenderingContext2D, text: string, max: number) {
  if (c.measureText(text).width <= max) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (c.measureText(text.slice(0, mid) + '…').width <= max) lo = mid; else hi = mid - 1; }
  return text.slice(0, lo).trimEnd() + '…';
}
function wrap(c: CanvasRenderingContext2D, text: string, max: number, lines: number) {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let line = '';
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i];
    if (c.measureText(next).width <= max || !line) { line = next; continue; }
    out.push(line);
    line = words[i];
    if (out.length === lines - 1) { line = words.slice(i).join(' '); break; }
  }
  if (line) out.push(line);
  return out.slice(0, lines).map((l, i, a) => (i === a.length - 1 ? fit(c, l, max) : l));
}
function spaced(c: CanvasRenderingContext2D, px: number) {
  (c as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${px}px`;
}

/** a picture filling a rounded box, cropped to fit; a soft tile with the name when there is none */
function box(pen: Pen, img: HTMLImageElement | null, x: number, y: number, w: number, h: number, r: number, name = '') {
  const { c } = pen;
  c.save();
  c.beginPath();
  c.roundRect(x, y, w, h, r);
  c.clip();
  if (img) {
    const s = Math.max(w / img.width, h / img.height);
    const iw = img.width * s, ih = img.height * s;
    c.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
  } else {
    const g = c.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, WHITE(0.14));
    g.addColorStop(1, WHITE(0.05));
    c.fillStyle = g;
    c.fillRect(x, y, w, h);
    if (name) {
      c.fillStyle = WHITE(0.75);
      c.font = font(pen, Math.max(14, Math.round(w / 8)), 700);
      c.textAlign = 'center';
      const lines = wrap(c, name, w - 20, 4);
      const lh = Math.round(w / 8) + 6;
      lines.forEach((l, i) => c.fillText(l, x + w / 2, y + h / 2 - ((lines.length - 1) * lh) / 2 + i * lh));
      c.textAlign = 'left';
    }
  }
  c.restore();
  c.strokeStyle = WHITE(0.12);
  c.lineWidth = 2;
  c.beginPath();
  c.roundRect(x + 1, y + 1, w - 2, h - 2, r);
  c.stroke();
}

function backdrop(pen: Pen, art: HTMLImageElement | null) {
  const { c, W, H } = pen;
  c.fillStyle = '#0c0d11';
  c.fillRect(0, 0, W, H);
  if (art) {
    c.save();
    c.filter = 'blur(46px) saturate(1.3)';
    const s = Math.max((W + 200) / art.width, (H + 200) / art.height);
    c.drawImage(art, (W - art.width * s) / 2, (H - art.height * s) / 2, art.width * s, art.height * s);
    c.restore();
  }
  const shade = c.createLinearGradient(0, 0, 0, H);
  shade.addColorStop(0, 'rgba(9, 10, 13, 0.5)');
  shade.addColorStop(0.55, 'rgba(9, 10, 13, 0.78)');
  shade.addColorStop(1, 'rgba(9, 10, 13, 0.92)');
  c.fillStyle = shade;
  c.fillRect(0, 0, W, H);
  c.save();
  c.globalAlpha = 0.3;
  const glow = c.createRadialGradient(W * 0.9, H * 0.04, 0, W * 0.9, H * 0.04, Math.max(W, H) * 0.7);
  glow.addColorStop(0, pen.accent);
  glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  c.fillStyle = glow;
  c.fillRect(0, 0, W, H);
  c.restore();
}

/** the four tiles and the name */
function signature(pen: Pen, x: number, baseline: number, px: number, right = false) {
  const { c } = pen;
  c.font = font(pen, px, 700);
  spaced(c, 0);
  const word = 'Tessera';
  const m = px * 1.15, gap = px * 0.42;
  const total = m + gap + c.measureText(word).width;
  const left = right ? x - total : x;
  const top = baseline - px * 0.86;
  const u = m / 24;
  const tiles: [number, number, string][] = [[2, 2, WHITE(0.92)], [13, 2, pen.accent], [2, 13, WHITE(0.55)], [13, 13, WHITE(0.28)]];
  for (const [tx, ty, col] of tiles) { c.fillStyle = col; c.beginPath(); c.roundRect(left + tx * u, top + ty * u, 9 * u, 9 * u, 2.4 * u); c.fill(); }
  c.fillStyle = WHITE(0.9);
  c.fillText(word, left + m + gap, baseline);
}

function stats(pen: Pen, list: CardData['stats'], x: number, y: number, w: number, cols: number, px: number) {
  const { c } = pen;
  const cw = w / cols;
  list.forEach((s, i) => {
    const cx = x + (i % cols) * cw, cy = y + Math.floor(i / cols) * (px * 2.6);
    c.font = font(pen, Math.round(px * 0.52), 600);
    c.fillStyle = WHITE(0.55);
    c.fillText(fit(c, s.label, cw - 20), cx, cy);
    c.font = font(pen, px, 750);
    c.fillStyle = WHITE(0.96);
    c.fillText(fit(c, s.value, cw - 20), cx, cy + px * 1.15);
  });
}

function cols(pen: Pen, items: CardData['bars'] & object, x: number, y: number, w: number, h: number) {
  const { c } = pen;
  const list = items.items;
  const n = list.length;
  const gap = n > 20 ? 6 : 14;
  const bw = (w - gap * (n - 1)) / n;
  const max = Math.max(...list.map((b) => b.value), 1);
  const lab = 30;
  list.forEach((b, i) => {
    const bh = Math.max(6, (b.value / max) * (h - lab));
    const bx = x + i * (bw + gap);
    c.fillStyle = b.peak ? pen.accent : WHITE(b.value ? 0.26 : 0.08);
    c.beginPath();
    c.roundRect(bx, y + h - lab - bh, bw, bh, Math.min(8, bw / 2));
    c.fill();
    if (b.label) {
      c.font = font(pen, 19, 600);
      c.fillStyle = WHITE(b.peak ? 0.9 : 0.5);
      c.textAlign = 'center';
      c.fillText(b.label, bx + bw / 2, y + h - 4);
      c.textAlign = 'left';
    }
  });
}

function rows(pen: Pen, items: CardData['bars'] & object, x: number, y: number, w: number, rowH: number, px: number) {
  const { c } = pen;
  const max = items.items[0]?.value || 1;
  items.items.forEach((b, i) => {
    const ry = y + i * rowH;
    c.font = font(pen, px, 650);
    c.fillStyle = WHITE(0.94);
    c.fillText(fit(c, b.label, w * 0.72), x, ry + px);
    c.font = font(pen, Math.round(px * 0.9), 700);
    c.fillStyle = WHITE(0.7);
    c.textAlign = 'right';
    c.fillText(b.text, x + w, ry + px);
    c.textAlign = 'left';
    const by = ry + px + 14;
    c.fillStyle = WHITE(0.1);
    c.beginPath(); c.roundRect(x, by, w, 10, 5); c.fill();
    c.fillStyle = b.peak ? pen.accent : WHITE(0.55);
    c.beginPath(); c.roundRect(x, by, Math.max(10, (w * b.value) / max), 10, 5); c.fill();
  });
}

/** kicker, an optional title, the big number and the line under it; returns where it ended */
function heading(pen: Pen, card: CardData, x: number, y: number, w: number, k: { kicker: number; title: number; big: number; sub: number }) {
  const { c } = pen;
  c.textBaseline = 'alphabetic';
  c.font = font(pen, k.kicker, 750);
  spaced(c, k.kicker * 0.14);
  c.fillStyle = pen.accent;
  y += k.kicker;
  c.fillText(fit(c, card.kicker.toLocaleUpperCase(locale), w), x, y);
  spaced(c, 0);
  if (card.title) {
    c.font = font(pen, k.title, 800);
    c.fillStyle = WHITE(0.98);
    for (const l of wrap(c, card.title, w, 2)) { y += k.title * 1.1; c.fillText(l, x, y); }
    y += k.title * 0.25;
  }
  c.font = font(pen, k.big, 800);
  spaced(c, -k.big * 0.02);
  c.fillStyle = WHITE(1);
  y += k.big * (card.title ? 1.02 : 1.08);
  c.fillText(fit(c, card.headline, w), x, y);
  spaced(c, 0);
  if (card.sub) {
    c.font = font(pen, k.sub, 500);
    c.fillStyle = WHITE(0.68);
    y += k.sub * 1.6;
    c.fillText(fit(c, card.sub, w), x, y);
  }
  return y;
}

function coverRow(pen: Pen, games: CardData['games'], imgs: (HTMLImageElement | null)[], x: number, y: number, slot: number, gap: number, px: number) {
  const { c } = pen;
  const h = slot * 1.5;
  games.forEach((g, i) => {
    const gx = x + i * (slot + gap);
    box(pen, imgs[i], gx, y, slot, h, 14, g.title);
    c.font = font(pen, px, 750);
    c.fillStyle = WHITE(0.96);
    c.fillText(fit(c, g.value, slot), gx, y + h + px * 1.5);
    c.font = font(pen, Math.round(px * 0.78), 550);
    c.fillStyle = WHITE(0.58);
    c.fillText(fit(c, g.title, slot), gx, y + h + px * 2.75);
  });
  return y + h + px * 2.75;
}

function listRows(pen: Pen, games: CardData['games'], imgs: (HTMLImageElement | null)[], x: number, y: number, w: number, rowH: number) {
  const { c } = pen;
  const cw = rowH / 1.5;
  const max = games[0]?.share || 1;
  games.forEach((g, i) => {
    const ry = y + i * (rowH + 22);
    box(pen, imgs[i], x, ry, cw, rowH, 12, g.title);
    const tx = x + cw + 30, tw = w - cw - 30;
    c.font = font(pen, 34, 800);
    c.fillStyle = pen.accent;
    c.fillText(String(i + 1), tx, ry + 44);
    c.font = font(pen, 36, 700);
    c.fillStyle = WHITE(0.96);
    c.fillText(fit(c, g.title, tw - 52), tx + 46, ry + 44);
    c.font = font(pen, 28, 600);
    c.fillStyle = WHITE(0.62);
    c.fillText(g.value, tx, ry + 88);
    c.fillStyle = WHITE(0.1);
    c.beginPath(); c.roundRect(tx, ry + rowH - 16, tw, 8, 4); c.fill();
    c.fillStyle = i === 0 ? pen.accent : WHITE(0.5);
    c.beginPath(); c.roundRect(tx, ry + rowH - 16, Math.max(8, (tw * g.share) / max), 8, 4); c.fill();
  });
  return y + games.length * (rowH + 22) - 22;
}

function paint(pen: Pen, card: CardData, size: Size, art: HTMLImageElement | null, cover: HTMLImageElement | null, imgs: (HTMLImageElement | null)[]) {
  const { W, H } = pen;
  backdrop(pen, art);
  if (size === 'square') {
    const P = 88;
    const coverW = card.cover !== undefined ? 300 : 0;
    if (coverW) box(pen, cover, W - P - coverW, P, coverW, coverW * 1.5, 18, card.title);
    let y = heading(pen, card, P, P, W - 2 * P - (coverW ? coverW + 44 : 0), { kicker: 28, title: 64, big: card.title ? 96 : 150, sub: 30 });
    const statsTop = H - P - 76 - 96;
    const games = card.games.slice(0, 5);
    if (card.bars?.kind === 'rows') {
      rows(pen, card.bars, P, y + 56, W - 2 * P, 58, 28);
    } else if (games.length) {
      const gap = 22, slot = (W - 2 * P - gap * 4) / 5;
      const end = coverRow(pen, games, imgs, P, y + 52, slot, gap, 27);
      // the months or days fit under the covers when there is room
      const room = statsTop - 64 - (end + 48);
      if (card.bars?.kind === 'cols' && room >= 80) cols(pen, card.bars, P, end + 48, W - 2 * P, Math.min(room, 150));
    } else if (card.bars) {
      y = Math.max(y + 60, coverW ? P + coverW * 1.5 + 40 : 0);
      cols(pen, card.bars, P, y, W - 2 * P, Math.max(120, statsTop - y - 60));
    }
    stats(pen, card.stats.slice(0, 4), P, statsTop, W - 2 * P, Math.min(4, Math.max(1, card.stats.length)), 40);
    signature(pen, P, H - P + 6, 30);
  } else if (size === 'story') {
    const P = 96;
    let y = P;
    if (card.cover !== undefined) {
      const cw = 420;
      box(pen, cover, (W - cw) / 2, y + 20, cw, cw * 1.5, 22, card.title);
      y += 20 + cw * 1.5 + 30;
    }
    y = heading(pen, card, P, y, W - 2 * P, { kicker: 32, title: 80, big: card.title ? 140 : 200, sub: 36 });
    const footer = H - P;
    const statsH = card.stats.length > 2 ? 210 : 105;
    const statsTop = footer - 80 - statsH + 40;
    const rowsBars = card.bars?.kind === 'rows';
    const n = Math.min(card.games.length, rowsBars ? 3 : 5);
    y += 70;
    if (n) y = listRows(pen, card.games.slice(0, n), imgs, P, y, W - 2 * P, 120) + 60;
    if (card.bars) {
      if (rowsBars) {
        const items = { ...card.bars, items: card.bars.items.slice(0, Math.max(0, Math.floor((statsTop - 60 - y) / 70))) };
        if (items.items.length) rows(pen, items, P, y, W - 2 * P, 70, 32);
      } else if (statsTop - 60 - y >= 160) {
        cols(pen, card.bars, P, y, W - 2 * P, Math.min(260, statsTop - 60 - y));
      }
    }
    stats(pen, card.stats.slice(0, 4), P, statsTop, W - 2 * P, 2, 44);
    signature(pen, P, footer + 8, 32);
  } else {
    const P = 64;
    const right = 486;
    const leftW = W - 2 * P - right - 48;
    const end = heading(pen, card, P, P - 4, leftW, { kicker: 22, title: 50, big: card.title ? 72 : 108, sub: 24 });
    const statsTop = H - P - 46;
    const room = statsTop - 58 - (end + 40);
    if (card.bars?.kind === 'cols' && room >= 70) cols(pen, card.bars, P, end + 40, leftW, Math.min(room, 130));
    stats(pen, card.stats.slice(0, 3), P, statsTop, leftW, Math.min(3, Math.max(1, card.stats.length)), 32);
    const rx = W - P - right;
    if (card.cover !== undefined) {
      box(pen, cover, W - P - 250, P, 250, 375, 16, card.title);
    } else if (card.bars?.kind === 'rows') {
      rows(pen, { ...card.bars, items: card.bars.items.slice(0, 6) }, rx, P + 6, right, 66, 24);
    } else if (card.games.length) {
      const games = card.games.slice(0, 3);
      const gap = 18, slot = (right - gap * 2) / 3;
      coverRow(pen, games, imgs, rx + (3 - games.length) * (slot + gap), P, slot, gap, 22);
    }
    signature(pen, W - P, H - P + 4, 24, true);
  }
}

async function draw(canvas: HTMLCanvasElement, card: CardData, size: Size, alive: () => boolean) {
  const { w, h } = SIZES[size];
  const [art, cover, ...imgs] = await Promise.all([picture(card.art), picture(card.cover), ...card.games.slice(0, 5).map((g) => picture(g.cover))]);
  if (!alive()) return;
  if (document.fonts?.ready) await document.fonts.ready;
  if (!alive()) return;
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext('2d')!;
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue('--accent').trim() || '#a9bdd1';
  const family = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif';
  paint({ c, W: w, H: h, family, accent }, card, size, art, cover, imgs);
}

// ---------------------------------------------------------------- the window
function loadSize(): Size {
  try { const v = localStorage.getItem(SIZE_KEY); if (v === 'square' || v === 'story' || v === 'wide') return v; } catch { /* no storage */ }
  return 'square';
}

function ShareBody({ init }: { init: ShareInit }) {
  const { games, notify } = useStore();
  const per = useMemo(() => periods(games), [games]);
  const genres = useMemo(() => genreTotals(games).filter((x) => x.min > 0), [games]);
  const game = init.gameId ? games.find((g) => g.id === init.gameId) : undefined;
  const now = new Date();
  const [scope, setScope] = useState<Scope>(init.scope);
  const [year, setYear] = useState(init.year ?? per.years[0] ?? now.getFullYear());
  const [ym, setYm] = useState(
    init.month != null ? `${init.year ?? now.getFullYear()}-${init.month}` : per.months[0] ? `${per.months[0][0]}-${per.months[0][1]}` : `${now.getFullYear()}-${now.getMonth()}`,
  );
  const [genre, setGenre] = useState(init.genre ?? '');
  const [size, setSizeState] = useState<Size>(loadSize);
  const setSize = (s: Size) => { setSizeState(s); try { localStorage.setItem(SIZE_KEY, s); } catch { /* no storage */ } };
  const [busy, setBusy] = useState(true);

  const card = useMemo(() => {
    if (scope === 'game' && game) return gameCard(game);
    if (scope === 'month') { const [y, m] = ym.split('-').map(Number); return monthCard(games, y, m); }
    if (scope === 'genre') return genre ? genreCard(games, genre) : genresCard(games);
    return yearCard(games, year);
  }, [scope, game, ym, genre, year, games]);

  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let live = true;
    setBusy(true);
    draw(canvas.current!, card, size, () => live).then(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [card, size]);

  const name = () => {
    const part = scope === 'game' && game ? game.title : scope === 'month' ? ym : scope === 'genre' ? genre || tr('türler') : String(year);
    return `tessera-${part}`.toLocaleLowerCase(locale).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/-+$/, '') + '.png';
  };
  const blob = () => new Promise<Blob | null>((res) => canvas.current!.toBlob(res, 'image/png'));

  const copyImage = async () => {
    try {
      const b = await blob();
      if (!b) throw new Error();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]);
      notify(tr('Kart panoya kopyalandı'));
    } catch { notify(tr('Resim kopyalanamadı; kaydedip paylaşabilirsin.')); }
  };
  const saveImage = async () => {
    try {
      if (isDesktop) {
        const path = await saveDialog({ defaultPath: name(), filters: [{ name: 'PNG', extensions: ['png'] }] });
        if (!path) return;
        await api.savePng(path, canvas.current!.toDataURL('image/png'));
      } else {
        const a = document.createElement('a');
        a.href = canvas.current!.toDataURL('image/png');
        a.download = name();
        a.click();
      }
      notify(tr('Kart kaydedildi'));
    } catch (e) { notify(String(e)); }
  };
  const copyText = async () => {
    try { await navigator.clipboard.writeText(`${card.text} — Tessera`); notify(tr('Metin kopyalandı')); } catch (e) { notify(String(e)); }
  };

  const scopes: { id: Scope; label: string }[] = [
    { id: 'year', label: tr('Yıl') },
    { id: 'month', label: tr('Ay') },
    { id: 'genre', label: tr('Tür') },
    ...(game ? [{ id: 'game' as Scope, label: tr('Oyun') }] : []),
  ];
  const years = per.years.length ? per.years : [year];
  const months = per.months.length ? per.months : [[now.getFullYear(), now.getMonth()] as [number, number]];

  return (
    <div className="share">
      <div className="share-stage" data-size={size}>
        <canvas ref={canvas} className={`share-canvas ${busy ? 'is-busy' : ''}`} aria-label={card.text} role="img" />
        {card.empty && !busy && <p className="share-empty">{tr('Bu seçim için kayıtlı oynama yok.')}</p>}
      </div>
      <div className="share-side">
        <div className="share-group">
          <span className="share-label">{tr('Özet')}</span>
          <div className="sc-chips">
            {scopes.map((s) => <button key={s.id} aria-pressed={scope === s.id} onClick={() => setScope(s.id)}>{s.label}</button>)}
          </div>
        </div>
        {scope === 'year' && (
          <label className="share-group">
            <span className="share-label">{tr('Yıl')}</span>
            <span className="field"><select value={year} onChange={(e) => setYear(Number(e.target.value))}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select></span>
          </label>
        )}
        {scope === 'month' && (
          <label className="share-group">
            <span className="share-label">{tr('Ay')}</span>
            <span className="field"><select value={ym} onChange={(e) => setYm(e.target.value)}>{months.map(([y, m]) => <option key={`${y}-${m}`} value={`${y}-${m}`}>{monthLong(m)} {y}</option>)}</select></span>
          </label>
        )}
        {scope === 'genre' && (
          <label className="share-group">
            <span className="share-label">{tr('Tür')}</span>
            <span className="field"><select value={genre} onChange={(e) => setGenre(e.target.value)}>
              <option value="">{tr('Hepsi yan yana')}</option>
              {genres.map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}
            </select></span>
          </label>
        )}
        <div className="share-group">
          <span className="share-label">{tr('Boyut')}</span>
          <div className="sc-chips">
            {(Object.keys(SIZES) as Size[]).map((s) => <button key={s} aria-pressed={size === s} onClick={() => setSize(s)}>{SIZES[s].label}</button>)}
          </div>
        </div>
        <div className="share-acts">
          <button className="btn btn-accent" disabled={busy} onClick={copyImage}><Copy size={15} strokeWidth={1.8} /> {tr('Resmi kopyala')}</button>
          <button className="btn" disabled={busy} onClick={saveImage}><Download size={15} strokeWidth={1.8} /> {tr('PNG kaydet')}</button>
          <button className="btn btn-ghost" onClick={copyText}><Type size={15} strokeWidth={1.8} /> {tr('Metni kopyala')}</button>
        </div>
      </div>
    </div>
  );
}
