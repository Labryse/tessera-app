mod db;
mod errors;
mod extras;
mod friends;
mod gdrive;
mod icons;
mod live;
mod meta;
mod news;
mod presence;
mod prices;
mod repair;
mod retro;
mod retro_cmds;
mod saves;
mod scan;
mod share;
mod shell;
mod shots;
mod steam;
mod themes;
mod track;
mod tracker;
mod update;
mod vdf;
mod wishlist;

use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};

pub(crate) struct AppState {
    db: Mutex<rusqlite::Connection>,
    http: reqwest::Client,
    tracker: tracker::Tracker,
    /// the app's data folder (database, save copies, downloaded game lists)
    dir: std::path::PathBuf,
}

// ---------------------------------------------------------------- language
// Messages the Rust side writes (errors, notifications) follow the language picked in
// the window; it is kept in the database so a start in the tray knows it too.
static ENGLISH: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
pub(crate) fn en() -> bool {
    ENGLISH.load(std::sync::atomic::Ordering::Relaxed)
}
/// one of two fixed texts, in the language in use
pub(crate) fn l(tr: &'static str, english: &'static str) -> &'static str {
    if en() { english } else { tr }
}
/// the language Steam answers in (store text, tags, achievements)
pub(crate) fn steam_lang() -> &'static str {
    l("turkish", "english")
}
/// tr!("Türkçe {x}", "English {x}") — a format! in the language in use
#[macro_export]
macro_rules! tr {
    ($tr:literal, $en:literal $(, $a:expr)* $(,)?) => {
        if $crate::en() { format!($en $(, $a)*) } else { format!($tr $(, $a)*) }
    };
}

#[tauri::command]
fn set_lang(st: State<AppState>, lang: String) -> Res<()> {
    ENGLISH.store(lang == "en", std::sync::atomic::Ordering::Relaxed);
    db::set_setting(&st.db.lock().unwrap(), "lang", &json!(lang)).map_err(e)
}

type Res<T> = Result<T, String>;
fn e<E: std::fmt::Display>(err: E) -> String {
    err.to_string()
}

// ---------------------------------------------------------------- secrets
// Keys the user pastes in are kept in Windows Credential Manager, never in the database.
const SERVICE: &str = "Tessera";
fn secret_get(name: &str) -> Option<String> {
    keyring::Entry::new(SERVICE, name).ok()?.get_password().ok()
}
fn secret_set(name: &str, value: Option<&str>) -> Res<()> {
    let entry = keyring::Entry::new(SERVICE, name).map_err(e)?;
    match value {
        Some(v) if !v.trim().is_empty() => entry.set_password(v.trim()).map_err(e),
        _ => match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(e(err)),
        },
    }
}
const STEAM_KEY: &str = "steam-webapi-key";

