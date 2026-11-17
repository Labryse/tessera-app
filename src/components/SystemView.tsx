import { useState } from 'react';
import { FolderSearch, Play, Settings2, TriangleAlert } from 'lucide-react';
import { useStore } from '../store';
import { SystemReal, EmulatorsReal } from './Retro';
import { EMULATORS, GBA_FOLDER, type PlatformId, lastPlayed, statusLabel, totalMinutes, type Game } from '../data/library';
import { Cover } from './bits';
import { ago, bytes, duration } from '../lib/format';

import { t, locale } from '../lib/i18n';
type View = 'box' | 'cart' | 'list';

/** a GBA cartridge drawn in CSS; the label carries the game's title screen */
export function Cartridge({ g }: { g: Game }) {
  const label = g.rom?.title ?? g.rom?.snap ?? g.screenshots[0];
  const [failed, setFailed] = useState(false);
  return (
    <span className="cart" aria-hidden="true">
      <span className="cart-grip" />
      <span className="cart-label">
        {label && !failed ? <img src={label} alt="" loading="lazy" onError={() => setFailed(true)} /> : <span className="cart-label-text">{g.title}</span>}
      </span>
      <span className="cart-strip">{g.title}</span>
    </span>
  );
}

export function SystemView({ id }: { id: PlatformId }) {
  const { demo } = useStore();
  return demo ? <SystemDemo /> : <SystemReal id={id} />;
}

