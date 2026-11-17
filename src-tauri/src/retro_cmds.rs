//! Commands for emulators, ROM folders and saves.

use crate::{db, gdrive, meta, retro, saves, AppState};
use rusqlite::params;
use serde::Serialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tauri::State;

type Res<T> = Result<T, String>;
fn e<E: std::fmt::Display>(err: E) -> String {
    err.to_string()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    id: &'static str,
    name: &'static str,
    exts: Vec<&'static str>,
    cartridge: bool,
}

#[tauri::command]
pub fn retro_systems() -> Vec<SystemInfo> {
    retro::SYSTEMS.iter().map(|s| SystemInfo { id: s.id, name: s.name, exts: s.exts.to_vec(), cartridge: s.cartridge }).collect()
}

#[tauri::command]
pub async fn list_emulators(st: State<'_, AppState>) -> Res<Vec<retro::Emulator>> {
    let mut list = retro::emulators(&st.db.lock().unwrap());
    let dir = st.dir.clone();
    let paths: Vec<String> = list.iter().map(|e| e.path.clone()).collect();
    let icons = tauri::async_runtime::spawn_blocking(move || paths.iter().map(|p| crate::icons::exe_icon(&dir, Path::new(p))).collect::<Vec<_>>())
        .await
        .map_err(e)?;
    for (emu, icon) in list.iter_mut().zip(icons) {
        emu.icon = icon;
    }
    Ok(list)
}

/// opens the emulator itself, with no game
#[tauri::command]
pub fn open_emulator(st: State<AppState>, id: String) -> Res<()> {
    let emu = retro::emulators(&st.db.lock().unwrap()).into_iter().find(|x| x.id == id).ok_or(crate::l("Emülatör bulunamadı.", "Emulator not found."))?;
    let exe = PathBuf::from(&emu.path);
    let mut cmd = std::process::Command::new(&exe);
    if let Some(dir) = exe.parent() {
        cmd.current_dir(dir);
    }
    cmd.spawn().map_err(|err| crate::tr!("{} açılamadı: {err}", "Could not start {}: {err}", emu.name))?;
    Ok(())
}

/// emulators found on this PC that are not added yet
#[tauri::command]
pub async fn detect_emulators(st: State<'_, AppState>) -> Res<Vec<retro::FoundEmu>> {
    let dir = st.dir.clone();
    let found = tauri::async_runtime::spawn_blocking(move || {
        let mut f = retro::detect();
        for x in &mut f {
            x.icon = crate::icons::exe_icon(&dir, Path::new(&x.path));
        }
        f
    })
    .await
    .map_err(e)?;
    let have: Vec<String> = retro::emulators(&st.db.lock().unwrap()).into_iter().map(|e| e.path.to_lowercase()).collect();
    Ok(found.into_iter().filter(|f| !have.contains(&f.path.to_lowercase())).collect())
}

#[tauri::command]
pub fn add_emulator(st: State<AppState>, path: String) -> Res<retro::Emulator> {
    retro::add_emulator(&st.db.lock().unwrap(), Path::new(&path))
}

#[tauri::command]
pub fn remove_emulator(st: State<AppState>, id: String) -> Res<()> {
    let c = st.db.lock().unwrap();
    c.execute("DELETE FROM emulators WHERE id = ?1", params![id]).map_err(e)?;
    c.execute("UPDATE rom_folders SET emulator_id = NULL WHERE emulator_id = ?1", params![id]).map_err(e)?;
    Ok(())
}

#[tauri::command]
pub fn set_emulator_args(st: State<AppState>, id: String, args: String) -> Res<()> {
    let args = if args.trim().is_empty() { retro::emu_kind(&id).map(|k| k.args.to_string()).unwrap_or_default() } else { args };
    st.db.lock().unwrap().execute("UPDATE emulators SET args = ?1 WHERE id = ?2", params![args, id]).map_err(e)?;
    Ok(())
}

