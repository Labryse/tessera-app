//! Finds games installed on this PC by reading each launcher's own local records.
//! Nothing is added until the user picks what to import.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    pub source: String,
    pub external_id: String,
    pub title: String,
    pub install_dir: Option<String>,
    pub size_bytes: Option<i64>,
    /// "uri:<protocol link>" or "exe:<full path>"
    pub launch: Option<String>,
    /// already in the library
    #[serde(default)]
    pub known: bool,
    /// for shortcuts: "desktop" or "start"
    #[serde(default)]
    pub origin: Option<String>,
    /// the game this looks like on Steam or Wikipedia
    #[serde(default)]
    pub guess: Option<crate::meta::Candidate>,
    /// no guess yet: the UI asks for it one by one (scan_guess)
    #[serde(default)]
    pub pending: bool,
}

pub fn all() -> Vec<Found> {
    let mut out = launchers();
    let taken: Vec<String> = out.iter().filter_map(|f| f.install_dir.as_ref().map(|d| d.to_lowercase())).collect();
    out.extend(shortcuts(&taken));
    out
}

/// only what the launchers themselves record (no shortcuts)
pub fn launchers() -> Vec<Found> {
    let mut out = Vec::new();
    out.extend(steam());
    out.extend(epic());
    #[cfg(windows)]
    {
        out.extend(gog());
        out.extend(ubisoft());
        out.extend(from_uninstall());
    }
    out.extend(xbox());
    out
}

// ---------------------------------------------------------------- shortcuts
// Games no launcher knows about (standalone installs, unofficial copies, indie
// games) almost always leave a shortcut on the desktop or in the Start menu.

/// exe or shortcut names of tools, launchers and everyday apps
const NOT_GAMES: &[&str] = &[
    "chrome", "firefox", "msedge", "opera", "launcher", "brave", "vivaldi", "iexplore", "discord", "update", "spotify",
    "telegram", "whatsapp", "zoom", "teams", "ms-teams", "slack", "obs64", "obs32", "parsecd", "parsec", "anydesk",
    "teamviewer", "vlc", "winrar", "7zfm", "notepad++", "code", "cursor", "git-bash", "python", "pythonw", "node",
    "steam", "steamservice", "epicgameslauncher", "battle.net", "upc", "ubisoftconnect", "eadesktop", "origin",
    "galaxyclient", "xboxapp", "gamebar", "curseforge", "overwolf", "winword", "excel", "powerpnt", "outlook",
    "onenote", "onedrive", "dropbox", "googledrivefs", "acrord32", "acrobat", "photoshop", "audacity", "gimp",
    "krita", "mspaint", "calc", "explorer", "cmd", "powershell", "pwsh", "wt", "taskmgr", "regedit", "control",
    "claude", "chatgpt", "figma", "notion", "postman", "virtualbox", "vmware", "qbittorrent", "utorrent",
    "bittorrent", "everything", "sharex", "lightshot", "greenshot", "snippingtool", "msiafterburner", "rtss",
    "cpuz", "hwmonitor", "hwinfo64", "nvcontainer", "radeonsoftware", "lghub", "icue", "mgba", "retroarch",
    "dolphin", "pcsx2", "pcsx2-qt", "ppssppwindows64", "ryujinx", "yuzu", "citra-qt", "melonds", "cemu", "rpcs3",
    "xenia", "minecraftlauncher", "battle.net launcher", "flow.launcher", "private_browsing", "git-cmd", "git-gui",
    "lghub_system_tray", "vivaldi_proxy", "windhawk", "yasb", "razerappengine", "steelseriesggez",
];
/// words in a shortcut's name that mean it is not the game itself
const NOT_GAME_WORDS: &[&str] = &[
    "uninstall", "unins", "setup", "install", "updater", "readme", "manual", "help", "website", "documentation",
    "crash", "report", "config", "settings", "benchmark", "support", "license", "release notes", "changelog",
];
/// folders that only hold the system's and vendors' own programs
const SYSTEM_DIRS: &[&str] = &[
    r"\windows\", r"\microsoft", r"\windows kits", r"\common files\", r"\windowsapps\", r"\nvidia", r"\amd\", r"\steamapps\",
];

