// What a summary card says: a year, a month, the genres, one genre or one game,
// worked out from the sessions Tessera counted (and, for genres and games, the
// play time the stores report). The card itself is drawn in components/Share.
import { PLATFORMS, statusLabel, totalMinutes, type Game } from '../data/library';
import { duration, int, monthLong, monthShort, pct, shortDate } from './format';
import { t as tr, locale } from './i18n';

export type Scope = 'year' | 'month' | 'genre' | 'game';

export interface CardGame { id: string; title: string; cover: string | null; value: string; share: number }
export interface CardBar { label: string; value: number; text: string; peak?: boolean }
export interface CardData {
  kicker: string;
  /** a game's own name, over the big number */
  title?: string;
  headline: string;
  sub: string;
  stats: { label: string; value: string }[];
  games: CardGame[];
  /** columns (months, days) or rows (genres) */
  bars: { kind: 'cols' | 'rows'; items: CardBar[] } | null;
  art: string | null;
  /** one big cover for a game card */
  cover?: string | null;
  /** the same in a sentence or two, for pasting */
  text: string;
  /** nothing to tell for this choice */
  empty: boolean;
}

const WEEKDAYS = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 7 + i).toLocaleDateString(locale, { weekday: 'long' }));
const cap = (s: string) => s.charAt(0).toLocaleUpperCase(locale) + s.slice(1);
const hoursText = (min: number) => (min < 60 ? duration(min) : tr('{0} saat', int(Math.round(min / 60))));
const artOf = (g: Game | undefined) => (g ? g.art?.hero ?? g.hero ?? g.header ?? g.art?.cover ?? g.cover : null);
const coverOf = (g: Game) => g.art?.cover ?? g.cover ?? g.header;
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** the play between two moments, game by game */
function playIn(games: Game[], from: Date, to: Date) {
  const per = new Map<string, { g: Game; m: number; n: number }>();
  const days = new Map<string, number>();
  const weekdays = new Array(7).fill(0);
  let total = 0, count = 0;
  let longest: { g: Game; m: number; at: Date } | null = null;
  const returning = new Set<string>();
  for (const g of games) {
    for (const s of g.sessions) {
      const at = new Date(s.start);
      if (at < from) { returning.add(g.id); continue; }
      if (at >= to) continue;
      total += s.minutes; count++;
      weekdays[at.getDay()] += s.minutes;
      days.set(dayKey(at), (days.get(dayKey(at)) ?? 0) + s.minutes);
      const row = per.get(g.id) ?? { g, m: 0, n: 0 };
      row.m += s.minutes; row.n++;
      per.set(g.id, row);
      if (!longest || s.minutes > longest.m) longest = { g, m: s.minutes, at };
    }
  }
  const top = [...per.values()].sort((a, b) => b.m - a.m);
  // the longest run of days in a row
  const stamps = [...days.keys()].map((k) => { const [a, b, c] = k.split('-').map(Number); return new Date(a, b, c).getTime(); }).sort((a, b) => a - b);
  let streak = 0, run = 0, prev = 0;
  for (const t of stamps) { run = prev && Math.round((t - prev) / 86400000) === 1 ? run + 1 : 1; streak = Math.max(streak, run); prev = t; }
  const fresh = top.filter((r) => !returning.has(r.g.id)).length;
  const weekday = total ? weekdays.indexOf(Math.max(...weekdays)) : -1;
  return { total, count, days, top, longest, streak, fresh, weekday };
}

const topGames = (top: { g: Game; m: number }[], total: number, n = 5): CardGame[] =>
  top.slice(0, n).map((r) => ({ id: r.g.id, title: r.g.title, cover: coverOf(r.g), value: duration(r.m, { compact: r.m >= 600 }), share: total ? r.m / total : 0 }));

const listLine = (games: CardGame[]) => games.slice(0, 3).map((x) => `${x.title} (${x.value})`).join(', ');

