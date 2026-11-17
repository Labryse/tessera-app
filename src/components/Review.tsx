// Your own review of a game: a verdict, what you think, what worked and what
// didn't. It is the last word on a game, next to your score — unlike notes,
// which are a running diary.
import { useState, type KeyboardEvent } from 'react';
import { Minus, PenLine, Plus, ThumbsDown, ThumbsUp, Trash2, X } from 'lucide-react';
import { useStore } from '../store';
import { score, shortDate, duration } from '../lib/format';
import { ratingWord, totalMinutes, type Game, type Review as ReviewData, type Verdict } from '../data/library';

import { t } from '../lib/i18n';
const VERDICTS: { id: Verdict; label: string; icon: React.ReactNode }[] = [
  { id: 'yes', label: t('Tavsiye ederim'), icon: <ThumbsUp size={15} strokeWidth={1.8} /> },
  { id: 'mixed', label: t('Kararsızım'), icon: <Minus size={15} strokeWidth={1.8} /> },
  { id: 'no', label: t('Tavsiye etmem'), icon: <ThumbsDown size={15} strokeWidth={1.8} /> },
];

function ListEditor({ label, items, setItems, tone }: { label: string; items: string[]; setItems: (v: string[]) => void; tone: 'pro' | 'con' }) {
  const [val, setVal] = useState('');
  const add = () => {
    const v = val.trim();
    if (v && !items.includes(v)) setItems([...items, v]);
    setVal('');
  };
  return (
    <div className={`rv-list rv-${tone}`}>
      <span className="sub-label">{label}</span>
      <ul>
        {items.map((x) => (
          <li key={x}>
            <span>{x}</span>
            <button className="tag-x" aria-label={t('{0} kaldır', x)} onClick={() => setItems(items.filter((y) => y !== x))}><X size={11} strokeWidth={2} /></button>
          </li>
        ))}
      </ul>
      <label className="rv-add">
        <Plus size={14} strokeWidth={1.8} />
        <input value={val} placeholder={t('Ekle ve Enter’a bas')} aria-label={t('{0} ekle', label)} onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} onBlur={add} />
      </label>
    </div>
  );
}

export function ReviewTab({ g }: { g: Game }) {
  const { update, notify } = useStore();
  const r = g.review;
  const [editing, setEditing] = useState(!r);
  const [draft, setDraft] = useState<ReviewData>(() => r ?? { text: '', verdict: null, pros: [], cons: [], updatedAt: '', playedMinutes: 0 });

  const save = () => {
    const next = { ...draft, text: draft.text.trim(), updatedAt: new Date().toISOString(), playedMinutes: totalMinutes(g) };
    update(g.id, { review: next });
    setEditing(false);
    notify(t('İnceleme kaydedildi'));
  };
  const remove = () => {
    update(g.id, { review: null });
    setDraft({ text: '', verdict: null, pros: [], cons: [], updatedAt: '', playedMinutes: 0 });
    setEditing(true);
    notify(t('İnceleme silindi'));
  };

  if (editing) {
    const empty = !draft.text.trim() && !draft.verdict && !draft.pros.length && !draft.cons.length;
    return (
      <section className="panel rv-editor">
        <div className="segmented segmented-text rv-verdicts" role="group" aria-label={t('Tavsiye')}>
          {VERDICTS.map((v) => (
            <button key={v.id} aria-pressed={draft.verdict === v.id} className={`rv-v-${v.id}`} onClick={() => setDraft((d) => ({ ...d, verdict: d.verdict === v.id ? null : v.id }))}>
              {v.icon} {v.label}
            </button>
          ))}
        </div>
        <label className="sr-only" htmlFor="rv-text">{t('İnceleme')}</label>
        <textarea id="rv-text" className="rv-text" rows={7} value={draft.text} placeholder={t('{0} hakkında ne düşünüyorsun?', g.title)}
          onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))} />
        <div className="rv-lists">
          <ListEditor label={t('Artılar')} tone="pro" items={draft.pros} setItems={(pros) => setDraft((d) => ({ ...d, pros }))} />
          <ListEditor label={t('Eksiler')} tone="con" items={draft.cons} setItems={(cons) => setDraft((d) => ({ ...d, cons }))} />
        </div>
        <div className="dialog-actions">
          {r && <button className="btn btn-ghost" onClick={() => { setDraft(r); setEditing(false); }}>{t('Vazgeç')}</button>}
          <button className="btn btn-primary" onClick={save} disabled={empty}>{t('Kaydet')}</button>
        </div>
      </section>
    );
  }

  const v = VERDICTS.find((x) => x.id === r!.verdict);
  return (
    <article className="panel rv-view">
      <header className="rv-head">
        {v && <span className={`rv-verdict rv-v-${v.id}`}>{v.icon} {v.label}</span>}
        {g.rating != null && <span className="rv-score"><span className="num">{score(g.rating)}</span> <span className="muted">· {ratingWord(g.rating)}</span></span>}
        <span className="muted small rv-meta">{shortDate(r!.updatedAt)}{r!.playedMinutes ? t(' · {0} oynadıktan sonra', duration(r!.playedMinutes, { compact: true })) : ''}</span>
        <span className="rv-tools">
          <button className="icon-btn" aria-label={t('Düzenle')} onClick={() => { setDraft(r!); setEditing(true); }}><PenLine size={16} strokeWidth={1.7} /></button>
          <button className="icon-btn" aria-label={t('Sil')} onClick={remove}><Trash2 size={16} strokeWidth={1.7} /></button>
        </span>
      </header>
      {r!.text && <div className="rv-body">{r!.text.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)}</div>}
      {(r!.pros.length > 0 || r!.cons.length > 0) && (
        <div className="rv-lists rv-lists-view">
          {r!.pros.length > 0 && <div className="rv-list rv-pro"><span className="sub-label">{t('Artılar')}</span><ul>{r!.pros.map((x) => <li key={x}>{x}</li>)}</ul></div>}
          {r!.cons.length > 0 && <div className="rv-list rv-con"><span className="sub-label">{t('Eksiler')}</span><ul>{r!.cons.map((x) => <li key={x}>{x}</li>)}</ul></div>}
        </div>
      )}
    </article>
  );
}
