//! Steam: local client files (no login needed) + Steam's public endpoints.
//! A Web API key is optional and belongs to the user; it only adds games that
//! were never launched on this PC and the per-player achievement list.

use crate::vdf::{self, Vdf};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

pub const STEAMID64_BASE: u64 = 76561197960265728;
const CDN: &str = "https://shared.steamstatic.com/store_item_assets/";

pub fn root() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        if let Ok(k) = winreg::RegKey::predef(HKEY_CURRENT_USER).open_subkey("Software\\Valve\\Steam") {
            if let Ok(p) = k.get_value::<String, _>("SteamPath") {
                let p = PathBuf::from(p.replace('/', "\\"));
                if p.exists() {
                    return Some(p);
                }
            }
        }
        let fallback = PathBuf::from(r"C:\Program Files (x86)\Steam");
        if fallback.exists() {
            return Some(fallback);
        }
    }
    None
}

fn read(p: &Path) -> Option<Vdf> {
    std::fs::read_to_string(p).ok().map(|s| vdf::parse(&s))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAccount {
    pub steamid: String,
    pub persona: String,
    pub most_recent: bool,
    pub has_local_data: bool,
}

/// Steam accounts that have signed in on this PC (from Steam's own loginusers.vdf).
/// The login name is deliberately not read.
pub fn local_accounts(root: &Path) -> Vec<LocalAccount> {
    let Some(v) = read(&root.join("config").join("loginusers.vdf")) else { return vec![] };
    let Some(users) = v.get("users") else { return vec![] };
    users
        .entries()
        .iter()
        .filter_map(|(id, u)| {
            let sid: u64 = id.parse().ok()?;
            let account_id = sid.checked_sub(STEAMID64_BASE)?;
            Some(LocalAccount {
                steamid: id.clone(),
                persona: u.get_str("PersonaName").unwrap_or("Steam").to_string(),
                most_recent: u.get_str("MostRecent") == Some("1") || u.get_str("mostrecent") == Some("1"),
                has_local_data: root.join("userdata").join(account_id.to_string()).exists(),
            })
        })
        .collect()
}

pub struct Installed {
    pub name: String,
    pub dir: String,
    pub size: i64,
    pub last_played: Option<i64>,
}

pub fn installed(root: &Path) -> HashMap<u32, Installed> {
    let mut out = HashMap::new();
    let mut libs: Vec<PathBuf> = vec![root.to_path_buf()];
    if let Some(v) = read(&root.join("steamapps").join("libraryfolders.vdf")) {
        if let Some(lf) = v.get("libraryfolders") {
            for (_, lib) in lf.entries() {
                if let Some(p) = lib.get_str("path") {
                    let p = PathBuf::from(p);
                    if !libs.contains(&p) {
                        libs.push(p);
                    }
                }
            }
        }
    }
    for lib in libs {
        let apps = lib.join("steamapps");
        let Ok(rd) = std::fs::read_dir(&apps) else { continue };
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if !(name.starts_with("appmanifest_") && name.ends_with(".acf")) {
                continue;
            }
            let Some(v) = read(&e.path()) else { continue };
            let Some(st) = v.get("AppState") else { continue };
            let Some(appid) = st.get_u64("appid") else { continue };
            // StateFlags 4 = fully installed
            let flags = st.get_u64("StateFlags").unwrap_or(0);
            if flags & 4 == 0 {
                continue;
            }
            let dir = apps.join("common").join(st.get_str("installdir").unwrap_or_default());
            out.insert(
                appid as u32,
                Installed {
                    name: st.get_str("name").unwrap_or_default().to_string(),
                    dir: dir.to_string_lossy().to_string(),
                    size: st.get_u64("SizeOnDisk").unwrap_or(0) as i64,
                    last_played: st.get_u64("LastPlayed").filter(|t| *t > 0).map(|t| t as i64),
                },
            );
        }
    }
    out
}

