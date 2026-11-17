//! Library backup, RetroAchievements and SteamGridDB.
//!
//! Every outside account here is optional and the user's own: the keys they
//! paste go to Windows Credential Manager, never into the database.

use crate::{db, AppState};
use md5::{Digest, Md5};
use rusqlite::params;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::io::Read;
use std::path::Path;
use tauri::State;

type Res<T> = Result<T, String>;
fn e<E: std::fmt::Display>(err: E) -> String {
    err.to_string()
}

// ---------------------------------------------------------------- backup

/// everything that is the user's own: ratings, notes, reviews, tags, sessions
#[tauri::command]
pub fn export_library(st: State<AppState>, path: String, extra: Value) -> Res<usize> {
    let c = st.db.lock().unwrap();
    let mut stmt = c.prepare("SELECT id, title, platform, user_json FROM games").map_err(e)?;
    let games: Vec<(String, String, String, Option<String>)> =
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).map_err(e)?.flatten().collect();
    let mut sess = c.prepare("SELECT game_id, start, end FROM sessions WHERE open = 0").map_err(e)?;
    let sessions: Vec<(String, i64, i64)> = sess.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).map_err(e)?.flatten().collect();
    let out: Vec<Value> = games
        .iter()
        .map(|(id, title, platform, user)| {
            json!({
                "id": id, "title": title, "platform": platform,
                "user": user.as_deref().and_then(|u| serde_json::from_str::<Value>(u).ok()),
                "sessions": sessions.iter().filter(|s| &s.0 == id).map(|s| json!([s.1, s.2])).collect::<Vec<_>>(),
            })
        })
        .collect();
    let doc = json!({ "app": "Tessera", "format": 1, "exportedAt": db::now(), "games": out, "extra": extra });
    std::fs::write(&path, serde_json::to_vec_pretty(&doc).map_err(e)?).map_err(|err| crate::tr!("Dosya yazılamadı: {err}", "Could not write the file: {err}"))?;
    Ok(games.len())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    matched: usize,
    missing: usize,
    sessions: usize,
    extra: Value,
}

fn union(a: &Value, b: &Value, key: Option<&str>) -> Value {
    let mut seen = HashSet::new();
    let mut out = vec![];
    for v in a.as_array().into_iter().flatten().chain(b.as_array().into_iter().flatten()) {
        let k = match key { Some(k) => v[k].to_string(), None => v.to_string() };
        if seen.insert(k) {
            out.push(v.clone());
        }
    }
    Value::Array(out)
}

/// merges a backup into this library: nothing here is overwritten, lists are joined
fn merge_user(local: &Value, incoming: &Value) -> Value {
    if local.is_null() {
        return incoming.clone();
    }
    let mut m = local.clone();
    for k in ["status", "rating", "review", "favorite", "art"] {
        if m[k].is_null() && !incoming[k].is_null() {
            m[k] = incoming[k].clone();
        }
    }
    if m["axes"].as_object().is_none_or(|o| o.is_empty()) && incoming["axes"].is_object() {
        m["axes"] = incoming["axes"].clone();
    }
    m["notes"] = union(&local["notes"], &incoming["notes"], Some("id"));
    m["tags"] = union(&local["tags"], &incoming["tags"], None);
    m["collections"] = union(&local["collections"], &incoming["collections"], None);
    m
}

#[tauri::command]
pub fn import_library(st: State<AppState>, path: String) -> Res<ImportReport> {
    let doc: Value = serde_json::from_str(&std::fs::read_to_string(&path).map_err(e)?).map_err(|_| crate::l("Bu bir Tessera yedeği değil.", "This is not a Tessera backup.").to_string())?;
    if doc["app"] != "Tessera" {
        return Err(crate::l("Bu bir Tessera yedeği değil.", "This is not a Tessera backup.").into());
    }
    let c = st.db.lock().unwrap();
    let (mut matched, mut missing, mut sessions) = (0, 0, 0);
    for g in doc["games"].as_array().into_iter().flatten() {
        let Some(id) = g["id"].as_str() else { continue };
        let local: Option<Option<String>> = c.query_row("SELECT user_json FROM games WHERE id = ?1", params![id], |r| r.get(0)).ok();
        let Some(local) = local else {
            missing += 1;
            continue;
        };
        matched += 1;
        let local: Value = local.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null);
        if !g["user"].is_null() {
            db::set_user(&c, id, &merge_user(&local, &g["user"])).map_err(e)?;
        }
        for s in g["sessions"].as_array().into_iter().flatten() {
            let (Some(start), Some(end)) = (s[0].as_i64(), s[1].as_i64()) else { continue };
            let exists: bool = c.query_row("SELECT 1 FROM sessions WHERE game_id = ?1 AND start = ?2", params![id, start], |_| Ok(true)).unwrap_or(false);
            if !exists {
                c.execute("INSERT INTO sessions (game_id, start, end, open) VALUES (?1, ?2, ?3, 0)", params![id, start, end]).map_err(e)?;
                sessions += 1;
            }
        }
    }
    Ok(ImportReport { matched, missing, sessions, extra: doc["extra"].clone() })
}

