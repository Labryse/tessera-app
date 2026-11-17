// Weekly play rhythm: one soft capsule per week that fills from the bottom with
// the hours played. Reads at a glance, and the hovered week tells its numbers.
import { useMemo, useState, type CSSProperties } from 'react';
import type { Session } from '../data/library';
import { duration, monthShort } from '../lib/format';

import { t } from '../lib/i18n';
const DAY = 86400000;

function mondayOf(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

export function WeekBars({ sessions, weeks = 26, height = 112, label, empty = t('Henüz oturum yok') }: {
  sessions: Session[]; weeks?: number; height?: number; label: string; empty?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const data = useMemo(() => {
    const thisWeek = mondayOf(new Date());
    const first = new Date(thisWeek.getTime() - (weeks - 1) * 7 * DAY);
    const cols = Array.from({ length: weeks }, (_, i) => ({ start: new Date(first.getTime() + i * 7 * DAY), m: 0, n: 0 }));
    for (const s of sessions) {
      const i = Math.floor((mondayOf(new Date(s.start)).getTime() - first.getTime()) / (7 * DAY));
      if (i >= 0 && i < weeks) { cols[i].m += s.minutes; cols[i].n += 1; }
    }
    const max = Math.max(...cols.map((c) => c.m), 1);
    return { cols, max };
  }, [sessions, weeks]);

  const total = data.cols.reduce((a, c) => a + c.m, 0);
  const h = hover != null ? data.cols[hover] : null;

  return (
    <figure className="weeks" aria-label={label} onMouseLeave={() => setHover(null)}>
      <div className="weeks-plot" style={{ height }}>
        {data.cols.map((c, i) => (
          <span
            key={i}
            className={`weeks-col ${i === data.cols.length - 1 ? 'is-now' : ''} ${hover === i ? 'is-hover' : ''}`}
            onMouseEnter={() => setHover(i)}
          >
            <span className="weeks-fill" style={{ height: `${c.m ? Math.max(6, (c.m / data.max) * 100) : 0}%`, '--i': i } as CSSProperties} />
          </span>
        ))}
        {total === 0 && <span className="weeks-empty"><span className="weeks-empty-pill">{empty}</span></span>}
        {h && (
          <span className="weeks-tip" style={{ left: `${((hover! + 0.5) / data.cols.length) * 100}%` }}>
            <strong>{h.m ? duration(h.m) : t('Oynanmadı')}</strong>
            <span>{h.start.getDate()} {monthShort(h.start.getMonth())} {t('haftası')}{h.n ? t(' · {0} oturum', h.n) : ''}</span>
          </span>
        )}
      </div>
      <div className="weeks-axis" aria-hidden="true">
        {data.cols.map((c, i) => {
          const prev = data.cols[i - 1];
          const label = !prev || prev.start.getMonth() !== c.start.getMonth() ? monthShort(c.start.getMonth()) : '';
          return <span key={i}>{i === 0 && c.start.getDate() > 20 ? '' : label}</span>;
        })}
      </div>
    </figure>
  );
}
