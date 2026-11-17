// "Bir şey ters gitti": a quiet card when the window hits an error it did not handle,
// and the report itself: the user sees and edits every line before it goes anywhere.
import { useEffect, useState } from 'react';
import { Bug, Copy, ExternalLink, X } from 'lucide-react';
import { useStore } from '../store';
import { api, isDesktop } from '../lib/backend';
import { caught, issueUrl, onCaught, redact, reportText } from '../lib/errors';
import { Modal } from './Modal';

import { t } from '../lib/i18n';
export const REPORT_EVENT = 'tessera:report';

type Info = { version: string; os: string; repo: string | null; log: string };
const DEMO_INFO: Info = { version: '0.1.0', os: navigator.userAgent.includes('Windows') ? t('Windows') : t('Tarayıcı'), repo: null, log: '' };

export function ErrorReport() {
  const { prefs, notify } = useStore();
  const [offer, setOffer] = useState(false);
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<Info | null>(null);
  const [note, setNote] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  useEffect(() => onCaught(() => { if (prefs.offerReports) setOffer(true); }), [prefs.offerReports]);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(REPORT_EVENT, show);
    return () => window.removeEventListener(REPORT_EVENT, show);
  }, []);
  useEffect(() => {
    if (!open) return;
    setOffer(false);
    (isDesktop ? api.errorInfo() : Promise.resolve(DEMO_INFO)).then((i) => {
      setInfo(i);
      setTitle(caught.length ? redact(caught[caught.length - 1].message).slice(0, 90) : '');
    }).catch(() => setInfo(DEMO_INFO));
  }, [open]);
  useEffect(() => { if (info) setBody(reportText(info, note)); }, [info, note]);

  const close = () => { setOpen(false); setNote(''); };
  const send = () => {
    if (!info?.repo) return;
    const url = issueUrl(info.repo, redact(title.trim()) || t('Hata'), body);
    (isDesktop ? api.openUrl(url) : Promise.resolve(void window.open(url, '_blank', 'noopener'))).catch((e) => notify(String(e)));
    if (isDesktop) void api.errorClear();
    close();
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(`${redact(title)}\n\n${body}`); notify(t('Rapor kopyalandı')); } catch (e) { notify(String(e)); }
  };

  return (
    <>
      {offer && !open && (
        <div className="err-offer" role="status">
          <Bug size={16} strokeWidth={1.8} />
          <span>{t('Bir şey ters gitti')}</span>
          <button className="btn btn-sm" onClick={() => setOpen(true)}>{t('Bildir')}</button>
          <button className="icon-btn" onClick={() => setOffer(false)} aria-label={t('Kapat')}><X size={14} strokeWidth={1.8} /></button>
        </div>
      )}
      <Modal open={open} onClose={close} label={t('Hata bildir')} title={t('Hata bildir')} size="md">
        <div className="report">
          <label className="studio-field">
            <span>{t('Başlık')}</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
          </label>
          <label className="studio-field">
            <span>{t('Ne oldu?')}</span>
            <textarea className="report-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} autoFocus />
          </label>
          <details className="report-body">
            <summary>{t('Gönderilecek metin')}</summary>
            <pre>{body}</pre>
          </details>
          <div className="studio-foot">
            <button className="btn btn-ghost" onClick={copy}><Copy size={14} strokeWidth={1.8} /> {t('Kopyala')}</button>
            {info?.repo && <button className="btn btn-accent" onClick={send} disabled={!title.trim()}><ExternalLink size={14} strokeWidth={1.8} /> {t('GitHub’da aç')}</button>}
          </div>
        </div>
      </Modal>
    </>
  );
}
