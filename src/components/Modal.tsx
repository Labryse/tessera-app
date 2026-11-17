// One modal for the whole app: it arrives and leaves with a spring, and the room
// behind it breathes — a slow, soft field of colour (or a blurred cover) that
// swells and settles while the window is open.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { X } from 'lucide-react';

import { t as tr } from '../lib/i18n';
const EXIT_MS = 220;

/** keeps a closing modal mounted long enough to play its exit */
export function usePresence(open: boolean) {
  const [mounted, setMounted] = useState(open);
  const [leaving, setLeaving] = useState(false);
  const [prev, setPrev] = useState(open);
  if (prev !== open) {
    setPrev(open);
    if (open) { setMounted(true); setLeaving(false); } else if (mounted) { setLeaving(true); }
  }
  useEffect(() => {
    if (!leaving) return;
    const t = window.setTimeout(() => { setMounted(false); setLeaving(false); }, EXIT_MS);
    return () => window.clearTimeout(t);
  }, [leaving]);
  return { mounted, leaving };
}

interface Props {
  open: boolean;
  onClose?: () => void;
  label: string;
  title?: ReactNode;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  placement?: 'center' | 'top';
  /** an image to breathe behind the window (a game's cover); otherwise the theme accent */
  ambient?: string | null;
  className?: string;
  style?: CSSProperties;
  bare?: boolean;
}

export function Modal({ open, onClose, label, title, children, size = 'md', placement = 'center', ambient, className = '', style, bare }: Props) {
  const { mounted, leaving } = usePresence(open);
  const panel = useRef<HTMLDivElement>(null);
  const restore = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    restore.current = document.activeElement;
    const t = window.setTimeout(() => {
      const el = panel.current?.querySelector<HTMLElement>('[autofocus], input, button:not([data-close])');
      el?.focus();
    }, 30);
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && onClose) { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', esc);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', esc);
      (restore.current as HTMLElement | null)?.focus?.();
    };
  }, [open, onClose]);

  if (!mounted) return null;
  return (
    <div className={`modal-root is-${placement} ${leaving ? 'is-leaving' : ''}`} onMouseDown={onClose}>
      <div className="modal-backdrop" aria-hidden="true">
        {ambient
          ? <div className="modal-ambient-img" style={{ backgroundImage: `url("${ambient}")` }} />
          : <>
              <span className="modal-breath modal-breath-a" />
              <span className="modal-breath modal-breath-b" />
            </>}
      </div>
      <div
        ref={panel}
        className={`modal modal-${size} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        style={style}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {!bare && (title || onClose) && (
          <div className="modal-head">
            {title && <h2 className="modal-title">{title}</h2>}
            {onClose && (
              <button className="icon-btn modal-close" data-close aria-label={tr('Kapat')} onClick={onClose}>
                <X size={16} strokeWidth={1.7} />
              </button>
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
