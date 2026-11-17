// "Bilgisayarı tara": what each launcher says is installed, plus desktop and
// Start-menu shortcuts. Shortcuts that look like a known game come ticked;
// the rest wait under "Diğer kısayollar". Nothing is added without a tick.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, RefreshCw } from 'lucide-react';
import { useStore } from '../store';
import { api, type Found } from '../lib/backend';
import { Modal } from './Modal';
import { PlatformLogo } from './PlatformLogo';
import { gb } from '../lib/format';

import { t } from '../lib/i18n';
const NAMES: Record<string, string> = { steam: t('Steam'), epic: t('Epic Games'), gog: 'GOG', ubisoft: t('Ubisoft Connect'), xbox: t('Xbox'), ea: t('EA app'), battlenet: t('Battle.net'), local: t('Kısayollardan oyunlar') };
const key = (f: Found) => `${f.source}:${f.externalId}`;
const likely = (f: Found) => f.source !== 'local' || !!f.guess;

function Row({ f, on, toggle }: { f: Found; on: boolean; toggle: () => void }) {
  return (
    <li>
      <button className={`scan-item ${on ? 'is-on' : ''} ${f.known ? 'is-known' : ''}`} disabled={f.known} onClick={toggle} aria-pressed={on}>
        <span className="coll-box">{(on || f.known) && <Check size={12} strokeWidth={2.4} />}</span>
        <span className="scan-title">
          {f.guess && f.guess.title.toLowerCase() !== f.title.toLowerCase() ? <>{f.guess.title} <span className="muted">· {f.title}</span></> : f.title}
        </span>
        <span className="muted small">
          {f.known ? t('Kütüphanede') : f.sizeBytes ? gb(f.sizeBytes / 1024 ** 3) : f.origin === 'desktop' ? t('Masaüstü') : f.origin === 'start' ? t('Başlat menüsü') : ''}
        </span>
      </button>
    </li>
  );
}

export function ScanDialog() {
  const { scanOpen, setScanOpen, refresh, notify, go } = useStore();
  const [found, setFound] = useState<Found[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<'scan' | 'import' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showOther, setShowOther] = useState(false);
  // bumps on every scan and on close, so a lookup still running for an old list stops
  const round = useRef(0);
  const touched = useRef(new Set<string>());

  const scan = async () => {
    const r = ++round.current;
    touched.current = new Set();
    setBusy('scan'); setError(null);
    let list: Found[] = [];
    try {
      list = await api.scanInstalled();
      setFound(list);
      refresh().catch(() => {}); // games found installed are marked so in the library too
      setPicked(new Set(list.filter((x) => !x.known && likely(x)).map(key)));
    } catch (err) { setError(String(err)); }
    setBusy(null);
    // shortcuts seen for the first time: which game is each? one at a time
    for (const item of list.filter((x) => x.pending)) {
      if (round.current !== r) return;
      const guess = await api.scanGuess(item).catch(() => null);
      if (round.current !== r) return;
      setFound((fs) => fs?.map((x) => (key(x) === key(item) ? { ...x, guess, pending: false } : x)) ?? fs);
      if (guess && !touched.current.has(key(item))) setPicked((p) => new Set(p).add(key(item)));
    }
  };

  useEffect(() => {
    if (scanOpen) { setFound(null); setShowOther(false); scan(); } else round.current++;
  }, [scanOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const pending = found?.filter((x) => x.pending).length ?? 0;

  const { groups, other } = useMemo(() => {
    const m = new Map<string, Found[]>();
    const rest: Found[] = [];
    for (const f of found ?? []) {
      if (!likely(f) && !f.known) { rest.push(f); continue; }
      m.set(f.source, [...(m.get(f.source) ?? []), f]);
    }
    return { groups: [...m.entries()], other: rest };
  }, [found]);

  const toggle = (k: string) => { touched.current.add(k); setPicked((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; }); };

  const run = async () => {
    round.current++; // the user is done choosing
    const items = (found ?? []).filter((f) => picked.has(key(f)));
    if (!items.length) return;
    setBusy('import'); setError(null);
    try {
      const n = await api.importFound(items);
      await refresh();
      notify(t('{0} oyun eklendi', n));
      setScanOpen(false);
      go({ name: 'library', scope: { kind: 'installed' } });
    } catch (err) { setError(String(err)); }
    setBusy(null);
  };

  return (
    <Modal open={scanOpen} onClose={busy === 'import' ? undefined : () => setScanOpen(false)} label={t('Bilgisayarı tara')} title={t('Bilgisayarı tara')} size="lg" className="scan">
      {busy === 'scan' && <p className="scan-state"><RefreshCw size={16} strokeWidth={1.7} className="spin" /> {t('Başlatıcılar ve kısayollar taranıyor…')}</p>}
      {found && found.length === 0 && <p className="scan-state">{t('Yüklü oyun bulunamadı.')}</p>}
      {pending > 0 && <p className="scan-state scan-state-sm"><RefreshCw size={14} strokeWidth={1.7} className="spin" /> {t('Kısayollar tanınıyor ·')} {pending} {t('kaldı')}</p>}
      {found && found.length > 0 && (
        <div className="scan-list">
          {groups.map(([src, items]) => (
            <section key={src} className="scan-group">
              <h3 className="scan-head"><PlatformLogo id={src} size={15} /> {NAMES[src] ?? src} <span className="muted">{items.length}</span></h3>
              <ul>{items.map((f) => <Row key={key(f)} f={f} on={picked.has(key(f))} toggle={() => toggle(key(f))} />)}</ul>
            </section>
          ))}
          {other.length > 0 && (
            <section className="scan-group">
              <button className="scan-head scan-more" onClick={() => setShowOther((v) => !v)} aria-expanded={showOther}>
                <ChevronDown size={15} strokeWidth={1.8} className={`chev ${showOther ? 'is-open' : ''}`} /> {t('Diğer kısayollar')} <span className="muted">{other.length}</span>
              </button>
              {showOther && <ul>{other.map((f) => <Row key={key(f)} f={f} on={picked.has(key(f))} toggle={() => toggle(key(f))} />)}</ul>}
            </section>
          )}
        </div>
      )}
      {error && <p className="warn small" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button className="btn btn-ghost" onClick={scan} disabled={!!busy}>{t('Yeniden tara')}</button>
        <button className="btn btn-primary" onClick={run} disabled={!!busy || picked.size === 0}>
          {busy === 'import' ? <><RefreshCw size={14} strokeWidth={1.7} className="spin" /> {t('Ekleniyor')}</> : t('{0} oyunu ekle', picked.size)}
        </button>
      </div>
    </Modal>
  );
}