#[tauri::command]
pub fn list_rom_folders(st: State<AppState>) -> Vec<retro::RomFolder> {
    retro::folders(&st.db.lock().unwrap())
}

#[tauri::command]
pub fn set_folder_emulator(st: State<AppState>, id: i64, emulator_id: Option<String>) -> Res<()> {
    st.db.lock().unwrap().execute("UPDATE rom_folders SET emulator_id = ?1 WHERE id = ?2", params![emulator_id, id]).map_err(e)?;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    total: usize,
    added: usize,
    matched: usize,
    restored: usize,
}

/// reads a folder, identifies every ROM and writes it to the library
async fn scan_folder(st: &AppState, folder_id: i64) -> Res<ScanResult> {
    let f = retro::folder(&st.db.lock().unwrap(), folder_id).ok_or(crate::l("Klasör bulunamadı.", "Folder not found."))?;
    let sys = retro::system(&f.system).ok_or("Bilinmeyen sistem.")?;
    let path = PathBuf::from(&f.path);
    let roms = tauri::async_runtime::spawn_blocking(move || retro::find_roms(&path, sys)).await.map_err(e)?;
    let dat = retro::dat(&st.http, &st.dir.join("dats"), sys).await;

    // everything that needs the database happens in this block, before any waiting
    let (added, matched, mut restored, new_ids) = {
    let c = st.db.lock().unwrap();
    let cloud = saves::cloud_dir(&c);
    let ctx = saves::Ctx { data: &st.dir, cloud };
    let (mut added, mut matched, mut restored) = (0, 0, 0);
    let mut present = vec![];
    let mut new_ids = vec![];
    for rom in &roms {
        let id = retro::rom_id(sys, rom);
        let (title, mut m) = retro::rom_meta(sys, rom, dat.as_ref(), folder_id);
        if !m["rom"]["match"].is_null() {
            matched += 1;
        }
        // keep what was looked up later (Wikipedia text) and a name the user chose
        let old = db::game_launch(&c, &id).ok().flatten().map(|x| x.3).unwrap_or(Value::Null);
        for k in ["short", "aboutHtml", "developers", "publishers", "genres", "release", "wikiTitle", "detailsTried", "steamAppId"] {
            if !old[k].is_null() && old[k] != json!("") {
                m[k] = old[k].clone();
            }
        }
        let row = db::SyncedGame {
            id: &id,
            platform: sys.id,
            external_id: id.rsplit(':').next().unwrap_or_default(),
            title: &title,
            installed: true,
            install_dir: None,
            size_bytes: Some(rom.size),
            playtime_min: 0,
            last_played: None,
            meta: &m,
        };
        if db::upsert_synced(&c, &row).map_err(e)? {
            added += 1;
            new_ids.push(id.clone());
            if saves::restore_if_missing(&ctx, &id, &title, &m) {
                restored += 1;
            }
        }
        present.push(id);
    }
    // ROMs that left the folder stay in the library (with your notes) but are no longer installed
    let mut stmt = c.prepare("SELECT id, meta_json FROM games WHERE platform = ?1 AND installed = 1").map_err(e)?;
    let gone: Vec<String> = stmt
        .query_map(params![sys.id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?)))
        .map_err(e)?
        .flatten()
        .filter(|(id, m)| !present.contains(id) && m.as_deref().is_some_and(|m| m.contains(&format!("\"romFolder\":{folder_id},"))))
        .map(|(id, _)| id)
        .collect();
    for id in gone {
        let _ = c.execute("UPDATE games SET installed = 0 WHERE id = ?1", params![id]);
    }
    (added, matched, restored, new_ids)
    };
    restored += restore_new(st, &new_ids).await;
    Ok(ScanResult { total: roms.len(), added, matched, restored })
}

