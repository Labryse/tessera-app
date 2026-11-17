// Prototype helper: pulls achievement names, icons and global unlock rates for a
// few sample games into public/media/<id>/ach and src/data/achievements.json.
// Run: node scripts/fetch-achievements.mjs
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

const ids = [1145350, 1057090, 588650, 105600, 774361, 548430];
const root = path.resolve(import.meta.dirname, '..');
const out = {};

for (const id of ids) {
  const html = await (await fetch(`https://steamcommunity.com/stats/${id}/achievements/?l=english`)).text();
  const unescaped = html.replace(/\\"/g, '"');
  const re = /\{"internal_key":\d+,"api_name":"([^"]+)","name":"([^"]*)","description":"([^"]*)","hidden":(true|false)[^{}]*?"icon_achieved":"([^"]+)"[^{}]*\}/g;
  const list = [];
  const seen = new Set();
  for (const m of unescaped.matchAll(re)) {
    if (seen.has(m[1]) || !m[2]) continue;
    seen.add(m[1]);
    list.push({ api: m[1], name: m[2], description: m[3], hidden: m[4] === 'true', icon: m[5] });
  }
  let pct = {};
  try {
    const j = await (await fetch(`https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${id}`)).json();
    for (const a of j.achievementpercentages?.achievements ?? []) pct[a.name] = Number(a.percent);
  } catch { /* ignore */ }

  const dir = path.join(root, 'public', 'media', String(id), 'ach');
  await mkdir(dir, { recursive: true });
  for (const a of list) {
    const res = await fetch(`https://cdn.fastly.steamstatic.com/steamcommunity/public/images/apps/${id}/${a.icon}`);
    if (res.ok) await writeFile(path.join(dir, a.icon), Buffer.from(await res.arrayBuffer()));
    a.percent = pct[a.api] != null ? Math.round(pct[a.api] * 10) / 10 : null;
  }
  out[id] = list;
  console.log(id, list.length, 'achievements');
}

await writeFile(path.join(root, 'src', 'data', 'achievements.json'), JSON.stringify(out, null, 2));
