//! Live match data from games that offer it on this PC:
//! - Counter-Strike 2 and Dota 2 send their state to Tessera (Valve's game state
//!   integration) once the user turns it on: a small file in the game's cfg folder.
//! - League of Legends answers on its own local port while a match runs.
//! - Rocket League streams its state on a local port once its stats setting is on.
//! Everything stays on 127.0.0.1.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const GSI_PORT: u16 = 47614;
pub const CS2: u32 = 730;
pub const DOTA2: u32 = 570;
pub const ROCKET_LEAGUE: u32 = 252950;
const FRESH: Duration = Duration::from_secs(40);

/// the last line each game pushed to us, by appid
static PUSHED: Mutex<Option<HashMap<u32, (String, Instant)>>> = Mutex::new(None);

pub fn pushed(appid: u32) -> Option<String> {
    let g = PUSHED.lock().unwrap();
    let (line, at) = g.as_ref()?.get(&appid)?;
    (at.elapsed() < FRESH).then(|| line.clone())
}

fn remember(appid: u32, line: Option<String>) {
    let mut g = PUSHED.lock().unwrap();
    let m = g.get_or_insert_with(HashMap::new);
    match line {
        Some(l) => { m.insert(appid, (l, Instant::now())); }
        None => { m.remove(&appid); }
    }
}

// ---------------------------------------------------------------- the listener

/// receives what CS2 and Dota 2 post; only requests carrying our token count
pub fn listen(token: String) {
    std::thread::spawn(move || {
        let Ok(l) = TcpListener::bind(("127.0.0.1", GSI_PORT)) else { return };
        for stream in l.incoming().flatten() {
            let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
            if let Some(body) = read_post(stream) {
                if let Ok(v) = serde_json::from_slice::<Value>(&body) {
                    if v["auth"]["token"].as_str() == Some(token.as_str()) {
                        let appid = v["provider"]["appid"].as_u64().unwrap_or(0) as u32;
                        match appid {
                            CS2 => remember(CS2, cs2_line(&v)),
                            DOTA2 => remember(DOTA2, dota_line(&v)),
                            _ => {}
                        }
                    }
                }
            }
        }
    });
}

fn read_post(mut s: TcpStream) -> Option<Vec<u8>> {
    let mut buf = Vec::with_capacity(8192);
    let mut chunk = [0u8; 8192];
    let head_end = loop {
        let n = s.read(&mut chunk).ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break i + 4;
        }
        if buf.len() > 64 * 1024 {
            return None;
        }
    };
    let head = String::from_utf8_lossy(&buf[..head_end]).to_lowercase();
    let len: usize = head.lines().find_map(|l| l.strip_prefix("content-length:")).and_then(|v| v.trim().parse().ok()).unwrap_or(0);
    if len > 2 * 1024 * 1024 {
        return None;
    }
    while buf.len() < head_end + len {
        let n = s.read(&mut chunk).ok()?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
    }
    let _ = s.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    Some(buf[head_end..(head_end + len).min(buf.len())].to_vec())
}

// ---------------------------------------------------------------- lines

fn clock(secs: f64) -> String {
    let s = secs.max(0.0) as i64;
    format!("{}:{:02}", s / 60, s % 60)
}

