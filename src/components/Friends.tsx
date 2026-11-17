// Friends, one tab per platform, each dressed like its own platform: Steam in
// Steam's blues and greens, Xbox in Xbox green. Who is in a game comes first
// (grouped by game), then who is online, then the rest.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, RefreshCw } from 'lucide-react';
import { useStore } from '../store';
import { api, type Friend } from '../lib/backend';
import { ago } from '../lib/format';
import { PlatformLogo } from './PlatformLogo';
import { useFriendMenu } from './FriendMenu';
import type { Game } from '../data/library';

import { t as tr, locale } from '../lib/i18n';
type Kind = 'steam' | 'xbox';
const EVERY_MS: Record<Kind, number> = { steam: 60_000, xbox: 120_000 };

// what each platform had last time, so coming back to the page shows it at once
const seen: Partial<Record<Kind, { friends: Friend[]; checkedAt: number }>> = {};

// SAMPLE: friends for the browser demo
function sample(kind: Kind): Friend[] {
  if (kind === 'xbox') {
    return [
      { account: 'x1', name: tr('Ayla'), gamertag: tr('AylaRacer'), gamerscore: 48210, state: 'in-game', game: tr('Forza Horizon 5'), appid: null, presence: tr('Festival Playlist'), avatar: null, note: null },
      { account: 'x2', name: tr('Bora'), gamertag: tr('BoraTR'), gamerscore: 12650, state: 'in-game', game: tr('Halo Infinite'), appid: null, presence: null, avatar: null, note: null },
      { account: 'x3', name: tr('Cem'), gamertag: tr('CemX'), gamerscore: 30120, state: 'online', game: null, appid: null, presence: null, avatar: null, note: tr('Çevrimiçi') },
      { account: 'x4', name: tr('Duru'), gamertag: tr('DuruD'), gamerscore: 8800, state: 'offline', game: null, appid: null, presence: null, avatar: null, note: tr('Son görülme 3 sa önce: Minecraft') },
    ];
  }
  return [
    { account: 1, name: tr('Deniz'), state: 'in-game', game: tr('Hades II'), appid: 1145350, presence: tr('Oceanus · Gece 9'), avatar: null, note: null },
    { account: 6, name: tr('Arda'), state: 'in-game', game: tr('Hades II'), appid: 1145350, presence: tr('Ephyra'), avatar: null, note: null },
    { account: 2, name: tr('Ece'), state: 'in-game', game: tr('Path of Exile'), appid: 238960, presence: tr('Act 4 · Haritada'), avatar: null, note: null },
    { account: 3, name: tr('Kerem'), state: 'in-game', game: tr('Rust'), appid: 252490, presence: null, avatar: null, note: null },
    { account: 4, name: tr('Mert'), state: 'online', game: null, appid: null, presence: null, avatar: null, note: tr('Çevrimiçi') },
    { account: 7, name: tr('Zeynep'), state: 'away', game: null, appid: null, presence: null, avatar: null, note: tr('Uzakta') },
    { account: 5, name: tr('Selin'), state: 'offline', game: null, appid: null, presence: null, avatar: null, note: tr('Son çevrimiçi 2 gün önce') },
  ];
}

function Avatar({ f }: { f: Friend }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={`fr-avatar is-${f.state}`}>
      {f.avatar && !failed ? <img src={f.avatar} alt="" loading="lazy" onError={() => setFailed(true)} /> : <span>{f.name.slice(0, 1).toLocaleUpperCase(locale)}</span>}
    </span>
  );
}

// Steam art for a game: the first address that loads is remembered, the ones
// that failed are skipped, so the picture does not come and go on each refresh
const artOk = new Map<number, string>();
const artBad = new Set<string>();
const artUrls = (a: number) => [
  `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${a}/header.jpg`,
  `https://cdn.akamai.steamstatic.com/steam/apps/${a}/header.jpg`,
  `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${a}/capsule_616x353.jpg`,
];
function GameArt({ appid, kind, fallback }: { appid: number | null; kind: Kind; fallback?: string | null }) {
  const pick = () => (appid ? artOk.get(appid) ?? artUrls(appid).find((u) => !artBad.has(u)) : undefined) ?? (fallback && !artBad.has(fallback) ? fallback : null);
  const [src, setSrc] = useState(pick);
  useEffect(() => { setSrc(pick()); }, [appid]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!src) return <span className="fr-art fr-art-none" aria-hidden="true"><PlatformLogo id={kind} size={34} /></span>;
  return (
    <span className="fr-art" aria-hidden="true">
      <img src={src} alt="" onLoad={() => { if (appid) artOk.set(appid, src); }}
        onError={() => { artBad.add(src); if (appid) artOk.delete(appid); setSrc(pick()); }} />
    </span>
  );
}

