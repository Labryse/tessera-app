//! The Steam wishlist with prices: what is on sale, what came out, and the
//! lowest price Tessera has seen. Public Steam APIs, no key; the wishlist must
//! be visible on the Steam profile.

use crate::{db, AppState};
use serde_json::{json, Value};
use std::collections::HashMap;

const KEY: &str = "wishlist";
const COUNTRY: &str = "TR";

fn steamid(st: &AppState) -> Option<String> {
    st.db.lock().unwrap().query_row("SELECT external_id FROM accounts WHERE platform = 'steam'", [], |r| r.get(0)).ok()
}

fn cents(v: &Value) -> Option<i64> {
    v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse().ok()))
}

/// the saved list (what the window shows without asking Steam)
pub fn saved(st: &AppState) -> Value {
    db::cache_get(&st.db.lock().unwrap(), KEY, i64::MAX / 4).unwrap_or(Value::Null)
}

/// asks Steam again; returns the list plus what changed since the last look
pub async fn refresh(st: &AppState) -> Result<Value, String> {
    let id = steamid(st).ok_or(crate::l("Steam bağlı değil.", "Steam is not connected."))?;
    let r = st
        .http
        .get("https://api.steampowered.com/IWishlistService/GetWishlist/v1/")
        .query(&[("steamid", id.as_str())])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !r.status().is_success() {
        return Err(crate::l("İstek listesi alınamadı.", "Could not get the wishlist.").into());
    }
    let v: Value = r.json().await.map_err(|e| e.to_string())?;
    let wished: Vec<(u32, i64, i64)> = v["response"]["items"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|x| Some((x["appid"].as_u64()? as u32, x["priority"].as_i64().unwrap_or(0), x["date_added"].as_i64().unwrap_or(0))))
                .collect()
        })
        .unwrap_or_default();
    if wished.is_empty() && v["response"].get("items").is_none() {
        return Err(crate::l("İstek listesi gizli görünüyor. Steam profil gizliliğinde “Oyun ayrıntıları”nı herkese açık yap.", "The wishlist seems private. Make “Game details” public in your Steam privacy settings.").into());
    }

    let before = saved(st);
    let old: HashMap<u64, &Value> = before["items"].as_array().map(|a| a.iter().filter_map(|x| Some((x["appid"].as_u64()?, x))).collect()).unwrap_or_default();

    let ids: Vec<u32> = wished.iter().map(|w| w.0).collect();
    let store = prices(&st.http, &ids).await;
    let mut items = vec![];
    let mut changes = vec![];
    for (appid, priority, added) in wished {
        let prev = old.get(&(appid as u64)).copied();
        // no store data this time (a hiccup, or not sold here): keep what was seen last
        let Some(s) = store.get(&appid) else {
            if let Some(p) = prev {
                let mut item = p.clone();
                item["priority"] = json!(priority);
                item["stale"] = json!(true);
                items.push(item);
            }
            continue;
        };
        let price = s["price"].as_i64();
        let prev_low = prev.and_then(|p| p["lowest"].as_i64());
        let (lowest, lowest_text) = match (price, prev_low) {
            (Some(p), Some(l)) if l <= p => (Some(l), prev.map(|x| x["lowestFormatted"].clone()).unwrap_or(Value::Null)),
            (Some(p), _) => (Some(p), s["formatted"].clone()),
            (None, l) => (l, prev.map(|x| x["lowestFormatted"].clone()).unwrap_or(Value::Null)),
        };
        let discount = s["discount"].as_i64().unwrap_or(0);
        let was_discount = prev.and_then(|p| p["discount"].as_i64()).unwrap_or(0);
        if prev.is_some() && discount > was_discount {
            changes.push(json!({ "appid": appid, "kind": "sale", "name": s["name"], "discount": discount, "price": s["formatted"] }));
        }
        if prev.is_some_and(|p| p["comingSoon"].as_bool() == Some(true)) && s["comingSoon"].as_bool() == Some(false) {
            changes.push(json!({ "appid": appid, "kind": "released", "name": s["name"] }));
        }
        let mut item = s.clone();
        item["appid"] = json!(appid);
        item["priority"] = json!(priority);
        item["added"] = json!(added);
        item["lowest"] = json!(lowest);
        item["lowestFormatted"] = lowest_text;
        items.push(item);
    }
    items.sort_by_key(|x| x["priority"].as_i64().unwrap_or(0));
    let out = json!({ "items": items, "checkedAt": db::now(), "country": COUNTRY });
    db::cache_put(&st.db.lock().unwrap(), KEY, &out).map_err(|e| e.to_string())?;
    let mut res = out;
    res["changes"] = Value::Array(changes);
    Ok(res)
}

