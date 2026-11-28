import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { Bug, CloudUpload, Check, Database, Download, Upload, Info, LayoutGrid, Link2, Palette, Play, Volume2, X } from 'lucide-react';
import { useStore, THEMES, type SettingsSection, type ThemeId } from '../store';
import { Modal } from './Modal';
import { AccountsPanel } from './AccountsReal';
import { SaveSync } from './SaveSync';
import { Mark } from './bits';
import { api, isDesktop, type ShellPrefs } from '../lib/backend';
import { WELCOME_EVENT } from './Welcome';
import { REPORT_EVENT } from './ErrorReport';
import { CustomThemes } from './ThemeStudio';
import { setCustom, useCustomThemes } from '../lib/customThemes';

import { t as tr, LANGS, lang, setLang, type Lang } from '../lib/i18n';
const SECTIONS: { id: SettingsSection; label: string; icon: ReactNode }[] = [
  { id: 'appearance', label: tr('Görünüm'), icon: <Palette size={16} strokeWidth={1.6} /> },
  { id: 'accounts', label: tr('Hesaplar'), icon: <Link2 size={16} strokeWidth={1.6} /> },
  { id: 'saves', label: tr('Kayıt senkronu'), icon: <CloudUpload size={16} strokeWidth={1.6} /> },
  { id: 'startup', label: tr('Açılış ve arka plan'), icon: <Volume2 size={16} strokeWidth={1.6} /> },
  { id: 'library', label: tr('Kütüphane'), icon: <LayoutGrid size={16} strokeWidth={1.6} /> },
  { id: 'data', label: tr('Veri ve gizlilik'), icon: <Database size={16} strokeWidth={1.6} /> },
  { id: 'about', label: tr('Hakkında'), icon: <Info size={16} strokeWidth={1.6} /> },
];

/** colours for the little window drawn on each theme card */
const PREVIEW: Record<ThemeId, { ground: string; surface: string; raised: string; text: string; accent: string; bg?: string; radius?: number; edge?: string }> = {
  graphite: { ground: '#141414', surface: '#1a1a1a', raised: '#2a2a2a', text: '#ecebe8', accent: '#a9bdd1' },
  linen: { ground: '#efeeeb', surface: '#fbfbfa', raised: '#e6e4e0', text: '#1b1a18', accent: '#3a6585' },
  sorbet: { ground: '#f6f0fb', surface: 'rgba(255,253,255,0.86)', raised: '#efe4f8', text: '#2d2438', accent: '#a26ad0', radius: 9,
    bg: tr('radial-gradient(60% 60% at 0% 0%, #ffd9e6, transparent 70%), radial-gradient(60% 60% at 100% 0%, #d8ecff, transparent 70%), radial-gradient(70% 60% at 70% 100%, #d6f5e6, transparent 70%), #f6f0fb') },
  synth: { ground: '#0b0817', surface: 'rgba(17,12,34,0.92)', raised: '#261c47', text: '#f3edff', accent: '#ff4fd8', edge: 'rgba(255,79,216,0.45)',
    bg: 'radial-gradient(70% 60% at 100% 0%, rgba(255,79,216,0.35), transparent 70%), radial-gradient(60% 60% at 0% 100%, rgba(63,242,220,0.25), transparent 70%), repeating-linear-gradient(0deg, rgba(124,92,255,0.18) 0 1px, transparent 1px 10px), repeating-linear-gradient(90deg, rgba(124,92,255,0.18) 0 1px, transparent 1px 10px), #0b0817' },
  bauhaus: { ground: '#efe8da', surface: '#fbf7ef', raised: '#e7dfcf', text: '#161514', accent: '#d63a2b', radius: 1, edge: '#161514',
    bg: 'radial-gradient(circle at 0 0, #d63a2b 0 26px, transparent 27px), radial-gradient(circle at 100% 100%, #2456a6 0 24px, transparent 25px), linear-gradient(#f2b51f, #f2b51f) right 10px top 0 / 6px 34px no-repeat, #efe8da' },
  abyss: { ground: '#031018', surface: 'rgba(6,24,33,0.88)', raised: '#113543', text: '#e0f3f4', accent: '#4fe0c6',
    bg: 'radial-gradient(60% 50% at 20% 15%, rgba(40,140,160,0.55), transparent 70%), radial-gradient(60% 50% at 85% 40%, rgba(30,80,160,0.5), transparent 70%), #031018' },
  ember: { ground: '#130e0b', surface: '#1a1410', raised: '#2f241c', text: '#f6eadf', accent: '#ff9c52',
    bg: 'radial-gradient(90% 60% at 50% 115%, rgba(255,120,40,0.4), transparent 70%), #130e0b' },
  phosphor: { ground: '#050806', surface: '#081009', raised: '#132617', text: '#b6ffc8', accent: '#39ff7a', radius: 1, edge: '#1f5a33',
    bg: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.35) 0 1px, transparent 1px 3px), radial-gradient(90% 80% at 50% 40%, #0d1f12, #030503)' },
  aero: { ground: '#9fd6f7', surface: 'rgba(255,255,255,0.75)', raised: '#d6ecfb', text: '#0f2a40', accent: '#0a84d6', radius: 10, edge: 'rgba(255,255,255,0.95)',
    bg: 'radial-gradient(80% 40% at 20% 110%, rgba(120,210,90,0.7), transparent 70%), linear-gradient(180deg, #5bb4ee, #dff1fb)' },
  press: { ground: '#e9e3d6', surface: '#faf8f2', raised: '#efeadf', text: '#121110', accent: '#c8102e', radius: 0, edge: '#1b1916' },
};

