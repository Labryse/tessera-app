// Pick another cover, banner or logo for a game from SteamGridDB.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, RotateCcw } from 'lucide-react';
import { useStore } from '../store';
import { api } from '../lib/backend';
import type { Game } from '../data/library';
import { Modal } from './Modal';

import { t as tr } from '../lib/i18n';
type Kind = 'grid' | 'hero' | 'logo';
const TABS: { id: Kind; label: string; field: 'cover' | 'hero' | 'logo' }[] = [
  { id: 'grid', label: tr('Kapak'), field: 'cover' },
  { id: 'hero', label: tr('Banner'), field: 'hero' },
  { id: 'logo', label: tr('Logo'), field: 'logo' },
];

export function ArtPicker({ g, open, onClose }: { g: Game; open: boolean; onClose: () => void }) {
  const { update, notify, openSettings, refresh } = useStore();
  const [kind, setKind] = useState<Kind>('grid');
  const [list, setList] = useState<{ url: string; thumb: string; author: string }[] | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'nokey' | string>('idle');

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setList(null);
    setState('loading');
    (async () => {
      if (!(await api.sgdbStatus())) { if (alive) setState('nokey'); return; }
      try {
        const r = await api.sgdbImages(g.id, kind);
        if (alive) { setList(r); setState('idle'); }
      } catch (err) { if (alive) setState(String(err)); }
    })();
    return () => { alive = false; };
  }, [open, kind, g.id]);

  const tab = TABS.find((t) => t.id === kind)!;
  const current = g.art?.[tab.field];
  const choose = (url: string | null) => {
    update(g.id, (x) => {
      const art = { ...(x.art ?? {}) };
      if (url) art[tab.field] = url; else delete art[tab.field];
      return { art, [tab.field]: url ?? undefined } as Partial<Game>;
    });
    notify(url ? tr('{0} değiştirildi', tab.label) : tr('{0} varsayılana döndü', tab.label));
    // the store's own picture comes back from the database
    if (!url) window.setTimeout(() => refresh().catch(() => {}), 400);
  };

  return createPortal(
    <Modal open={open} onClose={onClose} label={tr('Görselleri değiştir')} title={tr('Görselleri değiştir')} size="xl" className="art-picker">
      <div className="art-top">
        <div className="segmented segmented-text" role="group" aria-label={tr('Görsel türü')}>
          {TABS.map((t) => <button key={t.id} aria-pressed={kind === t.id} onClick={() => setKind(t.id)}>{t.label}</button>)}
        </div>
        {current && <button className="btn btn-sm btn-ghost" onClick={() => choose(null)}><RotateCcw size={14} strokeWidth={1.8} /> {tr('Varsayılana dön')}</button>}
      </div>
      {state === 'nokey' && (
        <div className="empty">
          <p>{tr('Görsel seçmek için ücretsiz bir SteamGridDB anahtarı gerekiyor.')}</p>
          <button className="btn" onClick={() => { onClose(); openSettings('accounts'); }}>{tr('Hesaplar’da ekle')}</button>
        </div>
      )}
      {state === 'loading' && <p className="muted">{tr('Görseller getiriliyor…')}</p>}
      {state !== 'idle' && state !== 'loading' && state !== 'nokey' && <p className="warn small">{state}</p>}
      {list && list.length === 0 && <p className="muted">{tr('Bu oyun için')} {tab.label.toLowerCase()} {tr('bulunamadı.')}</p>}
      {list && list.length > 0 && (
        <div className={`art-grid is-${kind}`}>
          {list.map((a) => {
            const on = current === a.url;
            return (
              <button key={a.url} className={`art-item ${on ? 'is-on' : ''}`} onClick={() => choose(a.url)} title={a.author ? `${a.author}` : undefined}>
                <img src={a.thumb} alt="" loading="lazy" />
                {on && <span className="cand-check"><Check size={14} strokeWidth={2.4} /></span>}
              </button>
            );
          })}
        </div>
      )}
    </Modal>,
    document.body,
  );
}