#[tauri::command]
pub async fn add_rom_folder(st: State<'_, AppState>, path: String, system: String, emulator_id: Option<String>) -> Res<ScanResult> {
    if retro::system(&system).is_none() {
        return Err("Bilinmeyen sistem.".into());
    }
    if !Path::new(&path).is_dir() {
        return Err(crate::l("Klasör bulunamadı.", "Folder not found.").into());
    }
    let id = {
        let c = st.db.lock().unwrap();
        let existing: Option<i64> = c
            .query_row("SELECT id FROM rom_folders WHERE lower(path) = lower(?1) AND system = ?2", params![path, system], |r| r.get(0))
            .ok();
        match existing {
            Some(id) => id,
            None => {
                c.execute("INSERT INTO rom_folders (path, system, emulator_id) VALUES (?1, ?2, ?3)", params![path, system, emulator_id]).map_err(e)?;
                c.last_insert_rowid()
            }
        }
    };
    scan_folder(&st, id).await
}

#[tauri::command]
pub async fn rescan_rom_folder(st: State<'_, AppState>, id: i64) -> Res<ScanResult> {
    scan_folder(&st, id).await
}

#[tauri::command]
pub fn remove_rom_folder(st: State<AppState>, id: i64, remove_games: bool) -> Res<()> {
    let c = st.db.lock().unwrap();
    if remove_games {
        c.execute(
            "DELETE FROM games WHERE meta_json LIKE ?1 OR meta_json LIKE ?2",
            params![format!("%\"romFolder\":{id},%"), format!("%\"romFolder\":{id}}}%")],
        )
        .map_err(e)?;
    }
    c.execute("DELETE FROM rom_folders WHERE id = ?1", params![id]).map_err(e)?;
    Ok(())
}

const SYSTEM_WORDS: &[(&str, &str)] = &[
    ("gba", "Game Boy Advance"), ("gb", "Game Boy"), ("gbc", "Game Boy Color"), ("nes", "NES"), ("snes", "Super NES"),
    ("n64", "Nintendo 64"), ("nds", "Nintendo DS"), ("genesis", "Mega Drive"), ("ps1", "PlayStation"), ("ps2", "PlayStation 2"),
    ("psp", "PlayStation Portable"), ("gc", "GameCube"),
];

/// lowercase words without accents or filler ("Pokémon FireRed Version" → pokemon, firered)
fn words(s: &str) -> Vec<String> {
    const FILLER: &[&str] = &["the", "and", "version", "edition", "game", "boy", "advance", "of"];
    let folded: String = s.to_lowercase().chars().map(|c| match c {
        'á' | 'à' | 'â' | 'ä' | 'ã' => 'a',
        'é' | 'è' | 'ê' | 'ë' => 'e',
        'í' | 'ì' | 'î' | 'ï' | 'ı' => 'i',
        'ó' | 'ò' | 'ô' | 'ö' | 'õ' => 'o',
        'ú' | 'ù' | 'û' | 'ü' => 'u',
        'ç' => 'c', 'ş' => 's', 'ğ' => 'g', 'ñ' => 'n',
        c => c,
    }).collect();
    folded.split(|c: char| !c.is_alphanumeric()).filter(|w| w.len() > 2 && !FILLER.contains(w)).map(str::to_string).collect()
}

/// fills in the story, developer and dates of a ROM from Wikipedia, once
#[tauri::command]
pub async fn rom_details(st: State<'_, AppState>, id: String) -> Res<bool> {
    details_for(&st, &id).await
}

