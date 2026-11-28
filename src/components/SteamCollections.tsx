// Brings the collections made in the Steam library over as Tessera categories.
// Steam's client keeps them in its own files on this PC, so nothing goes online.
// Running it again only adds what is missing: games already filed stay filed.
import { useEffect, useMemo, useState } from 'react';
import { Check, RefreshCw } from 'lucide-react';
import { useStore } from '../store';
import { api } from '../lib/backend';
import type { Game } from '../data/library';
import { Modal } from './Modal';
import { t, locale } from '../lib/i18n';

type Found = { collections: { name: string; apps: number[] }[]; favorites: number[] };

/** Tessera ids for Steam apps; a merged game answers for the Steam copy inside it */
function byApp(games: Game[]) {
  const m = new Map<number, string>();
  for (const g of games) {
    const ids = [g.id, ...(g.mergedFrom?.map((c) => c.id) ?? [])];
    for (const id of ids) if (id.startsWith('steam:')) m.set(Number(id.slice(6)), g.id);
  }
  return m;
}

export function SteamCollections({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { games, collections, addCollection, update, notify, go } = useStore();
  const [found, setFound] = useState<Found | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [favs, setFavs] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setFound(null); setError(null);
    api.steamCollections()
      .then((r) => { if (!live) return; setFound(r); setPicked(new Set(r.collections.map((c) => c.name))); })
      .catch((err) => { if (live) setError(String(err)); });
    return () => { live = false; };
  }, [open]);

  const ids = useMemo(() => byApp(games), [games]);
  const rows = useMemo(() => (found?.collections ?? []).map((c) => {
    const inLib = [...new Set(c.apps.map((a) => ids.get(a)).filter((x): x is string => !!x))];
    const have = collections.find((x) => x.id.toLocaleLowerCase(locale) === c.name.toLocaleLowerCase(locale));
    return { ...c, inLib, have };
  }), [found, ids, collections]);
  const favIds = useMemo(() => (found?.favorites ?? []).map((a) => ids.get(a)).filter((x): x is string => !!x), [found, ids]);
  const newFavs = favIds.filter((id) => !games.find((g) => g.id === id)?.favorite);

  const usable = rows.filter((r) => r.inLib.length > 0 && !r.have?.filter);
  const chosen = usable.filter((r) => picked.has(r.name));
  const toggle = (name: string) => setPicked((s) => { const n = new Set(s); if (n.has(name)) n.delete(name); else n.add(name); return n; });

  const run = () => {
    setBusy(true);
    // one write per game, with every category it joins, so no change overwrites another
    const join = new Map<string, Set<string>>();
    for (const r of chosen) {
      const name = r.have?.id ?? r.name;
      if (!r.have) addCollection(name);
      for (const id of r.inLib) (join.get(id) ?? join.set(id, new Set()).get(id)!).add(name);
    }
    const star = new Set(favs ? newFavs : []);
    for (const id of new Set([...join.keys(), ...star])) {
      const add = join.get(id) ?? new Set<string>();
      update(id, (g) => ({
        collections: [...g.collections, ...[...add].filter((c) => !g.collections.includes(c))],
        ...(star.has(id) ? { favorite: true } : {}),
      }));
    }
    setBusy(false);
    onClose();
    notify(chosen.length ? t('Steam’den {0} kategori aktarıldı', chosen.length) : t('Steam favorileri eklendi'));
    if (chosen.length === 1) go({ name: 'library', scope: { kind: 'collection', id: chosen[0].have?.id ?? chosen[0].name } });
  };

  return (
    <Modal open={open} onClose={busy ? undefined : onClose} label={t('Steam kategorileri')} title={t('Steam kategorileri')} size="md" className="scan steam-colls">
      {!found && !error && <p className="scan-state"><RefreshCw size={16} strokeWidth={1.7} className="spin" /> {t('Steam kütüphanen okunuyor…')}</p>}
      {error && <p className="warn small" role="alert">{error}</p>}
      {found && rows.length === 0 && <p className="scan-state">{t('Steam’de kendi oluşturduğun bir koleksiyon bulunamadı.')}</p>}
      {rows.length > 0 && (
        <div className="scan-list">
          <ul className="scan-group">
            {rows.map((r) => {
              const off = r.inLib.length === 0 || !!r.have?.filter;
              const on = !off && picked.has(r.name);
              return (
                <li key={r.name}>
                  <button className={`scan-item ${on ? 'is-on' : ''} ${off ? 'is-known' : ''}`} disabled={off} onClick={() => toggle(r.name)} aria-pressed={on}>
                    <span className="coll-box">{on && <Check size={12} strokeWidth={2.4} />}</span>
                    <span className="scan-title">{r.name}</span>
                    <span className="muted small num">
                      {r.have?.filter ? t('Aynı adda dinamik kategori var')
                        : r.inLib.length === 0 ? t('Kütüphanede yok')
                        : r.have ? t('{0} oyun · var olana eklenir', r.inLib.length)
                        : t('{0} oyun', r.inLib.length)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {newFavs.length > 0 && (
        <label className="check steam-colls-fav">
          <input type="checkbox" checked={favs} onChange={(e) => setFavs(e.target.checked)} />
          {t('Steam favorilerini de favorilere ekle ({0})', newFavs.length)}
        </label>
      )}
      <div className="dialog-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>{t('Vazgeç')}</button>
        <button className="btn btn-primary" onClick={run} disabled={busy || (chosen.length === 0 && !(favs && newFavs.length))}>
          {chosen.length ? t('{0} kategoriyi aktar', chosen.length) : t('Favorileri aktar')}
        </button>
      </div>
    </Modal>
  );
}
