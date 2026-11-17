//! The user's own screenshots of a game, as Steam keeps them on this PC
//! (userdata/<account>/760/remote/<appid>/screenshots). Served to the window
//! through the "shot" protocol, which only hands out pictures from there.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Shot {
    pub full: String,
    pub thumb: Option<String>,
    /// when it was taken (file time), seconds
    pub at: i64,
}

const MAX: usize = 300;

fn is_picture(p: &Path) -> bool {
    matches!(p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref(), Some("jpg" | "jpeg" | "png"))
}

/// folders that may hold this game's screenshots (one per Steam account on this PC)
pub fn folders(root: &Path, appid: u32) -> Vec<PathBuf> {
    let Ok(users) = std::fs::read_dir(root.join("userdata")) else { return vec![] };
    users
        .flatten()
        .map(|u| u.path().join("760").join("remote").join(appid.to_string()).join("screenshots"))
        .filter(|p| p.is_dir())
        .collect()
}

pub fn list(root: &Path, appid: u32) -> Vec<Shot> {
    let mut out = vec![];
    for dir in folders(root, appid) {
        let Ok(files) = std::fs::read_dir(&dir) else { continue };
        for f in files.flatten() {
            let p = f.path();
            if !p.is_file() || !is_picture(&p) {
                continue;
            }
            let at = f.metadata().ok().and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs() as i64).unwrap_or(0);
            let thumb = dir.join("thumbnails").join(p.file_name().unwrap_or_default());
            out.push(Shot {
                full: p.to_string_lossy().into_owned(),
                thumb: thumb.is_file().then(|| thumb.to_string_lossy().into_owned()),
                at,
            });
        }
    }
    out.sort_by_key(|s| std::cmp::Reverse(s.at));
    out.truncate(MAX);
    out
}

/// may the window see this file? Only Steam screenshots of this PC.
pub fn allowed(root: &Path, path: &Path) -> bool {
    let (Ok(p), Ok(base)) = (path.canonicalize(), root.join("userdata").canonicalize()) else { return false };
    if !p.starts_with(&base) || !is_picture(&p) {
        return false;
    }
    let s = p.to_string_lossy().to_lowercase().replace('/', "\\");
    s.contains("\\760\\remote\\") && s.contains("\\screenshots\\")
}

fn decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

// ---------------------------------------------------------------- uploaded to the Steam profile

/// screenshots the user uploaded to their Steam profile for one game (public profile page, no key)
pub async fn profile(st: &crate::AppState, appid: u32) -> Result<Vec<serde_json::Value>, String> {
    let key = format!("profileshots:{appid}");
    if let Some(serde_json::Value::Array(v)) = crate::db::cache_get(&st.db.lock().unwrap(), &key, 3 * 3600) {
        return Ok(v);
    }
    let me: String = st
        .db
        .lock()
        .unwrap()
        .query_row("SELECT external_id FROM accounts WHERE platform = 'steam'", [], |r| r.get(0))
        .map_err(|_| crate::l("Steam bağlı değil.", "Steam is not connected.").to_string())?;
    let mut out = vec![];
    for page in 1..=4 {
        let html = st
            .http
            .get(format!("https://steamcommunity.com/profiles/{me}/screenshots/"))
            .query(&[("appid", appid.to_string()), ("sort", "newestfirst".into()), ("browsefilter", "myfiles".into()), ("view", "grid".into()), ("p", page.to_string())])
            .send()
            .await
            .map_err(|e| e.to_string())?
            .text()
            .await
            .map_err(|e| e.to_string())?;
        let got = parse_profile(&html, appid);
        let n = got.len();
        out.extend(got);
        if n < 50 {
            break;
        }
    }
    let _ = crate::db::cache_put(&st.db.lock().unwrap(), &key, &serde_json::Value::Array(out.clone()));
    Ok(out)
}

