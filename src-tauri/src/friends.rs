//! Steam friends and what they are playing, from the public friends page of the
//! linked account (no key). Friends who are in a game also get the line their
//! game shares ("Ranked · Dust II"), from their profile card.

use crate::{presence, AppState};
use serde_json::{json, Value};

/// the friends page, split into one entry per friend
pub fn parse(html: &str) -> Vec<Value> {
    html.split("friend_block_v2")
        .skip(1)
        .filter_map(|b| {
            let state = b.trim_start().strip_prefix("persona ")?.split(|c: char| c == ' ' || c == '"').next()?.to_string();
            let account = attr(b, "data-miniprofile")?.parse::<u64>().ok()?;
            let content = b.find("friend_block_content").map(|i| &b[i..])?;
            let open = content.find('>')? + 1;
            let name_end = content[open..].find("<br").map(|e| open + e).unwrap_or(open);
            let name = presence::clean(&content[open..name_end]);
            let game = presence::text_of(content, "friend_game_link").filter(|s| !s.is_empty());
            let small = presence::text_of(content, "friend_small_text").filter(|s| !s.is_empty());
            let avatar = b.find("<img src=\"").and_then(|i| {
                let s = i + 10;
                Some(b[s..s + b[s..].find('"')?].to_string())
            });
            Some(json!({
                "account": account,
                "name": name,
                "state": state,
                "game": game,
                // "Son çevrimiçi 3 gün önce" and the like, for friends not in a game
                "note": if game.is_some() { Value::Null } else { json!(small) },
                "avatar": avatar.map(|a| a.replace("_medium.", "_full.")),
            }))
        })
        .collect()
}

fn attr(s: &str, name: &str) -> Option<String> {
    let k = format!("{name}=\"");
    let i = s.find(&k)? + k.len();
    Some(s[i..i + s[i..].find('"')?].to_string())
}

/// the appid on a profile card (the game's artwork link), when one is shown
pub fn card_appid(html: &str) -> Option<u64> {
    let at = html.find("miniprofile_game")?;
    let rest = &html[at..];
    let i = rest.find("/apps/")? + 6;
    rest[i..].chars().take_while(|c| c.is_ascii_digit()).collect::<String>().parse().ok()
}

pub async fn list(st: &AppState) -> Result<Value, String> {
    let me: String = st
        .db
        .lock()
        .unwrap()
        .query_row("SELECT external_id FROM accounts WHERE platform = 'steam'", [], |r| r.get(0))
        .map_err(|_| crate::l("Steam bağlı değil.", "Steam is not connected.").to_string())?;
    let html = st
        .http
        .get(format!("https://steamcommunity.com/profiles/{me}/friends/"))
        .query(&[("l", crate::steam_lang())])
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    let mut friends = parse(&html);
    if friends.is_empty() {
        let private = html.contains("profile_private_info") || !html.contains("friends_list");
        return Err(if private {
            crate::l("Arkadaş listesi görünmüyor. Steam profil gizliliğinde “Arkadaş listesi”ni herkese açık yap.", "The friends list is not visible. Make “Friends list” public in your Steam privacy settings.").into()
        } else {
            crate::l("Steam’de arkadaş yok.", "No friends on Steam.").into()
        });
    }

    // what in-game friends' games say, a few at a time
    let mut jobs = vec![];
    for (i, f) in friends.iter().enumerate() {
        if f["state"] != "in-game" || jobs.len() >= 24 {
            continue;
        }
        let http = st.http.clone();
        let account = f["account"].as_u64().unwrap_or(0);
        jobs.push((i, tauri::async_runtime::spawn(async move {
            let html = http
                .get(format!("https://steamcommunity.com/miniprofile/{account}"))
                .query(&[("l", crate::steam_lang())])
                .send()
                .await
                .ok()?
                .text()
                .await
                .ok()?;
            let at = html.find("miniprofile_game")?;
            Some((card_appid(&html), presence::text_of(&html[at..], "rich_presence").filter(|s| !s.is_empty())))
        })));
    }
    for (i, job) in jobs {
        if let Ok(Some((appid, line))) = job.await {
            friends[i]["appid"] = json!(appid);
            friends[i]["presence"] = json!(line);
        }
    }
    // a profile card that did not answer this time keeps the game's art: the
    // game's Steam id is remembered by its name
    {
        let c = st.db.lock().unwrap();
        for f in friends.iter_mut().filter(|f| f["state"] == "in-game") {
            let Some(name) = f["game"].as_str().map(|n| n.to_lowercase()) else { continue };
            let key = format!("steam:app-by-name:{name}");
            match f["appid"].as_u64() {
                Some(a) => { let _ = crate::db::cache_put(&c, &key, &json!(a)); }
                None => {
                    if let Some(a) = crate::db::cache_get(&c, &key, 90 * 24 * 3600).and_then(|v| v.as_u64()) {
                        f["appid"] = json!(a);
                    }
                }
            }
        }
    }
    Ok(json!({ "friends": friends, "checkedAt": crate::db::now() }))
}

