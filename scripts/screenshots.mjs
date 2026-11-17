// Screenshots for the README, taken from the browser demo (npm run dev) with a headless
// Chrome or Edge driven over the DevTools protocol. Writes docs/screenshots/{en,tr}/*.webp.
//   node scripts/screenshots.mjs [http://localhost:5174]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:5174';
const OUT = 'docs/screenshots';
// the words the script clicks on, in each language
const LANGS = {
  en: { create: 'Create theme', layout: 'Layout', preset: 'Top menu and game list' },
  tr: { create: 'Tema oluştur', layout: 'Yerleşim', preset: 'Üst menü ve oyun listesi' },
};
let lang = 'en';
const W = 1440, H = 900, SCALE = 1.5;
const PORT = 9333;

const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const exe = BROWSERS.find((p) => existsSync(p));
if (!exe) throw new Error('Chrome or Edge not found');

const profile = mkdtempSync(join(tmpdir(), 'tessera-shots-'));
const browser = spawn(exe, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run',
  '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', 'about:blank',
], { stdio: 'ignore' });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await wait(200);
  try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* not up yet */ }
}
if (!target) throw new Error('browser did not start');

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((ok, no) => {
  const id = ++seq;
  pending.set(id, (m) => (m.error ? no(new Error(`${method}: ${m.error.message}`)) : ok(m.result)));
  ws.send(JSON.stringify({ id, method, params }));
});
const js = async (expr) => (await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true })).result?.value;

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: SCALE, mobile: false });

let loads = 0;
const open = async (path, setup = '') => {
  await send('Page.navigate', { url: `${BASE}/` });
  await wait(800);
  await js(`
    localStorage.clear();
    localStorage.setItem('tessera.lang', '${lang}');
    localStorage.setItem('tessera.prefs', JSON.stringify({ startupAnim: false, startupSound: false, welcomed: true }));
    ${setup}
  `);
  // a new query makes it a fresh load even when only the hash differs
  await send('Page.navigate', { url: `${BASE}/?shot=${++loads}${path}` });
  await wait(3500);
};
const shot = async (name) => {
  // every picture on screen finished
  await js(`await Promise.all([...document.images].filter((i) => !i.complete).map((i) => new Promise((r) => { i.onload = i.onerror = r; setTimeout(r, 4000); })));`);
  await wait(900);
  const { data } = await send('Page.captureScreenshot', { format: 'webp', quality: 88 });
  writeFileSync(join(OUT, lang, `${name}.webp`), Buffer.from(data, 'base64'));
  console.log('saved', lang, name);
};
const click = (sel, text) => js(`
  const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => ${text ? `e.textContent.includes(${JSON.stringify(text)})` : 'true'});
  if (!el) throw new Error('no ' + ${JSON.stringify(`${sel} ${text ?? ''}`)});
  el.click();
`);

try {
  for (lang of Object.keys(LANGS)) {
    const w = LANGS[lang];
    mkdirSync(join(OUT, lang), { recursive: true });
    await open('');
    await shot('library');

    await open('#game/1145350');
    await shot('game');

    await open('#stats');
    await shot('stats');

    await open('#system/gba');
    await shot('retro');

    await open('#big');
    await shot('big-screen');

    // the theme studio on a top bar with a game list beside the page
    await open('#settings/appearance');
    await click('button', w.create);
    await wait(800);
    await click('.sd-tabs button', w.layout);
    await wait(400);
    await click('.sd-preset', w.preset);
    await wait(800);
    await js(`document.querySelectorAll('.gl-row')[4]?.click();`);
    await wait(1500);
    await shot('theme-studio');
  }
} finally {
  ws.close();
  browser.kill();
  await wait(500);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* still locked */ }
}
