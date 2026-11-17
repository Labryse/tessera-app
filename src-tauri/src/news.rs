//! Official news and patch notes from Steam (the game's own announcements,
//! not press articles). Public API, no key; cached for a few hours.

use crate::{db, AppState};
use serde_json::{json, Value};

const FRESH_FOR: i64 = 3 * 3600;
const CLAN_IMAGES: &str = "https://clan.akamai.steamstatic.com/images";

/// the Steam appid behind a library game, if it has one
pub fn appid_of(platform: &str, external_id: &str, meta: &Value) -> Option<u32> {
    if platform == "steam" {
        external_id.parse().ok()
    } else {
        meta["steamAppId"].as_u64().map(|n| n as u32)
    }
}

/// the latest announcements of one game, newest first
pub async fn for_app(st: &AppState, appid: u32) -> Result<Vec<Value>, String> {
    // v2: items carry the readable body too
    let key = format!("news2:{appid}");
    if let Some(Value::Array(v)) = db::cache_get(&st.db.lock().unwrap(), &key, FRESH_FOR) {
        return Ok(v);
    }
    let r = st
        .http
        .get("https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/")
        .query(&[("appid", appid.to_string().as_str()), ("count", "10"), ("maxlength", "0"), ("feeds", "steam_community_announcements")])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !r.status().is_success() {
        return Err(format!("Steam {}", r.status()));
    }
    let v: Value = r.json().await.map_err(|e| e.to_string())?;
    let items: Vec<Value> = v["appnews"]["newsitems"].as_array().map(|a| a.iter().map(item).collect()).unwrap_or_default();
    let _ = db::cache_put(&st.db.lock().unwrap(), &key, &Value::Array(items.clone()));
    Ok(items)
}

fn item(n: &Value) -> Value {
    let body = n["contents"].as_str().unwrap_or_default();
    let title = n["title"].as_str().unwrap_or_default();
    let tagged = n["tags"].as_array().is_some_and(|t| t.iter().any(|x| x.as_str() == Some("patchnotes")));
    json!({
        "id": n["gid"],
        "title": title,
        "url": n["url"],
        "date": n["date"],
        "image": first_image(body),
        "summary": summary(body, 320),
        "body": reading(body, 12000),
        "patch": tagged || looks_like_patch(title),
    })
}

fn looks_like_patch(title: &str) -> bool {
    let t = title.to_lowercase();
    ["patch", "hotfix", "güncelleme", "yama", "changelog", "release notes", "bug fix", "bugfix"].iter().any(|w| t.contains(w))
        || t.split(|c: char| !c.is_alphanumeric() && c != '.').any(|w| w.starts_with('v') && w[1..].starts_with(|c: char| c.is_ascii_digit()))
}

/// the first picture of the post: BBCode [img], an HTML <img>, or Steam's clan image token
pub fn first_image(body: &str) -> Option<String> {
    let lower = body.to_lowercase();
    let candidates = [
        lower.find("[img").and_then(|i| {
            let open = i + body[i..].find(']')? + 1;
            // newer posts: [img src="…"][/img]; older ones: [img]…[/img]
            let head = &body[i..open];
            if let Some(a) = head.find("src=\"") {
                let rest = &head[a + 5..];
                return Some(rest[..rest.find('"')?].to_string());
            }
            let close = open + lower[open..].find("[/img]")?;
            Some(body[open..close].trim().to_string())
        }),
        lower.find("<img").and_then(|i| {
            let s = i + lower[i..].find("src=\"")? + 5;
            let e = s + body[s..].find('"')?;
            Some(body[s..e].to_string())
        }),
    ];
    candidates
        .into_iter()
        .flatten()
        .map(|u| u.replace("{STEAM_CLAN_IMAGE}", CLAN_IMAGES))
        .find(|u| u.starts_with("https://"))
}

/// plain text, without markup, cut at a word
pub fn summary(body: &str, max: usize) -> String {
    cut(&plain(body, false), max)
}

/// the post to read in the app: paragraphs, list items on their own lines
pub fn reading(body: &str, max: usize) -> String {
    let text = plain(body, true);
    let paras: Vec<String> = text
        .split('\n')
        .map(|l| l.split_whitespace().filter(|w| *w != "\\").collect::<Vec<_>>().join(" "))
        .filter(|l| !l.is_empty() && l != "•")
        .collect();
    cut(&paras.join("\n\n"), max)
}