async fn details_for(st: &AppState, id: &str) -> Res<bool> {
    let id = id.to_string();
    let (title, m) = {
        let c = st.db.lock().unwrap();
        let (_, _, _, m) = db::game_launch(&c, &id).map_err(e)?.ok_or(crate::l("Oyun bulunamadı.", "Game not found."))?;
        let t: String = c.query_row("SELECT title FROM games WHERE id = ?1", params![id], |r| r.get(0)).map_err(e)?;
        (t, m)
    };
    if m["detailsTried"].as_bool() == Some(true) || m["short"].as_str().is_some_and(|s| !s.is_empty()) {
        return Ok(false);
    }
    let sys = m["system"].as_str().unwrap_or_default();
    let sys_name = SYSTEM_WORDS.iter().find(|(k, _)| *k == sys).map(|(_, v)| *v).unwrap_or("");
    let (cands, complete) = meta::candidates_full(&st.http, &format!("{title} {sys_name}")).await;
    let want = words(&title);
    let pick = cands.into_iter().filter(|c| c.source == "wiki").find(|c| {
        let have = words(&c.title);
        let hits = want.iter().filter(|w| have.contains(w)).count();
        !want.is_empty() && hits * 10 >= want.len() * 6
    });
    let mut next = m.clone();
    if let Some(c) = pick {
        if let Some(w) = meta::wiki_meta(&st.http, &c.id).await {
            for k in ["short", "aboutHtml", "developers", "publishers", "genres", "release", "wikiTitle"] {
                next[k] = w[k].clone();
            }
            // ROM art stays (box, snap, title screen); Wikipedia's cover only fills a gap
            if next["cover"].is_null() {
                next["cover"] = w["cover"].clone();
            }
        }
    } else if !complete {
        return Ok(false);
    }
    next["detailsTried"] = json!(true);
    db::set_meta(&st.db.lock().unwrap(), &id, None, &next).map_err(e)?;
    Ok(true)
}

// ---------------------------------------------------------------- launching

/// starts a ROM with its emulator; returns the emulator's folder for the tracker
pub fn launch_rom(st: &AppState, meta: &Value) -> Res<PathBuf> {
    let rom = meta["romPath"].as_str().ok_or(crate::l("ROM yolu yok.", "No ROM path."))?;
    if !Path::new(rom).exists() {
        return Err(crate::l("ROM dosyası bulunamadı. Klasörü yeniden tara.", "ROM file not found. Scan the folder again.").into());
    }
    let sys = meta["system"].as_str().unwrap_or_default();
    let folder = meta["romFolder"].as_i64().unwrap_or(-1);
    let emu = retro::emulator_for(&st.db.lock().unwrap(), folder, sys).ok_or(crate::l("Bu sistem için emülatör yok. Emülatörler sayfasından ekle.", "No emulator for this system. Add one on the Emulators page."))?;
    let core = retro::system(sys).map(|s| s.retroarch_core).unwrap_or("");
    let args: Vec<String> = retro::split_args(&emu.args).into_iter().map(|a| a.replace("{rom}", rom).replace("{core}", core)).collect();
    let exe = PathBuf::from(&emu.path);
    let dir = exe.parent().map(Path::to_path_buf).ok_or(crate::l("Emülatör klasörü bulunamadı.", "Emulator folder not found."))?;
    std::process::Command::new(&exe).args(&args).current_dir(&dir).spawn().map_err(|err| crate::tr!("{} açılamadı: {err}", "Could not start {}: {err}", emu.name))?;
    Ok(dir)
}

// ---------------------------------------------------------------- saves
// Two clouds, either or both: Google Drive (Tessera's hidden app folder) and a
// synced folder the user picks (Dropbox, Syncthing, a Drive/OneDrive folder…).

fn ctx_parts(st: &AppState) -> Option<PathBuf> {
    saves::cloud_dir(&st.db.lock().unwrap())
}

fn drive_on(st: &AppState) -> bool {
    gdrive::client(&st.dir).is_some() && gdrive::connected(st).is_some()
}

fn game(st: &AppState, id: &str) -> Res<(String, Value)> {
    let c = st.db.lock().unwrap();
    let (_, _, _, m) = db::game_launch(&c, id).map_err(e)?.ok_or(crate::l("Oyun bulunamadı.", "Game not found."))?;
    let t: String = c.query_row("SELECT title FROM games WHERE id = ?1", params![id], |r| r.get(0)).map_err(e)?;
    Ok((t, m))
}

fn local_snap_dir(st: &AppState, id: &str, snap: &str) -> PathBuf {
    st.dir.join("saves").join(saves::key(id)).join(snap)
}

