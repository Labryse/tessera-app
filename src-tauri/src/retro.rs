//! Emulators and ROM folders. Tessera never ships ROMs or BIOS files; it only
//! organises the ones the user points it at.
//!
//! Identification: cartridge systems by CRC32 against No-Intro (zips are read
//! from their directory, not unpacked), disc systems by file name against
//! Redump. Art comes from libretro-thumbnails by the database name.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::path::{Path, PathBuf};

pub struct System {
    pub id: &'static str,
    pub name: &'static str,
    pub exts: &'static [&'static str],
    /// libretro-database file under metadat/, and whether it is a cartridge (CRC) set
    pub dat: &'static str,
    pub cartridge: bool,
    pub retroarch_core: &'static str,
}

pub const SYSTEMS: &[System] = &[
    System { id: "gba", name: "Nintendo - Game Boy Advance", exts: &["gba"], dat: "no-intro/Nintendo - Game Boy Advance.dat", cartridge: true, retroarch_core: "mgba" },
    System { id: "gb", name: "Nintendo - Game Boy", exts: &["gb"], dat: "no-intro/Nintendo - Game Boy.dat", cartridge: true, retroarch_core: "gambatte" },
    System { id: "gbc", name: "Nintendo - Game Boy Color", exts: &["gbc"], dat: "no-intro/Nintendo - Game Boy Color.dat", cartridge: true, retroarch_core: "gambatte" },
    System { id: "nes", name: "Nintendo - Nintendo Entertainment System", exts: &["nes"], dat: "no-intro/Nintendo - Nintendo Entertainment System.dat", cartridge: true, retroarch_core: "nestopia" },
    System { id: "snes", name: "Nintendo - Super Nintendo Entertainment System", exts: &["sfc", "smc"], dat: "no-intro/Nintendo - Super Nintendo Entertainment System.dat", cartridge: true, retroarch_core: "snes9x" },
    System { id: "n64", name: "Nintendo - Nintendo 64", exts: &["n64", "z64", "v64"], dat: "no-intro/Nintendo - Nintendo 64.dat", cartridge: true, retroarch_core: "mupen64plus_next" },
    System { id: "nds", name: "Nintendo - Nintendo DS", exts: &["nds"], dat: "no-intro/Nintendo - Nintendo DS.dat", cartridge: true, retroarch_core: "melonds" },
    System { id: "genesis", name: "Sega - Mega Drive - Genesis", exts: &["md", "gen", "smd"], dat: "no-intro/Sega - Mega Drive - Genesis.dat", cartridge: true, retroarch_core: "genesis_plus_gx" },
    System { id: "ps1", name: "Sony - PlayStation", exts: &["m3u", "cue", "chd", "pbp"], dat: "redump/Sony - PlayStation.dat", cartridge: false, retroarch_core: "swanstation" },
    System { id: "ps2", name: "Sony - PlayStation 2", exts: &["iso", "chd"], dat: "redump/Sony - PlayStation 2.dat", cartridge: false, retroarch_core: "pcsx2" },
    System { id: "psp", name: "Sony - PlayStation Portable", exts: &["iso", "cso", "chd"], dat: "redump/Sony - PlayStation Portable.dat", cartridge: false, retroarch_core: "ppsspp" },
    System { id: "gc", name: "Nintendo - GameCube", exts: &["iso", "rvz", "gcm"], dat: "redump/Nintendo - GameCube.dat", cartridge: false, retroarch_core: "dolphin" },
];

pub fn system(id: &str) -> Option<&'static System> {
    SYSTEMS.iter().find(|s| s.id == id)
}

pub struct EmuKind {
    pub id: &'static str,
    pub name: &'static str,
    pub exes: &'static [&'static str],
    pub systems: &'static [&'static str],
    /// {rom} is the file; {core} the RetroArch core for the game's system
    pub args: &'static str,
}