// ---------------------------------------------------------------- RetroAchievements

const RA_KEY: &str = "retroachievements-key";
const RA: &str = "https://retroachievements.org";

fn ra_user(st: &AppState) -> Option<String> {
    db::setting(&st.db.lock().unwrap(), "raUser").and_then(|v| v.as_str().map(str::to_string))
}

/// name and key of the connected RetroAchievements account
pub(crate) fn ra_login(st: &AppState) -> Option<(String, String)> {
    Some((ra_user(st)?, crate::secret_get(RA_KEY)?))
}

/// the RetroAchievements id of a ROM in the library (found by its hash, kept in meta)
async fn ra_lookup(st: &AppState, id: &str) -> Res<Option<i64>> {
    let m = {
        let c = st.db.lock().unwrap();
        db::game_launch(&c, id).map_err(e)?.ok_or(crate::l("Oyun bulunamadı.", "Game not found."))?.3
    };
    if let Some(n) = m["raGameId"].as_i64() {
        return Ok(Some(n));
    }
    let rom = m["romPath"].as_str().ok_or(crate::l("ROM yolu yok.", "No ROM path."))?.to_string();
    if rom.to_lowercase().ends_with(".7z") {
        return Err(crate::l("Sıkıştırılmış ROM’lar için başarım eşleşmesi henüz yok.", "Compressed ROMs can’t be matched for achievements yet.").into());
    }
    let sys = m["system"].as_str().unwrap_or_default().to_string();
    let mut next = m.clone();
    let hash = match m["raHash"].as_str() {
        Some(h) => h.to_string(),
        None => {
            let (r, s) = (rom.clone(), sys.clone());
            let h = tauri::async_runtime::spawn_blocking(move || ra_hash(Path::new(&r), &s)).await.map_err(e)?.ok_or(crate::l("ROM okunamadı.", "Could not read the ROM."))?;
            next["raHash"] = json!(h);
            h
        }
    };
    let gid: Value = st.http.get(format!("{RA}/dorequest.php")).query(&[("r", "gameid"), ("m", hash.as_str())]).send().await.map_err(e)?.json().await.map_err(e)?;
    let game_id = gid["GameID"].as_i64().unwrap_or(0);
    if game_id != 0 {
        next["raGameId"] = json!(game_id);
    }
    if next != m {
        db::set_meta(&st.db.lock().unwrap(), id, None, &next).map_err(e)?;
    }
    Ok((game_id != 0).then_some(game_id))
}

pub(crate) async fn ra_game_id(st: &AppState, id: &str) -> Option<i64> {
    ra_lookup(st, id).await.ok().flatten()
}

#[tauri::command]
pub fn ra_status(st: State<AppState>) -> Option<String> {
    crate::secret_get(RA_KEY).and(ra_user(&st))
}

/// checks the name and key against the site before keeping them
#[tauri::command]
pub async fn ra_connect(st: State<'_, AppState>, user: String, key: String) -> Res<String> {
    let user = user.trim().to_string();
    let key = key.trim().to_string();
    let v: Value = st
        .http
        .get(format!("{RA}/API/API_GetUserProfile.php"))
        .query(&[("u", user.as_str()), ("y", key.as_str())])
        .send()
        .await
        .map_err(e)?
        .json()
        .await
        .map_err(|_| crate::l("RetroAchievements kullanıcı adı ya da anahtar yanlış.", "Wrong RetroAchievements username or key.").to_string())?;
    let name = v["User"].as_str().ok_or(crate::l("RetroAchievements kullanıcı adı ya da anahtar yanlış.", "Wrong RetroAchievements username or key."))?.to_string();
    crate::secret_set(RA_KEY, Some(&key))?;
    db::set_setting(&st.db.lock().unwrap(), "raUser", &json!(name)).map_err(e)?;
    Ok(name)
}

#[tauri::command]
pub fn ra_disconnect(st: State<AppState>) -> Res<()> {
    crate::secret_set(RA_KEY, None)?;
    db::set_setting(&st.db.lock().unwrap(), "raUser", &Value::Null).map_err(e)
}