/// minutes and last-played time per app for one account, from the Steam client's localconfig.vdf
pub fn local_playtime(root: &Path, steamid: &str) -> HashMap<u32, (i64, Option<i64>)> {
    let mut out = HashMap::new();
    let Some(account_id) = steamid.parse::<u64>().ok().and_then(|s| s.checked_sub(STEAMID64_BASE)) else { return out };
    let p = root.join("userdata").join(account_id.to_string()).join("config").join("localconfig.vdf");
    let Some(v) = read(&p) else { return out };
    let Some(apps) = v.path(&["UserLocalConfigStore", "Software", "Valve", "Steam", "apps"]) else { return out };
    for (id, a) in apps.entries() {
        let Ok(appid) = id.parse::<u32>() else { continue };
        let minutes = a.get_u64("Playtime").unwrap_or(0) as i64;
        let last = a.get_u64("LastPlayed").filter(|t| *t > 0).map(|t| t as i64);
        if minutes > 0 || last.is_some() {
            out.insert(appid, (minutes, last));
        }
    }
    out
}

pub struct Owned {
    pub name: String,
    pub minutes: i64,
    pub last_played: Option<i64>,
}

pub async fn owned_games(http: &reqwest::Client, key: &str, steamid: &str) -> Result<HashMap<u32, Owned>, String> {
    let r: Value = http
        .get("https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/")
        .query(&[("key", key), ("steamid", steamid), ("include_appinfo", "1"), ("include_played_free_games", "1"), ("format", "json")])
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| crate::tr!("Steam Web API isteği reddetti ({e}). Anahtarı kontrol et.", "Steam Web API refused the request ({e}). Check the key."))?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let mut out = HashMap::new();
    for g in r["response"]["games"].as_array().cloned().unwrap_or_default() {
        if let Some(appid) = g["appid"].as_u64() {
            out.insert(
                appid as u32,
                Owned {
                    name: g["name"].as_str().unwrap_or_default().to_string(),
                    minutes: g["playtime_forever"].as_i64().unwrap_or(0),
                    last_played: g["rtime_last_played"].as_i64().filter(|t| *t > 0),
                },
            );
        }
    }
    Ok(out)
}

pub fn asset(fmt: &str, file: Option<&str>) -> Value {
    match file {
        Some(f) if !f.is_empty() => Value::String(format!("{CDN}{}", fmt.replace("${FILENAME}", f))),
        _ => Value::Null,
    }
}