pub const EMULATORS: &[EmuKind] = &[
    EmuKind { id: "mgba", name: "mGBA", exes: &["mgba.exe"], systems: &["gba", "gb", "gbc"], args: "\"{rom}\"" },
    EmuKind { id: "retroarch", name: "RetroArch", exes: &["retroarch.exe"], systems: &["gba", "gb", "gbc", "nes", "snes", "n64", "nds", "genesis", "ps1", "psp"], args: "-L \"cores\\{core}_libretro.dll\" \"{rom}\"" },
    EmuKind { id: "duckstation", name: "DuckStation", exes: &["duckstation-qt-x64-releaseltcg.exe", "duckstation-qt.exe"], systems: &["ps1"], args: "-batch -- \"{rom}\"" },
    EmuKind { id: "pcsx2", name: "PCSX2", exes: &["pcsx2-qt.exe", "pcsx2.exe"], systems: &["ps2"], args: "-batch -- \"{rom}\"" },
    EmuKind { id: "ppsspp", name: "PPSSPP", exes: &["ppssppwindows64.exe", "ppssppwindows.exe"], systems: &["psp"], args: "\"{rom}\"" },
    EmuKind { id: "dolphin", name: "Dolphin", exes: &["dolphin.exe"], systems: &["gc"], args: "-b -e \"{rom}\"" },
    EmuKind { id: "melonds", name: "melonDS", exes: &["melonds.exe"], systems: &["nds"], args: "\"{rom}\"" },
    EmuKind { id: "snes9x", name: "Snes9x", exes: &["snes9x-x64.exe", "snes9x.exe"], systems: &["snes"], args: "\"{rom}\"" },
    EmuKind { id: "mesen", name: "Mesen", exes: &["mesen.exe"], systems: &["nes", "snes", "gb", "gbc"], args: "\"{rom}\"" },
    EmuKind { id: "project64", name: "Project64", exes: &["project64.exe"], systems: &["n64"], args: "\"{rom}\"" },
];

pub fn emu_kind(id: &str) -> Option<&'static EmuKind> {
    EMULATORS.iter().find(|e| e.id == id)
}

pub fn kind_for_exe(path: &Path) -> Option<&'static EmuKind> {
    let f = path.file_name()?.to_string_lossy().to_lowercase();
    EMULATORS.iter().find(|e| e.exes.contains(&f.as_str()))
}

// ---------------------------------------------------------------- storage