fn lnk_target(p: &Path) -> Option<PathBuf> {
    let link = lnk::ShellLink::open(p, lnk::encoding::WINDOWS_1254).ok()?;
    if let Some(li) = link.link_info() {
        if let Some(base) = li.local_base_path() {
            let t = PathBuf::from(format!("{}{}", base, li.common_path_suffix()));
            if t.exists() {
                return Some(t);
            }
        }
    }
    let rel = link.string_data().relative_path().clone()?;
    let c = std::fs::canonicalize(p.parent()?.join(rel)).ok()?;
    let s = c.to_string_lossy().to_string();
    Some(PathBuf::from(s.strip_prefix(r"\\?\").unwrap_or(&s))).filter(|x| x.exists())
}

fn shortcut_dirs() -> Vec<(PathBuf, &'static str, usize)> {
    let mut dirs = Vec::new();
    let up = std::env::var("USERPROFILE").unwrap_or_default();
    #[cfg(windows)]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        if let Ok(k) = winreg::RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders")
        {
            if let Ok(d) = k.get_value::<String, _>("Desktop") {
                dirs.push((PathBuf::from(d.replace("%USERPROFILE%", &up)), "desktop", 1));
            }
        }
    }
    dirs.push((PathBuf::from(&up).join("Desktop"), "desktop", 1));
    if let Ok(p) = std::env::var("PUBLIC") {
        dirs.push((PathBuf::from(p).join("Desktop"), "desktop", 1));
    }
    if let Ok(a) = std::env::var("APPDATA") {
        dirs.push((PathBuf::from(a).join(r"Microsoft\Windows\Start Menu\Programs"), "start", 3));
    }
    if let Ok(a) = std::env::var("PROGRAMDATA") {
        dirs.push((PathBuf::from(a).join(r"Microsoft\Windows\Start Menu\Programs"), "start", 3));
    }
    dirs
}

fn collect_lnk(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            if depth > 1 {
                collect_lnk(&p, depth - 1, out);
            }
        } else if p.extension().and_then(|x| x.to_str()).is_some_and(|x| x.eq_ignore_ascii_case("lnk")) {
            out.push(p);
        }
    }
}

/// a stable id for a game known only by its exe
pub fn exe_id(path: &str) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in path.to_lowercase().bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("exe-{h:016x}")
}

/// resolves a .lnk (or takes an .exe as is) into a game entry
pub fn from_path(path: &Path, origin: &str) -> Option<Found> {
    let ext = path.extension()?.to_str()?.to_lowercase();
    let (target, name) = match ext.as_str() {
        "lnk" => (lnk_target(path)?, path.file_stem()?.to_string_lossy().to_string()),
        "exe" => {
            // for a bare exe the folder name usually reads better than "game_x64.exe"
            let folder = path.parent().and_then(|p| p.file_name()).map(|s| s.to_string_lossy().to_string());
            let stem = path.file_stem()?.to_string_lossy().to_string();
            (path.to_path_buf(), folder.filter(|f| f.len() > 2 && !f.eq_ignore_ascii_case("bin") && !f.to_lowercase().starts_with("win")).unwrap_or(stem))
        }
        _ => return None,
    };
    let t = target.to_string_lossy().to_string();
    Some(Found {
        source: "local".into(),
        external_id: exe_id(&t),
        title: crate::meta::clean_name(&name),
        install_dir: target.parent().map(|p| p.to_string_lossy().to_string()),
        size_bytes: None,
        launch: Some(format!("exe:{t}")),
        known: false,
        origin: Some(origin.into()),
        guess: None,
        pending: false,
    })
}

/// where every desktop / Start-menu shortcut points (used to find emulators)
pub fn shortcut_targets() -> Vec<PathBuf> {
    let mut out = vec![];
    for (dir, _, depth) in shortcut_dirs() {
        let mut links = Vec::new();
        collect_lnk(&dir, depth, &mut links);
        out.extend(links.iter().filter_map(|l| lnk_target(l)));
    }
    out
}