/// Store data for many apps at once, keyless (IStoreBrowseService/GetItems).
/// Returns our compact meta JSON per appid; `type` 0 means a game.
pub async fn store_items(http: &reqwest::Client, ids: &[u32]) -> HashMap<u32, Value> {
    let mut out = HashMap::new();
    let tag_names = if ids.is_empty() { HashMap::new() } else { tag_list(http).await };
    for chunk in ids.chunks(60) {
        let req = json!({
            "ids": chunk.iter().map(|id| json!({ "appid": id })).collect::<Vec<_>>(),
            "context": { "language": crate::steam_lang(), "country_code": "TR" },
            "data_request": {
                "include_assets": true, "include_basic_info": true, "include_release": true, "include_screenshots": true,
                "include_tag_count": 15, "include_reviews": true, "include_platforms": true
            }
        });
        let Ok(resp) = http
            .get("https://api.steampowered.com/IStoreBrowseService/GetItems/v1/")
            .query(&[("input_json", req.to_string())])
            .send()
            .await
        else {
            continue;
        };
        let Ok(v) = resp.json::<Value>().await else { continue };
        for item in v["response"]["store_items"].as_array().cloned().unwrap_or_default() {
            let Some(appid) = item["appid"].as_u64().or_else(|| item["id"].as_u64()) else { continue };
            if item["success"].as_i64() != Some(1) {
                out.insert(appid as u32, json!({ "missing": true }));
                continue;
            }
            let a = &item["assets"];
            let fmt = a["asset_url_format"].as_str().unwrap_or("");
            let shots: Vec<Value> = item["screenshots"]["all_ages_screenshots"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .iter()
                .take(6)
                .filter_map(|s| s["filename"].as_str().map(|f| Value::String(format!("{CDN}{f}"))))
                .collect();
            let names = |k: &str| -> Vec<Value> {
                item["basic_info"][k]
                    .as_array()
                    .map(|v| v.iter().filter_map(|p| p["name"].as_str().map(|s| Value::String(s.to_string()))).collect())
                    .unwrap_or_default()
            };
            let icon = a["community_icon"].as_str().map(|h| {
                format!("https://cdn.fastly.steamstatic.com/steamcommunity/public/images/apps/{appid}/{h}.jpg")
            });
            let mut m = json!({
                    "name": item["name"],
                    "type": item["type"].as_i64().unwrap_or(-1),
                    "isFree": item["is_free"].as_bool().unwrap_or(false),
                    "short": item["basic_info"]["short_description"],
                    "developers": names("developers"),
                    "publishers": names("publishers"),
                    "release": item["release"]["steam_release_date"],
                    "cover": asset(fmt, a["library_capsule_2x"].as_str().or(a["library_capsule"].as_str())),
                    "hero": asset(fmt, a["library_hero"].as_str()),
                    "header": asset(fmt, a["header"].as_str()),
                    "logo": format!("{CDN}steam/apps/{appid}/logo.png"),
                    "icon": icon,
                    "screenshots": shots,
            });
            if let Some(obj) = m.as_object_mut() {
                for (k, v) in library_facts(&item, &tag_names) {
                    obj.insert(k.into(), v);
                }
            }
            out.insert(appid as u32, m);
        }
    }
    out
}

/// Steam's tags whose names are genres ("Aksiyon", "RYO"…), for games with no genre list yet
const GENRE_TAGS: &[u64] = &[19, 21, 9, 122, 599, 597, 701, 699, 128];

/// what the library filters on: store tags, features (co-op, controller, cloud…),
/// and the users' review score
fn library_facts(item: &Value, tag_names: &HashMap<u64, String>) -> Vec<(&'static str, Value)> {
    let mut out = Vec::new();
    if !tag_names.is_empty() {
        let ids: Vec<u64> = item["tagids"].as_array().map(|a| a.iter().filter_map(Value::as_u64).collect()).unwrap_or_default();
        let name = |id: &u64| tag_names.get(id).cloned();
        out.push(("storeTags", json!(ids.iter().filter_map(name).collect::<Vec<_>>())));
        out.push(("tagGenres", json!(ids.iter().filter(|i| GENRE_TAGS.contains(i)).filter_map(name).collect::<Vec<_>>())));
    }
    let cat = &item["categories"];
    let mut feats: Vec<&str> = Vec::new();
    for k in ["supported_player_categoryids", "feature_categoryids", "controller_categoryids"] {
        for id in cat[k].as_array().into_iter().flatten().filter_map(Value::as_u64) {
            let f = match id {
                2 => "single",
                1 => "multi",
                9 => "coop",
                38 => "online-coop",
                39 | 48 => "local-coop",
                24 | 37 => "split",
                49 | 36 | 47 => "pvp",
                20 => "mmo",
                22 => "achievements",
                23 => "cloud",
                30 => "workshop",
                29 => "cards",
                62 => "family",
                44 => "remote-together",
                28 => "controller",
                18 => "controller-partial",
                31 | 53 | 54 => "vr",
                _ => continue,
            };
            if !feats.contains(&f) {
                feats.push(f);
            }
        }
    }
    let plat = &item["platforms"];
    if plat["vr_support"].as_object().is_some_and(|o| !o.is_empty()) && !feats.contains(&"vr") {
        feats.push("vr");
    }
    match plat["steam_deck_compat_category"].as_i64() {
        Some(3) => feats.push("deck-verified"),
        Some(2) => feats.push("deck-playable"),
        _ => {}
    }
    if cat.is_object() {
        out.push(("features", json!(feats)));
    }
    let rev = &item["reviews"]["summary_filtered"];
    if rev["review_count"].as_u64().is_some_and(|n| n > 0) {
        out.push(("userScore", rev["percent_positive"].clone()));
        out.push(("reviewCount", rev["review_count"].clone()));
    }
    out
}

static TAGS: std::sync::Mutex<Option<HashMap<u64, String>>> = std::sync::Mutex::new(None);

/// Steam's tag names in Turkish, fetched once per run
pub async fn tag_list(http: &reqwest::Client) -> HashMap<u64, String> {
    if let Some(t) = TAGS.lock().unwrap().clone() {
        return t;
    }
    let Ok(resp) = http.get("https://api.steampowered.com/IStoreService/GetTagList/v1/").query(&[("language", crate::steam_lang())]).send().await else {
        return HashMap::new();
    };
    let Ok(v) = resp.json::<Value>().await else { return HashMap::new() };
    let map: HashMap<u64, String> = v["response"]["tags"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|t| Some((t["tagid"].as_u64()?, t["name"].as_str()?.to_string())))
        .collect();
    if !map.is_empty() {
        *TAGS.lock().unwrap() = Some(map.clone());
    }
    map
}

/// Metacritic score and Steam's genre list, the light way (no reviews call).
/// Err only when Steam pushes back, so the caller can slow down.
pub async fn scores(http: &reqwest::Client, appid: u32) -> Result<Value, String> {
    let resp = http
        .get("https://store.steampowered.com/api/appdetails")
        .query(&[("appids", appid.to_string()), ("l", crate::steam_lang().into()), ("filters", "genres,metacritic".into())])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(resp.status().to_string());
    }
    let d: Value = resp.json().await.map_err(|e| e.to_string())?;
    let data = &d[appid.to_string()]["data"];
    let genres: Vec<Value> = data["genres"]
        .as_array()
        .map(|g| g.iter().filter_map(|x| x["description"].as_str().map(|s| Value::String(s.into()))).collect())
        .unwrap_or_default();
    Ok(json!({ "metacritic": data["metacritic"]["score"], "genres": genres }))
}

