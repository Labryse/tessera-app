//! A damaged database is caught when Tessera starts: the files are copied aside
//! untouched, every readable row is moved into a fresh database, and the fresh
//! one takes its place. The user is told once.

use rusqlite::types::Value as Sql;
use rusqlite::{Connection, OpenFlags};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// "ok", or the first problems SQLite found
pub fn check(path: &Path) -> Result<(), String> {
    let c = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE).map_err(|e| e.to_string())?;
    let rows: Vec<String> = c
        .prepare("PRAGMA quick_check(5)")
        .and_then(|mut s| s.query_map([], |r| r.get::<_, String>(0)).map(|it| it.flatten().collect()))
        .map_err(|e| e.to_string())?;
    if rows.len() == 1 && rows[0] == "ok" { Ok(()) } else { Err(rows.join("; ")) }
}

/// when the database is damaged: back it up, rebuild it; returns a line for the user
pub fn if_needed(path: &Path) -> Option<String> {
    if !path.exists() {
        return None;
    }
    let problem = match check(path) {
        Ok(()) => return None,
        Err(p) => p,
    };
    let dir = path.parent()?;
    let stamp = crate::db::now();
    let backup = dir.join(format!("backup-damaged-{stamp}"));
    std::fs::create_dir_all(&backup).ok()?;
    for ext in ["", "-wal", "-shm"] {
        let f = with_ext(path, ext);
        if f.exists() {
            std::fs::copy(&f, backup.join(format!("tessera.db{ext}"))).ok()?;
        }
    }
    log::warn!("database damaged ({problem}); rebuilding, originals in {}", backup.display());
    let fresh = dir.join("tessera.rebuild.db");
    let _ = std::fs::remove_file(&fresh);
    match rebuild(path, &fresh) {
        Ok(n) => {
            for ext in ["-wal", "-shm"] {
                let _ = std::fs::remove_file(with_ext(path, ext));
            }
            if std::fs::rename(&fresh, path).is_err() {
                return Some(crate::l("Kütüphane veritabanında hata bulundu ama onarılamadı. Yedek: ", "Found an error in the library database but could not repair it. Backup: ").to_string() + &backup.display().to_string());
            }
            Some(crate::tr!("Kütüphane veritabanında hata bulundu ve onarıldı ({n} kayıt kurtarıldı). Eski dosyalar yedeklendi.", "Found an error in the library database and repaired it ({n} records recovered). The old files were backed up."))
        }
        Err(e) => {
            log::warn!("rebuild failed: {e}");
            let _ = std::fs::remove_file(&fresh);
            Some(crate::l("Kütüphane veritabanında hata bulundu ama onarılamadı. Dosyalar yedeklendi.", "Found an error in the library database but could not repair it. The files were backed up.").into())
        }
    }
}

fn with_ext(p: &Path, ext: &str) -> PathBuf {
    PathBuf::from(format!("{}{ext}", p.display()))
}

/// copies every readable row into a new database with the same tables and indexes
pub fn rebuild(old_path: &Path, new_path: &Path) -> Result<usize, String> {
    let e = |x: rusqlite::Error| x.to_string();
    let old = Connection::open(old_path).map_err(e)?;
    let mut new = Connection::open(new_path).map_err(e)?;
    let objs: Vec<(String, String, String)> = old
        .prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'")
        .map_err(e)?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .map_err(e)?
        .flatten()
        .collect();
    let version: i64 = old.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap_or(0);
    let tx = new.transaction().map_err(e)?;
    let mut total = 0;
    for (_, name, sql) in objs.iter().filter(|o| o.0 == "table") {
        tx.execute_batch(sql).map_err(e)?;
        let cols: Vec<String> = old
            .prepare(&format!("PRAGMA table_info(\"{name}\")"))
            .map_err(e)?
            .query_map([], |r| r.get::<_, String>(1))
            .map_err(e)?
            .flatten()
            .collect();
        let list = cols.iter().map(|c| format!("\"{c}\"")).collect::<Vec<_>>().join(",");
        let rows = read_rows(&old, name, &list, cols.len());
        // a row written twice by the damage: the newest copy wins (games carry updated_at)
        let rows = if cols.iter().any(|c| c == "updated_at") && cols.first().is_some_and(|c| c == "id") {
            newest_per_key(rows, cols.iter().position(|c| c == "updated_at").unwrap_or(0))
        } else {
            rows
        };
        let mut ins = tx
            .prepare(&format!("INSERT OR REPLACE INTO \"{name}\" ({list}) VALUES ({})", vec!["?"; cols.len()].join(",")))
            .map_err(e)?;
        for r in rows {
            if ins.execute(rusqlite::params_from_iter(r.iter())).is_ok() {
                total += 1;
            }
        }
    }
    for (_, _, sql) in objs.iter().filter(|o| o.0 != "table") {
        tx.execute_batch(sql).map_err(e)?;
    }
    tx.execute_batch(&format!("PRAGMA user_version = {version}")).map_err(e)?;
    tx.commit().map_err(e)?;
    drop(old);
    let ok: String = new.query_row("PRAGMA integrity_check", [], |r| r.get(0)).map_err(e)?;
    if ok != "ok" {
        return Err(ok);
    }
    Ok(total)
}

