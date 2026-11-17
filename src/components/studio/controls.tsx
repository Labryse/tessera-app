// The small controls of the theme studio, shared by its tabs.
import type { CSSProperties, ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import type { CustomTheme } from '../../lib/customThemes';
import { t } from '../../lib/i18n';

export interface Ctx {
  d: CustomTheme;
  change: (f: (d: CustomTheme) => CustomTheme) => void;
  part: <K extends 'radii' | 'type' | 'surface' | 'backdrop' | 'touches' | 'layout'>(k: K, patch: Partial<NonNullable<CustomTheme[K]>> | null) => void;
  swatches: string[];
  dock: React.RefObject<HTMLDivElement | null>;
}

export function Group({ title, onReset, children, extra }: { title: string; onReset?: () => void; children: ReactNode; extra?: ReactNode }) {
  return (
    <section className="sd-group">
      <div className="sd-group-head">
        <span className="sd-group-title">{title}</span>
        {extra}
        {onReset && <button className="sd-mini" onClick={onReset} title={t('Sıfırla')} aria-label={t('{0}: sıfırla', title)}><RotateCcw size={12} strokeWidth={2} /></button>}
      </div>
      {children}
    </section>
  );
}

export function Slider({ label, value, min, max, step = 1, unit = '', onChange }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="sd-slide">
      <span className="sd-slide-top"><span>{label}</span><span className="num">{Math.round(value * 100) / 100}{unit}</span></span>
      <input type="range" className="sd-range" min={min} max={max} step={step} value={value} style={{ '--v': `${pct}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export function Seg<T extends string>({ label, value, options, onChange }: { label?: string; value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="sd-seg-wrap">
      {label && <span className="sd-seg-label">{label}</span>}
      <div className="sd-seg" role="radiogroup" aria-label={label}>
        {options.map((o) => <button key={o.id} role="radio" aria-checked={value === o.id} className={value === o.id ? 'is-on' : ''} onClick={() => onChange(o.id)}>{o.label}</button>)}
      </div>
    </div>
  );
}

export function Flip({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button className="sd-flip" role="switch" aria-checked={on} onClick={() => onChange(!on)}>
      <span>{label}</span><span className={`sd-switch ${on ? 'is-on' : ''}`}><i /></span>
    </button>
  );
}