/// RetroAchievements identifies a ROM by the MD5 of its contents
/// (for NES without the 16-byte iNES header, for SNES without a 512-byte copier header)
fn ra_hash(path: &Path, system: &str) -> Option<String> {
    let mut data = vec![];
    if path.extension().is_some_and(|e| e.eq_ignore_ascii_case("zip")) {
        // the ROM inside: the biggest file that is not a text or picture
        let mut z = zip::ZipArchive::new(std::fs::File::open(path).ok()?).ok()?;
        let skip = [".txt", ".nfo", ".diz", ".jpg", ".png", ".pdf", ".sav", ".srm"];
        let pick = (0..z.len())
            .filter_map(|i| z.by_index(i).ok().and_then(|e| Some((i, e.name().ok()?.to_lowercase(), e.size(), e.is_dir()))))
            .filter(|(_, n, _, d)| !d && !skip.iter().any(|x| n.ends_with(x)))
            .max_by_key(|x| x.2)?;
        z.by_index(pick.0).ok()?.read_to_end(&mut data).ok()?;
    } else {
        std::fs::File::open(path).ok()?.read_to_end(&mut data).ok()?;
    }
    let body: &[u8] = match system {
        "nes" if data.starts_with(b"NES\x1a") => &data[16..],
        "snes" if data.len() % 1024 == 512 => &data[512..],
        _ => &data,
    };
    Some(Md5::digest(body).iter().map(|b| format!("{b:02x}")).collect())
}

#[tauri::command]
pub async fn ra_achievements(st: State<'_, AppState>, id: String) -> Res<Value> {
    let (Some(user), Some(key)) = (ra_user(&st), crate::secret_get(RA_KEY)) else {
        return Ok(json!({ "needsAccount": true }));
    };
    let game_id = match ra_lookup(&st, &id).await {
        Ok(Some(n)) => n,
        Ok(None) => return Ok(json!({ "none": true })),
        Err(msg) if msg.starts_with(crate::l("Sıkıştırılmış", "Compressed")) => return Ok(json!({ "error": crate::l(".7z içindeki ROM’lar için başarım eşleşmesi yok; .zip ya da açık dosya kullan.", "ROMs inside .7z can’t be matched for achievements; use .zip or a plain file.") })),
        Err(msg) => return Err(msg),
    };
    let v: Value = st
        .http
        .get(format!("{RA}/API/API_GetGameInfoAndUserProgress.php"))
        .query(&[("g", game_id.to_string()), ("u", user.clone()), ("y", key)])
        .send()
        .await
        .map_err(e)?
        .json()
        .await
        .map_err(e)?;
    let players = v["NumDistinctPlayers"].as_f64().or_else(|| v["NumDistinctPlayers"].as_str().and_then(|s| s.parse().ok())).unwrap_or(0.0);
    let mut list: Vec<Value> = v["Achievements"]
        .as_object()
        .into_iter()
        .flat_map(|o| o.values())
        .map(|a| {
            let awarded = a["NumAwarded"].as_f64().or_else(|| a["NumAwarded"].as_str().and_then(|s| s.parse().ok())).unwrap_or(0.0);
            let earned = a["DateEarnedHardcore"].as_str().or(a["DateEarned"].as_str()).map(|d| d.replace(' ', "T") + "Z");
            json!({
                "api": a["ID"].to_string(),
                "name": a["Title"],
                "description": a["Description"].as_str().unwrap_or(""),
                "hidden": false,
                "icon": format!("https://media.retroachievements.org/Badge/{}.png", a["BadgeName"].as_str().unwrap_or("00000")),
                "percent": if players > 0.0 { Some(((awarded / players) * 1000.0).round() / 10.0) } else { None },
                "unlockedAt": earned,
                "order": a["DisplayOrder"],
            })
        })
        .collect();
    list.sort_by_key(|a| a["order"].as_i64().unwrap_or(0));
    Ok(json!({ "list": list, "raGameId": game_id, "raTitle": v["Title"], "user": user }))
}

// ---------------------------------------------------------------- SteamGridDB

const SGDB_KEY: &str = "steamgriddb-key";
const SGDB: &str = "https://www.steamgriddb.com/api/v2";

#[tauri::command]
pub fn sgdb_status() -> bool {
    crate::secret_get(SGDB_KEY).is_some()
}

