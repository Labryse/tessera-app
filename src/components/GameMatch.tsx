// Adding a game by hand and fixing which game an entry is. Both use the same
// picker: type a name, see Steam and Wikipedia results with their covers, pick one.
import { useEffect, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { Check, FileSearch, RefreshCw, Search } from 'lucide-react';
import { useStore } from '../store';
import { api, type Candidate } from '../lib/backend';
import { Modal } from './Modal';
import { PlatformLogo } from './PlatformLogo';

import { t as tr } from '../lib/i18n';
function CandidatePicker({ query, setQuery, picked, setPicked }: {
  query: string; setQuery: (q: string) => void; picked: Candidate | null; setPicked: (c: Candidate | null) => void;
}) {
  const [list, setList] = useState<Candidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setList(null); return; }
    const n = ++seq.current;
    setBusy(true);
    const t = window.setTimeout(() => {
      api.matchCandidates(q).then((r) => {
        if (n !== seq.current) return;
        setList(r);
        setBusy(false);
      }).catch(() => { if (n === seq.current) { setList([]); setBusy(false); } });
    }, 350);
    return () => window.clearTimeout(t);
  }, [query]);

  return (
    <div className="cand">
      <label className="field field-wide">
        <Search size={15} strokeWidth={1.6} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr('Oyunun adı')} aria-label={tr('Oyunun adı')} autoFocus />
        {busy && <RefreshCw size={14} strokeWidth={1.7} className="spin muted" />}
      </label>
      <div className="cand-grid">
        {list?.map((c) => {
          const on = picked?.source === c.source && picked.id === c.id;
          return (
            <button key={`${c.source}:${c.id}`} className={`cand-item ${on ? 'is-on' : ''}`} onClick={() => setPicked(on ? null : c)} aria-pressed={on}>
              <span className="cand-cover">
                {c.image ? <img src={c.image} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} /> : null}
                {on && <span className="cand-check"><Check size={14} strokeWidth={2.4} /></span>}
              </span>
              <span className="cand-title">{c.title}</span>
              <span className="cand-sub">
                {c.source === 'steam' ? <><PlatformLogo id="steam" size={11} /> {tr('Steam')}</> : (c.subtitle ?? tr('Wikipedia')).replace(/^Wikipedia · /, '')}
              </span>
            </button>
          );
        })}
        {list && list.length === 0 && <p className="muted small">{tr('Sonuç yok. Adı değiştirip dene.')}</p>}
      </div>
    </div>
  );
}

export function AddGameDialog() {
  const { addOpen, setAddOpen, refresh, notify, go } = useStore();
  const [path, setPath] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Candidate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [was, setWas] = useState(addOpen);
  if (was !== addOpen) { setWas(addOpen); if (addOpen) { setPath(null); setQuery(''); setPicked(null); setError(null); } }

  const choose = async () => {
    const p = await open({ multiple: false, directory: false, title: tr('Oyunun .exe dosyasını ya da kısayolunu seç'), filters: [{ name: 'Oyun', extensions: ['exe', 'lnk'] }] });
    if (typeof p !== 'string') return;
    setPath(p);
    // a first guess for the name: the folder for an exe, the file name for a shortcut
    const parts = p.split(/[\\/]/);
    const file = parts.pop() ?? '';
    const folder = parts.pop() ?? '';
    const name = /\.lnk$/i.test(file) || /^(bin|win|x64|x86|binaries)/i.test(folder) ? file.replace(/\.(exe|lnk)$/i, '') : folder;
    setQuery(name.replace(/[_.]/g, ' ').replace(/\s+-\s+(Kısayol|Shortcut)$/i, '').trim());
  };

  const add = async () => {
    if (!path) return;
    setBusy(true); setError(null);
    try {
      const id = await api.addGame(path, picked?.title ?? (query.trim() || null), picked);
      await refresh();
      notify(tr('Oyun eklendi'));
      setAddOpen(false);
      go({ name: 'game', id });
    } catch (err) { setError(String(err)); }
    setBusy(false);
  };

  return (
    <Modal open={addOpen} onClose={busy ? undefined : () => setAddOpen(false)} label={tr('Oyun ekle')} title={tr('Oyun ekle')} size="lg" className="addgame">
      <button className={`pick-file ${path ? 'has' : ''}`} onClick={choose}>
        <FileSearch size={18} strokeWidth={1.6} />
        <span className="pick-file-text">{path ?? tr('.exe ya da kısayol seç')}</span>
        <span className="muted small">{path ? tr('Değiştir') : tr('Gözat')}</span>
      </button>
      {path && <CandidatePicker query={query} setQuery={setQuery} picked={picked} setPicked={setPicked} />}
      {error && <p className="warn small" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button className="btn btn-ghost" onClick={() => setAddOpen(false)} disabled={busy}>{tr('Vazgeç')}</button>
        <button className="btn btn-primary" onClick={add} disabled={!path || busy}>
          {busy ? <><RefreshCw size={14} strokeWidth={1.7} className="spin" /> {tr('Ekleniyor')}</> : picked ? tr('Ekle') : tr('Eşleştirmeden ekle')}
        </button>
      </div>
    </Modal>
  );
}

export function MatchDialog() {
  const { matchFor, setMatchFor, byId, refresh, notify } = useStore();
  const g = matchFor ? byId.get(matchFor) : undefined;
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Candidate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [was, setWas] = useState<string | null>(matchFor);
  if (was !== matchFor) { setWas(matchFor); if (matchFor && g) { setQuery(g.title); setPicked(null); setError(null); } }

  const apply = async (c: Candidate | null) => {
    if (!g) return;
    setBusy(true); setError(null);
    try {
      await api.rematch(g.id, c);
      await refresh();
      notify(c ? tr('Eşleştirildi: {0}', c.title) : tr('Bilgiler temizlendi'));
      setMatchFor(null);
    } catch (err) { setError(String(err)); }
    setBusy(false);
  };

  return (
    <Modal open={!!matchFor} onClose={busy ? undefined : () => setMatchFor(null)} label={tr('Bilgileri eşleştir')} title={tr('Bu oyun hangisi?')} size="lg" className="addgame">
      <CandidatePicker query={query} setQuery={setQuery} picked={picked} setPicked={setPicked} />
      {error && <p className="warn small" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button className="btn btn-ghost" onClick={() => apply(null)} disabled={busy}>{tr('Bilgileri temizle')}</button>
        <button className="btn btn-primary" onClick={() => apply(picked)} disabled={!picked || busy}>
          {busy ? <><RefreshCw size={14} strokeWidth={1.7} className="spin" /> {tr('Uygulanıyor')}</> : tr('Eşleştir')}
        </button>
      </div>
    </Modal>
  );
}
