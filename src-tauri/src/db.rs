//! Local SQLite store. Everything Tessera knows lives in one file in the user's
//! app-data folder; nothing is sent to a Tessera server (there is none).

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;
use std::path::Path;

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS accounts (
            platform      TEXT PRIMARY KEY,
            external_id   TEXT NOT NULL,
            display_name  TEXT,
            method        TEXT NOT NULL,
            connected_at  INTEGER NOT NULL,
            last_sync     INTEGER
        );
        CREATE TABLE IF NOT EXISTS games (
            id            TEXT PRIMARY KEY,
            platform      TEXT NOT NULL,
            external_id   TEXT NOT NULL,
            title         TEXT NOT NULL,
            installed     INTEGER NOT NULL DEFAULT 0,
            install_dir   TEXT,
            size_bytes    INTEGER,
            playtime_min  INTEGER NOT NULL DEFAULT 0,
            last_played   INTEGER,
            meta_json     TEXT,
            user_json     TEXT,
            added_at      INTEGER NOT NULL,
            updated_at    INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS games_platform ON games(platform);
        CREATE TABLE IF NOT EXISTS meta_cache (
            key           TEXT PRIMARY KEY,
            json          TEXT NOT NULL,
            fetched_at    INTEGER NOT NULL
        );
        "#,
    )?;
    Ok(conn)
}

pub fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub platform: String,
    pub external_id: String,
    pub display_name: Option<String>,
    pub method: String,
    pub connected_at: i64,
    pub last_sync: Option<i64>,
}

pub fn accounts(c: &Connection) -> rusqlite::Result<Vec<Account>> {
    let mut st = c.prepare("SELECT platform, external_id, display_name, method, connected_at, last_sync FROM accounts")?;
    let rows = st.query_map([], |r| {
        Ok(Account {
            platform: r.get(0)?,
            external_id: r.get(1)?,
            display_name: r.get(2)?,
            method: r.get(3)?,
            connected_at: r.get(4)?,
            last_sync: r.get(5)?,
        })
    })?;
    rows.collect()
}

pub fn account(c: &Connection, platform: &str) -> rusqlite::Result<Option<Account>> {
    Ok(accounts(c)?.into_iter().find(|a| a.platform == platform))
}

pub fn save_account(c: &Connection, a: &Account) -> rusqlite::Result<()> {
    c.execute(
        "INSERT INTO accounts (platform, external_id, display_name, method, connected_at, last_sync)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(platform) DO UPDATE SET external_id = ?2, display_name = ?3, method = ?4, last_sync = ?6",
        params![a.platform, a.external_id, a.display_name, a.method, a.connected_at, a.last_sync],
    )?;
    Ok(())
}

pub fn touch_sync(c: &Connection, platform: &str) -> rusqlite::Result<()> {
    c.execute("UPDATE accounts SET last_sync = ?1 WHERE platform = ?2", params![now(), platform])?;
    Ok(())
}

pub fn delete_account(c: &Connection, platform: &str, remove_games: bool) -> rusqlite::Result<()> {
    c.execute("DELETE FROM accounts WHERE platform = ?1", params![platform])?;
    if remove_games {
        c.execute("DELETE FROM games WHERE platform = ?1", params![platform])?;
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameRow {
    pub id: String,
    pub platform: String,
    pub external_id: String,
    pub title: String,
    pub installed: bool,
    pub install_dir: Option<String>,
    pub size_bytes: Option<i64>,
    pub playtime_min: i64,
    pub last_played: Option<i64>,
    pub meta: Value,
    pub user: Value,
    pub added_at: i64,
    pub sessions: Vec<crate::tracker::SessionRow>,
}

pub fn games(c: &Connection) -> rusqlite::Result<Vec<GameRow>> {
    let mut st = c.prepare(
        "SELECT id, platform, external_id, title, installed, install_dir, size_bytes, playtime_min, last_played,
                meta_json, user_json, added_at FROM games ORDER BY title COLLATE NOCASE",
    )?;
    let rows = st.query_map([], |r| {
        let meta: Option<String> = r.get(9)?;
        let user: Option<String> = r.get(10)?;
        Ok(GameRow {
            id: r.get(0)?,
            platform: r.get(1)?,
            external_id: r.get(2)?,
            title: r.get(3)?,
            installed: r.get::<_, i64>(4)? != 0,
            install_dir: r.get(5)?,
            size_bytes: r.get(6)?,
            playtime_min: r.get(7)?,
            last_played: r.get(8)?,
            meta: meta.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null),
            user: user.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null),
            added_at: r.get(11)?,
            sessions: vec![],
        })
    })?;
    rows.collect()
}

