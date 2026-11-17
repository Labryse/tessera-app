// Emulators, ROM folders and save sync (desktop), and a system's shelf of games.
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { Cpu, FolderPlus, FolderSearch, Play, Plus, RefreshCw, Settings2, Trash2 } from 'lucide-react';
import { useStore } from '../store';
import { CARTRIDGE, PLATFORMS, lastPlayed, statusLabel, totalMinutes, type PlatformId } from '../data/library';
import { api, type Emulator, type FoundEmu, type RetroSystem, type RomFolder, type RomScan } from '../lib/backend';
import { Cover } from './bits';
import { SaveSync } from './SaveSync';
import { Cartridge } from './SystemView';
import { ago, bytes, duration } from '../lib/format';

import { t, locale } from '../lib/i18n';
const sysName = (id: string) => PLATFORMS[id as PlatformId]?.name ?? id;
const sysShort = (id: string) => PLATFORMS[id as PlatformId]?.short ?? id;

export const scanText = (r: RomScan) =>
  t('{0} ROM bulundu · {1} tanındı{2}{3}', r.total, r.matched, r.added ? t(' · {0} yeni', r.added) : '', r.restored ? t(' · {0} kayıt buluttan geldi', r.restored) : '');

function useRetroData() {
  const [emus, setEmus] = useState<Emulator[]>([]);
  const [folders, setFolders] = useState<RomFolder[]>([]);
  const [systems, setSystems] = useState<RetroSystem[]>([]);
  const load = useCallback(async () => {
    const [e, f, s] = await Promise.all([api.listEmulators(), api.listRomFolders(), api.retroSystems()]);
    setEmus(e); setFolders(f); setSystems(s);
  }, []);
  useEffect(() => { load().catch(() => {}); }, [load]);
  return { emus, folders, systems, load };
}

// ---------------------------------------------------------------- Emulators page

