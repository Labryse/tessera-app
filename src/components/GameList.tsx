// The game list column a layout can put beside the page: every game of the library (or
// the list last opened), grouped, searchable. Click opens the game, double click plays.
import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Search } from 'lucide-react';
import { useStore, type Scope } from '../store';
import { isSystem, PLATFORMS, type Game } from '../data/library';
import { groupGames, type GroupId } from '../lib/filters';
import { useLayout } from '../lib/layout';
import { inScope } from './Library';
import { t, locale } from '../lib/i18n';

let lastScope: Scope = { kind: 'all' };

function scopeName(s: Scope): string {
  switch (s.kind) {
    case 'all': return t('Tüm oyunlar');
    case 'installed': return t('Yüklü');
    case 'favorites': return t('Favoriler');
    case 'platform': return PLATFORMS[s.id].name;
    default: return s.id;
  }
}

function Art({ g, kind }: { g: Game; kind: 'cover' | 'header' | 'none' }) {
  const [bad, setBad] = useState(false);
  if (kind === 'none') return null;
  const src = kind === 'header' ? g.header ?? g.cover : g.cover ?? g.header;
  return (
    <span className={`gl-art is-${kind}`}>
      {src && !bad ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setBad(true)} /> : <span className="gl-art-letter">{g.title.slice(0, 1)}</span>}
    </span>
  );
}

export function GameList() {
  const { games, route, go, launch, openMenu, collections, playing } = useStore();
  const ly = useLayout();
  useEffect(() => { if (route.name === 'library') lastScope = route.scope; }, [route]);
  const scope = route.name === 'library' ? route.scope : lastScope;
  const [q, setQ] = useState('');
  const [shut, setShut] = useState<Set<string>>(new Set());
  const art = ly.listArt ?? 'cover';
  const group: GroupId = ly.listGroup ?? 'none';
  const live = new Set(playing.map((p) => p.gameId));
  const current = route.name === 'game' ? route.id : null;

  const groups = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase(locale);
    const list = games
      .filter((g) => (scope.kind === 'all' ? !isSystem(g.platform) : inScope(g, scope, collections)))
      .filter((g) => !needle || g.title.toLocaleLowerCase(locale).includes(needle))
      .sort((a, b) => a.title.localeCompare(b.title, locale));
    return groupGames(list, group);
  }, [games, scope, collections, q, group]);
  const total = groups.reduce((a, g) => a + g.games.length, 0);
  const flip = (k: string) => setShut((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  return (
    <aside className="game-list" aria-label={t('Oyun listesi')}>
      <div className="gl-head">
        <button className="gl-scope" onClick={() => go({ name: 'library', scope })}>{scopeName(scope)}</button>
        <span className="gl-n num">{total}</span>
      </div>
      <label className="gl-search">
        <Search size={14} strokeWidth={1.7} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Oyun ara')} aria-label={t('Listede ara')} />
      </label>
      <div className="gl-scroll">
        {groups.map((grp) => {
          const closed = shut.has(grp.key);
          return (
            <section key={grp.key || 'all'} className="gl-group">
              {grp.key && (
                <button className="gl-group-head" aria-expanded={!closed} onClick={() => flip(grp.key)}>
                  <ChevronRight size={13} strokeWidth={2} className="gl-chev" />
                  <span>{grp.key}</span><span className="gl-n num">{grp.games.length}</span>
                </button>
              )}
              {!closed && grp.games.map((g) => (
                <button key={g.id}
                  className={`gl-row ${g.id === current ? 'is-active' : ''} ${g.installed ? '' : 'is-remote'} ${live.has(g.id) ? 'is-live' : ''}`}
                  aria-current={g.id === current ? 'page' : undefined}
                  onClick={() => go({ name: 'game', id: g.id })}
                  onDoubleClick={() => launch(g)}
                  onContextMenu={(e) => { e.preventDefault(); openMenu({ x: e.clientX, y: e.clientY, id: g.id }); }}
                  title={g.title}>
                  <Art g={g} kind={art} />
                  <span className="gl-title">{g.title}</span>
                  {live.has(g.id) && <span className="gl-live">{t('Oynanıyor')}</span>}
                </button>
              ))}
            </section>
          );
        })}
        {total === 0 && <p className="gl-empty">{t('Oyun yok')}</p>}
      </div>
    </aside>
  );
}
