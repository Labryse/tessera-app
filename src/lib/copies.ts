// The same game bought in more than one store (Steam and Epic, say) shows as one
// card: the copy you can play right away leads, play time adds up, and the
// game page lists every copy. Copies are matched by Steam app id when both
// know it, else by title. Retro ROMs are never folded.
import { isSystem, totalMinutes, type Game } from '../data/library';

const EDITION = /\b(game of the year|goty|definitive|complete|deluxe|standard|enhanced|ultimate|gold|anniversary|director'?s cut)( edition)?\b|\bedition\b/g;

/** "DARK SOULS™ III: Deluxe Edition" → "dark souls iii" */
export function titleKey(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[™®©]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(EDITION, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function steamAppOf(g: Game): number | null {
  if (g.platform === 'steam') {
    const n = Number(g.externalId ?? g.id);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return g.steamAppId ?? null;
}

/** the copy that leads: installed, then most played, then Steam */
function lead(copies: Game[]): Game {
  return [...copies].sort((a, b) =>
    Number(b.installed) - Number(a.installed)
    || totalMinutes(b) - totalMinutes(a)
    || Number(b.platform === 'steam') - Number(a.platform === 'steam'))[0];
}

/** one card per game; byId still answers for every copy */
export function foldCopies(games: Game[]): Game[] {
  const groups: Game[][] = [];
  const at = new Map<string, number>();
  for (const g of games) {
    if (isSystem(g.platform)) { groups.push([g]); continue; }
    const app = steamAppOf(g);
    const keys = [app != null ? `app:${app}` : null, `t:${titleKey(g.title)}`].filter(Boolean) as string[];
    // join a group that shares a key, has no copy from this store yet,
    // and does not know the game by a different Steam id (Prey 2006 is not Prey 2017)
    const fits = (i: number) =>
      !groups[i].some((x) => x.platform === g.platform)
      && !(app != null && groups[i].some((x) => steamAppOf(x) != null && steamAppOf(x) !== app));
    const found = keys.map((k) => at.get(k)).find((i) => i != null && fits(i));
    const i = found ?? groups.push([]) - 1;
    groups[i].push(g);
    for (const k of keys) if (!at.has(k)) at.set(k, i);
  }
  return groups.map((copies) => {
    if (copies.length === 1) return copies[0];
    const first = lead(copies);
    const sessions = copies.flatMap((c) => c.sessions).sort((a, b) => a.start.localeCompare(b.start));
    const reported = copies.map((c) => c.lastPlayedAt).filter(Boolean).sort().pop() ?? null;
    return {
      ...first,
      installed: copies.some((c) => c.installed),
      favorite: copies.some((c) => c.favorite),
      sessions,
      lastPlayedAt: reported,
      mergedFrom: [first, ...copies.filter((c) => c !== first)],
    };
  });
}