pub fn schema(c: &Connection) -> rusqlite::Result<()> {
    c.execute_batch(
        "CREATE TABLE IF NOT EXISTS emulators (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            name TEXT NOT NULL,
            path TEXT NOT NULL,
            args TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS rom_folders (
            id INTEGER PRIMARY KEY,
            path TEXT NOT NULL,
            system TEXT NOT NULL,
            emulator_id TEXT
        );",
    )
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Emulator {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub path: String,
    pub args: String,
    pub systems: Vec<String>,
    pub icon: Option<String>,
}

pub fn emulators(c: &Connection) -> Vec<Emulator> {
    let Ok(mut st) = c.prepare("SELECT id, kind, name, path, args FROM emulators ORDER BY name") else { return vec![] };
    st.query_map([], |r| {
        let kind: String = r.get(1)?;
        Ok(Emulator {
            id: r.get(0)?,
            systems: emu_kind(&kind).map(|k| k.systems.iter().map(|s| s.to_string()).collect()).unwrap_or_default(),
            kind,
            name: r.get(2)?,
            path: r.get(3)?,
            args: r.get(4)?,
            icon: None,
        })
    })
    .map(|it| it.flatten().collect())
    .unwrap_or_default()
}

pub fn add_emulator(c: &Connection, path: &Path) -> Result<Emulator, String> {
    let k = kind_for_exe(path).ok_or(crate::l("Bu dosya tanınan bir emülatör değil (mGBA, RetroArch, DuckStation, PCSX2, PPSSPP, Dolphin, melonDS, Snes9x, Mesen, Project64).", "This file is not a known emulator (mGBA, RetroArch, DuckStation, PCSX2, PPSSPP, Dolphin, melonDS, Snes9x, Mesen, Project64)."))?;
    let p = path.to_string_lossy().to_string();
    c.execute(
        "INSERT INTO emulators (id, kind, name, path, args) VALUES (?1, ?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET path = ?3",
        params![k.id, k.name, p, k.args],
    )
    .map_err(|e| e.to_string())?;
    emulators(c).into_iter().find(|e| e.id == k.id).ok_or_else(|| "Kaydedilemedi.".into())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RomFolder {
    pub id: i64,
    pub path: String,
    pub system: String,
    pub emulator_id: Option<String>,
    pub games: i64,
}

pub fn folders(c: &Connection) -> Vec<RomFolder> {
    let Ok(mut st) = c.prepare(
        "SELECT f.id, f.path, f.system, f.emulator_id,
                (SELECT COUNT(*) FROM games g WHERE g.meta_json LIKE '%\"romFolder\":' || f.id || ',%' OR g.meta_json LIKE '%\"romFolder\":' || f.id || '}%')
         FROM rom_folders f ORDER BY f.system",
    ) else {
        return vec![];
    };
    st.query_map([], |r| Ok(RomFolder { id: r.get(0)?, path: r.get(1)?, system: r.get(2)?, emulator_id: r.get(3)?, games: r.get(4)? }))
        .map(|it| it.flatten().collect())
        .unwrap_or_default()
}

pub fn folder(c: &Connection, id: i64) -> Option<RomFolder> {
    folders(c).into_iter().find(|f| f.id == id)
}

/// the emulator a ROM opens with: the folder's choice, else any that runs the system
pub fn emulator_for(c: &Connection, folder_id: i64, system: &str) -> Option<Emulator> {
    let chosen: Option<String> = c
        .query_row("SELECT emulator_id FROM rom_folders WHERE id = ?1", params![folder_id], |r| r.get(0))
        .optional()
        .ok()
        .flatten()
        .flatten();
    let all = emulators(c);
    chosen
        .and_then(|id| all.iter().find(|e| e.id == id).cloned())
        .or_else(|| all.into_iter().find(|e| e.systems.iter().any(|s| s == system)))
}

// ---------------------------------------------------------------- detection

fn known_roots() -> Vec<(PathBuf, usize)> {
    let mut roots = vec![];
    let env = |k: &str| std::env::var(k).ok().map(PathBuf::from);
    if let Some(u) = env("USERPROFILE") {
        roots.push((u.join("Desktop"), 2));
        roots.push((u.join("OneDrive").join("Desktop"), 2));
        roots.push((u.join("Documents"), 2));
    }
    if let Some(p) = env("ProgramFiles") {
        roots.push((p, 2));
    }
    if let Some(p) = env("ProgramFiles(x86)") {
        roots.push((p, 2));
    }
    if let Some(p) = env("LOCALAPPDATA") {
        roots.push((p.join("Programs"), 2));
    }
    for d in ["C:\\RetroArch-Win64", "C:\\RetroArch", "C:\\Emulators", "D:\\Emulators", "C:\\Games", "D:\\Games"] {
        roots.push((PathBuf::from(d), 2));
    }
    roots
}

fn find_exes(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            if depth > 0 {
                find_exes(&p, depth - 1, out);
            }
        } else if kind_for_exe(&p).is_some() {
            out.push(p);
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FoundEmu {
    pub kind: String,
    pub name: String,
    pub path: String,
    pub systems: Vec<String>,
    pub icon: Option<String>,
}

pub fn detect() -> Vec<FoundEmu> {
    let mut paths = vec![];
    for (root, depth) in known_roots() {
        find_exes(&root, depth, &mut paths);
    }
    paths.extend(crate::scan::shortcut_targets().into_iter().filter(|p| kind_for_exe(p).is_some()));
    let mut seen = HashSet::new();
    paths
        .into_iter()
        .filter(|p| seen.insert(p.to_string_lossy().to_lowercase()))
        .filter_map(|p| {
            let k = kind_for_exe(&p)?;
            Some(FoundEmu { kind: k.id.into(), name: k.name.into(), path: p.to_string_lossy().to_string(), systems: k.systems.iter().map(|s| s.to_string()).collect(), icon: None })
        })
        .collect()
}

// ---------------------------------------------------------------- databases

pub struct Dat {
    by_crc: HashMap<String, String>,
    by_name: HashMap<String, String>,
}

fn parse_dat(text: &str) -> Dat {
    let mut by_crc = HashMap::new();
    let mut by_name = HashMap::new();
    let mut game: Option<String> = None;
    for line in text.lines() {
        let l = line.trim();
        if l.starts_with("game (") {
            game = None;
        } else if game.is_none() && l.starts_with("name \"") {
            let n = l[6..].trim_end_matches('"').to_string();
            by_name.insert(n.to_lowercase(), n.clone());
            game = Some(n);
        } else if l.starts_with("rom (") {
            if let (Some(g), Some(i)) = (&game, l.find(" crc ")) {
                let crc = &l[i + 5..(i + 13).min(l.len())];
                by_crc.entry(crc.to_uppercase()).or_insert_with(|| g.clone());
            }
        }
    }
    Dat { by_crc, by_name }
}

/// the database for a system, downloaded once and kept for a month
pub async fn dat(http: &reqwest::Client, cache: &Path, sys: &System) -> Option<Dat> {
    let file = cache.join(sys.dat.replace('/', "_"));
    let fresh = std::fs::metadata(&file)
        .and_then(|m| m.modified())
        .map(|t| t.elapsed().map(|e| e.as_secs() < 30 * 86400).unwrap_or(false))
        .unwrap_or(false);
    if !fresh {
        let url = format!("https://raw.githubusercontent.com/libretro/libretro-database/master/metadat/{}", sys.dat.replace(' ', "%20"));
        if let Ok(r) = http.get(url).send().await {
            if r.status().is_success() {
                if let Ok(b) = r.bytes().await {
                    let _ = std::fs::create_dir_all(cache);
                    let _ = std::fs::write(&file, &b);
                }
            }
        }
    }
    std::fs::read_to_string(&file).ok().map(|t| parse_dat(&t))
}

// ---------------------------------------------------------------- scanning

pub struct Rom {
    pub path: PathBuf,
    pub size: i64,
    pub crc: Option<String>,
}

fn crc_of_file(p: &Path) -> Option<String> {
    let mut f = std::fs::File::open(p).ok()?;
    let mut h = crc32fast::Hasher::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Some(format!("{:08X}", h.finalize()))
}

/// the CRC of the ROM inside a zip, from the zip's own directory
fn crc_in_zip(p: &Path, exts: &[&str]) -> Option<(String, i64)> {
    let f = std::fs::File::open(p).ok()?;
    let mut z = zip::ZipArchive::new(f).ok()?;
    for i in 0..z.len() {
        let e = z.by_index_raw(i).ok()?;
        let name = e.name().ok()?.to_lowercase();
        if exts.iter().any(|x| name.ends_with(&format!(".{x}"))) {
            return Some((format!("{:08X}", e.crc32()), e.size() as i64));
        }
    }
    None
}

fn walk(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            if depth > 0 {
                walk(&p, depth - 1, out);
            }
        } else {
            out.push(p);
        }
    }
}

pub fn find_roms(folder: &Path, sys: &System) -> Vec<Rom> {
    let mut files = vec![];
    walk(folder, 3, &mut files);
    let ext = |p: &Path| p.extension().map(|x| x.to_string_lossy().to_lowercase()).unwrap_or_default();
    // a multi-disc game counts once: prefer its .m3u, otherwise its first disc
    let m3u_dirs: HashSet<PathBuf> = files.iter().filter(|p| ext(p) == "m3u").filter_map(|p| p.parent().map(Path::to_path_buf)).collect();
    let mut seen_games = HashSet::new();
    let mut out = vec![];
    for p in files {
        let e = ext(&p);
        let size = std::fs::metadata(&p).map(|m| m.len() as i64).unwrap_or(0);
        if sys.cartridge {
            if sys.exts.contains(&e.as_str()) {
                let crc = if size <= 512 * 1024 * 1024 { crc_of_file(&p) } else { None };
                out.push(Rom { path: p, size, crc });
            } else if e == "zip" {
                if let Some((crc, inner)) = crc_in_zip(&p, sys.exts) {
                    out.push(Rom { path: p, size: inner, crc: Some(crc) });
                }
            }
        } else if sys.exts.contains(&e.as_str()) {
            if e != "m3u" && p.parent().is_some_and(|d| m3u_dirs.contains(d)) {
                continue;
            }
            let stem = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            let game = strip_disc(&stem).to_lowercase();
            if !seen_games.insert(game) {
                continue;
            }
            out.push(Rom { path: p, size, crc: None });
        }
    }
    out
}

fn strip_disc(s: &str) -> String {
    match s.find(" (Disc") {
        Some(i) => {
            let rest = &s[i + 1..];
            let close = rest.find(')').map(|j| i + 1 + j + 1).unwrap_or(s.len());
            format!("{}{}", &s[..i], &s[close..])
        }
        None => s.to_string(),
    }
}

/// "Pokemon - FireRed Version (USA, Europe) (Rev 1)" → ("Pokemon: FireRed Version", "USA, Europe")
pub fn display_name(db_name: &str) -> (String, Option<String>) {
    let cut = db_name.find(" (").or_else(|| db_name.find(" [")).unwrap_or(db_name.len());
    let base = db_name[..cut].trim().replace(" - ", ": ");
    // No-Intro writes "Legend of Zelda, The - …"; put the article back in front
    let base = if let Some(i) = base.find(", The") { format!("The {}{}", &base[..i], &base[i + 5..]) } else { base };
    let region = db_name[cut..].trim().strip_prefix('(').and_then(|r| r.split(')').next()).map(str::to_string);
    (base, region)
}

fn thumb(sys: &System, kind: &str, name: &str) -> String {
    let safe: String = name.chars().map(|c| if "&*/:`<>?\\|\"".contains(c) { '_' } else { c }).collect();
    let mut enc = String::new();
    for b in safe.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => enc.push(b as char),
            _ => enc.push_str(&format!("%{b:02X}")),
        }
    }
    format!("https://raw.githubusercontent.com/libretro-thumbnails/{}/master/{kind}/{enc}.png", sys.name.replace(' ', "_"))
}