// ---------------------------------------------------------------- library
#[tauri::command]
fn list_games(st: State<AppState>) -> Res<Vec<db::GameRow>> {
    let c = st.db.lock().unwrap();
    let mut games = db::games(&c).map_err(e)?;
    let mut sessions = tracker::all_sessions(&c);
    for g in &mut games {
        if let Some(s) = sessions.remove(&g.id) {
            g.sessions = s;
        }
    }
    Ok(games)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TrackingState {
    all: bool,
    live: Vec<tracker::Live>,
}

#[tauri::command]
fn tracking_state(st: State<AppState>) -> TrackingState {
    TrackingState { all: st.tracker.all.load(std::sync::atomic::Ordering::Relaxed), live: st.tracker.live() }
}

/// true: count every game that runs; false: only games started from Tessera
#[tauri::command]
fn set_tracking_all(st: State<AppState>, all: bool) -> Res<()> {
    st.tracker.all.store(all, std::sync::atomic::Ordering::Relaxed);
    db::set_setting(&st.db.lock().unwrap(), "trackAll", &json!(all)).map_err(e)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AccountView {
    #[serde(flatten)]
    account: db::Account,
    has_key: bool,
    game_count: usize,
}

#[tauri::command]
fn list_accounts(st: State<AppState>) -> Res<Vec<AccountView>> {
    let c = st.db.lock().unwrap();
    let games = db::games(&c).map_err(e)?;
    Ok(db::accounts(&c)
        .map_err(e)?
        .into_iter()
        .map(|a| AccountView {
            has_key: a.platform == "steam" && secret_get(STEAM_KEY).is_some(),
            game_count: games.iter().filter(|g| g.platform == a.platform).count(),
            account: a,
        })
        .collect())
}

#[tauri::command]
fn set_user_data(st: State<AppState>, id: String, user: Value) -> Res<()> {
    db::set_user(&st.db.lock().unwrap(), &id, &user).map_err(e)
}

#[tauri::command]
fn disconnect(st: State<AppState>, platform: String, remove_games: bool) -> Res<()> {
    if platform == "steam" {
        secret_set(STEAM_KEY, None)?;
    }
    db::delete_account(&st.db.lock().unwrap(), &platform, remove_games).map_err(e)?;
    st.tracker.touch();
    Ok(())
}

#[tauri::command]
async fn launch_game(st: State<'_, AppState>, id: String) -> Res<String> {
    st.tracker.arm(&id);
    let (platform, ext, installed, meta) = db::game_launch(&st.db.lock().unwrap(), &id)
        .map_err(e)?
        .ok_or(crate::l("Oyun bulunamadı.", "Game not found."))?;
    if platform == "steam" {
        let uri = if installed { format!("steam://rungameid/{ext}") } else { format!("steam://install/{ext}") };
        open::that_detached(&uri).map_err(e)?;
        return Ok(if installed { "launched".into() } else { "install".into() });
    }
    // ROMs open in their emulator; a fresh PC first takes the newest cloud save
    if meta["romPath"].is_string() {
        let restored = retro_cmds::before_launch(&st, &id, &meta).await;
        let dir = retro_cmds::launch_rom(&st, &meta)?;
        let title: String = st.db.lock().unwrap().query_row("SELECT title FROM games WHERE id = ?1", [&id], |r| r.get(0)).map_err(e)?;
        st.tracker.watch_emulator(&dir, &id, &title);
        return Ok(if restored { "restored".into() } else { "launched".into() });
    }
    // games found by a scan carry their own launch target
    match meta["launch"].as_str() {
        Some(t) if t.starts_with("uri:") => open::that_detached(&t[4..]).map_err(e)?,
        Some(t) if t.starts_with("exe:") => {
            let exe = std::path::Path::new(&t[4..]);
            let mut cmd = std::process::Command::new(exe);
            if let Some(dir) = exe.parent() {
                cmd.current_dir(dir);
            }
            cmd.spawn().map_err(e)?;
        }
        _ => return Err(crate::l("Bu oyun için başlatma bilgisi yok.", "No launch info for this game.").into()),
    }
    Ok("launched".into())
}

#[tauri::command]
async fn steam_app_details(st: State<'_, AppState>, appid: u32) -> Res<Value> {
    let key = format!("steamdetails2:{appid}");
    if let Some(v) = db::cache_get(&st.db.lock().unwrap(), &key, 3 * 86400) {
        return Ok(v);
    }
    let v = steam::app_details(&st.http, appid).await?;
    let _ = db::cache_put(&st.db.lock().unwrap(), &key, &v);
    Ok(v)
}

/// what the launchers on this PC say is installed, plus desktop and Start-menu
/// shortcuts. Each shortcut gets a guess of which game it is (Steam/Wikipedia);
/// the ones with no guess are probably programs, and the UI leaves them unticked.
#[tauri::command]
async fn scan_installed(st: State<'_, AppState>) -> Res<Vec<scan::Found>> {
    let mut found = tauri::async_runtime::spawn_blocking(scan::all).await.map_err(e)?;
    let have: HashSet<String> = db::ids(&st.db.lock().unwrap()).map_err(e)?.into_iter().collect();
    let mut flipped = false;
    {
        let c = st.db.lock().unwrap();
        for f in &mut found {
            let id = format!("{}:{}", f.source, f.external_id);
            f.known = have.contains(&id);
            // already in the library but marked not installed: it is now
            if f.known && f.source != "local" {
                flipped |= db::mark_installed(&c, &id, f.install_dir.as_deref(), f.size_bytes).unwrap_or(false);
            }
        }
    }
    if flipped {
        st.tracker.touch();
    }
    // guesses known from earlier scans come along; the rest are asked for one
    // by one from the UI (scan_guess), so the list shows up right away
    {
        let c = st.db.lock().unwrap();
        for f in found.iter_mut().filter(|f| f.source == "local" && !f.known) {
            match db::cache_get(&c, &guess_key(&f.title), 5 * 86400) {
                Some(v) => f.guess = serde_json::from_value(v).ok().flatten(),
                None => f.pending = true,
            }
        }
    }
    found.sort_by(|a, b| {
        a.known
            .cmp(&b.known)
            .then(a.source.cmp(&b.source))
            .then(b.guess.is_some().cmp(&a.guess.is_some()))
            .then(a.title.to_lowercase().cmp(&b.title.to_lowercase()))
    });
    Ok(found)
}

/// what to search for a found game: its name, then the folders its exe sits in
fn found_names(f: &scan::Found) -> Vec<String> {
    meta::query_names(&f.title, f.launch.as_deref().and_then(|l| l.strip_prefix("exe:")))
}

/// which game a shortcut looks like (Steam/Wikipedia), remembered for a few days
#[tauri::command]
async fn scan_guess(st: State<'_, AppState>, item: scan::Found) -> Res<Option<meta::Candidate>> {
    let key = guess_key(&item.title);
    if let Some(v) = db::cache_get(&st.db.lock().unwrap(), &key, 5 * 86400) {
        return Ok(serde_json::from_value(v).ok().flatten());
    }
    match meta::auto_smart(&st.http, &found_names(&item), true).await {
        Some(g) => {
            let _ = db::cache_put(&st.db.lock().unwrap(), &key, &json!(g));
            Ok(g)
        }
        None => Ok(None), // sources busy: not remembered, asked again next scan
    }
}

fn guess_key(title: &str) -> String {
    format!("guess2:{}", meta::norm(&meta::clean_name(title)))
}

/// store or Wikipedia data for a found game, keeping how to launch it
async fn meta_for_found(st: &AppState, f: &scan::Found, auto: bool) -> Value {
    let cand = if f.source == "steam" {
        Some(meta::Candidate { source: "steam".into(), id: f.external_id.clone(), title: f.title.clone(), subtitle: None, image: None })
    } else if f.guess.is_some() {
        f.guess.clone()
    } else if auto {
        // the user chose this one, so a looser match (a telling word like "Skyrim") is fine
        meta::auto_smart(&st.http, &found_names(f), true).await.flatten()
    } else {
        None
    };
    let mut m = match &cand {
        Some(c) => meta::meta_for(&st.http, c).await.unwrap_or_else(|| json!({})),
        None => json!({}),
    };
    if let (Some(obj), Some(l)) = (m.as_object_mut(), &f.launch) {
        obj.insert("launch".into(), Value::String(l.clone()));
    }
    m
}

/// returns (id, was it new)
fn save_found(c: &rusqlite::Connection, f: &scan::Found, m: &Value) -> Res<(String, bool)> {
    let gid = format!("{}:{}", f.source, f.external_id);
    // a matched game takes its real name ("Need for Speed: Most Wanted", not "nfsmw")
    let title = m["name"].as_str().filter(|n| !n.is_empty() && f.source != "steam").unwrap_or(&f.title).to_string();
    let row = db::SyncedGame {
        id: &gid,
        platform: &f.source,
        external_id: &f.external_id,
        title: &title,
        installed: true,
        install_dir: f.install_dir.as_deref(),
        size_bytes: f.size_bytes,
        playtime_min: 0,
        last_played: None,
        meta: m,
    };
    let new = db::upsert_synced(c, &row).map_err(e)?;
    Ok((gid, new))
}

// ---------------------------------------------------------------- stores without sign-in
// Xbox, Epic, GOG, EA, Ubisoft and Battle.net are "connected" by reading what
// their launchers installed on this PC; each game page then fills in by name.

const SCAN_STORES: &[&str] = &["xbox", "epic", "gog", "ea", "ubisoft", "battlenet"];

/// brings one store's installed games into the library: new ones are added
/// (with store/Wikipedia data found by name), known ones only get their install state
async fn store_pass(st: &AppState, platform: &str, found: Vec<scan::Found>) -> Res<SyncReport> {
    let mut fresh = vec![];
    let mut keep = vec![];
    {
        let c = st.db.lock().unwrap();
        let mut q = c.prepare("SELECT id, platform, install_dir FROM games").map_err(e)?;
        let rows: Vec<(String, String, Option<String>)> =
            q.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).map_err(e)?.flatten().collect();
        for f in found {
            let gid = format!("{}:{}", f.source, f.external_id);
            if rows.iter().any(|(id, _, _)| *id == gid) {
                c.execute(
                    "UPDATE games SET installed = 1, install_dir = ?2, size_bytes = COALESCE(?3, size_bytes) WHERE id = ?1",
                    rusqlite::params![gid, f.install_dir, f.size_bytes],
                )
                .map_err(e)?;
                keep.push(gid);
                continue;
            }
            // already in the library some other way (a shortcut, an exe added by hand)
            let dir = f.install_dir.as_deref().unwrap_or("").to_lowercase();
            let dup = !dir.is_empty()
                && rows.iter().any(|(_, p, d)| p != platform && d.as_deref().is_some_and(|d| d.to_lowercase().starts_with(&dir)));
            if !dup {
                fresh.push(f);
            }
        }
    }
    let total = keep.len() + fresh.len();
    let mut added = 0;
    for f in &fresh {
        let m = meta_for_found(st, f, true).await;
        let c = st.db.lock().unwrap();
        if save_found(&c, f, &m)?.1 {
            added += 1;
        }
        keep.push(format!("{}:{}", f.source, f.external_id));
    }
    let c = st.db.lock().unwrap();
    db::mark_uninstalled_except(&c, platform, &keep).map_err(e)?;
    if db::account(&c, platform).map_err(e)?.is_none() {
        db::save_account(
            &c,
            &db::Account {
                platform: platform.into(),
                external_id: "local".into(),
                display_name: None,
                method: "scan".into(),
                connected_at: db::now(),
                last_sync: None,
            },
        )
        .map_err(e)?;
    }
    db::touch_sync(&c, platform).map_err(e)?;
    st.tracker.touch();
    Ok(SyncReport { total, added, installed: total, used_key: false, local_data: true, warning: None })
}

/// games added without store data (shortcuts, exes, launcher games whose lookup
/// failed) get another try by name in the background, a few at a time
#[tauri::command]
async fn fill_missing(st: State<'_, AppState>) -> Res<usize> {
    fill_missing_in(&st).await
}

async fn fill_missing_in(st: &AppState) -> Res<usize> {
    let todo: Vec<(String, String, Value)> = {
        let c = st.db.lock().unwrap();
        let mut q = c.prepare("SELECT id, title, meta_json FROM games WHERE platform NOT IN ('steam') AND id NOT LIKE 'rom:%'").map_err(e)?;
        let rows: Vec<(String, String, Option<String>)> = q.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).map_err(e)?.flatten().collect();
        rows.into_iter()
            .map(|(id, t, m)| (id, t, m.and_then(|m| serde_json::from_str::<Value>(&m).ok()).unwrap_or(json!({}))))
            .filter(|(id, _, m)| {
                m["name"].as_str().is_none_or(str::is_empty)
                    && m["romPath"].is_null()
                    && m["noMatch"].as_bool() != Some(true)
                    && db::cache_get(&c, &format!("fill:{id}"), 3 * 86400).is_none()
            })
            .take(12)
            .collect()
    };
    let mut filled = 0;
    for (id, title, old) in todo {
        let names = meta::query_names(&title, old["launch"].as_str().and_then(|l| l.strip_prefix("exe:")));
        let Some(found) = meta::auto_smart(&st.http, &names, true).await else { continue }; // sources busy: next start
        let m = match &found {
            Some(c) => meta::meta_for(&st.http, c).await,
            None => None,
        };
        let c = st.db.lock().unwrap();
        let Some(mut m) = m else {
            let _ = db::cache_put(&c, &format!("fill:{id}"), &json!(true));
            continue;
        };
        if let (Some(obj), Some(l)) = (m.as_object_mut(), old["launch"].as_str()) {
            obj.insert("launch".into(), Value::String(l.into()));
        }
        let name = m["name"].as_str().map(str::to_string);
        db::set_meta(&c, &id, name.as_deref(), &m).map_err(e)?;
        filled += 1;
    }
    Ok(filled)
}