export function EmulatorsReal() {
  const { refresh, notify } = useStore();
  const { emus, folders, systems, load } = useRetroData();
  const [found, setFound] = useState<FoundEmu[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => { api.detectEmulators().then(setFound).catch(() => setFound([])); }, [emus.length]);

  const addEmu = async (path: string) => {
    try { const e = await api.addEmulator(path); notify(t('{0} eklendi', e.name)); await load(); } catch (err) { notify(String(err)); }
  };
  const browseEmu = async () => {
    const p = await open({ multiple: false, title: t('Emülatörün .exe dosyasını seç'), filters: [{ name: t('Emülatör'), extensions: ['exe'] }] });
    if (typeof p === 'string') addEmu(p);
  };
  const rescan = async (f: RomFolder) => {
    setBusy(`f${f.id}`);
    try { const r = await api.rescanRomFolder(f.id); await Promise.all([load(), refresh()]); notify(scanText(r)); } catch (err) { notify(String(err)); }
    setBusy(null);
  };
  const removeFolder = async (f: RomFolder) => {
    await api.removeRomFolder(f.id, false);
    await Promise.all([load(), refresh()]);
    notify(t('Klasör kaldırıldı; oyunlar ve notların kütüphanede kaldı'));
  };

  return (
    <div className="page retro">
      <header className="title-row">
        <div>
          <h1>{t('Emülatörler')}</h1>
          <p className="title-meta">{emus.length ? t('{0} emülatör', emus.length) : t('Emülatör yok')} · {folders.length ? t('{0} oyun klasörü', folders.length) : t('oyun klasörü yok')}</p>
        </div>
      </header>

      <section className="retro-sec">
        <div className="retro-sec-head">
          <h2 className="section-title">{t('Emülatörler')}</h2>
          <button className="btn btn-sm" onClick={browseEmu}><Plus size={14} strokeWidth={1.8} /> {t('Elle ekle')}</button>
        </div>
        {emus.length === 0 && !found?.length && (
          <button className="folder-cta" onClick={browseEmu}>
            <Cpu size={26} strokeWidth={1.4} />
            <span className="folder-cta-title">{t('Emülatör ekle')}</span>
            <span className="muted">{t('mGBA, RetroArch, DuckStation, PCSX2, PPSSPP, Dolphin gibi bir emülatörün programını seç.')}</span>
          </button>
        )}
        <div className="emu-cards">
          {emus.map((e, i) => <EmuCard key={e.id} e={e} i={i} onChange={load} />)}
          {found?.map((f) => (
            <div key={f.path} className="emu-card2 is-found" title={f.path}>
              <EmuArt icon={f.icon} />
              <div className="emu-body">
                <span className="emu-name">{f.name}</span>
                <span className="emu-plays">{t('Bilgisayarında bulundu')}</span>
              </div>
              <div className="emu-actions">
                <button className="btn btn-sm btn-primary" onClick={() => addEmu(f.path)}><Plus size={13} strokeWidth={2} /> {t('Ekle')}</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="retro-sec">
        <div className="retro-sec-head">
          <h2 className="section-title">{t('Oyun klasörleri')}</h2>
          <button className="btn btn-sm" onClick={() => setAdding(true)} disabled={adding}><FolderPlus size={14} strokeWidth={1.8} /> {t('Klasör ekle')}</button>
        </div>
        {adding && <AddFolder systems={systems} emus={emus} onDone={async (r) => { setAdding(false); if (r) { await Promise.all([load(), refresh()]); notify(scanText(r)); } }} />}
        {folders.length === 0 && !adding && (
          <button className="folder-cta" onClick={() => setAdding(true)}>
            <FolderPlus size={26} strokeWidth={1.4} />
            <span className="folder-cta-title">{t('Oyun klasörünü ekle')}</span>
            <span className="muted">{t('Oyunların (ROM’ların) durduğu klasörü seç. Tessera hepsini tanır, kapaklarını bulur ve kütüphanene ekler.')}</span>
          </button>
        )}
        <ul className="folder-list">
          {folders.map((f) => {
            const options = emus.filter((e) => e.systems.includes(f.system));
            return (
              <li key={f.id} className="folder-row">
                <span className="folder-sys">{sysShort(f.system)}</span>
                <span className="folder-text">
                  <span className="folder-path">{f.path}</span>
                  <span className="muted small">{sysName(f.system)} · {f.games} {t('oyun')}</span>
                </span>
                <label className="field folder-emu">
                  <span className="sr-only">{t('Emülatör')}</span>
                  <select value={f.emulatorId ?? ''} onChange={async (ev) => { await api.setFolderEmulator(f.id, ev.target.value || null); load(); }}>
                    <option value="">{options[0] ? t('Otomatik ({0})', options[0].name) : t('Emülatör yok')}</option>
                    {options.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </label>
                <button className="icon-btn" aria-label={t('Yeniden tara')} title={t('Yeniden tara')} onClick={() => rescan(f)} disabled={busy === `f${f.id}`}>
                  <RefreshCw size={16} strokeWidth={1.7} className={busy === `f${f.id}` ? 'spin' : ''} />
                </button>
                <button className="icon-btn" aria-label={t('Klasörü kaldır')} title={t('Klasörü kaldır')} onClick={() => removeFolder(f)}><Trash2 size={16} strokeWidth={1.7} /></button>
              </li>
            );
          })}
        </ul>
      </section>

      <SaveSync />
    </div>
  );
}

/** "Game Boy Advance, Game Boy ve Game Boy Color" */
const systemsLine = (ids: string[]) => {
  const n = ids.map(sysName);
  return n.length > 1 ? t('{0} ve {1}', n.slice(0, -1).join(', '), n[n.length - 1]) : n[0] ?? '';
};

function EmuArt({ icon }: { icon: string | null }) {
  return <span className="emu-art">{icon ? <img src={icon} alt="" /> : <Cpu size={24} strokeWidth={1.5} />}</span>;
}

function EmuCard({ e, i, onChange }: { e: Emulator; i: number; onChange: () => void }) {
  const { notify } = useStore();
  const [args, setArgs] = useState(e.args);
  const [more, setMore] = useState(false);
  const save = async () => { if (args !== e.args) { await api.setEmulatorArgs(e.id, args); notify(t('Kaydedildi')); onChange(); } };
  const openIt = async () => { try { await api.openEmulator(e.id); notify(t('{0} açılıyor', e.name)); } catch (err) { notify(String(err)); } };
  return (
    <div className="emu-card2" style={{ '--i': i } as CSSProperties} title={e.path}>
      <EmuArt icon={e.icon} />
      <div className="emu-body">
        <span className="emu-name">{e.name}</span>
        <span className="emu-plays">{systemsLine(e.systems)} {t('oyunlarını açar')}</span>
      </div>
      <div className="emu-actions">
        <button className="btn btn-sm" onClick={openIt}><Play size={13} strokeWidth={2} fill="currentColor" /> {t('Aç')}</button>
        <button className={`icon-btn ${more ? 'is-on' : ''}`} aria-label={t('Ayarlar')} aria-expanded={more} onClick={() => setMore((v) => !v)}><Settings2 size={16} strokeWidth={1.7} /></button>
      </div>
      {more && (
        <div className="emu-more">
          <label className="emu-args">
            <span className="sub-label">{t('Gelişmiş: başlatma ayarı')}</span>
            <input value={args} onChange={(ev) => setArgs(ev.target.value)} onBlur={save} spellCheck={false} aria-label={t('{0} başlatma ayarı', e.name)} />
          </label>
          <button className="btn btn-sm btn-ghost emu-remove" onClick={async () => { await api.removeEmulator(e.id); notify(t('{0} kaldırıldı', e.name)); onChange(); }}><Trash2 size={14} strokeWidth={1.7} /> {t('Kaldır')}</button>
        </div>
      )}
    </div>
  );
}

function AddFolder({ systems, emus, onDone }: { systems: RetroSystem[]; emus: Emulator[]; onDone: (r: RomScan | null) => void }) {
  const [path, setPath] = useState<string | null>(null);
  const [system, setSystem] = useState('gba');
  const [emu, setEmu] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = emus.filter((e) => e.systems.includes(system));

  const pick = async () => {
    const p = await open({ directory: true, multiple: false, title: t('ROM klasörünü seç') });
    if (typeof p === 'string') {
      setPath(p);
      // guess the system from the folder name ("GBA ROMS", "PS1", "snes")
      const n = p.toLowerCase();
      const guess = ['gba', 'gbc', 'nds', 'n64', 'snes', 'nes', 'psp', 'ps2', 'ps1', 'genesis', 'gc', 'gb'].find((id) => n.includes(id) || n.includes(sysName(id).toLowerCase()));
      if (guess) setSystem(guess);
    }
  };
  const go = async () => {
    if (!path) return;
    setBusy(true); setError(null);
    try { onDone(await api.addRomFolder(path, system, emu || null)); } catch (err) { setError(String(err)); setBusy(false); }
  };

  return (
    <div className="add-folder">
      <button className={`pick-file ${path ? 'has' : ''}`} onClick={pick}>
        <FolderSearch size={18} strokeWidth={1.6} />
        <span className="pick-file-text">{path ?? t('Klasör seç')}</span>
        <span className="muted small">{path ? t('Değiştir') : t('Gözat')}</span>
      </button>
      <div className="add-folder-row">
        <label className="field">
          <span className="sub-label">{t('Sistem')}</span>
          <select value={system} onChange={(e) => { setSystem(e.target.value); setEmu(''); }}>
            {systems.map((s) => <option key={s.id} value={s.id}>{sysName(s.id)}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="sub-label">{t('Emülatör')}</span>
          <select value={emu} onChange={(e) => setEmu(e.target.value)}>
            <option value="">{options[0] ? t('Otomatik ({0})', options[0].name) : t('Sonra seçerim')}</option>
            {options.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </label>
        <span className="add-folder-actions">
          <button className="btn btn-ghost" onClick={() => onDone(null)} disabled={busy}>{t('Vazgeç')}</button>
          <button className="btn btn-primary" onClick={go} disabled={!path || busy}>
            {busy ? <><RefreshCw size={14} strokeWidth={1.7} className="spin" /> {t('Taranıyor')}</> : t('Ekle ve tara')}
          </button>
        </span>
      </div>
      {error && <p className="warn small" role="alert">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- a system's games

type View = 'cart' | 'box' | 'list';

export function SystemReal({ id }: { id: PlatformId }) {
  const { games, go, launch, openMenu, refresh, notify } = useStore();
  const cart = CARTRIDGE.has(id);
  const [view, setView] = useState<View>(cart ? 'cart' : 'box');
  const [busy, setBusy] = useState(false);
  const { emus, folders, load } = useRetroData();
  const mine = folders.filter((f) => f.system === id);
  const roms = useMemo(() => games.filter((g) => g.platform === id && g.installed)
    .sort((a, b) => (lastPlayed(b)?.getTime() ?? 0) - (lastPlayed(a)?.getTime() ?? 0) || a.title.localeCompare(b.title, locale)), [games, id]);
  const emu = emus.find((e) => mine[0]?.emulatorId ? e.id === mine[0].emulatorId : e.systems.includes(id));
  const unmatched = roms.filter((g) => !g.rom?.match).length;

  const rescan = async () => {
    setBusy(true);
    try {
      let last: RomScan | null = null;
      for (const f of mine) last = await api.rescanRomFolder(f.id);
      await Promise.all([load(), refresh()]);
      if (last) notify(scanText(last));
    } catch (err) { notify(String(err)); }
    setBusy(false);
  };

  return (
    <div className="page">
      <header className="title-row">
        <div>
          <h1>{sysName(id)}</h1>
          <p className="title-meta">{roms.length} {t('oyun')}{emu ? ` · ${emu.name}` : t(' · emülatör seçilmedi')}{unmatched ? t(' · {0} tanınmadı', unmatched) : ''}</p>
        </div>
        <div className="title-actions">
          {mine.length > 0 && <button className="btn" onClick={rescan} disabled={busy}><RefreshCw size={16} strokeWidth={1.6} className={busy ? 'spin' : ''} /> {t('Yeniden tara')}</button>}
          <button className="btn" onClick={() => go({ name: 'emulators' })}><Cpu size={16} strokeWidth={1.6} /> {t('Emülatörler')}</button>
        </div>
      </header>

      {!emu && <div className="notice"><p>{t('Bu sistemin oyunlarını açmak için bir emülatör ekle.')}</p><button className="btn btn-sm" onClick={() => go({ name: 'emulators' })}>{t('Emülatör ekle')}</button></div>}

      <div className="toolbar">
        <h2 className="section-title">{t('Oyunlar')}</h2>
        <div className="segmented segmented-text" role="group" aria-label={t('Görünüm')}>
          {(cart ? [['cart', t('Kartuş')], ['box', t('Kutu')], ['list', t('Liste')]] : [['box', t('Kutu')], ['list', t('Liste')]]).map(([k, l]) => (
            <button key={k} aria-pressed={view === k} onClick={() => setView(k as View)}>{l}</button>
          ))}
        </div>
      </div>

      {roms.length === 0 ? (
        <div className="empty"><p>{t('Bu sistem için oyun yok.')}</p><button className="btn" onClick={() => go({ name: 'emulators' })}>{t('ROM klasörü ekle')}</button></div>
      ) : view === 'list' ? (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{t('Oyun')}</th><th>{t('Bölge')}</th><th>{t('Dosya')}</th><th>{t('Tanıma')}</th><th>{t('Durum')}</th><th className="r">{t('Süre')}</th><th>{t('Son oynama')}</th></tr></thead>
            <tbody>
              {roms.map((g) => (
                <tr key={g.id} onClick={() => go({ name: 'game', id: g.id })} onContextMenu={(e) => { e.preventDefault(); openMenu({ x: e.clientX, y: e.clientY, id: g.id }); }} tabIndex={0}>
                  <td><span className="cell-game"><span className="cell-thumb is-box"><Cover game={g} /></span><span className="cell-name"><span>{g.title}</span><span className="cell-sub">{g.rom ? bytes(g.rom.sizeBytes) : ''}</span></span></span></td>
                  <td>{g.rom?.region}</td>
                  <td className="muted cell-file">{g.rom?.file}</td>
                  <td>{g.rom?.match ? <span className="muted">{g.rom.db ?? t('No-Intro')}</span> : <span className="warn">{t('Tanınmadı')}</span>}</td>
                  <td><span className={`status status-${g.status}`}>{statusLabel(g.status)}</span></td>
                  <td className="r num">{totalMinutes(g) ? duration(totalMinutes(g), { compact: true }) : <span className="dash">—</span>}</td>
                  <td className="muted">{ago(lastPlayed(g))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={view === 'cart' ? 'cart-grid' : 'box-grid'}>
          {roms.map((g, i) => (
            <article key={g.id} className="tile tile-in" style={{ '--i': Math.min(i, 24) } as CSSProperties}
              onContextMenu={(e) => { e.preventDefault(); openMenu({ x: e.clientX, y: e.clientY, id: g.id }); }}>
              <div className="tile-media">
                <button className="tile-hit" onClick={() => go({ name: 'game', id: g.id })} aria-label={g.title}>
                  {view === 'cart' ? <Cartridge g={g} /> : <span className="tile-cover is-box-frame"><Cover game={g} /></span>}
                </button>
                <button className="tile-play" onClick={() => launch(g)} aria-label={t('{0} oyna', g.title)}><Play size={16} strokeWidth={2} fill="currentColor" /></button>
              </div>
              <div className="tile-text">
                <span className="tile-title">{g.title}</span>
                <span className="tile-meta">
                  {g.rom?.region && g.rom.region !== '—' && <span>{g.rom.region}</span>}
                  <span className="num">{totalMinutes(g) ? duration(totalMinutes(g), { compact: true }) : t('Oynanmadı')}</span>
                  {!g.rom?.match && <span className="warn">{t('Tanınmadı')}</span>}
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