fn shortcuts(taken: &[String]) -> Vec<Found> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for (dir, origin, depth) in shortcut_dirs() {
        let mut links = Vec::new();
        collect_lnk(&dir, depth, &mut links);
        for l in links {
            let Some(f) = from_path(&l, origin) else { continue };
            let Some(target) = f.launch.as_deref().and_then(|x| x.strip_prefix("exe:")).map(str::to_lowercase) else { continue };
            if !target.ends_with(".exe") || !seen.insert(target.clone()) {
                continue;
            }
            let stem = Path::new(&target).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            let lname = f.title.to_lowercase();
            if SYSTEM_DIRS.iter().any(|d| target.contains(d))
                || NOT_GAMES.contains(&stem.as_str())
                || NOT_GAMES.contains(&lname.as_str())
                || NOT_GAME_WORDS.iter().any(|w| lname.contains(w) || stem.contains(w))
                || taken.iter().any(|d| target.starts_with(d.as_str()))
            {
                continue;
            }
            out.push(f);
        }
    }
    out
}

fn steam() -> Vec<Found> {
    let Some(root) = crate::steam::root() else { return vec![] };
    crate::steam::installed(&root)
        .into_iter()
        .filter(|(_, i)| !i.name.is_empty() && !i.name.contains("Redistributable") && !i.name.starts_with("Steamworks"))
        .map(|(id, i)| Found {
            source: "steam".into(),
            external_id: id.to_string(),
            title: i.name,
            install_dir: Some(i.dir),
            size_bytes: Some(i.size),
            launch: None,
            known: false,
            origin: None,
            guess: None,
            pending: false,
        })
        .collect()
}

fn epic() -> Vec<Found> {
    let dir = PathBuf::from(r"C:\ProgramData\Epic\EpicGamesLauncher\Data\Manifests");
    let Ok(rd) = std::fs::read_dir(&dir) else { return vec![] };
    let mut out = Vec::new();
    for e in rd.flatten() {
        if e.path().extension().and_then(|x| x.to_str()) != Some("item") {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(e.path()) else { continue };
        let Ok(v) = serde_json::from_str::<Value>(&text) else { continue };
        let app = v["AppName"].as_str().unwrap_or_default();
        let is_game = v["AppCategories"].as_array().is_some_and(|c| c.iter().any(|x| x == "games"));
        let is_dlc = v["MainGameAppName"].as_str().is_some_and(|m| m != app);
        if app.is_empty() || !is_game || is_dlc || v["bIsIncompleteInstall"].as_bool() == Some(true) {
            continue;
        }
        out.push(Found {
            source: "epic".into(),
            external_id: app.to_string(),
            title: v["DisplayName"].as_str().unwrap_or(app).to_string(),
            install_dir: v["InstallLocation"].as_str().map(str::to_string),
            size_bytes: v["InstallSize"].as_i64(),
            launch: Some(format!("uri:com.epicgames.launcher://apps/{app}?action=launch&silent=true")),
            known: false,
            origin: None,
            guess: None,
            pending: false,
        });
    }
    out
}

#[cfg(windows)]
fn subkeys(path: &str) -> Vec<(String, winreg::RegKey)> {
    use winreg::enums::{HKEY_LOCAL_MACHINE, KEY_READ};
    let Ok(k) = winreg::RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey_with_flags(path, KEY_READ) else { return vec![] };
    k.enum_keys()
        .flatten()
        .filter_map(|name| k.open_subkey_with_flags(&name, KEY_READ).ok().map(|s| (name, s)))
        .collect()
}

#[cfg(windows)]
fn gog() -> Vec<Found> {
    subkeys(r"SOFTWARE\WOW6432Node\GOG.com\Games")
        .into_iter()
        .filter_map(|(id, k)| {
            let title: String = k.get_value("gameName").ok()?;
            let dir: Option<String> = k.get_value("path").ok();
            let exe: Option<String> = k.get_value("exe").ok();
            Some(Found {
                source: "gog".into(),
                external_id: id,
                title,
                install_dir: dir,
                size_bytes: None,
                launch: exe.filter(|e| Path::new(e).exists()).map(|e| format!("exe:{e}")),
                known: false,
                origin: None,
                guess: None,
                pending: false,
            })
        })
        .collect()
}

#[cfg(windows)]
fn ubisoft() -> Vec<Found> {
    subkeys(r"SOFTWARE\WOW6432Node\Ubisoft\Launcher\Installs")
        .into_iter()
        .filter_map(|(id, k)| {
            let dir: String = k.get_value("InstallDir").ok()?;
            let title = Path::new(dir.trim_end_matches(['/', '\\'])).file_name()?.to_string_lossy().to_string();
            Some(Found {
                source: "ubisoft".into(),
                external_id: id.clone(),
                title,
                install_dir: Some(dir),
                size_bytes: None,
                launch: Some(format!("uri:uplay://launch/{id}/0")),
                known: false,
                origin: None,
                guess: None,
                pending: false,
            })
        })
        .collect()
}

fn attr<'a>(xml: &'a str, tag: &str, name: &str) -> Option<&'a str> {
    let start = xml.find(&format!("<{tag} ")).or_else(|| xml.find(&format!("<{tag}
")))?;
    let rest = &xml[start..];
    let end = rest.find('>')?;
    let el = &rest[..end];
    let key = format!("{name}=\"");
    let a = el.find(&key)? + key.len();
    let b = el[a..].find('"')? + a;
    Some(&el[a..b])
}

/// the biggest exe in a game's folder (or one level down) that is not a tool
pub fn main_exe(dir: &Path) -> Option<PathBuf> {
    fn walk(d: &Path, depth: usize, out: &mut Vec<(u64, PathBuf)>) {
        let Ok(rd) = std::fs::read_dir(d) else { return };
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                let n = e.file_name().to_string_lossy().to_lowercase();
                if depth < 3 && !["redist", "_commonredist", "directx", "support", "__installer", "installer", "tools"].contains(&n.as_str()) {
                    walk(&p, depth + 1, out);
                }
            } else if p.extension().and_then(|x| x.to_str()).is_some_and(|x| x.eq_ignore_ascii_case("exe")) {
                let stem = p.file_stem().map(|x| x.to_string_lossy().to_lowercase()).unwrap_or_default();
                let tool = NOT_GAMES.contains(&stem.as_str())
                    || NOT_GAME_WORDS.iter().any(|w| stem.contains(w))
                    || ["crashpad", "crashhandler", "unitycrash", "easyanticheat", "battleye", "beservice", "vc_redist", "dxsetup", "touchup", "cleanup", "activation", "eaanticheat"]
                        .iter()
                        .any(|w| stem.contains(w));
                if !tool {
                    out.push((e.metadata().map(|m| m.len()).unwrap_or(0), p));
                }
            }
        }
    }
    let mut all = vec![];
    walk(dir, 0, &mut all);
    all.into_iter().max_by_key(|(n, _)| *n).map(|(_, p)| p)
}

