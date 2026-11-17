//! Games the user follows from "Fiyat ara" without owning them. Every few hours their
//! prices are asked again (with the wishlist); a Windows notification comes when one
//! gets cheaper than when it was followed, or reaches the price the user set.

use crate::{db, prices, tr, AppState};
use serde_json::{json, Value};

const KEY: &str = "tracked";
const CHECKED: &str = "trackedCheckedAt";
pub const EVERY: i64 = 6 * 3600;

fn load(st: &AppState) -> Vec<Value> {
    db::setting(&st.db.lock().unwrap(), KEY).and_then(|v| v.as_array().cloned()).unwrap_or_default()
}

fn store(st: &AppState, list: &[Value]) -> Result<(), String> {
    db::set_setting(&st.db.lock().unwrap(), KEY, &json!(list)).map_err(|e| e.to_string())
}

/// the cheapest deal, among those in the most common currency
pub fn best(p: &Value) -> Option<&Value> {
    let deals = p["deals"].as_array()?;
    let mut count: Vec<(&str, usize)> = vec![];
    for d in deals {
        let c = d["currency"].as_str().unwrap_or("USD");
        match count.iter_mut().find(|(k, _)| *k == c) {
            Some((_, n)) => *n += 1,
            None => count.push((c, 1)),
        }
    }
    let cur = count.iter().max_by_key(|(_, n)| *n)?.0;
    deals
        .iter()
        .filter(|d| d["currency"].as_str().unwrap_or("USD") == cur)
        .min_by(|a, b| a["price"].as_f64().unwrap_or(f64::MAX).total_cmp(&b["price"].as_f64().unwrap_or(f64::MAX)))
}

pub fn money(amount: f64, cur: &str) -> String {
    match cur {
        "USD" => format!("${amount:.2}"),
        "EUR" => format!("€{amount:.2}"),
        "GBP" => format!("£{amount:.2}"),
        "TRY" => format!("₺{amount:.2}"),
        c => format!("{amount:.2} {c}"),
    }
}

/// writes the latest price into a followed game
fn fill(item: &mut Value, p: &Value) {
    match best(p) {
        Some(d) => {
            item["price"] = d["price"].clone();
            item["regular"] = d["regular"].clone();
            item["cut"] = d["cut"].clone();
            item["currency"] = d["currency"].clone();
            item["shop"] = d["shop"].clone();
            item["shopId"] = d["shopId"].clone();
        }
        None => {
            item["price"] = Value::Null;
        }
    }
    item["low"] = p["low"].clone();
    item["checkedAt"] = p["checkedAt"].clone();
}

pub fn list(st: &AppState) -> Value {
    json!(load(st))
}

pub async fn add(st: &AppState, gid: String, title: String, art: Option<String>) -> Result<Value, String> {
    let mut list = load(st);
    if !list.iter().any(|x| x["gid"] == gid.as_str()) {
        let mut item = json!({ "gid": gid, "title": title, "art": art, "added": db::now(), "target": null, "notified": null });
        if let Ok(mut p) = prices::for_gids(st, std::slice::from_ref(&gid)).await {
            if let Some(p) = p.remove(&gid) {
                fill(&mut item, &p);
                item["base"] = item["price"].clone();
            }
        }
        list.insert(0, item);
        store(st, &list)?;
    }
    Ok(json!(list))
}

pub fn remove(st: &AppState, gid: &str) -> Result<Value, String> {
    let list: Vec<Value> = load(st).into_iter().filter(|x| x["gid"] != gid).collect();
    store(st, &list)?;
    Ok(json!(list))
}

pub fn set_target(st: &AppState, gid: &str, target: Option<f64>) -> Result<Value, String> {
    let mut list = load(st);
    for x in list.iter_mut().filter(|x| x["gid"] == gid) {
        x["target"] = json!(target.filter(|t| *t > 0.0));
        x["notified"] = Value::Null;
    }
    store(st, &list)?;
    Ok(json!(list))
}

/// should this price be told? Under the set price, or (without one) under the price
/// when followed; never the same price twice
pub fn worth_telling(item: &Value) -> bool {
    let Some(price) = item["price"].as_f64() else { return false };
    let told = item["notified"].as_f64();
    if told.is_some_and(|t| price >= t - 0.001) {
        return false;
    }
    match item["target"].as_f64() {
        Some(t) => price <= t + 0.001,
        None => item["base"].as_f64().is_some_and(|b| price < b - 0.001),
    }
}

/// asks the prices of every followed game again; returns the ones that got cheaper
pub async fn check(st: &AppState) -> Result<Vec<Value>, String> {
    let mut list = load(st);
    if list.is_empty() {
        return Ok(vec![]);
    }
    let gids: Vec<String> = list.iter().filter_map(|x| x["gid"].as_str().map(str::to_string)).collect();
    let got = prices::for_gids(st, &gids).await?;
    let mut cheaper = vec![];
    for item in list.iter_mut() {
        let Some(p) = item["gid"].as_str().and_then(|g| got.get(g)) else { continue };
        fill(item, p);
        if item["base"].is_null() {
            item["base"] = item["price"].clone();
        }
        if worth_telling(item) {
            item["notified"] = item["price"].clone();
            cheaper.push(item.clone());
        }
    }
    store(st, &list)?;
    let _ = db::set_setting(&st.db.lock().unwrap(), CHECKED, &json!(db::now()));
    Ok(cheaper)
}

pub fn last_check(st: &AppState) -> i64 {
    db::setting(&st.db.lock().unwrap(), CHECKED).and_then(|v| v.as_i64()).unwrap_or(0)
}

/// the notification for games that got cheaper
pub fn message(cheaper: &[Value]) -> Option<(String, String)> {
    let line = |x: &Value| {
        let price = money(x["price"].as_f64().unwrap_or(0.0), x["currency"].as_str().unwrap_or("USD"));
        let shop = x["shop"].as_str().unwrap_or("");
        match x["cut"].as_u64().unwrap_or(0) {
            0 => format!("{} · {shop} {price}", x["title"].as_str().unwrap_or("")),
            c => format!("{} · {shop} {price} (−%{c})", x["title"].as_str().unwrap_or("")),
        }
    };
    match cheaper.len() {
        0 => None,
        1 => Some((tr!("Takip ettiğin oyun ucuzladı", "A game you follow got cheaper"), line(&cheaper[0]))),
        n => Some((
            tr!("Takip ettiğin {n} oyun ucuzladı", "{n} games you follow got cheaper"),
            cheaper.iter().take(3).map(line).collect::<Vec<_>>().join("\n"),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tells_a_drop_once_and_respects_the_set_price() {
        let mut x = json!({ "price": 20.0, "base": 30.0, "target": null, "notified": null });
        assert!(worth_telling(&x));
        x["notified"] = json!(20.0);
        assert!(!worth_telling(&x), "same price twice");
        x["price"] = json!(15.0);
        assert!(worth_telling(&x), "cheaper again");
        let y = json!({ "price": 20.0, "base": 30.0, "target": 18.0, "notified": null });
        assert!(!worth_telling(&y), "above the set price");
        let z = json!({ "price": 30.0, "base": 30.0, "target": null, "notified": null });
        assert!(!worth_telling(&z), "no drop");
    }

    #[test]
    fn best_deal_is_in_the_common_currency() {
        let p = json!({ "deals": [
            { "price": 5.0, "currency": "EUR" },
            { "price": 9.0, "currency": "USD" },
            { "price": 7.0, "currency": "USD" },
        ] });
        assert_eq!(best(&p).unwrap()["price"], 7.0);
    }
}