/// a full scan, or row by row when the scan stops at the damage
fn read_rows(c: &Connection, name: &str, list: &str, n: usize) -> Vec<Vec<Sql>> {
    let grab = |r: &rusqlite::Row| -> rusqlite::Result<Vec<Sql>> { (0..n).map(|i| r.get::<_, Sql>(i)).collect() };
    let full: rusqlite::Result<Vec<Vec<Sql>>> = c
        .prepare(&format!("SELECT {list} FROM \"{name}\""))
        .and_then(|mut s| s.query_map([], grab).and_then(|it| it.collect()));
    if let Ok(v) = full {
        return v;
    }
    let max: i64 = c.query_row(&format!("SELECT max(rowid) FROM \"{name}\""), [], |r| r.get(0)).unwrap_or(20_000);
    let Ok(mut one) = c.prepare(&format!("SELECT {list} FROM \"{name}\" WHERE rowid = ?1")) else { return vec![] };
    (1..=max).filter_map(|i| one.query_row([i], grab).ok()).collect()
}

/// key = first column
fn newest_per_key(rows: Vec<Vec<Sql>>, at: usize) -> Vec<Vec<Sql>> {
    let stamp = |r: &Vec<Sql>| match r.get(at) { Some(Sql::Integer(i)) => *i, _ => 0 };
    let mut best: HashMap<String, Vec<Sql>> = HashMap::new();
    for r in rows {
        let Some(Sql::Text(k)) = r.first().cloned() else { continue };
        match best.get(&k) {
            Some(b) if stamp(b) >= stamp(&r) => {}
            _ => { best.insert(k, r); }
        }
    }
    best.into_values().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "works on a copy of a damaged database given in DAMAGED_DB"]
    fn repairs_a_real_damaged_copy() {
        let src = PathBuf::from(std::env::var("DAMAGED_DB").unwrap());
        let dir = std::env::temp_dir().join("tessera-repair-real");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        for ext in ["", "-wal", "-shm"] {
            let f = with_ext(&src, ext);
            if f.exists() {
                std::fs::copy(&f, with_ext(&dir.join("tessera.db"), ext)).unwrap();
            }
        }
        println!("before: {:?}", check(&dir.join("tessera.db")).err().map(|e| e.chars().take(80).collect::<String>()));
        println!("note: {:?}", if_needed(&dir.join("tessera.db")));
        let c = Connection::open(dir.join("tessera.db")).unwrap();
        let n: i64 = c.query_row("SELECT count(*) FROM games", [], |r| r.get(0)).unwrap();
        let s: i64 = c.query_row("SELECT count(*) FROM sessions", [], |r| r.get(0)).unwrap();
        println!("after: {:?} games {n} sessions {s}", check(&dir.join("tessera.db")));
    }

    #[test]
    fn rebuild_keeps_rows_and_newest_duplicates() {
        let dir = std::env::temp_dir().join("tessera-repair-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let old = dir.join("old.db");
        {
            let c = Connection::open(&old).unwrap();
            // no key constraint here, so the "damage" (a row twice) can be set up
            c.execute_batch("CREATE TABLE games (id TEXT, title TEXT, updated_at INTEGER); CREATE INDEX g_title ON games(title);
                INSERT INTO games VALUES ('a', 'Old', 1); INSERT INTO games VALUES ('a', 'New', 2); INSERT INTO games VALUES ('b', 'B', 1);
                CREATE TABLE notes (k TEXT PRIMARY KEY, v TEXT); INSERT INTO notes VALUES ('x', 'y'); PRAGMA user_version = 3;").unwrap();
        }
        let n = rebuild(&old, &dir.join("new.db")).unwrap();
        let c = Connection::open(dir.join("new.db")).unwrap();
        let titles: Vec<String> = c.prepare("SELECT title FROM games ORDER BY id").unwrap().query_map([], |r| r.get(0)).unwrap().flatten().collect();
        assert_eq!(titles, ["New", "B"]);
        assert_eq!(n, 3);
        assert_eq!(c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0)).unwrap(), 3);
        assert!(check(&dir.join("new.db")).is_ok());
        assert!(if_needed(&dir.join("new.db")).is_none(), "a healthy database is left alone");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