/// The fields a sync owns. The user's own data (status, rating, notes…) is never touched here.
pub struct SyncedGame<'a> {
    pub id: &'a str,
    pub platform: &'a str,
    pub external_id: &'a str,
    pub title: &'a str,
    pub installed: bool,
    pub install_dir: Option<&'a str>,
    pub size_bytes: Option<i64>,
    pub playtime_min: i64,
    pub last_played: Option<i64>,
    pub meta: &'a Value,
}

/// returns true when the row is new
pub fn upsert_synced(c: &Connection, g: &SyncedGame) -> rusqlite::Result<bool> {
    let exists: bool = c
        .query_row("SELECT 1 FROM games WHERE id = ?1", params![g.id], |_| Ok(true))
        .optional()?
        .unwrap_or(false);
    let t = now();
    c.execute(
        "INSERT INTO games (id, platform, external_id, title, installed, install_dir, size_bytes, playtime_min,
                            last_played, meta_json, user_json, added_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, ?11, ?11)
         ON CONFLICT(id) DO UPDATE SET
            title = ?4, installed = ?5, install_dir = ?6, size_bytes = ?7, playtime_min = MAX(playtime_min, ?8),
            last_played = MAX(COALESCE(last_played, 0), COALESCE(?9, 0)), updated_at = ?11,
            meta_json = CASE WHEN json_type(?10) IS NOT 'object' THEN meta_json ELSE json_patch(json_object(
                'metacritic', meta_json -> '$.metacritic', 'genres', meta_json -> '$.genres', 'scoresAt', meta_json -> '$.scoresAt',
                'storeTags', meta_json -> '$.storeTags', 'tagGenres', meta_json -> '$.tagGenres', 'features', meta_json -> '$.features',
                'userScore', meta_json -> '$.userScore', 'reviewCount', meta_json -> '$.reviewCount'), ?10) END",
        params![
            g.id,
            g.platform,
            g.external_id,
            g.title,
            g.installed as i64,
            g.install_dir,
            g.size_bytes,
            g.playtime_min,
            g.last_played,
            g.meta.to_string(),
            t
        ],
    )?;
    Ok(!exists)
}

/// a game found on disk that the library still thought was not installed
pub fn mark_installed(c: &Connection, id: &str, dir: Option<&str>, size: Option<i64>) -> rusqlite::Result<bool> {
    let n = c.execute(
        "UPDATE games SET installed = 1, install_dir = COALESCE(?2, install_dir), size_bytes = COALESCE(?3, size_bytes), updated_at = ?4
         WHERE id = ?1 AND installed = 0",
        params![id, dir, size, now()],
    )?;
    Ok(n > 0)
}

pub fn mark_uninstalled_except(c: &Connection, platform: &str, keep: &[String]) -> rusqlite::Result<()> {
    let mut st = c.prepare("SELECT id FROM games WHERE platform = ?1 AND installed = 1")?;
    let ids: Vec<String> = st.query_map(params![platform], |r| r.get(0))?.collect::<Result<_, _>>()?;
    for id in ids {
        if !keep.contains(&id) {
            c.execute("UPDATE games SET installed = 0, size_bytes = NULL WHERE id = ?1", params![id])?;
        }
    }
    Ok(())
}

pub fn set_user(c: &Connection, id: &str, user: &Value) -> rusqlite::Result<()> {
    c.execute("UPDATE games SET user_json = ?1 WHERE id = ?2", params![user.to_string(), id])?;
    Ok(())
}


pub fn cache_get(c: &Connection, key: &str, max_age_secs: i64) -> Option<Value> {
    c.query_row(
        "SELECT json, fetched_at FROM meta_cache WHERE key = ?1",
        params![key],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)),
    )
    .optional()
    .ok()
    .flatten()
    .filter(|(_, at)| now() - at < max_age_secs)
    .and_then(|(s, _)| serde_json::from_str(&s).ok())
}