// ---------------------------------------------------------------- Xbox (OpenXBL)

const XBL_KEY: &str = "openxbl-key";
pub fn xbox_has_key() -> bool {
    crate::secret_get(XBL_KEY).is_some()
}

/// titles that mean "on the console" rather than a game
const NOT_GAMES: &[&str] = &["Home", "Xbox App", "Online", "Xbox", "Xbox Game Bar", "Microsoft Store", "Settings"];

/// one Xbox friend, in the same shape as a Steam one (plus gamertag and gamerscore)
pub fn xbox_person(p: &Value) -> Value {
    let game = p["titlePresences"].as_array().and_then(|t| {
        t.iter().find(|x| x["state"].as_str() == Some("Active") && x["titleName"].as_str().is_some_and(|n| !NOT_GAMES.contains(&n)))
    });
    let presence = p["presenceState"].as_str().unwrap_or("Offline");
    let state = if presence == "Offline" { "offline" } else if game.is_some() { "in-game" } else { "online" };
    let text = p["presenceText"].as_str().filter(|t| !t.is_empty());
    let name = p["displayName"].as_str().or(p["modernGamertag"].as_str()).or(p["gamertag"].as_str()).unwrap_or("?");
    json!({
        "account": p["xuid"],
        "name": name,
        "gamertag": p["modernGamertag"].as_str().or(p["gamertag"].as_str()),
        "state": state,
        "game": game.and_then(|g| g["titleName"].as_str()),
        "titleId": game.and_then(|g| g["titleId"].as_str()),
        "appid": null,
        "presence": if state == "in-game" { text.filter(|t| !game.and_then(|g| g["titleName"].as_str()).is_some_and(|n| t.ends_with(n))) } else { None },
        "note": if state == "in-game" { None } else { text },
        "avatar": p["displayPicRaw"].as_str(),
        "gamerscore": p["gamerScore"].as_str().and_then(|g| g.parse::<u64>().ok()),
    })
}

async fn xbox_fetch(st: &AppState, key: &str) -> Result<Value, String> {
    let r = st.http.get("https://xbl.io/api/v2/friends").header("X-Authorization", key).header("Accept", "application/json").send().await.map_err(|e| e.to_string())?;
    match r.status().as_u16() {
        200..=299 => r.json().await.map_err(|e| e.to_string()),
        401 | 403 => Err(crate::l("OpenXBL anahtarı geçersiz.", "The OpenXBL key is not valid.").into()),
        429 => Err(crate::l("OpenXBL şu an çok istek aldı, biraz sonra dene.", "OpenXBL is busy right now; try again in a bit.").into()),
        s => Err(crate::tr!("OpenXBL yanıt vermedi ({s}).", "OpenXBL did not answer ({s}).")),
    }
}

pub async fn xbox_list(st: &AppState) -> Result<Value, String> {
    let key = crate::secret_get(XBL_KEY).ok_or(crate::l("Xbox bağlı değil.", "Xbox is not connected."))?;
    let r = xbox_fetch(st, &key).await?;
    let friends: Vec<Value> = r["people"].as_array().map(|a| a.iter().map(xbox_person).collect()).unwrap_or_default();
    Ok(json!({ "friends": friends, "checkedAt": crate::db::now() }))
}

/// checks the key with one call before keeping it; None removes it
pub async fn xbox_set_key(st: &AppState, key: Option<String>) -> Result<(), String> {
    let Some(k) = key.map(|k| k.trim().to_string()).filter(|k| !k.is_empty()) else {
        return crate::secret_set(XBL_KEY, None);
    };
    xbox_fetch(st, &k).await?;
    crate::secret_set(XBL_KEY, Some(&k))
}

#[cfg(test)]
mod tests {
    use super::*;

    const PAGE: &str = r#"<div id="state_in-game" class="state_block">Oyunda</div>
        <div class="selectable friend_block_v2 persona in-game " id="fr_1" data-steamid="76561197960265729" data-miniprofile="1" data-search="ayşe ; dota 2 ; ">
          <div class="player_avatar friend_block_link_overlay in-game"><img src="https://avatars.example/abc_medium.jpg"></div>
          <div class="friend_block_content">Ayşe &amp; Co<br> <span class="friend_small_text"> <span class="friend_game_link">Dota 2</span> </span></div></div>
        <div class="selectable friend_block_v2 persona offline " id="fr_2" data-steamid="76561197960265730" data-miniprofile="2" data-search="mehmet ; ">
          <div class="player_avatar friend_block_link_overlay offline"><img src="https://avatars.example/def_medium.jpg"></div>
          <div class="friend_block_content">Mehmet<br> <span class="friend_small_text"> Son çevrimiçi 3 gün önce </span></div></div>"#;

