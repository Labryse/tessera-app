import { useEffect, useState } from 'react';
import { StoreProvider, useStore, type SettingsSection } from './store';
import { Sidebar } from './components/Sidebar';
import { LibraryView } from './components/Library';
import { GameDetail } from './components/GameDetail';
import { EmulatorsView, SystemView } from './components/SystemView';
import { StatsView } from './components/Stats';
import { YearView } from './components/YearView';
import { NewsView } from './components/News';
import { WishlistView } from './components/Wishlist';
import { FriendsView } from './components/Friends';
import { ShopView } from './components/Shop';
import { CommandPalette, GameMenu } from './components/Overlays';
import { Picker } from './components/Picker';
import { SettingsPanel } from './components/Settings';
import { Splash } from './components/Splash';
import { ScanDialog } from './components/ScanDialog';
import { AddGameDialog, MatchDialog } from './components/GameMatch';
import { BigPicture } from './components/BigPicture';
import { usePad } from './lib/pad';
import { reopened, syncLang } from './lib/i18n';
import { Welcome } from './components/Welcome';
import { useTrackedEvents } from './components/Track';
import { ErrorReport } from './components/ErrorReport';
import { StudioDock } from './components/studio/Studio';
import { ShareHost } from './components/Share';
import { GameList } from './components/GameList';
import { cleanLayout, useLayout } from './lib/layout';

const editable = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');

function Shell() {
  const { route, theme, toast, back, openSettings, settings, closeSettings, big, setBig, prefs } = useStore();
  // Start (or the guide button) on a controller opens the wide-screen mode
  usePad((a) => { if (a === 'start') setBig(true); }, prefs.padOpensBig && !big);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { nav, list } = cleanLayout(useLayout());
  const withList = list !== 'off' && (route.name === 'library' || route.name === 'game');

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { void syncLang(); }, []);
  // settings were open when the language changed
  useEffect(() => {
    if (reopened?.startsWith('settings:')) { try { sessionStorage.removeItem('tessera.reopen'); } catch { /* ignore */ } openSettings(reopened.slice(9) as SettingsSection); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useTrackedEvents();

  // no browser menu (Inspect, Save as, Print…): this is an app. Text fields keep
  // theirs for copy and paste; games get their own menu.
  useEffect(() => {
    const block = (e: MouseEvent) => { if (!editable(e.target)) e.preventDefault(); };
    window.addEventListener('contextmenu', block);
    return () => window.removeEventListener('contextmenu', block);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen((v) => !v); }
      if (mod && e.key === ',') { e.preventDefault(); if (settings) closeSettings(); else openSettings(); }
      // browser shortcuts that make no sense in an app
      if (mod && ['p', 's', 'u', 'f', 'g', 'r'].includes(e.key.toLowerCase()) && !editable(e.target)) e.preventDefault();
      if (e.key === 'F5' || e.key === 'F3' || e.key === 'F7') e.preventDefault();
      if (e.altKey && e.key === 'ArrowLeft') back();
      if (e.key === 'F11') { e.preventDefault(); setBig(!big); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [back, openSettings, closeSettings, settings, big, setBig]);

  return (
    <div className={`app ${big ? 'is-big' : ''}`} data-nav={nav} data-list={withList ? list : undefined}>
      <Sidebar onSearch={() => setPaletteOpen(true)} />
      {withList && <GameList />}
      <main className="sheet">
        <div className="sheet-scroll">
          <div className="route" key={JSON.stringify(route)}>
            {route.name === 'library' && <LibraryView key={JSON.stringify(route.scope)} scope={route.scope} />}
            {route.name === 'game' && <GameDetail id={route.id} />}
            {route.name === 'system' && <SystemView id={route.id} />}
            {route.name === 'emulators' && <EmulatorsView />}
            {route.name === 'stats' && <StatsView />}
            {route.name === 'year' && <YearView year={route.year} />}
            {route.name === 'news' && <NewsView />}
            {route.name === 'wishlist' && <WishlistView />}
            {route.name === 'friends' && <FriendsView />}
            {route.name === 'shop' && <ShopView gid={route.gid} />}
          </div>
        </div>
      </main>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <Picker />
      <SettingsPanel />
      <GameMenu />
      <ScanDialog />
      <AddGameDialog />
      <MatchDialog />
      <div className={`toast ${toast ? 'is-on' : ''}`} role="status" aria-live="polite">{toast}</div>
      <BigPicture />
      <Welcome />
      <ErrorReport />
      <StudioDock />
      <ShareHost />
      <Splash />
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
