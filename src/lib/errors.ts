import { t } from './i18n';
// Errors the window did not handle, kept in memory for a bug report. Nothing is sent:
// the report is shown to the user first and goes out only through their own hands
// (a GitHub issue they submit, or text they copy).

export interface Caught { at: number; message: string; stack: string }

const MAX = 20;
export const caught: Caught[] = [];
const subs = new Set<(c: Caught) => void>();

export function onCaught(f: (c: Caught) => void) {
  subs.add(f);
  return () => { subs.delete(f); };
}

function keep(message: string, stack = '') {
  // the same error over and over is one error
  if (caught.some((c) => c.message === message)) return;
  const c = { at: Date.now(), message: message.slice(0, 500), stack: stack.split('\n').slice(0, 12).join('\n') };
  caught.push(c);
  if (caught.length > MAX) caught.shift();
  subs.forEach((f) => f(c));
}

export function installErrorCatch() {
  window.addEventListener('error', (e) => {
    // a picture or a sound that did not load is not a bug
    if (!(e.error instanceof Error) && !e.message) return;
    keep(e.message || String(e.error), e.error instanceof Error ? e.error.stack : '');
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    // backend answers ("no key", "offline") are told to the user where they happen
    if (typeof r === 'string') return;
    keep(r instanceof Error ? r.message : String(r), r instanceof Error ? r.stack : '');
  });
}

/** takes out what could point at a person: user folders, e-mails, keys, Steam ids */
export function redact(s: string) {
  return s
    .replace(/([A-Za-z]:[\\/]+Users[\\/]+)[^\\/\s"']+/gi, '$1…')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '…@…')
    .replace(/(\b(?:key|token|apikey|api_key|access_token|secret|password)\s*[=:]\s*)[^&\s"']+/gi, '$1…')
    .replace(/\b[0-9A-Fa-f]{32,}\b/g, '…')
    .replace(/\b7656119\d{10}\b/g, '…');
}

export function reportText(info: { version: string; os: string; log: string }, note: string) {
  const parts = [
    note.trim() || t('<!-- Ne yapıyordun, ne oldu? -->'),
    '',
    '---',
    t('Tessera {0} · {1}', info.version, info.os),
  ];
  if (caught.length) {
    parts.push('', '```', ...caught.slice(-5).map((c) => `${new Date(c.at).toISOString()} ${c.message}\n${c.stack}`.trim()), '```');
  }
  if (info.log.trim()) parts.push('', t('Rust:'), '```', info.log.trim(), '```');
  return redact(parts.join('\n'));
}

export function issueUrl(repo: string, title: string, body: string) {
  // browsers and GitHub cut long addresses; the end of the log goes first
  const max = 6000;
  const b = body.length > max ? `${body.slice(0, max)}\n…` : body;
  return `https://github.com/${repo}/issues/new?labels=bug&title=${encodeURIComponent(title)}&body=${encodeURIComponent(b)}`;
}
