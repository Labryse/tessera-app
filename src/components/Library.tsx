import { TileSession } from './Session';
import { useMemo, useState, type CSSProperties } from 'react';
import { Cartridge } from './SystemView';
import { PlatformLogo } from './PlatformLogo';
import {
  Plus, ScanSearch, CloudDownload, Shuffle, LayoutGrid, List, Play, Download, Search, Star, SlidersHorizontal, ArrowDownWideNarrow, ArrowUpNarrowWide,
} from 'lucide-react';
import { useStore, type Collection, type Scope } from '../store';
import {
  CARTRIDGE, isSystem, type PlatformId, PLATFORMS, SMART_COLLECTIONS, STATUSES, lastPlayed, minutesBetween, statusLabel,
  totalMinutes, tracksWithTessera, type Game,
} from '../data/library';
import { Cover, RatingBar } from './bits';
import { ago, duration, gb, int, score, pct } from '../lib/format';
import {
  EMPTY_FILTERS, GROUPS, SORTS, activeCount, groupGames, matches, primaryGenre, sortGames, withDefaults, type Filters, type GroupId, type SortId,
} from '../lib/filters';
import { AddAllToCategory, FilterPanel, FilterPills, SaveAsDynamic } from './FilterPanel';
import { useLayout } from '../lib/layout';

import { t as tr, locale } from '../lib/i18n';
const DAY = 86400000;

/** retro ROMs live in their own section (square boxes, cartridges); the PC library is store games */
export function inScope(g: Game, s: Scope, collections: Collection[] = []): boolean {
  if (isSystem(g.platform)) return false;
  switch (s.kind) {
    case 'all': return true;
    case 'installed': return g.installed;
    case 'favorites': return g.favorite;
    case 'platform': return g.platform === s.id || !!g.mergedFrom?.some((c) => c.platform === s.id);
    case 'collection': {
      const c = collections.find((x) => x.id === s.id);
      return c?.filter ? matches(g, withDefaults(c.filter)) : g.collections.includes(s.id);
    }
    case 'smart': {
      if (s.id === 'never') return totalMinutes(g) === 0;
      // played once, installed, and left alone for two months (never played ones are under 'never')
      if (s.id === 'stale') {
        const lp = lastPlayed(g);
        return g.installed && totalMinutes(g) > 0 && !!lp && Date.now() - lp.getTime() > 60 * DAY;
      }
      return false;
    }
  }
}

function scopeTitle(s: Scope, collections: Collection[]): { title: string; sub?: string } {
  switch (s.kind) {
    case 'all': return { title: tr('Tüm oyunlar') };
    case 'installed': return { title: tr('Yüklü oyunlar') };
    case 'favorites': return { title: tr('Favoriler') };
    case 'platform': return { title: PLATFORMS[s.id].name };
    case 'collection': {
      const c = collections.find((x) => x.id === s.id);
      return { title: s.id, sub: c?.filter ? tr('Dinamik kategori') : undefined };
    }
    case 'smart': {
      const c = SMART_COLLECTIONS.find((x) => x.id === s.id)!;
      return { title: c.label, sub: tr('Akıllı liste: {0}', c.rule) };
    }
  }
}

const recentKey = (g: Game) => lastPlayed(g)?.getTime() ?? new Date(g.addedAt).getTime() / 1000;

/** sort, direction, grouping and view stay as the user left them */
interface ViewPrefs { sort: SortId; asc: boolean; group: GroupId }
const readView = (): ViewPrefs => {
  try {
    const raw = localStorage.getItem('tessera.libview');
    if (raw) return { sort: 'recent', asc: false, group: 'none', ...(JSON.parse(raw) as Partial<ViewPrefs>) };
  } catch { /* storage unavailable */ }
  return { sort: 'recent', asc: false, group: 'none' };
};
/** names read A→Z first, numbers biggest first */
const naturalAsc = (s: SortId) => s === 'title' || s === 'genre';

