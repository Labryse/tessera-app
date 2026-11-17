import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, CornerDownLeft, Shuffle, Download, ExternalLink, Heart, Palette, Play, Search, Settings, SquareArrowOutUpRight, SquarePen } from 'lucide-react';
import { useStore, THEMES } from '../store';
import { PLATFORMS, STATUSES, statusLabel, type Game } from '../data/library';
import { Cover } from './bits';
import { Modal } from './Modal';
import { api } from '../lib/backend';

import { t as tr, locale } from '../lib/i18n';
type Cmd = { id: string; label: string; hint?: string; game?: Game; run: () => void; icon?: React.ReactNode };

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { games, go, launch, setTheme, openPicker, openSettings, setAddOpen, setScanOpen, demo } = useStore();
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) { setWasOpen(open); if (open) { setQ(''); setI(0); } }

  const items = useMemo<Cmd[]>(() => {
    const n = q.trim().toLocaleLowerCase(locale);
    const gameCmds: Cmd[] = games
      .filter((g) => !n || g.title.toLocaleLowerCase(locale).includes(n) || g.developer.toLocaleLowerCase(locale).includes(n))
      .slice(0, n ? 8 : 5)
      .map((g) => ({ id: g.id, label: g.title, game: g, hint: `${PLATFORMS[g.platform].short} · ${statusLabel(g.status)}`, run: () => go({ name: 'game', id: g.id }) }));
    const actions: Cmd[] = [
      { id: 'pick', label: tr('Ne oynasam?'), icon: <Shuffle size={16} strokeWidth={1.6} />, run: openPicker },
      { id: 'settings', label: tr('Ayarlar'), icon: <Settings size={16} strokeWidth={1.6} />, run: () => openSettings('appearance') },
      { id: 'accounts', label: tr('Hesap bağla'), icon: <Settings size={16} strokeWidth={1.6} />, run: () => openSettings('accounts') },
      ...(demo ? [] : [
        { id: 'add', label: tr('Oyun ekle'), icon: <SquarePen size={16} strokeWidth={1.6} />, run: () => setAddOpen(true) },
        { id: 'scan', label: tr('Bilgisayarı tara'), icon: <Search size={16} strokeWidth={1.6} />, run: () => setScanOpen(true) },
      ]),
      ...THEMES.map((t) => ({ id: tr('theme-{0}', t.id), label: tr('Tema: {0}', t.name), hint: t.note, icon: <Palette size={16} strokeWidth={1.6} />, run: () => setTheme(t.id) })),
      ...games.filter((g) => g.installed && n && g.title.toLocaleLowerCase(locale).includes(n)).slice(0, 3)
        .map((g) => ({ id: tr('play-{0}', g.id), label: tr('{0} oyna', g.title), icon: <Play size={16} strokeWidth={1.6} />, run: () => launch(g) })),
    ].filter((c) => !n || c.label.toLocaleLowerCase(locale).includes(n));
    return [...gameCmds, ...actions];
  }, [q, games, go, launch, setTheme, openPicker, openSettings, setAddOpen, setScanOpen, demo]);

  const run = (c: Cmd) => { onClose(); c.run(); };

  return (
    <Modal open={open} onClose={onClose} label={tr('Ara veya komut')} placement="top" size="md" bare className="palette2">
      <label className="palette-input">
        <Search size={17} strokeWidth={1.6} />
        <input
          autoFocus
          value={q}
          placeholder={tr('Oyun, geliştirici ya da komut')}
          aria-label={tr('Ara')}
          onChange={(e) => { setQ(e.target.value); setI(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(items.length - 1, x + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
            if (e.key === 'Enter' && items[i]) run(items[i]);
          }}
        />
        <kbd>{tr('Esc')}</kbd>
      </label>
      <ul className="palette-list" role="listbox">
        {items.length === 0 && <li className="palette-empty">“{q}{tr('” için sonuç yok.')}</li>}
        {items.map((c, k) => (
          <li key={c.id} role="option" aria-selected={k === i}>
            <button className={`palette-item ${k === i ? 'is-on' : ''}`} onMouseEnter={() => setI(k)} onClick={() => run(c)}>
              <span className="palette-icon">{c.game ? <Cover game={c.game} /> : c.icon}</span>
              <span className="palette-label">{c.label}</span>
              {c.hint && <span className="palette-hint">{c.hint}</span>}
              {k === i && <CornerDownLeft size={14} strokeWidth={1.6} className="palette-enter" />}
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

/** right-click on a game: the things you'd want, nothing from the browser */
export function GameMenu() {
  const { menu, closeMenu, byId, launch, go, update, demo, notify, setMatchFor, collections, fileGames } = useStore();
  const manual = collections.filter((c) => !c.filter);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const g = menu ? byId.get(menu.id) : undefined;

  useLayoutEffect(() => {
    if (!menu || !ref.current) { setPos(null); return; }
    const r = ref.current.getBoundingClientRect();
    setPos({
      left: Math.min(menu.x, window.innerWidth - r.width - 8),
      top: Math.min(menu.y, window.innerHeight - r.height - 8),
    });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) closeMenu(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') closeMenu(); };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    window.addEventListener('blur', closeMenu);
    document.querySelector('.sheet-scroll')?.addEventListener('scroll', closeMenu, { once: true });
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
      window.removeEventListener('blur', closeMenu);
    };
  }, [menu, closeMenu]);

  if (!menu || !g) return null;
  const act = (f: () => void) => () => { closeMenu(); f(); };

  return (
    <div ref={ref} className="ctx-menu" role="menu" aria-label={g.title}
      style={pos ? { left: pos.left, top: pos.top } : { left: menu.x, top: menu.y, visibility: 'hidden' }}>
      <div className="ctx-head">
        <span className="ctx-thumb"><Cover game={g} /></span>
        <span className="ctx-title">{g.title}</span>
      </div>
      <button role="menuitem" className="ctx-item" onClick={act(() => launch(g))}>
        {g.installed ? <Play size={15} strokeWidth={1.8} /> : <Download size={15} strokeWidth={1.7} />} {g.installed ? tr('Oyna') : tr('Kur')}
      </button>
      <button role="menuitem" className="ctx-item" onClick={act(() => go({ name: 'game', id: g.id }))}>
        <SquareArrowOutUpRight size={15} strokeWidth={1.7} /> {tr('Sayfasını aç')}
      </button>
      <button role="menuitem" className="ctx-item" onClick={act(() => { update(g.id, { favorite: !g.favorite }); notify(g.favorite ? tr('Favorilerden çıkarıldı: {0}', g.title) : tr('Favorilere eklendi: {0}', g.title)); })}>
        <Heart size={15} strokeWidth={1.7} fill={g.favorite ? 'currentColor' : 'none'} /> {g.favorite ? tr('Favorilerden çıkar') : tr('Favorilere ekle')}
      </button>
      {g.platform === 'steam' && !demo && g.externalId && (
        <button role="menuitem" className="ctx-item" onClick={act(() => api.openUrl(`https://store.steampowered.com/app/${g.externalId}`))}>
          <ExternalLink size={15} strokeWidth={1.7} /> {tr('Steam mağaza sayfası')}
        </button>
      )}
      {g.platform !== 'steam' && !demo && (
        <button role="menuitem" className="ctx-item" onClick={act(() => setMatchFor(g.id))}>
          <SquarePen size={15} strokeWidth={1.7} /> {tr('Bilgileri eşleştir')}
        </button>
      )}
      <div className="ctx-sep" />
      <div className="ctx-label">{tr('Durum')}</div>
      <div className="ctx-status">
        {STATUSES.map((s) => (
          <button key={s.id} role="menuitemradio" aria-checked={g.status === s.id} className={`ctx-chip ${g.status === s.id ? 'is-on' : ''}`}
            onClick={act(() => { update(g.id, { status: s.id }); notify(`${g.title} · ${s.label}`); })}>
            {g.status === s.id && <Check size={12} strokeWidth={2.2} />}{s.label}
          </button>
        ))}
      </div>
      {manual.length > 0 && (
        <>
          <div className="ctx-label">{tr('Kategoriler')}</div>
          <div className="ctx-status">
            {manual.map((c) => {
              const on = g.collections.includes(c.id);
              return (
                <button key={c.id} role="menuitemcheckbox" aria-checked={on} className={`ctx-chip ${on ? 'is-on' : ''}`}
                  onClick={() => { fileGames([g.id], c.id, !on); notify(on ? tr('“{0}” kategorisinden çıkarıldı', c.id) : tr('“{0}” kategorisine eklendi', c.id)); }}>
                  {on && <Check size={12} strokeWidth={2.2} />}{c.id}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
