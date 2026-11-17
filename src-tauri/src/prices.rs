//! Prices in every store (IsThereAnyDeal): which shop sells a game for how much,
//! the cheapest first, and the lowest price it has ever had.
//!
//! Finding the game needs no key (by Steam appid, otherwise by title); prices do:
//! the user's own free key from isthereanydeal.com/apps/my/, kept in the Windows
//! Credential Manager. A build can also carry one in TESSERA_ITAD_KEY.
//!
//! Clicking a store opens IsThereAnyDeal's own link to it, unchanged (their terms:
//! affiliate tags stay). Only Steam, which has no affiliate programme, opens in its app.

use crate::{db, AppState};
use serde_json::{json, Value};
use std::collections::HashMap;

const API: &str = "https://api.isthereanydeal.com";
const SECRET: &str = "itad-key";
const COUNTRY: &str = "TR";
const PRICES_FRESH: i64 = 6 * 3600;
const GID_FRESH: i64 = 30 * 24 * 3600;
const MISS_FRESH: i64 = 3 * 24 * 3600;

pub const STEAM: u32 = 61;

fn e<E: std::fmt::Display>(err: E) -> String {
    err.to_string()
}

pub fn key() -> Option<String> {
    crate::secret_get(SECRET)
        .or_else(|| option_env!("TESSERA_ITAD_KEY").map(str::to_string))
        .filter(|k| !k.trim().is_empty())
}

/// is there a key, and is it the user's own (it can be removed) or the build's
pub fn status() -> Value {
    json!({ "hasKey": key().is_some(), "own": crate::secret_get(SECRET).is_some() })
}

/// checks the key against the API before keeping it; None removes it
pub async fn set_key(st: &AppState, k: Option<String>) -> Result<(), String> {
    let Some(k) = k.map(|k| k.trim().to_string()).filter(|k| !k.is_empty()) else {
        return crate::secret_set(SECRET, None);
    };
    let r = st.http.get(format!("{API}/games/lookup/v1")).query(&[("key", k.as_str()), ("appid", "220")]).send().await.map_err(e)?;
    if r.status().as_u16() == 401 || r.status().as_u16() == 403 {
        return Err(crate::l("IsThereAnyDeal anahtarı geçersiz.", "The IsThereAnyDeal key is not valid.").into());
    }
    if !r.status().is_success() {
        return Err(crate::tr!("IsThereAnyDeal yanıt vermedi ({}).", "IsThereAnyDeal did not answer ({}).", r.status()));
    }
    crate::secret_set(SECRET, Some(&k))
}

// ---------------------------------------------------------------- finding the game

/// IsThereAnyDeal ids of Steam apps (no key needed); unknown apps are left out
pub async fn gids_by_appid(st: &AppState, appids: &[u32]) -> Result<HashMap<u32, String>, String> {
    let mut out = HashMap::new();
    let mut ask = vec![];
    {
        let c = st.db.lock().unwrap();
        for &a in appids {
            match db::cache_get(&c, &format!("itad:gid:app:{a}"), GID_FRESH) {
                Some(Value::String(g)) if !g.is_empty() => {
                    out.insert(a, g);
                }
                Some(Value::String(_)) if db::cache_get(&c, &format!("itad:gid:app:{a}"), MISS_FRESH).is_some() => {}
                _ => ask.push(a),
            }
        }
    }
    for chunk in ask.chunks(200) {
        let body: Vec<String> = chunk.iter().map(|a| format!("app/{a}")).collect();
        let v: Value = post(st, &format!("{API}/lookup/id/shop/{STEAM}/v1"), &[], &json!(body)).await?;
        let c = st.db.lock().unwrap();
        for &a in chunk {
            let g = v[format!("app/{a}")].as_str().unwrap_or_default().to_string();
            let _ = db::cache_put(&c, &format!("itad:gid:app:{a}"), &json!(g));
            if !g.is_empty() {
                out.insert(a, g);
            }
        }
    }
    Ok(out)
}