/// each tile: <a … data-appid="…" data-publishedfileid="…"> … background-image: url('…')
pub fn parse_profile(html: &str, appid: u32) -> Vec<serde_json::Value> {
    let want = format!("data-appid=\"{appid}\"");
    html.split("class=\"profile_media_item")
        .skip(1)
        .filter(|tile| tile.contains(&want))
        .filter_map(|tile| {
            let id = tile.split("data-publishedfileid=\"").nth(1)?.split('"').next()?.to_string();
            let url = tile.split("url('").nth(1)?.split('\'').next()?.to_string();
            if !url.starts_with("https://") {
                return None;
            }
            let base = url.split('?').next().unwrap_or(&url).to_string();
            Some(serde_json::json!({
                "full": base,
                "thumb": format!("{base}?imw=640&imh=360&ima=fit&impolicy=Letterbox"),
                "page": format!("https://steamcommunity.com/sharedfiles/filedetails/?id={id}"),
            }))
        })
        .collect()
}

/// the "shot" protocol: http://shot.localhost/<encoded path>
pub fn serve(uri_path: &str) -> tauri::http::Response<Vec<u8>> {
    let not_found = || tauri::http::Response::builder().status(404).body(Vec::new()).unwrap();
    let Some(root) = crate::steam::root() else { return not_found() };
    let path = PathBuf::from(decode(uri_path.trim_start_matches('/')));
    if !allowed(&root, &path) {
        return not_found();
    }
    let Ok(bytes) = std::fs::read(&path) else { return not_found() };
    let kind = if path.extension().is_some_and(|e| e.eq_ignore_ascii_case("png")) { "image/png" } else { "image/jpeg" };
    tauri::http::Response::builder()
        .header("Content-Type", kind)
        .header("Cache-Control", "max-age=86400")
        .body(bytes)
        .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "reads a saved copy of a real profile page (SHOTS_HTML)"]
    fn reads_a_real_profile_page() {
        let html = std::fs::read_to_string(std::env::var("SHOTS_HTML").unwrap()).unwrap();
        let v = parse_profile(&html, 2322010);
        println!("found {} · first {}", v.len(), v.first().map(|x| x["thumb"].to_string()).unwrap_or_default().chars().take(60).collect::<String>());
        assert!(!v.is_empty());
    }

    #[test]
    fn reads_profile_tiles() {
        let html = r#"<a href="x" class="profile_media_item modalContentLink   ugc" data-appid="489830" data-publishedfileid="77">
            <div style="background-image: url('https://images.steamusercontent.com/ugc/1/AB/');" class="imgWallItem  "></div></a>
            <a href="x" class="profile_media_item modalContentLink   ugc" data-appid="70" data-publishedfileid="78">
            <div style="background-image: url('https://images.steamusercontent.com/ugc/2/CD/');" class="imgWallItem  "></div></a>"#;
        let v = parse_profile(html, 489830);
        assert_eq!(v.len(), 1);
        assert_eq!(v[0]["full"], "https://images.steamusercontent.com/ugc/1/AB/");
        assert_eq!(v[0]["page"], "https://steamcommunity.com/sharedfiles/filedetails/?id=77");
    }

    #[test]
    fn only_steam_screenshots_are_served() {
        let base = std::env::temp_dir().join("tessera-shots-test");
        let _ = std::fs::remove_dir_all(&base);
        let shots = base.join("userdata").join("1").join("760").join("remote").join("70").join("screenshots");
        std::fs::create_dir_all(shots.join("thumbnails")).unwrap();
        std::fs::write(shots.join("a.jpg"), b"x").unwrap();
        std::fs::write(shots.join("thumbnails").join("a.jpg"), b"x").unwrap();
        std::fs::write(base.join("userdata").join("1").join("secret.jpg"), b"x").unwrap();
        std::fs::write(shots.join("notes.txt"), b"x").unwrap();

        assert!(allowed(&base, &shots.join("a.jpg")));
        assert!(!allowed(&base, &base.join("userdata").join("1").join("secret.jpg")));
        assert!(!allowed(&base, &shots.join("notes.txt")));
        assert!(!allowed(&base, &shots.join("..").join("..").join("..").join("..").join("secret.jpg")));
        let l = list(&base, 70);
        assert_eq!(l.len(), 1);
        assert!(l[0].thumb.is_some());
        assert_eq!(decode("C%3A%5CSteam%5Ca%20b.jpg"), "C:\\Steam\\a b.jpg");
        let _ = std::fs::remove_dir_all(&base);
    }
}