/// public display name for a SteamID (community profile XML), used after browser sign-in
pub async fn persona_of(http: &reqwest::Client, steamid: &str) -> Option<String> {
    let body = http
        .get(format!("https://steamcommunity.com/profiles/{steamid}/?xml=1"))
        .send()
        .await
        .ok()?
        .text()
        .await
        .ok()?;
    let start = body.find("<steamID><![CDATA[")? + "<steamID><![CDATA[".len();
    let end = body[start..].find("]]>")? + start;
    Some(body[start..end].to_string())
}

// ---------------------------------------------------------------- OpenID sign-in
pub const RETURN_TO: &str = "http://127.0.0.1:47613/steam-callback";

pub fn openid_url() -> String {
    let mut u = url::Url::parse("https://steamcommunity.com/openid/login").unwrap();
    u.query_pairs_mut()
        .append_pair("openid.ns", "http://specs.openid.net/auth/2.0")
        .append_pair("openid.mode", "checkid_setup")
        .append_pair("openid.return_to", RETURN_TO)
        .append_pair("openid.realm", "http://127.0.0.1:47613/")
        .append_pair("openid.identity", "http://specs.openid.net/auth/2.0/identifier_select")
        .append_pair("openid.claimed_id", "http://specs.openid.net/auth/2.0/identifier_select");
    u.to_string()
}

/// Asks Steam to confirm the signed assertion, then returns the SteamID64.
pub async fn verify_openid(http: &reqwest::Client, callback: &str) -> Result<String, String> {
    let u = url::Url::parse(callback).map_err(|e| e.to_string())?;
    let mut form: Vec<(String, String)> = u.query_pairs().map(|(k, v)| (k.to_string(), v.to_string())).collect();
    let claimed = form
        .iter()
        .find(|(k, _)| k == "openid.claimed_id")
        .map(|(_, v)| v.clone())
        .ok_or(crate::l("Steam bir kimlik döndürmedi.", "Steam did not return an ID."))?;
    for (k, v) in form.iter_mut() {
        if k == "openid.mode" {
            *v = "check_authentication".into();
        }
    }
    let text = http
        .post("https://steamcommunity.com/openid/login")
        .form(&form)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    if !text.contains("is_valid:true") {
        return Err(crate::l("Steam girişi doğrulanamadı.", "Could not verify the Steam sign-in.").into());
    }
    let id = claimed.rsplit('/').next().unwrap_or_default().to_string();
    if id.len() != 17 || !id.chars().all(|c| c.is_ascii_digit()) {
        return Err(crate::l("Steam kimliği okunamadı.", "Could not read the Steam ID.").into());
    }
    Ok(id)
}