pub fn rom_id(sys: &System, rom: &Rom) -> String {
    match &rom.crc {
        Some(c) => format!("rom:{}:{}", sys.id, c.to_lowercase()),
        None => format!("rom:{}:{}", sys.id, crate::scan::exe_id(&rom.path.to_string_lossy()).trim_start_matches("exe-")),
    }
}

/// meta for one ROM: its name in the database, region, art and how to start it
pub fn rom_meta(sys: &System, rom: &Rom, dat: Option<&Dat>, folder_id: i64) -> (String, Value) {
    let stem = rom.path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let matched = dat.and_then(|d| {
        rom.crc.as_ref().and_then(|c| d.by_crc.get(c).cloned()).or_else(|| d.by_name.get(&stem.to_lowercase()).cloned()).or_else(|| d.by_name.get(&strip_disc(&stem).to_lowercase()).cloned())
    });
    let db_name = matched.clone().unwrap_or_else(|| stem.clone());
    let (title, region) = display_name(&db_name);
    let art = |kind| thumb(sys, kind, &db_name);
    let meta = json!({
        "name": title,
        "type": 0,
        "short": "",
        "developers": [],
        "publishers": [],
        "cover": art("Named_Boxarts"),
        "hero": art("Named_Snaps"),
        "header": Value::Null,
        "logo": Value::Null,
        "screenshots": [art("Named_Titles"), art("Named_Snaps")],
        "romPath": rom.path.to_string_lossy(),
        "romFolder": folder_id,
        "system": sys.id,
        "rom": {
            "file": rom.path.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default(),
            "folder": rom.path.parent().map(|f| f.to_string_lossy().to_string()).unwrap_or_default(),
            "sizeBytes": rom.size,
            "region": region,
            "match": matched.as_ref().map(|_| json!({ "db": if sys.cartridge { "No-Intro" } else { "Redump" }, "crc": rom.crc })),
            "dbName": matched,
        },
    });
    (title, meta)
}

