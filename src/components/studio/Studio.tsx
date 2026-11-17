// The theme studio: a panel docked to the side of the window while the app itself is the
// preview. Every part of the look can be changed: colours, type and fonts, corners and
// widths, the page surface, the backdrop (a picture too), touches on buttons, the menu,
// covers and titles, rules for any single part picked on screen, and free CSS.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeftRight, Brush, LayoutDashboard, ToggleRight, Code2, Copy, Dices, Eye, ImagePlus, Layers, MousePointerClick, Plus, Redo2, RotateCcw, Shapes,
  Sparkles, SquareDashed, Trash2, Type, Undo2, Wallpaper, X,
} from 'lucide-react';
import { THEMES, useStore, type ThemeId } from '../../store';
import {
  activeCustom, applyCustom, COLOR_KEYS, cleanSel, currentColors, FINE_KEYS, fontName, saveTheme, setCustom,
  type Backdrop, type ColorKey, type CustomTheme, type PatternKind, type Rule, type RuleProp, type Touches,
} from '../../lib/customThemes';
import { contrast, isDark, over, paletteFrom, parse, randomAccent, resolve, withAlpha } from '../../lib/color';
import { ColorField } from './ColorField';
import { candidates, nameOf, pick } from './pickElement';
import { t } from '../../lib/i18n';
import { Flip, Group, Seg, Slider, type Ctx } from './controls';
import { FeaturesTab, LayoutTab } from './LayoutTabs';

// ---------------------------------------------------------------- opening and closing

let opening: { theme: CustomTheme | null; n: number } | null = null;
const subs = new Set<() => void>();
let count = 0;
/** opens the studio on a theme (null: a new one from the current look) */
export function openStudio(theme: CustomTheme | null) {
  opening = { theme, n: ++count };
  subs.forEach((f) => f());
}
function closeStudio() {
  opening = null;
  subs.forEach((f) => f());
}

export function StudioDock() {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    subs.add(f);
    return () => { subs.delete(f); };
  }, []);
  if (!opening) return null;
  return createPortal(<Dock key={opening.n} start={opening.theme} />, document.body);
}

// ---------------------------------------------------------------- the draft

const LABEL: Record<ColorKey, string> = {
  ground: t('Zemin'), surface: t('Sayfa'), raised: t('Kart'), border: t('Çizgi'), text: t('Yazı'), muted: t('Soluk yazı'),
  accent: t('Vurgu'), accentInk: t('Vurgu üstü yazı'), positive: t('Olumlu'), negative: t('Olumsuz'),
  active: t('Seçili'), rule: t('İnce çizgi'), control: t('Kontrol'), faint: t('Silik yazı'), accentWash: t('Vurgu zemini'),
  primary: t('Ana buton'), primaryInk: t('Ana buton yazısı'), coverShade: t('Kapak kenarı'),
};
const MAIN_KEYS = COLOR_KEYS.filter((k) => !FINE_KEYS.includes(k));

function px(name: string, d: number) {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(v) ? Math.round(v) : d;
}
const currentRadii = () => ({
  sheet: px('--radius-sheet', 16), card: px('--radius-card', 14), cover: px('--radius-cover', 8), control: px('--radius-control', 10), chip: Math.min(40, px('--radius-chip', 999)),
});

function fresh(base: string): CustomTheme {
  const now = activeCustom();
  if (now) return { ...structuredClone(now), id: 'draft', name: '', author: now.author ?? null };
  // the fine colours stay empty: they follow the main ones until set
  const all = currentColors();
  const colors: CustomTheme['colors'] = { coverShade: all.coverShade };
  for (const k of MAIN_KEYS) colors[k] = all[k];
  return { id: 'draft', name: '', author: null, base, colors, radii: currentRadii(), backdrop: { kind: 'base' }, rules: [], fonts: [] };
}

/** the look before the studio, back on */
function revert(base: string) {
  const before = activeCustom();
  applyCustom(before);
  document.documentElement.dataset.theme = before?.base ?? base;
}

type Tab = 'colors' | 'type' | 'shape' | 'surface' | 'backdrop' | 'touches' | 'layout' | 'features' | 'parts' | 'css';
const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: 'colors', label: t('Renkler'), icon: <Brush size={15} strokeWidth={1.8} /> },
  { id: 'type', label: t('Yazı'), icon: <Type size={15} strokeWidth={1.8} /> },
  { id: 'shape', label: t('Şekil'), icon: <Shapes size={15} strokeWidth={1.8} /> },
  { id: 'surface', label: t('Yüzey'), icon: <Layers size={15} strokeWidth={1.8} /> },
  { id: 'backdrop', label: t('Arka plan'), icon: <Wallpaper size={15} strokeWidth={1.8} /> },
  { id: 'touches', label: t('Dokunuş'), icon: <Sparkles size={15} strokeWidth={1.8} /> },
  { id: 'layout', label: t('Yerleşim'), icon: <LayoutDashboard size={15} strokeWidth={1.8} /> },
  { id: 'features', label: t('Özellikler'), icon: <ToggleRight size={15} strokeWidth={1.8} /> },
  { id: 'parts', label: t('Öğeler'), icon: <MousePointerClick size={15} strokeWidth={1.8} /> },
  { id: 'css', label: t('CSS'), icon: <Code2 size={15} strokeWidth={1.8} /> },
];


const SIDE_KEY = 'tessera.studioSide';