// ---------------------------------------------------------------- achievements
pub async fn achievements(http: &reqwest::Client, key: Option<&str>, steamid: &str, appid: u32) -> Result<Value, String> {
    let pct: Value = http
        .get("https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/")
        .query(&[("gameid", appid.to_string())])
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .unwrap_or(Value::Null);
    let mut percents: HashMap<String, f64> = HashMap::new();
    for a in pct["achievementpercentages"]["achievements"].as_array().cloned().unwrap_or_default() {
        if let (Some(n), Some(p)) = (a["name"].as_str(), a["percent"].as_str().and_then(|s| s.parse().ok()).or(a["percent"].as_f64())) {
            percents.insert(n.to_string(), p);
        }
    }
    let Some(key) = key else {
        return Ok(json!({ "needsKey": true, "total": percents.len() }));
    };
    let schema: Value = http
        .get("https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/")
        .query(&[("key", key), ("appid", &appid.to_string()), ("l", crate::steam_lang())])
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let player: Value = http
        .get("https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/")
        .query(&[("key", key), ("steamid", steamid), ("appid", &appid.to_string())])
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .unwrap_or(Value::Null);
    if player["playerstats"]["success"].as_bool() == Some(false) {
        let msg = player["playerstats"]["error"].as_str().unwrap_or("Profil gizli olabilir.");
        return Ok(json!({ "error": msg }));
    }
    let mut state: HashMap<String, i64> = HashMap::new();
    for a in player["playerstats"]["achievements"].as_array().cloned().unwrap_or_default() {
        if a["achieved"].as_i64() == Some(1) {
            state.insert(a["apiname"].as_str().unwrap_or_default().to_string(), a["unlocktime"].as_i64().unwrap_or(0));
        }
    }
    let list: Vec<Value> = schema["game"]["availableGameStats"]["achievements"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|a| {
            let api = a["name"].as_str().unwrap_or_default();
            json!({
                "api": api,
                "name": a["displayName"],
                "description": a["description"].as_str().unwrap_or(""),
                "hidden": a["hidden"].as_i64() == Some(1),
                "icon": a["icon"],
                "percent": percents.get(api).map(|p| (p * 10.0).round() / 10.0),
                "unlockedAt": state.get(api).filter(|t| **t > 0).copied(),
            })
        })
        .collect();
    Ok(json!({ "list": list }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "reads the local Steam install"]
    fn local_steam_files() {
        let r = root().expect("steam root");
        let accs = local_accounts(&r);
        let inst = installed(&r);
        println!("accounts: {}, with local data: {}", accs.len(), accs.iter().filter(|a| a.has_local_data).count());
        println!("installed apps: {}", inst.len());
        for a in &accs {
            let pt = local_playtime(&r, &a.steamid);
            let total: i64 = pt.values().map(|v| v.0).sum();
            println!("apps with playtime: {}, total hours: {}", pt.len(), total / 60);
        }
        let rt = tokio_rt();
        let http = reqwest::Client::new();
        let ids: Vec<u32> = inst.keys().copied().take(5).collect();
        let m = rt.block_on(store_items(&http, &ids));
        for (id, v) in m {
            println!("{id}: type={} name={} cover={}", v["type"], v["name"], v["cover"].is_string());
        }
    }

    fn tokio_rt() -> tauri::async_runtime::RuntimeHandle {
        tauri::async_runtime::handle()
    }
}

// ---------------------------------------------------------------- store page details
/// The long store description (Turkish when Steam has it), genres, Metacritic and
/// the user-review summary. All public, no key.
pub async fn app_details(http: &reqwest::Client, appid: u32) -> Result<Value, String> {
    let d: Value = http
        .get("https://store.steampowered.com/api/appdetails")
        .query(&[("appids", appid.to_string()), ("l", crate::steam_lang().into()), ("cc", "tr".into())])
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let data = &d[appid.to_string()]["data"];
    let r: Value = http
        .get(format!("https://store.steampowered.com/appreviews/{appid}"))
        .query(&[("json", "1"), ("language", "all"), ("purchase_type", "all"), ("num_per_page", "0"), ("filter", "summary")])
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .unwrap_or(Value::Null);
    let qs = &r["query_summary"];
    let genres: Vec<Value> = data["genres"]
        .as_array()
        .map(|g| g.iter().filter_map(|x| x["description"].as_str().map(|s| Value::String(s.into()))).collect())
        .unwrap_or_default();
    Ok(json!({
        "about": data["about_the_game"].as_str().or(data["detailed_description"].as_str()).unwrap_or(""),
        "genres": genres,
        "metacritic": data["metacritic"]["score"],
        "website": data["website"],
        "storageGB": data["pc_requirements"]["minimum"].as_str().and_then(storage_gb)
            .or_else(|| data["pc_requirements"]["recommended"].as_str().and_then(storage_gb)),
        "reviews": {
            "score": qs["review_score"],
            "positive": qs["total_positive"],
            "total": qs["total_reviews"],
        }
    }))
}

/// "Depolama: 50 GB kullanılabilir alan" / "Storage: 512 MB" in a requirements block → GB
pub fn storage_gb(html: &str) -> Option<f64> {
    let text = html.replace("<br>", "\n").replace("</li>", "\n");
    let mut plain = String::new();
    let mut tag = false;
    for c in text.chars() {
        match c {
            '<' => tag = true,
            '>' => tag = false,
            _ if !tag => plain.push(c),
            _ => {}
        }
    }
    let keys = ["depolama", "storage", "hard drive", "hard disk", "sabit disk", "disk alan", "hdd", "ssd", "boş alan"];
    for line in plain.lines() {
        let low = line.to_lowercase();
        if !keys.iter().any(|k| low.contains(k)) {
            continue;
        }
        let chars: Vec<char> = low.chars().collect();
        let mut i = 0;
        while i < chars.len() {
            if chars[i].is_ascii_digit() {
                let start = i;
                while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.' || chars[i] == ',') {
                    i += 1;
                }
                let num: f64 = chars[start..i].iter().collect::<String>().replace(',', ".").trim_end_matches('.').parse().ok()?;
                let rest: String = chars[i..].iter().collect::<String>().trim_start().chars().take(2).collect();
                match rest.as_str() {
                    "gb" => return Some(num),
                    "mb" => return Some(num / 1024.0),
                    "tb" => return Some(num * 1024.0),
                    _ => {}
                }
            } else {
                i += 1;
            }
        }
    }
    None
}