/// a Drive snapshot that only exists in the cloud is fetched before use
async fn ensure_local(st: &AppState, id: &str, snap: &str) -> Res<()> {
    if local_snap_dir(st, id, snap).join("manifest.json").exists() || !drive_on(st) {
        return Ok(());
    }
    let remote = gdrive::list(st, Some(&saves::key(id))).await?;
    let r = remote.iter().find(|r| r.snap == snap).ok_or(crate::l("Kayıt bulunamadı.", "Save not found."))?;
    gdrive::download(st, &r.file_id, &local_snap_dir(st, id, snap)).await
}

/// a game with no save on this PC takes the newest one from any cloud
async fn restore_if_missing_any(st: &AppState, id: &str, title: &str, m: &Value) -> bool {
    if !saves::local_files(m).is_empty() {
        return false;
    }
    let ctx = saves::Ctx { data: &st.dir, cloud: ctx_parts(st) };
    if saves::restore_if_missing(&ctx, id, title, m) {
        return true;
    }
    if !drive_on(st) {
        return false;
    }
    let Ok(remote) = gdrive::list(st, Some(&saves::key(id))).await else { return false };
    let Some(r) = remote.first() else { return false };
    if gdrive::download(st, &r.file_id, &local_snap_dir(st, id, &r.snap)).await.is_err() {
        return false;
    }
    saves::restore(&ctx, id, title, m, &r.snap).is_ok()
}

#[tauri::command]
pub async fn save_info(st: State<'_, AppState>, id: String) -> Res<Value> {
    let (_, m) = game(&st, &id)?;
    let ctx = saves::Ctx { data: &st.dir, cloud: ctx_parts(&st) };
    let mut snaps = saves::list(&ctx, &id);
    let mut drive_error = Value::Null;
    if drive_on(&st) {
        match gdrive::list(&st, Some(&saves::key(&id))).await {
            Ok(remote) => {
                for r in remote {
                    match snaps.iter_mut().find(|s| s.manifest.hash == r.manifest.hash) {
                        Some(s) => s.cloud = true,
                        None => snaps.push(saves::Snapshot { id: r.snap, manifest: r.manifest, local: false, cloud: true }),
                    }
                }
                snaps.sort_by(|a, b| b.manifest.created.cmp(&a.manifest.created));
            }
            Err(err) => drive_error = json!(err),
        }
    }
    let cloud = if drive_on(&st) { Some("Google Drive".to_string()) } else { ctx.cloud.as_ref().map(|c| c.to_string_lossy().to_string()) };
    Ok(json!({ "local": saves::describe_local(&m), "snapshots": snaps, "cloud": cloud, "driveError": drive_error }))
}

#[tauri::command]
pub async fn save_backup(st: State<'_, AppState>, id: String) -> Res<bool> {
    let (t, m) = game(&st, &id)?;
    let made = {
        let ctx = saves::Ctx { data: &st.dir, cloud: ctx_parts(&st) };
        saves::snapshot(&ctx, &id, &t, &m, "Elle yedek")?.is_some()
    };
    let sent = if drive_on(&st) { gdrive::push_game(&st, &id).await? } else { 0 };
    Ok(made || sent > 0)
}