#[tauri::command]
pub async fn sgdb_set_key(st: State<'_, AppState>, key: Option<String>) -> Res<()> {
    let Some(k) = key.map(|k| k.trim().to_string()).filter(|k| !k.is_empty()) else {
        return crate::secret_set(SGDB_KEY, None);
    };
    let r = st.http.get(format!("{SGDB}/search/autocomplete/tetris")).bearer_auth(&k).send().await.map_err(e)?;
    if !r.status().is_success() {
        return Err(crate::l("SteamGridDB anahtarı geçersiz.", "The SteamGridDB key is not valid.").into());
    }
    crate::secret_set(SGDB_KEY, Some(&k))
}

#[derive(Serialize)]
pub struct Art {
    url: String,
    thumb: String,
    author: String,
}

/// alternative covers ("grid"), banners ("hero") and logos ("logo") for a game
#[tauri::command]
pub async fn sgdb_images(st: State<'_, AppState>, id: String, kind: String) -> Res<Vec<Art>> {
    let key = crate::secret_get(SGDB_KEY).ok_or(crate::l("SteamGridDB anahtarı yok.", "No SteamGridDB key."))?;
    let (title, m) = {
        let c = st.db.lock().unwrap();
        let m = db::game_launch(&c, &id).map_err(e)?.ok_or(crate::l("Oyun bulunamadı.", "Game not found."))?.3;
        let t: String = c.query_row("SELECT title FROM games WHERE id = ?1", params![id], |r| r.get(0)).map_err(e)?;
        (t, m)
    };
    let steam = id.strip_prefix("steam:").map(str::to_string).or_else(|| m["steamAppId"].as_i64().map(|x| x.to_string()));
    let game: Value = match &steam {
        Some(appid) => st.http.get(format!("{SGDB}/games/steam/{appid}")).bearer_auth(&key).send().await.map_err(e)?.json().await.map_err(e)?,
        None => {
            let q = meta_name(&title);
            let v: Value = st.http.get(format!("{SGDB}/search/autocomplete/{}", urlencode(&q))).bearer_auth(&key).send().await.map_err(e)?.json().await.map_err(e)?;
            json!({ "data": v["data"][0] })
        }
    };
    let gid = game["data"]["id"].as_i64().ok_or(crate::l("SteamGridDB’de bu oyun bulunamadı.", "This game is not on SteamGridDB."))?;
    let (path, q): (&str, &[(&str, &str)]) = match kind.as_str() {
        "hero" => ("heroes", &[("types", "static")]),
        "logo" => ("logos", &[("types", "static")]),
        _ => ("grids", &[("dimensions", "600x900,342x482,660x930"), ("types", "static")]),
    };
    let v: Value = st.http.get(format!("{SGDB}/{path}/game/{gid}")).bearer_auth(&key).query(q).send().await.map_err(e)?.json().await.map_err(e)?;
    Ok(v["data"]
        .as_array()
        .into_iter()
        .flatten()
        .take(60)
        .filter_map(|a| {
            Some(Art {
                url: a["url"].as_str()?.into(),
                thumb: a["thumb"].as_str().unwrap_or(a["url"].as_str()?).into(),
                author: a["author"]["name"].as_str().unwrap_or("").into(),
            })
        })
        .collect())
}

fn meta_name(t: &str) -> String {
    t.split(" (").next().unwrap_or(t).trim().to_string()
}

fn urlencode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backups_merge_without_losing_anything() {
        let local = json!({ "status": "playing", "rating": null, "notes": [{ "id": "a", "text": "x" }], "tags": ["Co-op"], "collections": [] });
        let incoming = json!({ "status": "completed", "rating": 9, "notes": [{ "id": "a", "text": "x" }, { "id": "b", "text": "y" }], "tags": ["Co-op", "RPG"], "collections": ["Ekip"] });
        let m = merge_user(&local, &incoming);
        assert_eq!(m["status"], "playing", "local choice wins");
        assert_eq!(m["rating"], 9, "missing values are filled");
        assert_eq!(m["notes"].as_array().unwrap().len(), 2);
        assert_eq!(m["tags"], json!(["Co-op", "RPG"]));
        assert_eq!(m["collections"], json!(["Ekip"]));
    }

    #[test]
    fn nes_header_is_not_hashed() {
        let dir = std::env::temp_dir().join("tessera-ra");
        let _ = std::fs::create_dir_all(&dir);
        let p = dir.join("t.nes");
        let mut data = b"NES\x1a".to_vec();
        data.extend([0u8; 12]);
        data.extend(b"abc");
        std::fs::write(&p, &data).unwrap();
        assert_eq!(ra_hash(&p, "nes").unwrap(), "900150983cd24fb0d6963f7d28e17f72"); // md5("abc")
    }
}
