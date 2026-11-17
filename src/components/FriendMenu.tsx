// What a friend does on click and right-click, the way the Steam friends list does it:
// a click opens the chat in Steam; the menu has the profile, a trade offer and, when
// they are playing, the game's own pages. Xbox friends open their profile.
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeftRight, Gamepad2, LibraryBig, MessageSquare, Play, Store, User, Users } from 'lucide-react';
import { useStore } from '../store';
import { api, isDesktop, type Friend } from '../lib/backend';
import type { Game } from '../data/library';
import { t } from '../lib/i18n';

const BASE = BigInt('76561197960265728');
/** Steam's 64-bit id from the friends list's account number */
export const steamId = (f: Friend) => (typeof f.account === 'number' || /^\d+$/.test(String(f.account)) ? (BASE + BigInt(f.account)).toString() : null);

export function steam(path: string) {
  if (!isDesktop) { window.open(`steam://${path}`); return; }
  api.openSteam(path).catch(() => {});
}
const xboxProfile = (f: Friend) => {
  const tag = f.gamertag ?? f.name;
  const url = `https://www.xbox.com/play/user/${encodeURIComponent(tag)}`;
  api.openUrl(url).catch(() => window.open(url, '_blank', 'noopener'));
};

/** a click on a friend */
export function openFriend(f: Friend, kind: 'steam' | 'xbox') {
  if (kind === 'xbox') { xboxProfile(f); return; }
  const id = steamId(f);
  if (id) steam(`friends/message/${id}`);
}

interface At { x: number; y: number; f: Friend; kind: 'steam' | 'xbox'; mine: Game | null }

/** the menu and the handlers that open it */
export function useFriendMenu() {
  const [at, setAt] = useState<At | null>(null);
  const bind = (f: Friend, kind: 'steam' | 'xbox', mine: Game | null = null) => ({
    onClick: () => openFriend(f, kind),
    onContextMenu: (e: MouseEvent) => { e.preventDefault(); setAt({ x: e.clientX, y: e.clientY, f, kind, mine }); },
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter') openFriend(f, kind); },
    tabIndex: 0,
    role: 'button',
    title: kind === 'steam' ? t('Sohbeti aç · sağ tık: diğerleri') : t('Profili aç'),
  });
  const menu = <FriendMenu at={at} onClose={() => setAt(null)} />;
  return { bind, menu };
}

function FriendMenu({ at, onClose }: { at: At | null; onClose: () => void }) {
  const { go } = useStore();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!at || !ref.current) { setPos(null); return; }
    const r = ref.current.getBoundingClientRect();
    setPos({ left: Math.min(at.x, window.innerWidth - r.width - 8), top: Math.min(at.y, window.innerHeight - r.height - 8) });
  }, [at]);
  useEffect(() => {
    if (!at) return;
    const off = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', off);
    window.addEventListener('keydown', esc);
    window.addEventListener('blur', onClose);
    document.querySelector('.sheet-scroll')?.addEventListener('scroll', onClose, { once: true });
    return () => { window.removeEventListener('mousedown', off); window.removeEventListener('keydown', esc); window.removeEventListener('blur', onClose); };
  }, [at, onClose]);
  if (!at) return null;

  const { f, kind, mine } = at;
  const id = steamId(f);
  const act = (fn: () => void) => () => { fn(); onClose(); };
  return createPortal(
    <div ref={ref} className={`fr-menu is-${kind}`} role="menu" style={pos ?? { left: at.x, top: at.y, visibility: 'hidden' }}>
      <div className="fr-menu-who">{f.name}</div>
      {kind === 'steam' && id ? (
        <>
          <button role="menuitem" onClick={act(() => steam(`friends/message/${id}`))}><MessageSquare size={15} strokeWidth={1.8} /> {t('Mesaj gönder')}</button>
          <button role="menuitem" onClick={act(() => steam(`url/SteamIDPage/${id}`))}><User size={15} strokeWidth={1.8} /> {t('Profili görüntüle')}</button>
          <button role="menuitem" onClick={act(() => steam(`openurl/https://steamcommunity.com/tradeoffer/new/?partner=${f.account}`))}><ArrowLeftRight size={15} strokeWidth={1.8} /> {t('Takas teklif et')}</button>
        </>
      ) : (
        <button role="menuitem" onClick={act(() => xboxProfile(f))}><User size={15} strokeWidth={1.8} /> {t('Profili görüntüle')}</button>
      )}
      {f.game && (
        <>
          <div className="fr-menu-sep" />
          <div className="fr-menu-game"><Gamepad2 size={14} strokeWidth={1.8} /> {f.game}</div>
          {mine && <button role="menuitem" onClick={act(() => go({ name: 'game', id: mine.id }))}><LibraryBig size={15} strokeWidth={1.8} /> {t('Tessera’da aç')}</button>}
          {kind === 'steam' && f.appid && (
            <>
              <button role="menuitem" onClick={act(() => steam(`run/${f.appid}`))}><Play size={15} strokeWidth={1.8} /> {t('Oyunu başlat')}</button>
              <button role="menuitem" onClick={act(() => steam(`store/${f.appid}`))}><Store size={15} strokeWidth={1.8} /> {t('Mağaza sayfası')}</button>
              <button role="menuitem" onClick={act(() => steam(`url/GameHub/${f.appid}`))}><Users size={15} strokeWidth={1.8} /> {t('Topluluk merkezi')}</button>
            </>
          )}
        </>
      )}
    </div>,
    document.body,
  );
}