fn title_case(s: &str) -> String {
    s.split(['_', ' '])
        .filter(|w| !w.is_empty())
        .map(|w| {
            let mut c = w.chars();
            c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn cs2_map(name: &str) -> String {
    let known = [
        ("de_dust2", "Dust II"), ("de_mirage", "Mirage"), ("de_inferno", "Inferno"), ("de_nuke", "Nuke"), ("de_ancient", "Ancient"),
        ("de_anubis", "Anubis"), ("de_vertigo", "Vertigo"), ("de_overpass", "Overpass"), ("de_train", "Train"), ("cs_office", "Office"), ("cs_italy", "Italy"),
    ];
    known.iter().find(|(k, _)| *k == name).map(|(_, v)| v.to_string()).unwrap_or_else(|| {
        title_case(name.split_once('_').map(|(_, r)| r).unwrap_or(name))
    })
}

pub fn cs2_line(v: &Value) -> Option<String> {
    let map = &v["map"];
    let p = &v["player"];
    if map.is_null() {
        return (p["activity"] == "menu").then(|| crate::l("Ana menüde", "In the main menu").to_string());
    }
    let mode = match map["mode"].as_str().unwrap_or("") {
        "competitive" => crate::l("Rekabetçi", "Competitive"),
        "premier" => "Premier",
        "casual" => crate::l("Sıradan", "Casual"),
        "deathmatch" => crate::l("Ölüm Maçı", "Deathmatch"),
        "scrimcomp2v2" | "wingman" => "Wingman",
        "gungameprogressive" => crate::l("Silah Yarışı", "Arms Race"),
        "custom" => crate::l("Özel", "Custom"),
        other => return Some(format!("{} · {}", cs2_map(map["name"].as_str().unwrap_or("")), title_case(other))),
    };
    let mut parts = vec![cs2_map(map["name"].as_str().unwrap_or("")), mode.to_string()];
    let mine = !p["steamid"].is_null() && p["steamid"] == v["provider"]["steamid"];
    let ct = map["team_ct"]["score"].as_i64().unwrap_or(0);
    let t = map["team_t"]["score"].as_i64().unwrap_or(0);
    match map["phase"].as_str() {
        Some("warmup") => parts.push(crate::l("Isınma", "Warmup").into()),
        Some("gameover") => parts.push(crate::tr!("Maç bitti {}", "Match over {}", score(mine.then(|| p["team"].as_str()).flatten(), ct, t))),
        _ => parts.push(score(mine.then(|| p["team"].as_str()).flatten(), ct, t)),
    }
    if mine {
        let s = &p["match_stats"];
        if let (Some(k), Some(d), Some(a)) = (s["kills"].as_i64(), s["deaths"].as_i64(), s["assists"].as_i64()) {
            parts.push(format!("{k}/{d}/{a}"));
        }
    }
    Some(parts.join(" · "))
}

/// your side first when we know it
fn score(team: Option<&str>, ct: i64, t: i64) -> String {
    match team {
        Some("T") => format!("{t}–{ct}"),
        _ => format!("{ct}–{t}"),
    }
}

/// Dota's internal hero names, where they differ from what players call them
fn dota_hero(id: &str) -> String {
    let odd = [
        ("nevermore", "Shadow Fiend"), ("furion", "Nature's Prophet"), ("obsidian_destroyer", "Outworld Destroyer"), ("queenofpain", "Queen of Pain"),
        ("zuus", "Zeus"), ("wisp", "Io"), ("magnataur", "Magnus"), ("skeleton_king", "Wraith King"), ("rattletrap", "Clockwerk"),
        ("doom_bringer", "Doom"), ("shredder", "Timbersaw"), ("windrunner", "Windranger"), ("life_stealer", "Lifestealer"),
        ("necrolyte", "Necrophos"), ("treant", "Treant Protector"), ("centaur", "Centaur Warrunner"), ("abyssal_underlord", "Underlord"),
        ("antimage", "Anti-Mage"), ("vengefulspirit", "Vengeful Spirit"), ("keeper_of_the_light", "Keeper of the Light"),
        ("tiny", "Tiny"), ("tusk", "Tusk"), ("monkey_king", "Monkey King"), ("dark_willow", "Dark Willow"), ("ancient_apparition", "Ancient Apparition"),
    ];
    odd.iter().find(|(k, _)| *k == id).map(|(_, v)| v.to_string()).unwrap_or_else(|| title_case(id))
}

pub fn dota_line(v: &Value) -> Option<String> {
    let state = v["map"]["game_state"].as_str()?;
    let phase = match state {
        "DOTA_GAMERULES_STATE_HERO_SELECTION" | "DOTA_GAMERULES_STATE_STRATEGY_TIME" => Some(crate::l("Kahraman seçimi", "Hero selection")),
        "DOTA_GAMERULES_STATE_WAIT_FOR_PLAYERS_TO_LOAD" => Some(crate::l("Yükleniyor", "Loading")),
        "DOTA_GAMERULES_STATE_POST_GAME" => Some(crate::l("Maç bitti", "Match over")),
        _ => None,
    };
    let hero = v["hero"]["name"].as_str().map(|h| dota_hero(h.trim_start_matches("npc_dota_hero_")));
    let mut parts = vec![];
    if let Some(h) = hero.filter(|h| !h.is_empty()) {
        parts.push(h);
        if let Some(l) = v["hero"]["level"].as_i64().filter(|l| *l > 0) {
            parts.push(format!("Sv. {l}"));
        }
    }
    if let Some(ph) = phase {
        parts.push(ph.into());
    } else {
        let p = &v["player"];
        if let (Some(k), Some(d), Some(a)) = (p["kills"].as_i64(), p["deaths"].as_i64(), p["assists"].as_i64()) {
            parts.push(format!("{k}/{d}/{a}"));
        }
        if let Some(c) = v["map"]["clock_time"].as_f64() {
            parts.push(clock(c));
        }
    }
    (!parts.is_empty()).then(|| parts.join(" · "))
}

pub fn lol_line(v: &Value) -> Option<String> {
    let me = &v["activePlayer"];
    let id = me["riotId"].as_str().or(me["summonerName"].as_str())?;
    let players = v["allPlayers"].as_array()?;
    let p = players.iter().find(|p| p["riotId"].as_str() == Some(id) || p["summonerName"].as_str() == Some(id))?;
    let mode = match v["gameData"]["gameMode"].as_str().unwrap_or("") {
        "CLASSIC" => "Sihirdar Vadisi".to_string(),
        "ARAM" => "ARAM".to_string(),
        "CHERRY" => "Arena".to_string(),
        "URF" => "URF".to_string(),
        "PRACTICETOOL" => "Antrenman".to_string(),
        other => title_case(&other.to_lowercase()),
    };
    let s = &p["scores"];
    let mut parts = vec![p["championName"].as_str().unwrap_or("?").to_string(), mode];
    if let (Some(k), Some(d), Some(a)) = (s["kills"].as_i64(), s["deaths"].as_i64(), s["assists"].as_i64()) {
        parts.push(format!("{k}/{d}/{a}"));
    }
    if let Some(t) = v["gameData"]["gameTime"].as_f64() {
        parts.push(clock(t));
    }
    Some(parts.join(" · "))
}

/// `me`: the linked Steam id, to find your own car among the players
pub fn rl_line(data: &Value, me: Option<&str>) -> Option<String> {
    let g = &data["Game"];
    if g["bReplay"].as_bool() == Some(true) {
        return Some(crate::l("Gol tekrarı", "Goal replay").into());
    }
    let teams = g["Teams"].as_array()?;
    let score = |n: i64| teams.iter().find(|t| t["TeamNum"].as_i64() == Some(n)).and_then(|t| t["Score"].as_i64()).unwrap_or(0);
    let mine = me.and_then(|id| {
        data["Players"].as_array()?.iter().find(|p| p["PrimaryId"].as_str().is_some_and(|x| x.contains(id)))
    });
    let my_team = mine.and_then(|p| p["TeamNum"].as_i64());
    let (a, b) = match my_team {
        Some(1) => (score(1), score(0)),
        _ => (score(0), score(1)),
    };
    let mut parts = vec![format!("{a}–{b}")];
    let secs = g["TimeSeconds"].as_f64().unwrap_or(0.0);
    parts.push(if g["bOvertime"].as_bool() == Some(true) { format!("Uzatma +{}", clock(secs)) } else { clock(secs) });
    if let Some(p) = mine {
        let n = |k: &str| p[k].as_i64().unwrap_or(0);
        let mut bits = vec![];
        if n("Goals") > 0 { bits.push(format!("{} gol", n("Goals"))); }
        if n("Assists") > 0 { bits.push(format!("{} asist", n("Assists"))); }
        if n("Saves") > 0 { bits.push(crate::tr!("{} kurtarış", "{} saves", n("Saves"))); }
        if !bits.is_empty() { parts.push(bits.join(", ")); }
    }
    Some(parts.join(" · "))
}

// ---------------------------------------------------------------- polling the ones that do not push

/// League of Legends' Live Client Data (only answers during a match)
pub async fn lol() -> Option<String> {
    // the game serves a certificate of its own on 127.0.0.1; nothing leaves this PC
    let http = reqwest::Client::builder().danger_accept_invalid_certs(true).timeout(Duration::from_secs(2)).build().ok()?;
    let v: Value = http.get("https://127.0.0.1:2999/liveclientdata/allgamedata").send().await.ok()?.json().await.ok()?;
    lol_line(&v)
}

/// Rocket League's stats stream: connect, take the first state, leave
pub fn rocket_league(me: Option<&str>) -> Option<String> {
    let addr = "127.0.0.1:49123".parse().ok()?;
    let mut s = TcpStream::connect_timeout(&addr, Duration::from_millis(400)).ok()?;
    s.set_read_timeout(Some(Duration::from_millis(1500))).ok()?;
    let started = Instant::now();
    let mut buf = Vec::new();
    let mut chunk = [0u8; 16384];
    while started.elapsed() < Duration::from_millis(2500) {
        let n = s.read(&mut chunk).ok()?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
        // a stream of JSON messages back to back; read whole ones
        let mut it = serde_json::Deserializer::from_slice(&buf).into_iter::<Value>();
        while let Some(Ok(msg)) = it.next() {
            let ev = msg.get("Event").or(msg.get("event")).and_then(Value::as_str).unwrap_or("");
            if ev != "UpdateState" {
                continue;
            }
            let data = msg.get("Data").or(msg.get("data")).cloned().unwrap_or(Value::Null);
            let data = match data {
                Value::String(s) => serde_json::from_str(&s).unwrap_or(Value::Null),
                d => d,
            };
            return rl_line(&data, me);
        }
        if buf.len() > 4 * 1024 * 1024 {
            break;
        }
    }
    None
}

// ---------------------------------------------------------------- turning it on

/// where each game wants the file that makes it talk to us
pub fn setup_file(appid: u32, install_dir: &Path) -> Option<PathBuf> {
    match appid {
        CS2 => Some(install_dir.join("game").join("csgo").join("cfg").join("gamestate_integration_tessera.cfg")),
        DOTA2 => Some(install_dir.join("game").join("dota").join("cfg").join("gamestate_integration").join("gamestate_integration_tessera.cfg")),
        ROCKET_LEAGUE => rl_ini(),
        _ => None,
    }
}

/// Rocket League's own settings file for its stats stream (Documents\My Games\…)
fn rl_ini() -> Option<PathBuf> {
    let home = std::env::var_os("USERPROFILE").map(PathBuf::from)?;
    let candidates = [home.join("Documents"), home.join("OneDrive").join("Documents"), home.join("OneDrive").join("Belgeler")];
    let docs = candidates.iter().find(|d| d.join("My Games").join("Rocket League").is_dir())?;
    Some(docs.join("My Games").join("Rocket League").join("TAGame").join("Config").join("TAStatsAPI.ini"))
}

pub fn gsi_config(token: &str, appid: u32) -> String {
    let data = if appid == CS2 {
        "\"provider\" \"1\"\n        \"map\" \"1\"\n        \"round\" \"1\"\n        \"player_id\" \"1\"\n        \"player_state\" \"1\"\n        \"player_match_stats\" \"1\""
    } else {
        "\"provider\" \"1\"\n        \"map\" \"1\"\n        \"player\" \"1\"\n        \"hero\" \"1\""
    };
    format!(
        "\"Tessera\"\n{{\n    \"uri\" \"http://127.0.0.1:{GSI_PORT}/\"\n    \"timeout\" \"2.0\"\n    \"buffer\" \"0.5\"\n    \"throttle\" \"2.0\"\n    \"heartbeat\" \"20.0\"\n    \"auth\"\n    {{\n        \"token\" \"{token}\"\n    }}\n    \"data\"\n    {{\n        {data}\n    }}\n}}\n"
    )
}

const RL_SECTION: &str = "[TAGame.MatchStatsExporter_TA]";

pub fn is_on(appid: u32, file: &Path) -> bool {
    match appid {
        ROCKET_LEAGUE => std::fs::read_to_string(file).is_ok_and(|s| {
            s.lines().any(|l| l.trim().strip_prefix("PacketSendRate=").and_then(|v| v.trim().parse::<f64>().ok()).is_some_and(|v| v > 0.0))
        }),
        _ => file.is_file(),
    }
}

pub fn turn_on(appid: u32, file: &Path, token: &str) -> std::io::Result<()> {
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    if appid == ROCKET_LEAGUE {
        // keep whatever else is in the file; only our two settings change
        let old = std::fs::read_to_string(file).unwrap_or_default();
        let mut out: Vec<String> = old.lines().filter(|l| !l.trim().starts_with("PacketSendRate=") && !l.trim().starts_with("Port=")).map(str::to_string).collect();
        let at = match out.iter().position(|l| l.trim() == RL_SECTION) {
            Some(i) => i + 1,
            None => { out.push(RL_SECTION.into()); out.len() }
        };
        out.insert(at, "PacketSendRate=2".into());
        out.insert(at, "Port=49123".into());
        return std::fs::write(file, out.join("\r\n") + "\r\n");
    }
    std::fs::write(file, gsi_config(token, appid))
}

pub fn turn_off(appid: u32, file: &Path) -> std::io::Result<()> {
    if appid == ROCKET_LEAGUE {
        let Ok(old) = std::fs::read_to_string(file) else { return Ok(()) };
        let out: Vec<String> = old.lines().map(|l| if l.trim().starts_with("PacketSendRate=") { "PacketSendRate=0".into() } else { l.to_string() }).collect();
        return std::fs::write(file, out.join("\r\n") + "\r\n");
    }
    match std::fs::remove_file(file) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e),
        _ => Ok(()),
    }
}

pub fn status(appid: u32, file: Option<&Path>) -> Value {
    match file {
        Some(f) => json!({ "appid": appid, "available": true, "on": is_on(appid, f) }),
        None => json!({ "appid": appid, "available": false, "on": false }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cs2_reads_score_and_stats() {
        let v = json!({
            "provider": { "appid": 730, "steamid": "7656" },
            "map": { "mode": "competitive", "name": "de_dust2", "phase": "live", "team_ct": { "score": 7 }, "team_t": { "score": 5 } },
            "player": { "steamid": "7656", "team": "T", "activity": "playing", "match_stats": { "kills": 14, "assists": 3, "deaths": 6 } }
        });
        assert_eq!(cs2_line(&v).as_deref(), Some("Dust II · Rekabetçi · 5–7 · 14/6/3"));
        let menu = json!({ "provider": { "appid": 730 }, "player": { "activity": "menu" } });
        assert_eq!(cs2_line(&menu).as_deref(), Some("Ana menüde"));
    }

    #[test]
    fn dota_reads_hero_and_clock() {
        let v = json!({
            "map": { "game_state": "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS", "clock_time": 1394 },
            "hero": { "name": "npc_dota_hero_queenofpain", "level": 12 },
            "player": { "kills": 5, "deaths": 2, "assists": 7 }
        });
        assert_eq!(dota_line(&v).as_deref(), Some("Queen of Pain · Sv. 12 · 5/2/7 · 23:14"));
    }

    #[test]
    fn lol_finds_you_among_players() {
        let v = json!({
            "activePlayer": { "riotId": "Ben#TR1" },
            "allPlayers": [ { "riotId": "Sen#TR1", "championName": "Lux", "scores": {} },
                            { "riotId": "Ben#TR1", "championName": "Ahri", "scores": { "kills": 5, "deaths": 2, "assists": 7 } } ],
            "gameData": { "gameMode": "ARAM", "gameTime": 754.2 }
        });
        assert_eq!(lol_line(&v).as_deref(), Some("Ahri · ARAM · 5/2/7 · 12:34"));
    }

    #[test]
    fn rocket_league_puts_your_side_first() {
        let d = json!({
            "Game": { "Teams": [ { "TeamNum": 0, "Score": 1 }, { "TeamNum": 1, "Score": 2 } ], "TimeSeconds": 192, "bOvertime": false },
            "Players": [ { "PrimaryId": "Steam|76561|0", "TeamNum": 1, "Goals": 1, "Saves": 2 } ]
        });
        assert_eq!(rl_line(&d, Some("76561")).as_deref(), Some("2–1 · 3:12 · 1 gol, 2 kurtarış"));
    }

    #[test]
    #[ignore = "needs Rocket League running with its stats stream on"]
    fn rocket_league_live() {
        let me = std::env::var("RL_ME").ok();
        let t = Instant::now();
        println!("line: {:?} in {:?}", rocket_league(me.as_deref()), t.elapsed());
    }

    #[test]
    fn rocket_league_settings_keep_the_rest_of_the_file() {
        let dir = std::env::temp_dir().join("tessera-rl-test");
        let _ = std::fs::remove_dir_all(&dir);
        let f = dir.join("TAStatsAPI.ini");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(&f, "[Other]\r\nX=1\r\n").unwrap();
        turn_on(ROCKET_LEAGUE, &f, "").unwrap();
        assert!(is_on(ROCKET_LEAGUE, &f));
        let s = std::fs::read_to_string(&f).unwrap();
        assert!(s.contains("X=1") && s.contains(RL_SECTION) && s.contains("PacketSendRate=2"));
        turn_off(ROCKET_LEAGUE, &f).unwrap();
        assert!(!is_on(ROCKET_LEAGUE, &f));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_listener_takes_a_post_with_our_token() {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let h = std::thread::spawn(move || read_post(l.accept().unwrap().0));
        let mut c = TcpStream::connect(("127.0.0.1", port)).unwrap();
        let body = r#"{"auth":{"token":"t"}}"#;
        write!(c, "POST / HTTP/1.1\r\nHost: x\r\nContent-Length: {}\r\n\r\n{}", body.len(), body).unwrap();
        assert_eq!(h.join().unwrap().as_deref(), Some(body.as_bytes()));
    }
}
