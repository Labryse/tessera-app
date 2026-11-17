// A colour well for the theme studio: a square for saturation and brightness, hue and
// see-through sliders, the hex code, the theme's own colours and a dropper.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Pipette, RotateCcw } from 'lucide-react';
import { fromHsv, hex, parse, resolve, toHsv } from '../../lib/color';
import { t } from '../../lib/i18n';

interface Props {
  label: string;
  value: string | null | undefined;
  onChange: (v: string) => void;
  /** shown when empty: the colour it follows */
  fallback?: string;
  /** puts it back to following the others */
  onClear?: () => void;
  swatches?: string[];
  note?: React.ReactNode;
}

type Drop = { open: () => Promise<{ sRGBHex: string }> };
const hasDropper = typeof window !== 'undefined' && 'EyeDropper' in window;

export function ColorField({ label, value, onChange, fallback, onClear, swatches = [], note }: Props) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const open = anchor !== null;
  const shown = value ?? fallback ?? '#808080';
  return (
    <div className={`sd-color ${value ? '' : 'is-auto'}`}>
      <button className="sd-well" style={{ '--c': shown } as CSSProperties} onClick={(e) => { const el = e.currentTarget; setAnchor((a) => (a ? null : el)); }} aria-label={t('{0} rengini seç', label)} aria-expanded={open}>
        <span />
      </button>
      <span className="sd-color-text">
        <span className="sd-color-label">{label}</span>
        <span className="sd-color-code">{value ? value.toUpperCase() : t('Otomatik')}</span>
      </span>
      {note}
      {onClear && value && <button className="sd-mini" onClick={onClear} title={t('Otomatiğe döndür')} aria-label={t('Otomatiğe döndür')}><RotateCcw size={12} strokeWidth={2} /></button>}
      {open && <Popover anchor={anchor} value={shown} onChange={onChange} swatches={swatches} onClose={() => setAnchor(null)} />}
    </div>
  );
}

function Popover({ anchor, value, onChange, swatches, onClose }: { anchor: HTMLElement | null; value: string; onChange: (v: string) => void; swatches: string[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const start = resolve(value) ?? { r: 128, g: 128, b: 128, a: 1 };
  const [hsv, setHsv] = useState(() => ({ ...toHsv(start), a: start.a }));
  const [code, setCode] = useState(hex(start));
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const a = anchor.getBoundingClientRect();
    const r = ref.current.getBoundingClientRect();
    let left = a.left - r.width - 12;
    if (left < 8) left = Math.min(a.right + 12, window.innerWidth - r.width - 8);
    setPos({ left, top: Math.max(8, Math.min(a.top - 40, window.innerHeight - r.height - 8)) });
  }, [anchor]);
  useEffect(() => {
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node) && !anchor?.contains(e.target as Node)) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('mousedown', off);
    window.addEventListener('keydown', esc, true);
    return () => { window.removeEventListener('mousedown', off); window.removeEventListener('keydown', esc, true); };
  }, [anchor, onClose]);

  const emit = (n: typeof hsv) => {
    setHsv(n);
    const h = hex(fromHsv(n.h, n.s, n.v, n.a));
    setCode(h);
    onChange(h);
  };
  const take = (v: string) => {
    const c = parse(v);
    if (!c) return;
    const n = { ...toHsv(c), a: c.a };
    // keep the hue when the colour has none (greys)
    if (n.s === 0) n.h = hsv.h;
    setHsv(n); setCode(hex(c)); onChange(hex(c));
  };
  const drag = (el: HTMLElement, e: RPointerEvent, f: (x: number, y: number) => void) => {
    const box = el.getBoundingClientRect();
    const at = (ev: { clientX: number; clientY: number }) => f(
      Math.min(1, Math.max(0, (ev.clientX - box.left) / box.width)),
      Math.min(1, Math.max(0, (ev.clientY - box.top) / box.height)),
    );
    at(e);
    const move = (ev: PointerEvent) => at(ev);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const pure = hex(fromHsv(hsv.h, 1, 1));
  const solid = hex(fromHsv(hsv.h, hsv.s, hsv.v));

  return createPortal(
    <div ref={ref} className="sd-pop" style={pos ?? { visibility: 'hidden', left: 0, top: 0 }} role="dialog" aria-label={t('Renk seç')}>
      <div className="sd-sv" style={{ '--hue': pure } as CSSProperties}
        onPointerDown={(e) => drag(e.currentTarget, e, (x, y) => emit({ ...hsv, s: x, v: 1 - y }))}>
        <span className="sd-sv-dot" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: solid }} />
      </div>
      <div className="sd-slider sd-hue" onPointerDown={(e) => drag(e.currentTarget, e, (x) => emit({ ...hsv, h: x * 360 }))}>
        <span style={{ left: `${(hsv.h / 360) * 100}%`, background: pure }} />
      </div>
      <div className="sd-slider sd-alpha" style={{ '--solid': solid } as CSSProperties} onPointerDown={(e) => drag(e.currentTarget, e, (x) => emit({ ...hsv, a: Math.round(x * 100) / 100 }))}>
        <span style={{ left: `${hsv.a * 100}%` }} />
      </div>
      <div className="sd-pop-row">
        <input className="sd-input sd-code" value={code} spellCheck={false} maxLength={9} aria-label={t('Renk kodu')}
          onChange={(e) => { setCode(e.target.value); if (parse(e.target.value)) take(e.target.value); }} />
        <span className="sd-alpha-num num">{Math.round(hsv.a * 100)}%</span>
        {hasDropper && (
          <button className="sd-mini" title={t('Ekrandan al')} aria-label={t('Ekrandan al')}
            onClick={async () => { try { const r = await (new (window as unknown as { EyeDropper: new () => Drop }).EyeDropper()).open(); take(r.sRGBHex); } catch { /* closed */ } }}>
            <Pipette size={14} strokeWidth={1.8} />
          </button>
        )}
      </div>
      {swatches.length > 0 && (
        <div className="sd-swatches">
          {[...new Set(swatches.filter(Boolean))].slice(0, 18).map((s) => (
            <button key={s} style={{ '--c': s } as CSSProperties} onClick={() => take(s)} title={s} aria-label={s}><span /></button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}
