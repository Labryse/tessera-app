//! Play-time tracking. A game counts as running while any process runs from its
//! install folder; that works the same whether it was started from Tessera, from
//! Steam or from a desktop shortcut. Sessions are written when they start and
//! refreshed every minute, so a crash loses at most a minute.

use crate::db;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::path::Path;
use std::time::{Duration, Instant};
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
use tauri::{AppHandle, Emitter, Manager};

const TICK: Duration = Duration::from_secs(3);
/// a game must be gone for this many ticks before its session ends
const GRACE_TICKS: u32 = 3;
/// a launch from Tessera "arms" a game for this long (for launched-only mode)
const ARM_FOR: Duration = Duration::from_secs(15 * 60);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Live {
    pub game_id: String,
    pub title: String,
    pub since: i64,
    /// what the game says about itself ("Ranked · Dust II"), when it says anything
    pub presence: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionEvent {
    pub kind: &'static str,
    pub game_id: String,
    pub title: String,
    pub since: i64,
    pub minutes: i64,
}

struct Active {
    row: i64,
    title: String,
    start: i64,
    missing: u32,
    beat: Instant,
    presence: Option<String>,
}

pub struct Tracker {
    /// count games started outside Tessera too
    pub all: AtomicBool,
    /// emulators started for a ROM: (emulator folder, game id, title, when)
    extra: Mutex<Vec<(String, String, String, Instant)>>,
    armed: Mutex<HashMap<String, Instant>>,
    live: Mutex<HashMap<String, Active>>,
    dirty: AtomicBool,
}

impl Tracker {
    pub fn new(all: bool) -> Self {
        Self { all: AtomicBool::new(all), extra: Mutex::new(vec![]), armed: Mutex::new(HashMap::new()), live: Mutex::new(HashMap::new()), dirty: AtomicBool::new(true) }
    }
    pub fn arm(&self, game_id: &str) {
        self.armed.lock().unwrap().insert(game_id.to_string(), Instant::now());
    }
    /// an emulator was started for a ROM: its processes count for that game
    pub fn watch_emulator(&self, dir: &Path, game_id: &str, title: &str) {
        let d = format!("{}\\", dir.to_string_lossy().to_lowercase().trim_end_matches('\\'));
        let mut x = self.extra.lock().unwrap();
        x.retain(|(_, id, _, _)| id != game_id);
        x.push((d, game_id.to_string(), title.to_string(), Instant::now()));
        self.arm(game_id);
    }
    /// the library changed (sync, import): reload the folders to watch
    pub fn touch(&self) {
        self.dirty.store(true, Ordering::Relaxed);
    }
    pub fn live(&self) -> Vec<Live> {
        self.live.lock().unwrap().iter().map(|(id, a)| Live { game_id: id.clone(), title: a.title.clone(), since: a.start, presence: a.presence.clone() }).collect()
    }
    /// a new line from the game; returns its session row when it changed
    pub fn set_presence(&self, game_id: &str, text: Option<String>) -> Option<i64> {
        let mut live = self.live.lock().unwrap();
        let a = live.get_mut(game_id)?;
        if a.presence == text {
            return None;
        }
        a.presence = text;
        Some(a.row)
    }
}

pub fn schema(c: &Connection) -> rusqlite::Result<()> {
    c.execute_batch(
        "CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY,
            game_id TEXT NOT NULL,
            start INTEGER NOT NULL,
            end INTEGER NOT NULL,
            open INTEGER NOT NULL DEFAULT 1
        );
        CREATE INDEX IF NOT EXISTS sessions_game ON sessions(game_id);",
    )?;
    // the last thing the game said during the session (added later)
    let has: bool = c.prepare("SELECT 1 FROM pragma_table_info('sessions') WHERE name = 'presence'")?.exists([])?;
    if !has {
        c.execute("ALTER TABLE sessions ADD COLUMN presence TEXT", [])?;
    }
    // sessions left open by a crash end at their last heartbeat
    c.execute("DELETE FROM sessions WHERE open = 1 AND end - start < 60", [])?;
    c.execute("UPDATE sessions SET open = 0 WHERE open = 1", [])?;
    Ok(())
}

/// folders that would match far too much
fn too_broad(dir: &str) -> bool {
    let d = dir.trim_end_matches('\\');
    d.len() < 8
        || d.ends_with(r"\program files")
        || d.ends_with(r"\program files (x86)")
        || d.ends_with(r"\desktop")
        || d.ends_with(r"\downloads")
        || d.ends_with(r"\documents")
        || d.ends_with(r"\appdata\local")
        || d.ends_with(r"\appdata\roaming")
        || d.ends_with(r"\steamapps\common")
}

