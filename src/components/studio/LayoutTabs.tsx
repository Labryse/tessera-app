// The studio's layout tabs. "Yerleşim": ready-made layouts, where the menu sits, the game
// list column, the page, the covers and the game page. "Özellikler": every part that can
// be hidden, the order of the menu, and lines of text renamed by pointing at them.
import { useState } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, SquareDashed, Trash2 } from 'lucide-react';
import { cleanLayout, FEATURES, MENU, PRESETS, SECTIONS, type LayoutSet } from '../../lib/layout';
import { GROUPS, type GroupId } from '../../lib/filters';
import { Flip, Group, Seg, Slider, type Ctx } from './controls';
import { pick } from './pickElement';
import { t } from '../../lib/i18n';

/** a small drawing of where the menu, the list and the page sit */
function Sketch({ ly }: { ly: LayoutSet }) {
  const { nav, list } = cleanLayout(ly);
  return (
    <span className="sd-sketch" data-nav={nav} data-list={list}>
      <i className="is-nav" />
      {list !== 'off' && <i className="is-list" />}
      <i className="is-main" />
    </span>
  );
}

export function LayoutTab({ d, change, part }: Ctx) {
  const ly = d.layout ?? {};
  const set = (patch: Partial<LayoutSet>) => part('layout', patch);
  const { nav, list } = cleanLayout(ly);
  const same = (p: LayoutSet) => JSON.stringify({ ...p, texts: undefined }) === JSON.stringify({ ...ly, texts: undefined });
  return (
    <>
      <Group title={t('Hazır yerleşimler')}>
        <div className="sd-presets">
          {PRESETS.map((p) => (
            <button key={p.id} className={`sd-preset ${same(p.layout) ? 'is-on' : ''}`}
              onClick={() => change((x) => ({ ...x, layout: { ...structuredClone(p.layout), texts: x.layout?.texts } }))}>
              <Sketch ly={p.layout} />
              <span>{p.label}</span>
            </button>
          ))}
        </div>
      </Group>

      <Group title={t('Menü')} onReset={() => set({ nav: undefined, sidebar: undefined, navItem: undefined, navIcons: undefined })}>
        <Seg label={t('Yeri')} value={nav} onChange={(v) => set({ nav: v })}
          options={[{ id: 'left', label: t('Solda') }, { id: 'right', label: t('Sağda') }, { id: 'top', label: t('Üstte') }, { id: 'rail', label: t('Şerit') }]} />
        {(nav === 'left' || nav === 'right') && (
          <Slider label={t('Genişlik')} value={ly.sidebar ?? 236} min={160} max={360} unit="px" onChange={(v) => set({ sidebar: v })} />
        )}
        <Slider label={t('Satır yüksekliği')} value={ly.navItem ?? 32} min={24} max={56} unit="px" onChange={(v) => set({ navItem: v })} />
        {nav !== 'rail' && <Flip label={t('Simgeler')} on={nav === 'top' ? ly.navIcons === true : ly.navIcons !== false} onChange={(v) => set({ navIcons: v === (nav !== 'top') ? undefined : v })} />}
      </Group>

      <Group title={t('Oyun listesi')} onReset={() => set({ list: undefined, listWidth: undefined, listRow: undefined, listArt: undefined, listGroup: undefined })}>
        <Seg label={t('Yeri')} value={list} onChange={(v) => set({ list: v })}
          options={[{ id: 'off', label: t('Yok') }, { id: 'left', label: t('Solda') }, { id: 'right', label: t('Sağda') }]} />
        {list !== 'off' && (
          <>
            <Slider label={t('Genişlik')} value={ly.listWidth ?? 280} min={180} max={480} unit="px" onChange={(v) => set({ listWidth: v })} />
            <Slider label={t('Satır yüksekliği')} value={ly.listRow ?? 32} min={22} max={64} unit="px" onChange={(v) => set({ listRow: v })} />
            <Seg label={t('Satırdaki görsel')} value={ly.listArt ?? 'cover'} onChange={(v) => set({ listArt: v })}
              options={[{ id: 'cover', label: t('Kapak') }, { id: 'header', label: t('Afiş') }, { id: 'none', label: t('Yok') }]} />
            <label className="sd-field">
              <span className="sd-seg-label">{t('Grupla')}</span>
              <select className="sd-input" value={ly.listGroup ?? 'none'} onChange={(e) => set({ listGroup: e.target.value as GroupId })}>
                {GROUPS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
              </select>
            </label>
          </>
        )}
      </Group>

      <Group title={t('Sayfa')} onReset={() => set({ sheet: undefined, pageWidth: undefined })}>
        <Seg label={t('Biçim')} value={ly.sheet ?? 'card'} onChange={(v) => set({ sheet: v })}
          options={[{ id: 'card', label: t('Kart') }, { id: 'flat', label: t('Pencereye yaslı') }]} />
        <Slider label={t('En fazla genişlik')} value={ly.pageWidth || 2600} min={720} max={2600} step={20} unit={ly.pageWidth ? 'px' : ''}
          onChange={(v) => set({ pageWidth: v >= 2600 ? undefined : v })} />
      </Group>

      <Group title={t('Kapaklar')} onReset={() => set({ view: undefined, shape: undefined, cover: undefined, tileGap: undefined, titles: undefined, play: undefined })}>
        <Seg label={t('Kütüphane açılınca')} value={ly.view ?? 'grid'} onChange={(v) => set({ view: v })}
          options={[{ id: 'grid', label: t('Kapaklar') }, { id: 'list', label: t('Tablo') }]} />
        <Seg label={t('Şekil')} value={ly.shape ?? 'portrait'} onChange={(v) => set({ shape: v })}
          options={[{ id: 'portrait', label: t('Dikey') }, { id: 'landscape', label: t('Yatay') }, { id: 'square', label: t('Kare') }]} />
        <Slider label={t('Kapak boyutu')} value={ly.cover ?? 156} min={80} max={420} unit="px" onChange={(v) => set({ cover: v })} />
        <Slider label={t('Aralık')} value={ly.tileGap ?? 20} min={0} max={48} unit="px" onChange={(v) => set({ tileGap: v })} />
        <Seg label={t('Oyun adı')} value={ly.titles ?? 'show'} onChange={(v) => set({ titles: v })}
          options={[{ id: 'show', label: t('Altında') }, { id: 'over', label: t('Üstüne gelince') }, { id: 'hide', label: t('Gizli') }]} />
        <Flip label={t('Oyna butonu')} on={ly.play !== false} onChange={(v) => set({ play: v ? undefined : false })} />
      </Group>

      <Group title={t('Oyun sayfası')} onReset={() => set({ hero: undefined })}>
        <Slider label={t('Üstteki görselin yüksekliği')} value={ly.hero ?? 340} min={60} max={640} step={10} unit="px" onChange={(v) => set({ hero: v })} />
      </Group>
    </>
  );
}

/** a list in an order of its own, each entry movable (and hideable when given) */
function Order({ items, order, hidden, onOrder, onHide }: {
  items: { id: string; label: string }[]; order?: string[]; hidden?: Set<string>;
  onOrder: (o: string[]) => void; onHide?: (id: string) => void;
}) {
  const ids = [...(order ?? []).filter((id) => items.some((i) => i.id === id)), ...items.map((i) => i.id).filter((id) => !(order ?? []).includes(id))];
  const move = (i: number, by: number) => {
    const next = [...ids];
    const [x] = next.splice(i, 1);
    next.splice(i + by, 0, x);
    onOrder(next);
  };
  return (
    <ol className="sd-order">
      {ids.map((id, i) => {
        const off = hidden?.has(id);
        return (
          <li key={id} className={off ? 'is-off' : ''}>
            <span>{items.find((x) => x.id === id)?.label}</span>
            {onHide && (
              <button className="sd-mini" onClick={() => onHide(id)} aria-pressed={!off} title={off ? t('Göster') : t('Gizle')} aria-label={off ? t('Göster') : t('Gizle')}>
                {off ? <EyeOff size={13} strokeWidth={1.8} /> : <Eye size={13} strokeWidth={1.8} />}
              </button>
            )}
            <button className="sd-mini" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t('Yukarı')}><ArrowUp size={13} strokeWidth={1.8} /></button>
            <button className="sd-mini" disabled={i === ids.length - 1} onClick={() => move(i, 1)} aria-label={t('Aşağı')}><ArrowDown size={13} strokeWidth={1.8} /></button>
          </li>
        );
      })}
    </ol>
  );
}

