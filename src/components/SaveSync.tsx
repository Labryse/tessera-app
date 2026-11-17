// Save sync: Google Drive (connect once, then it just works) or any synced
// folder (Dropbox, Syncthing…). Both can be on; the game list shows every save
// that exists in the cloud, from any PC.
import { useCallback, useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { siDropbox, siGoogledrive } from 'simple-icons';
import { ExternalLink, FolderOpen, RefreshCw } from 'lucide-react';
import { useStore } from '../store';
import { api, type SyncSettings } from '../lib/backend';
import { Cover } from './bits';
import { PLATFORMS, type PlatformId } from '../data/library';
import { shortDate } from '../lib/format';

import { t } from '../lib/i18n';
const Brand = ({ path, color }: { path: string; color?: string }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d={path} fill={color ?? 'currentColor'} /></svg>
);

const reportText = (r: { sent: number; received: number }) =>
  r.sent || r.received
    ? [r.sent && t('{0} oyunun kaydı gönderildi', r.sent), r.received && t('{0} oyunun kaydı indirildi', r.received)].filter(Boolean).join(' · ')
    : t('Her şey güncel');

export function SaveSync({ bare = false }: { bare?: boolean }) {
  const { notify, byId, go } = useStore();
  const [s, setS] = useState<SyncSettings | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => api.saveSyncSettings().then(setS).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);

  const run = async (key: string, f: () => Promise<string | void>) => {
    setBusy(key);
    try { const msg = await f(); if (msg) notify(msg); await load(); } catch (err) { notify(String(err)); }
    setBusy(null);
  };

  const pickClient = () => run('setup', async () => {
    const p = await open({ multiple: false, title: t('Google Cloud’dan indirdiğin istemci dosyasını seç'), filters: [{ name: t('Google istemci dosyası'), extensions: ['json'] }] });
    if (typeof p !== 'string') return;
    await api.driveInstallClient(p);
    return t('Kurulum tamam; artık Google ile bağlanabilirsin');
  });
  const connect = () => run('connect', async () => reportText(await api.driveConnect()) + t(' · Google Drive bağlandı'));
  const syncNow = () => run('sync', async () => reportText(await api.syncSavesNow()));
  const disconnect = () => run('drive-off', async () => { await api.driveDisconnect(); return t('Google Drive bağlantısı kesildi'); });
  const pickFolder = () => run('folder', async () => {
    const p = await open({ directory: true, multiple: false, title: t('Dropbox, Syncthing ya da başka bir senkron klasörü seç') });
    if (typeof p !== 'string') return;
    return reportText(await api.setSaveCloud(p)) + t(' · Klasör senkronu açık');
  });
  const folderOff = () => run('folder-off', async () => { await api.setSaveCloud(null); return t('Klasör senkronu kapatıldı'); });

  if (!s) return null;
  const d = s.drive;
  return (
    <section className="retro-sec">
      {!bare && (
        <div className="retro-sec-head">
          <h2 className="section-title">{t('Kayıt senkronu')}</h2>
          {(d.email || s.cloudDir) && (
            <button className="btn btn-sm" onClick={syncNow} disabled={!!busy}>
              <RefreshCw size={14} strokeWidth={1.8} className={busy === 'sync' ? 'spin' : ''} /> {t('Şimdi eşitle')}
            </button>
          )}
        </div>
      )}

      <div className="sync-grid">
        <div className={`sync-opt ${d.email ? 'is-on' : ''}`}>
          <span className="sync-logo"><Brand path={siGoogledrive.path} color={`#${siGoogledrive.hex}`} /></span>
          <div className="sync-body">
            <span className="sync-name">{t('Google Drive')}</span>
            {d.email ? (
              <span className="sync-desc">{t('Bağlı ·')} {d.email}</span>
            ) : d.configured ? (
              <span className="sync-desc">{t('Bağlan, kayıtların kendiliğinden yedeklensin. Tessera Drive’ındaki dosyalarını göremez.')}</span>
            ) : (
              <span className="sync-desc">{t('Bu Tessera kopyasında Google bağlantısı henüz ayarlanmamış.')}</span>
            )}
            {d.error && <span className="warn small">{d.error}</span>}
          </div>
          <div className="sync-act">
            {d.email ? (
              <button className="btn btn-sm btn-ghost" onClick={disconnect} disabled={!!busy}>{t('Bağlantıyı kes')}</button>
            ) : d.configured ? (
              <button className="btn btn-sm btn-primary" onClick={connect} disabled={!!busy}>
                {busy === 'connect' ? <><RefreshCw size={14} strokeWidth={1.8} className="spin" /> {t('Tarayıcıda onay bekleniyor')}</> : t('Google ile bağlan')}
              </button>
            ) : (
              <button className="btn btn-sm" onClick={pickClient} disabled={!!busy}>{t('Kurulum dosyasını seç')}</button>
            )}
          </div>
          {!d.configured && (
            <details className="sync-setup">
              <summary>{t('Kurulum nasıl yapılır? (bir kerelik)')}</summary>
              <ol>
                <li>{t('Google Cloud Console’da yeni bir proje aç ve')} <strong>{t('Google Drive API')}</strong>{t('’yi etkinleştir.')}</li>
                <li><strong>{t('OAuth izin ekranı')}</strong>{t(': “Harici” seç, uygulama adını Tessera yap, kendi e-postanı test kullanıcısı olarak ekle.')}</li>
                <li><strong>{t('Kimlik bilgileri → OAuth istemci kimliği')}</strong> {t('oluştur, türü')} <strong>{t('Masaüstü uygulaması')}</strong> {t('olsun.')}</li>
                <li>{t('Oluşan istemcinin')} <strong>{t('JSON’unu indir')}</strong> {t('ve buradaki “Kurulum dosyasını seç” ile göster.')}</li>
              </ol>
              <button className="link link-inline" onClick={() => api.openUrl('https://console.cloud.google.com/apis/credentials')}>{t('Google Cloud Console’u aç')} <ExternalLink size={12} strokeWidth={1.8} /></button>
            </details>
          )}
        </div>

        <div className={`sync-opt ${s.cloudDir ? 'is-on' : ''}`}>
          <span className="sync-logo"><Brand path={siDropbox.path} /></span>
          <div className="sync-body">
            <span className="sync-name">{t('Klasör')}</span>
            <span className="sync-desc" title={s.cloudDir ?? undefined}>
              {s.cloudDir ? t('Açık · {0}', s.cloudDir.split(/[\\/]/).filter(Boolean).slice(-2).join(' › ')) : t('Dropbox, Syncthing ya da başka bir senkron klasörü.')}
            </span>
          </div>
          <div className="sync-act">
            {s.cloudDir && <button className="btn btn-sm btn-ghost" onClick={folderOff} disabled={!!busy}>{t('Kapat')}</button>}
            <button className="btn btn-sm" onClick={pickFolder} disabled={!!busy}><FolderOpen size={14} strokeWidth={1.8} /> {s.cloudDir ? t('Değiştir') : t('Klasör seç')}</button>
          </div>
        </div>
      </div>

      {bare && (d.email || s.cloudDir) && (
        <button className="btn btn-sm sync-now" onClick={syncNow} disabled={!!busy}>
          <RefreshCw size={14} strokeWidth={1.8} className={busy === 'sync' ? 'spin' : ''} /> {t('Şimdi eşitle')}
        </button>
      )}

      {s.games.length > 0 && (
        <ul className="cloud-list">
          {s.games.map((c) => {
            const here = byId.get(c.gameId);
            return (
              <li key={c.gameId}>
                <button className="cloud-row" onClick={() => here && go({ name: 'game', id: c.gameId })} disabled={!here}>
                  <span className="cloud-thumb">{here && <Cover game={here} />}</span>
                  <span className="cloud-text">
                    <span className="cloud-title">{c.title}</span>
                    <span className="muted small">{PLATFORMS[c.system as PlatformId]?.name ?? c.system} · {shortDate(new Date(c.latest * 1000))} · {c.machine} · {c.count} {t('kayıt')}</span>
                  </span>
                  <span className="muted small">{here ? t('Kütüphanede') : t('ROM’u ekleyince yüklenir')}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
