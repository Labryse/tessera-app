//! Summary cards: the window draws them on a canvas, and a canvas only lets its
//! picture out when every image on it came from its own origin. So the covers it
//! draws are fetched here and handed over as data URLs, and the finished PNG is
//! written here to the place the user picked.

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use std::path::Path;
use std::time::Duration;

/// a cover or a banner, never more than this
const MAX_IMAGE: usize = 8 * 1024 * 1024;
/// a finished card is far smaller; anything bigger is not one of ours
const MAX_PNG: usize = 24 * 1024 * 1024;

fn e<E: std::fmt::Display>(x: E) -> String {
    x.to_string()
}

/// an https image as a data URL; anything that is not an image is refused
pub async fn image_data(http: &reqwest::Client, url: &str) -> Result<String, String> {
    let u = reqwest::Url::parse(url).map_err(e)?;
    if u.scheme() != "https" {
        return Err("only https images".into());
    }
    let r = http.get(u).timeout(Duration::from_secs(20)).send().await.map_err(e)?.error_for_status().map_err(e)?;
    let kind = r
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.split(';').next().unwrap_or("").trim().to_ascii_lowercase())
        .unwrap_or_default();
    if !kind.starts_with("image/") || kind.contains("svg") {
        return Err("not an image".into());
    }
    if r.content_length().is_some_and(|n| n as usize > MAX_IMAGE) {
        return Err("image too large".into());
    }
    let bytes = r.bytes().await.map_err(e)?;
    if bytes.len() > MAX_IMAGE {
        return Err("image too large".into());
    }
    Ok(format!("data:{};base64,{}", kind, STANDARD.encode(&bytes)))
}

/// writes a card the window drew; only a real PNG, only to a .png file
pub fn save_png(path: &Path, b64: &str) -> Result<(), String> {
    let ext = path.extension().and_then(|x| x.to_str()).unwrap_or("").to_ascii_lowercase();
    if ext != "png" {
        return Err(crate::l("Dosya .png ile bitmeli.", "The file name must end in .png.").into());
    }
    let raw = b64.strip_prefix("data:image/png;base64,").unwrap_or(b64);
    if raw.len() > MAX_PNG * 4 / 3 + 4 {
        return Err("image too large".into());
    }
    let bytes = STANDARD.decode(raw).map_err(e)?;
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("not a PNG".into());
    }
    std::fs::write(path, bytes).map_err(e)
}

#[cfg(test)]
mod tests {
    use super::*;

    const DOT: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    #[test]
    fn saves_only_png_files() {
        let dir = std::env::temp_dir().join(format!("tessera-share-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let ok = dir.join("card.png");
        save_png(&ok, &format!("data:image/png;base64,{DOT}")).unwrap();
        assert!(std::fs::read(&ok).unwrap().starts_with(b"\x89PNG"));
        assert!(save_png(&dir.join("card.exe"), DOT).is_err());
        assert!(save_png(&dir.join("card.png"), &STANDARD.encode(b"MZ not a picture")).is_err());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn refuses_what_is_not_an_https_image() {
        let http = reqwest::Client::new();
        for url in ["http://example.com/a.jpg", "file:///C:/Windows/win.ini", "not a url"] {
            assert!(tauri::async_runtime::block_on(image_data(&http, url)).is_err(), "{url}");
        }
    }
}