/// IsThereAnyDeal id by the game's name (no key needed)
pub async fn gid_by_title(st: &AppState, title: &str) -> Result<Option<String>, String> {
    let ck = format!("itad:gid:t:{}", title.to_lowercase());
    {
        let c = st.db.lock().unwrap();
        if let Some(Value::String(g)) = db::cache_get(&c, &ck, GID_FRESH) {
            if !g.is_empty() {
                return Ok(Some(g));
            }
            if db::cache_get(&c, &ck, MISS_FRESH).is_some() {
                return Ok(None);
            }
        }
    }
    let v: Value = post(st, &format!("{API}/lookup/id/title/v1"), &[], &json!([title])).await?;
    let g = v[title].as_str().unwrap_or_default().to_string();
    let _ = db::cache_put(&st.db.lock().unwrap(), &ck, &json!(g));
    Ok(Some(g).filter(|g| !g.is_empty()))
}

// ---------------------------------------------------------------- prices

/// prices of several games in Turkey's store regions, cheapest first; cached for a few hours
pub async fn for_gids(st: &AppState, gids: &[String]) -> Result<HashMap<String, Value>, String> {
    let mut out = HashMap::new();
    let mut ask = vec![];
    {
        let c = st.db.lock().unwrap();
        for g in gids {
            match db::cache_get(&c, &format!("prices:{g}"), PRICES_FRESH) {
                Some(v) => {
                    out.insert(g.clone(), v);
                }
                None => ask.push(g.clone()),
            }
        }
    }
    if ask.is_empty() {
        return Ok(out);
    }
    let k = key().ok_or(crate::l("IsThereAnyDeal anahtarı yok.", "No IsThereAnyDeal key."))?;
    let now = chrono_now();
    for chunk in ask.chunks(200) {
        let v: Value = post(st, &format!("{API}/games/prices/v3"), &[("key", k.as_str()), ("country", COUNTRY)], &json!(chunk)).await?;
        let c = st.db.lock().unwrap();
        let mut seen = vec![];
        for item in v.as_array().into_iter().flatten() {
            let Some(id) = item["id"].as_str() else { continue };
            let mut p = normalize(item);
            p["checkedAt"] = json!(now);
            let _ = db::cache_put(&c, &format!("prices:{id}"), &p);
            seen.push(id.to_string());
            out.insert(id.to_string(), p);
        }
        // games sold nowhere come back missing: remember that too
        for g in chunk.iter().filter(|g| !seen.contains(g)) {
            let p = json!({ "gid": g, "deals": [], "low": null, "checkedAt": now });
            let _ = db::cache_put(&c, &format!("prices:{g}"), &p);
            out.insert(g.clone(), p);
        }
    }
    Ok(out)
}

/// one game's entry from /games/prices/v3, in Tessera's shape
pub fn normalize(item: &Value) -> Value {
    let amount = |p: &Value| p["amount"].as_f64();
    let mut deals: Vec<Value> = item["deals"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|d| {
            Some(json!({
                "shop": d["shop"]["name"].as_str()?,
                "shopId": d["shop"]["id"].as_u64()?,
                "price": amount(&d["price"])?,
                "regular": amount(&d["regular"]).unwrap_or(amount(&d["price"])?),
                "cut": d["cut"].as_u64().unwrap_or(0),
                "currency": d["price"]["currency"].as_str().unwrap_or("USD"),
                "storeLow": amount(&d["storeLow"]),
                "voucher": d["voucher"].as_str(),
                "drm": d["drm"].as_array().map(|a| a.iter().filter_map(|x| x["name"].as_str()).collect::<Vec<_>>()).unwrap_or_default(),
                "url": d["url"].as_str()?,
            }))
        })
        .collect();
    deals.sort_by(|a, b| {
        let (x, y) = (a["price"].as_f64().unwrap_or(f64::MAX), b["price"].as_f64().unwrap_or(f64::MAX));
        x.partial_cmp(&y).unwrap_or(std::cmp::Ordering::Equal)
    });
    let low = &item["historyLow"]["all"];
    json!({
        "gid": item["id"],
        "deals": deals,
        "low": amount(low).map(|a| json!({ "price": a, "currency": low["currency"] })),
    })
}