fn watch_list(c: &Connection) -> Vec<(String, String, String)> {
    let mut st = match c.prepare("SELECT id, title, install_dir FROM games WHERE installed = 1 AND install_dir IS NOT NULL") {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)));
    let mut out: Vec<(String, String, String)> = rows
        .map(|it| it.flatten().collect())
        .unwrap_or_default();
    out.retain(|(_, _, d)| !too_broad(&d.to_lowercase()));
    // longest folders first, so a game inside another game's folder wins
    out.sort_by_key(|(_, _, d)| std::cmp::Reverse(d.len()));
    out.into_iter().map(|(id, t, d)| (format!("{}\\", d.to_lowercase().trim_end_matches('\\')), id, t)).collect()
}

pub struct Watcher {
    sys: System,
    dirs: Vec<(String, String, String)>,
    loaded: Instant,
    me: u32,
}

impl Watcher {
    pub fn new() -> Self {
        Self { sys: System::new(), dirs: vec![], loaded: Instant::now() - Duration::from_secs(3600), me: std::process::id() }
    }

    /// one look at the running processes; starts and ends sessions
    pub fn step(&mut self, state: &crate::AppState, emit: &mut dyn FnMut(SessionEvent)) {
        let tr = &state.tracker;
        if tr.dirty.swap(false, Ordering::Relaxed) || self.loaded.elapsed() > Duration::from_secs(60) {
            self.dirs = watch_list(&state.db.lock().unwrap());
            self.loaded = Instant::now();
        }
        let extra: Vec<(String, String, String)> = {
            let mut x = tr.extra.lock().unwrap();
            let live = tr.live.lock().unwrap();
            x.retain(|(_, id, _, at)| live.contains_key(id) || at.elapsed() < ARM_FOR);
            x.iter().map(|(d, id, t, _)| (d.clone(), id.clone(), t.clone())).collect()
        };
        if self.dirs.is_empty() && extra.is_empty() {
            return;
        }
        self.sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet));
        let mut running: HashMap<String, String> = HashMap::new();
        for (pid, p) in self.sys.processes() {
            if pid.as_u32() == self.me {
                continue;
            }
            let Some(exe) = p.exe() else { continue };
            let exe = exe.to_string_lossy().to_lowercase();
            if let Some((_, id, title)) = extra.iter().chain(self.dirs.iter()).find(|(d, _, _)| exe.starts_with(d.as_str())) {
                running.insert(id.clone(), title.clone());
            }
        }

        let finished = self.update(state, running, emit);
        for id in finished {
            tr.extra.lock().unwrap().retain(|(_, g, _, _)| g != &id);
            crate::retro_cmds::after_session(state, &id);
        }
    }

    /// starts and ends sessions; returns the games whose session just ended
    fn update(&mut self, state: &crate::AppState, running: HashMap<String, String>, emit: &mut dyn FnMut(SessionEvent)) -> Vec<String> {
        let tr = &state.tracker;
        let now = db::now();
        let all = tr.all.load(Ordering::Relaxed);
        let mut armed = tr.armed.lock().unwrap();
        armed.retain(|_, t| t.elapsed() < ARM_FOR);
        let mut live = tr.live.lock().unwrap();
        let c = state.db.lock().unwrap();

        // new sessions
        for (id, title) in &running {
            if live.contains_key(id) || !(all || armed.contains_key(id)) {
                continue;
            }
            armed.remove(id);
            if c.execute("INSERT INTO sessions (game_id, start, end, open) VALUES (?1, ?2, ?2, 1)", params![id, now]).is_ok() {
                live.insert(id.clone(), Active { row: c.last_insert_rowid(), title: title.clone(), start: now, missing: 0, beat: Instant::now(), presence: None });
                emit(SessionEvent { kind: "start", game_id: id.clone(), title: title.clone(), since: now, minutes: 0 });
            }
        }

        // running ones: heartbeat; gone ones: close after a short grace
        let mut ended = vec![];
        let seen: HashSet<&String> = running.keys().collect();
        for (id, a) in live.iter_mut() {
            if seen.contains(id) {
                a.missing = 0;
                if a.beat.elapsed() > Duration::from_secs(60) {
                    let _ = c.execute("UPDATE sessions SET end = ?1 WHERE id = ?2", params![now, a.row]);
                    a.beat = Instant::now();
                }
            } else {
                a.missing += 1;
                if a.missing >= GRACE_TICKS {
                    ended.push(id.clone());
                }
            }
        }
        let mut finished = vec![];
        for id in ended {
            let a = live.remove(&id).unwrap();
            finished.push(id.clone());
            let end = now - (GRACE_TICKS as i64 * TICK.as_secs() as i64);
            let minutes = (end - a.start).max(0) / 60;
            if minutes < 1 {
                let _ = c.execute("DELETE FROM sessions WHERE id = ?1", params![a.row]);
            } else {
                let _ = c.execute("UPDATE sessions SET end = ?1, open = 0 WHERE id = ?2", params![end, a.row]);
                let _ = c.execute("UPDATE games SET last_played = MAX(COALESCE(last_played, 0), ?1) WHERE id = ?2", params![end, id]);
            }
            emit(SessionEvent { kind: "end", game_id: id, title: a.title, since: a.start, minutes });
        }
        finished
    }
}

pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let mut w = Watcher::new();
        // what is running, for the tray's tooltip
        let mut running: Vec<(String, String)> = vec![];
        loop {
            std::thread::sleep(TICK);
            let state = app.state::<crate::AppState>();
            let mut changed = false;
            let mut ended = vec![];
            w.step(&state, &mut |ev| {
                if ev.kind == "start" {
                    running.push((ev.game_id.clone(), ev.title.clone()));
                } else {
                    running.retain(|(id, _)| id != &ev.game_id);
                    ended.push((ev.title.clone(), ev.minutes));
                }
                changed = true;
                let _ = app.emit("session", ev);
            });
            if changed {
                crate::shell::tray_tooltip(&app, &running.iter().map(|(_, t)| t.clone()).collect::<Vec<_>>());
            }
            for (title, minutes) in ended {
                crate::shell::session_ended(&app, &title, minutes);
            }
        }
    });
}

/// on exit: close what is still running at this moment
pub fn flush(app: &AppHandle) {
    let state = app.state::<crate::AppState>();
    let live: Vec<Active> = state.tracker.live.lock().unwrap().drain().map(|(_, a)| a).collect();
    let c = state.db.lock().unwrap();
    let now = db::now();
    for a in live {
        if now - a.start < 60 {
            let _ = c.execute("DELETE FROM sessions WHERE id = ?1", params![a.row]);
        } else {
            let _ = c.execute("UPDATE sessions SET end = ?1, open = 0 WHERE id = ?2", params![now, a.row]);
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRow {
    pub start: i64,
    pub minutes: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub presence: Option<String>,
}

/// every finished (or live) session per game, oldest first
pub fn all_sessions(c: &Connection) -> HashMap<String, Vec<SessionRow>> {
    let mut out: HashMap<String, Vec<SessionRow>> = HashMap::new();
    let Ok(mut st) = c.prepare("SELECT game_id, start, end, presence FROM sessions ORDER BY start") else { return out };
    let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?, r.get::<_, Option<String>>(3)?)));
    if let Ok(rows) = rows {
        for (id, start, end, presence) in rows.flatten() {
            out.entry(id).or_default().push(SessionRow { start, minutes: ((end - start) / 60).max(0), presence });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// a harmless program run from a fake game folder must open and close one session
    #[test]
    #[ignore = "runs for about 80 seconds"]
    fn tracks_a_process_from_the_game_folder() {
        let base = std::env::temp_dir().join("tessera-track-test");
        let game = base.join("Fake Game");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&game).unwrap();
        let exe = game.join("fakegame.exe");
        std::fs::copy(r"C:\Windows\System32\PING.EXE", &exe).unwrap();

        let conn = crate::db::open(&base.join("t.db")).unwrap();
        schema(&conn).unwrap();
        conn.execute(
            "INSERT INTO games (id, platform, external_id, title, installed, install_dir, playtime_min, added_at, updated_at)
             VALUES ('local:test', 'local', 'test', 'Fake Game', 1, ?1, 0, 0, 0)",
            params![game.to_string_lossy()],
        ).unwrap();
        let state = crate::AppState { db: Mutex::new(conn), http: reqwest::Client::new(), tracker: Tracker::new(true), dir: base.clone() };

        let mut child = std::process::Command::new(&exe).args(["-n", "75", "127.0.0.1"]).stdout(std::process::Stdio::null()).spawn().unwrap();
        let mut events = vec![];
        let mut w = Watcher::new();
        let started = Instant::now();
        while started.elapsed() < Duration::from_secs(95) {
            w.step(&state, &mut |ev| { println!("{} {} {}m", ev.kind, ev.title, ev.minutes); events.push((ev.kind, ev.minutes)); });
            if events.iter().any(|e| e.0 == "end") { break; }
            std::thread::sleep(TICK);
        }
        let _ = child.kill();
        let rows: Vec<(i64, i64, i64)> = {
            let c = state.db.lock().unwrap();
            let mut st = c.prepare("SELECT start, end, open FROM sessions WHERE game_id = 'local:test'").unwrap();
            st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap().flatten().collect()
        };
        println!("rows: {rows:?}");
        assert_eq!(events.first().map(|e| e.0), Some("start"));
        assert!(events.iter().any(|e| e.0 == "end" && e.1 >= 1), "ended with at least a minute");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].2, 0, "session closed");
        let _ = std::fs::remove_dir_all(&base);
    }
}