/// Battle.net product codes for its install ids (the launcher starts games by code)
fn battlenet_code(uid: &str) -> Option<&'static str> {
    Some(match uid.trim_end_matches("_beta").trim_end_matches("_ptr") {
        "wow" | "wow_classic" | "wow_classic_era" => "WoW",
        "prometheus" => "Pro",
        "fenris" => "Fen",
        "osi" => "OSI",
        "diablo3" | "d3" => "D3",
        "hs" | "hs_beta" => "WTCG",
        "heroes" => "Hero",
        "s2" => "S2",
        "s1" => "S1",
        "w3" => "W3",
        "anbs" => "ANBS",
        "viper" => "VIPR",
        "odin" => "ODIN",
        "lazarus" => "LAZR",
        "zeus" => "ZEUS",
        "fore" => "FORE",
        "auks" => "AUKS",
        "wlby" => "WLBY",
        "rtro" => "RTRO",
        _ => return None,
    })
}

/// EA app and Battle.net games, from Windows' list of installed programs
#[cfg(windows)]
fn from_uninstall() -> Vec<Found> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ};
    let roots = [
        (HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
        (HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
        (HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
    ];
    let mut out: Vec<Found> = vec![];
    for (hive, path) in roots {
        let Ok(k) = winreg::RegKey::predef(hive).open_subkey_with_flags(path, KEY_READ) else { continue };
        for name in k.enum_keys().flatten() {
            let Ok(sub) = k.open_subkey_with_flags(&name, KEY_READ) else { continue };
            let title: String = sub.get_value("DisplayName").unwrap_or_default();
            let uninstall: String = sub.get_value("UninstallString").unwrap_or_default();
            let publisher: String = sub.get_value("Publisher").unwrap_or_default();
            let dir: String = sub.get_value("InstallLocation").unwrap_or_default();
            let dir = dir.trim().trim_matches('"').trim_end_matches(['\\', '/']).to_string();
            if title.is_empty() || dir.is_empty() || !Path::new(&dir).is_dir() {
                continue;
            }
            let low = uninstall.to_lowercase();
            let (source, id, launch) = if low.contains("blizzard uninstaller") || low.contains("battle.net\\agent") {
                if title.eq_ignore_ascii_case("Battle.net") {
                    continue;
                }
                let uid = low.split("--uid=").nth(1).map(|r| r.split([' ', '"']).next().unwrap_or("").to_string()).unwrap_or_else(|| name.to_lowercase());
                let launch = battlenet_code(&uid)
                    .map(|c| format!("uri:battlenet://{c}"))
                    .or_else(|| main_exe(Path::new(&dir)).map(|p| format!("exe:{}", p.to_string_lossy())));
                ("battlenet", uid, launch)
            } else if low.contains("eainstaller") || (publisher.starts_with("Electronic Arts") && low.contains("cleanup")) {
                if title.eq_ignore_ascii_case("EA app") || title.eq_ignore_ascii_case("EA") || title.contains("Origin") {
                    continue;
                }
                let launch = main_exe(Path::new(&dir)).map(|p| format!("exe:{}", p.to_string_lossy()));
                ("ea", name.clone(), launch)
            } else {
                continue;
            };
            if out.iter().any(|f| f.source == source && f.external_id == id) {
                continue;
            }
            out.push(Found {
                source: source.into(),
                external_id: id,
                title: crate::meta::clean_name(&title),
                install_dir: Some(dir),
                size_bytes: sub.get_value::<u32, _>("EstimatedSize").ok().map(|kb| kb as i64 * 1024),
                launch,
                known: false,
                origin: None,
                guess: None,
                pending: false,
            });
        }
    }
    out
}

/// Xbox app / Game Pass games installed in <drive>:\XboxGames
fn xbox() -> Vec<Found> {
    let mut out = Vec::new();
    for letter in b'C'..=b'Z' {
        let base = PathBuf::from(format!("{}:\\XboxGames", letter as char));
        let Ok(rd) = std::fs::read_dir(&base) else { continue };
        for e in rd.flatten() {
            let content = e.path().join("Content");
            let cfg = ["MicrosoftGame.config", "MicrosoftGame.Config"].iter().map(|n| content.join(n)).find(|p| p.exists());
            let Some(cfg) = cfg else { continue };
            let Ok(xml) = std::fs::read_to_string(&cfg) else { continue };
            let title = attr(&xml, "ShellVisuals", "DefaultDisplayName")
                .filter(|t| !t.starts_with("ms-resource"))
                .map(str::to_string)
                .unwrap_or_else(|| e.file_name().to_string_lossy().to_string());
            let id = xml
                .find("<StoreId>")
                .and_then(|s| xml[s + 9..].find("</StoreId>").map(|t| xml[s + 9..s + 9 + t].trim().to_string()))
                .or_else(|| attr(&xml, "Identity", "Name").map(str::to_string))
                .unwrap_or_else(|| title.clone());
            let exe = attr(&xml, "Executable", "Name").map(|n| content.join(n)).filter(|p| p.exists());
            out.push(Found {
                source: "xbox".into(),
                external_id: id,
                title,
                install_dir: Some(content.to_string_lossy().to_string()),
                size_bytes: None,
                launch: exe.map(|p| format!("exe:{}", p.to_string_lossy())),
                known: false,
                origin: None,
                guess: None,
                pending: false,
            });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    #[test]
    #[ignore = "reads this PC's launchers"]
    fn scan_here() {
        let found = super::all();
        for f in &found {
            println!("{:8} {:30} {:?} {}", f.source, f.title, f.origin, f.launch.as_deref().unwrap_or("-"));
        }
        println!("{} found", found.len());
    }
}