function Board({ kind, friends, byApp, byName }: { kind: Kind; friends: Friend[]; byApp: Map<number, Game>; byName: Map<string, Game> }) {
  const { go } = useStore();
  const [showOffline, setShowOffline] = useState(false);
  const { bind, menu } = useFriendMenu();
  const ingame = friends.filter((f) => f.state === 'in-game');
  const online = friends.filter((f) => f.state !== 'in-game' && f.state !== 'offline');
  const offline = friends.filter((f) => f.state === 'offline');
  // friends playing the same game sit together
  const playing = useMemo(() => {
    const groups = new Map<string, Friend[]>();
    for (const f of ingame) groups.set(f.game ?? '?', [...(groups.get(f.game ?? '?') ?? []), f]);
    return [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [ingame]);
  const mineOf = (fs: Friend[], game: string) => (fs[0].appid ? byApp.get(fs[0].appid) : undefined) ?? byName.get(game.toLowerCase());

  return (
    <div className={`fr-board fr-${kind}`}>
      {playing.length > 0 && (
        <section className="fr-section">
          <h2 className="fr-head">{tr('Oyunda')}<span>{ingame.length}</span></h2>
          <div className="fr-games">
            {playing.map(([game, fs], gi) => {
              const mine = mineOf(fs, game);
              return (
                <article key={game} className="fr-game" style={{ '--i': gi } as React.CSSProperties}>
                  <GameArt appid={kind === 'steam' ? fs[0].appid : null} kind={kind} fallback={mine ? mine.header ?? mine.hero ?? null : null} />
                  <div className="fr-game-body">
                    <div className="fr-game-line">
                      <h3 className="fr-game-name" title={game}>{game}</h3>
                      {mine && <button className="fr-mine" onClick={(e) => { e.stopPropagation(); go({ name: 'game', id: mine.id }); }}>{tr('Kütüphanende')}</button>}
                    </div>
                    <ul className="fr-people">
                      {fs.map((f) => (
                        <li key={f.account} className="fr-act" {...bind(f, kind, mine ?? null)}>
                          <Avatar f={f} />
                          <span className="fr-text">
                            <span className="fr-name">{f.name}</span>
                            <span className="fr-sub" title={f.presence ?? undefined}>{f.presence ?? game}</span>
                          </span>
                          {kind === 'xbox' && f.gamerscore != null && <span className="fr-gs num">{f.gamerscore.toLocaleString(locale)}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {online.length > 0 && (
        <section className="fr-section">
          <h2 className="fr-head">{tr('Çevrimiçi')}<span>{online.length}</span></h2>
          <ul className="fr-grid">
            {online.map((f) => (
              <li key={f.account} className={`fr-row fr-act is-${f.state}`} {...bind(f, kind)}>
                <Avatar f={f} />
                <span className="fr-text"><span className="fr-name">{f.name}</span><span className="fr-sub">{f.note ?? tr('Çevrimiçi')}</span></span>
                {kind === 'xbox' && f.gamerscore != null && <span className="fr-gs num">{f.gamerscore.toLocaleString(locale)}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {offline.length > 0 && (
        <section className="fr-section">
          <button className="fr-head fr-toggle" aria-expanded={showOffline} onClick={() => setShowOffline((v) => !v)}>
            {tr('Çevrimdışı')}<span>{offline.length}</span>
            <ChevronDown size={16} strokeWidth={1.8} style={{ transform: showOffline ? 'rotate(180deg)' : undefined, transition: 'transform .2s' }} />
          </button>
          {showOffline && (
            <ul className="fr-grid">
              {offline.map((f) => (
                <li key={f.account} className="fr-row fr-act is-offline" {...bind(f, kind)}>
                  <Avatar f={f} />
                  <span className="fr-text"><span className="fr-name">{f.name}</span><span className="fr-sub">{f.note ?? tr('Çevrimdışı')}</span></span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {friends.length === 0 && <p className="fr-empty">{tr('Arkadaş yok.')}</p>}
      {menu}
    </div>
  );
}

/** one platform's friends (the wide-screen mode asks this too) */
export async function fetchFriends(k: Kind, demo: boolean): Promise<Friend[]> {
  if (demo) return sample(k);
  const r = k === 'steam' ? await api.steamFriends() : await api.xboxFriends();
  seen[k] = r;
  return r.friends;
}

export function FriendsView() {
  const { demo, accounts, games, openSettings } = useStore();
  const steamOn = demo || accounts.some((a) => a.platform === 'steam');
  const [xboxOn, setXboxOn] = useState(demo);
  useEffect(() => { if (!demo) api.xboxStatus().then(setXboxOn).catch(() => {}); }, [demo]);
  const hasXboxGames = games.some((g) => g.platform === 'xbox');
  const tabs: Kind[] = [...(steamOn ? ['steam' as const] : []), ...(xboxOn || hasXboxGames ? ['xbox' as const] : [])];
  const [tab, setTab] = useState<Kind>(steamOn ? 'steam' : 'xbox');
  const kind = tabs.includes(tab) ? tab : tabs[0];
  const live = kind === 'steam' ? steamOn : kind === 'xbox' ? xboxOn : false;

  const [data, setData] = useState(seen);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (k: Kind) => {
    if (demo) { seen[k] = { friends: sample(k), checkedAt: Date.now() / 1000 }; setData({ ...seen }); return; }
    setBusy(true);
    try {
      seen[k] = k === 'steam' ? await api.steamFriends() : await api.xboxFriends();
      setData({ ...seen }); setError(null);
    } catch (e) { setError(String(e)); }
    setBusy(false);
  }, [demo]);

  // fresh while the page is open
  useEffect(() => {
    if (!kind || !live) return;
    setError(null);
    void load(kind);
    const t = window.setInterval(() => { if (!document.hidden) void load(kind); }, EVERY_MS[kind]);
    return () => window.clearInterval(t);
  }, [kind, live, load]);

  // a friend's game in your own library links to its page
  const byApp = useMemo(() => {
    const m = new Map<number, Game>();
    for (const g of games) {
      const id = g.platform === 'steam' ? Number(g.externalId ?? g.id) : g.steamAppId;
      if (id) m.set(id, g);
    }
    return m;
  }, [games]);
  const byName = useMemo(() => new Map(games.map((g) => [g.title.toLowerCase(), g])), [games]);

  const now = kind ? data[kind] : undefined;
  const list = now?.friends ?? [];
  const count = (k: Kind) => (data[k]?.friends ?? []).filter((f) => f.state !== 'offline').length;

  return (
    <div className="page friends-page">
      <header className="title-row">
        <div>
          <h1>{tr('Arkadaşlar')}</h1>
          {now && (
            <p className="title-meta">
              {list.filter((f) => f.state === 'in-game').length} {tr('oyunda ·')} {list.filter((f) => f.state !== 'offline').length} {tr('çevrimiçi ·')} {list.length} {tr('arkadaş')}
              {!demo ? <> · {ago(new Date(now.checkedAt * 1000)).toLocaleLowerCase(locale)} {tr('bakıldı')}</> : null}
            </p>
          )}
        </div>
        {kind && live && !demo && (
          <button className="btn" onClick={() => load(kind)} disabled={busy}><RefreshCw size={15} strokeWidth={1.8} className={busy ? 'spin' : ''} /> {tr('Yenile')}</button>
        )}
      </header>

      {tabs.length > 0 && (
        <div className="fr-tabs" role="tablist" aria-label={tr('Platform')}>
          {tabs.map((k) => (
            <button key={k} role="tab" aria-selected={k === kind} className={`fr-tab is-${k}`} onClick={() => setTab(k)}>
              <PlatformLogo id={k} size={16} /> {k === 'steam' ? tr('Steam') : tr('Xbox')}
              {data[k] && <span className="fr-tab-n num">{count(k)}</span>}
            </button>
          ))}
        </div>
      )}

      {tabs.length === 0 && <div className="panel empty-panel"><p>{tr('Arkadaşlarını görmek için Steam hesabını bağla.')}</p><button className="btn btn-sm" onClick={() => openSettings('accounts')}>{tr('Hesaplar')}</button></div>}
      {kind === 'xbox' && !xboxOn && (
        <div className="fr-board fr-xbox fr-connect">
          <PlatformLogo id="xbox" size={28} />
          <p>{tr('Xbox arkadaşları OpenXBL anahtarıyla gelir.')}</p>
          <button className="btn btn-sm" onClick={() => openSettings('accounts')}>{tr('Anahtar ekle')}</button>
        </div>
      )}
      {error && <div className="panel empty-panel"><p>{error}</p></div>}
      {kind && live && !now && !error && <div className={`fr-board fr-${kind} fr-loading`} aria-hidden="true"><span /><span /><span /></div>}
      {kind && live && now && <Board kind={kind} friends={list} byApp={byApp} byName={byName} />}
    </div>
  );
}
