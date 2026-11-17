// "Öğe seç": point at any part of the window, see its name, click to style it. The
// selector is the element's own class (states like is-active left out), with the
// parents offered too so a rule can be as narrow or as wide as wanted.
import { t } from '../../lib/i18n';

const NAMES: Record<string, string> = {
  '.sidebar': t('Kenar çubuğu'), '.nav': t('Menü'), '.sheet': t('Sayfa'), '.nav-item': t('Menü öğesi'), '.nav-item.is-active': t('Seçili menü öğesi'),
  '.nav-label': t('Menü yazısı'), '.nav-icon': t('Menü simgesi'), '.nav-count': t('Menü sayısı'), '.brand': t('Logo'),
  '.tile-cover': t('Kapak'), '.tile': t('Oyun kutusu'), '.tile-title': t('Oyun adı'), '.btn': t('Buton'), '.btn-accent': t('Vurgulu buton'),
  '.btn-primary': t('Ana buton'), '.panel': t('Panel'), h1: t('Sayfa başlığı'), h2: t('Başlık'), h3: t('Alt başlık'),
  '.section-title': t('Bölüm başlığı'), '.title-meta': t('Başlık altı'), '.chip': t('Etiket'), '.icon-btn': t('Simge butonu'),
  '.search-trigger': t('Arama'), '.sidebar-foot': t('Kenar çubuğu altı'), '.segmented': t('Seçici'),
  '.toast': t('Bildirim'), '.modal': t('Pencere'), '.wl-art': t('İstek görseli'), '.wl-tag': t('Fiyat etiketi'), '.nw-card': t('Haber kartı'),
  '.sc-title': t('Vitrin başlığı'), '.page': t('Sayfa içi'), '.title-row': t('Başlık satırı'), '.set-group': t('Ayar grubu'),
};
export const nameOf = (sel: string) => NAMES[sel] ?? sel;

const STATE = /^(is|has)-/;
const own = (el: Element) => {
  const cls = [...el.classList].filter((c) => !STATE.test(c) && /^[a-z][a-z0-9-]*$/i.test(c));
  if (cls.length) {
    const state = [...el.classList].find((c) => c === 'is-active' || c === 'is-on');
    return `.${cls[0]}${state ? `.${state}` : ''}`;
  }
  const tag = el.tagName.toLowerCase();
  return ['h1', 'h2', 'h3', 'p', 'img', 'svg'].includes(tag) ? tag : null;
};

/** the element's own classes (the most particular first), then its parents' */
export function candidates(el: Element): string[] {
  const out: string[] = [];
  const state = [...el.classList].find((c) => c === 'is-active' || c === 'is-on');
  const mine = [...el.classList].filter((c) => !STATE.test(c) && /^[a-z][a-z0-9-]*$/i.test(c)).reverse();
  // size words (btn-lg …) say little about what the thing is
  mine.sort((a, b) => Number(/-(xs|sm|md|lg|xl)$/.test(a)) - Number(/-(xs|sm|md|lg|xl)$/.test(b)));
  for (const c of mine.slice(0, 3)) out.push(`.${c}${state ? `.${state}` : ''}`);
  for (let n: Element | null = mine.length ? el.parentElement : el; n && out.length < 8; n = n.parentElement) {
    if (n.id === 'root' || n.classList.contains('app') || n === document.body) break;
    const s = own(n);
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/** starts pointing; resolves with the chosen element, or null when Escape is pressed */
export function pick(ignore: Element | null): Promise<Element | null> {
  return new Promise((done) => {
    const box = document.createElement('div');
    box.className = 'sd-pick-box';
    const tag = document.createElement('span');
    tag.className = 'sd-pick-tag';
    box.appendChild(tag);
    document.body.appendChild(box);
    document.documentElement.classList.add('is-picking');
    let at: Element | null = null;
    const under = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || el === box || box.contains(el) || ignore?.contains(el) || el === document.body || el === document.documentElement) return null;
      return el;
    };
    const move = (e: MouseEvent) => {
      const el = under(e);
      at = el;
      if (!el) { box.style.opacity = '0'; return; }
      const r = el.getBoundingClientRect();
      Object.assign(box.style, { opacity: '1', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
      const c = candidates(el)[0];
      tag.textContent = c ? nameOf(c) : el.tagName.toLowerCase();
    };
    const finish = (el: Element | null) => {
      window.removeEventListener('mousemove', move, true);
      window.removeEventListener('click', click, true);
      window.removeEventListener('mousedown', stop, true);
      window.removeEventListener('keydown', key, true);
      document.documentElement.classList.remove('is-picking');
      box.remove();
      done(el);
    };
    const stop = (e: MouseEvent) => { if (under(e)) { e.preventDefault(); e.stopPropagation(); } };
    const click = (e: MouseEvent) => {
      const el = under(e);
      if (!el) return;
      e.preventDefault(); e.stopPropagation();
      finish(el ?? at);
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); } };
    window.addEventListener('mousemove', move, true);
    window.addEventListener('click', click, true);
    window.addEventListener('mousedown', stop, true);
    window.addEventListener('keydown', key, true);
  });
}