fn chrono_now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

async fn post(st: &AppState, url: &str, q: &[(&str, &str)], body: &Value) -> Result<Value, String> {
    let r = st.http.post(url).query(q).json(body).send().await.map_err(e)?;
    match r.status().as_u16() {
        200..=299 => r.json().await.map_err(e),
        401 | 403 => Err(crate::l("IsThereAnyDeal anahtarı geçersiz.", "The IsThereAnyDeal key is not valid.").into()),
        429 => Err(crate::l("IsThereAnyDeal şu an çok istek aldı, biraz sonra dene.", "IsThereAnyDeal is busy right now; try again in a bit.").into()),
        s => Err(crate::tr!("IsThereAnyDeal yanıt vermedi ({s}).", "IsThereAnyDeal did not answer ({s}).")),
    }
}

async fn get(st: &AppState, path: &str, q: &[(&str, &str)]) -> Result<Value, String> {
    let k = key().ok_or(crate::l("IsThereAnyDeal anahtarı yok.", "No IsThereAnyDeal key."))?;
    let r = st.http.get(format!("{API}{path}")).query(&[("key", k.as_str())]).query(q).send().await.map_err(e)?;
    match r.status().as_u16() {
        200..=299 => r.json().await.map_err(e),
        404 => Ok(Value::Null),
        401 | 403 => Err(crate::l("IsThereAnyDeal anahtarı geçersiz.", "The IsThereAnyDeal key is not valid.").into()),
        429 => Err(crate::l("IsThereAnyDeal şu an çok istek aldı, biraz sonra dene.", "IsThereAnyDeal is busy right now; try again in a bit.").into()),
        s => Err(crate::tr!("IsThereAnyDeal yanıt vermedi ({s}).", "IsThereAnyDeal did not answer ({s}).")),
    }
}

// ---------------------------------------------------------------- any game, owned or not

const SEARCH_FRESH: i64 = 24 * 3600;
const INFO_FRESH: i64 = 7 * 24 * 3600;

fn art(a: &Value) -> Value {
    json!({
        "banner": a["banner600"].as_str().or(a["banner400"].as_str()).or(a["banner300"].as_str()),
        "small": a["banner300"].as_str().or(a["banner145"].as_str()).or(a["banner400"].as_str()),
        "boxart": a["boxart"].as_str(),
    })
}

/// games by title, best match first: [{gid, title, type, mature, art}]
pub async fn search(st: &AppState, q: &str) -> Result<Value, String> {
    let q = q.trim();
    if q.chars().count() < 2 {
        return Ok(json!([]));
    }
    let ck = format!("itad:search:{}", q.to_lowercase());
    if let Some(v) = db::cache_get(&st.db.lock().unwrap(), &ck, SEARCH_FRESH) {
        return Ok(v);
    }
    let r = get(st, "/games/search/v1", &[("title", q), ("results", "30")]).await?;
    let out: Vec<Value> = r
        .as_array()
        .map(|a| a.iter().map(|g| json!({
            "gid": g["id"], "title": g["title"], "type": g["type"], "mature": g["mature"].as_bool().unwrap_or(false), "art": art(&g["assets"]),
        })).collect())
        .unwrap_or_default();
    let v = Value::Array(out);
    let _ = db::cache_put(&st.db.lock().unwrap(), &ck, &v);
    Ok(v)
}

/// what IsThereAnyDeal knows about a game: title, art, release, makers, tags, review scores
pub async fn info(st: &AppState, gid: &str) -> Result<Option<Value>, String> {
    let ck = format!("itad:info:{gid}");
    if let Some(v) = db::cache_get(&st.db.lock().unwrap(), &ck, INFO_FRESH) {
        return Ok(Some(v));
    }
    let g = get(st, "/games/info/v2", &[("id", gid)]).await?;
    if g.is_null() {
        return Ok(None);
    }
    let v = shape_info(gid, &g);
    let _ = db::cache_put(&st.db.lock().unwrap(), &ck, &v);
    Ok(Some(v))
}

