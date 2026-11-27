import { useMemo } from 'react';
import { useStore } from '../store';
import { PLATFORMS, STATUSES, totalMinutes, type PlatformId } from '../data/library';
import { WeekBars } from './WeekBars';
import { duration, int } from '../lib/format';
import { Cover } from './bits';
import { CalendarRange, Share2 } from 'lucide-react';
import { openShare } from './Share';
import { yearsWithPlay } from './YearView';

import { t, locale } from '../lib/i18n';
export function StatsView() {
  const { games, go } = useStore();

  const s = useMemo(() => {
    const allSessions = games.flatMap((g) => g.sessions);
    const tracked = allSessions.reduce((a, x) => a + x.minutes, 0);
    const total = games.reduce((a, g) => a + totalMinutes(g), 0);
    const finished = games.filter((g) => g.status === 'completed' || g.status === 'hundred').length;
    const achOpen = games.reduce((a, g) => a + (g.achievements?.unlocked ?? 0), 0);
    const achTotal = games.reduce((a, g) => a + (g.achievements?.total ?? 0), 0);

    const byPlatform = (Object.keys(PLATFORMS) as PlatformId[])
      .map((p) => ({ p, m: games.filter((g) => g.platform === p).reduce((a, g) => a + g.sessions.reduce((b, x) => b + x.minutes, 0), 0) }))
      .filter((x) => x.m > 0)
      .sort((a, b) => b.m - a.m);

    const topTracked = games
      .map((g) => ({ g, m: g.sessions.reduce((a, x) => a + x.minutes, 0) }))
      .filter((x) => x.m > 0)
      .sort((a, b) => b.m - a.m)
      .slice(0, 6);

    const byHour = new Array(24).fill(0);
    for (const x of allSessions) byHour[new Date(x.start).getHours()] += x.minutes;
    const peakHour = byHour.indexOf(Math.max(...byHour));

    const backlog = games.filter((g) => g.status === 'backlog');
    const backlogHours = backlog.reduce((a, g) => a + (g.hltb ?? 0), 0);
    const first = allSessions.reduce((a, x) => Math.min(a, new Date(x.start).getTime()), Infinity);
    const weeks = Number.isFinite(first) ? Math.max(1, (Date.now() - first) / (7 * 86400000)) : 1;
    const perWeek = tracked / 60 / weeks;

    return { allSessions, tracked, total, finished, achOpen, achTotal, byPlatform, topTracked, byHour, peakHour, backlog, backlogHours, perWeek };
  }, [games]);

  const years = yearsWithPlay(games);
  const maxP = s.byPlatform[0]?.m ?? 1;
  const maxT = s.topTracked[0]?.m ?? 1;
  const maxH = Math.max(...s.byHour, 1);

  return (
    <div className="page">
      <header className="title-row">
        <div>
          <h1>{t('İstatistikler')}</h1>
        </div>
        <div className="year-links">
          {years.slice(0, 3).map((y) => (
            <button key={y} className="btn btn-sm" onClick={() => go({ name: 'year', year: y })}><CalendarRange size={14} strokeWidth={1.8} /> {y} {t('özeti')}</button>
          ))}
          <button className="btn btn-sm btn-accent" onClick={() => openShare({ scope: years.length ? 'month' : 'genre' })}><Share2 size={14} strokeWidth={1.8} /> {t('Özet kartı')}</button>
        </div>
      </header>

      {s.perWeek > 0 ? (
        <p className="finding">
          {t('Haftada ortalama')} <strong>{s.perWeek.toLocaleString(locale, { maximumFractionDigits: 1 })} {t('saat')}</strong> {t('oynuyorsun, en çok')} {s.peakHour}{t(':00 civarı.')}
          {s.backlogHours > 0 && <> {t('Bu hızla sıradaki')} {s.backlog.length} {t('oyunu bitirmen yaklaşık')} <strong>{Math.ceil(s.backlogHours / s.perWeek)} {t('hafta')}</strong> {t('sürer.')}</>}
        </p>
      ) : (
        null
      )}

      <section className="kpis" aria-label={t('Özet')}>
        <div><span className="kpi-label">{t('Toplam oynama')}</span><span className="kpi-value num">{int(Math.round(s.total / 60))} {t('sa')}</span></div>
        <div><span className="kpi-label">{t('Tessera’nın saydığı')}</span><span className="kpi-value num">{int(Math.round(s.tracked / 60))} {t('sa')}</span><span className="kpi-sub">{s.allSessions.length} {t('oturum')}</span></div>
        <div><span className="kpi-label">{t('Oyun')}</span><span className="kpi-value num">{games.length}</span><span className="kpi-sub">{games.filter((g) => totalMinutes(g) === 0).length} {t('tanesi hiç açılmadı')}</span></div>
        <div><span className="kpi-label">{t('Bitirilen')}</span><span className="kpi-value num">{s.finished}</span></div>
        <div><span className="kpi-label">{t('Başarım')}</span><span className="kpi-value num">{int(s.achOpen)}<span className="kpi-of"> / {int(s.achTotal)}</span></span></div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">{t('Haftalık oynama')}</h2>
          <span className="muted">{t('Son 52 hafta')}</span>
        </div>
        <WeekBars sessions={s.allSessions} weeks={52} height={150} label={t('Son 52 haftanın oynama süresi')} empty={t('Oyunları Tessera’dan açtıkça dolacak')} />
      </section>

      <div className="split split-3">
        <section className="panel">
          <h2 className="panel-title">{t('En çok oynadıkların')}</h2>
          <p className="muted panel-sub">{t('Tessera’nın saydığı süre')}</p>
          <ul className="bar-list">
            {s.topTracked.map(({ g, m }) => (
              <li key={g.id}>
                <button className="bar-row" onClick={() => go({ name: 'game', id: g.id })}>
                  <span className="bar-thumb"><Cover game={g} /></span>
                  <span className="bar-body">
                    <span className="bar-top"><span className="bar-name">{g.title}</span><span className="num">{duration(m, { compact: true })}</span></span>
                    <span className="bar"><span style={{ width: `${(m / maxT) * 100}%` }} /></span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel">
          <h2 className="panel-title">{t('Platforma göre')}</h2>
          <p className="muted panel-sub">{t('Tessera’nın saydığı süre')}</p>
          <ul className="bar-list">
            {s.byPlatform.map(({ p, m }) => (
              <li key={p}>
                <div className="bar-body">
                  <span className="bar-top"><span className="bar-name">{PLATFORMS[p].name}</span><span className="num">{duration(m, { compact: true })}</span></span>
                  <span className="bar bar-neutral"><span style={{ width: `${(m / maxP) * 100}%` }} /></span>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel">
          <h2 className="panel-title">{t('Günün saati')}</h2>
          <p className="muted panel-sub">{t('Oturumların başladığı saat')}</p>
          <svg className="hours" viewBox="0 0 240 110" role="img" aria-label={t('Saatlere göre oynama dağılımı')}>
            {s.byHour.map((m, h) => {
              const hh = (m / maxH) * 84;
              return (
                <rect key={h} x={h * 10 + 1} y={90 - hh} width={8} height={Math.max(hh, 1)} rx={2} className={h === s.peakHour ? 'hours-peak' : 'hours-bar'}>
                  <title>{`${h}:00: ${duration(m, { compact: true })}`}</title>
                </rect>
              );
            })}
            {[0, 6, 12, 18].map((h) => <text key={h} x={h * 10 + 1} y={106} className="hm-axis">{String(h).padStart(2, '0')}</text>)}
          </svg>
          <dl className="facts">
            {STATUSES.map((st) => {
              const n = games.filter((g) => g.status === st.id).length;
              return <div key={st.id}><dt>{st.label}</dt><dd className="num">{n}</dd></div>;
            })}
          </dl>
        </section>
      </div>
    </div>
  );
}
