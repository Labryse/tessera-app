import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { Game, Status } from '../data/library';
import { PLATFORMS, STATUSES, isSystem } from '../data/library';

import { t as tr } from '../lib/i18n';
/** the current time, refreshed every `ms` (for live timers) */
export function useNow(ms = 30000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** eases a number up to its target when it first shows or changes */
export function useCountUp(target: number, ms = 700) {
  const [v, setV] = useState(reduced() ? target : 0);
  const from = useRef(0);
  useEffect(() => {
    if (reduced()) { setV(target); return; }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      setV(a + (target - a) * e);
      if (p < 1) raf = requestAnimationFrame(step);
      else from.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

/** status as a button with a menu: dot, label, one-line meaning */
export function StatusPicker({ value, onChange }: { value: Status; onChange: (s: Status) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc); };
  }, [open]);
  const cur = STATUSES.find((s) => s.id === value)!;
  return (
    <div className="status-picker" ref={ref}>
      <button className="status-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className={`status status-${value}`}>{cur.label}</span>
        <ChevronDown size={16} strokeWidth={1.7} className={`chev ${open ? 'is-open' : ''}`} />
      </button>
      {open && (
        <ul className="status-menu" role="listbox" aria-label={tr('Durum')}>
          {STATUSES.map((s) => (
            <li key={s.id}>
              <button role="option" aria-selected={s.id === value} className={`status-option ${s.id === value ? 'is-on' : ''}`}
                onClick={() => { onChange(s.id); setOpen(false); }}>
                <span className={`status status-${s.id}`}>{s.label}</span>
                {s.id === value && <Check size={15} strokeWidth={1.8} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Tessera mark: four tiles of a mosaic, one set in the accent */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="2" width="9" height="9" rx="2.4" fill="currentColor" opacity="0.92" />
      <rect x="13" y="2" width="9" height="9" rx="2.4" fill="var(--accent)" />
      <rect x="2" y="13" width="9" height="9" rx="2.4" fill="currentColor" opacity="0.55" />
      <rect x="13" y="13" width="9" height="9" rx="2.4" fill="currentColor" opacity="0.28" />
    </svg>
  );
}

/** cover art, or a typeset cover when no art was found */
export function Cover({ game, className = '', style }: { game: Game; className?: string; style?: CSSProperties }) {
  const [failed, setFailed] = useState(false);
  const src = game.cover;
  if (src && !failed) {
    return (
      <img
        className={`cover-img ${isSystem(game.platform) ? 'is-box' : ''} ${className}`}
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        style={style}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div className={`cover-fallback ${className}`} style={style}>
      {game.header && <img src={game.header} alt="" className="cover-fallback-art" loading="lazy" />}
      <div className="cover-fallback-text">
        <span className="cover-fallback-title">{game.title}</span>
        <span className="cover-fallback-meta">{game.developer}</span>
      </div>
    </div>
  );
}

export function PlatformTag({ game }: { game: Game }) {
  return <span className="platform-tag">{PLATFORMS[game.platform].short}</span>;
}

/** 0–10 in half steps, drawn as ten segments; click to set */
export function RatingBar({ value, onChange, size = 'md', onHover }: { value: number | null; onChange?: (v: number | null) => void; size?: 'sm' | 'md' | 'lg'; onHover?: (v: number | null) => void }) {
  const [hover, setHoverState] = useState<number | null>(null);
  const setHover = (v: number | null) => { setHoverState(v); onHover?.(v); };
  const shown = hover ?? value ?? 0;
  return (
    <div
      className={`rating rating-${size}`}
      role={onChange ? 'slider' : 'img'}
      aria-label={`Puan ${value ?? tr('yok')} / 10`}
      aria-valuemin={0}
      aria-valuemax={10}
      aria-valuenow={value ?? 0}
      tabIndex={onChange ? 0 : -1}
      onKeyDown={(e) => {
        if (!onChange) return;
        if (e.key === 'ArrowRight') onChange(Math.min(10, (value ?? 0) + 0.5));
        if (e.key === 'ArrowLeft') onChange(Math.max(0, (value ?? 0) - 0.5));
      }}
      onMouseLeave={() => setHover(null)}
    >
      {Array.from({ length: 10 }, (_, i) => {
        const fill = Math.max(0, Math.min(1, shown - i));
        return (
          <span
            key={i}
            className="rating-seg"
            onMouseMove={onChange ? (e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setHover(i + (e.clientX - r.left < r.width / 2 ? 0.5 : 1));
            } : undefined}
            onClick={onChange ? () => onChange(hover === value ? null : hover) : undefined}
          >
            <span className="rating-fill" style={{ width: `${fill * 100}%` }} />
          </span>
        );
      })}
    </div>
  );
}

export function Progress({ value, total, label }: { value: number; total: number; label?: string }) {
  const pct = total ? (value / total) * 100 : 0;
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={value} aria-label={label}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}
