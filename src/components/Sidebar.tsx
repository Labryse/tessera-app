import { useEffect, useRef, useState } from 'react';
import {
  BarChart3, Cpu, Download, Gamepad2, Library, Plus, Search, Settings, ListFilter, Star, Shapes, Pencil, Trash2, Newspaper, Bookmark, Users, Tag, Tv,
} from 'lucide-react';
import { Cover, Mark, useNow } from './bits';
import { clock, elapsed, SessionBar, typicalMinutes, usually } from './Session';
import { useStore, type Route, type Scope } from '../store';
import { PLATFORMS, SMART_COLLECTIONS, type PlatformId } from '../data/library';
import { inScope } from './Library';
import { PlatformLogo } from './PlatformLogo';
import { SteamCollections } from './SteamCollections';

import { t } from '../lib/i18n';
const sameScope = (a: Scope, b: Scope) =>
  a.kind === b.kind && ('id' in a ? a.id : null) === ('id' in b ? (b as { id: string }).id : null);

function NowPlaying() {
  const { playing, byId, go } = useStore();
  const now = useNow(1000);
  if (!playing.length) return null;
  return (
    <div className="now-playing">
      {playing.map((p) => {
        const g = byId.get(p.gameId);
        const secs = elapsed(p.since, now);
        const typical = typicalMinutes(g);
        return (
          <button key={p.gameId} className="np-item" onClick={() => go({ name: 'game', id: p.gameId })} aria-label={t('{0}, {1} süredir açık', g?.title ?? p.title, clock(secs))}>
            <span className="np-row">
              <span className="np-thumb">{g && <Cover game={g} />}</span>
              <span className="np-text">
                <span className="np-title">{g?.title ?? p.title}</span>
                {p.presence && <span className="np-presence" title={p.presence}>{p.presence}</span>}
                <span className="np-time"><span className="num np-clock">{clock(secs)}</span>{typical ? <> · {usually(typical)}</> : null}</span>
              </span>
            </span>
            {typical ? <SessionBar secs={secs} typical={typical} /> : null}
          </button>
        );
      })}
    </div>
  );
}

/** right-click on a category: rename or delete it */
function CategoryMenu({ at, name, onRename, onClose }: { at: { x: number; y: number }; name: string; onRename: () => void; onClose: () => void }) {
  const { removeCollection, notify, games } = useStore();
  const ref = useRef<HTMLDivElement>(null);
  const [sure, setSure] = useState(false);
  useEffect(() => {
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc); };
  }, [onClose]);
  const n = games.filter((g) => g.collections.includes(name)).length;
  return (
    <div ref={ref} className="ctx-menu" role="menu" aria-label={name} style={{ left: Math.min(at.x, window.innerWidth - 260), top: Math.min(at.y, window.innerHeight - 140) }}>
      <button role="menuitem" className="ctx-item" onClick={() => { onClose(); onRename(); }}><Pencil size={15} strokeWidth={1.7} /> {t('Yeniden adlandır')}</button>
      {sure ? (
        <button role="menuitem" className="ctx-item ctx-danger" onClick={() => { removeCollection(name); notify(t('“{0}” silindi', name)); onClose(); }}>
          <Trash2 size={15} strokeWidth={1.7} /> {t('Evet, sil')}{n > 0 ? t(' · oyunlar kütüphanede kalır') : ''}
        </button>
      ) : (
        <button role="menuitem" className="ctx-item" onClick={() => setSure(true)}><Trash2 size={15} strokeWidth={1.7} /> {t('Kategoriyi sil')}</button>
      )}
    </div>
  );
}

