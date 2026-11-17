//! Finding the right game for a name: Steam's store first, Wikipedia (+ Wikidata)
//! for everything Steam doesn't sell (old, delisted, other-store and unofficial
//! copies). All public endpoints, no keys.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    /// "steam" or "wiki"
    pub source: String,
    /// Steam appid, or the Wikipedia page title
    pub id: String,
    pub title: String,
    pub subtitle: Option<String>,
    pub image: Option<String>,
}

const WIKI: &str = "https://en.wikipedia.org/w/api.php";
const WIKI_TR: &str = "https://tr.wikipedia.org/w/api.php";
const WIKIDATA: &str = "https://www.wikidata.org/w/api.php";

pub fn norm(s: &str) -> String {
    let s = s.split(" (").next().unwrap_or(s);
    s.to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect()
}

/// file and shortcut names often carry noise: "NFS Most Wanted - Kısayol", "game_v1.2 repack"
pub fn clean_name(s: &str) -> String {
    let mut t = s.to_string();
    for junk in [" - Kısayol", " - Shortcut", " - Copy", ".exe", ".lnk"] {
        t = t.replace(junk, "");
    }
    t.replace(['_', '.'], " ").split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Wikipedia and Wikidata turn away clients that ask too fast (HTTP 429 with
/// a Retry-After). Their requests go one at a time, a little apart, and a
/// refusal is waited out instead of being taken as "no such game".
static WIKI_GATE: tokio::sync::Mutex<Option<std::time::Instant>> = tokio::sync::Mutex::const_new(None);
const WIKI_GAP: std::time::Duration = std::time::Duration::from_millis(1000);

async fn get(http: &reqwest::Client, url: &str, q: &[(&str, &str)]) -> Option<Value> {
    if !url.contains("wikipedia.org") && !url.contains("wikidata.org") {
        return http.get(url).query(q).send().await.ok()?.json().await.ok();
    }
    let mut last = WIKI_GATE.lock().await;
    for attempt in 0..3 {
        if let Some(t) = *last {
            let since = t.elapsed();
            if since < WIKI_GAP {
                tokio::time::sleep(WIKI_GAP - since).await;
            }
        }
        let r = http.get(url).query(q).send().await;
        *last = Some(std::time::Instant::now());
        let r = r.ok()?;
        if r.status() == reqwest::StatusCode::TOO_MANY_REQUESTS && attempt < 2 {
            let wait = r
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse::<u64>().ok())
                .unwrap_or(5)
                .clamp(1, 30);
            tokio::time::sleep(std::time::Duration::from_secs(wait)).await;
            continue;
        }
        if !r.status().is_success() {
            return None;
        }
        return r.json().await.ok();
    }
    None
}

pub async fn candidates(http: &reqwest::Client, q: &str) -> Vec<Candidate> {
    candidates_full(http, q).await.0
}

/// candidates, and whether both sources actually answered (false on rate limits
/// or network trouble, so a miss is not remembered as "no such game")
pub async fn candidates_full(http: &reqwest::Client, q: &str) -> (Vec<Candidate>, bool) {
    // search engines trip over punctuation ("osu!", "S.T.A.L.K.E.R."): search with words only
    let q: String = clean_name(q).chars().map(|c| if c.is_alphanumeric() || c == ' ' || c == ':' { c } else { ' ' }).collect();
    let q = q.split_whitespace().collect::<Vec<_>>().join(" ");
    if q.trim().is_empty() {
        return (vec![], true);
    }
    let mut out = Vec::new();
    let mut complete = true;
    let steam = get(http, "https://store.steampowered.com/api/storesearch/", &[("term", &q), ("l", crate::steam_lang()), ("cc", "TR")]).await;
    complete &= steam.is_some();
    if let Some(v) = steam {
        for it in v["items"].as_array().cloned().unwrap_or_default().iter().take(5) {
            if let Some(id) = it["id"].as_u64() {
                out.push(Candidate {
                    source: "steam".into(),
                    id: id.to_string(),
                    title: it["name"].as_str().unwrap_or_default().to_string(),
                    subtitle: Some("Steam".into()),
                    image: Some(format!("https://shared.steamstatic.com/store_item_assets/steam/apps/{id}/library_600x900.jpg")),
                });
            }
        }
    }
    let search = format!("{q} hastemplate:\"Infobox video game\"");
    let wiki = get(http, WIKI, &[
        ("action", "query"), ("format", "json"), ("generator", "search"), ("gsrsearch", &search), ("gsrlimit", "6"),
        ("prop", "pageimages|description"), ("piprop", "thumbnail"), ("pithumbsize", "300"), ("pilicense", "any"),
    ]).await;
    complete &= wiki.is_some();
    if let Some(v) = wiki {
        let mut pages: Vec<Value> = v["query"]["pages"].as_object().map(|m| m.values().cloned().collect()).unwrap_or_default();
        pages.sort_by_key(|p| p["index"].as_i64().unwrap_or(99));
        for p in pages {
            out.push(Candidate {
                source: "wiki".into(),
                id: p["title"].as_str().unwrap_or_default().to_string(),
                title: p["title"].as_str().unwrap_or_default().split(" (").next().unwrap_or_default().to_string(),
                subtitle: p["description"].as_str().map(|d| format!("Wikipedia · {d}")),
                image: p["thumbnail"]["source"].as_str().map(str::to_string),
            });
        }
    }
    (out, complete)
}

/// Some(answer) when the sources answered, None when they could not be asked
pub async fn auto_checked(http: &reqwest::Client, title: &str) -> Option<Option<Candidate>> {
    let want = norm(&clean_name(title));
    if want.len() < 3 {
        return Some(None);
    }
    let close = |name: &str| {
        let n = norm(name);
        n == want
            || (n.len() > 4 && want.len() > 4 && (n.starts_with(&want) || want.starts_with(&n))
                && n.len().min(want.len()) * 10 >= n.len().max(want.len()) * 8)
    };
    let (list, complete) = candidates_full(http, title).await;
    if let Some(c) = list.into_iter().find(|c| close(&c.title)) {
        return Some(Some(c));
    }
    // some games' pages don't use the game infobox ("osu!"): look the name up as a page title
    match exact_wiki(http, &clean_name(title)).await {
        Some(Some(c)) => Some(Some(c)),
        Some(None) if complete => Some(None),
        _ => None,
    }
}

/// the Wikipedia page with exactly this name, if it is about a game
async fn exact_wiki(http: &reqwest::Client, name: &str) -> Option<Option<Candidate>> {
    let v = get(http, WIKI, &[
        ("action", "query"), ("format", "json"), ("redirects", "1"), ("titles", name),
        ("prop", "pageimages|description"), ("piprop", "thumbnail"), ("pithumbsize", "300"), ("pilicense", "any"),
    ])
    .await?;
    let page = v["query"]["pages"].as_object()?.values().next()?.clone();
    let desc = page["description"].as_str().unwrap_or("").to_lowercase();
    if page.get("missing").is_some() || !desc.contains("game") || desc.contains("company") || desc.contains("developer") {
        return Some(None);
    }
    let title = page["title"].as_str()?.to_string();
    Some(Some(Candidate {
        source: "wiki".into(),
        id: title.clone(),
        title: title.split(" (").next().unwrap_or(&title).to_string(),
        subtitle: page["description"].as_str().map(|d| format!("Wikipedia · {d}")),
        image: page["thumbnail"]["source"].as_str().map(str::to_string),
    }))
}

/// folder names that say nothing about which game lives in them
const GENERIC_DIRS: &[&str] = &[
    "programfiles", "programfilesx86", "games", "game", "steamlibrary", "appdata", "local", "roaming", "users", "desktop",
    "downloads", "documents", "bin", "bin64", "bin32", "binaries", "win64", "win32", "x64", "x86", "current", "modlists",
    "mods", "launcher", "data", "content", "app", "release", "retail", "client", "programs", "common", "steamapps",
    "epicgames", "goggames", "xboxgames", "ubisoftgames", "eagames", "masaustu", "masaüstü", "oyunlar", "oyun",
];
/// words that are in many games' names and point at none
const COMMON_WORDS: &[&str] = &[
    "game", "games", "edition", "launcher", "online", "remastered", "definitive", "deluxe", "ultimate", "complete",
    "collection", "client", "studio", "version", "special", "anniversary", "director", "directors", "remake", "world",
    "simulator", "story", "legends", "legend", "the", "and", "of", "modded", "modpack", "pack", "repack",
];

/// what to search for a game known only by a name and where its exe is:
/// the name itself, then the folders it sits in ("D:\Living Skyrim 4\Modlists\x.exe" → "Living Skyrim 4")
pub fn query_names(title: &str, exe: Option<&str>) -> Vec<String> {
    let mut out = vec![clean_name(title)];
    let bare: String = {
        let mut depth = 0;
        title.chars().filter(|&c| { if c == '(' || c == '[' { depth += 1; } let keep = depth == 0; if c == ')' || c == ']' { depth -= 1; } keep }).collect()
    };
    out.push(clean_name(&bare));
    if let Some(p) = exe {
        let parts: Vec<&str> = p.split(['\\', '/']).collect();
        let mut after_users = false;
        for (i, part) in parts.iter().enumerate().rev().skip(1).take(4) {
            let n = norm(part);
            if i == 0 || part.ends_with(':') || n.len() < 2 || GENERIC_DIRS.contains(&n.as_str()) {
                continue;
            }
            if i > 0 && parts[i - 1].eq_ignore_ascii_case("users") {
                after_users = true;
                continue;
            }
            out.push(clean_name(part));
        }
        let _ = after_users;
    }
    let mut seen = std::collections::HashSet::new();
    out.retain(|n| !n.is_empty() && seen.insert(norm(n)));
    out
}

fn words(s: &str) -> Vec<String> {
    s.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(str::to_string)
        .collect()
}

/// one name inside another's words: "The Elder Scrolls V: Skyrim" in "...: Skyrim Special Edition"
fn agree(a: &str, b: &str) -> bool {
    let (wa, wb) = (words(a), words(b));
    let (short, long) = if wa.len() <= wb.len() { (wa, wb) } else { (wb, wa) };
    !short.is_empty() && short.iter().all(|w| long.contains(w))
}

/// the best match over several names. First an exact-ish match of any name;
/// failing that, a single telling word ("Skyrim") whose top Steam and Wikipedia
/// answers agree on the same game. Some(None) when nothing fits, None when the
/// sources could not be asked.
pub async fn auto_smart(http: &reqwest::Client, names: &[String], loose: bool) -> Option<Option<Candidate>> {
    let mut complete = true;
    for n in names {
        match auto_checked(http, n).await {
            Some(Some(c)) => return Some(Some(c)),
            Some(None) => {}
            None => complete = false,
        }
    }
    if !loose {
        return if complete { Some(None) } else { None };
    }
    let mut tried = std::collections::HashSet::new();
    let mut asked = 0;
    for n in names {
        for w in words(n) {
            if asked >= 4 || w.len() < 4 || w.chars().all(|c| c.is_ascii_digit()) || COMMON_WORDS.contains(&w.as_str()) || !tried.insert(w.clone()) {
                continue;
            }
            asked += 1;
            // a word counts only when Wikipedia's page for that very word is a
            // game ("Skyrim" → The Elder Scrolls V: Skyrim); "Cloud" or "Image" are not
            let wiki = match exact_wiki(http, &w).await {
                Some(Some(c)) => c,
                Some(None) => continue,
                None => { complete = false; continue; }
            };
            // the same game on Steam has better pictures and a store page
            let (list, _) = candidates_full(http, &wiki.title).await;
            if let Some(steam) = list.iter().filter(|c| c.source == "steam").find(|c| agree(&c.title, &wiki.title)) {
                return Some(Some(steam.clone()));
            }
            return Some(Some(wiki));
        }
    }
    if complete { Some(None) } else { None }
}

pub async fn meta_for(http: &reqwest::Client, c: &Candidate) -> Option<Value> {
    match c.source.as_str() {
        "steam" => {
            let id: u32 = c.id.parse().ok()?;
            let mut m = crate::steam::store_items(http, &[id]).await.remove(&id)?;
            if m["missing"].as_bool() == Some(true) {
                return None;
            }
            m["steamAppId"] = json!(id);
            Some(m)
        }
        "wiki" => wiki_meta(http, &c.id).await,
        _ => None,
    }
}

fn paragraphs(text: &str) -> Vec<String> {
    text.split('\n').map(str::trim).filter(|p| p.len() > 1).map(str::to_string).collect()
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

async fn labels(http: &reqwest::Client, ids: &[String]) -> std::collections::HashMap<String, String> {
    let mut out = std::collections::HashMap::new();
    if ids.is_empty() {
        return out;
    }
    let joined = ids.join("|");
    if let Some(v) = get(http, WIKIDATA, &[("action", "wbgetentities"), ("format", "json"), ("ids", &joined), ("props", "labels"), ("languages", "tr|en")]).await {
        for id in ids {
            let l = &v["entities"][id]["labels"];
            if let Some(s) = l["tr"]["value"].as_str().or(l["en"]["value"].as_str()) {
                out.insert(id.clone(), s.to_string());
            }
        }
    }
    out
}

fn claim_ids(claims: &Value, prop: &str) -> Vec<String> {
    claims[prop]
        .as_array()
        .map(|a| a.iter().filter_map(|c| c["mainsnak"]["datavalue"]["value"]["id"].as_str().map(str::to_string)).collect())
        .unwrap_or_default()
}

/// cover, Turkish (or English) summary, developer, publisher, date and genres
pub async fn wiki_meta(http: &reqwest::Client, title: &str) -> Option<Value> {
    let v = get(http, WIKI, &[
        ("action", "query"), ("format", "json"), ("redirects", "1"), ("titles", title),
        ("prop", "pageimages|extracts|description|langlinks|pageprops"), ("piprop", "original"), ("pilicense", "any"),
        ("exintro", "1"), ("explaintext", "1"), ("lllang", crate::l("tr", "en")), ("ppprop", "wikibase_item"),
    ]).await?;
    let page = v["query"]["pages"].as_object()?.values().next()?.clone();
    if page.get("missing").is_some() {
        return None;
    }
    let page_title = page["title"].as_str().unwrap_or(title).to_string();
    let mut text = page["extract"].as_str().unwrap_or_default().to_string();
    if let Some(tr) = page["langlinks"][0]["*"].as_str() {
        if let Some(t) = get(http, WIKI_TR, &[("action", "query"), ("format", "json"), ("redirects", "1"), ("titles", tr), ("prop", "extracts"), ("exintro", "1"), ("explaintext", "1")]).await {
            if let Some(ex) = t["query"]["pages"].as_object().and_then(|m| m.values().next()).and_then(|p| p["extract"].as_str()) {
                if ex.len() > 80 {
                    text = ex.to_string();
                }
            }
        }
    }
    let paras = paragraphs(&text);
    let short = paras.first().cloned().unwrap_or_default();
    let about: String = paras.iter().skip(1).map(|p| format!("<p>{}</p>", esc(p))).collect();

    let (mut developers, mut publishers, mut genres, mut release) = (vec![], vec![], vec![], Value::Null);
    if let Some(q) = page["pageprops"]["wikibase_item"].as_str() {
        if let Some(d) = get(http, WIKIDATA, &[("action", "wbgetentities"), ("format", "json"), ("ids", q), ("props", "claims")]).await {
            let claims = &d["entities"][q]["claims"];
            let dev = claim_ids(claims, "P178");
            let publ = claim_ids(claims, "P123");
            let genre_ids = claim_ids(claims, "P136");
            let all: Vec<String> = dev.iter().chain(&publ).chain(genre_ids.iter().take(3)).cloned().collect();
            let names = labels(http, &all).await;
            developers = dev.iter().filter_map(|i| names.get(i).cloned()).collect();
            publishers = publ.iter().filter_map(|i| names.get(i).cloned()).collect();
            genres = genre_ids.iter().take(3).filter_map(|i| names.get(i).cloned()).collect();
            // earliest publication date, "+2005-11-15T00:00:00Z"
            let dates: Vec<String> = claims["P577"].as_array().map(|a| a.iter().filter_map(|c| c["mainsnak"]["datavalue"]["value"]["time"].as_str().map(str::to_string)).collect()).unwrap_or_default();
            if let Some(t) = dates.iter().min() {
                let ymd: Vec<i64> = t.trim_start_matches('+').split(['-', 'T']).take(3).filter_map(|x| x.parse().ok()).collect();
                if ymd.len() == 3 {
                    release = json!(days_to_unix(ymd[0], ymd[1].max(1), ymd[2].max(1)));
                }
            }
        }
    }
    Some(json!({
        "name": page_title.split(" (").next().unwrap_or(&page_title),
        "type": 0,
        "short": short,
        "aboutHtml": about,
        "developers": developers,
        "publishers": publishers,
        "genres": genres,
        "release": release,
        "cover": page["original"]["source"],
        "hero": Value::Null,
        "header": Value::Null,
        "logo": Value::Null,
        "screenshots": [],
        "wikiTitle": page_title,
        "source": "wikipedia",
    }))
}

/// civil date → unix seconds (UTC midnight)
fn days_to_unix(y: i64, m: i64, d: i64) -> i64 {
    let (y, m) = if m <= 2 { (y - 1, m + 12) } else { (y, m) };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (m - 3) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    (era * 146097 + doe - 719468) * 86400
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dates() {
        assert_eq!(days_to_unix(1970, 1, 1), 0);
        assert_eq!(days_to_unix(2005, 11, 15), 1132012800);
    }

    #[test]
    #[ignore = "calls Steam and Wikipedia"]
    fn nfs_most_wanted() {
        let http = reqwest::Client::builder().user_agent("Tessera/0.1 (game library)").build().unwrap();
        let rt = tauri::async_runtime::block_on(async {
            let c = candidates(&http, "Need for Speed Most Wanted 2005").await;
            for x in &c { println!("{} | {} | {:?}", x.source, x.title, x.subtitle); }
            let wiki = c.iter().find(|x| x.source == "wiki").cloned().unwrap();
            let m = wiki_meta(&http, &wiki.id).await.unwrap();
            println!("page={} wd={}", wiki.id, m["wikiTitle"]);
            println!("dev={} pub={} genres={} release={} cover={}", m["developers"], m["publishers"], m["genres"], m["release"], m["cover"].is_string());
            println!("short: {}", m["short"].as_str().unwrap_or("").chars().take(160).collect::<String>());
            for (t, p) in [
                ("osu!", r"C:\Users\Oyuncu\AppData\Local\osu!\osu!.exe"),
                ("osu!(lazer)", r"C:\Users\Oyuncu\AppData\Local\osulazer\current\osu!.exe"),
                ("LS4", r"D:\Living Skyrim 4\Modlists\ModOrganizer.exe"),
                ("Karos", r"C:\Users\Oyuncu\Desktop\Karos Genesis\KarosGenesisLauncher.exe"),
                ("DESTAN GAME", r"C:\Users\Oyuncu\AppData\Local\DESTAN GAME\destan-launcher.exe"),
                ("nfsmw", r"D:\Oyunlar\Need for Speed Most Wanted\speed.exe"),
                ("Moonlight", r"C:\Program Files\Moonlight Game Streaming\Moonlight.exe"),
            ] {
                let names = query_names(t, Some(p));
                let r = auto_smart(&http, &names, true).await;
                println!("{t:12} {names:?} -> {:?}", r.map(|c| c.map(|c| format!("{} {}", c.source, c.title))));
            }
        });
        let _ = rt;
    }
}
