import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Plus, Search, X } from 'lucide-react';
import { useStore } from '../store';
import { PLATFORMS, STATUSES, type Game, type PlatformId } from '../data/library';
import {
  FEATURES, LAST, METACRITIC_STEPS, MINE_STEPS, PLAY, SIZE, USER_STEPS, pills, tally, type Filters,
} from '../lib/filters';

import { t as tr, locale } from '../lib/i18n';
type Set_ = (f: Filters) => void;

/** adds a value to a list filter, or takes it out */
const flip = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

function Chip({ on, n, onClick, children }: { on: boolean; n?: number; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className={`fchip ${on ? 'is-on' : ''}`} aria-pressed={on} onClick={onClick}>
      {children}{n != null && <span className="fchip-n">{n}</span>}
    </button>
  );
}

function Steps({ value, steps, fmt, onChange, label }: { value: number | null; steps: number[]; fmt: (n: number) => string; onChange: (n: number | null) => void; label: string }) {
  return (
    <div className="segmented segmented-text fseg" role="group" aria-label={label}>
      <button aria-pressed={value == null} onClick={() => onChange(null)}>{tr('Hepsi')}</button>
      {steps.map((s) => <button key={s} aria-pressed={value === s} onClick={() => onChange(value === s ? null : s)}>{fmt(s)}</button>)}
    </div>
  );
}

function Group({ title, note, children, wide }: { title: string; note?: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <section className={`fgroup ${wide ? 'is-wide' : ''}`}>
      <h3 className="fgroup-title">{title}{note && <span className="fgroup-note">{note}</span>}</h3>
      {children}
    </section>
  );
}