/// what the library's filters need and the first import did not bring: store
/// tags, features and user score (fast, 60 games a request), then Metacritic and
/// genres (one game a request, paced). Returns how many games changed; 0 = done.
#[tauri::command]
async fn enrich_library(st: State<'_, AppState>) -> Res<usize> {
    enrich_in(&st).await
}

async fn enrich_in(st: &AppState) -> Res<usize> {
    let rows: Vec<(String, u32, Value)> = {
        let c = st.db.lock().unwrap();
        let mut q = c.prepare("SELECT id, platform, external_id, meta_json FROM games WHERE id NOT LIKE 'rom:%'").map_err(e)?;
        let rows: Vec<(String, String, Option<String>, Option<String>)> =
            q.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).map_err(e)?.flatten().collect();
        rows.into_iter()
            .filter_map(|(id, platform, ext, m)| {
                let m = m.and_then(|m| serde_json::from_str::<Value>(&m).ok()).unwrap_or(json!({}));
                let appid = if platform == "steam" { ext.and_then(|x| x.parse().ok()) } else { m["steamAppId"].as_u64().map(|n| n as u32) };
                Some((id, appid?, m))
            })
            .collect()
    };
    let save = |id: &str, m: &Value| -> Res<()> { db::set_meta(&st.db.lock().unwrap(), id, None, m).map_err(e) };
    let mut changed = 0;

    // tags, features, user score: games that came in before these were asked for
    let need: Vec<&(String, u32, Value)> = rows.iter().filter(|(_, _, m)| m["storeTags"].is_null() && m["missing"].as_bool() != Some(true)).take(240).collect();
    if !need.is_empty() {
        let ids: Vec<u32> = need.iter().map(|r| r.1).collect();
        let got = steam::store_items(&st.http, &ids).await;
        for (id, appid, m) in need {
            let Some(item) = got.get(appid) else { continue };
            let mut m = m.clone();
            if item["missing"].as_bool() == Some(true) {
                m["storeTags"] = json!([]); // gone from the store: nothing to ask for
                save(id, &m)?;
                continue;
            }
            if item["storeTags"].is_null() {
                continue; // tag names not available right now
            }
            for k in ["storeTags", "tagGenres", "features", "userScore", "reviewCount"] {
                m[k] = item[k].clone();
            }
            save(id, &m)?;
            changed += 1;
        }
        if changed > 0 {
            return Ok(changed);
        }
    }

    // Metacritic and genres: Steam allows roughly one store-page request a second
    let need: Vec<&(String, u32, Value)> = rows.iter().filter(|(_, _, m)| m["scoresAt"].is_null()).take(20).collect();
    for (i, (id, appid, m)) in need.into_iter().enumerate() {
        if i > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(1600)).await;
        }
        // Steam says "slow down" now and then: wait and try again, twice, before leaving it for the next round
        let mut sc = steam::scores(&st.http, *appid).await;
        for wait in [20u64, 60] {
            if sc.is_ok() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_secs(wait)).await;
            sc = steam::scores(&st.http, *appid).await;
        }
        let Ok(sc) = sc else { break };
        let mut m = m.clone();
        m["metacritic"] = sc["metacritic"].clone();
        if sc["genres"].as_array().is_some_and(|g| !g.is_empty()) {
            m["genres"] = sc["genres"].clone();
        }
        m["scoresAt"] = json!(db::now());
        save(id, &m)?;
        changed += 1;
    }
    Ok(changed)
}

/// folders an exe often sits in below the game's own folder
const INNER_DIRS: &[&str] = &["bin", "bin64", "bin32", "binaries", "win64", "win32", "x64", "x86", "_retail_", "_classic_", "retail", "current", "game", "modlists"];

/// the game's own folder for an install dir that may point at its exe's folder
fn game_root(dir: &std::path::Path) -> std::path::PathBuf {
    let mut d = dir.to_path_buf();
    for _ in 0..3 {
        let name = d.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
        match d.parent() {
            Some(p) if INNER_DIRS.contains(&name.as_str()) && p.parent().is_some() => d = p.to_path_buf(),
            _ => break,
        }
    }
    d
}

/// adds up a folder, giving up on anything that is clearly not one game's folder
fn folder_size(dir: &std::path::Path) -> Option<u64> {
    let low = dir.to_string_lossy().to_lowercase();
    let home = std::env::var("USERPROFILE").unwrap_or_default().to_lowercase();
    let too_broad = dir.parent().is_none_or(|p| p.parent().is_none()) && !low.contains("games")
        || low == home
        || ["\\windows", "\\program files", "\\program files (x86)", "\\appdata\\local", "\\appdata\\roaming", "\\desktop", "\\downloads", "\\documents"]
            .iter()
            .any(|e| low.ends_with(e));
    if too_broad {
        return None;
    }
    let (mut total, mut files) = (0u64, 0u32);
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_symlink() {
                continue;
            } else if ft.is_dir() {
                stack.push(e.path());
            } else {
                total += e.metadata().map(|m| m.len()).unwrap_or(0);
                files += 1;
                if files > 400_000 {
                    return None;
                }
            }
        }
    }
    Some(total)
}