#[cfg(test)]
mod storage_tests {
    #[test]
    fn reads_storage_lines() {
        assert_eq!(super::storage_gb("<ul><li><strong>Depolama:</strong> 50 GB kullanılabilir alan</li></ul>"), Some(50.0));
        assert_eq!(super::storage_gb("<strong>Storage:</strong> 512 MB available space<br>"), Some(0.5));
        assert_eq!(super::storage_gb("<strong>Hard Drive:</strong> 1,5 GB<br><strong>Memory:</strong> 8 GB RAM"), Some(1.5));
        assert_eq!(super::storage_gb("<strong>Memory:</strong> 8 GB RAM"), None);
    }
}

// ---------------------------------------------------------------- the user's own collections
#[derive(Serialize, Debug)]
pub struct SteamCollection {
    pub name: String,
    pub apps: Vec<u32>,
}

#[derive(Serialize, Default, Debug)]
pub struct Collections {
    pub collections: Vec<SteamCollection>,
    pub favorites: Vec<u32>,
}

/// The collections the user made in the Steam library. The client keeps them in
/// userdata/<account>/config/cloudstorage (namespace 1); changes made on this PC
/// and not yet synced sit in the ".modified" file next to it, so that one wins.
/// Dynamic collections (a saved filter with no list of games) and "hidden" are left
/// out. Older clients kept a list of tags per app in sharedconfig.vdf instead; that
/// is read when the new file holds nothing.
pub fn collections(root: &Path, steamid: &str) -> Collections {
    let Some(account_id) = steamid.parse::<u64>().ok().and_then(|s| s.checked_sub(STEAMID64_BASE)) else { return Collections::default() };
    let user = root.join("userdata").join(account_id.to_string());
    let dir = user.join("config").join("cloudstorage");
    let mut entries: Vec<(String, Value)> = vec![];
    for f in ["cloud-storage-namespace-1.json", "cloud-storage-namespace-1.modified.json"] {
        let Ok(text) = std::fs::read_to_string(dir.join(f)) else { continue };
        let Ok(Value::Array(items)) = serde_json::from_str::<Value>(&text) else { continue };
        for it in items {
            let (Some(k), Some(v)) = (it[0].as_str(), it.get(1)) else { continue };
            if !k.starts_with("user-collections.") {
                continue;
            }
            entries.retain(|(key, _)| key != k);
            entries.push((k.to_string(), v.clone()));
        }
    }
    let out = from_cloud(&entries);
    if !out.collections.is_empty() || !out.favorites.is_empty() {
        return out;
    }
    read(&user.join("7").join("remote").join("sharedconfig.vdf")).map(|v| from_tags(&v)).unwrap_or_default()
}