/** every way to narrow the list; counts are for the list this page started from */
export function FilterPanel({ base, f, set }: { base: Game[]; f: Filters; set: Set_ }) {
  const { collections } = useStore();
  const [tagQ, setTagQ] = useState('');
  const [allTags, setAllTags] = useState(false);

  const genres = useMemo(() => tally(base, (g) => g.genres), [base]);
  const tags = useMemo(() => tally(base, (g) => [...g.storeTags, ...g.tags]), [base]);
  const feats = useMemo(() => new Map(tally(base, (g) => g.features)), [base]);
  const plats = useMemo(() => tally(base, (g) => [g.platform]), [base]);
  const statusN = useMemo(() => new Map(tally(base, (g) => [g.status])), [base]);
  const years = useMemo(() => [...new Set(base.map((g) => g.year).filter((y): y is number => y != null))].sort((a, b) => b - a), [base]);
  const withMc = base.filter((g) => g.metacritic != null).length;
  const withUser = base.filter((g) => g.userScore != null).length;
  const manual = collections.filter((c) => !c.filter);

  const needle = tagQ.trim().toLocaleLowerCase(locale);
  const tagList = needle
    ? tags.filter(([t]) => t.toLocaleLowerCase(locale).includes(needle))
    : allTags ? tags : tags.slice(0, 28);
  // chosen tags stay visible even when the list is cut short
  const shownTags = [...f.tags.filter((t) => !tagList.some(([x]) => x === t)).map((t) => [t, 0] as [string, number]), ...tagList];

  return (
    <div className="fpanel" role="region" aria-label={tr('Filtreler')}>
      <Group title={tr('Tür')} note={f.genres.length > 1 ? tr('herhangi biri') : undefined}>
        <div className="fchips">
          {genres.length === 0 && <p className="fempty">{tr('Tür bilgisi henüz yok.')}</p>}
          {genres.map(([g, n]) => <Chip key={g} on={f.genres.includes(g)} n={n} onClick={() => set({ ...f, genres: flip(f.genres, g) })}>{g}</Chip>)}
        </div>
      </Group>

      <Group title={tr('Özellikler')} note={f.features.length > 1 ? tr('hepsi olmalı') : undefined}>
        <div className="fchips">
          {FEATURES.filter((x) => feats.get(x.id)).map((x) => (
            <Chip key={x.id} on={f.features.includes(x.id)} n={feats.get(x.id)} onClick={() => set({ ...f, features: flip(f.features, x.id) })}>{x.label}</Chip>
          ))}
          {feats.size === 0 && <p className="fempty">{tr('Mağaza bilgisi gelince burada çıkar.')}</p>}
        </div>
      </Group>

      <Group title={tr('Durum')}>
        <div className="fchips">
          {STATUSES.filter((s) => statusN.get(s.id)).map((s) => (
            <Chip key={s.id} on={f.status.includes(s.id)} n={statusN.get(s.id)} onClick={() => set({ ...f, status: flip(f.status, s.id) })}>{s.label}</Chip>
          ))}
        </div>
      </Group>

      {plats.length > 1 && (
        <Group title={tr('Mağaza')}>
          <div className="fchips">
            {plats.map(([p, n]) => (
              <Chip key={p} on={f.platforms.includes(p as PlatformId)} n={n} onClick={() => set({ ...f, platforms: flip(f.platforms, p as PlatformId) })}>{PLATFORMS[p as PlatformId].name}</Chip>
            ))}
          </div>
        </Group>
      )}

      <Group title={tr('Kurulum ve boyut')}>
        <div className="segmented segmented-text fseg" role="group" aria-label={tr('Kurulum')}>
          <button aria-pressed={f.install === 'any'} onClick={() => set({ ...f, install: 'any' })}>{tr('Hepsi')}</button>
          <button aria-pressed={f.install === 'installed'} onClick={() => set({ ...f, install: 'installed' })}>{tr('Yüklü')}</button>
          <button aria-pressed={f.install === 'remote'} onClick={() => set({ ...f, install: 'remote' })}>{tr('Yüklü değil')}</button>
        </div>
        <div className="fchips">
          {SIZE.map((s) => <Chip key={s.id} on={f.size.includes(s.id)} onClick={() => set({ ...f, size: flip(f.size, s.id) })}>{s.label}</Chip>)}
        </div>
      </Group>

      <Group title={tr('Oynama süresi')}>
        <div className="fchips">
          {PLAY.map((p) => <Chip key={p.id} on={f.play.includes(p.id)} onClick={() => set({ ...f, play: flip(f.play, p.id) })}>{p.label}</Chip>)}
        </div>
      </Group>

      <Group title={tr('Son oynama')}>
        <div className="fchips">
          {LAST.map((p) => <Chip key={p.id} on={f.last === p.id} onClick={() => set({ ...f, last: f.last === p.id ? null : p.id })}>{p.label}</Chip>)}
        </div>
      </Group>

      <Group title={tr('Puanlar')}>
        <div className="fscore">
          <span className="fscore-label">{tr('Metacritic')}<span className="fscore-n">{withMc} {tr('oyunda var')}</span></span>
          <Steps label={tr('Metacritic')} value={f.metacritic} steps={METACRITIC_STEPS} fmt={(n) => `${n}+`} onChange={(v) => set({ ...f, metacritic: v })} />
        </div>
        <div className="fscore">
          <span className="fscore-label">{tr('Steam kullanıcıları')}<span className="fscore-n">{withUser} {tr('oyunda var')}</span></span>
          <Steps label={tr('Steam kullanıcı puanı')} value={f.userScore} steps={USER_STEPS} fmt={(n) => `%${n}+`} onChange={(v) => set({ ...f, userScore: v })} />
        </div>
        <div className="fscore">
          <span className="fscore-label">{tr('Puanım')}</span>
          <Steps label={tr('Puanım')} value={f.mine} steps={MINE_STEPS} fmt={(n) => `${n}+`} onChange={(v) => set({ ...f, mine: v })} />
        </div>
      </Group>

      <Group title={tr('Çıkış yılı')}>
        <div className="fyears">
          <label className="field">
            <span className="sr-only">{tr('En erken')}</span>
            <select value={f.yearFrom ?? ''} onChange={(e) => set({ ...f, yearFrom: e.target.value ? Number(e.target.value) : null })}>
              <option value="">{tr('En eski')}</option>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <span className="muted">–</span>
          <label className="field">
            <span className="sr-only">{tr('En geç')}</span>
            <select value={f.yearTo ?? ''} onChange={(e) => set({ ...f, yearTo: e.target.value ? Number(e.target.value) : null })}>
              <option value="">{tr('En yeni')}</option>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
        </div>
      </Group>

      <Group title={tr('Kategori ve diğer')}>
        <div className="fchips">
          {manual.map((c) => <Chip key={c.id} on={f.collections.includes(c.id)} onClick={() => set({ ...f, collections: flip(f.collections, c.id) })}>{c.id}</Chip>)}
          <Chip on={f.uncategorized} onClick={() => set({ ...f, uncategorized: !f.uncategorized })}>{tr('Kategorisi olmayanlar')}</Chip>
          <Chip on={f.favorite} onClick={() => set({ ...f, favorite: !f.favorite })}>{tr('Favoriler')}</Chip>
          <Chip on={f.noted} onClick={() => set({ ...f, noted: !f.noted })}>{tr('Notu ya da yorumu olanlar')}</Chip>
        </div>
      </Group>
      <Group title={tr('Etiketler')} note={f.tags.length > 1 ? tr('hepsi olmalı') : undefined} wide>
        <label className="field ftag-search">
          <Search size={14} strokeWidth={1.6} />
          <input value={tagQ} onChange={(e) => setTagQ(e.target.value)} placeholder={tr('{0} etiket içinde ara', tags.length)} aria-label={tr('Etiket ara')} />
          {tagQ && <button className="fclear" aria-label={tr('Aramayı temizle')} onClick={() => setTagQ('')}><X size={13} strokeWidth={2} /></button>}
        </label>
        <div className="fchips">
          {shownTags.map(([t, n]) => <Chip key={t} on={f.tags.includes(t)} n={n || undefined} onClick={() => set({ ...f, tags: flip(f.tags, t) })}>{t}</Chip>)}
          {!needle && tags.length > 28 && (
            <button className="link fmore" onClick={() => setAllTags((v) => !v)}>{allTags ? tr('Daha az göster') : tr('Tümünü göster ({0})', tags.length)}</button>
          )}
          {needle && tagList.length === 0 && <p className="fempty">“{tagQ}{tr('” diye bir etiket yok.')}</p>}
        </div>
      </Group>

    </div>
  );
}

