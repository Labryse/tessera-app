// Accounts, shown inside Settings. Nothing is connected until the user chooses to.
import { useEffect, useState } from 'react';
import { Check, ExternalLink, Image as ImageIcon, KeyRound, Tag, Minus, RefreshCw, ShieldCheck, User } from 'lucide-react';
import { useStore } from '../store';
import { ago } from '../lib/format';
import { api, type LocalSteamAccount, type SyncReport } from '../lib/backend';
import { Modal } from './Modal';
import { PlatformLogo } from './PlatformLogo';

import { t, locale } from '../lib/i18n';
type Cap = 'yes' | 'tessera' | 'partial' | 'key' | 'installed' | 'no';
interface Platform {
  id: string;
  name: string;
  how: string;
  caps: { library: Cap; time: Cap; achievements: Cap };
  ready: boolean;
  /** connected by reading what its launcher installed on this PC */
  scan?: boolean;
}

const SCAN_CAPS: Platform['caps'] = { library: 'installed', time: 'tessera', achievements: 'no' };

const PLATFORMS: Platform[] = [
  { id: 'steam', name: t('Steam'), how: t('Steam ile giriş ya da bu bilgisayardaki Steam'), ready: true, caps: { library: 'yes', time: 'yes', achievements: 'key' } },
  { id: 'ra', name: t('RetroAchievements'), how: t('Kullanıcı adı ve Web API anahtarı'), ready: true, caps: { library: 'no', time: 'no', achievements: 'yes' } },
  { id: 'xbox', name: t('Xbox'), how: '', ready: true, scan: true, caps: SCAN_CAPS },
  { id: 'epic', name: t('Epic Games'), how: '', ready: true, scan: true, caps: SCAN_CAPS },
  { id: 'gog', name: 'GOG', how: '', ready: true, scan: true, caps: SCAN_CAPS },
  { id: 'ea', name: t('EA app'), how: '', ready: true, scan: true, caps: SCAN_CAPS },
  { id: 'ubisoft', name: t('Ubisoft Connect'), how: '', ready: true, scan: true, caps: SCAN_CAPS },
  { id: 'battlenet', name: t('Battle.net'), how: '', ready: true, scan: true, caps: SCAN_CAPS },
];

const CAP_TEXT: Record<keyof Platform['caps'], string> = { library: t('Kütüphane'), time: t('Süre'), achievements: t('Başarımlar') };
const CAP_NOTE: Record<Cap, string> = { yes: '', tessera: t('Tessera sayar'), partial: t('kısmen'), key: t('anahtarla'), installed: t('yüklü olanlar'), no: t('yok') };

function CapChip({ k, c }: { k: keyof Platform['caps']; c: Cap }) {
  return (
    <span className={`cap-chip cap-${c}`}>
      {c === 'no' ? <Minus size={12} strokeWidth={2} /> : <Check size={12} strokeWidth={2.2} />}
      {CAP_TEXT[k]}{CAP_NOTE[c] && <span className="cap-note"> · {CAP_NOTE[c]}</span>}
    </span>
  );
}

export const syncText = (r: SyncReport) =>
  t('{0} oyun eşitlendi{1}. {2} tanesi yüklü.', r.total, r.added ? t(', {0} yeni', r.added) : '', r.installed);

const KEY_RE = /^[0-9A-Fa-f]{32}$/;

function when(unix: number | null) {
  if (!unix) return null;
  const d = new Date(unix * 1000);
  return ago(d) === t('Bugün') ? t('bugün {0}', d.toTimeString().slice(0, 5)) : ago(d).toLocaleLowerCase(locale);
}