fn from_cloud(entries: &[(String, Value)]) -> Collections {
    let mut out = Collections::default();
    for (_, e) in entries {
        if e["is_deleted"].as_bool() == Some(true) {
            continue;
        }
        let Some(val) = e["value"].as_str().and_then(|s| serde_json::from_str::<Value>(s).ok()) else { continue };
        let ids = |k: &str| -> Vec<u32> {
            val[k].as_array().map(|a| a.iter().filter_map(|x| x.as_u64()).filter_map(|x| u32::try_from(x).ok()).collect()).unwrap_or_default()
        };
        let removed = ids("removed");
        let apps: Vec<u32> = ids("added").into_iter().filter(|a| !removed.contains(a)).collect();
        match val["id"].as_str().unwrap_or_default() {
            "hidden" => {}
            "favorite" => out.favorites = apps,
            _ if !val["filterSpec"].is_null() => {}
            _ => {
                let name = val["name"].as_str().unwrap_or_default().trim().to_string();
                if !name.is_empty() && !apps.is_empty() {
                    out.collections.push(SteamCollection { name, apps });
                }
            }
        }
    }
    out.collections.sort_by_key(|c| c.name.to_lowercase());
    out
}

fn from_tags(v: &Vdf) -> Collections {
    let mut out = Collections::default();
    let Some(apps) = v.path(&["UserRoamingConfigStore", "Software", "Valve", "Steam", "apps"]) else { return out };
    let mut by_name: Vec<SteamCollection> = vec![];
    for (id, a) in apps.entries() {
        let Ok(appid) = id.parse::<u32>() else { continue };
        let Some(tags) = a.get("tags") else { continue };
        for (_, t) in tags.entries() {
            let Some(name) = t.str().map(str::trim).filter(|s| !s.is_empty()) else { continue };
            if name == "favorite" {
                out.favorites.push(appid);
            } else if let Some(c) = by_name.iter_mut().find(|c| c.name == name) {
                c.apps.push(appid);
            } else {
                by_name.push(SteamCollection { name: name.to_string(), apps: vec![appid] });
            }
        }
    }
    by_name.sort_by_key(|c| c.name.to_lowercase());
    out.collections = by_name;
    out
}

#[cfg(test)]
mod collection_tests {
    use super::*;

    fn entry(key: &str, value: Option<Value>) -> (String, Value) {
        match value {
            Some(v) => (key.into(), json!({ "key": key, "value": v.to_string() })),
            None => (key.into(), json!({ "key": key, "is_deleted": true })),
        }
    }

    #[test]
    fn reads_cloud_collections() {
        let e = vec![
            entry("user-collections.favorite", Some(json!({ "id": "favorite", "name": "", "added": [10, 20], "removed": [] }))),
            entry("user-collections.hidden", Some(json!({ "id": "hidden", "name": "", "added": [30], "removed": [] }))),
            entry("user-collections.uc-a", Some(json!({ "id": "uc-a", "name": "Korku", "added": [40, 50, 60], "removed": [50] }))),
            entry("user-collections.uc-b", Some(json!({ "id": "uc-b", "name": "Dynamic", "added": [], "filterSpec": { "nFormatVersion": 2 } }))),
            entry("user-collections.uc-c", None),
            entry("user-collections.uc-d", Some(json!({ "id": "uc-d", "name": "aksiyon", "added": [70], "removed": [] }))),
        ];
        let c = from_cloud(&e);
        assert_eq!(c.favorites, vec![10, 20]);
        let names: Vec<&str> = c.collections.iter().map(|x| x.name.as_str()).collect();
        assert_eq!(names, vec!["aksiyon", "Korku"]);
        assert_eq!(c.collections[1].apps, vec![40, 60]);
    }

    #[test]
    fn reads_old_tags() {
        let v = vdf::parse(r#""UserRoamingConfigStore" { "Software" { "Valve" { "Steam" { "apps" {
            "10" { "tags" { "0" "favorite" "1" "Korku" } }
            "20" { "tags" { "0" "Korku" } }
            "30" { "LastPlayed" "1" }
        } } } } }"#);
        let c = from_tags(&v);
        assert_eq!(c.favorites, vec![10]);
        assert_eq!(c.collections.len(), 1);
        assert_eq!(c.collections[0].apps, vec![10, 20]);
    }

    #[test]
    #[ignore = "reads the local Steam install"]
    fn local_collections() {
        let r = root().expect("steam root");
        for a in local_accounts(&r) {
            let c = collections(&r, &a.steamid);
            println!("collections: {}, favorites: {}", c.collections.len(), c.favorites.len());
        }
    }
}