pub fn cache_put(c: &Connection, key: &str, v: &Value) -> rusqlite::Result<()> {
    c.execute(
        "INSERT INTO meta_cache (key, json, fetched_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET json = ?2, fetched_at = ?3",
        params![key, v.to_string(), now()],
    )?;
    Ok(())
}

pub fn game_launch(c: &Connection, id: &str) -> rusqlite::Result<Option<(String, String, bool, Value)>> {
    c.query_row(
        "SELECT platform, external_id, installed, meta_json FROM games WHERE id = ?1",
        params![id],
        |r| {
            let meta: Option<String> = r.get(3)?;
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get::<_, i64>(2)? != 0,
                meta.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null),
            ))
        },
    )
    .optional()
}

pub fn ids(c: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut st = c.prepare("SELECT id FROM games")?;
    let rows = st.query_map([], |r| r.get(0))?;
    rows.collect()
}

pub fn set_meta(c: &Connection, id: &str, title: Option<&str>, meta: &Value) -> rusqlite::Result<()> {
    match title {
        Some(t) => c.execute("UPDATE games SET meta_json = ?1, title = ?2, updated_at = ?3 WHERE id = ?4", params![meta.to_string(), t, now(), id])?,
        None => c.execute("UPDATE games SET meta_json = ?1, updated_at = ?2 WHERE id = ?3", params![meta.to_string(), now(), id])?,
    };
    Ok(())
}

pub fn setting(c: &Connection, key: &str) -> Option<Value> {
    cache_get(c, &format!("setting:{key}"), i64::MAX / 4)
}

pub fn set_setting(c: &Connection, key: &str, v: &Value) -> rusqlite::Result<()> {
    cache_put(c, &format!("setting:{key}"), v)
}

#[cfg(test)]
mod sync_tests {
    use super::*;

    #[test]
    fn a_store_sync_keeps_scores_found_later() {
        let c = open(Path::new(":memory:")).unwrap();
        fn g(meta: &Value) -> SyncedGame<'_> {
            SyncedGame {
            id: "steam:1", platform: "steam", external_id: "1", title: "X", installed: true, install_dir: None,
            size_bytes: None, playtime_min: 0, last_played: None, meta,
        }
        }
        upsert_synced(&c, &g(&serde_json::json!({ "name": "X" }))).unwrap();
        set_meta(&c, "steam:1", None, &serde_json::json!({ "name": "X", "metacritic": 90, "genres": ["Aksiyon"], "storeTags": ["Roguelike"] })).unwrap();
        upsert_synced(&c, &g(&serde_json::json!({ "name": "X2", "storeTags": ["Yeni"] }))).unwrap();
        // a store lookup that failed this time must not wipe what is there
        upsert_synced(&c, &g(&Value::Null)).unwrap();
        let m: String = c.query_row("SELECT meta_json FROM games WHERE id = 'steam:1'", [], |r| r.get(0)).unwrap();
        let m: Value = serde_json::from_str(&m).unwrap();
        assert_eq!(m["name"], "X2");
        assert_eq!(m["metacritic"], 90);
        assert_eq!(m["genres"], serde_json::json!(["Aksiyon"]));
        assert_eq!(m["storeTags"], serde_json::json!(["Yeni"]));
    }

    #[test]
    fn a_found_install_flips_the_flag_once() {
        let c = open(Path::new(":memory:")).unwrap();
        let meta = serde_json::json!({});
        upsert_synced(&c, &SyncedGame {
            id: "steam:2", platform: "steam", external_id: "2", title: "Y", installed: false, install_dir: None,
            size_bytes: None, playtime_min: 0, last_played: None, meta: &meta,
        }).unwrap();
        assert!(mark_installed(&c, "steam:2", Some("D:/Games/Y"), Some(10)).unwrap());
        assert!(!mark_installed(&c, "steam:2", None, None).unwrap());
        let (i, d): (bool, String) = c.query_row("SELECT installed, install_dir FROM games WHERE id = 'steam:2'", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert!(i);
        assert_eq!(d, "D:/Games/Y");
    }
}