/** the years and months that have any play, newest first */
export function periods(games: Game[]) {
  const months = new Set<string>();
  for (const g of games) for (const s of g.sessions) { const d = new Date(s.start); months.add(`${d.getFullYear()}-${d.getMonth()}`); }
  const list = [...months].map((k) => k.split('-').map(Number) as [number, number]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const years = [...new Set(list.map((x) => x[0]))];
  return { years, months: list };
}

/** genres by the time spent in them, most played first */
export function genreTotals(games: Game[]) {
  const m = new Map<string, { name: string; min: number; games: Game[] }>();
  for (const g of games) {
    const min = totalMinutes(g);
    for (const name of new Set(g.genres)) {
      const row = m.get(name) ?? { name, min: 0, games: [] };
      row.min += min; row.games.push(g);
      m.set(name, row);
    }
  }
  return [...m.values()].sort((a, b) => b.min - a.min || b.games.length - a.games.length);
}

export function yearCard(games: Game[], year: number): CardData {
  const p = playIn(games, new Date(year, 0, 1), new Date(year + 1, 0, 1));
  const months = new Array(12).fill(0);
  for (const [k, m] of p.days) months[Number(k.split('-')[1])] += m;
  const peak = p.total ? months.indexOf(Math.max(...months)) : -1;
  const finished = games.filter((g) => g.finishedAt && new Date(g.finishedAt).getFullYear() === year);
  const list = topGames(p.top, p.total);
  const stats = [
    { label: tr('Oynanan oyun'), value: int(p.top.length) },
    { label: tr('Bitirilen'), value: int(finished.length) },
    p.fresh > 0 && p.fresh < p.top.length ? { label: tr('İlk kez oynanan'), value: int(p.fresh) } : null,
    p.streak > 1 ? { label: tr('Üst üste'), value: tr('{0} gün', p.streak) } : null,
    peak >= 0 ? { label: tr('En yoğun ay'), value: monthLong(peak) } : null,
  ].filter(Boolean).slice(0, 4) as CardData['stats'];
  return {
    kicker: tr('{0} özeti', year),
    headline: hoursText(p.total),
    sub: tr('{0} oturum · {1} farklı gün', int(p.count), int(p.days.size)),
    stats,
    games: list,
    bars: { kind: 'cols', items: months.map((m, i) => ({ label: monthShort(i), value: m, text: duration(m), peak: i === peak })) },
    art: artOf(p.top[0]?.g),
    text: tr('{0} yılında {1} oynadım, {2} oyun bitirdim. En çok: {3}.', year, hoursText(p.total), finished.length, listLine(list)),
    empty: p.count === 0,
  };
}

export function monthCard(games: Game[], year: number, month: number): CardData {
  const from = new Date(year, month, 1), to = new Date(year, month + 1, 1);
  const p = playIn(games, from, to);
  const before = playIn(games, new Date(year, month - 1, 1), from).total;
  const change = before > 0 ? Math.round(((p.total - before) / before) * 100) : null;
  const inMonth = new Date(year, month + 1, 0).getDate();
  const daily = Array.from({ length: inMonth }, (_, i) => p.days.get(`${year}-${month}-${i + 1}`) ?? 0);
  const peakDay = p.total ? daily.indexOf(Math.max(...daily)) : -1;
  const list = topGames(p.top, p.total);
  const stats = [
    p.longest ? { label: tr('En uzun oturum'), value: duration(p.longest.m) } : null,
    change != null ? { label: tr('Geçen aya göre'), value: `${change > 0 ? '+' : change < 0 ? '−' : ''}${pct(Math.abs(change))}` } : null,
    p.weekday >= 0 ? { label: tr('En çok oynanan gün'), value: cap(WEEKDAYS[p.weekday]) } : null,
    p.streak > 1 ? { label: tr('Üst üste'), value: tr('{0} gün', p.streak) } : { label: tr('Oynanan oyun'), value: int(p.top.length) },
  ].filter(Boolean) as CardData['stats'];
  const name = `${monthLong(month)} ${year}`;
  return {
    kicker: name,
    headline: hoursText(p.total),
    sub: tr('{0} oturum · {1} gün · {2} oyun', int(p.count), int(p.days.size), int(p.top.length)),
    stats,
    games: list,
    bars: { kind: 'cols', items: daily.map((m, i) => ({ label: (i + 1) % 5 === 0 || i === 0 ? String(i + 1) : '', value: m, text: duration(m), peak: i === peakDay })) },
    art: artOf(p.top[0]?.g),
    text: tr('{0}: {1} oynadım, {2} oturum. En çok: {3}.', name, hoursText(p.total), int(p.count), listLine(list)),
    empty: p.count === 0,
  };
}

/** every genre side by side */
export function genresCard(games: Game[]): CardData {
  const all = genreTotals(games).filter((x) => x.min > 0);
  const sum = games.reduce((a, g) => a + totalMinutes(g), 0);
  const top = all[0];
  const rows = all.slice(0, 6).map((x, i) => ({ label: x.name, value: x.min, text: pct(Math.round((x.min / Math.max(sum, 1)) * 100)), peak: i === 0 }));
  const lead = top ? [...top.games].sort((a, b) => totalMinutes(b) - totalMinutes(a)) : [];
  return {
    kicker: tr('Türlere göre'),
    headline: top?.name ?? '—',
    sub: top ? tr('oynadığın sürenin {0} kadarı · {1} oyun', pct(Math.round((top.min / Math.max(sum, 1)) * 100)), top.games.length) : '',
    stats: [
      { label: tr('Toplam'), value: hoursText(sum) },
      { label: tr('Tür'), value: int(all.length) },
      all[1] ? { label: tr('İkinci sırada'), value: all[1].name } : null,
    ].filter(Boolean) as CardData['stats'],
    games: topGames(lead.map((g) => ({ g, m: totalMinutes(g) })).filter((r) => r.m > 0), top?.min ?? 0, 5),
    bars: rows.length ? { kind: 'rows', items: rows } : null,
    art: artOf(lead[0]),
    text: top ? tr('En çok {0} oynuyorum: sürenin {1} kadarı. Sonra {2}.', top.name, pct(Math.round((top.min / Math.max(sum, 1)) * 100)), all.slice(1, 3).map((x) => x.name).join(', ') || '—') : '',
    empty: !top,
  };
}

export function genreCard(games: Game[], genre: string): CardData {
  const list = games.filter((g) => g.genres.includes(genre));
  const min = list.reduce((a, g) => a + totalMinutes(g), 0);
  const sum = games.reduce((a, g) => a + totalMinutes(g), 0);
  const played = list.map((g) => ({ g, m: totalMinutes(g) })).filter((r) => r.m > 0).sort((a, b) => b.m - a.m);
  const finished = list.filter((g) => g.status === 'completed' || g.status === 'hundred').length;
  const rated = list.filter((g) => g.rating != null);
  const avg = rated.length ? rated.reduce((a, g) => a + (g.rating ?? 0), 0) / rated.length : null;
  const top = topGames(played, min);
  return {
    kicker: genre,
    headline: hoursText(min),
    sub: tr('{0} oyun · oynadığın sürenin {1} kadarı', list.length, pct(Math.round((min / Math.max(sum, 1)) * 100))),
    stats: [
      { label: tr('Bitirilen'), value: int(finished) },
      { label: tr('Hiç açılmamış'), value: int(list.length - played.length) },
      avg != null ? { label: tr('Ortalama puanın'), value: avg.toLocaleString(locale, { maximumFractionDigits: 1 }) } : null,
      played[0] ? { label: tr('Favori'), value: played[0].g.title } : null,
    ].filter(Boolean) as CardData['stats'],
    games: top,
    bars: null,
    art: artOf(played[0]?.g ?? list[0]),
    text: tr('{0}: {1} oyun, {2}. En çok: {3}.', genre, list.length, hoursText(min), listLine(top)),
    empty: list.length === 0,
  };
}

export function gameCard(g: Game): CardData {
  const min = totalMinutes(g);
  const ses = g.sessions;
  const first = ses.length ? new Date(ses[0].start) : null;
  const longest = ses.reduce((a, s) => Math.max(a, s.minutes), 0);
  const ach = g.achievements && g.achievements.total > 0 ? g.achievements : null;
  const plat = PLATFORMS[g.platform]?.name ?? '';
  // the last twelve months of this game, when Tessera saw it played
  const now = new Date();
  const months = Array.from({ length: 12 }, (_, i) => new Date(now.getFullYear(), now.getMonth() - 11 + i, 1));
  const perMonth = months.map(() => 0);
  for (const s of ses) {
    const d = new Date(s.start);
    const i = (d.getFullYear() - months[0].getFullYear()) * 12 + d.getMonth() - months[0].getMonth();
    if (i >= 0 && i < 12) perMonth[i] += s.minutes;
  }
  const peak = perMonth.indexOf(Math.max(...perMonth));
  const bars: CardData['bars'] = perMonth.some((m) => m > 0)
    ? { kind: 'cols', items: perMonth.map((m, i) => ({ label: monthShort(months[i].getMonth()), value: m, text: duration(m), peak: i === peak })) }
    : null;
  return {
    kicker: plat,
    title: g.title,
    headline: hoursText(min),
    sub: [statusLabel(g.status), g.rating != null ? tr('{0}/10', g.rating.toLocaleString(locale)) : null].filter(Boolean).join(' · '),
    stats: [
      ses.length ? { label: tr('Oturum sayısı'), value: int(ses.length) } : null,
      longest ? { label: tr('En uzun oturum'), value: duration(longest) } : null,
      ach ? { label: tr('Başarım'), value: `${int(ach.unlocked)} / ${int(ach.total)}` } : null,
      first ? { label: tr('İlk oturum'), value: shortDate(first) } : g.finishedAt ? { label: tr('Bitirdiğin gün'), value: shortDate(g.finishedAt) } : null,
    ].filter(Boolean).slice(0, 4) as CardData['stats'],
    games: [],
    bars,
    art: artOf(g),
    cover: coverOf(g),
    text: tr('{0}: {1} oynadım.', g.title, hoursText(min)) + (ach ? ' ' + tr('Başarımların {0} kadarı tamam.', pct(Math.round((ach.unlocked / ach.total) * 100))) : ''),
    empty: false,
  };
}