/** compact: just the stores, for the first-run guide */
export function AccountsPanel({ compact = false }: { compact?: boolean }) {
  const { accounts, refresh, notify, demo } = useStore();
  const [connecting, setConnecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  const [confirmOff, setConfirmOff] = useState<Platform | null>(null);
  const [linking, setLinking] = useState<string | null>(null);

  const link = async (p: Platform) => {
    setLinking(p.id);
    try {
      const r = await api.linkStore(p.id);
      await refresh();
      notify(r.total
        ? t('{0} bağlandı · {1} oyun{2}', p.name, r.total, r.added && r.added !== r.total ? t(', {0} yeni', r.added) : '')
        : t('{0} bağlandı. Bu bilgisayarda henüz oyunu yok; yükledikçe gelir.', p.name));
    } catch (err) { notify(String(err)); }
    setLinking(null);
  };
  const steam = accounts.find((a) => a.platform === 'steam');
  const [raUser, setRaUser] = useState<string | null>(null);
  const [raOpen, setRaOpen] = useState(false);
  const [sgdb, setSgdb] = useState(false);
  const [sgdbOpen, setSgdbOpen] = useState(false);
  const [itad, setItad] = useState<{ hasKey: boolean; own: boolean }>({ hasKey: false, own: false });
  const [itadOpen, setItadOpen] = useState(false);
  const [xbl, setXbl] = useState(false);
  const [xblOpen, setXblOpen] = useState(false);
  useEffect(() => {
    if (demo) return;
    api.raStatus().then(setRaUser).catch(() => {});
    api.sgdbStatus().then(setSgdb).catch(() => {});
    api.itadStatus().then(setItad).catch(() => {});
    api.xboxStatus().then(setXbl).catch(() => {});
  }, [demo]);
  const raOff = async () => { await api.raDisconnect(); setRaUser(null); notify(t('RetroAchievements bağlantısı kesildi')); };

  const sync = async () => {
    setBusy(true);
    try {
      const r = await api.steamSync();
      await refresh();
      notify(r.warning ? t('Eşitlendi, ama: {0}', r.warning) : syncText(r));
    } catch (err) {
      notify(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-stack">
      <p className="settings-lede">
        <ShieldCheck size={17} strokeWidth={1.6} />
        <span>{t('Şifren Tessera’ya gelmez, verilerin bu bilgisayarda kalır.')}</span>
      </p>
      {demo && <p className="notice-inline">{t('Hesaplar masaüstü uygulamasında bağlanır.')}</p>}

      <ul className={`acc-list ${compact ? 'is-compact' : ''}`}>
        {PLATFORMS.filter((p) => !compact || p.id !== 'ra').map((p, i) => {
          const isSteam = p.id === 'steam';
          const isRa = p.id === 'ra';
          const acc = p.scan ? accounts.find((a) => a.platform === p.id) : undefined;
          const on = (isSteam && !!steam) || (isRa && !!raUser) || !!acc;
          return (
            <li key={p.id} className={`acc-card ${on ? 'is-on' : ''} ${p.ready ? '' : 'is-soon'}`} style={{ '--i': i } as React.CSSProperties}>
              <span className="acc-mono" aria-hidden="true"><PlatformLogo id={p.id} size={19} /></span>
              <div className="acc-body">
                <div className="acc-line">
                  <span className="acc-name">{p.name}</span>
                  {on && <span className="acc-state">{t('Bağlı')}</span>}
                  {!p.ready && <span className="acc-soon">{t('Yakında')}</span>}
                </div>
                <span className="acc-sub">
                  {isRa && raUser ? raUser : null}
                  {acc ? <>{t('Bu bilgisayardan ·')} {acc.gameCount} {t('oyun')}</> : null}
                  {isSteam && steam
                    ? <>{steam.displayName ?? steam.externalId} · {steam.gameCount} {t('oyun')}{when(steam.lastSync) && t(' · eşitleme {0}', when(steam.lastSync))}</>
                    : null}
                </span>
                {!compact && (
                  <div className="acc-caps">
                    {(Object.keys(p.caps) as (keyof Platform['caps'])[]).map((k) => (
                      <CapChip key={k} k={k} c={isSteam && k === 'achievements' && steam?.hasKey ? 'yes' : p.caps[k]} />
                    ))}
                  </div>
                )}
                {acc && (
                  <div className="acc-links">
                    <button className="link" onClick={() => setConfirmOff(p)}>{t('Bağlantıyı kes')}</button>
                  </div>
                )}
                {isRa && raUser && (
                  <div className="acc-links">
                    <span>{t('Retro oyunlarının başarımları')}</span>
                    <button className="link" onClick={raOff}>{t('Bağlantıyı kes')}</button>
                  </div>
                )}
                {isSteam && steam && (
                  <div className="acc-links">
                    <span>{steam.method === 'openid' ? t('Steam ile giriş yapıldı') : t('Bu bilgisayardaki hesap')}</span>
                    <button className="link" onClick={() => setKeyOpen(true)}>{steam.hasKey ? t('Web API anahtarını değiştir') : t('Web API anahtarı ekle')}</button>
                    <button className="link" onClick={() => setConfirmOff(PLATFORMS[0])}>{t('Bağlantıyı kes')}</button>
                  </div>
                )}
              </div>
              <div className="acc-act">
                {isSteam && steam && (
                  <button className="btn btn-sm" onClick={sync} disabled={busy}><RefreshCw size={14} strokeWidth={1.7} className={busy ? 'spin' : ''} /> {busy ? t('Eşitleniyor') : t('Eşitle')}</button>
                )}
                {isSteam && !on && <button className="btn btn-sm btn-primary" onClick={() => setConnecting(true)} disabled={demo}>{t('Bağla')}</button>}
                {p.scan && (
                  <button className={`btn btn-sm ${on ? '' : 'btn-primary'}`} onClick={() => link(p)} disabled={demo || !!linking}>
                    {linking === p.id ? <><RefreshCw size={14} strokeWidth={1.7} className="spin" /> {t('Taranıyor')}</> : on ? <><RefreshCw size={14} strokeWidth={1.7} /> {t('Tara')}</> : t('Bağla')}
                  </button>
                )}
                {isRa && !on && <button className="btn btn-sm btn-primary" onClick={() => setRaOpen(true)} disabled={demo}>{t('Bağla')}</button>}
              </div>
            </li>
          );
        })}
      </ul>

      {!compact && <>
      <span className="sub-label">{t('Görseller')}</span>
      <ul className="acc-list">
        <li className={`acc-card ${sgdb ? 'is-on' : ''}`}>
          <span className="acc-mono" aria-hidden="true"><ImageIcon size={18} strokeWidth={1.7} /></span>
          <div className="acc-body">
            <div className="acc-line">
              <span className="acc-name">{t('SteamGridDB')}</span>
              {sgdb && <span className="acc-state">{t('Bağlı')}</span>}
            </div>
            <span className="acc-sub">{t('Oyunlara başka kapak, banner ve logo seç')}</span>
            {sgdb && (
              <div className="acc-links">
                <button className="link" onClick={() => setSgdbOpen(true)}>{t('Anahtarı değiştir')}</button>
                <button className="link" onClick={async () => { await api.sgdbSetKey(null); setSgdb(false); notify(t('SteamGridDB anahtarı silindi')); }}>{t('Kaldır')}</button>
              </div>
            )}
          </div>
          <div className="acc-act">
            {!sgdb && <button className="btn btn-sm btn-primary" onClick={() => setSgdbOpen(true)} disabled={demo}>{t('Bağla')}</button>}
          </div>
        </li>
      </ul>

      <span className="sub-label">{t('Fiyatlar')}</span>
      <ul className="acc-list">
        <li className={`acc-card ${itad.hasKey ? 'is-on' : ''}`}>
          <span className="acc-mono" aria-hidden="true"><Tag size={18} strokeWidth={1.7} /></span>
          <div className="acc-body">
            <div className="acc-line">
              <span className="acc-name">{t('IsThereAnyDeal')}</span>
              {itad.hasKey && <span className="acc-state">{itad.own ? t('Bağlı') : t('Tessera’nın anahtarı')}</span>}
            </div>
            <span className="acc-sub">{t('Oyunun her mağazadaki fiyatı, en ucuzu ve gördüğü en düşük fiyat')}</span>
            {itad.own && (
              <div className="acc-links">
                <button className="link" onClick={() => setItadOpen(true)}>{t('Anahtarı değiştir')}</button>
                <button className="link" onClick={async () => { await api.itadSetKey(null); setItad(await api.itadStatus()); notify(t('IsThereAnyDeal anahtarı silindi')); }}>{t('Kaldır')}</button>
              </div>
            )}
          </div>
          <div className="acc-act">
            {!itad.own && <button className={`btn btn-sm ${itad.hasKey ? '' : 'btn-primary'}`} onClick={() => setItadOpen(true)} disabled={demo}>{itad.hasKey ? t('Kendi anahtarım') : t('Bağla')}</button>}
          </div>
        </li>
      </ul>

      <span className="sub-label">{t('Arkadaşlar')}</span>
      <ul className="acc-list">
        <li className={`acc-card ${xbl ? 'is-on' : ''}`}>
          <span className="acc-mono" aria-hidden="true"><PlatformLogo id="xbox" size={18} /></span>
          <div className="acc-body">
            <div className="acc-line">
              <span className="acc-name">{t('Xbox arkadaşları')}</span>
              {xbl && <span className="acc-state">{t('Bağlı')}</span>}
            </div>
            <span className="acc-sub">{t('OpenXBL ile Xbox arkadaşların, oynadıkları ve Gamerscore')}</span>
            {xbl && (
              <div className="acc-links">
                <button className="link" onClick={() => setXblOpen(true)}>{t('Anahtarı değiştir')}</button>
                <button className="link" onClick={async () => { await api.xboxSetKey(null); setXbl(false); notify(t('OpenXBL anahtarı silindi')); }}>{t('Kaldır')}</button>
              </div>
            )}
          </div>
          <div className="acc-act">
            {!xbl && <button className="btn btn-sm btn-primary" onClick={() => setXblOpen(true)} disabled={demo}>{t('Bağla')}</button>}
          </div>
        </li>
      </ul>
      </>}

      <XblKey open={xblOpen} onClose={() => setXblOpen(false)} onDone={() => { setXbl(true); setXblOpen(false); }} />
      <ItadKey open={itadOpen} onClose={() => setItadOpen(false)} onDone={() => { setItad({ hasKey: true, own: true }); setItadOpen(false); }} />
      <RaConnect open={raOpen} onClose={() => setRaOpen(false)} onDone={(u) => { setRaUser(u); setRaOpen(false); }} />
      <SgdbKey open={sgdbOpen} onClose={() => setSgdbOpen(false)} onDone={() => { setSgdb(true); setSgdbOpen(false); }} />
      <SteamConnect open={connecting} onClose={() => setConnecting(false)} />
      <KeyDialog open={keyOpen} hasKey={!!steam?.hasKey} onClose={() => setKeyOpen(false)} />
      <DisconnectDialog p={confirmOff} onClose={() => setConfirmOff(null)} />
    </div>
  );
}

function KeyField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const bad = value.length > 0 && !KEY_RE.test(value);
  return (
    <div className="key-field">
      <span className="sub-label">{t('Steam Web API anahtarı · isteğe bağlı')}</span>
      <label className={`field field-wide ${bad ? 'is-bad' : ''}`}>
        <KeyRound size={15} strokeWidth={1.6} />
        <input value={value} onChange={(e) => onChange(e.target.value.trim())} placeholder={t('32 karakter, 0-9 ve A-F')}
          aria-label={t('Steam Web API anahtarı')} aria-describedby="key-help" aria-invalid={bad} spellCheck={false} autoComplete="off" />
      </label>
      <p id="key-help" className="muted small">
        {t('Hiç açmadığın oyunlar ve başarımların için.')}{' '}
        <button className="link link-inline" onClick={() => api.openUrl('https://steamcommunity.com/dev/apikey')}>{t('Anahtarını al')} <ExternalLink size={12} strokeWidth={1.8} /></button>
      </p>
    </div>
  );
}

function KeyDialog({ open, hasKey, onClose }: { open: boolean; hasKey: boolean; onClose: () => void }) {
  const { refresh, notify } = useStore();
  const [key, setKey] = useState('');
  const save = async (v: string | null) => {
    try {
      await api.steamSetKey(v);
      await refresh();
      notify(v ? t('Anahtar kaydedildi. Eşitle’ye basınca tüm oyunların gelir.') : t('Anahtar silindi'));
      setKey('');
      onClose();
    } catch (err) { notify(String(err)); }
  };
  return (
    <Modal open={open} onClose={onClose} label={t('Steam Web API anahtarı')} title={t('Steam Web API anahtarı')} size="sm">
      <KeyField value={key} onChange={setKey} />
      <div className="dialog-actions">
        {hasKey && <button className="btn btn-ghost" onClick={() => save(null)}>{t('Kayıtlı anahtarı sil')}</button>}
        <button className="btn btn-primary" disabled={!KEY_RE.test(key)} onClick={() => save(key)}>{t('Kaydet')}</button>
      </div>
    </Modal>
  );
}

function DisconnectDialog({ p, onClose }: { p: Platform | null; onClose: () => void }) {
  const { refresh, notify } = useStore();
  const [removeGames, setRemoveGames] = useState(false);
  const [last, setLast] = useState<Platform | null>(p);
  if (p && p !== last) setLast(p);
  const name = (p ?? last)?.name ?? '';
  const run = async () => {
    if (!p) return;
    try {
      await api.disconnect(p.id, removeGames);
      await refresh();
      notify(t('{0} bağlantısı kesildi', p.name));
      setRemoveGames(false);
      onClose();
    } catch (err) { notify(String(err)); }
  };
  return (
    <Modal open={!!p} onClose={onClose} label={t('{0} bağlantısını kes', name)} title={t('{0} bağlantısını kes', name)} size="sm">
      {(p ?? last)?.id === 'steam' && <p className="muted">{t('Hesap ve kayıtlı anahtar silinir.')}</p>}
      <label className="check">
        <input type="checkbox" checked={removeGames} onChange={(e) => setRemoveGames(e.target.checked)} />
        {name} {t('oyunlarını da kaldır (notlar ve puanlar dahil)')}
      </label>
      <div className="dialog-actions">
        <button className="btn btn-ghost" onClick={onClose}>{t('Vazgeç')}</button>
        <button className="btn btn-primary" onClick={run}>{t('Bağlantıyı kes')}</button>
      </div>
    </Modal>
  );
}

type Who = { steamid: string; persona: string | null; method: 'openid' | 'local'; hasLocalData: boolean };

function SteamConnect({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { refresh, notify, go, closeSettings } = useStore();
  const [local, setLocal] = useState<LocalSteamAccount[] | null>(null);
  const [clientFound, setClientFound] = useState(true);
  const [who, setWho] = useState<Who | null>(null);
  const [key, setKey] = useState('');
  const [step, setStep] = useState<'idle' | 'signing' | 'syncing'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setWho(null); setKey(''); setError(null);
    api.steamDetect().then((d) => { setLocal(d.accounts); setClientFound(d.clientFound); }).catch(() => setLocal([]));
  }, [open]);

  const signIn = async () => {
    setError(null); setStep('signing');
    try {
      const r = await api.steamSignIn();
      const here = local?.find((a) => a.steamid === r.steamid);
      setWho({ steamid: r.steamid, persona: r.persona, method: 'openid', hasLocalData: !!here?.hasLocalData });
    } catch (err) {
      setError(String(err));
    } finally {
      setStep('idle');
    }
  };

  const finish = async () => {
    if (!who) return;
    setError(null); setStep('syncing');
    try {
      await api.steamConnect(who.steamid, who.persona, who.method, key || null);
      const r = await api.steamSync();
      await refresh();
      notify(r.warning ? t('Bağlandı, ama: {0}', r.warning) : t('Steam bağlandı. {0}', syncText(r)));
      setStep('idle');
      onClose();
      closeSettings();
      go({ name: 'library', scope: { kind: 'platform', id: 'steam' } });
    } catch (err) {
      setError(String(err));
      setStep('idle');
    }
  };

  return (
    <Modal open={open} onClose={step === 'idle' ? onClose : undefined} label={t('Steam’i bağla')} title={t('Steam’i bağla')} size="md">
      {!who ? (
        <div className="connect-step" key="pick">
          <button className="btn btn-primary btn-lg connect-main" onClick={signIn} disabled={step !== 'idle'}>
            {step === 'signing' ? <><RefreshCw size={15} strokeWidth={1.8} className="spin" /> {t('Steam penceresinde giriş bekleniyor')}</> : t('Steam ile giriş yap')}
          </button>

          {local && local.length > 0 && (
            <div className="connect-local">
              <span className="sub-label">{t('Bu bilgisayardaki hesaplar')}</span>
              <ul>
                {local.map((a) => (
                  <li key={a.steamid}>
                    <span className="acc-mono" aria-hidden="true">{a.persona.slice(0, 1).toUpperCase()}</span>
                    <span className="connect-local-text">
                      <span>{a.persona}{a.mostRecent && <span className="muted"> {t('· son kullanılan')}</span>}</span>
                      <span className="muted small">{a.hasLocalData ? t('Süreler kayıtlı') : t('Kayıtlı veri yok')}</span>
                    </span>
                    <button className="btn btn-sm" onClick={() => setWho({ steamid: a.steamid, persona: a.persona, method: 'local', hasLocalData: a.hasLocalData })}>{t('Seç')}</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!clientFound && <p className="muted small">{t('Steam istemcisi bulunamadı.')}</p>}
        </div>
      ) : (
        <div className="connect-step" key="confirm">
          <div className="connect-who">
            <Check size={16} strokeWidth={2} className="ok" />
            <span><strong>{who.persona ?? t('Steam hesabı')}</strong> {t('seçildi')}{who.method === 'openid' ? t(', Steam doğruladı') : ''}.</span>
            <button className="link" onClick={() => setWho(null)} disabled={step !== 'idle'}>{t('Değiştir')}</button>
          </div>
          {!who.hasLocalData && !key && (
            <p className="notice-inline">{t('Bu hesabın verisi bu bilgisayarda yok; anahtar gerekli.')}</p>
          )}
          <KeyField value={key} onChange={setKey} />
          <div className="dialog-actions">
            <button className="btn btn-ghost" onClick={onClose} disabled={step !== 'idle'}>{t('Vazgeç')}</button>
            <button className="btn btn-primary" onClick={finish} disabled={step !== 'idle' || (!!key && !KEY_RE.test(key))}>
              {step === 'syncing' ? <><RefreshCw size={14} strokeWidth={1.7} className="spin" /> {t('Oyunlar getiriliyor')}</> : t('Bağla ve oyunları getir')}
            </button>
          </div>
        </div>
      )}
      {error && <p className="warn small" role="alert">{error}</p>}
    </Modal>
  );
}

function RaConnect({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (user: string) => void }) {
  const { notify } = useStore();
  const [user, setUser] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setError(null); setKey(''); } }, [open]);
  const run = async () => {
    setBusy(true); setError(null);
    try {
      const name = await api.raConnect(user.trim(), key.trim());
      notify(t('RetroAchievements bağlandı · {0}', name));
      onDone(name);
    } catch (err) { setError(String(err)); }
    setBusy(false);
  };
  return (
    <Modal open={open} onClose={busy ? undefined : onClose} label={t('RetroAchievements’ı bağla')} title={t('RetroAchievements’ı bağla')} size="sm">
      <div className="key-field">
        <span className="sub-label">{t('Kullanıcı adı')}</span>
        <label className="field field-wide">
          <User size={15} strokeWidth={1.6} />
          <input value={user} onChange={(e) => setUser(e.target.value)} aria-label={t('Kullanıcı adı')} spellCheck={false} autoComplete="off" />
        </label>
      </div>
      <div className="key-field">
        <span className="sub-label">{t('Web API anahtarı')}</span>
        <label className="field field-wide">
          <KeyRound size={15} strokeWidth={1.6} />
          <input value={key} onChange={(e) => setKey(e.target.value)} aria-label={t('Web API anahtarı')} spellCheck={false} autoComplete="off" />
        </label>
        <p className="muted small">
          <button className="link link-inline" onClick={() => api.openUrl('https://retroachievements.org/settings')}>{t('Anahtarını al')} <ExternalLink size={12} strokeWidth={1.8} /></button>
        </p>
      </div>
      {error && <p className="warn small" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>{t('Vazgeç')}</button>
        <button className="btn btn-primary" onClick={run} disabled={busy || !user.trim() || key.trim().length < 16}>
          {busy ? <><RefreshCw size={14} strokeWidth={1.7} className="spin" /> {t('Kontrol ediliyor')}</> : t('Bağla')}
        </button>
      </div>
    </Modal>
  );
}

function XblKey({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { notify } = useStore();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setError(null); setKey(''); } }, [open]);
  const run = async () => {
    setBusy(true); setError(null);
    try { await api.xboxSetKey(key.trim()); notify(t('Xbox arkadaşları bağlandı')); onDone(); } catch (err) { setError(String(err)); }
    setBusy(false);
  };
  return (
    <Modal open={open} onClose={busy ? undefined : onClose} label={t('OpenXBL')} title={t('Xbox arkadaşları')} size="sm">
      <div className="key-field">
        <ol className="key-steps muted small">
          <li>{t('xbl.io’da Xbox hesabınla giriş yap (ücretsiz).')}</li>
          <li>{t('Profil sayfasında')} <strong>{t('API Keys')}</strong> {t('bölümünden yeni anahtar oluştur.')}</li>
          <li>{t('Anahtarı buraya yapıştır.')}</li>
        </ol>
        <span className="sub-label">{t('API anahtarı')}</span>
        <label className="field field-wide">
          <KeyRound size={15} strokeWidth={1.6} />
          <input value={key} onChange={(e) => setKey(e.target.value)} aria-label={t('OpenXBL API anahtarı')} spellCheck={false} autoComplete="off" />
        </label>
        <p className="muted small">
          <button className="link link-inline" onClick={() => api.openUrl('https://xbl.io/profile')}>{t('xbl.io’yu aç')} <ExternalLink size={12} strokeWidth={1.8} /></button>
        </p>
      </div>
      {error && <p className="warn small" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>{t('Vazgeç')}</button>
        <button className="btn btn-primary" onClick={run} disabled={busy || key.trim().length < 16}>
          {busy ? <><RefreshCw size={14} strokeWidth={1.7} className="spin" /> {t('Kontrol ediliyor')}</> : t('Kaydet')}
        </button>
      </div>
    </Modal>
  );
}

function ItadKey({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { notify } = useStore();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setError(null); setKey(''); } }, [open]);
  const run = async () => {
    setBusy(true); setError(null);
    try { await api.itadSetKey(key.trim()); notify(t('IsThereAnyDeal bağlandı')); onDone(); } catch (err) { setError(String(err)); }
    setBusy(false);
  };
  return (
    <Modal open={open} onClose={busy ? undefined : onClose} label={t('IsThereAnyDeal')} title={t('IsThereAnyDeal')} size="sm">
      <div className="key-field">
        <ol className="key-steps muted small">
          <li>{t('IsThereAnyDeal’de ücretsiz hesap aç.')}</li>
          <li>{t('“Uygulamalarım” sayfasında yeni bir uygulama kaydet (adı Tessera olabilir).')}</li>
          <li>{t('Verilen')} <strong>{t('API Key')}</strong>{t('’i buraya yapıştır.')}</li>
        </ol>
        <span className="sub-label">{t('API anahtarı')}</span>
        <label className="field field-wide">
          <KeyRound size={15} strokeWidth={1.6} />
          <input value={key} onChange={(e) => setKey(e.target.value)} aria-label={t('IsThereAnyDeal API anahtarı')} spellCheck={false} autoComplete="off" />
        </label>
        <p className="muted small">
          <button className="link link-inline" onClick={() => api.openUrl('https://isthereanydeal.com/apps/my/')}>{t('Uygulamalarım sayfasını aç')} <ExternalLink size={12} strokeWidth={1.8} /></button>
        </p>
      </div>
      {error && <p className="warn small" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>{t('Vazgeç')}</button>
        <button className="btn btn-primary" onClick={run} disabled={busy || key.trim().length < 16}>
          {busy ? <><RefreshCw size={14} strokeWidth={1.7} className="spin" /> {t('Kontrol ediliyor')}</> : t('Kaydet')}
        </button>
      </div>
    </Modal>
  );
}

function SgdbKey({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { notify } = useStore();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setError(null); setKey(''); } }, [open]);
  const run = async () => {
    setBusy(true); setError(null);
    try { await api.sgdbSetKey(key.trim()); notify(t('SteamGridDB bağlandı')); onDone(); } catch (err) { setError(String(err)); }
    setBusy(false);
  };
  return (
    <Modal open={open} onClose={busy ? undefined : onClose} label={t('SteamGridDB')} title={t('SteamGridDB')} size="sm">
      <div className="key-field">
        <span className="sub-label">{t('API anahtarı')}</span>
        <label className="field field-wide">
          <KeyRound size={15} strokeWidth={1.6} />
          <input value={key} onChange={(e) => setKey(e.target.value)} aria-label={t('SteamGridDB API anahtarı')} spellCheck={false} autoComplete="off" />
        </label>
        <p className="muted small">
          {t('Ücretsiz.')}{' '}
          <button className="link link-inline" onClick={() => api.openUrl('https://www.steamgriddb.com/profile/preferences/api')}>{t('Anahtarını al')} <ExternalLink size={12} strokeWidth={1.8} /></button>
        </p>
      </div>
      {error && <p className="warn small" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>{t('Vazgeç')}</button>
        <button className="btn btn-primary" onClick={run} disabled={busy || key.trim().length < 16}>
          {busy ? <><RefreshCw size={14} strokeWidth={1.7} className="spin" /> {t('Kontrol ediliyor')}</> : t('Kaydet')}
        </button>
      </div>
    </Modal>
  );
}