function SystemDemo() {
  const { games, go, launch } = useStore();
  const [view, setView] = useState<View>('cart');
  const roms = games.filter((g) => g.platform === 'gba').sort((a, b) => (lastPlayed(b)?.getTime() ?? 0) - (lastPlayed(a)?.getTime() ?? 0) || a.title.localeCompare(b.title, locale));
  const emu = EMULATORS[0];
  const unmatched = roms.filter((g) => !g.rom?.match);
  const total = roms.reduce((a, g) => a + totalMinutes(g), 0);
  const size = roms.reduce((a, g) => a + (g.rom?.sizeBytes ?? 0), 0);

  return (
    <div className="page">
      <header className="title-row">
        <div>
          <h1>{t('Game Boy Advance')}</h1>
          <p className="title-meta">{roms.length} {t('ROM ·')} {bytes(size)} {t('· Tessera')} {duration(total, { compact: true })} {t('saydı')}</p>
        </div>
        <div className="title-actions">
          <button className="btn"><FolderSearch size={16} strokeWidth={1.6} /> {t('Klasörü tara')}</button>
          <button className="btn" onClick={() => go({ name: 'emulators' })}><Settings2 size={16} strokeWidth={1.6} /> {t('Emülatör')}</button>
        </div>
      </header>

      {unmatched.length > 0 && (
        <div className="notice">
          <TriangleAlert size={16} strokeWidth={1.7} />
          <p>
            <strong>{unmatched.map((g) => g.title).join(', ')}</strong> {t('No-Intro veritabanında yok (romhack). Kapağı ve bilgileri elle seçebilirsin; süre ve notlar yine kaydediliyor.')}
          </p>
          <button className="btn btn-sm" onClick={() => go({ name: 'game', id: unmatched[0].id })}>{t('Bilgileri düzenle')}</button>
        </div>
      )}

      <section className="emu-strip" aria-label={t('Bu sistemin emülatörü')}>
        <div className="emu-cell">
          <span className="sub-label">{t('Emülatör')}</span>
          <span className="emu-main">{emu.name} {emu.version}</span>
        </div>
        <div className="emu-cell emu-wide">
          <span className="sub-label">{t('Yol')}</span>
          <span className="break">{emu.path}</span>
        </div>
        <div className="emu-cell">
          <span className="sub-label">{t('Başlatma')}</span>
          <code>{emu.args}</code>
        </div>
        <div className="emu-cell emu-wide">
          <span className="sub-label">{t('ROM klasörü · izleniyor')}</span>
          <span className="break">{GBA_FOLDER}</span>
        </div>
      </section>

      <div className="toolbar">
        <h2 className="section-title">{t('Oyunlar')}</h2>
        <div className="segmented segmented-text" role="group" aria-label={t('Görünüm')}>
          {([['cart', t('Kartuş')], ['box', t('Kutu')], ['list', t('Liste')]] as [View, string][]).map(([k, l]) => (
            <button key={k} aria-pressed={view === k} onClick={() => setView(k)}>{l}</button>
          ))}
        </div>
      </div>

      {view === 'list' ? (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{t('Oyun')}</th><th>{t('Bölge')}</th><th>{t('Dosya')}</th><th>{t('Tanıma')}</th><th>{t('Durum')}</th><th className="r">{t('Süre')}</th><th>{t('Son oynama')}</th></tr></thead>
            <tbody>
              {roms.map((g) => (
                <tr key={g.id} onClick={() => go({ name: 'game', id: g.id })} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') go({ name: 'game', id: g.id }); }}>
                  <td><span className="cell-game"><span className="cell-thumb is-box"><Cover game={g} /></span><span className="cell-name"><span>{g.title}</span><span className="cell-sub">{g.developer} · {g.year}</span></span></span></td>
                  <td>{g.rom?.region}</td>
                  <td className="muted cell-file">{g.rom?.file}</td>
                  <td>{g.rom?.match ? <span className="muted">{t('No-Intro')}</span> : <span className="warn">{t('Eşleşme yok')}</span>}</td>
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
          {roms.map((g) => (
            <article key={g.id} className="tile">
              <div className="tile-media">
              <button className="tile-hit" onClick={() => go({ name: 'game', id: g.id })} aria-label={g.title}>
                {view === 'cart' ? <Cartridge g={g} /> : <span className="tile-cover is-box-frame"><Cover game={g} /></span>}
              </button>
              <button className="tile-play" onClick={() => launch(g)} aria-label={t('{0} oyna', g.title)}>
                <Play size={16} strokeWidth={2} fill="currentColor" />
              </button>
              </div>
              <div className="tile-text">
                <span className="tile-title">{g.title}</span>
                <span className="tile-meta">
                  <span>{g.year}</span>
                  <span className="num">{totalMinutes(g) ? duration(totalMinutes(g), { compact: true }) : t('Oynanmadı')}</span>
                  {!g.rom?.match && <span className="warn">{t('Romhack')}</span>}
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

const CATALOG = [
  { name: 'mGBA', systems: t('GBA, GB, GBC'), found: true, ra: t('Yok (bağımsız sürüm)') },
  { name: t('RetroArch'), systems: t('Çekirdeğe göre, 40+ sistem'), found: false, ra: t('Var') },
  { name: t('DuckStation'), systems: t('PlayStation'), found: false, ra: t('Var') },
  { name: 'PCSX2', systems: t('PlayStation 2'), found: false, ra: t('Var') },
  { name: 'PPSSPP', systems: 'PSP', found: false, ra: t('Var') },
  { name: t('Dolphin'), systems: t('GameCube, Wii'), found: false, ra: t('Var') },
  { name: 'melonDS', systems: t('Nintendo DS'), found: false, ra: t('Yok') },
];

export function EmulatorsView() {
  const { demo } = useStore();
  return demo ? <EmulatorsDemo /> : <EmulatorsReal />;
}

function EmulatorsDemo() {
  const emu = EMULATORS[0];
  return (
    <div className="page">
      <header className="title-row">
        <div>
          <h1>{t('Emülatörler')}</h1>
          <p className="title-meta">{t('1 kurulu · 7 tanınan emülatör')}</p>
        </div>
      </header>

      <section className="panel emu-card">
        <div className="panel-head">
          <h2 className="panel-title">{emu.name} {emu.version}</h2>
          <span className="ok">{t('Bulundu')}</span>
        </div>
        <dl className="facts facts-wide">
          <div><dt>{t('Yol')}</dt><dd className="break">{emu.path}</dd></div>
          <div><dt>{t('Sistemler')}</dt><dd>{t('Game Boy Advance, Game Boy, Game Boy Color')}</dd></div>
          <div><dt>{t('Uzantılar')}</dt><dd>{emu.extensions.join('  ')}</dd></div>
          <div><dt>{t('Profil: Varsayılan')}</dt><dd><code>{emu.path.split('\\').pop()} {emu.args}</code></dd></div>
          <div><dt>{t('Profil: Pencerede')}</dt><dd><code>{emu.path.split('\\').pop()} "{'{rom}'}"</code></dd></div>
          <div><dt>{t('Başarımlar')}</dt><dd>{t('RetroAchievements bu sürümde yok. Başarım için RetroArch’ı mGBA çekirdeğiyle ekle; Tessera aynı ROM’u o profille açar.')}</dd></div>
        </dl>
      </section>

      <h2 className="section-title">{t('Tanınan emülatörler')}</h2>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>{t('Emülatör')}</th><th>{t('Sistemler')}</th><th>{t('RetroAchievements')}</th><th>{t('Durum')}</th><th /></tr></thead>
          <tbody>
            {CATALOG.map((c) => (
              <tr key={c.name}>
                <td>{c.name}</td>
                <td className="muted">{c.systems}</td>
                <td className="muted">{c.ra}</td>
                <td>{c.found ? <span className="ok">{t('Kurulu')}</span> : <span className="muted">{t('Bulunamadı')}</span>}</td>
                <td className="r">{!c.found && <button className="btn btn-sm">{t('Yolu göster')}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