/// how big an installed game is on disk, measured once and kept
#[tauri::command]
async fn measure_size(st: State<'_, AppState>, id: String) -> Res<Option<i64>> {
    let (dir, size): (Option<String>, Option<i64>) = st
        .db
        .lock()
        .unwrap()
        .query_row("SELECT install_dir, size_bytes FROM games WHERE id = ?1 AND installed = 1", [&id], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(e)?;
    if size.is_some_and(|n| n > 0) {
        return Ok(size);
    }
    let Some(dir) = dir.filter(|d| !d.is_empty()) else { return Ok(None) };
    let root = game_root(std::path::Path::new(&dir));
    let measured = tauri::async_runtime::spawn_blocking(move || folder_size(&root)).await.map_err(e)?;
    let Some(bytes) = measured.filter(|&b| b > 0) else { return Ok(None) };
    st.db.lock().unwrap().execute("UPDATE games SET size_bytes = ?2 WHERE id = ?1", rusqlite::params![id, bytes as i64]).map_err(e)?;
    Ok(Some(bytes as i64))
}

/// the user turns a store on: its games on this PC come in
#[tauri::command]
async fn link_store(st: State<'_, AppState>, platform: String) -> Res<SyncReport> {
    if !SCAN_STORES.contains(&platform.as_str()) {
        return Err(crate::l("Bu mağaza tarama ile bağlanmıyor.", "This store is not connected by scanning.").into());
    }
    let p = platform.clone();
    let found = tauri::async_runtime::spawn_blocking(move || scan::launchers().into_iter().filter(|f| f.source == p).collect::<Vec<_>>())
        .await
        .map_err(e)?;
    store_pass(&st, &platform, found).await
}

/// on start and when Tessera comes back to the front: every store the user
/// turned on picks up new installs and removals (Steam included)
#[tauri::command]
async fn refresh_stores(st: State<'_, AppState>) -> Res<usize> {
    let accounts = db::accounts(&st.db.lock().unwrap()).map_err(e)?;
    let mut added = 0;
    if accounts.iter().any(|a| a.platform == "steam") {
        // offline is fine: installs come from Steam's own files on this PC
        if let Ok(r) = sync_steam(&st).await {
            added += r.added;
        }
    }
    let on: Vec<String> = accounts.into_iter().filter(|a| a.method == "scan").map(|a| a.platform).collect();
    if on.is_empty() {
        return Ok(added);
    }
    let all = tauri::async_runtime::spawn_blocking(scan::launchers).await.map_err(e)?;
    for p in on {
        let mine = all.iter().filter(|f| f.source == p).cloned().collect();
        added += store_pass(&st, &p, mine).await?.added;
    }
    Ok(added)
}

/// adds the games the user ticked
#[tauri::command]
async fn import_found(st: State<'_, AppState>, items: Vec<scan::Found>) -> Res<usize> {
    let mut metas = Vec::with_capacity(items.len());
    for f in &items {
        metas.push(meta_for_found(&st, f, true).await);
    }
    let c = st.db.lock().unwrap();
    let mut added = 0;
    for (f, m) in items.iter().zip(&metas) {
        if save_found(&c, f, m)?.1 {
            added += 1;
        }
    }
    st.tracker.touch();
    Ok(added)
}

#[tauri::command]
async fn match_candidates(st: State<'_, AppState>, query: String) -> Res<Vec<meta::Candidate>> {
    Ok(meta::candidates(&st.http, &query).await)
}

/// one game picked by hand: an .exe or a shortcut, matched to the candidate the
/// user chose (or added as it is when they chose none)
#[tauri::command]
async fn add_game(st: State<'_, AppState>, path: String, title: Option<String>, candidate: Option<meta::Candidate>) -> Res<String> {
    let mut f = scan::from_path(std::path::Path::new(&path), "manual").ok_or(crate::l("Bu dosya bir .exe ya da kısayol değil.", "This file is not an .exe or a shortcut."))?;
    if let Some(t) = title.map(|t| t.trim().to_string()).filter(|t| !t.is_empty()) {
        f.title = t;
    }
    f.guess = candidate;
    let m = meta_for_found(&st, &f, false).await;
    let c = st.db.lock().unwrap();
    let id = save_found(&c, &f, &m)?.0;
    st.tracker.touch();
    Ok(id)
}

/// points an existing game at different store/Wikipedia data (or clears it)
#[tauri::command]
async fn rematch(st: State<'_, AppState>, id: String, candidate: Option<meta::Candidate>) -> Res<()> {
    let (_, _, _, old) = db::game_launch(&st.db.lock().unwrap(), &id).map_err(e)?.ok_or(crate::l("Oyun bulunamadı.", "Game not found."))?;
    let mut m = match &candidate {
        Some(c) => meta::meta_for(&st.http, c).await.ok_or(crate::l("Bu eşleşmenin bilgileri alınamadı.", "Could not get the details for this match."))?,
        None => json!({ "noMatch": true }),
    };
    if let (Some(obj), Some(l)) = (m.as_object_mut(), old["launch"].as_str()) {
        obj.insert("launch".into(), Value::String(l.into()));
    }
    let title = m["name"].as_str().map(str::to_string);
    db::set_meta(&st.db.lock().unwrap(), &id, title.as_deref(), &m).map_err(e)
}

/// a game's Steam appid, when it has one
fn steam_appid(st: &AppState, id: &str) -> Res<Option<u32>> {
    let c = st.db.lock().unwrap();
    let (platform, ext, meta): (String, String, Option<String>) = c
        .query_row("SELECT platform, external_id, meta_json FROM games WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .map_err(|_| crate::l("Oyun bulunamadı.", "Game not found.").to_string())?;
    let meta = meta.and_then(|m| serde_json::from_str::<Value>(&m).ok()).unwrap_or(Value::Null);
    Ok(news::appid_of(&platform, &ext, &meta))
}

/// official announcements and patch notes of a game (empty for games not on Steam)
#[tauri::command]
async fn game_news(st: State<'_, AppState>, id: String) -> Res<Vec<Value>> {
    match steam_appid(&st, &id)? {
        Some(appid) => news::for_app(&st, appid).await,
        None => Ok(vec![]),
    }
}

/// the user's own Steam screenshots of a game, newest first
#[tauri::command]
async fn game_screenshots(st: State<'_, AppState>, id: String) -> Res<Vec<shots::Shot>> {
    let (Some(appid), Some(root)) = (steam_appid(&st, &id)?, steam::root()) else { return Ok(vec![]) };
    tauri::async_runtime::spawn_blocking(move || shots::list(&root, appid)).await.map_err(e)
}

/// screenshots uploaded to the Steam profile for a game
#[tauri::command]
async fn profile_screenshots(st: State<'_, AppState>, id: String) -> Res<Vec<Value>> {
    match steam_appid(&st, &id)? {
        Some(appid) => shots::profile(&st, appid).await,
        None => Ok(vec![]),
    }
}

/// opens the folder Steam keeps a game's screenshots in
#[tauri::command]
fn open_screenshots(st: State<AppState>, id: String) -> Res<()> {
    let (Some(appid), Some(root)) = (steam_appid(&st, &id)?, steam::root()) else { return Err(crate::l("Klasör bulunamadı.", "Folder not found.").into()) };
    let dir = shots::folders(&root, appid).into_iter().next().ok_or(crate::l("Klasör bulunamadı.", "Folder not found."))?;
    open::that_detached(dir).map_err(e)
}

/// Steam friends and what they play (public friends page, no key)
#[tauri::command]
async fn steam_friends(st: State<'_, AppState>) -> Res<Value> {
    friends::list(&st).await
}

/// Xbox friends through OpenXBL (the user's own key)
#[tauri::command]
async fn xbox_friends(st: State<'_, AppState>) -> Res<Value> {
    friends::xbox_list(&st).await
}

#[tauri::command]
fn xbox_status() -> bool {
    friends::xbox_has_key()
}

#[tauri::command]
async fn xbox_set_key(st: State<'_, AppState>, key: Option<String>) -> Res<()> {
    friends::xbox_set_key(&st, key).await
}

/// the secret CS2 and Dota 2 send back with their state, so nothing else on this PC can pose as them
fn live_token(st: &AppState) -> String {
    let c = st.db.lock().unwrap();
    if let Some(t) = db::setting(&c, "gsiToken").and_then(|v| v.as_str().map(str::to_string)) {
        return t;
    }
    let mut b = [0u8; 16];
    let _ = getrandom::fill(&mut b);
    let t: String = b.iter().map(|x| format!("{x:02x}")).collect();
    let _ = db::set_setting(&c, "gsiToken", &json!(t));
    t
}

/// where a game wants the file that turns on its live data
fn live_file(st: &AppState, appid: u32) -> Option<std::path::PathBuf> {
    let dir: Option<String> = if appid == live::ROCKET_LEAGUE {
        Some(String::new())
    } else {
        st.db.lock().unwrap().query_row("SELECT install_dir FROM games WHERE id = ?1 AND installed = 1", [format!("steam:{appid}")], |r| r.get(0)).ok().flatten()
    };
    live::setup_file(appid, std::path::Path::new(&dir?))
}

/// CS2, Dota 2 and Rocket League: installed here? live data on?
#[tauri::command]
fn live_status(st: State<AppState>) -> Vec<Value> {
    [live::CS2, live::DOTA2, live::ROCKET_LEAGUE].iter().map(|&a| live::status(a, live_file(&st, a).as_deref())).collect()
}

/// turns a game's live data on or off (writes or removes its small settings file)
#[tauri::command]
fn live_set(st: State<AppState>, appid: u32, on: bool) -> Res<()> {
    let file = live_file(&st, appid).ok_or(crate::l("Oyun bu bilgisayarda bulunamadı.", "The game is not on this PC."))?;
    if on {
        live::turn_on(appid, &file, &live_token(&st)).map_err(e)
    } else {
        live::turn_off(appid, &file).map_err(e)
    }
}

/// tray, notifications and start with Windows, as the user set them
#[tauri::command]
fn shell_prefs(st: State<AppState>) -> Value {
    shell::prefs(&st)
}

#[tauri::command]
fn shell_set(st: State<AppState>, key: String, on: bool) -> Res<()> {
    match key.as_str() {
        "autostart" => shell::set_autostart(on),
        "closeToTray" | "notifyWishlist" | "notifySessions" | "notifyTracked" => db::set_setting(&st.db.lock().unwrap(), &key, &json!(on)).map_err(e),
        _ => Err(crate::l("Bilinmeyen ayar.", "Unknown setting.").into()),
    }
}

/// a newer version on the update address? (never asks when no address is set)
#[tauri::command]
async fn update_check(app: AppHandle) -> Res<Value> {
    update::check(&app).await
}

/// download, verify, install, restart
#[tauri::command]
async fn update_install(app: AppHandle) -> Res<()> {
    update::install(&app).await
}

/// is there an IsThereAnyDeal key (the user's own or the build's)
#[tauri::command]
fn itad_status() -> Value {
    prices::status()
}

#[tauri::command]
async fn itad_set_key(st: State<'_, AppState>, key: Option<String>) -> Res<()> {
    prices::set_key(&st, key).await
}

/// what one game costs in every store, cheapest first
#[tauri::command]
async fn game_prices(st: State<'_, AppState>, id: String) -> Res<Value> {
    let appid = steam_appid(&st, &id)?;
    let title: String = st.db.lock().unwrap().query_row("SELECT title FROM games WHERE id = ?1", [&id], |r| r.get(0)).map_err(e)?;
    let gid = match appid {
        Some(a) => prices::gids_by_appid(&st, &[a]).await?.remove(&a),
        None => None,
    };
    let gid = match gid {
        Some(g) => Some(g),
        None => prices::gid_by_title(&st, &title.replace(['™', '®'], "")).await?,
    };
    let Some(gid) = gid else {
        return Ok(json!({ "found": false, "hasKey": prices::key().is_some() }));
    };
    if prices::key().is_none() {
        return Ok(json!({ "found": true, "hasKey": false, "gid": gid }));
    }
    let mut p = prices::for_gids(&st, std::slice::from_ref(&gid)).await?.remove(&gid).unwrap_or(json!({ "deals": [] }));
    p["found"] = json!(true);
    p["hasKey"] = json!(true);
    p["gid"] = json!(gid);
    p["apps"] = prices::apps();
    Ok(p)
}

/// the wishlist's prices in every store, by Steam appid
#[tauri::command]
async fn wishlist_prices(st: State<'_, AppState>, appids: Vec<u32>) -> Res<Value> {
    if prices::key().is_none() {
        return Ok(json!({ "hasKey": false, "items": {} }));
    }
    let gids = prices::gids_by_appid(&st, &appids).await?;
    let list: Vec<String> = gids.values().cloned().collect();
    let found = prices::for_gids(&st, &list).await?;
    let items: serde_json::Map<String, Value> = gids
        .iter()
        .filter_map(|(a, g)| Some((a.to_string(), found.get(g)?.clone())))
        .collect();
    Ok(json!({ "hasKey": true, "items": items, "apps": prices::apps() }))
}

/// any game by title (owned or not), for the price search page
#[tauri::command]
async fn shop_search(st: State<'_, AppState>, q: String) -> Res<Value> {
    if prices::key().is_none() {
        return Ok(json!({ "hasKey": false, "items": [] }));
    }
    let mut items = prices::search(&st, &q).await?;
    // every result's prices in one request, so the list can show the cheapest
    let gids: Vec<String> = items.as_array().map(|a| a.iter().filter_map(|i| i["gid"].as_str().map(str::to_string)).collect()).unwrap_or_default();
    let found = prices::for_gids(&st, &gids).await.unwrap_or_default();
    if let Some(a) = items.as_array_mut() {
        for i in a.iter_mut() {
            if let Some(p) = i["gid"].as_str().and_then(|g| found.get(g)) {
                i["prices"] = p.clone();
            }
        }
    }
    Ok(json!({ "hasKey": true, "items": items, "apps": prices::apps() }))
}

/// the most popular games that are on sale somewhere for money, with their prices
#[tauri::command]
async fn shop_popular(st: State<'_, AppState>) -> Res<Value> {
    if prices::key().is_none() {
        return Ok(json!({ "hasKey": false, "items": [] }));
    }
    let pool = prices::charts(&st).await?;
    let gids: Vec<String> = pool.iter().filter_map(|i| i["gid"].as_str().map(str::to_string)).collect();
    let found = prices::for_gids(&st, &gids).await?;
    let items: Vec<Value> = pool
        .into_iter()
        .filter_map(|mut i| {
            let p = found.get(i["gid"].as_str()?)?;
            let paid = p["deals"].as_array()?.iter().any(|d| d["price"].as_f64().unwrap_or(0.0) > 0.0);
            if !paid { return None; }
            i["prices"] = p.clone();
            Some(i)
        })
        .collect();
    Ok(json!({ "hasKey": true, "items": items, "apps": prices::apps() }))
}

/// banner art for games picked from the popular list
// ---------------------------------------------------------------- bug reports

#[tauri::command]
fn error_info(st: State<AppState>) -> Value {
    errors::info(&st.dir)
}

#[tauri::command]
fn error_clear(st: State<AppState>) {
    errors::clear(&st.dir)
}

// ---------------------------------------------------------------- shared themes

#[tauri::command]
fn theme_list(st: State<AppState>) -> Value {
    json!(themes::list(&st.dir))
}

#[tauri::command]
fn theme_save(st: State<AppState>, theme: Value, id: Option<String>) -> Res<String> {
    themes::save(&st.dir, &theme, id.as_deref())
}

#[tauri::command]
fn theme_import(st: State<AppState>, path: String) -> Res<String> {
    themes::import(&st.dir, std::path::Path::new(&path))
}

#[tauri::command]
fn theme_export(st: State<AppState>, id: String, path: String) -> Res<()> {
    themes::export(&st.dir, &id, std::path::Path::new(&path))
}

#[tauri::command]
fn theme_delete(st: State<AppState>, id: String) -> Res<()> {
    themes::delete(&st.dir, &id)
}

/// a picture for a summary card, as a data URL the canvas may read back
#[tauri::command]
async fn image_data(st: State<'_, AppState>, url: String) -> Res<String> {
    share::image_data(&st.http, &url).await
}

/// a finished summary card, written where the user chose
#[tauri::command]
fn save_png(path: String, data: String) -> Res<()> {
    share::save_png(std::path::Path::new(&path), &data)
}

/// the themes folder in Explorer (made if it is not there yet)
#[tauri::command]
fn theme_folder(st: State<AppState>) -> Res<()> {
    let d = themes::dir(&st.dir);
    std::fs::create_dir_all(&d).map_err(e)?;
    open::that_detached(&d).map_err(e)
}

// ---------------------------------------------------------------- followed games

#[tauri::command]
fn track_list(st: State<AppState>) -> Value {
    track::list(&st)
}

#[tauri::command]
async fn track_add(st: State<'_, AppState>, gid: String, title: String, art: Option<String>) -> Res<Value> {
    track::add(&st, gid, title, art).await
}

#[tauri::command]
fn track_remove(st: State<AppState>, gid: String) -> Res<Value> {
    track::remove(&st, &gid)
}

#[tauri::command]
fn track_target(st: State<AppState>, gid: String, target: Option<f64>) -> Res<Value> {
    track::set_target(&st, &gid, target)
}

#[tauri::command]
async fn shop_art(st: State<'_, AppState>, gids: Vec<String>) -> Res<Value> {
    Ok(json!(prices::art_many(&st, &gids).await?))
}

/// one game from the search: what it is, and its price in every store
#[tauri::command]
async fn shop_game(st: State<'_, AppState>, gid: String) -> Res<Value> {
    if prices::key().is_none() {
        return Ok(json!({ "hasKey": false }));
    }
    let info = prices::info(&st, &gid).await?;
    let mut p = prices::for_gids(&st, std::slice::from_ref(&gid)).await?.remove(&gid).unwrap_or(json!({ "deals": [] }));
    p["found"] = json!(true);
    p["hasKey"] = json!(true);
    p["gid"] = json!(gid);
    p["apps"] = prices::apps();
    Ok(json!({ "hasKey": true, "info": info, "prices": p }))
}

/// opens a store on a game: its app when installed, otherwise the page in the browser
#[tauri::command]
async fn store_open(st: State<'_, AppState>, shop: u32, url: String, gid: Option<String>, appid: Option<u32>) -> Res<&'static str> {
    let app = match &gid {
        Some(g) => prices::app_link(&st, shop, g, appid).await,
        None if shop == prices::STEAM => appid.filter(|_| prices::apps()["61"] == json!(true)).map(|a| format!("steam://store/{a}")),
        None => None,
    };
    let (link, how) = match app {
        Some(a) => (a, "app"),
        None => (url, "web"),
    };
    if !prices::safe_to_open(&link) {
        return Err(crate::l("Bu bağlantı açılamaz.", "This link cannot be opened.").into());
    }
    open::that_detached(&link).map_err(e)?;
    Ok(how)
}

/// something the user should hear once at start (a repaired database)
#[tauri::command]
fn take_startup_note(st: State<AppState>) -> Option<String> {
    let c = st.db.lock().unwrap();
    let note = db::setting(&c, "startupNote").and_then(|v| v.as_str().map(str::to_string));
    if note.is_some() {
        let _ = db::set_setting(&c, "startupNote", &Value::Null);
    }
    note
}

/// the wishlist as last seen (no network)
#[tauri::command]
fn wishlist_saved(st: State<AppState>) -> Value {
    wishlist::saved(&st)
}

/// asks Steam for the wishlist and prices; includes what changed since last time
#[tauri::command]
async fn wishlist_refresh(st: State<'_, AppState>) -> Res<Value> {
    wishlist::refresh(&st).await
}

/// opens a web page in the user's default browser (https only)
#[tauri::command]
fn open_url(url: String) -> Res<()> {
    let u = url::Url::parse(&url).map_err(e)?;
    if u.scheme() != "https" {
        return Err(crate::l("Yalnızca https adresleri açılabilir.", "Only https addresses can be opened.").into());
    }
    open::that_detached(u.as_str()).map_err(e)
}

/// a Steam client link from the friends list: chat, profile, trade, a game's pages.
/// Only these shapes are opened, with numbers where Steam expects ids.
#[tauri::command]
fn open_steam(path: String) -> Res<()> {
    let digits = |s: &str| !s.is_empty() && s.len() <= 20 && s.bytes().all(|b| b.is_ascii_digit());
    let ok = [
        "friends/message/", "url/SteamIDPage/", "run/", "store/", "url/GameHub/",
    ]
    .iter()
    .any(|p| path.strip_prefix(p).is_some_and(digits))
        || path
            .strip_prefix("openurl/https://steamcommunity.com/tradeoffer/new/?partner=")
            .is_some_and(digits);
    if !ok {
        return Err(crate::l("Bu bağlantı açılamaz.", "This link cannot be opened.").into());
    }
    open::that_detached(format!("steam://{path}")).map_err(e)
}

// ---------------------------------------------------------------- steam
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SteamDetect {
    client_found: bool,
    accounts: Vec<steam::LocalAccount>,
}

#[tauri::command]
fn steam_detect() -> SteamDetect {
    match steam::root() {
        Some(r) => SteamDetect { client_found: true, accounts: steam::local_accounts(&r) },
        None => SteamDetect { client_found: false, accounts: vec![] },
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SignedIn {
    steamid: String,
    persona: Option<String>,
}

/// Opens Steam's own sign-in page in a separate window. Tessera never sees the
/// password; Steam hands back a signed SteamID that is verified with Steam.
#[tauri::command]
async fn steam_sign_in(app: AppHandle, st: State<'_, AppState>) -> Res<SignedIn> {
    let (tx, rx) = std::sync::mpsc::channel::<Option<String>>();
    let tx_closed = tx.clone();
    if let Some(w) = app.get_webview_window("steam-login") {
        let _ = w.close();
    }
    let url = steam::openid_url().parse().map_err(e)?;
    let win = WebviewWindowBuilder::new(&app, "steam-login", WebviewUrl::External(url))
        .title(crate::l("Steam ile giriş · Tessera", "Sign in with Steam · Tessera"))
        .inner_size(860.0, 780.0)
        .center()
        .on_navigation(move |u| {
            if u.as_str().starts_with(steam::RETURN_TO) {
                let _ = tx.send(Some(u.to_string()));
                false
            } else {
                true
            }
        })
        .build()
        .map_err(e)?;
    win.on_window_event(move |ev| {
        if let WindowEvent::Destroyed = ev {
            let _ = tx_closed.send(None);
        }
    });
    let got = tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(Duration::from_secs(900)).ok().flatten())
        .await
        .map_err(e)?;
    if let Some(w) = app.get_webview_window("steam-login") {
        let _ = w.close();
    }
    let callback = got.ok_or(crate::l("Giriş penceresi kapatıldı.", "The sign-in window was closed."))?;
    let steamid = steam::verify_openid(&st.http, &callback).await?;
    let local = steam::root().map(|r| steam::local_accounts(&r)).unwrap_or_default();
    let persona = match local.into_iter().find(|a| a.steamid == steamid) {
        Some(a) => Some(a.persona),
        None => steam::persona_of(&st.http, &steamid).await,
    };
    Ok(SignedIn { steamid, persona })
}

#[tauri::command]
fn steam_connect(st: State<AppState>, steamid: String, persona: Option<String>, method: String, api_key: Option<String>) -> Res<()> {
    if steamid.len() != 17 || !steamid.chars().all(|c| c.is_ascii_digit()) {
        return Err(crate::l("Geçersiz SteamID.", "Invalid SteamID.").into());
    }
    if let Some(k) = api_key.as_deref() {
        secret_set(STEAM_KEY, Some(k))?;
    }
    let c = st.db.lock().unwrap();
    let prev = db::account(&c, "steam").map_err(e)?;
    db::save_account(
        &c,
        &db::Account {
            platform: "steam".into(),
            external_id: steamid,
            display_name: persona,
            method,
            connected_at: prev.as_ref().map(|p| p.connected_at).unwrap_or_else(db::now),
            last_sync: prev.and_then(|p| p.last_sync),
        },
    )
    .map_err(e)
}

#[tauri::command]
fn steam_set_key(key: Option<String>) -> Res<()> {
    secret_set(STEAM_KEY, key.as_deref())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncReport {
    total: usize,
    added: usize,
    installed: usize,
    used_key: bool,
    local_data: bool,
    warning: Option<String>,
}

/// the collections the connected account made in the Steam library, read from the client's files
#[tauri::command]
fn steam_collections(st: State<AppState>) -> Res<steam::Collections> {
    let steamid = {
        let c = st.db.lock().unwrap();
        db::account(&c, "steam").map_err(e)?.ok_or(crate::l("Steam bağlı değil.", "Steam is not connected."))?.external_id
    };
    let root = steam::root().ok_or(crate::l("Steam bu bilgisayarda bulunamadı.", "Steam wasn't found on this PC."))?;
    Ok(steam::collections(&root, &steamid))
}

#[tauri::command]
async fn steam_sync(st: State<'_, AppState>) -> Res<SyncReport> {
    sync_steam(&st).await
}

async fn sync_steam(st: &AppState) -> Res<SyncReport> {
    let steamid = {
        let c = st.db.lock().unwrap();
        db::account(&c, "steam").map_err(e)?.ok_or(crate::l("Steam bağlı değil.", "Steam is not connected."))?.external_id
    };
    let root = steam::root();
    let installed = root.as_deref().map(steam::installed).unwrap_or_default();
    let local = root.as_deref().map(|r| steam::local_playtime(r, &steamid)).unwrap_or_default();
    let key = secret_get(STEAM_KEY);
    let mut warning = None;
    let owned = match key.as_deref() {
        Some(k) => match steam::owned_games(&st.http, k, &steamid).await {
            Ok(o) => o,
            Err(err) => {
                warning = Some(err);
                HashMap::new()
            }
        },
        None => HashMap::new(),
    };

    let mut ids: HashSet<u32> = installed.keys().copied().collect();
    ids.extend(local.keys().copied());
    ids.extend(owned.keys().copied());

    // store data: cached for a week, fetched in batches for the rest
    let mut meta: HashMap<u32, Value> = HashMap::new();
    let missing: Vec<u32> = {
        let c = st.db.lock().unwrap();
        ids.iter()
            .copied()
            .filter(|id| match db::cache_get(&c, &format!("steam2:{id}"), 7 * 86400) {
                Some(v) => {
                    meta.insert(*id, v);
                    false
                }
                None => true,
            })
            .collect()
    };
    let fetched = steam::store_items(&st.http, &missing).await;

    let c = st.db.lock().unwrap();
    for (id, v) in &fetched {
        let _ = db::cache_put(&c, &format!("steam2:{id}"), v);
        meta.insert(*id, v.clone());
    }

    let mut added = 0;
    let mut kept = Vec::new();
    let mut installed_ids = Vec::new();
    for id in &ids {
        let m = meta.get(id).cloned().unwrap_or(Value::Null);
        let inst = installed.get(id);
        // keep games (store type 0) and playable mods (2, e.g. tModLoader). Unknown
        // apps stay if installed with a manifest name (delisted games); demos,
        // tools, soundtracks, software and redistributables drop out.
        let is_game = matches!(m["type"].as_i64(), Some(0) | Some(2));
        let delisted = m["missing"].as_bool() == Some(true) || m.is_null();
        if !(is_game || (delisted && inst.is_some_and(|i| !i.name.is_empty()) && !inst.unwrap().name.contains("Redistributable"))) {
            continue;
        }
        let title = m["name"]
            .as_str()
            .map(str::to_string)
            .or_else(|| inst.map(|i| i.name.clone()))
            .or_else(|| owned.get(id).map(|o| o.name.clone()))
            .unwrap_or_else(|| format!("Steam {id}"));
        let (lmin, llast) = local.get(id).copied().unwrap_or((0, None));
        let o = owned.get(id);
        let minutes = lmin.max(o.map(|o| o.minutes).unwrap_or(0));
        let last = [llast, inst.and_then(|i| i.last_played), o.and_then(|o| o.last_played)].into_iter().flatten().max();
        let gid = format!("steam:{id}");
        let ext = id.to_string();
        let row = db::SyncedGame {
            id: &gid,
            platform: "steam",
            external_id: &ext,
            title: &title,
            installed: inst.is_some(),
            install_dir: inst.map(|i| i.dir.as_str()),
            size_bytes: inst.map(|i| i.size),
            playtime_min: minutes,
            last_played: last,
            meta: &m,
        };
        if db::upsert_synced(&c, &row).map_err(e)? {
            added += 1;
        }
        if inst.is_some() {
            installed_ids.push(gid.clone());
        }
        kept.push(gid);
    }
    db::mark_uninstalled_except(&c, "steam", &installed_ids).map_err(e)?;
    st.tracker.touch();
    db::touch_sync(&c, "steam").map_err(e)?;

    Ok(SyncReport {
        total: kept.len(),
        added,
        installed: installed_ids.len(),
        used_key: key.is_some() && warning.is_none(),
        local_data: !local.is_empty(),
        warning,
    })
}

#[tauri::command]
async fn steam_achievements(st: State<'_, AppState>, appid: u32) -> Res<Value> {
    let steamid = {
        let c = st.db.lock().unwrap();
        db::account(&c, "steam").map_err(e)?.map(|a| a.external_id)
    };
    let Some(steamid) = steamid else { return Ok(json!({ "error": crate::l("Steam bağlı değil.", "Steam is not connected.") })) };
    let key = secret_get(STEAM_KEY);
    steam::achievements(&st.http, key.as_deref(), &steamid, appid).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // a second start (desktop shortcut, Windows start) brings the running one forward
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| shell::show(app)))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        // the user's Steam screenshots, and nothing else, for the gallery
        .register_asynchronous_uri_scheme_protocol("shot", |_ctx, request, responder| {
            let path = request.uri().path().to_string();
            std::thread::spawn(move || responder.respond(shots::serve(&path)));
        })
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build())?;
            }
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            errors::install(dir.clone());
            // a damaged database is backed up and rebuilt before anything opens it
            let repaired = repair::if_needed(&dir.join("tessera.db"));
            let conn = db::open(&dir.join("tessera.db"))?;
            if let Some(note) = &repaired {
                let _ = db::set_setting(&conn, "startupNote", &json!(note));
            }
            if db::setting(&conn, "lang").and_then(|v| v.as_str().map(str::to_string)).as_deref() == Some("en") {
                ENGLISH.store(true, std::sync::atomic::Ordering::Relaxed);
            }
            tracker::schema(&conn)?;
            retro::schema(&conn)?;
            let track_all = db::setting(&conn, "trackAll").and_then(|v| v.as_bool()).unwrap_or(true);
            let http = reqwest::Client::builder()
                .user_agent(concat!("Tessera/", env!("CARGO_PKG_VERSION")))
                .timeout(Duration::from_secs(30))
                .build()?;
            app.manage(AppState { db: Mutex::new(conn), http, tracker: tracker::Tracker::new(track_all), dir: dir.clone() });
            tracker::start(app.handle().clone());
            presence::start(app.handle().clone());
            live::listen(live_token(&app.state::<AppState>()));
            shell::main_window(app)?;
            shell::tray(app)?;
            shell::wishlist_watch(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            link_store,
            refresh_stores,
            fill_missing,
            scan_guess,
            measure_size,
            enrich_library,
            list_games,
            list_accounts,
            set_user_data,
            disconnect,
            launch_game,
            retro_cmds::retro_systems,
            retro_cmds::list_emulators,
            retro_cmds::open_emulator,
            retro_cmds::detect_emulators,
            retro_cmds::add_emulator,
            retro_cmds::remove_emulator,
            retro_cmds::set_emulator_args,
            retro_cmds::list_rom_folders,
            retro_cmds::set_folder_emulator,
            retro_cmds::add_rom_folder,
            retro_cmds::rescan_rom_folder,
            retro_cmds::remove_rom_folder,
            retro_cmds::rom_details,
            retro_cmds::save_info,
            retro_cmds::save_backup,
            retro_cmds::save_restore,
            retro_cmds::save_delete,
            retro_cmds::save_sync_settings,
            retro_cmds::set_save_cloud,
            retro_cmds::drive_install_client,
            retro_cmds::drive_connect,
            retro_cmds::drive_disconnect,
            retro_cmds::sync_saves_now,
            extras::export_library,
            extras::import_library,
            extras::ra_status,
            extras::ra_connect,
            extras::ra_disconnect,
            extras::ra_achievements,
            extras::sgdb_status,
            extras::sgdb_set_key,
            extras::sgdb_images,
            tracking_state,
            set_tracking_all,
            steam_app_details,
            scan_installed,
            import_found,
            match_candidates,
            add_game,
            rematch,
            open_url,
            game_news,
            game_screenshots,
            wishlist_saved,
            steam_friends,
            live_status,
            shell_prefs,
            take_startup_note,
            itad_status,
            itad_set_key,
            game_prices,
            wishlist_prices,
            store_open,
            shop_search,
            shop_game,
            shop_popular,
            xbox_friends,
            xbox_status,
            xbox_set_key,
            shop_art,
            track_list,
            track_add,
            track_remove,
            track_target,
            set_lang,
            open_steam,
            theme_list,
            theme_save,
            theme_import,
            theme_export,
            image_data,
            save_png,
            theme_delete,
            theme_folder,
            error_info,
            error_clear,
            update_check,
            update_install,
            shell_set,
            live_set,
            wishlist_refresh,
            open_screenshots,
            profile_screenshots,
            steam_detect,
            steam_sign_in,
            steam_connect,
            steam_set_key,
            steam_sync,
            steam_collections,
            steam_achievements,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Tessera")
        .run(|app, ev| {
            if let tauri::RunEvent::Exit = ev {
                tracker::flush(app);
            }
        });
}

#[cfg(test)]
mod tests {
    #[test]
    #[ignore = "reads this PC's folders and calls Steam"]
    fn sizes_here() {
        let http = reqwest::Client::builder().user_agent("Tessera/0.1 (game library)").build().unwrap();
        for id in [1145350u32, 570, 413150] {
            let d = tauri::async_runtime::block_on(steam::app_details(&http, id)).unwrap();
            println!("{id}: storage {}", d["storageGB"]);
        }
        let local = std::env::var("LOCALAPPDATA").unwrap();
        for dir in [format!("{local}/osu!"), format!("{local}/osulazer/current"), "C:/Program Files (x86)/World of Warcraft/_retail_".to_string(), local.clone()] {
            let root = game_root(std::path::Path::new(&dir));
            println!("{dir} -> {} = {:?} GB", root.display(), folder_size(&root).map(|b| b as f64 / 1e9));
        }
    }

    #[test]
    #[ignore = "works on a copy of this PC's library and calls Steam/Wikipedia"]
    fn fill_copy_of_my_library() {
        let src = std::path::PathBuf::from(std::env::var("APPDATA").unwrap()).join("app.tessera.desktop").join("tessera.db");
        let path = std::env::temp_dir().join("tessera-fill-test.db");
        std::fs::copy(&src, &path).unwrap();
        let st = AppState {
            db: Mutex::new(db::open(&path).unwrap()),
            http: reqwest::Client::builder().user_agent("Tessera/0.1 (game library)").build().unwrap(),
            tracker: tracker::Tracker::new(true),
            dir: std::env::temp_dir(),
        };
        st.db.lock().unwrap().execute("DELETE FROM meta_cache WHERE key LIKE 'fill:%'", []).unwrap();
        let n = tauri::async_runtime::block_on(fill_missing_in(&st)).unwrap();
        println!("filled {n}");
        let c = st.db.lock().unwrap();
        let mut q = c.prepare("SELECT platform, title, json_extract(meta_json, '$.name') IS NOT NULL FROM games WHERE platform != 'steam' AND id NOT LIKE 'rom:%'").unwrap();
        for r in q.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, bool>(2)?))).unwrap().flatten() {
            println!("{:10} {:45} {}", r.0, r.1, if r.2 { "bilgi var" } else { "-" });
        }
    }

    #[test]
    #[ignore = "works on a copy of this PC's library and reads Steam's files"]
    fn installs_refresh_on_a_copy() {
        let src = std::path::PathBuf::from(std::env::var("APPDATA").unwrap()).join("app.tessera.desktop").join("tessera.db");
        let path = std::env::temp_dir().join("tessera-installs-test.db");
        std::fs::copy(&src, &path).unwrap();
        let st = AppState {
            db: Mutex::new(db::open(&path).unwrap()),
            http: reqwest::Client::builder().user_agent("Tessera/0.1 (game library)").build().unwrap(),
            tracker: tracker::Tracker::new(true),
            dir: std::env::temp_dir(),
        };
        let q = |st: &AppState| -> Vec<(String, bool)> {
            let c = st.db.lock().unwrap();
            let mut q = c.prepare("SELECT title, installed FROM games WHERE external_id IN ('2066020', '291550')").unwrap();
            q.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().flatten().collect()
        };
        println!("before: {:?}", q(&st));
        let r = tauri::async_runtime::block_on(sync_steam(&st)).unwrap();
        println!("after:  {:?} (installed {}, total {})", q(&st), r.installed, r.total);
    }

    #[test]
    #[ignore = "works on a copy of this PC's library and calls Steam"]
    fn enrich_copy_of_my_library() {
        let src = std::path::PathBuf::from(std::env::var("APPDATA").unwrap()).join("app.tessera.desktop").join("tessera.db");
        let path = std::env::temp_dir().join("tessera-enrich-test.db");
        std::fs::copy(&src, &path).unwrap();
        let st = AppState {
            db: Mutex::new(db::open(&path).unwrap()),
            http: reqwest::Client::builder().user_agent("Tessera/0.1 (game library)").build().unwrap(),
            tracker: tracker::Tracker::new(true),
            dir: std::env::temp_dir(),
        };
        for round in 0..3 {
            let t = std::time::Instant::now();
            let n = tauri::async_runtime::block_on(enrich_in(&st)).unwrap();
            println!("round {round}: {n} games in {:?}", t.elapsed());
        }
        let c = st.db.lock().unwrap();
        let mut q = c.prepare("SELECT title, meta_json ->> '$.metacritic', meta_json -> '$.genres', meta_json -> '$.storeTags', meta_json -> '$.features', meta_json ->> '$.userScore' FROM games WHERE meta_json ->> '$.scoresAt' IS NOT NULL LIMIT 6").unwrap();
        for r in q.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<i64>>(1)?, r.get::<_, Option<String>>(2)?, r.get::<_, Option<String>>(3)?, r.get::<_, Option<String>>(4)?, r.get::<_, Option<i64>>(5)?))).unwrap().flatten() {
            println!("{r:?}");
        }
        let n: i64 = c.query_row("SELECT COUNT(*) FROM games WHERE meta_json -> '$.storeTags' IS NOT NULL", [], |r| r.get(0)).unwrap();
        println!("with tags: {n}");
    }

    use super::*;

    #[test]
    #[ignore = "reads the local Steam install and calls Steam"]
    fn sync_end_to_end() {
        let path = std::env::temp_dir().join("tessera-test.db");
        let _ = std::fs::remove_file(&path);
        let conn = db::open(&path).unwrap();
        let root = steam::root().unwrap();
        let acc = steam::local_accounts(&root).into_iter().next().unwrap();
        db::save_account(&conn, &db::Account {
            platform: "steam".into(), external_id: acc.steamid, display_name: None,
            method: "local".into(), connected_at: db::now(), last_sync: None,
        }).unwrap();
        let st = AppState { db: Mutex::new(conn), http: reqwest::Client::new(), tracker: tracker::Tracker::new(true), dir: std::env::temp_dir() };
        let r = tauri::async_runtime::block_on(sync_steam(&st)).unwrap();
        println!("total {} added {} installed {} key {} local {}", r.total, r.added, r.installed, r.used_key, r.local_data);
        let mut games = db::games(&st.db.lock().unwrap()).unwrap();
        games.sort_by_key(|g| -g.playtime_min);
        for g in games.iter().take(8) {
            println!("{:>6} h  inst={} cover={}  {}", g.playtime_min / 60, g.installed, g.meta["cover"].is_string(), g.title);
        }
        let no_cover = games.iter().filter(|g| !g.meta["cover"].is_string()).count();
        println!("without cover: {no_cover}");
        // second run must be idempotent
        let r2 = tauri::async_runtime::block_on(sync_steam(&st)).unwrap();
        assert_eq!(r2.added, 0);
        assert_eq!(r2.total, r.total);
    }
}