/// splits an argument template into argv, honouring double quotes
pub fn split_args(s: &str) -> Vec<String> {
    let mut out = vec![];
    let mut cur = String::new();
    let mut quoted = false;
    let mut any = false;
    for ch in s.chars() {
        match ch {
            '"' => { quoted = !quoted; any = true; }
            c if c.is_whitespace() && !quoted => {
                if any || !cur.is_empty() { out.push(std::mem::take(&mut cur)); }
                any = false;
            }
            c => cur.push(c),
        }
    }
    if any || !cur.is_empty() {
        out.push(cur);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_and_args() {
        assert_eq!(display_name("Pokemon - FireRed Version (USA, Europe) (Rev 1)"), ("Pokemon: FireRed Version".into(), Some("USA, Europe".into())));
        assert_eq!(display_name("Legend of Zelda, The - The Minish Cap (USA)").0, "The Legend of Zelda: The Minish Cap");
        assert_eq!(split_args("-L \"cores\\x_libretro.dll\" \"C:\\a b\\c.gba\""), vec!["-L", "cores\\x_libretro.dll", "C:\\a b\\c.gba"]);
        assert_eq!(strip_disc("Final Fantasy VII (USA) (Disc 2)"), "Final Fantasy VII (USA)");
    }

    #[test]
    #[ignore = "reads the GBA ROMs folder on this PC and downloads the No-Intro list"]
    fn gba_folder() {
        let http = reqwest::Client::builder().user_agent("Tessera/0.1").build().unwrap();
        let sys = system("gba").unwrap();
        let cache = std::env::temp_dir().join("tessera-dats");
        let d = tauri::async_runtime::block_on(dat(&http, &cache, sys)).unwrap();
        println!("dat entries: {}", d.by_crc.len());
        let folder = PathBuf::from(std::env::var("USERPROFILE").unwrap()).join("Desktop").join("GBA ROMS");
        for r in find_roms(&folder, sys) {
            let (title, m) = rom_meta(sys, &r, Some(&d), 1);
            println!("{title} | crc={:?} | db={} | {}", r.crc, m["rom"]["dbName"], m["cover"]);
        }
        println!("detected emulators: {:?}", detect().iter().map(|e| format!("{} {}", e.name, e.path)).collect::<Vec<_>>());
    }
}