/** the active choices, each removable, and what to do with the result */
export function FilterPills({ f, set, onClear, shown, children }: { f: Filters; set: Set_; onClear: () => void; shown: Game[]; children?: React.ReactNode }) {
  const list = pills(f);
  return (
    <div className="fpills">
      {list.map((p) => (
        <span key={p.key} className="fpill">
          {p.label}
          <button className="fpill-x" aria-label={tr('{0} filtresini kaldır', p.label)} onClick={() => set(p.clear(f))}><X size={12} strokeWidth={2} /></button>
        </span>
      ))}
      {list.length > 0 && <button className="link fpills-clear" onClick={onClear}>{tr('Temizle')}</button>}
      <span className="fpills-right">
        <span className="muted fpills-n">{shown.length} {tr('oyun')}</span>
        {children}
      </span>
    </div>
  );
}

/** a small menu that closes on outside click */
export function Popover({ label, icon, children, className = '' }: { label: string; icon?: React.ReactNode; children: (close: () => void) => React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className={`coll-pick ${className}`} ref={ref}>
      <button className="btn btn-sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{icon}{label}</button>
      {open && <div className="coll-menu" role="menu">{children(() => setOpen(false))}</div>}
    </div>
  );
}

/** puts every game in the list into a category, new or old */
export function AddAllToCategory({ games }: { games: Game[] }) {
  const { collections, addCollection, fileGames, notify } = useStore();
  const [name, setName] = useState('');
  const manual = collections.filter((c) => !c.filter);
  const put = (cat: string, close: () => void) => {
    const ids = games.filter((g) => !g.collections.includes(cat)).map((g) => g.id);
    fileGames(ids, cat, true);
    notify(ids.length ? tr('{0} oyun “{1}” kategorisine eklendi', ids.length, cat) : tr('Hepsi zaten “{0}” kategorisinde', cat));
    close();
  };
  return (
    <Popover label={tr('Kategoriye ekle')} icon={<Plus size={14} strokeWidth={1.8} />}>
      {(close) => (
        <>
          <p className="coll-head">{tr('Listedeki')} {games.length} {tr('oyunu ekle')}</p>
          {manual.map((c) => {
            const all = games.every((g) => g.collections.includes(c.id));
            return (
              <button key={c.id} role="menuitem" className={`coll-item ${all ? 'is-on' : ''}`} onClick={() => put(c.id, close)}>
                <span className="coll-box">{all && <Check size={12} strokeWidth={2.4} />}</span>{c.id}
              </button>
            );
          })}
          <label className="coll-new">
            <Plus size={14} strokeWidth={1.8} />
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={tr('Yeni kategori')} aria-label={tr('Yeni kategori adı')}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || !name.trim()) return;
                if (addCollection(name)) put(name.trim(), close); else notify(tr('Bu adda bir kategori zaten var'));
                setName('');
              }} />
          </label>
        </>
      )}
    </Popover>
  );
}

/** turns the current filters into a category that keeps itself up to date */
export function SaveAsDynamic({ f, onSaved }: { f: Filters; onSaved: (name: string) => void }) {
  const { addCollection, notify } = useStore();
  const [name, setName] = useState('');
  return (
    <Popover label={tr('Dinamik kategori yap')}>
      {(close) => (
        <>
          <p className="coll-head">{tr('Bu filtrelere uyan her oyun, sonradan eklenenler de, bu kategoride görünür.')}</p>
          <label className="coll-new">
            <Plus size={14} strokeWidth={1.8} />
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={tr('Kategori adı')} aria-label={tr('Kategori adı')}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || !name.trim()) return;
                if (addCollection(name, f)) { onSaved(name.trim()); close(); } else notify(tr('Bu adda bir kategori zaten var'));
              }} />
          </label>
        </>
      )}
    </Popover>
  );
}
