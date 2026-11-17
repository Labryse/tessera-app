// Prototype helper: pulls cover / hero / logo art and Turkish store text for the
// sample library from Steam's public CDN + store API into public/media and
// src/data/steam-meta.json. Run: node scripts/fetch-media.mjs
import { mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';

const ids = [
  // games found on the desktop (Steam shortcuts)
  977950, 4126040, 2457220, 4656000, 582660, 774361, 397540, 375480, 394970, 588650,
  548430, 570, 1145350, 1057090, 108600, 1282100, 294100, 211820, 105600, 1171690, 1281930,
  // sample titles that stand in for other stores in the prototype
  1551360, 2344520, 2357570, 3035570, 2751000, 1328670, 1774580, 990080, 976730, 1716740,
];

const root = path.resolve(import.meta.dirname, '..');
const base = (id) => `https://shared.steamstatic.com/store_item_assets/steam/apps/${id}`;
const files = { 'cover.jpg': 'library_600x900_2x.jpg', 'hero.jpg': 'library_hero.jpg', 'logo.png': 'logo.png', 'header.jpg': 'header.jpg' };

const exists = (p) => access(p).then(() => true, () => false);
const meta = {};

for (const id of ids) {
  const dir = path.join(root, 'public', 'media', String(id));
  await mkdir(dir, { recursive: true });
  const have = {};
  for (const [name, remote] of Object.entries(files)) {
    const out = path.join(dir, name);
    if (await exists(out)) { have[name.split('.')[0]] = true; continue; }
    const res = await fetch(`${base(id)}/${remote}`);
    if (res.ok) {
      await writeFile(out, Buffer.from(await res.arrayBuffer()));
      have[name.split('.')[0]] = true;
    }
  }
  let store = null;
  try {
    const r = await fetch(`https://store.steampowered.com/api/appdetails?appids=${id}&l=turkish&cc=tr`);
    const j = await r.json();
    const d = j?.[id]?.data;
    if (d) {
      store = {
        name: d.name,
        short: d.short_description,
        developers: d.developers ?? [],
        publishers: d.publishers ?? [],
        release: d.release_date?.date ?? null,
        genres: (d.genres ?? []).map((g) => g.description),
        categories: (d.categories ?? []).map((c) => c.description),
        metacritic: d.metacritic?.score ?? null,
        achievements: d.achievements?.total ?? 0,
        screenshots: (d.screenshots ?? []).slice(0, 6).map((s) => s.path_full),
      };
    }
  } catch { /* offline: keep going */ }
  meta[id] = { media: have, store };
  console.log(id, Object.keys(have).join(','), store?.name ?? '(no store data)');
  await new Promise((r) => setTimeout(r, 350));
}

await mkdir(path.join(root, 'src', 'data'), { recursive: true });
await writeFile(path.join(root, 'src', 'data', 'steam-meta.json'), JSON.stringify(meta, null, 2));
