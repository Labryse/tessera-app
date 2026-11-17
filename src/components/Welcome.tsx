// First start: language and look, the stores, then the library. Comes once, on an
// empty Tessera; Settings → About can bring it back.
import { useEffect, useState, type CSSProperties } from 'react';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { THEMES, useStore } from '../store';
import { LANGS, lang, setLang, takeReopen } from '../lib/i18n';
import { isDesktop } from '../lib/backend';
import { AccountsPanel } from './AccountsReal';
import { usePresence } from './Modal';
import { setCustom } from '../lib/customThemes';

import { t as tr } from '../lib/i18n';
const STEPS = 3;
export const WELCOME_EVENT = 'tessera:welcome';

export function Welcome() {
  const { prefs, setPref, loaded, accounts, games, theme, setTheme } = useStore();
  const fresh = isDesktop ? loaded && !prefs.welcomed && accounts.length === 0 && games.length === 0 : window.location.hash === '#welcome';
  // a language change reloads the window; the guide comes back on the same step
  const [again] = useState(() => { const r = takeReopen(); return r?.startsWith('welcome:') ? Number(r.slice(8)) || 0 : null; });
  const [asked, setAsked] = useState(again !== null);
  const open = fresh || asked;
  const { mounted, leaving } = usePresence(open);
  const [step, setStep] = useState(again ?? 0);

  useEffect(() => {
    const again = () => { setStep(0); setAsked(true); };
    window.addEventListener(WELCOME_EVENT, again);
    return () => window.removeEventListener(WELCOME_EVENT, again);
  }, []);

  const finish = () => {
    setPref('welcomed', true);
    setAsked(false);
    if (!isDesktop && window.location.hash === '#welcome') history.replaceState(null, '', ' ');
  };

  if (!mounted) return null;
  return (
    <div className={`welcome ${leaving ? 'is-leaving' : ''}`} role="dialog" aria-modal="true" aria-label={tr('Hoş geldin')}>
      <div className="welcome-card">
        <button className="link welcome-skip" onClick={finish}>{tr('Atla')}</button>

        <div className="welcome-body" key={step}>
          {step === 0 && (
            <>
              <div className="welcome-mark" aria-hidden="true"><i /><i /><i /><i /></div>
              <h1 className="welcome-title">{tr('Tessera’ya hoş geldin')}</h1>
              <div className="welcome-field">
                <span className="welcome-label">{tr('Dil')}</span>
                <div className="segmented segmented-text" role="group" aria-label={tr('Dil')}>
                  {LANGS.map((l) => <button key={l.id} aria-pressed={lang === l.id} onClick={() => { if (l.id !== lang) void setLang(l.id, `welcome:${step}`); }}>{l.name}</button>)}
                </div>
              </div>
              <div className="welcome-field">
                <span className="welcome-label">{tr('Tema')}</span>
                <div className="welcome-themes" role="radiogroup" aria-label={tr('Tema')}>
                  {THEMES.map((t, i) => (
                    <button key={t.id} role="radio" aria-checked={theme === t.id} title={t.name} className={`welcome-swatch ${theme === t.id ? 'is-on' : ''}`}
                      style={{ '--a': t.swatch[0], '--b': t.swatch[1], '--c': t.swatch[2], '--i': i } as CSSProperties} onClick={() => { setCustom(null); setTheme(t.id); }}>
                      <span aria-hidden="true" />
                      <em>{t.name}</em>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <h1 className="welcome-title">{tr('Oyunlarını getir')}</h1>
              <div className="welcome-accounts"><AccountsPanel compact /></div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="welcome-count">
                <span className="num">{games.length}</span>
                <span>{games.length === 0 ? tr('oyun, şimdilik') : tr('oyun hazır')}</span>
              </div>
              <h1 className="welcome-title">{tr('Hepsi tek yerde')}</h1>
              <ul className="welcome-keys">
                <li><kbd>{tr('Ctrl')}</kbd><kbd>K</kbd><span>{tr('Ara')}</span></li>
                <li><kbd>F11</kbd><span>{tr('Geniş ekran')}</span></li>
                <li><kbd>{tr('Ctrl')}</kbd><kbd>,</kbd><span>{tr('Ayarlar')}</span></li>
              </ul>
            </>
          )}
        </div>

        <div className="welcome-foot">
          <button className="btn btn-ghost" onClick={() => setStep((s) => s - 1)} disabled={step === 0} aria-label={tr('Geri')}><ArrowLeft size={16} strokeWidth={1.8} /></button>
          <span className="welcome-dots" aria-hidden="true">
            {Array.from({ length: STEPS }, (_, i) => <i key={i} className={i === step ? 'is-on' : i < step ? 'is-done' : ''} />)}
          </span>
          {step < STEPS - 1
            ? <button className="btn btn-primary" onClick={() => setStep((s) => s + 1)}>{tr('İleri')} <ArrowRight size={16} strokeWidth={1.8} /></button>
            : <button className="btn btn-accent" onClick={finish}><Check size={16} strokeWidth={2} /> {tr('Başla')}</button>}
        </div>
      </div>
    </div>
  );
}
