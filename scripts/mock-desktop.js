// Dev helper: pretends to be the Tauri backend so desktop-only screens can be
// rendered in a plain browser for screenshots (node scripts/shot.mjs with PRELOAD).
(() => {
  const now = Math.floor(Date.now() / 1000);
  const B = 'https://raw.githubusercontent.com/libretro-thumbnails/Nintendo_-_Game_Boy_Advance/master/';
  const rom = (crc, name, title, file, extra = {}) => ({
    id: `rom:gba:${crc}`, platform: 'gba', externalId: crc, title, installed: true, installDir: null, sizeBytes: 16777216,
    playtimeMin: 0, lastPlayed: null, user: null, addedAt: now - 86400,
    sessions: extra.sessions ?? [],
    meta: {
      name: title, short: extra.short ?? '', developers: extra.dev ?? [], publishers: [], genres: [], release: extra.release ?? null,
      cover: `${B}Named_Boxarts/${encodeURIComponent(name)}.png`, hero: `${B}Named_Snaps/${encodeURIComponent(name)}.png`,
      screenshots: [`${B}Named_Titles/${encodeURIComponent(name)}.png`, `${B}Named_Snaps/${encodeURIComponent(name)}.png`],
      romPath: `C:\\Oyunlar\\GBA\\${file}`, romFolder: 1, system: 'gba',
      rom: { file, folder: 'C:\\Oyunlar\\GBA', sizeBytes: 16777216, region: extra.region ?? null, match: extra.crc ? { db: 'No-Intro', crc: extra.crc } : null, dbName: extra.crc ? name : null },
    },
  });
  const games = [
    rom('dd88761c', 'Pokemon - FireRed Version (USA, Europe)', 'Pokemon: FireRed Version', 'Pokemon - FireRed Version (USA).gba',
      { crc: 'DD88761C', region: 'USA, Europe', dev: ['Game Freak'], release: 1075334400, short: 'Pokémon FireRed Version ve Pokémon LeafGreen Version, 1996 yapımı Pokémon Red ve Blue’nun 2004 yılında Game Boy Advance için yapılan yeniden yapımlarıdır.', sessions: [{ start: now - 5 * 86400, minutes: 64 }, { start: now - 2 * 86400, minutes: 38 }] }),
    rom('4b3d4957', 'Pokemon Unbound', 'Pokemon Unbound', 'Pokemon Unbound.gba', { sessions: [{ start: now - 86400, minutes: 112 }] }),
  ];
  const data = {
    list_games: games,
    list_accounts: [{ platform: 'battlenet', externalId: 'local', displayName: null, method: 'scan', connectedAt: now, lastSync: now, hasKey: false, gameCount: 1 }],
    tracking_state: { all: true, live: [] },
    retro_systems: [{ id: 'gba', name: 'Nintendo - Game Boy Advance', exts: ['gba'], cartridge: true }, { id: 'ps1', name: 'Sony - PlayStation', exts: ['cue'], cartridge: false }],
    list_emulators: [{ id: 'mgba', kind: 'mgba', name: 'mGBA', path: 'C:\\Emulatorler\\mGBA\\mGBA.exe', args: '"{rom}"', systems: ['gba', 'gb', 'gbc'], icon: 'data:image/png;base64,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' }],
    detect_emulators: [{ kind: 'retroarch', name: 'RetroArch', path: 'C:\\RetroArch-Win64\\retroarch.exe', systems: ['gba', 'nes', 'snes', 'ps1'], icon: null }],
    list_rom_folders: [],
    save_sync_settings: { cloudDir: null, suggested: null, drive: { configured: false, email: null, error: null }, games: [
      { gameId: 'rom:gba:4b3d4957', title: 'Pokemon Unbound', system: 'gba', latest: now - 3600, machine: 'OYUN-PC', count: 4 },
      { gameId: 'rom:gba:1f1c08fb', title: 'Pokemon: Emerald Version', system: 'gba', latest: now - 9 * 86400, machine: 'LAPTOP', count: 2 },
    ] },
    save_info: {
      local: [{ name: 'Pokemon Unbound.sav', ext: 'sav', size: 131088, modified: now - 3600 }, { name: 'Pokemon Unbound.ss1', ext: 'ss1', size: 412000, modified: now - 3700 }],
      cloud: 'C:\\Users\\Oyuncu\\OneDrive\\Tessera',
      snapshots: [
        { id: 'a', gameId: 'rom:gba:4b3d4957', title: 'Pokemon Unbound', system: 'gba', created: now - 3600, machine: 'OYUN-PC', reason: 'Oturum sonu', hash: '1', files: [{ ext: 'sav', size: 1 }, { ext: 'ss1', size: 1 }], local: true, cloud: true },
        { id: 'b', gameId: 'rom:gba:4b3d4957', title: 'Pokemon Unbound', system: 'gba', created: now - 2 * 86400, machine: 'LAPTOP', reason: 'Oturum sonu', hash: '2', files: [{ ext: 'sav', size: 1 }], local: false, cloud: true },
      ],
    },
    rom_details: false,
    ra_status: 'retro_oyuncu',
    sgdb_status: false,
  };
  window.__TAURI_INTERNALS__ = {
    invoke: async (cmd) => (cmd in data ? structuredClone(data[cmd]) : cmd.startsWith('plugin:') ? 1 : null),
    transformCallback: () => 1,
    unregisterCallback: () => {},
    convertFileSrc: (s) => s,
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
  };
  try { localStorage.setItem('tessera.prefs', JSON.stringify({ startupAnim: false })); } catch { /* ignore */ }
})();