    #[test]
    fn reads_the_friends_page() {
        let f = parse(PAGE);
        assert_eq!(f.len(), 2);
        assert_eq!(f[0]["name"], "Ayşe & Co");
        assert_eq!(f[0]["state"], "in-game");
        assert_eq!(f[0]["game"], "Dota 2");
        assert_eq!(f[0]["account"], 1);
        assert_eq!(f[0]["avatar"], "https://avatars.example/abc_full.jpg");
        assert_eq!(f[1]["state"], "offline");
        assert_eq!(f[1]["note"], "Son çevrimiçi 3 gün önce");
        assert!(f[1]["game"].is_null());
    }

    #[test]
    #[ignore = "calls Steam with the linked account"]
    fn real_friends() {
        let src = std::path::PathBuf::from(std::env::var("APPDATA").unwrap()).join("app.tessera.desktop").join("tessera.db");
        let path = std::env::temp_dir().join("tessera-friends-test.db");
        std::fs::copy(&src, &path).unwrap();
        let st = AppState {
            db: std::sync::Mutex::new(crate::db::open(&path).unwrap()),
            http: reqwest::Client::builder().user_agent("Tessera/0.1 (game library)").build().unwrap(),
            tracker: crate::tracker::Tracker::new(true),
            dir: std::env::temp_dir(),
        };
        let v = tauri::async_runtime::block_on(list(&st)).unwrap();
        let f = v["friends"].as_array().unwrap();
        let ingame: Vec<&Value> = f.iter().filter(|x| x["state"] == "in-game").collect();
        println!("friends {} in-game {}", f.len(), ingame.len());
        // names are left out on purpose; only what the parser found
        for x in &ingame {
            println!("game={} appid={} presence={} avatar={}", x["game"], x["appid"], x["presence"], x["avatar"].is_string());
        }
        // the markup of one in-game card, to check the presence parser against
        if let Some(x) = ingame.first() {
            let html = tauri::async_runtime::block_on(async {
                st.http.get(format!("https://steamcommunity.com/miniprofile/{}", x["account"])).send().await.unwrap().text().await.unwrap()
            });
            let at = html.find("miniprofile_game").unwrap_or(0);
            let mut shape = String::new();
            for part in html[at..].split("class=\"").skip(1).take(12) {
                shape.push_str(part.split('"').next().unwrap_or(""));
                shape.push_str(" | ");
            }
            println!("card classes: {shape}");
            let appid = card_appid(&html).map(|a| a.to_string()).unwrap_or_default();
            println!("steam_card_line -> {:?}", crate::presence::steam_card_line(&html, &appid));
        }
    }

    #[test]
    fn reads_an_xbox_friend() {
        let p = json!({
            "xuid": "2533", "gamertag": "Old", "modernGamertag": "Ayla", "displayName": "Ayla", "displayPicRaw": "https://pic",
            "gamerScore": "12450", "presenceState": "Online", "presenceText": "Forza Horizon 5",
            "titlePresences": [{ "titleId": "1", "titleName": "Home", "state": "Active" }, { "titleId": "2", "titleName": "Forza Horizon 5", "state": "Active" }]
        });
        let f = xbox_person(&p);
        assert_eq!(f["state"], "in-game");
        assert_eq!(f["game"], "Forza Horizon 5");
        assert!(f["presence"].is_null());
        assert_eq!(f["gamerscore"], 12450);
        let idle = xbox_person(&json!({ "xuid": "1", "gamertag": "B", "presenceState": "Online", "presenceText": "Online", "titlePresences": [{ "titleName": "Home", "state": "Active" }] }));
        assert_eq!(idle["state"], "online");
        let off = xbox_person(&json!({ "xuid": "2", "gamertag": "C", "presenceState": "Offline", "presenceText": "Son görülme 2 sa önce: Halo" }));
        assert_eq!(off["state"], "offline");
        assert_eq!(off["note"], "Son görülme 2 sa önce: Halo");
    }

    #[test]
    fn finds_the_game_on_a_card() {
        let card = r#"<div class="miniprofile_gamesection"><img class="game_logo" src="https://x/steam/apps/570/capsule.jpg"><span class="rich_presence">Dereceli</span></div>"#;
        assert_eq!(card_appid(card), Some(570));
    }
}