fn shape_info(gid: &str, g: &Value) -> Value {
    let names = |v: &Value| -> Vec<Value> { v.as_array().map(|a| a.iter().filter_map(|c| c["name"].as_str().map(|n| json!(n))).collect()).unwrap_or_default() };
    json!({
        "gid": gid, "title": g["title"], "type": g["type"], "art": art(&g["assets"]), "appid": g["appid"],
        "earlyAccess": g["earlyAccess"].as_bool().unwrap_or(false), "tags": g["tags"], "releaseDate": g["releaseDate"],
        "developers": names(&g["developers"]), "publishers": names(&g["publishers"]),
        "reviews": g["reviews"].as_array().map(|a| a.iter().map(|r| json!({ "source": r["source"], "score": r["score"], "count": r["count"], "url": r["url"] })).collect::<Vec<_>>()).unwrap_or_default(),
    })
}

/// art for several games at once (from their info, fetched side by side when not cached)
pub async fn art_many(st: &AppState, gids: &[String]) -> Result<HashMap<String, Value>, String> {
    let mut out = HashMap::new();
    let mut missing = Vec::new();
    {
        let c = st.db.lock().unwrap();
        for g in gids {
            match db::cache_get(&c, &format!("itad:info:{g}"), INFO_FRESH) {
                Some(v) => { out.insert(g.clone(), v["art"].clone()); }
                None => missing.push(g.clone()),
            }
        }
    }
    let Some(k) = key() else { return Ok(out) };
    let tasks: Vec<_> = missing
        .into_iter()
        .take(40)
        .map(|g| {
            let http = st.http.clone();
            let k = k.clone();
            tauri::async_runtime::spawn(async move {
                let r = http.get(format!("{API}/games/info/v2")).query(&[("key", k.as_str()), ("id", g.as_str())]).send().await.ok()?;
                if !r.status().is_success() { return None; }
                let v: Value = r.json().await.ok()?;
                Some((g, v))
            })
        })
        .collect();
    for t in tasks {
        if let Ok(Some((g, raw))) = t.await {
            let v = shape_info(&g, &raw);
            let _ = db::cache_put(&st.db.lock().unwrap(), &format!("itad:info:{g}"), &v);
            out.insert(g, v["art"].clone());
        }
    }
    Ok(out)
}

const POPULAR_FRESH: i64 = 24 * 3600;

/// the most popular games on IsThereAnyDeal (waitlisted + collected), games only, nothing adult
pub async fn popular(st: &AppState) -> Result<Vec<Value>, String> {
    let ck = "itad:popular";
    if let Some(Value::Array(a)) = db::cache_get(&st.db.lock().unwrap(), ck, POPULAR_FRESH) {
        return Ok(a);
    }
    let r = get(st, "/stats/most-popular/v1", &[("limit", "250")]).await?;
    let out: Vec<Value> = r
        .as_array()
        .map(|a| a.iter()
            .filter(|g| g["type"].as_str() == Some("game") && !g["mature"].as_bool().unwrap_or(false))
            .map(|g| json!({ "gid": g["id"], "title": g["title"], "type": "game", "mature": false }))
            .collect())
        .unwrap_or_default();
    let _ = db::cache_put(&st.db.lock().unwrap(), ck, &Value::Array(out.clone()));
    Ok(out)
}

// ---------------------------------------------------------------- opening a store

/// is an app registered for this link scheme (steam://, com.epicgames.launcher://…)?
#[cfg(windows)]
fn handles(scheme: &str) -> bool {
    use winreg::{enums::HKEY_CLASSES_ROOT, RegKey};
    RegKey::predef(HKEY_CLASSES_ROOT)
        .open_subkey(scheme)
        .is_ok_and(|k| k.get_raw_value("URL Protocol").is_ok())
}
#[cfg(not(windows))]
fn handles(_: &str) -> bool {
    false
}