export function Sidebar({ onSearch }: { onSearch: () => void }) {
  const { games, route, go, collections, addCollection, renameCollection, accounts, openSettings, settings, demo, notify, wishlist, setBig } = useStore();
  const onSale = wishlist?.items.filter((w) => w.discount > 0).length ?? 0;
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [menuFor, setMenuFor] = useState<{ name: string; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [fromSteam, setFromSteam] = useState(false);
  const steamLinked = !demo && accounts.some((a) => a.platform === 'steam');

  const count = (s: Scope) => games.filter((g) => inScope(g, s, collections)).length;
  const libraryActive = (s: Scope) => route.name === 'library' && sameScope(route.scope, s);
  const item = (label: string, r: Route, active: boolean, opts: { icon?: React.ReactNode; count?: number; k?: string } = {}) => (
    <button key={label} className={`nav-item ${active ? 'is-active' : ''}`} onClick={() => go(r)} aria-current={active ? 'page' : undefined} data-nav={opts.k} title={label}>
      {opts.icon && <span className="nav-icon">{opts.icon}</span>}
      <span className="nav-label">{label}</span>
      {opts.count != null && <span className="nav-count">{opts.count}</span>}
    </button>
  );
  const lib = (label: string, s: Scope, icon?: React.ReactNode, k?: string) =>
    item(label, { name: 'library', scope: s }, libraryActive(s), { icon, count: count(s), k });

  // only the stores the user has actually added: connected, or holding games
  const stores = (Object.keys(PLATFORMS) as PlatformId[]).filter((p) =>
    PLATFORMS[p].kind === 'store' && (accounts.some((a) => a.platform === p) || games.some((g) => g.platform === p)));
  // the systems that have games, most games first
  const retro = (Object.keys(PLATFORMS) as PlatformId[])
    .filter((p) => PLATFORMS[p].kind === 'system')
    .map((p) => ({ p, n: games.filter((g) => g.platform === p && (demo || g.installed)).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
  const ic = { size: 16, strokeWidth: 1.6 };

  const commit = () => {
    if (name.trim()) {
      if (addCollection(name)) go({ name: 'library', scope: { kind: 'collection', id: name.trim() } });
      else notify(t('Bu adda bir kategori zaten var'));
    }
    setName(''); setAdding(false);
  };
  const commitRename = () => {
    if (renaming && newName.trim() && newName.trim() !== renaming && !renameCollection(renaming, newName)) notify(t('Bu adda bir kategori zaten var'));
    setRenaming(null);
  };

  return (
    <aside className="sidebar">
      <div className="brand" data-nav="brand">
        <Mark />
        <span className="brand-name">{t('Tessera')}</span>
      </div>

      <button className="search-trigger" onClick={onSearch} data-nav="search">
        <Search size={15} strokeWidth={1.6} />
        <span>{t('Ara veya komut')}</span>
        <kbd>{t('Ctrl K')}</kbd>
      </button>

      <nav className="nav" aria-label={t('Kütüphane')} data-nav="menu">
        {lib(t('Tüm oyunlar'), { kind: 'all' }, <Library {...ic} />, 'all')}
        {lib(t('Yüklü'), { kind: 'installed' }, <Download {...ic} />, 'installed')}
        {lib(t('Favoriler'), { kind: 'favorites' }, <Star {...ic} />, 'favorites')}
        {item(t('İstatistikler'), { name: 'stats' }, route.name === 'stats', { icon: <BarChart3 {...ic} />, k: 'stats' })}
        {item(t('Güncellemeler'), { name: 'news' }, route.name === 'news', { icon: <Newspaper {...ic} />, k: 'news' })}
        {(wishlist || accounts.some((a) => a.platform === 'steam')) && item(t('İstek listesi'), { name: 'wishlist' }, route.name === 'wishlist', { icon: <Bookmark {...ic} />, count: onSale || undefined, k: 'wishlist' })}
        {item(t('Fiyat ara'), { name: 'shop' }, route.name === 'shop', { icon: <Tag {...ic} />, k: 'shop' })}
        {(demo || accounts.some((a) => a.platform === 'steam')) && item(t('Arkadaşlar'), { name: 'friends' }, route.name === 'friends', { icon: <Users {...ic} />, k: 'friends' })}
      </nav>

      <div className="nav-group" data-nav="stores">
        <div className="nav-heading nav-heading-row">
          <span>{t('Mağazalar')}</span>
          <button className="nav-add" aria-label={t('Mağaza ekle')} title={t('Mağaza ekle')} onClick={() => openSettings('accounts')}><Plus size={14} strokeWidth={1.8} /></button>
        </div>
        <div className="nav-group-items">
        {stores.map((p) => lib(PLATFORMS[p].name, { kind: 'platform', id: p }, <PlatformLogo id={p} size={15} />))}
        {stores.length === 0 && (
          <button className="nav-item nav-hint" onClick={() => openSettings('accounts')}>
            <span className="nav-icon"><Plus {...ic} /></span><span className="nav-label">{t('Mağaza bağla')}</span>
          </button>
        )}
        </div>
      </div>

      <div className="nav-group" data-nav="retro">
        <div className="nav-heading"><span>{t('Retro')}</span></div>
        <div className="nav-group-items">
        {retro.map(({ p, n }) => item(PLATFORMS[p].name, { name: 'system', id: p }, route.name === 'system' && route.id === p, {
          icon: <Gamepad2 {...ic} />, count: n,
        }))}
        {item(t('Emülatörler'), { name: 'emulators' }, route.name === 'emulators', { icon: <Cpu {...ic} /> })}
        </div>
      </div>

      <div className="nav-group" data-nav="categories">
        <div className="nav-heading nav-heading-row">
          <span>{t('Kategoriler')}</span>
          <span className="nav-heading-tools">
            {steamLinked && <button className="nav-add" aria-label={t('Steam kategorilerini al')} title={t('Steam kategorilerini al')} onClick={() => setFromSteam(true)}><PlatformLogo id="steam" size={13} /></button>}
            <button className="nav-add" aria-label={t('Yeni kategori')} title={t('Yeni kategori')} onClick={() => setAdding(true)}><Plus size={14} strokeWidth={1.8} /></button>
          </span>
        </div>
        <div className="nav-group-items">
        {collections.map((c) => renaming === c.id ? (
          <label key={c.id} className="nav-new">
            {c.filter ? <ListFilter {...ic} /> : <Shapes {...ic} />}
            <input autoFocus value={newName} aria-label={t('Kategorinin yeni adı')} onChange={(e) => setNewName(e.target.value)} onBlur={commitRename}
              onFocus={(e) => e.target.select()}
              onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(null); }} />
          </label>
        ) : (
          <div key={c.id} className="nav-row" onContextMenu={(e) => { e.preventDefault(); setMenuFor({ name: c.id, x: e.clientX, y: e.clientY }); }}>
            {lib(c.id, { kind: 'collection', id: c.id }, c.filter ? <ListFilter {...ic} /> : <Shapes {...ic} />)}
          </div>
        ))}
        {menuFor && (
          <CategoryMenu at={menuFor} name={menuFor.name} onClose={() => setMenuFor(null)}
            onRename={() => { setNewName(menuFor.name); setRenaming(menuFor.name); }} />
        )}
        {adding && (
          <label className="nav-new">
            <Shapes {...ic} />
            <input autoFocus value={name} placeholder={t('Kategori adı')} aria-label={t('Yeni kategori adı')}
              onChange={(e) => setName(e.target.value)} onBlur={commit}
              onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setName(''); setAdding(false); } }} />
          </label>
        )}
        {collections.length === 0 && !adding && (
          <button className="nav-item nav-hint" onClick={() => setAdding(true)}>
            <span className="nav-icon"><Plus {...ic} /></span><span className="nav-label">{t('Kategori oluştur')}</span>
          </button>
        )}
        {collections.length === 0 && !adding && steamLinked && (
          <button className="nav-item nav-hint" onClick={() => setFromSteam(true)}>
            <span className="nav-icon"><PlatformLogo id="steam" size={15} /></span><span className="nav-label">{t('Steam’den al')}</span>
          </button>
        )}
        {SMART_COLLECTIONS.map((c) => lib(c.label, { kind: 'smart', id: c.id }, <ListFilter {...ic} />, 'smart'))}
        </div>
      </div>

      {steamLinked && <SteamCollections open={fromSteam} onClose={() => setFromSteam(false)} />}

      <div className="sidebar-foot" data-nav="foot">
        <NowPlaying />
        <button className="nav-item settings-entry" onClick={() => setBig(true)} data-nav="big" title={t('Geniş ekran')}>
          <span className="nav-icon"><Tv {...ic} /></span>
          <span className="nav-label">{t('Geniş ekran')}</span>
          <kbd>F11</kbd>
        </button>
        <button className={`nav-item settings-entry ${settings ? 'is-active' : ''}`} onClick={() => openSettings()} title={t('Ayarlar')}>
          <span className="nav-icon"><Settings {...ic} /></span>
          <span className="nav-label">{t('Ayarlar')}</span>
          <kbd>{t('Ctrl ,')}</kbd>
        </button>
      </div>
    </aside>
  );
}