/// name, art, release and the current price of each game
async fn prices(http: &reqwest::Client, ids: &[u32]) -> HashMap<u32, Value> {
    let mut out = HashMap::new();
    for chunk in ids.chunks(50) {
        let req = json!({
            "ids": chunk.iter().map(|id| json!({ "appid": id })).collect::<Vec<_>>(),
            "context": { "language": crate::steam_lang(), "country_code": COUNTRY },
            "data_request": { "include_assets": true, "include_basic_info": true, "include_release": true, "include_reviews": true }
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
            let Some(appid) = item["appid"].as_u64() else { continue };
            if item["success"].as_i64() != Some(1) {
                continue;
            }
            out.insert(appid as u32, entry(&item));
        }
    }
    out
}

fn entry(item: &Value) -> Value {
    let a = &item["assets"];
    let fmt = a["asset_url_format"].as_str().unwrap_or("");
    let asset = |f: Option<&str>| crate::steam::asset(fmt, f);
    let buy = &item["best_purchase_option"];
    let r = &item["release"];
    let free = item["is_free"].as_bool().unwrap_or(false);
    let ends = buy["active_discounts"].as_array().and_then(|d| d.iter().filter_map(|x| cents(&x["discount_end_date"])).min());
    json!({
        "name": item["name"],
        "cover": asset(a["library_capsule_2x"].as_str().or(a["library_capsule"].as_str())),
        "header": asset(a["header"].as_str()),
        "release": r["steam_release_date"],
        "comingSoon": r["is_coming_soon"].as_bool().unwrap_or(false),
        "comingSoonText": r["coming_soon_display"],
        "free": free,
        "price": cents(&buy["final_price_in_cents"]),
        "original": cents(&buy["original_price_in_cents"]),
        "formatted": buy["formatted_final_price"],
        "formattedOriginal": buy["formatted_original_price"],
        "discount": buy["discount_pct"].as_i64().unwrap_or(0),
        "discountEnds": ends,
        "userScore": item["reviews"]["summary_filtered"]["percent_positive"],
        "reviewCount": item["reviews"]["summary_filtered"]["review_count"],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_discounted_item() {
        let item = json!({
            "name": "Oyun", "is_free": false,
            "assets": { "asset_url_format": "steam/apps/1/${FILENAME}", "header": "header.jpg" },
            "release": { "steam_release_date": 1700000000 },
            "best_purchase_option": {
                "final_price_in_cents": "1499", "original_price_in_cents": "2999", "discount_pct": 50,
                "formatted_final_price": "$14.99", "formatted_original_price": "$29.99",
                "active_discounts": [{ "discount_end_date": 1800000000 }]
            }
        });
        let e = entry(&item);
        assert_eq!(e["price"], 1499);
        assert_eq!(e["original"], 2999);
        assert_eq!(e["discount"], 50);
        assert_eq!(e["discountEnds"], 1800000000);
        assert!(e["header"].as_str().unwrap().ends_with("steam/apps/1/header.jpg"));
    }

    #[test]
    #[ignore = "calls Steam with the linked account"]
    fn real_wishlist() {
        let src = std::path::PathBuf::from(std::env::var("APPDATA").unwrap()).join("app.tessera.desktop").join("tessera.db");
        let path = std::env::temp_dir().join("tessera-wish-test.db");
        std::fs::copy(&src, &path).unwrap();
        let st = AppState {
            db: std::sync::Mutex::new(db::open(&path).unwrap()),
            http: reqwest::Client::builder().user_agent("Tessera/0.1 (game library)").build().unwrap(),
            tracker: crate::tracker::Tracker::new(true),
            dir: std::env::temp_dir(),
        };
        let v = tauri::async_runtime::block_on(refresh(&st)).unwrap();
        for i in v["items"].as_array().unwrap().iter().take(8) {
            println!("{} | {} | -{}% | was {} | soon {} | cover {}", i["name"], i["formatted"], i["discount"], i["formattedOriginal"], i["comingSoon"], i["cover"].is_string());
        }
        println!("items {}", v["items"].as_array().unwrap().len());
    }
}