#[tauri::command]
pub async fn save_restore(st: State<'_, AppState>, id: String, snapshot: String) -> Res<()> {
    let (t, m) = game(&st, &id)?;
    ensure_local(&st, &id, &snapshot).await?;
    let ctx = saves::Ctx { data: &st.dir, cloud: ctx_parts(&st) };
    saves::restore(&ctx, &id, &t, &m, &snapshot)?;
    // the copy of what was there before goes up too
    if drive_on(&st) {
        let _ = gdrive::push_game(&st, &id).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn save_delete(st: State<'_, AppState>, id: String, snapshot: String) -> Res<()> {
    let hash = std::fs::read_to_string(local_snap_dir(&st, &id, &snapshot).join("manifest.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<saves::Manifest>(&s).ok())
        .map(|m| m.hash);
    let ctx = saves::Ctx { data: &st.dir, cloud: ctx_parts(&st) };
    saves::delete(&ctx, &id, &snapshot);
    if drive_on(&st) {
        for r in gdrive::list(&st, Some(&saves::key(&id))).await? {
            if r.snap == snapshot || Some(&r.manifest.hash) == hash.as_ref() {
                gdrive::delete(&st, &r.file_id).await?;
            }
        }
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveState {
    /// this build knows its Google client (the one-time setup is done)
    configured: bool,
    email: Option<String>,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncSettings {
    cloud_dir: Option<String>,
    suggested: Option<String>,
    drive: DriveState,
    games: Vec<saves::CloudGame>,
}

#[tauri::command]
pub async fn save_sync_settings(st: State<'_, AppState>) -> Res<SyncSettings> {
    let (dir, mut games) = {
        let c = st.db.lock().unwrap();
        let dir = saves::cloud_dir(&c);
        let games = dir.as_deref().map(saves::cloud_overview).unwrap_or_default();
        (dir, games)
    };
    let email = gdrive::connected(&st);
    let mut error = None;
    if drive_on(&st) {
        match gdrive::list(&st, None).await {
            Ok(remote) => {
                let mut by_game: std::collections::BTreeMap<String, Vec<gdrive::Remote>> = Default::default();
                for r in remote {
                    by_game.entry(r.manifest.game_id.clone()).or_default().push(r);
                }
                for (gid, rs) in by_game {
                    let newest = &rs[0].manifest;
                    match games.iter_mut().find(|g| g.game_id == gid) {
                        Some(g) if g.latest >= newest.created => {}
                        Some(g) => { g.latest = newest.created; g.machine = newest.machine.clone(); g.count = g.count.max(rs.len()); }
                        None => games.push(saves::CloudGame { game_id: gid, title: newest.title.clone(), system: newest.system.clone(), latest: newest.created, machine: newest.machine.clone(), count: rs.len() }),
                    }
                }
                games.sort_by(|a, b| b.latest.cmp(&a.latest));
            }
            Err(err) => error = Some(err),
        }
    }
    Ok(SyncSettings {
        cloud_dir: dir.map(|d| d.to_string_lossy().to_string()),
        suggested: saves::suggested_cloud(),
        drive: DriveState { configured: gdrive::client(&st.dir).is_some(), email, error },
        games,
    })
}

fn rom_games(st: &AppState) -> Res<Vec<(String, String, Value)>> {
    let c = st.db.lock().unwrap();
    let mut stmt = c.prepare("SELECT id, title, meta_json FROM games WHERE meta_json LIKE '%\"romPath\"%'").map_err(e)?;
    let rows: Vec<(String, String, Option<String>)> = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).map_err(e)?.flatten().collect();
    Ok(rows.into_iter().map(|(id, t, m)| (id, t, m.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null))).collect())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    sent: usize,
    received: usize,
}

/// both directions for every ROM: this PC's saves go up, missing ones come down
async fn sync_all(st: &AppState, reason: &str) -> Res<SyncReport> {
    let (mut sent, mut received) = (0, 0);
    for (id, title, m) in rom_games(st)? {
        {
            let ctx = saves::Ctx { data: &st.dir, cloud: ctx_parts(st) };
            if saves::snapshot(&ctx, &id, &title, &m, reason)?.is_some() && !drive_on(st) {
                sent += 1;
            }
        }
        if drive_on(st) {
            sent += gdrive::push_game(st, &id).await?;
        }
        if restore_if_missing_any(st, &id, &title, &m).await {
            received += 1;
        }
    }
    Ok(SyncReport { sent, received })
}

/// picks (or clears) the sync folder, then syncs every game's saves with it
#[tauri::command]
pub async fn set_save_cloud(st: State<'_, AppState>, dir: Option<String>) -> Res<SyncReport> {
    {
        let c = st.db.lock().unwrap();
        match &dir {
            Some(d) => {
                std::fs::create_dir_all(d).map_err(|err| crate::tr!("Klasör oluşturulamadı: {err}", "Could not create the folder: {err}"))?;
                db::set_setting(&c, "saveCloudDir", &json!(d)).map_err(e)?;
            }
            None => db::set_setting(&c, "saveCloudDir", &Value::Null).map_err(e)?,
        }
    }
    if dir.is_none() {
        return Ok(SyncReport { sent: 0, received: 0 });
    }
    sync_all(&st, crate::l("Senkron açıldı", "Sync turned on")).await
}

#[tauri::command]
pub fn drive_install_client(st: State<AppState>, path: String) -> Res<()> {
    gdrive::install_client(&st.dir, Path::new(&path))
}

/// Google sign-in in the browser, then a first full sync
#[tauri::command]
pub async fn drive_connect(st: State<'_, AppState>) -> Res<SyncReport> {
    gdrive::connect(&st).await?;
    sync_all(&st, crate::l("Google Drive bağlandı", "Google Drive connected")).await
}

#[tauri::command]
pub fn drive_disconnect(st: State<AppState>) -> Res<()> {
    gdrive::disconnect(&st)
}

#[tauri::command]
pub async fn sync_saves_now(st: State<'_, AppState>) -> Res<SyncReport> {
    sync_all(&st, "Elle senkron").await
}

/// after a session: keep a copy of the saves, here and in the cloud
pub fn after_session(st: &AppState, id: &str) {
    if !id.starts_with("rom:") {
        return;
    }
    if let Ok((t, m)) = game(st, id) {
        let ctx = saves::Ctx { data: &st.dir, cloud: ctx_parts(st) };
        let _ = saves::snapshot(&ctx, id, &t, &m, "Oturum sonu");
        if drive_on(st) {
            // runs on the tracker's own thread, so waiting here blocks nothing else
            let _ = tauri::async_runtime::block_on(gdrive::push_game(st, id));
        }
    }
}

/// before starting: a fresh PC with no save takes the newest one from the cloud
pub async fn before_launch(st: &AppState, id: &str, m: &Value) -> bool {
    let Ok((t, _)) = game(st, id) else { return false };
    restore_if_missing_any(st, id, &t, m).await
}

/// after a scan: new ROMs pick up their cloud saves
pub async fn restore_new(st: &AppState, ids: &[String]) -> usize {
    let mut n = 0;
    for id in ids {
        if let Ok((t, m)) = game(st, id) {
            if restore_if_missing_any(st, id, &t, &m).await {
                n += 1;
            }
        }
    }
    n
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    fn state(dir: &Path) -> AppState {
        std::fs::create_dir_all(dir).unwrap();
        let conn = db::open(&dir.join("t.db")).unwrap();
        crate::tracker::schema(&conn).unwrap();
        retro::schema(&conn).unwrap();
        AppState {
            db: Mutex::new(conn),
            http: reqwest::Client::builder().user_agent("Tessera/0.1 (game library)").build().unwrap(),
            tracker: crate::tracker::Tracker::new(true),
            dir: dir.to_path_buf(),
        }
    }

    fn add_folder(st: &AppState, path: &Path) -> i64 {
        let c = st.db.lock().unwrap();
        c.execute("INSERT INTO rom_folders (path, system, emulator_id) VALUES (?1, 'gba', NULL)", params![path.to_string_lossy()]).unwrap();
        c.last_insert_rowid()
    }

    /// two PCs and one cloud folder, using a copy of this PC's GBA ROMs
    #[test]
    #[ignore = "copies the GBA ROMs folder and calls the network"]
    fn two_pcs_one_cloud() {
        let base = std::env::temp_dir().join("tessera-retro-e2e");
        let _ = std::fs::remove_dir_all(&base);
        let src = PathBuf::from(std::env::var("USERPROFILE").unwrap()).join("Desktop").join("GBA ROMS");
        let (roms1, roms2, cloud) = (base.join("pc1-roms"), base.join("pc2-roms"), base.join("cloud"));
        std::fs::create_dir_all(&roms1).unwrap();
        std::fs::create_dir_all(&roms2).unwrap();
        for e in std::fs::read_dir(&src).unwrap().flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            std::fs::copy(e.path(), roms1.join(&name)).unwrap();
            // PC 2 has the ROMs but none of the saves
            if name.ends_with(".gba") {
                std::fs::copy(e.path(), roms2.join(&name)).unwrap();
            }
        }

        let pc1 = state(&base.join("pc1"));
        {
            let c = pc1.db.lock().unwrap();
            let mgba = PathBuf::from(std::env::var("USERPROFILE").unwrap()).join("Desktop").join("mGBA").join("mGBA.exe");
            if mgba.exists() {
                println!("emulator: {}", retro::add_emulator(&c, &mgba).unwrap().name);
            }
            db::set_setting(&c, "saveCloudDir", &json!(cloud.to_string_lossy())).unwrap();
        }
        std::fs::create_dir_all(&cloud).unwrap();
        let f1 = add_folder(&pc1, &roms1);
        let r = tauri::async_runtime::block_on(scan_folder(&pc1, f1)).unwrap();
        println!("pc1 scan: total {} matched {} added {} restored {}", r.total, r.matched, r.added, r.restored);
        let games: Vec<(String, String)> = {
            let c = pc1.db.lock().unwrap();
            let mut st = c.prepare("SELECT id, title FROM games").unwrap();
            st.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().flatten().collect()
        };
        for (id, t) in &games {
            println!("  {id} | {t}");
            after_session(&pc1, id);
        }
        println!("cloud games: {:?}", saves::cloud_overview(&cloud).iter().map(|g| g.title.clone()).collect::<Vec<_>>());
        let emu = retro::emulator_for(&pc1.db.lock().unwrap(), f1, "gba").map(|e| (e.name, retro::split_args(&e.args)));
        println!("would launch with: {emu:?}");

        // PC 2: same cloud folder, ROMs only
        let pc2 = state(&base.join("pc2"));
        db::set_setting(&pc2.db.lock().unwrap(), "saveCloudDir", &json!(cloud.to_string_lossy())).unwrap();
        let f2 = add_folder(&pc2, &roms2);
        let r2 = tauri::async_runtime::block_on(scan_folder(&pc2, f2)).unwrap();
        println!("pc2 scan: total {} restored {}", r2.total, r2.restored);
        let restored: Vec<String> = std::fs::read_dir(&roms2).unwrap().flatten().map(|e| e.file_name().to_string_lossy().to_string()).filter(|n| n.ends_with(".sav")).collect();
        println!("pc2 saves now: {restored:?}");
        assert!(!restored.is_empty(), "the save came down from the cloud");

        // the story for FireRed, from Wikipedia
        if let Some((id, _)) = games.iter().find(|(_, t)| t.contains("FireRed")) {
            let changed = tauri::async_runtime::block_on(async {
                let st = &pc1;
                let (title, m) = game(st, id).unwrap();
                let sys_name = "Game Boy Advance";
                let (cands, _) = meta::candidates_full(&st.http, &format!("{title} {sys_name}")).await;
                cands.into_iter().filter(|c| c.source == "wiki").map(|c| c.title).collect::<Vec<_>>()
                    .into_iter().zip(std::iter::repeat(m)).next()
            });
            println!("wiki first candidate: {:?}", changed.map(|c| c.0));
            assert!(tauri::async_runtime::block_on(details_for(&pc1, id)).unwrap());
            let (_, m) = game(&pc1, id).unwrap();
            println!("details: dev={} year={} short={}", m["developers"], m["release"], m["short"].as_str().unwrap_or("").chars().take(120).collect::<String>());
        }
        let _ = std::fs::remove_dir_all(&base);
    }
}