fn plain(body: &str, breaks: bool) -> String {
    let mut out = String::new();
    let mut chars = body.chars().peekable();
    let lower = body.to_lowercase();
    let mut pos = 0usize;
    while let Some(c) = chars.next() {
        let here = pos;
        pos += c.len_utf8();
        match c {
            // skip a whole [img]…[/img] or [previewyoutube]…[/previewyoutube]
            '[' if lower[here..].starts_with("[img") || lower[here..].starts_with("[previewyoutube") || lower[here..].starts_with("[video") => {
                let tag = if lower[here..].starts_with("[img") { "[/img]" } else if lower[here..].starts_with("[video") { "[/video]" } else { "[/previewyoutube]" };
                let end = lower[here..].find(tag).map(|e| here + e + tag.len()).or_else(|| lower[here..].find(']').map(|e| here + e + 1)).unwrap_or(body.len());
                while pos < end {
                    match chars.next() {
                        Some(x) => pos += x.len_utf8(),
                        None => break,
                    }
                }
                out.push(' ');
            }
            '[' | '<' => {
                let close = if c == '[' { ']' } else { '>' };
                let tag: String = lower[here + 1..].chars().take_while(|&x| x != close).collect();
                if tag.len() > 40 && !tag.starts_with("url=") && !tag.starts_with("a ") {
                    out.push(c);
                    continue;
                }
                for x in chars.by_ref() {
                    pos += x.len_utf8();
                    if x == close {
                        break;
                    }
                }
                // block-level tags read as a break
                let t = tag.trim_start_matches('/');
                if ["p", "h1", "h2", "h3", "list", "*", "br", "li", "hr", "olist", "ul", "ol", "div"].iter().any(|b| t == *b || t.starts_with(&format!("{b} "))) {
                    out.push(if breaks { '\n' } else { ' ' });
                    if breaks && (t == "*" || t == "li") && !tag.starts_with('/') {
                        out.push_str("• ");
                    }
                }
            }
            _ => out.push(c),
        }
    }
    let text = out
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
        .replace("{STEAM_CLAN_IMAGE}", "");
    if breaks {
        return text;
    }
    text.split_whitespace().filter(|w| *w != "\\").collect::<Vec<_>>().join(" ")
}

fn cut(text: &str, max: usize) -> String {
    let text = text.to_string();
    if text.chars().count() <= max {
        return text;
    }
    let cut: String = text.chars().take(max).collect();
    let cut = cut.rsplit_once(' ').map(|(a, _)| a).unwrap_or(&cut);
    format!("{}…", cut.trim_end_matches(|c: char| c == ',' || c == '.' || c == ':' || c == ';'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_paragraphs_for_reading() {
        let body = "[h2]Patch 1.2[/h2][list][*]Fixed saves[*]New map[/list][p]Thanks![/p]";
        assert_eq!(reading(body, 999), "Patch 1.2\n\n• Fixed saves\n\n• New map\n\nThanks!");
    }

    #[test]
    fn strips_steam_markup() {
        let body = "[img]{STEAM_CLAN_IMAGE}/123/abc.png[/img][h2]Patch 1.2[/h2][list][*]Fixed &amp; improved saves[*]New map[/list] [url=https://x.y]Read more[/url]";
        assert_eq!(first_image(body).as_deref(), Some("https://clan.akamai.steamstatic.com/images/123/abc.png"));
        assert_eq!(summary(body, 300), "Patch 1.2 Fixed & improved saves New map Read more");
    }

    #[test]
    fn cuts_long_text_at_a_word() {
        let s = summary("one two three four five", 12);
        assert_eq!(s, "one two…");
    }

    #[test]
    #[ignore = "calls Steam"]
    fn real_news() {
        let st = AppState {
            db: std::sync::Mutex::new(db::open(std::path::Path::new(":memory:")).unwrap()),
            http: reqwest::Client::builder().user_agent("Tessera/0.1 (game library)").build().unwrap(),
            tracker: crate::tracker::Tracker::new(true),
            dir: std::env::temp_dir(),
        };
        for appid in [1086940u32, 730, 1145350] {
            let v = tauri::async_runtime::block_on(for_app(&st, appid)).unwrap();
            println!("== {appid}: {} items", v.len());
            for n in v.iter().take(3) {
                println!("{} | patch={} | img={} | {}", n["title"], n["patch"], n["image"], n["summary"].as_str().unwrap_or("").chars().take(140).collect::<String>());
            }
        }
    }

    #[test]
    fn spots_patch_titles() {
        assert!(looks_like_patch("Hotfix 1.0.3"));
        assert!(looks_like_patch("v1.4 is live"));
        assert!(!looks_like_patch("Winter Sale starts now"));
        assert!(!looks_like_patch("Community Update #36"));
        assert_eq!(first_image("[img src=\"{STEAM_CLAN_IMAGE}/1/a.png\"][/img]").as_deref(), Some("https://clan.akamai.steamstatic.com/images/1/a.png"));
        assert_eq!(summary(r"See [url=https://store.steampowered.com/news/app/1145350/view/596285836987729005]the post[/url] \ now", 99), "See the post now");
    }
}