/** the text a pointed-at part shows itself (not its children's) */
function ownText(el: Element): string {
  for (let n: Element | null = el, k = 0; n && k < 3; n = n.parentElement, k++) {
    const own = [...n.childNodes].filter((c) => c.nodeType === Node.TEXT_NODE).map((c) => c.textContent ?? '').join('').trim();
    if (own) return own.slice(0, 200);
    const all = (n.textContent ?? '').trim();
    if (all && all.length <= 60) return all;
  }
  return '';
}

export function FeaturesTab({ d, part, dock }: Ctx) {
  const ly = d.layout ?? {};
  const hidden = new Set(ly.hide ?? []);
  const flip = (id: string) => {
    const n = new Set(hidden);
    if (n.has(id)) n.delete(id); else n.add(id);
    part('layout', { hide: n.size ? [...n] : undefined });
  };
  const texts = ly.texts ?? {};
  const setTexts = (m: Record<string, string>) => part('layout', { texts: Object.keys(m).length ? m : undefined });
  const [picking, setPicking] = useState(false);
  const [missed, setMissed] = useState(false);
  const pickText = async () => {
    setPicking(true); setMissed(false);
    const el = await pick(dock.current);
    setPicking(false);
    if (!el) return;
    const s = ownText(el);
    if (!s) { setMissed(true); return; }
    // a line already renamed is found by its new text too
    const from = Object.keys(texts).find((k) => texts[k] === s) ?? s;
    setTexts({ ...texts, [from]: texts[from] ?? s });
  };
  return (
    <>
      <Group title={t('Ana menü')} onReset={() => part('layout', { order: undefined, hide: (ly.hide ?? []).filter((id) => !MENU.some((m) => m.id === id)) })}>
        <Order items={MENU} order={ly.order} hidden={hidden} onOrder={(o) => part('layout', { order: o })} onHide={flip} />
      </Group>
      <Group title={t('Menünün bölümleri')} onReset={() => part('layout', { sections: undefined })}>
        <Order items={SECTIONS} order={ly.sections} onOrder={(o) => part('layout', { sections: o })} />
      </Group>
      {FEATURES.map((g) => (
        <Group key={g.title} title={g.title}>
          {g.items.map((f) => <Flip key={f.id} label={f.label} on={!hidden.has(f.id)} onChange={() => flip(f.id)} />)}
        </Group>
      ))}
      <Group title={t('Yazılar')} onReset={Object.keys(texts).length ? () => setTexts({}) : undefined}>
        <button className={`sd-pick ${picking ? 'is-on' : ''}`} onClick={pickText} disabled={picking}>
          <SquareDashed size={18} strokeWidth={1.8} />
          <span>{picking ? t('Pencerede bir yazıya tıkla · Esc: vazgeç') : t('Yazı seç')}</span>
        </button>
        {missed && <p className="sd-note">{t('Orada değiştirilecek bir yazı yok.')}</p>}
        {Object.entries(texts).map(([from, to]) => (
          <div key={from} className="sd-text-row">
            <span className="sd-text-from" title={from}>{from}</span>
            <input className="sd-input" value={to} maxLength={120} aria-label={t('“{0}” yerine', from)}
              onChange={(e) => setTexts({ ...texts, [from]: e.target.value })} />
            <button className="sd-mini" onClick={() => { const n = { ...texts }; delete n[from]; setTexts(n); }} aria-label={t('Kaldır')}><Trash2 size={12} strokeWidth={1.8} /></button>
          </div>
        ))}
      </Group>
    </>
  );
}