export function LibraryView({ scope }: { scope: Scope }) {
  const { games, go, launch, openPicker, demo, loaded, prefs, openMenu, setScanOpen, setAddOpen, playing, collections, setCollectionFilter, notify } = useStore();
  const live = new Map(playing.map((p) => [p.gameId, p.since]));
  const menuFor = (id: string) => (e: React.MouseEvent) => { e.preventDefault(); openMenu({ x: e.clientX, y: e.clientY, id }); };

  // a dynamic category's page is its filters: the list starts from every game
  const category = scope.kind === 'collection' ? collections.find((c) => c.id === scope.id) : undefined;
  const savedRaw = category?.filter;
  const saved = useMemo(() => (savedRaw ? withDefaults(savedRaw) : null), [savedRaw]);
  const [f, setF] = useState<Filters>(saved ?? EMPTY_FILTERS);
  const [panel, setPanel] = useState(false);
  const [vp, setVp] = useState<ViewPrefs>(readView);
  const setView_ = (patch: Partial<ViewPrefs>) => setVp((v) => {
    const next = { ...v, ...patch };
    try { localStorage.setItem('tessera.libview', JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });
  const ly = useLayout();
  const [view, setView] = useState<'grid' | 'list'>(ly.view ?? prefs.defaultView);
  const wide = ly.shape === 'landscape';
  const [q, setQ] = useState('');

  const scoped = useMemo(
    () => games.filter((g) => (saved ? !isSystem(g.platform) : inScope(g, scope, collections))),
    [games, scope, collections, saved],
  );
  const shown = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase(locale);
    const list = scoped.filter((g) => matches(g, f) &&
      (!needle || g.title.toLocaleLowerCase(locale).includes(needle) || g.developer.toLocaleLowerCase(locale).includes(needle) ||
        g.tags.some((t) => t.toLocaleLowerCase(locale).includes(needle)) || g.storeTags.some((t) => t.toLocaleLowerCase(locale).includes(needle))));
    return sortGames(list, vp.sort, vp.asc);
  }, [scoped, f, vp.sort, vp.asc, q]);
  const groups = useMemo(() => groupGames(shown, vp.group), [shown, vp.group]);

  const { title, sub } = scopeTitle(scope, collections);
  const inCategory = saved ? shown : scoped;
  const installed = inCategory.filter((g) => g.installed).length;
  const month = new Date(Date.now() - 30 * DAY);
  const monthMin = minutesBetween(inCategory, month);
  const top = [...inCategory].map((g) => ({ g, m: minutesBetween([g], month) })).sort((a, b) => b.m - a.m)[0];

  const continueList = scope.kind === 'all'
    ? [...games].filter((g) => g.status === 'playing' && !isSystem(g.platform)).sort((a, b) => recentKey(b) - recentKey(a)).slice(0, 3)
    : [];
  const anySessions = inCategory.some((g) => g.sessions.length > 0);
  const totalAll = inCategory.reduce((a, g) => a + totalMinutes(g), 0);
  const latest = [...inCategory].filter((g) => lastPlayed(g)).sort((a, b) => recentKey(b) - recentKey(a))[0];

  const nActive = activeCount(f);
  const changed = saved && JSON.stringify(f) !== JSON.stringify(saved);
  // the quick status chips work on the same filters as the panel
  const statusOnly = (s: Game['status'] | 'any') => setF({ ...f, status: s === 'any' ? [] : f.status.length === 1 && f.status[0] === s ? [] : [s] });
  const clear = () => { setF(saved ? { ...EMPTY_FILTERS } : EMPTY_FILTERS); setQ(''); };
  // "Ne oynasam?" picks among what this page shows: the category, with its filters and search
  const narrowed = scope.kind !== 'all' || nActive > 0 || !!q.trim();
  const pickAmong = narrowed ? { ids: shown.map((g) => g.id), label: nActive > 0 || q.trim() ? tr('{0} · süzülmüş', title) : title } : undefined;
  const pickHere = () => openPicker(pickAmong);

  if (!demo && loaded && games.length === 0) return <FirstRun />;

  return (
    <div className="page">
      <header className="title-row">
        <div>
          <h1>{title}</h1>
          <p className="title-meta is-facts">
            <span className="num">{tr('{0} oyun', inCategory.length)}</span>
            {scope.kind !== 'installed' && <span className="num">{tr('{0} yüklü', installed)}</span>}
            {anySessions && monthMin > 0 && (
              <span>{tr('Son 30 gün')} <strong className="num">{duration(monthMin, { compact: true })}</strong>
                {top && top.m > 0 && <> · {tr('en çok')} <button className="link" onClick={() => go({ name: 'game', id: top.g.id })}>{top.g.title}</button></>}
              </span>
            )}
            {!anySessions && totalAll > 0 && (
              <span>{tr('Toplam')} <strong className="num">{int(Math.round(totalAll / 60))} {tr('saat')}</strong>
                {latest && <> · {tr('en son')} <button className="link" onClick={() => go({ name: 'game', id: latest.id })}>{latest.title}</button></>}
              </span>
            )}
            {sub && <span>{sub}</span>}
          </p>
        </div>
        <div className="title-actions">
          {!demo && scope.kind === 'all' && <button className="btn" onClick={() => setAddOpen(true)}><Plus size={16} strokeWidth={1.7} /> {tr('Oyun ekle')}</button>}
          {!demo && scope.kind === 'all' && <button className="btn" onClick={() => setScanOpen(true)}><ScanSearch size={16} strokeWidth={1.6} /> {tr('Bilgisayarı tara')}</button>}
          <button className="btn" onClick={pickHere} title={pickAmong ? tr('{0} içinden seçer', pickAmong.label) : undefined}>
            <Shuffle size={16} strokeWidth={1.6} /> {tr('Ne oynasam?')}
          </button>
        </div>
      </header>

      {continueList.length > 0 && (
        <section className="continue" aria-label={tr('Kaldığın yerden')}>
          <h2 className="section-title">{tr('Kaldığın yerden')}</h2>
          <div className="continue-row">
            {continueList.map((g) => <ContinueCard key={g.id} game={g} />)}
          </div>
        </section>
      )}

      <div className="lib-controls">
        <div className="toolbar">
          <div className="chips" role="group" aria-label={tr('Durum')}>
            <button aria-pressed={f.status.length === 0} className={`chip ${f.status.length === 0 ? 'is-on' : ''}`} onClick={() => statusOnly('any')}>
              {tr('Hepsi')} <span className="chip-n">{scoped.length}</span>
            </button>
            {STATUSES.map(({ id }) => {
              const n = scoped.filter((g) => g.status === id).length;
              if (!n) return null;
              const on = f.status.includes(id);
              return (
                <button key={id} aria-pressed={on} className={`chip ${on ? 'is-on' : ''}`} onClick={() => statusOnly(id)}>
                  {statusLabel(id)} <span className="chip-n">{n}</span>
                </button>
              );
            })}
          </div>
          <div className="toolbar-right">
            <label className="field field-search">
              <Search size={15} strokeWidth={1.6} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Ad, geliştirici, etiket')} aria-label={tr('Bu listede ara')} />
            </label>
            <button className={`btn btn-filter ${panel ? 'is-open' : ''}`} aria-expanded={panel} onClick={() => setPanel((v) => !v)}>
              <SlidersHorizontal size={15} strokeWidth={1.7} /> {tr('Filtreler')}{nActive > 0 && <span className="btn-badge">{nActive}</span>}
            </button>
          </div>
        </div>

        <div className="toolbar toolbar-tight">
          <div className="sortbar">
            <label className="field">
              <span className="field-label">{tr('Sırala')}</span>
              <select value={vp.sort} onChange={(e) => { const s = e.target.value as SortId; setView_({ sort: s, asc: naturalAsc(s) }); }} aria-label={tr('Sırala')}>
                {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </label>
            <button className="btn btn-icon" onClick={() => setView_({ asc: !vp.asc })}
              aria-label={vp.asc ? tr('Artan sırada') : tr('Azalan sırada')} title={vp.asc ? tr('Artan sırada') : tr('Azalan sırada')}>
              {vp.asc ? <ArrowUpNarrowWide size={16} strokeWidth={1.6} /> : <ArrowDownWideNarrow size={16} strokeWidth={1.6} />}
            </button>
            <label className="field">
              <span className="field-label">{tr('Grupla')}</span>
              <select value={vp.group} onChange={(e) => setView_({ group: e.target.value as GroupId })} aria-label={tr('Grupla')}>
                {GROUPS.map((g) => <option key={g.id} value={g.id}>{g.id === 'none' ? tr('Yok') : g.label}</option>)}
              </select>
            </label>
          </div>
          <div className="segmented" role="group" aria-label={tr('Görünüm')}>
            <button aria-pressed={view === 'grid'} aria-label={tr('Kapak görünümü')} onClick={() => setView('grid')}><LayoutGrid size={16} strokeWidth={1.6} /></button>
            <button aria-pressed={view === 'list'} aria-label={tr('Liste görünümü')} onClick={() => setView('list')}><List size={16} strokeWidth={1.6} /></button>
          </div>
        </div>

        {panel && <FilterPanel base={scoped} f={f} set={setF} />}

        {(nActive > 0 || q || changed) && (
          <FilterPills f={f} set={setF} onClear={clear} shown={shown}>
            {saved && changed && (
              <>
                <button className="btn btn-sm" onClick={() => setF(saved)}>{tr('Geri al')}</button>
                <button className="btn btn-sm btn-primary" onClick={() => { setCollectionFilter(scope.kind === 'collection' ? scope.id : '', f); notify(tr('Kategori güncellendi')); }}>{tr('Kategoriyi güncelle')}</button>
              </>
            )}
            {!saved && nActive > 0 && <SaveAsDynamic f={f} onSaved={(name) => go({ name: 'library', scope: { kind: 'collection', id: name } })} />}
            {shown.length > 0 && <AddAllToCategory games={shown} />}
          </FilterPills>
        )}
      </div>

      {shown.length === 0 ? (
        <div className="empty">
          <p>{saved && nActive === 0 ? tr('Bu dinamik kategorinin filtresi yok. Filtreleri açıp seç, sonra kategoriyi güncelle.') : tr('Bu filtreye uyan oyun yok.')}</p>
          {nActive > 0 || q ? <button className="btn" onClick={clear}>{tr('Filtreleri temizle')}</button> : saved && <button className="btn" onClick={() => setPanel(true)}>{tr('Filtreleri aç')}</button>}
        </div>
      ) : groups.map((grp) => (
        <section key={grp.key || 'all'} className={grp.key ? 'lib-group' : undefined} aria-label={grp.key || undefined}>
          {grp.key && <h2 className="lib-group-title">{grp.key}<span className="lib-group-n">{grp.games.length}</span></h2>}
          {view === 'grid' ? (
            <div className="cover-grid">
              {grp.games.map((g, i) => (
                <article key={g.id} className={`tile tile-in ${g.installed ? '' : 'is-remote'}`} style={{ '--i': Math.min(i, 24) } as CSSProperties} onContextMenu={menuFor(g.id)}>
                  <div className="tile-media">
                  <button className="tile-hit" onClick={() => go({ name: 'game', id: g.id })} aria-label={g.title}>
                    <span className="tile-cover">
                      {wide && g.header ? <img className="cover-img" src={g.header} alt="" loading="lazy" decoding="async" /> : <Cover game={g} />}
                      {live.has(g.id) && <TileSession g={g} since={live.get(g.id)!} />}
                    </span>
                  </button>
                  <button className="tile-play" onClick={() => launch(g)} aria-label={g.installed ? tr('{0} oyna', g.title) : tr('{0} kur', g.title)}>
                    {g.installed ? <Play size={16} strokeWidth={2} fill="currentColor" /> : <Download size={16} strokeWidth={1.8} />}
                  </button>
                  </div>
                  <div className="tile-text">
                    <span className="tile-title">{g.title}</span>
                    <span className="tile-meta">
                      <span className="tile-plat" title={PLATFORMS[g.platform].name}><PlatformLogo id={g.platform} size={12} /></span>
                      <TileFact g={g} sort={vp.sort} />
                      {!g.installed && <span className="tile-remote" title={tr('Yüklü değil')}><CloudDownload size={13} strokeWidth={1.8} aria-label={tr('Yüklü değil')} /></span>}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <LibraryTable games={grp.games} />
          )}
        </section>
      ))}

      {scope.kind === 'all' && nActive === 0 && !q && <RetroShelf />}
    </div>
  );
}

/** under each cover: what the list is sorted by, so the order makes sense */
function TileFact({ g, sort }: { g: Game; sort: SortId }) {
  const t = totalMinutes(g);
  const time = <span className="num">{t ? duration(t, { compact: true }) : tr('Oynanmadı')}</span>;
  switch (sort) {
    case 'metacritic': return g.metacritic != null ? <span className="num">{tr('Metacritic')} {g.metacritic}</span> : <span className="dash">{tr('Metacritic yok')}</span>;
    case 'userScore': return g.userScore != null ? <span className="num">{pct(g.userScore)} {tr('olumlu')}</span> : <span className="dash">—</span>;
    case 'rating': return g.rating != null ? <span className="num">{tr('Puanım')} {score(g.rating)}</span> : <span className="dash">{tr('Puan yok')}</span>;
    case 'release': return <span className="num">{g.year ?? '—'}</span>;
    case 'size': return <span className="num">{g.installed && g.sizeGB ? gb(g.sizeGB) : '—'}</span>;
    case 'genre': return <span>{primaryGenre(g) ?? '—'}</span>;
    case 'added': return <span className="num">{ago(g.addedAt)}</span>;
    default: return time;
  }
}

/** first run on the desktop app: an empty library and three honest ways forward */
function FirstRun() {
  const { openSettings, setScanOpen, setAddOpen } = useStore();
  return (
    <div className="page first-run">
      <div className="first-run-mark" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => <span key={i} style={{ '--i': i } as CSSProperties} />)}
      </div>
      <h1>{tr('Kütüphanen henüz boş')}</h1>
      <div className="first-run-options">
        <button className="first-run-option is-main" onClick={() => openSettings('accounts')}>
          <span className="first-run-title">{tr('Steam’i bağla')}</span>
          <span className="first-run-text">{tr('Oyunlar, süreler ve kapaklar.')}</span>
        </button>
        <button className="first-run-option is-main" onClick={() => setScanOpen(true)}>
          <span className="first-run-title">{tr('Bilgisayarı tara')}</span>
          <span className="first-run-text">{tr('Steam, Epic, GOG, Ubisoft, Xbox')}</span>
        </button>
        <button className="first-run-option is-main" onClick={() => setAddOpen(true)}>
          <span className="first-run-title">{tr('Oyun ekle')}</span>
          <span className="first-run-text">{tr('Herhangi bir .exe ya da kısayol')}</span>
        </button>
      </div>
    </div>
  );
}

function RetroShelf() {
  const { games, go } = useStore();
  // the system with the most games gets the shelf
  const counts = new Map<PlatformId, number>();
  for (const g of games) if (isSystem(g.platform)) counts.set(g.platform, (counts.get(g.platform) ?? 0) + 1);
  const sys = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const roms = games.filter((g) => g.platform === sys && g.installed)
    .sort((a, b) => (lastPlayed(b)?.getTime() ?? 0) - (lastPlayed(a)?.getTime() ?? 0));
  if (!roms.length) return null;
  return (
    <section className="shelf" aria-label={tr('Retro')}>
      <div className="shelf-head">
        <h2 className="section-title">{sys ? PLATFORMS[sys].name : ''}</h2>
        <span className="muted">{roms.length} {tr('oyun')}</span>
        <button className="link shelf-all" onClick={() => sys && go({ name: 'system', id: sys })}>{tr('Hepsini gör')}</button>
      </div>
      <div className="shelf-row">
        {roms.slice(0, 6).map((g) => (
          <button key={g.id} className="shelf-item" onClick={() => go({ name: 'game', id: g.id })}>
            {CARTRIDGE.has(g.platform) ? <Cartridge g={g} /> : <span className="tile-cover is-box-frame"><Cover game={g} /></span>}
            <span className="tile-title">{g.title}</span>
            <span className="tile-meta"><span className="num">{totalMinutes(g) ? duration(totalMinutes(g), { compact: true }) : tr('Oynanmadı')}</span></span>
          </button>
        ))}
      </div>
    </section>
  );
}

function ContinueCard({ game: g }: { game: Game }) {
  const { go, launch, openMenu } = useStore();
  const lp = lastPlayed(g);
  const last = g.sessions[g.sessions.length - 1];
  const art = g.hero ?? g.header;
  return (
    <article className="continue-card" onContextMenu={(e) => { e.preventDefault(); openMenu({ x: e.clientX, y: e.clientY, id: g.id }); }}>
      <button className="continue-hit" onClick={() => go({ name: 'game', id: g.id })} aria-label={tr('{0} sayfası', g.title)}>
        {art ? <img src={art} alt="" className="continue-art" /> : <span className="continue-art" />}
        <span className="continue-scrim" />
        {g.logo ? <img src={g.logo} alt={g.title} className="continue-logo" /> : <span className="continue-name">{g.title}</span>}
      </button>
      <div className="continue-foot">
        <div className="continue-text">
          <span className="continue-title">{g.title}</span>
          <span className="continue-meta">
            {ago(lp)}{last ? tr(' · {0} oturum', duration(last.minutes)) : ''} {tr('· toplam')} {duration(totalMinutes(g), { compact: true })}
            {tracksWithTessera(g) && tr(' · Tessera sayıyor')}
          </span>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => launch(g)}>
          <Play size={14} strokeWidth={2} fill="currentColor" /> {tr('Oyna')}
        </button>
      </div>
    </article>
  );
}

function LibraryTable({ games }: { games: Game[] }) {
  const { go, openMenu } = useStore();
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>{tr('Oyun')}</th>
            <th>{tr('Platform')}</th>
            <th>{tr('Durum')}</th>
            <th>{tr('Tür')}</th>
            <th>{tr('Puanım')}</th>
            <th className="r">{tr('Metacritic')}</th>
            <th className="r">{tr('Süre')}</th>
            <th>{tr('Son oynama')}</th>
            <th className="r">{tr('Başarım')}</th>
            <th className="r">{tr('Boyut')}</th>
          </tr>
        </thead>
        <tbody>
          {games.map((g) => {
            const t = totalMinutes(g);
            return (
              <tr key={g.id} onClick={() => go({ name: 'game', id: g.id })} onContextMenu={(e) => { e.preventDefault(); openMenu({ x: e.clientX, y: e.clientY, id: g.id }); }} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') go({ name: 'game', id: g.id }); }}>
                <td>
                  <span className="cell-game">
                    <span className="cell-thumb"><Cover game={g} /></span>
                    <span className="cell-name">
                      <span>{g.title}{g.favorite && <Star className="fav" size={12} strokeWidth={1.8} aria-label={tr('Favori')} />}</span>
                      <span className="cell-sub">{g.developer}</span>
                    </span>
                  </span>
                </td>
                <td><span className="cell-plat"><PlatformLogo id={g.platform} size={14} />{PLATFORMS[g.platform].short}</span></td>
                <td><span className={`status status-${g.status}`}>{statusLabel(g.status)}</span></td>
                <td className="muted">{primaryGenre(g) ?? <span className="dash">—</span>}</td>
                <td>{g.rating != null ? <span className="cell-rating"><RatingBar value={g.rating} size="sm" /><span className="num">{score(g.rating)}</span></span> : <span className="dash">—</span>}</td>
                <td className="r num">{g.metacritic ?? <span className="dash">—</span>}</td>
                <td className="r num">{t ? duration(t, { compact: true }) : <span className="dash">—</span>}</td>
                <td className="muted">{ago(lastPlayed(g))}</td>
                <td className="r num">{g.achievements ? `${g.achievements.unlocked} / ${g.achievements.total}` : <span className="dash">—</span>}</td>
                <td className="r num muted">{g.installed ? gb(g.sizeGB) : tr('Yüklü değil')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