#[cfg(test)]
mod scan_tests {
    use super::*;

    #[test]
    #[ignore = "reads this PC and calls Steam/Wikipedia"]
    fn shortcuts_guess_and_import() {
        let path = std::env::temp_dir().join("tessera-scan-test.db");
        let _ = std::fs::remove_file(&path);
        let st = AppState {
            db: Mutex::new(db::open(&path).unwrap()),
            http: reqwest::Client::builder().user_agent("Tessera/0.1 (game library)").build().unwrap(),
            tracker: tracker::Tracker::new(true),
            dir: std::env::temp_dir(),
        };
        tauri::async_runtime::block_on(async {
            let mut found: Vec<scan::Found> = scan::all().into_iter().filter(|f| f.source == "local").collect();
            for f in &mut found {
                f.guess = meta::auto_smart(&st.http, &found_names(f), true).await.flatten();
                println!("{:28} -> {}", f.title, f.guess.as_ref().map(|g| format!("{} ({})", g.title, g.source)).unwrap_or("-".into()));
            }
            let picked: Vec<scan::Found> = found.into_iter().filter(|f| f.guess.is_some()).collect();
            let mut metas = vec![];
            for f in &picked { metas.push(meta_for_found(&st, f, true).await); }
            let c = st.db.lock().unwrap();
            for (f, m) in picked.iter().zip(&metas) {
                let (id, _) = save_found(&c, f, m).unwrap();
                println!("saved {id}: cover={} launch={}", m["cover"].is_string(), m["launch"].is_string());
            }
        });
    }
}