/// which store apps can open a game page on this PC
pub fn apps() -> Value {
    json!({
        STEAM.to_string(): handles("steam"),
    })
}

/// the shop's own ids for a game (Epic slug, Microsoft product id, "app/123" on Steam)
async fn shop_ids(st: &AppState, shop: u32, gid: &str) -> Vec<String> {
    let ck = format!("itad:shopids:{shop}:{gid}");
    if let Some(Value::Array(a)) = db::cache_get(&st.db.lock().unwrap(), &ck, GID_FRESH) {
        return a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect();
    }
    let ids: Vec<String> = post(st, &format!("{API}/lookup/shop/{shop}/id/v1"), &[], &json!([gid]))
        .await
        .ok()
        .and_then(|v| v[gid].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect()))
        .unwrap_or_default();
    let _ = db::cache_put(&st.db.lock().unwrap(), &ck, &json!(ids));
    ids
}

/// the app link for a store, when its app is installed and the game is known there
pub async fn app_link(st: &AppState, shop: u32, gid: &str, appid: Option<u32>) -> Option<String> {
    match shop {
        STEAM if handles("steam") => {
            let app = match appid {
                Some(a) => Some(a.to_string()),
                None => shop_ids(st, STEAM, gid).await.into_iter().find_map(|s| s.strip_prefix("app/").map(str::to_string)),
            }?;
            Some(format!("steam://store/{app}"))
        }
        _ => None,
    }
}

/// a store link must be an app scheme Tessera built itself or a plain https page
pub fn safe_to_open(link: &str) -> bool {
    let Ok(u) = url::Url::parse(link) else { return false };
    matches!(u.scheme(), "https" | "steam" | "com.epicgames.launcher" | "ms-windows-store")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_and_sorts_prices() {
        let item = json!({
            "id": "g1",
            "historyLow": { "all": { "amount": 0.99, "amountInt": 99, "currency": "USD" } },
            "deals": [
                { "shop": { "id": 61, "name": "Steam" }, "price": { "amount": 9.99, "currency": "USD" }, "regular": { "amount": 9.99, "currency": "USD" },
                  "cut": 0, "voucher": null, "storeLow": { "amount": 0.99, "currency": "USD" }, "drm": [{ "id": 61, "name": "Steam" }], "url": "https://itad.link/a/" },
                { "shop": { "id": 35, "name": "GOG" }, "price": { "amount": 4.49, "currency": "USD" }, "regular": { "amount": 8.99, "currency": "USD" },
                  "cut": 50, "voucher": null, "storeLow": null, "drm": [], "url": "https://itad.link/b/" }
            ]
        });
        let p = normalize(&item);
        assert_eq!(p["gid"], "g1");
        assert_eq!(p["deals"][0]["shop"], "GOG");
        assert_eq!(p["deals"][0]["cut"], 50);
        assert_eq!(p["deals"][0]["regular"], 8.99);
        assert_eq!(p["deals"][1]["drm"][0], "Steam");
        assert_eq!(p["low"]["price"], 0.99);
    }

    #[test]
    fn art_takes_the_largest_banner_and_falls_back() {
        let v = art(&json!({ "banner145": "xs", "banner300": "s", "banner600": "l", "boxart": "b" }));
        assert_eq!(v["banner"], "l");
        assert_eq!(v["small"], "s");
        assert_eq!(v["boxart"], "b");
        let v = art(&json!({ "banner145": "xs" }));
        assert!(v["banner"].is_null());
        assert_eq!(v["small"], "xs");
    }

    #[test]
    fn only_known_links_open() {
        assert!(safe_to_open("steam://store/12120"));
        assert!(safe_to_open("https://itad.link/x/"));
        assert!(!safe_to_open("file:///C:/Windows/system32/calc.exe"));
        assert!(!safe_to_open("http://example.com"));
    }
}
