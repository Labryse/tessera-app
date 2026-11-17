// Shared themes in Settings → Appearance: the user's own and imported ones, the studio
// to make or change one, and ways to pass one on (a file, or a code to paste).
import { useState, type CSSProperties } from 'react';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { Check, ClipboardPaste, Copy, Download, FolderOpen, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { THEMES, useStore, type ThemeId } from '../store';
import { api, isDesktop } from '../lib/backend';
import { deleteTheme, fromCode, previewBackground, saveTheme, setCustom, useCustomThemes, type CustomTheme } from '../lib/customThemes';
import { Modal } from './Modal';
import { openStudio } from './studio/Studio';
import { t as tr } from '../lib/i18n';

/** the little window drawn on a theme card, in the theme's own colours */
function Mini({ t }: { t: CustomTheme }) {
  const c = t.colors;
  const r = t.radii?.sheet ?? (t.radius != null ? t.radius + 6 : undefined);
  return (
    <span className="theme-mini" style={{ background: previewBackground(t), fontFamily: t.type?.body ? `"${t.type.body}"` : undefined }} aria-hidden="true">
      <span className="theme-mini-side">
        <span style={{ background: c.text, opacity: 0.8, width: '60%' }} />
        <span style={{ background: c.active ?? c.raised }} />
        <span style={{ background: c.text, opacity: 0.35 }} />
        <span style={{ background: c.text, opacity: 0.35, width: '70%' }} />
      </span>
      <span className="theme-mini-sheet" style={{ background: c.surface, borderRadius: r != null ? Math.max(1, r / 2) : undefined, backdropFilter: t.surface?.blur ? `blur(${t.surface.blur / 3}px)` : undefined }}>
        <span className="theme-mini-title" style={{ background: c.text }} />
        <span className="theme-mini-tiles">{[0, 1, 2, 3].map((k) => <span key={k} style={{ background: k === 1 ? c.accent : c.raised }} />)}</span>
      </span>
    </span>
  );
}

const asCode = (t: CustomTheme) => {
  const { id: _id, ...body } = t;
  void _id;
  return JSON.stringify({ tessera: 2, ...body });
};

export function CustomThemes() {
  const { setTheme, notify, closeSettings } = useStore();
  const { list, active, bump } = useCustomThemes();
  const [pasting, setPasting] = useState(false);

  const pick = (t: CustomTheme) => { setTheme(t.base as ThemeId); setCustom(t); };
  const studio = (t: CustomTheme | null) => { closeSettings(); openStudio(t); };
  const doImport = async () => {
    const path = await openDialog({ multiple: false, filters: [{ name: tr('Tessera teması'), extensions: ['json'] }] });
    if (!path || Array.isArray(path)) return;
    try { await api.themeImport(path); bump(); notify(tr('Tema eklendi')); } catch (e) { notify(String(e)); }
  };
  const doExport = async (t: CustomTheme) => {
    const path = await saveDialog({ defaultPath: `${t.name}.json`, filters: [{ name: tr('Tessera teması'), extensions: ['json'] }] });
    if (!path) return;
    try { await api.themeExport(t.id, path); notify(tr('Tema dışa aktarıldı')); } catch (e) { notify(String(e)); }
  };
  const copy = async (t: CustomTheme) => {
    try { await navigator.clipboard.writeText(asCode(t)); notify(tr('Tema kodu kopyalandı')); } catch (e) { notify(String(e)); }
  };
  const remove = async (t: CustomTheme) => {
    try {
      await deleteTheme(t.id);
      if (active?.id === t.id) setCustom(null);
      bump();
      notify(tr('{0} silindi', t.name));
    } catch (e) { notify(String(e)); }
  };

  return (
    <div className="custom-themes">
      <div className="shop-section-head">
        <span className="sub-label">{tr('Senin temaların')}</span>
        <span className="set-actions">
          <button className="btn btn-sm" onClick={() => studio(null)}><Plus size={14} strokeWidth={1.8} /> {tr('Tema oluştur')}</button>
          <button className="btn btn-sm" onClick={() => setPasting(true)}><ClipboardPaste size={14} strokeWidth={1.8} /> {tr('Koddan ekle')}</button>
          {isDesktop && <button className="btn btn-sm" onClick={doImport}><Download size={14} strokeWidth={1.8} /> {tr('İçe aktar')}</button>}
          {isDesktop && <button className="btn btn-sm btn-ghost" onClick={() => api.themeFolder().catch((e) => notify(String(e)))} aria-label={tr('Tema klasörünü aç')} title={tr('Tema klasörünü aç')}><FolderOpen size={15} strokeWidth={1.7} /></button>}
        </span>
      </div>
      {list.length > 0 && (
        <div className="theme-grid" role="radiogroup" aria-label={tr('Senin temaların')}>
          {list.map((t, i) => (
            <div key={t.id} className={`theme-card custom-card ${active?.id === t.id ? 'is-on' : ''}`} style={{ '--i': i } as CSSProperties}>
              <button className="custom-pick" role="radio" aria-checked={active?.id === t.id} onClick={() => pick(t)}>
                <Mini t={t} />
                <span className="theme-card-foot">
                  <span><span className="theme-card-name">{t.name}</span><span className="theme-card-note">{t.author ?? THEMES.find((b) => b.id === t.base)?.name}</span></span>
                  {active?.id === t.id && <Check size={16} strokeWidth={2} />}
                </span>
              </button>
              <span className="custom-tools">
                <button className="icon-btn" onClick={() => studio(t)} aria-label={tr('{0} düzenle', t.name)} title={tr('Düzenle')}><Pencil size={13} strokeWidth={1.8} /></button>
                <button className="icon-btn" onClick={() => copy(t)} aria-label={tr('{0} kodunu kopyala', t.name)} title={tr('Kodu kopyala')}><Copy size={13} strokeWidth={1.8} /></button>
                {isDesktop && <button className="icon-btn" onClick={() => doExport(t)} aria-label={tr('{0} dışa aktar', t.name)} title={tr('Dışa aktar')}><Upload size={13} strokeWidth={1.8} /></button>}
                <button className="icon-btn" onClick={() => remove(t)} aria-label={tr('{0} sil', t.name)} title={tr('Sil')}><Trash2 size={13} strokeWidth={1.8} /></button>
              </span>
            </div>
          ))}
        </div>
      )}
      <PasteCode open={pasting} onClose={(added) => { setPasting(false); if (added) bump(); }} />
    </div>
  );
}

function PasteCode({ open, onClose }: { open: boolean; onClose: (added: boolean) => void }) {
  const { notify } = useStore();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async () => {
    const t = fromCode(code);
    if (!t) { notify(tr('Bu bir Tessera teması değil.')); return; }
    setBusy(true);
    try {
      await saveTheme(t);
      notify(tr('{0} eklendi', t.name));
      setCode('');
      onClose(true);
    } catch (e) { notify(String(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={() => onClose(false)} label={tr('Koddan ekle')} title={tr('Koddan ekle')} size="md">
      <div className="paste-code">
        <textarea className="sd-css" value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} placeholder={'{ "tessera": 2, "name": … }'} autoFocus aria-label={tr('Tema kodu')} />
        <div className="studio-foot">
          <button className="btn btn-ghost" onClick={() => onClose(false)}>{tr('Vazgeç')}</button>
          <button className="btn btn-accent" onClick={add} disabled={busy || !code.trim()}>{tr('Ekle')}</button>
        </div>
      </div>
    </Modal>
  );
}