function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <div className="set-row">
      <span className="set-text">
        <span className="set-label">{label}</span>
        {hint && <span className="set-hint">{hint}</span>}
      </span>
      <button role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? 'is-on' : ''}`} onClick={() => onChange(!on)}>
        <span className="switch-knob" />
      </button>
    </div>
  );
}

function Choice<T extends string>({ label, hint, value, options, onChange }: { label: string; hint?: string; value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="set-row">
      <span className="set-text">
        <span className="set-label">{label}</span>
        {hint && <span className="set-hint">{hint}</span>}
      </span>
      <div className="segmented segmented-text" role="group" aria-label={label}>
        {options.map((o) => <button key={o.id} aria-pressed={value === o.id} onClick={() => onChange(o.id)}>{o.label}</button>)}
      </div>
    </div>
  );
}

export function SettingsPanel() {
  const { settings, openSettings, closeSettings, demo } = useStore();
  const section = settings ?? 'appearance';
  return (
    <Modal open={settings !== null} onClose={closeSettings} label={tr('Ayarlar')} size="xl" bare className="settings">
      <nav className="settings-nav" aria-label={tr('Ayar bölümleri')}>
        <div className="settings-brand"><Mark size={20} /> {tr('Ayarlar')}</div>
        {SECTIONS.map((s) => (
          <button key={s.id} className={`nav-item ${section === s.id ? 'is-active' : ''}`} aria-current={section === s.id ? 'page' : undefined} onClick={() => openSettings(s.id)}>
            <span className="nav-icon">{s.icon}</span><span className="nav-label">{s.label}</span>
          </button>
        ))}
      </nav>
      <div className="settings-body">
        <div className="settings-head">
          <h2 className="modal-title">{SECTIONS.find((s) => s.id === section)!.label}</h2>
          <button className="icon-btn modal-close" data-close aria-label={tr('Kapat')} onClick={closeSettings}><X size={16} strokeWidth={1.7} /></button>
        </div>
        <div className="settings-content" key={section}>
          {section === 'appearance' && <Appearance />}
          {section === 'accounts' && <AccountsPanel />}
          {section === 'saves' && (demo ? <p className="muted">{tr('Kayıt senkronu masaüstü uygulamasında çalışır.')}</p> : <SaveSync bare />)}
          {section === 'startup' && <Startup />}
          {section === 'library' && <LibraryPrefs />}
          {section === 'data' && <DataPrefs />}
          {section === 'about' && <About />}
        </div>
      </div>
    </Modal>
  );
}

function Appearance() {
  const { theme: base, setTheme, prefs, setPref } = useStore();
  const { active } = useCustomThemes();
  const theme = active ? null : base;
  return (
    <div className="settings-stack">
      <div className="theme-grid" role="radiogroup" aria-label={tr('Tema')}>
        {THEMES.map((t, i) => {
          const p = PREVIEW[t.id];
          return (
            <button key={t.id} role="radio" aria-checked={theme === t.id} className={`theme-card ${theme === t.id ? 'is-on' : ''}`}
              onClick={() => { setCustom(null); setTheme(t.id); }} style={{ '--i': i } as CSSProperties}>
              <span className="theme-mini" style={{ background: p.bg ?? p.ground }} aria-hidden="true">
                <span className="theme-mini-side">
                  <span style={{ background: p.text, opacity: 0.8, width: '60%' }} />
                  <span style={{ background: p.raised }} />
                  <span style={{ background: p.text, opacity: 0.35 }} />
                  <span style={{ background: p.text, opacity: 0.35, width: '70%' }} />
                </span>
                <span className="theme-mini-sheet" style={{ background: p.surface, borderRadius: p.radius, boxShadow: p.edge ? `0 0 0 1px ${p.edge}` : undefined }}>
                  <span className="theme-mini-title" style={{ background: p.text }} />
                  <span className="theme-mini-tiles">
                    {[0, 1, 2, 3].map((k) => <span key={k} style={{ background: k === 1 ? p.accent : p.raised }} />)}
                  </span>
                </span>
              </span>
              <span className="theme-card-foot">
                <span><span className="theme-card-name">{t.name}</span><span className="theme-card-note">{t.note}</span></span>
                {theme === t.id && <Check size={16} strokeWidth={2} />}
              </span>
            </button>
          );
        })}
      </div>
      <CustomThemes />
      <div className="set-group">
        <Choice<Lang> label={tr('Dil')} value={lang} options={LANGS.map((l) => ({ id: l.id, label: l.name }))} onChange={(v) => { if (v !== lang) void setLang(v, 'settings:appearance'); }} />
        <Choice label={tr('Animasyonlar')} value={prefs.motion}
          options={[{ id: 'full', label: tr('Tam') }, { id: 'reduced', label: tr('Az') }]} onChange={(v) => setPref('motion', v)} />
      </div>
    </div>
  );
}

/** tray, start with Windows, notifications (desktop only) */
function Background() {
  const { demo, notify } = useStore();
  const [p, setP] = useState<ShellPrefs | null>(null);
  useEffect(() => { if (!demo) api.shellPrefs().then(setP).catch(() => {}); }, [demo]);
  if (demo || !p) return null;
  const set = (k: keyof ShellPrefs, v: boolean) => {
    setP({ ...p, [k]: v });
    api.shellSet(k, v).catch((e) => { setP(p); notify(String(e)); });
  };
  return (
    <div className="set-group">
      <Toggle label={tr('Windows açılınca başlat')} hint={tr('Tepside sessizce açılır; süreler ve istek listesi takip edilir')} on={p.autostart} onChange={(v) => set('autostart', v)} />
      <Toggle label={tr('Kapatınca tepside çalışsın')} hint={p.closeToTray ? tr('Pencereyi kapatmak Tessera’yı kapatmaz; çıkmak için tepsi simgesine sağ tıkla') : tr('Pencereyi kapatmak Tessera’yı kapatır')} on={p.closeToTray} onChange={(v) => set('closeToTray', v)} />
      <Toggle label={tr('İstek listesi bildirimleri')} hint={tr('İndirime giren ya da çıkan oyunlar için Windows bildirimi')} on={p.notifyWishlist} onChange={(v) => set('notifyWishlist', v)} />
      <Toggle label={tr('Takip edilen oyun bildirimleri')} hint={tr('Fiyat ara’da takip ettiğin bir oyun ucuzlayınca')} on={p.notifyTracked} onChange={(v) => set('notifyTracked', v)} />
      <Toggle label={tr('Oturum bildirimleri')} hint={tr('Pencere kapalıyken biten oyun oturumları için')} on={p.notifySessions} onChange={(v) => set('notifySessions', v)} />
    </div>
  );
}

function Startup() {
  const { prefs, setPref, replaySplash, closeSettings } = useStore();
  return (
    <div className="settings-stack">
      <Background />
      <div className="set-group">
        <Toggle label={tr('Açılış animasyonu')} on={prefs.startupAnim} onChange={(v) => setPref('startupAnim', v)} />
        <Toggle label={tr('Açılış sesi')} on={prefs.startupSound} onChange={(v) => setPref('startupSound', v)} />
        <div className="set-row">
          <span className="set-text"><span className="set-label">{tr('Ses seviyesi')}</span></span>
          <input type="range" className="range" min={0} max={1} step={0.05} value={prefs.volume} disabled={!prefs.startupSound}
            aria-label={tr('Açılış sesi seviyesi')} onChange={(e) => setPref('volume', Number(e.target.value))}
            style={{ '--v': `${prefs.volume * 100}%` } as CSSProperties} />
        </div>
      </div>
      <button className="btn" onClick={() => { closeSettings(); window.setTimeout(replaySplash, 240); }}><Play size={15} strokeWidth={1.8} /> {tr('Açılışı şimdi oynat')}</button>
    </div>
  );
}

function LibraryPrefs() {
  const { prefs, setPref, trackAll, setTrackAll, demo, setBig, closeSettings } = useStore();
  return (
    <div className="settings-stack">
      <div className="set-group">
        <Choice label={tr('Varsayılan görünüm')} value={prefs.defaultView} options={[{ id: 'grid', label: tr('Kapaklar') }, { id: 'list', label: tr('Liste') }]} onChange={(v) => setPref('defaultView', v)} />
        <Choice label={tr('Kapak boyutu')} value={prefs.coverSize} options={[{ id: 's', label: tr('Küçük') }, { id: 'm', label: tr('Orta') }, { id: 'l', label: tr('Büyük') }]} onChange={(v) => setPref('coverSize', v)} />
        <Toggle label={tr('Yüklü olmayanları soluk göster')} on={prefs.dimRemote} onChange={(v) => setPref('dimRemote', v)} />
      </div>
      <div className="set-group">
        <Toggle label={tr('Aynı oyunun kopyalarını birleştir')} hint={tr('Bir oyun birden çok mağazada varsa tek kartta görünür, süreler toplanır')} on={prefs.mergeCopies} onChange={(v) => setPref('mergeCopies', v)} />
        <Toggle label={tr('Süreyi her zaman say')} hint={trackAll ? tr('Steam ya da kısayoldan açtıkların da sayılır') : tr('Yalnızca Tessera’dan açtıkların sayılır')} on={trackAll} onChange={setTrackAll} />
        {demo && <div className="set-row"><span className="set-hint">{tr('Masaüstü uygulamasında çalışır.')}</span></div>}
      </div>
      <div className="set-group">
        <Toggle label={tr('Kumandada Start ya da Xbox/PS tuşu geniş ekranı sorsun')} hint={tr('Geniş ekran, televizyonda kumandayla gezmek için. Klavyede F11 ile de açılır.')} on={prefs.padOpensBig} onChange={(v) => setPref('padOpensBig', v)} />
        <div className="set-row"><button className="btn btn-sm" onClick={() => { closeSettings(); setBig(true); }}>{tr('Geniş ekranı aç')}</button></div>
      </div>
    </div>
  );
}

function DataPrefs() {
  const { backupExtra, applyBackupExtra, refresh, notify, demo, prefs, setPref } = useStore();
  const [busy, setBusy] = useState(false);
  const stamp = new Date().toISOString().slice(0, 10);

  const doExport = async () => {
    const path = await saveDialog({ defaultPath: tr('Tessera yedeği {0}.json', stamp), filters: [{ name: tr('Tessera yedeği'), extensions: ['json'] }] });
    if (!path) return;
    setBusy(true);
    try { notify(tr('{0} oyun yedeklendi', await api.exportLibrary(path, backupExtra()))); } catch (err) { notify(String(err)); }
    setBusy(false);
  };
  const doImport = async () => {
    const path = await openDialog({ multiple: false, filters: [{ name: tr('Tessera yedeği'), extensions: ['json'] }] });
    if (!path || Array.isArray(path)) return;
    setBusy(true);
    try {
      const r = await api.importLibrary(path);
      applyBackupExtra(r.extra);
      await refresh();
      notify(r.missing
        ? tr('{0} oyun geri yüklendi · {1} oyun bu kütüphanede yok, hesabını bağlayınca gelir', r.matched, r.missing)
        : tr('{0} oyun geri yüklendi', r.matched));
    } catch (err) { notify(String(err)); }
    setBusy(false);
  };

  return (
    <div className="settings-stack">
      <div className="set-group">
        <div className="set-row">
          <span className="set-text"><span className="set-label">{tr('Yedek')}</span><span className="set-hint">{tr('Notlar, puanlar, incelemeler, etiketler, koleksiyonlar ve oyun süreleri')}</span></span>
          <span className="set-actions">
            <button className="btn btn-sm" onClick={doImport} disabled={busy || demo}><Download size={14} strokeWidth={1.8} /> {tr('İçe aktar')}</button>
            <button className="btn btn-sm" onClick={doExport} disabled={busy || demo}><Upload size={14} strokeWidth={1.8} /> {tr('Dışa aktar')}</button>
          </span>
        </div>
      </div>
      <div className="set-group">
        <div className="set-row"><span className="set-text"><span className="set-label">{tr('Veritabanı')}</span><span className="set-hint">{isDesktop ? tr('%APPDATA%\\app.tessera.desktop\\tessera.db') : tr('Örnek veri')}</span></span></div>
        <div className="set-row"><span className="set-text"><span className="set-label">{tr('Anahtarlar')}</span><span className="set-hint">{tr('Windows Kimlik Bilgisi Yöneticisi')}</span></span></div>
      </div>
      <div className="set-group">
        <Toggle label={tr('Hata olunca bildirmeyi öner')} hint={tr('Rapor kendiliğinden gönderilmez; önce sen görürsün')} on={prefs.offerReports} onChange={(v) => setPref('offerReports', v)} />
      </div>
    </div>
  );
}

function About() {
  const { demo, notify, closeSettings } = useStore();
  const [u, setU] = useState<{ configured: boolean; current: string; available?: boolean; version?: string; notes?: string | null } | null>(null);
  const [busy, setBusy] = useState<'check' | 'install' | null>(null);
  const check = () => {
    setBusy('check');
    api.updateCheck().then(setU).catch((e) => notify(String(e))).finally(() => setBusy(null));
  };
  useEffect(() => { if (!demo) check(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [demo]);
  const install = () => {
    setBusy('install');
    api.updateInstall().catch((e) => { notify(String(e)); setBusy(null); });
  };
  return (
    <div className="settings-stack about">
      <div className="about-mark"><Mark size={44} /></div>
      <p className="about-name">{tr('Tessera')} <span className="muted">{u?.current ?? '0.1.0'}</span></p>
      {!demo && u && (
        <div className="set-group">
          <div className="set-row">
            <span className="set-text">
              <span className="set-label">{tr('Güncellemeler')}</span>
              <span className="set-hint">
                {!u.configured ? tr('Güncelleme adresi henüz ayarlanmadı.')
                  : u.available ? tr('Tessera {0} hazır.{1}', u.version, u.notes ? ` ${u.notes}` : '')
                    : tr('Tessera güncel.')}
              </span>
            </span>
            {u.configured && (u.available ? (
              <button className="btn btn-accent btn-sm" onClick={install} disabled={busy != null}>{busy === 'install' ? tr('İndiriliyor…') : tr('Güncelle ve yeniden başlat')}</button>
            ) : (
              <button className="btn btn-sm" onClick={check} disabled={busy != null}>{busy === 'check' ? tr('Bakılıyor…') : tr('Denetle')}</button>
            ))}
          </div>
        </div>
      )}
      <div className="about-acts">
        <button className="btn btn-sm" onClick={() => { closeSettings(); window.setTimeout(() => window.dispatchEvent(new Event(WELCOME_EVENT)), 240); }}>{tr('Hoş geldin rehberi')}</button>
        <button className="btn btn-sm" onClick={() => { closeSettings(); window.setTimeout(() => window.dispatchEvent(new Event(REPORT_EVENT)), 240); }}><Bug size={14} strokeWidth={1.8} /> {tr('Hata bildir')}</button>
      </div>
    </div>
  );
}