function Dock({ start }: { start: CustomTheme | null }) {
  const { theme: base, setTheme, notify, openSettings } = useStore();
  const [d, setD] = useState<CustomTheme>(() => (start ? { ...structuredClone(start) } : fresh(base)));
  const now = useRef(d);
  const hist = useRef({ past: [] as CustomTheme[], future: [] as CustomTheme[], at: 0 });
  const [steps, setSteps] = useState({ back: 0, fwd: 0 });
  const [tab, setTab] = useState<Tab>('colors');
  const [side, setSide] = useState<'right' | 'left'>(() => { try { return localStorage.getItem(SIDE_KEY) === 'left' ? 'left' : 'right'; } catch { return 'right'; } });
  const [busy, setBusy] = useState(false);
  const [peek, setPeek] = useState(false);
  const dock = useRef<HTMLDivElement>(null);

  // the window is the preview
  useEffect(() => { applyCustom({ ...d, id: 'draft' }); }, [d]);
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('studio-on');
    root.dataset.studio = side;
    try { localStorage.setItem(SIDE_KEY, side); } catch { /* ignore */ }
    return () => { root.classList.remove('studio-on'); delete root.dataset.studio; };
  }, [side]);
  useEffect(() => { document.documentElement.classList.toggle('studio-peek', peek); }, [peek]);
  useEffect(() => () => document.documentElement.classList.remove('studio-peek'), []);

  const change = (f: (d: CustomTheme) => CustomTheme) => {
    const prev = now.current;
    const next = f(prev);
    const h = hist.current;
    if (Date.now() - h.at > 600) { h.past.push(prev); if (h.past.length > 120) h.past.shift(); }
    h.at = Date.now();
    h.future = [];
    now.current = next;
    setD(next);
    setSteps({ back: h.past.length, fwd: 0 });
  };
  const part: Ctx['part'] = (k, patch) => change((x) => ({ ...x, [k]: patch === null ? null : { ...((x[k] as object | null | undefined) ?? (k === 'backdrop' ? { kind: 'base' } : {})), ...patch } }));
  const step = (back: boolean) => {
    const h = hist.current;
    const from = back ? h.past : h.future;
    const to = back ? h.future : h.past;
    const got = from.pop();
    if (!got) return;
    to.push(now.current);
    h.at = 0;
    // the name is typed, not undone
    const v = { ...got, name: now.current.name, author: now.current.author };
    now.current = v;
    setD(v);
    setSteps({ back: h.past.length, fwd: h.future.length });
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (typing || !(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); step(true); }
      if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); step(false); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const finish = () => { closeStudio(); openSettings('appearance'); };
  const cancel = () => { revert(base); finish(); };
  const save = async () => {
    const name = d.name.trim();
    if (!name) { notify(t('Temaya bir ad ver')); return; }
    setBusy(true);
    try {
      const { id: _id, ...body } = d;
      void _id;
      const id = await saveTheme({ ...body, name }, start?.id);
      setTheme(d.base as ThemeId);
      setCustom({ ...d, id, name });
      notify(t('{0} kaydedildi', name));
      finish();
    } catch (e) { notify(String(e)); setBusy(false); }
  };
  const copy = async () => {
    const { id: _id, ...body } = d;
    void _id;
    try { await navigator.clipboard.writeText(JSON.stringify({ tessera: 2, ...body, name: d.name.trim() || t('Adsız tema') })); notify(t('Tema kodu kopyalandı')); } catch (e) { notify(String(e)); }
  };

  const c = d.colors;
  const swatches = [c.ground, c.surface, c.raised, c.border, c.text, c.muted, c.accent, c.accentInk, c.positive, c.negative, d.touches?.second, ...(d.backdrop?.colors ?? []), '#ffffff', '#000000', '#00000000']
    .filter((x): x is string => !!x);
  const ctx: Ctx = { d, change, part, swatches, dock };

  return (
    <div ref={dock} className={`studio-dock is-${side} ${peek ? 'is-peek' : ''}`} role="dialog" aria-label={t('Tema stüdyosu')}>
      <header className="sd-head">
        <div className="sd-names">
          <input className="sd-name" value={d.name} maxLength={60} placeholder={t('Tema adı')} aria-label={t('Tema adı')} autoFocus
            onChange={(e) => { const v = e.target.value; now.current = { ...now.current, name: v }; setD(now.current); }} />
          <input className="sd-author" value={d.author ?? ''} maxLength={60} placeholder={t('Yapan')} aria-label={t('Yapan')}
            onChange={(e) => { const v = e.target.value || null; now.current = { ...now.current, author: v }; setD(now.current); }} />
        </div>
        <div className="sd-head-tools">
          <button className="sd-icon" onClick={() => step(true)} disabled={!steps.back} title={t('Geri al (Ctrl+Z)')} aria-label={t('Geri al')}><Undo2 size={15} strokeWidth={1.8} /></button>
          <button className="sd-icon" onClick={() => step(false)} disabled={!steps.fwd} title={t('Yinele (Ctrl+Y)')} aria-label={t('Yinele')}><Redo2 size={15} strokeWidth={1.8} /></button>
          <button className="sd-icon" onClick={copy} title={t('Tema kodunu kopyala')} aria-label={t('Tema kodunu kopyala')}><Copy size={15} strokeWidth={1.8} /></button>
          <button className="sd-icon" onMouseDown={() => setPeek(true)} onMouseUp={() => setPeek(false)} onMouseLeave={() => setPeek(false)} title={t('Basılı tut: paneli gizle')} aria-label={t('Paneli gizle')}><Eye size={15} strokeWidth={1.8} /></button>
          <button className="sd-icon" onClick={() => setSide((s) => (s === 'right' ? 'left' : 'right'))} title={t('Paneli öbür yana al')} aria-label={t('Paneli öbür yana al')}><ArrowLeftRight size={15} strokeWidth={1.8} /></button>
          <button className="sd-icon" onClick={cancel} title={t('Kapat')} aria-label={t('Kapat')}><X size={16} strokeWidth={1.8} /></button>
        </div>
      </header>
      <nav className="sd-tabs" role="tablist" aria-label={t('Tema stüdyosu')}>
        {TABS.map((x) => (
          <button key={x.id} role="tab" aria-selected={tab === x.id} className={tab === x.id ? 'is-on' : ''} onClick={() => setTab(x.id)}>
            {x.icon}<span>{x.label}</span>
          </button>
        ))}
      </nav>
      <div className="sd-body" key={tab}>
        {tab === 'colors' && <Colors {...ctx} />}
        {tab === 'type' && <TypeTab {...ctx} />}
        {tab === 'shape' && <ShapeTab {...ctx} />}
        {tab === 'surface' && <SurfaceTab {...ctx} />}
        {tab === 'backdrop' && <BackdropTab {...ctx} />}
        {tab === 'touches' && <TouchesTab {...ctx} />}
        {tab === 'layout' && <LayoutTab {...ctx} />}
        {tab === 'features' && <FeaturesTab {...ctx} />}
        {tab === 'parts' && <PartsTab {...ctx} />}
        {tab === 'css' && <CssTab {...ctx} />}
      </div>
      <footer className="sd-foot">
        <button className="sd-btn" onClick={cancel}>{t('Vazgeç')}</button>
        <button className="sd-btn is-main" onClick={save} disabled={busy}>{t('Kaydet')}</button>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------- small controls

function Ratio({ fg, bg, under, min = 4.5 }: { fg?: string; bg?: string; under?: string; min?: number }) {
  const f = fg ? resolve(fg) : null;
  let b = bg ? resolve(bg) : null;
  const u = under ? resolve(under) : null;
  if (!f || !b) return null;
  if (b.a < 1 && u) b = over(b, u);
  const r = contrast(over(f, b), b);
  return <span className={`sd-ratio ${r < min ? 'is-low' : ''}`} title={t('Okunabilirlik: {0}:1', r.toFixed(1))}>{r.toFixed(1)}</span>;
}

// ---------------------------------------------------------------- colours

function Colors({ d, change, swatches }: Ctx) {
  const c = d.colors;
  const set = (k: ColorKey, v: string | null) => change((x) => {
    const colors = { ...x.colors };
    if (v === null) delete colors[k]; else colors[k] = v;
    return { ...x, colors };
  });
  const dark = isDark(parse(c.ground ?? '') ?? { r: 20, g: 20, b: 20, a: 1 });
  const fromAccent = (accent: string, darkMode: boolean) => change((x) => ({ ...x, colors: { ...paletteFrom(accent, darkMode), coverShade: x.colors.coverShade } as CustomTheme['colors'] }));
  const fromBase = (id: string) => {
    // the base's own colours: read with the draft taken off for a moment
    applyCustom(null);
    document.documentElement.dataset.theme = id;
    const cols = currentColors();
    change((x) => ({ ...x, base: id, colors: cols }));
  };
  return (
    <>
      <Group title={t('Temel tema')}>
        <div className="sd-bases" role="radiogroup" aria-label={t('Temel tema')}>
          {THEMES.map((b) => (
            <button key={b.id} role="radio" aria-checked={d.base === b.id} className={`sd-base ${d.base === b.id ? 'is-on' : ''}`} onClick={() => change((x) => ({ ...x, base: b.id }))}>
              <span className="sd-base-sw" style={{ background: `linear-gradient(135deg, ${b.swatch[0]} 0 50%, ${b.swatch[1]} 50% 75%, ${b.swatch[2]} 75%)` }} />
              <span>{b.name}</span>
            </button>
          ))}
        </div>
        <div className="sd-actions">
          <button className="sd-chip" onClick={() => fromBase(d.base)}><RotateCcw size={13} strokeWidth={1.8} /> {t('Temelin renklerini al')}</button>
        </div>
      </Group>
      <Group title={t('Palet')}>
        <div className="sd-actions">
          <button className="sd-chip" onClick={() => fromAccent(c.accent ?? '#7aa2d6', true)}><Sparkles size={13} strokeWidth={1.8} /> {t('Vurgudan koyu palet')}</button>
          <button className="sd-chip" onClick={() => fromAccent(c.accent ?? '#3a6585', false)}><Sparkles size={13} strokeWidth={1.8} /> {t('Vurgudan açık palet')}</button>
          <button className="sd-chip" onClick={() => fromAccent(randomAccent(), dark)}><Dices size={13} strokeWidth={1.8} /> {t('Zar at')}</button>
        </div>
      </Group>
      <Group title={t('Ana renkler')}>
        <div className="sd-colors">
          {MAIN_KEYS.map((k) => (
            <ColorField key={k} label={LABEL[k]} value={c[k]} onChange={(v) => set(k, v)} swatches={swatches}
              note={k === 'text' ? <Ratio fg={c.text} bg={c.surface} under={c.ground} />
                : k === 'muted' ? <Ratio fg={c.muted} bg={c.surface} under={c.ground} min={3} />
                  : k === 'accentInk' ? <Ratio fg={c.accentInk} bg={c.accent} min={3} /> : null} />
          ))}
        </div>
      </Group>
      <Group title={t('İnce ayar')} onReset={() => change((x) => { const colors = { ...x.colors }; for (const k of FINE_KEYS) delete colors[k]; return { ...x, colors }; })}>
        <div className="sd-colors">
          {FINE_KEYS.map((k) => (
            <ColorField key={k} label={LABEL[k]} value={c[k]} fallback={`var(--${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)})`} onChange={(v) => set(k, v)} onClear={() => set(k, null)} swatches={swatches} />
          ))}
        </div>
      </Group>
    </>
  );
}

// ---------------------------------------------------------------- type

const WINDOWS_FONTS = [
  'Segoe UI', 'Segoe UI Variable Display', 'Bahnschrift', 'Arial', 'Calibri', 'Cambria', 'Candara', 'Cascadia Code', 'Consolas',
  'Constantia', 'Corbel', 'Courier New', 'Franklin Gothic Medium', 'Gabriola', 'Georgia', 'Impact', 'Ink Free', 'Lucida Console',
  'Palatino Linotype', 'Segoe Print', 'Segoe Script', 'Sitka Text', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Comic Sans MS',
];
const LOCAL_KEY = 'tessera.localFonts';
const readLocal = (): string[] => { try { return JSON.parse(sessionStorage.getItem(LOCAL_KEY) ?? '[]'); } catch { return []; } };
const canQuery = typeof window !== 'undefined' && 'queryLocalFonts' in window;

function FontPick({ label, value, own, local, onChange, empty }: { label: string; value: string | null | undefined; own: string[]; local: string[]; onChange: (v: string | null) => void; empty: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', off);
    return () => window.removeEventListener('mousedown', off);
  }, [open]);
  const groups: [string, string[]][] = [
    [t('Temanın yazı tipleri'), own],
    [t('Tessera'), ['Hanken Grotesk Variable']],
    [t('Windows'), WINDOWS_FONTS],
    [t('Bilgisayarındakiler'), local.filter((f) => !WINDOWS_FONTS.includes(f))],
  ];
  const match = (f: string) => !q || f.toLowerCase().includes(q.toLowerCase());
  return (
    <div className="sd-font" ref={ref}>
      <span className="sd-seg-label">{label}</span>
      <button className="sd-font-btn" style={{ fontFamily: value ? `"${value}"` : undefined }} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {value ?? empty}
      </button>
      {open && (
        <div className="sd-font-list">
          <input className="sd-input" placeholder={t('Yazı tipi ara')} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <div className="sd-font-scroll">
            <button className={!value ? 'is-on' : ''} onClick={() => { onChange(null); setOpen(false); }}>{empty}</button>
            {groups.map(([g, list]) => {
              const shown = list.filter(match);
              if (!shown.length) return null;
              return (
                <div key={g}>
                  <div className="sd-font-group">{g}</div>
                  {shown.map((f) => <button key={f} className={value === f ? 'is-on' : ''} style={{ fontFamily: `"${f}"` }} onClick={() => { onChange(f); setOpen(false); }}>{f}</button>)}
                </div>
              );
            })}
            {q && !groups.some(([, l]) => l.some((f) => f.toLowerCase() === q.toLowerCase())) && (
              <button style={{ fontFamily: `"${fontName(q)}"` }} onClick={() => { onChange(fontName(q)); setOpen(false); }}>{t('“{0}” kullan', fontName(q))}</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const readFile = (f: File) => new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => no(r.error); r.readAsDataURL(f); });

function TypeTab({ d, change, part }: Ctx) {
  const { notify } = useStore();
  const ty = d.type ?? {};
  const fonts = d.fonts ?? [];
  const [local, setLocal] = useState<string[]>(readLocal);
  const file = useRef<HTMLInputElement>(null);
  const own = fonts.map((f) => f.name);
  const addFont = async (f: File) => {
    if (f.size > 3 * 1024 * 1024) { notify(t('Yazı tipi dosyası 3 MB’tan küçük olmalı')); return; }
    let data = await readFile(f);
    const ext = f.name.split('.').pop()?.toLowerCase();
    const mime = ext === 'woff2' ? 'font/woff2' : ext === 'woff' ? 'font/woff' : ext === 'otf' ? 'font/otf' : 'font/ttf';
    data = data.replace(/^data:[^;]*;base64,/, `data:${mime};base64,`);
    const name = fontName(f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ')) || 'Font';
    change((x) => ({ ...x, fonts: [...(x.fonts ?? []).filter((y) => y.name !== name), { name, data }].slice(-4), type: { ...(x.type ?? {}), body: x.type?.body ?? name } }));
  };
  const queryFonts = async () => {
    try {
      const all = await (window as unknown as { queryLocalFonts: () => Promise<{ family: string }[]> }).queryLocalFonts();
      const fams = [...new Set(all.map((f) => f.family))].sort((a, b) => a.localeCompare(b));
      setLocal(fams);
      try { sessionStorage.setItem(LOCAL_KEY, JSON.stringify(fams)); } catch { /* ignore */ }
    } catch { notify(t('Yazı tipleri okunamadı')); }
  };
  return (
    <>
      <Group title={t('Yazı tipleri')} onReset={() => change((x) => ({ ...x, type: { ...(x.type ?? {}), body: null, heading: null } }))}>
        <FontPick label={t('Metin')} value={ty.body} own={own} local={local} empty={t('Temelin yazısı')} onChange={(v) => part('type', { body: v })} />
        <FontPick label={t('Başlıklar')} value={ty.heading} own={own} local={local} empty={t('Metinle aynı')} onChange={(v) => part('type', { heading: v })} />
        <div className="sd-actions">
          <button className="sd-chip" onClick={() => file.current?.click()}><Plus size={13} strokeWidth={1.8} /> {t('Yazı tipi dosyası ekle')}</button>
          {canQuery && <button className="sd-chip" onClick={queryFonts}><Type size={13} strokeWidth={1.8} /> {t('Bilgisayarımdakileri listele')}</button>}
          <input ref={file} type="file" accept=".ttf,.otf,.woff,.woff2" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void addFont(f); }} />
        </div>
        {fonts.length > 0 && (
          <ul className="sd-files">
            {fonts.map((f) => (
              <li key={f.name}>
                <span style={{ fontFamily: `"${f.name}"` }}>{f.name}</span>
                <span className="num">{Math.round((f.data.length * 0.75) / 1024)} KB</span>
                <button className="sd-mini" onClick={() => change((x) => ({ ...x, fonts: (x.fonts ?? []).filter((y) => y.name !== f.name) }))} aria-label={t('{0} sil', f.name)}><Trash2 size={12} strokeWidth={1.8} /></button>
              </li>
            ))}
          </ul>
        )}
      </Group>
      <Group title={t('Boyut ve kalınlık')} onReset={() => change((x) => ({ ...x, type: { body: x.type?.body, heading: x.type?.heading } }))}>
        <Slider label={t('Arayüz boyutu')} value={ty.scale ?? 100} min={80} max={130} unit="%" onChange={(v) => part('type', { scale: v })} />
        <Slider label={t('Metin kalınlığı')} value={ty.bodyWeight ?? 400} min={300} max={600} step={10} onChange={(v) => part('type', { bodyWeight: v })} />
        <Slider label={t('Başlık kalınlığı')} value={ty.weight ?? 650} min={200} max={900} step={10} onChange={(v) => part('type', { weight: v })} />
        <Slider label={t('Başlık harf aralığı')} value={ty.tracking ?? -15} min={-80} max={200} onChange={(v) => part('type', { tracking: v })} />
        <Flip label={t('Başlıklar büyük harf')} on={!!ty.caps} onChange={(v) => part('type', { caps: v })} />
      </Group>
    </>
  );
}

// ---------------------------------------------------------------- shape

function ShapeTab({ d, change, part }: Ctx) {
  const r = { ...currentRadiiOf(d) };
  const [linked, setLinked] = useState(true);
  const all = (v: number) => part('radii', { card: v, sheet: v + 6, cover: Math.max(0, v - 4), control: Math.max(0, v - 4) });
  return (
    <>
      <Group title={t('Köşeler')} onReset={() => change((x) => ({ ...x, radii: null, radius: null }))} extra={<Flip label={t('Birlikte')} on={linked} onChange={setLinked} />}>
        {linked ? (
          <Slider label={t('Köşe yuvarlığı')} value={r.card} min={0} max={32} unit="px" onChange={all} />
        ) : (
          <>
            <Slider label={t('Sayfa')} value={r.sheet} min={0} max={48} unit="px" onChange={(v) => part('radii', { sheet: v })} />
            <Slider label={t('Kartlar ve paneller')} value={r.card} min={0} max={40} unit="px" onChange={(v) => part('radii', { card: v })} />
            <Slider label={t('Kapaklar')} value={r.cover} min={0} max={40} unit="px" onChange={(v) => part('radii', { cover: v })} />
            <Slider label={t('Butonlar ve alanlar')} value={r.control} min={0} max={30} unit="px" onChange={(v) => part('radii', { control: v })} />
          </>
        )}
        <Slider label={t('Etiketler')} value={r.chip} min={0} max={40} unit="px" onChange={(v) => part('radii', { chip: v })} />
      </Group>
      <Group title={t('Boşluk')} onReset={() => change((x) => ({ ...x, surface: { ...(x.surface ?? {}), gap: undefined } }))}>
        <Slider label={t('Sayfa çevresindeki boşluk')} value={d.surface?.gap ?? 8} min={0} max={32} unit="px" onChange={(v) => part('surface', { gap: v })} />
      </Group>
    </>
  );
}
function currentRadiiOf(d: CustomTheme) {
  const live = currentRadii();
  const r = d.radii ?? {};
  return { sheet: r.sheet ?? live.sheet, card: r.card ?? live.card, cover: r.cover ?? live.cover, control: r.control ?? live.control, chip: r.chip ?? live.chip };
}

// ---------------------------------------------------------------- surface

function SurfaceTab({ d, change, part }: Ctx) {
  const su = d.surface ?? {};
  const alpha = (k: ColorKey) => Math.round((resolve(d.colors[k] ?? `var(--${k})`)?.a ?? 1) * 100);
  const setAlpha = (k: ColorKey, v: number) => change((x) => {
    const base = x.colors[k] ?? currentColors()[k];
    return { ...x, colors: { ...x.colors, [k]: withAlpha(base, v / 100) } };
  });
  return (
    <>
      <Group title={t('Saydamlık')}>
        <Slider label={t('Sayfa')} value={alpha('surface')} min={0} max={100} unit="%" onChange={(v) => setAlpha('surface', v)} />
        <Slider label={t('Kartlar')} value={alpha('raised')} min={0} max={100} unit="%" onChange={(v) => setAlpha('raised', v)} />
        <Slider label={t('Arkasını bulanıklaştır')} value={su.blur ?? 0} min={0} max={40} unit="px" onChange={(v) => part('surface', { blur: v })} />
      </Group>
      <Group title={t('Kenar ve gölge')} onReset={() => change((x) => ({ ...x, surface: x.surface?.gap != null ? { gap: x.surface.gap } : null }))}>
        <Slider label={t('Kenar kalınlığı')} value={su.border ?? 1} min={0} max={4} step={0.5} unit="px" onChange={(v) => part('surface', { border: v })} />
        <Slider label={t('Sayfa gölgesi')} value={su.shadow ?? 0} min={0} max={100} unit="%" onChange={(v) => part('surface', { shadow: v })} />
        <Flip label={t('Vurgu rengiyle parlasın')} on={!!su.glow} onChange={(v) => part('surface', { glow: v })} />
      </Group>
    </>
  );
}

// ---------------------------------------------------------------- backdrop

async function shrinkImage(f: File): Promise<string> {
  if (f.type === 'image/gif' && f.size <= 6 * 1024 * 1024) return readFile(f);
  const img = await createImageBitmap(f);
  const s = Math.min(1, 2560 / Math.max(img.width, img.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(img.width * s);
  cv.height = Math.round(img.height * s);
  cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height);
  img.close();
  const webp = cv.toDataURL('image/webp', 0.85);
  return webp.startsWith('data:image/webp') ? webp : cv.toDataURL('image/jpeg', 0.86);
}

const KINDS: { id: Backdrop['kind']; label: string }[] = [
  { id: 'base', label: t('Temelin') }, { id: 'solid', label: t('Düz') }, { id: 'gradient', label: t('Geçiş') }, { id: 'mesh', label: t('Bulut') }, { id: 'image', label: t('Resim') },
];
const PATTERNS: { id: PatternKind; label: string }[] = [
  { id: 'none', label: t('Yok') }, { id: 'grid', label: t('Izgara') }, { id: 'dots', label: t('Nokta') }, { id: 'lines', label: t('Çizgi') }, { id: 'diagonal', label: t('Çapraz') }, { id: 'noise', label: t('Kumlu') },
];

function BackdropTab({ d, part, swatches }: Ctx) {
  const { notify } = useStore();
  const b: Backdrop = d.backdrop ?? { kind: 'base' };
  const file = useRef<HTMLInputElement>(null);
  const cols = b.colors ?? [];
  const want = b.kind === 'solid' ? 1 : b.kind === 'gradient' ? 2 : b.kind === 'mesh' ? 3 : 0;
  const setKind = (kind: Backdrop['kind']) => {
    const a = d.colors.accent ?? '#7aa2d6';
    const g = d.colors.ground ?? '#141414';
    const seed = kind === 'solid' ? [g] : kind === 'gradient' ? [g, withAlpha(a, 0.35)] : kind === 'mesh' ? [withAlpha(a, 0.35), withAlpha(d.colors.positive ?? '#8cc5a0', 0.25), withAlpha(d.colors.negative ?? '#e19a92', 0.2)] : cols;
    part('backdrop', { kind, colors: cols.length >= (kind === 'solid' ? 1 : kind === 'gradient' ? 2 : kind === 'mesh' ? 1 : 0) && b.kind !== 'base' && b.kind !== 'image' ? cols : seed });
  };
  const setCol = (i: number, v: string) => part('backdrop', { colors: cols.map((c, k) => (k === i ? v : c)) });
  const pickImage = async (f: File) => {
    if (f.size > 25 * 1024 * 1024) { notify(t('Resim 25 MB’tan küçük olmalı')); return; }
    try { part('backdrop', { kind: 'image', image: await shrinkImage(f), dim: b.dim ?? 30 }); } catch { notify(t('Resim açılamadı')); }
  };
  return (
    <>
      <Group title={t('Arka plan')} onReset={() => part('backdrop', null)}>
        <Seg value={b.kind} options={KINDS} onChange={setKind} />
        {want > 0 && (
          <div className="sd-colors">
            {cols.map((c, i) => (
              <ColorField key={i} label={t('{0}. renk', i + 1)} value={c} onChange={(v) => setCol(i, v)} swatches={swatches}
                note={cols.length > want ? <button className="sd-mini" onClick={() => part('backdrop', { colors: cols.filter((_, k) => k !== i) })} aria-label={t('Rengi kaldır')}><Trash2 size={12} strokeWidth={1.8} /></button> : null} />
            ))}
            {b.kind !== 'solid' && cols.length < 5 && (
              <button className="sd-add" onClick={() => part('backdrop', { colors: [...cols, d.colors.accent ?? '#7aa2d6'] })}><Plus size={14} strokeWidth={1.8} /> {t('Renk ekle')}</button>
            )}
          </div>
        )}
        {b.kind === 'gradient' && <Slider label={t('Açı')} value={b.angle ?? 160} min={0} max={360} unit="°" onChange={(v) => part('backdrop', { angle: v })} />}
        {b.kind === 'image' && (
          <>
            <button className="sd-drop" onClick={() => file.current?.click()} style={b.image ? { backgroundImage: `url("${b.image}")` } : undefined}>
              <span><ImagePlus size={16} strokeWidth={1.8} /> {b.image ? t('Resmi değiştir') : t('Resim seç')}</span>
            </button>
            <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void pickImage(f); }} />
            <Seg label={t('Yerleşim')} value={b.fit ?? 'cover'} options={[{ id: 'cover', label: t('Doldur') }, { id: 'contain', label: t('Sığdır') }, { id: 'tile', label: t('Döşe') }]} onChange={(v) => part('backdrop', { fit: v })} />
            <Slider label={t('Karartma')} value={b.dim ?? 30} min={0} max={95} unit="%" onChange={(v) => part('backdrop', { dim: v })} />
            <Slider label={t('Bulanıklık')} value={b.blur ?? 0} min={0} max={40} unit="px" onChange={(v) => part('backdrop', { blur: v })} />
          </>
        )}
      </Group>
      <Group title={t('Desen')} onReset={() => part('backdrop', { pattern: 'none' })}>
        <Seg value={b.pattern ?? 'none'} options={PATTERNS} onChange={(v) => part('backdrop', { pattern: v })} />
        {(b.pattern ?? 'none') !== 'none' && (
          <>
            <ColorField label={t('Desen rengi')} value={b.patternColor} fallback="var(--text)" onChange={(v) => part('backdrop', { patternColor: v })} onClear={() => part('backdrop', { patternColor: undefined })} swatches={swatches} />
            <Slider label={t('Sıklık')} value={b.patternSize ?? 40} min={6} max={120} unit="px" onChange={(v) => part('backdrop', { patternSize: v })} />
            <Slider label={t('Belirginlik')} value={b.patternOpacity ?? 8} min={1} max={60} unit="%" onChange={(v) => part('backdrop', { patternOpacity: v })} />
          </>
        )}
      </Group>
    </>
  );
}

// ---------------------------------------------------------------- touches

function TouchesTab({ d, part, swatches }: Ctx) {
  const to: Touches = d.touches ?? {};
  const set = (p: Partial<Touches>) => part('touches', p);
  return (
    <>
      <Group title={t('Butonlar')} onReset={() => set({ button: 'base' })}>
        <Seg value={to.button ?? 'base'} onChange={(v) => set({ button: v })} options={[
          { id: 'base', label: t('Temelin') }, { id: 'flat', label: t('Düz') }, { id: 'gradient', label: t('Geçişli') }, { id: 'glow', label: t('Parlayan') }, { id: 'soft', label: t('Yumuşak') }, { id: 'outline', label: t('Çerçeve') },
        ]} />
        <div className="sd-demo"><button className="btn btn-accent" tabIndex={-1}>{t('Oyna')}</button><button className="btn" tabIndex={-1}>{t('Düzenle')}</button></div>
      </Group>
      <Group title={t('Seçili menü öğesi')} onReset={() => set({ nav: 'base' })}>
        <Seg value={to.nav ?? 'base'} onChange={(v) => set({ nav: v })} options={[
          { id: 'base', label: t('Temelin') }, { id: 'fill', label: t('Dolgu') }, { id: 'bar', label: t('Çizgi') }, { id: 'glow', label: t('Işık') }, { id: 'outline', label: t('Çerçeve') }, { id: 'pill', label: t('Hap') },
        ]} />
      </Group>
      <Group title={t('Kapağın üstüne gelince')} onReset={() => set({ hover: 'base' })}>
        <Seg value={to.hover ?? 'base'} onChange={(v) => set({ hover: v })} options={[
          { id: 'base', label: t('Temelin') }, { id: 'lift', label: t('Kalksın') }, { id: 'zoom', label: t('Büyüsün') }, { id: 'ring', label: t('Halka') }, { id: 'glow', label: t('Parlasın') }, { id: 'none', label: t('Hiçbir şey') },
        ]} />
      </Group>
      <Group title={t('Sayfa başlıkları')} onReset={() => set({ heading: 'base' })}>
        <Seg value={to.heading ?? 'base'} onChange={(v) => set({ heading: v })} options={[
          { id: 'base', label: t('Temelin') }, { id: 'plain', label: t('Yazı rengi') }, { id: 'accent', label: t('Vurgu rengi') }, { id: 'gradient', label: t('Geçişli') },
        ]} />
      </Group>
      <Group title={t('Kaydırma çubuğu')} onReset={() => set({ scrollbar: 'base' })}>
        <Seg value={to.scrollbar ?? 'base'} onChange={(v) => set({ scrollbar: v })} options={[
          { id: 'base', label: t('Temelin') }, { id: 'thin', label: t('İnce') }, { id: 'accent', label: t('Vurgulu') }, { id: 'hidden', label: t('Gizli') },
        ]} />
      </Group>
      <Group title={t('Geçişlerin ikinci rengi')}>
        <ColorField label={t('İkinci renk')} value={to.second} fallback="color-mix(in srgb, var(--accent) 55%, var(--text))" onChange={(v) => set({ second: v })} onClear={() => set({ second: undefined })} swatches={swatches} />
      </Group>
    </>
  );
}

// ---------------------------------------------------------------- parts

const SHADOW_OPTS = [
  { id: '', label: t('—') }, { id: 'none', label: t('Yok') }, { id: 'soft', label: t('Yumuşak') }, { id: 'deep', label: t('Derin') }, { id: 'glow', label: t('Işık') }, { id: 'flat', label: t('Blok') },
];
const FILTER_OPTS = [
  { id: '', label: t('—') }, { id: 'grayscale(1)', label: t('Siyah beyaz') }, { id: 'saturate(1.6)', label: t('Canlı') }, { id: 'saturate(0.5)', label: t('Soluk') }, { id: 'sepia(0.6)', label: t('Sepya') }, { id: 'blur(2px)', label: t('Bulanık') },
];
const CASE_OPTS = [{ id: '', label: t('—') }, { id: 'uppercase', label: 'AA' }, { id: 'lowercase', label: 'aa' }, { id: 'capitalize', label: 'Aa' }];

function flash(sel: string, on: boolean) {
  try {
    document.querySelectorAll(sel).forEach((el) => {
      if (el.closest('.studio-dock')) return;
      el.classList.toggle('sd-flash', on);
    });
  } catch { /* not a valid selector */ }
}

function PartsTab({ d, change, swatches, dock }: Ctx) {
  const rules = d.rules ?? [];
  const [picking, setPicking] = useState(false);
  const [alts, setAlts] = useState<Record<number, string[]>>({});
  const [open, setOpen] = useState<number | null>(rules.length ? rules.length - 1 : null);
  const setRule = (i: number, f: (r: Rule) => Rule) => change((x) => ({ ...x, rules: (x.rules ?? []).map((r, k) => (k === i ? f(r) : r)) }));
  const start = async () => {
    setPicking(true);
    const el = await pick(dock.current);
    setPicking(false);
    if (!el) return;
    const c = candidates(el);
    if (!c.length) return;
    const found = rules.findIndex((r) => r.sel === c[0]);
    if (found >= 0) { setOpen(found); setAlts((a) => ({ ...a, [found]: c })); return; }
    const i = rules.length;
    change((x) => ({ ...x, rules: [...(x.rules ?? []), { sel: c[0], props: {} }] }));
    setAlts((a) => ({ ...a, [i]: c }));
    setOpen(i);
  };
  useEffect(() => () => document.querySelectorAll('.sd-flash').forEach((el) => el.classList.remove('sd-flash')), []);
  return (
    <>
      <button className={`sd-pick ${picking ? 'is-on' : ''}`} onClick={start} disabled={picking}>
        <SquareDashed size={18} strokeWidth={1.8} />
        <span>{picking ? t('Pencerede bir yere tıkla · Esc: vazgeç') : t('Öğe seç')}</span>
      </button>
      {rules.map((r, i) => (
        <section key={i} className={`sd-rule ${open === i ? 'is-open' : ''}`} onMouseEnter={() => flash(r.sel, true)} onMouseLeave={() => flash(r.sel, false)}>
          <div className="sd-rule-head">
            <button className="sd-rule-name" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
              <strong>{r.label || nameOf(r.sel)}</strong><code>{r.sel}</code>
            </button>
            <button className="sd-mini" onClick={() => { flash(r.sel, false); change((x) => ({ ...x, rules: (x.rules ?? []).filter((_, k) => k !== i) })); setOpen(null); }} aria-label={t('Kuralı sil')}><Trash2 size={12} strokeWidth={1.8} /></button>
          </div>
          {open === i && <RuleEdit r={r} alts={alts[i]} swatches={swatches} onChange={(f) => setRule(i, f)} />}
        </section>
      ))}
    </>
  );
}

function RuleEdit({ r, alts, swatches, onChange }: { r: Rule; alts?: string[]; swatches: string[]; onChange: (f: (r: Rule) => Rule) => void }) {
  const p = r.props;
  const set = (k: RuleProp, v: string | number | null) => onChange((x) => {
    const props = { ...x.props };
    if (v === null || v === '') delete props[k]; else props[k] = String(v);
    return { ...x, props };
  });
  const n = (k: RuleProp, d: number) => (p[k] != null ? Number(p[k]) : d);
  return (
    <div className="sd-rule-body">
      {alts && alts.length > 1 && (
        <div className="sd-alts">
          <span className="sd-seg-label">{t('Neye uygulansın')}</span>
          <div className="sd-actions">
            {alts.map((s) => <button key={s} className={`sd-chip ${r.sel === s ? 'is-on' : ''}`} onClick={() => onChange((x) => ({ ...x, sel: s }))} title={s}>{nameOf(s)}</button>)}
          </div>
        </div>
      )}
      <label className="sd-field"><span className="sd-seg-label">{t('Seçici')}</span>
        <input className="sd-input sd-mono" value={r.sel} spellCheck={false} onChange={(e) => { const v = cleanSel(e.target.value); onChange((x) => ({ ...x, sel: v })); }} />
      </label>
      <div className="sd-colors">
        <ColorField label={t('Zemin')} value={p.background} fallback="transparent" onChange={(v) => set('background', v)} onClear={() => set('background', null)} swatches={swatches} />
        <ColorField label={t('Yazı')} value={p.color} fallback="var(--text)" onChange={(v) => set('color', v)} onClear={() => set('color', null)} swatches={swatches} />
        <ColorField label={t('Kenar')} value={p['border-color']} fallback="var(--border)" onChange={(v) => set('border-color', v)} onClear={() => set('border-color', null)} swatches={swatches} />
      </div>
      <Slider label={t('Kenar kalınlığı')} value={n('border-width', 0)} min={0} max={8} step={0.5} unit="px" onChange={(v) => set('border-width', v)} />
      <Slider label={t('Köşe')} value={n('border-radius', 0)} min={0} max={48} unit="px" onChange={(v) => set('border-radius', v)} />
      <Slider label={t('Görünürlük')} value={n('opacity', 100)} min={0} max={100} unit="%" onChange={(v) => set('opacity', v)} />
      <Slider label={t('Yazı boyutu')} value={n('font-size', 100)} min={50} max={250} unit="%" onChange={(v) => set('font-size', v)} />
      <Slider label={t('Yazı kalınlığı')} value={n('font-weight', 400)} min={100} max={900} step={100} onChange={(v) => set('font-weight', v)} />
      <Slider label={t('Harf aralığı')} value={n('letter-spacing', 0)} min={-100} max={300} onChange={(v) => set('letter-spacing', v)} />
      <Slider label={t('Arkasını bulanıklaştır')} value={n('backdrop-filter', 0)} min={0} max={40} unit="px" onChange={(v) => set('backdrop-filter', v || null)} />
      <Seg label={t('Gölge')} value={p['box-shadow'] ?? ''} options={SHADOW_OPTS} onChange={(v) => set('box-shadow', v)} />
      <Seg label={t('Filtre')} value={p.filter ?? ''} options={FILTER_OPTS} onChange={(v) => set('filter', v)} />
      <Seg label={t('Harfler')} value={p['text-transform'] ?? ''} options={CASE_OPTS} onChange={(v) => set('text-transform', v)} />
      <Flip label={t('Gizle')} on={p.display === 'none'} onChange={(v) => set('display', v ? 'none' : null)} />
      <button className="sd-chip" onClick={() => onChange((x) => ({ ...x, props: {} }))}><RotateCcw size={13} strokeWidth={1.8} /> {t('Bu öğeyi sıfırla')}</button>
    </div>
  );
}

// ---------------------------------------------------------------- css

const VARS = ['--ground', '--surface', '--raised', '--active', '--border', '--text', '--muted', '--faint', '--accent', '--accent-ink', '--accent-wash', '--positive', '--negative', '--radius-card', '--radius-sheet', '--radius-cover', '--radius-control', '--font', '--font-heading', '--sidebar'];
const SELECTORS = ['.sidebar', '.sheet', '.nav-item', '.nav-item.is-active', '.tile-cover', '.tile-title', 'h1', '.btn', '.btn-accent', '.panel', '.chip', '.modal'];

function CssTab({ d, change }: Ctx) {
  const area = useRef<HTMLTextAreaElement>(null);
  const insert = (text: string, back = 0) => {
    const el = area.current;
    const v = d.css ?? '';
    const at = el?.selectionStart ?? v.length;
    const end = el?.selectionEnd ?? at;
    const next = v.slice(0, at) + text + v.slice(end);
    change((x) => ({ ...x, css: next || null }));
    requestAnimationFrame(() => { if (el) { el.focus(); el.selectionStart = el.selectionEnd = at + text.length - back; } });
  };
  return (
    <>
      <textarea ref={area} className="sd-css" spellCheck={false} value={d.css ?? ''} aria-label={t('CSS')}
        placeholder={'.sidebar {\n  background: var(--raised);\n}'}
        onChange={(e) => { const v = e.target.value; change((x) => ({ ...x, css: v || null })); }}
        onKeyDown={(e) => { if (e.key === 'Tab') { e.preventDefault(); insert('  '); } }} />
      <Group title={t('Değişkenler')}>
        <div className="sd-actions sd-codes">{VARS.map((v) => <button key={v} className="sd-chip" onClick={() => insert(`var(${v})`)}><code>{v}</code></button>)}</div>
      </Group>
      <Group title={t('Seçiciler')}>
        <div className="sd-actions sd-codes">{SELECTORS.map((s) => <button key={s} className="sd-chip" onClick={() => insert(`${s} {\n  \n}\n`, 4)} title={nameOf(s)}><code>{s}</code></button>)}</div>
      </Group>
    </>
  );
}
