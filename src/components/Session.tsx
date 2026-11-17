// A game that is running shows its clock, and a hairline under it that fills
// toward how long the user usually plays that game. No badge, no blinking dot.
import type { Game } from '../data/library';
import { duration } from '../lib/format';
import { useNow } from './bits';

import { t } from '../lib/i18n';
/** the user's usual session for this game in minutes (median of the recent ones), or null with too little history */
export function typicalMinutes(g: Game | undefined | null): number | null {
  if (!g) return null;
  const recent = [...g.sessions]
    .filter((s) => s.minutes >= 5)
    .sort((a, b) => (a.start < b.start ? 1 : -1))
    .slice(0, 20)
    .map((s) => s.minutes)
    .sort((a, b) => a - b);
  if (recent.length < 3) return null;
  const mid = recent.length >> 1;
  return Math.round(recent.length % 2 ? recent[mid] : (recent[mid - 1] + recent[mid]) / 2);
}

/** seconds since `since` (unix seconds) */
export const elapsed = (since: number, now: number) => Math.max(0, Math.floor(now / 1000 - since));

/** 12:04 under an hour, 1:12:04 after */
export function clock(secs: number) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/** "genelde 1 sa 30 dk" */
export const usually = (min: number) => `genelde ${duration(min)}`;

/** the hairline: how far into the usual session this one is */
export function SessionBar({ secs, typical, className = '' }: { secs: number; typical: number; className?: string }) {
  const pct = Math.min(100, (secs / 60 / typical) * 100);
  return (
    <span className={`sess-bar ${pct >= 100 ? 'is-past' : ''} ${className}`} role="presentation">
      <span style={{ width: `${pct}%` }} />
    </span>
  );
}

/** on a cover: the hairline along the bottom edge, or the minutes when there is no usual session yet */
export function TileSession({ g, since }: { g: Game; since: number }) {
  const now = useNow(15000);
  const secs = elapsed(since, now);
  const typical = typicalMinutes(g);
  const label = t('Açık · {0}{1}', duration(Math.max(1, Math.floor(secs / 60))), typical ? ` · ${usually(typical)}` : '');
  return typical
    ? <span className="tile-sess" title={label} aria-label={label}><SessionBar secs={secs} typical={typical} /></span>
    : <span className="tile-clock num" title={label} aria-label={label}>{secs < 60 ? t('yeni') : duration(Math.floor(secs / 60))}</span>;
}

/** in place of the Play button while the game runs: the clock, the usual length, the hairline */
export function LiveButton({ g, since }: { g: Game; since: number }) {
  const now = useNow(1000);
  const secs = elapsed(since, now);
  const typical = typicalMinutes(g);
  return (
    <span className="btn btn-lg btn-live" role="timer" aria-label={t('Açık, {0}', duration(Math.max(1, Math.floor(secs / 60))))}>
      <span className="live-clock num">{clock(secs)}</span>
      <span className="live-note">{typical ? usually(typical) : t('bu oturum')}</span>
      {typical ? <SessionBar secs={secs} typical={typical} className="live-bar" /> : null}
    </span>
  );
}
