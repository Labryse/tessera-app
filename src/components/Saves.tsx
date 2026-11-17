// A ROM's saves: what is on disk now, and every copy Tessera kept here and in
// the cloud folder (from any PC). Restoring first keeps a copy of what was there.
import { useCallback, useEffect, useState } from 'react';
import { Cloud, HardDrive, History, RotateCcw, Save, Trash2 } from 'lucide-react';
import { useStore } from '../store';
import { api, type SaveInfo } from '../lib/backend';
import type { Game } from '../data/library';
import { bytes, clock, shortDate } from '../lib/format';

import { t } from '../lib/i18n';
const KIND: Record<string, string> = { sav: t('Oyun kaydı'), srm: t('Oyun kaydı'), dsv: t('Oyun kaydı'), sa1: t('Oyun kaydı'), eep: t('Oyun kaydı'), fla: t('Oyun kaydı'), mcr: t('Hafıza kartı'), mcd: t('Hafıza kartı') };
const kind = (ext: string) => KIND[ext] ?? (ext.startsWith('ss') ? t('Anlık kayıt {0}', ext.slice(2)) : ext.toUpperCase());
const when = (unix: number) => { const d = new Date(unix * 1000); return `${shortDate(d)} ${clock(d)}`; };

export function SavesTab({ g }: { g: Game }) {
  const { notify, openSettings } = useStore();
  const [info, setInfo] = useState<SaveInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const load = useCallback(() => api.saveInfo(g.id).then(setInfo).catch((e) => notify(String(e))), [g.id, notify]);
  useEffect(() => { load(); }, [load]);

  const backup = async () => {
    setBusy('backup');
    try { notify((await api.saveBackup(g.id)) ? t('Kayıt yedeklendi') : t('Değişen bir şey yok; son yedek güncel')); await load(); } catch (e) { notify(String(e)); }
    setBusy(null);
  };
  const restore = async (id: string) => {
    setBusy(id);
    try { await api.saveRestore(g.id, id); notify(t('Kayıt geri yüklendi; öncekinin yedeği alındı')); setConfirm(null); await load(); } catch (e) { notify(String(e)); }
    setBusy(null);
  };
  const remove = async (id: string) => { await api.saveDelete(g.id, id); await load(); };

  if (!info) return <div className="panel empty-panel"><p>{t('Yükleniyor…')}</p></div>;
  return (
    <div className="stack saves">
      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">{t('Şu anki kayıtlar')}</h2>
          <button className="btn btn-sm" onClick={backup} disabled={!!busy || info.local.length === 0}><Save size={14} strokeWidth={1.8} /> {t('Şimdi yedekle')}</button>
        </div>
        {info.local.length === 0 ? (
          <p className="muted">{t('Bu ROM’un yanında kayıt dosyası yok. Oyunu açıp kaydettiğinde burada görünür.')}</p>
        ) : (
          <ul className="save-files">
            {info.local.map((f) => (
              <li key={f.name}>
                <span className="save-kind">{kind(f.ext)}</span>
                <span className="save-name">{f.name}</span>
                <span className="muted num small">{bytes(f.size)} · {when(f.modified)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className={`save-cloud ${info.cloud ? 'is-on' : ''}`}>
          <Cloud size={15} strokeWidth={1.7} />
          {info.cloud
            ? <span>{info.cloud === 'Google Drive' ? t('Google Drive') : t('Klasör')} {t('senkronu açık · her oturumdan sonra yedeklenir')}</span>
            : <span>{t('Senkron kapalı.')} <button className="link" onClick={() => openSettings('saves')}>{t('Aç')}</button></span>}
        </p>
        {info.driveError && <p className="warn small">{info.driveError}</p>}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">{t('Yedekler')}</h2>
          <span className="muted small">{info.snapshots.length} {t('kayıt')}</span>
        </div>
        {info.snapshots.length === 0 ? (
          <p className="muted">{t('Henüz yedek yok.')}</p>
        ) : (
          <ul className="snap-list">
            {info.snapshots.map((s, i) => (
              <li key={s.id} className={i === 0 ? 'is-latest' : ''}>
                <span className="snap-icon"><History size={16} strokeWidth={1.7} /></span>
                <span className="snap-text">
                  <span className="snap-when">{when(s.created)}{i === 0 && <span className="snap-badge">{t('En yeni')}</span>}</span>
                  <span className="muted small">{s.machine} · {s.reason} · {s.files.map((f) => kind(f.ext)).join(', ')}</span>
                </span>
                <span className="snap-where">
                  {s.local && <span title={t('Bu bilgisayarda')}><HardDrive size={14} strokeWidth={1.7} /></span>}
                  {s.cloud && <span title={t('Bulutta')}><Cloud size={14} strokeWidth={1.7} /></span>}
                </span>
                {confirm === s.id ? (
                  <span className="snap-confirm">
                    <span className="small">{t('Mevcut kayıt yedeklenip bununla değiştirilecek.')}</span>
                    <button className="btn btn-sm btn-primary" onClick={() => restore(s.id)} disabled={!!busy}>{t('Geri yükle')}</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => setConfirm(null)}>{t('Vazgeç')}</button>
                  </span>
                ) : (
                  <span className="snap-actions">
                    <button className="btn btn-sm" onClick={() => setConfirm(s.id)}><RotateCcw size={14} strokeWidth={1.8} /> {t('Geri yükle')}</button>
                    <button className="icon-btn" aria-label={t('Yedeği sil')} onClick={() => remove(s.id)}><Trash2 size={15} strokeWidth={1.7} /></button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
