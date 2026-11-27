// A year of play, from the sessions Tessera counted.
import { useMemo } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Share2 } from 'lucide-react';
import { openShare } from './Share';
import { useStore } from '../store';
import type { Game } from '../data/library';
import { duration, int, monthLong, monthShort, shortDate, pct } from '../lib/format';
import { Cover } from './bits';

import { t as tr } from '../lib/i18n';
const DAYS = [tr('Pazar'), tr('Pazartesi'), tr('Salı'), tr('Çarşamba'), tr('Perşembe'), tr('Cuma'), tr('Cumartesi')];
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

export function yearsWithPlay(games: Game[]): number[] {
  const ys = new Set<number>();
  for (const g of games) for (const s of g.sessions) ys.add(new Date(s.start).getFullYear());
  return [...ys].sort((a, b) => b - a);
}

export function YearView({ year }: { year: number }) {
  const { games, go, back } = useStore();
  const years = useMemo(() => yearsWithPlay(games), [games]);

  const y = useMemo(() => {
    const perGame = new Map<string, { g: Game; m: number; n: number; first: Date }>();
    const months = new Array(12).fill(0);
    const weekdays = new Array(7).fill(0);
    const hours = new Array(24).fill(0);
    const days = new Set<string>();
    const returning = new Set<string>();
    let total = 0, count = 0;
    let longest: { g: Game; m: number; at: Date } | null = null;

    for (const g of games) {
      // was this game played before this year? then it is not "new to you"
      let earlier = false;
      for (const s of g.sessions) {
        const at = new Date(s.start);
        if (at.getFullYear() < year) earlier = true;
        if (at.getFullYear() !== year) continue;
        total += s.minutes; count++;
        months[at.getMonth()] += s.minutes;
        weekdays[at.getDay()] += s.minutes;
        hours[at.getHours()] += s.minutes;
        days.add(dayKey(at));
        const row = perGame.get(g.id) ?? { g, m: 0, n: 0, first: at };
        row.m += s.minutes; row.n++;
        if (at < row.first) row.first = at;
        perGame.set(g.id, row);
        if (!longest || s.minutes > longest.m) longest = { g, m: s.minutes, at };
      }
      if (earlier) returning.add(g.id);
    }

    const top = [...perGame.values()].sort((a, b) => b.m - a.m);
    const fresh = top.filter((r) => !returning.has(r.g.id)).length;

    // longest run of days in a row
    let streak = 0;
    const sorted = [...days].map((k) => { const [a, b, c] = k.split('-').map(Number); return new Date(a, b, c).getTime(); }).sort((a, b) => a - b);
    let run = 0, prev = 0;
    for (const t of sorted) { run = prev && Math.round((t - prev) / 86400000) === 1 ? run + 1 : 1; streak = Math.max(streak, run); prev = t; }

    const busiest = months.indexOf(Math.max(...months));
    const weekday = weekdays.indexOf(Math.max(...weekdays));
    const hour = hours.indexOf(Math.max(...hours));
    const added = games.filter((g) => new Date(g.addedAt).getFullYear() === year).length;
    const finished = games
      .filter((g) => g.finishedAt && new Date(g.finishedAt).getFullYear() === year)
      .sort((a, b) => new Date(a.finishedAt!).getTime() - new Date(b.finishedAt!).getTime());
    return { total, count, days: days.size, top, fresh, months, busiest, weekday, hour, longest, streak, added, finished };
  }, [games, year]);

  const idx = years.indexOf(year);
  const older = idx >= 0 ? years[idx + 1] : years.find((x) => x < year);
  const newer = idx > 0 ? years[idx - 1] : [...years].reverse().find((x) => x > year);
  const lead = y.top[0];
  const maxM = Math.max(...y.months, 1);
  const art = lead?.g.hero ?? lead?.g.header ?? lead?.g.cover ?? null;

  return (
    <div className="page year">
      <header className="title-row">
        <button className="btn btn-ghost btn-sm" onClick={back}><ArrowLeft size={15} strokeWidth={1.8} /> {tr('İstatistikler')}</button>
        <div className="year-nav">
          {y.count > 0 && <button className="btn btn-sm btn-accent" onClick={() => openShare({ scope: 'year', year })}><Share2 size={14} strokeWidth={1.8} /> {tr('Paylaş')}</button>}
          <button className="icon-btn" aria-label={tr('Önceki yıl')} disabled={!older} onClick={() => older && go({ name: 'year', year: older })}><ChevronLeft size={18} strokeWidth={1.8} /></button>
          <button className="icon-btn" aria-label={tr('Sonraki yıl')} disabled={!newer} onClick={() => newer && go({ name: 'year', year: newer })}><ChevronRight size={18} strokeWidth={1.8} /></button>
        </div>
      </header>

      <section className="year-hero">
        {art && <img className="year-hero-art" src={art} alt="" aria-hidden="true" />}
        <div className="year-hero-text">
          <span className="year-num num">{year}</span>
          {y.count > 0 ? (
            <p className="year-lede">
              <strong className="num">{int(Math.round(y.total / 60))} {tr('saat')}</strong>, {int(y.count)} {tr('oturum,')} {y.days} {tr('farklı gün.')}
              {lead && <> {tr('En çok')} <strong>{lead.g.title}</strong>.</>}
              {y.finished.length > 0 && <> <strong className="num">{y.finished.length}</strong> {tr('oyun bitirdin.')}</>}
            </p>
          ) : (
            <p className="year-lede">{tr('Bu yıl için kayıtlı oturum yok. Oyunları Tessera’dan açtıkça burası dolar.')}</p>
          )}
        </div>
      </section>

      {y.finished.length > 0 && (
        <section className="year-done" aria-label={tr('Bu yıl bitirdiklerin')}>
          <h2 className="section-title">{tr('Bitirdiklerin')} <span className="muted">· {y.finished.length}</span></h2>
          <div className="year-done-row">
            {y.finished.map((g, i) => (
              <button key={g.id} className="year-done-item" onClick={() => go({ name: 'game', id: g.id })} title={g.title} style={{ '--i': i } as React.CSSProperties}>
                <span className="year-done-cover"><Cover game={g} /></span>
                <span className="year-done-title">{g.title}</span>
                <span className="muted small">{monthLong(new Date(g.finishedAt!).getMonth())}{g.status === 'hundred' ? ` · ${pct(100)}` : ''}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {y.count > 0 && (
        <>
          <section className="year-podium" aria-label={tr('En çok oynadıkların')}>
            {y.top.slice(0, 5).map((r, i) => (
              <button key={r.g.id} className={`year-pick ${i === 0 ? 'is-first' : ''}`} onClick={() => go({ name: 'game', id: r.g.id })} style={{ '--i': i } as React.CSSProperties}>
                <span className="year-cover"><Cover game={r.g} /></span>
                <span className="year-rank num">{i + 1}</span>
                <span className="year-pick-title">{r.g.title}</span>
                <span className="muted small num">{duration(r.m, { compact: r.m >= 600 })} · {pct(Math.round((r.m / y.total) * 100))}</span>
              </button>
            ))}
          </section>

          <div className="split year-split">
            <section className="panel">
              <div className="panel-head">
                <h2 className="panel-title">{tr('Aylar')}</h2>
                <span className="muted small">{tr('En yoğun:')} {monthLong(y.busiest)}</span>
              </div>
              <div className="year-months" role="img" aria-label={tr('Aylara göre oynama süresi')}>
                {y.months.map((m, i) => (
                  <div key={i} className={`year-month ${i === y.busiest ? 'is-peak' : ''}`} title={`${monthLong(i)}: ${duration(m)}`}>
                    <span className="year-month-bar"><span style={{ height: `${(m / maxM) * 100}%` }} /></span>
                    <span className="year-month-label">{monthShort(i)}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="panel">
              <h2 className="panel-title">{tr('Öne çıkanlar')}</h2>
              <dl className="facts year-facts">
                {y.longest && <div><dt>{tr('En uzun oturum')}</dt><dd>{duration(y.longest.m)} <span className="muted">· {y.longest.g.title}, {shortDate(y.longest.at)}</span></dd></div>}
                {y.streak > 1 && <div><dt>{tr('Üst üste')}</dt><dd>{y.streak} {tr('gün')}</dd></div>}
                <div><dt>{tr('En çok oynadığın gün')}</dt><dd>{DAYS[y.weekday]}</dd></div>
                <div><dt>{tr('En çok oynadığın saat')}</dt><dd className="num">{String(y.hour).padStart(2, '0')}:00</dd></div>
                <div><dt>{tr('Oynadığın oyun')}</dt><dd className="num">{y.top.length}{y.fresh > 0 && y.fresh < y.top.length && <span className="muted"> · {y.fresh} {tr('tanesi ilk kez')}</span>}</dd></div>
                {y.added > 0 && <div><dt>{tr('Kütüphaneye eklenen')}</dt><dd className="num">{y.added}</dd></div>}
              </dl>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
