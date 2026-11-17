//! What a running game says about itself ("Ranked · Dust II", "Link is in Hyrule
//! Field"). Only asked while a game runs; nothing is sent anywhere else.
//! - Steam: the line Steam shows on the profile card of the signed-in account.
//!   Needs "game details" on the Steam profile to be visible and Steam not set
//!   to invisible.
//! - RetroAchievements: the rich presence of the connected user, when the
//!   emulator is signed in to RetroAchievements.

use crate::AppState;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

const TICK: Duration = Duration::from_secs(15);
/// RetroAchievements is asked every this many ticks
const RA_EVERY: u32 = 4;
const STEAM_ID_BASE: u64 = 76561197960265728;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresenceEvent {
    pub game_id: String,
    pub text: Option<String>,
}

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut tick: u32 = 0;
        // the RetroAchievements line seen when a session began (it may be from an earlier game)
        let mut ra_before: HashMap<String, Option<String>> = HashMap::new();
        loop {
            tokio::time::sleep(TICK).await;
            let st = app.state::<AppState>();
            let live = st.tracker.live();
            ra_before.retain(|id, _| live.iter().any(|l| &l.game_id == id));
            if live.is_empty() {
                continue;
            }
            tick = tick.wrapping_add(1);
            for l in live {
                let title = l.title.to_lowercase();
                let appid: u32 = l.game_id.strip_prefix("steam:").and_then(|a| a.parse().ok()).unwrap_or(0);
                let text = if appid == crate::live::CS2 || appid == crate::live::DOTA2 {
                    match crate::live::pushed(appid) {
                        Some(t) => Some(t),
                        None => steam_line(&st, &appid.to_string()).await,
                    }
                } else if appid == crate::live::ROCKET_LEAGUE || title.contains("rocket league") {
                    let me = steam_account(&st).map(|a| (a + STEAM_ID_BASE).to_string());
                    let rl = tauri::async_runtime::spawn_blocking(move || crate::live::rocket_league(me.as_deref())).await.ok().flatten();
                    match rl {
                        Some(t) => Some(t),
                        None if appid != 0 => steam_line(&st, &appid.to_string()).await,
                        None => None,
                    }
                } else if title.contains("league of legends") {
                    crate::live::lol().await
                } else if let Some(appid) = l.game_id.strip_prefix("steam:") {
                    steam_line(&st, appid).await
                } else if l.game_id.starts_with("rom:") {
                    if tick % RA_EVERY != 1 && ra_before.contains_key(&l.game_id) {
                        continue;
                    }
                    ra_line(&st, &l.game_id, &mut ra_before).await
                } else {
                    continue;
                };
                if let Some(row) = st.tracker.set_presence(&l.game_id, text.clone()) {
                    if let Some(t) = &text {
                        let _ = st.db.lock().unwrap().execute("UPDATE sessions SET presence = ?1 WHERE id = ?2", rusqlite::params![t, row]);
                    }
                    let _ = app.emit("presence", PresenceEvent { game_id: l.game_id.clone(), text });
                }
            }
        }
    });
}

fn steam_account(st: &AppState) -> Option<u64> {
    let c = st.db.lock().unwrap();
    let id: String = c.query_row("SELECT external_id FROM accounts WHERE platform = 'steam'", [], |r| r.get(0)).ok()?;
    id.parse::<u64>().ok()?.checked_sub(STEAM_ID_BASE)
}

async fn steam_line(st: &AppState, appid: &str) -> Option<String> {
    let account = steam_account(st)?;
    let html = st
        .http
        .get(format!("https://steamcommunity.com/miniprofile/{account}"))
        .query(&[("l", crate::steam_lang())])
        .send()
        .await
        .ok()?
        .text()
        .await
        .ok()?;
    steam_card_line(&html, appid)
}

/// the rich presence line of the profile card, when it is about this game
pub fn steam_card_line(html: &str, appid: &str) -> Option<String> {
    let at = html.find("miniprofile_game")?;
    let section = &html[at..];
    // the card names the game through its artwork; another game means another session
    if let Some(i) = section.find("/apps/") {
        let rest = &section[i + 6..];
        let shown: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        if !shown.is_empty() && shown != appid {
            return None;
        }
    }
    let line = text_of(section, "rich_presence")?;
    (!line.is_empty()).then_some(line)
}

/// inner text of the first element carrying `class`
pub fn text_of(html: &str, class: &str) -> Option<String> {
    let mut from = 0;
    while let Some(i) = html[from..].find("class=\"") {
        let start = from + i + 7;
        let end = start + html[start..].find('"')?;
        from = end;
        if !html[start..end].split_whitespace().any(|c| c == class) {
            continue;
        }
        let open = end + html[end..].find('>')? + 1;
        let close = open + html[open..].find("</")?;
        return Some(clean(&html[open..close]));
    }
    None
}

pub fn clean(s: &str) -> String {
    // drop nested tags, decode the few entities Steam writes, fold whitespace
    let mut out = String::new();
    let mut in_tag = false;
    for ch in s.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            c if !in_tag => out.push(c),
            _ => {}
        }
    }
    let out = out
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&#039;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ");
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

async fn ra_line(st: &AppState, game_id: &str, before: &mut HashMap<String, Option<String>>) -> Option<String> {
    let (user, key) = crate::extras::ra_login(st)?;
    let v: Value = st
        .http
        .get("https://retroachievements.org/API/API_GetUserProfile.php")
        .query(&[("u", user.as_str()), ("y", key.as_str())])
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;
    let msg = v["RichPresenceMsg"].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    let last = v["LastGameID"].as_i64().or_else(|| v["LastGameID"].as_str().and_then(|s| s.parse().ok()));
    let first_look = !before.contains_key(game_id);
    let was = before.entry(game_id.to_string()).or_insert_with(|| msg.clone()).clone();
    match crate::extras::ra_game_id(st, game_id).await {
        // the ROM is known on RetroAchievements: the line must be about it
        Some(id) => msg.filter(|_| last == Some(id)),
        // unknown (an archive, say): only a line that changed during this session
        None => msg.filter(|m| !first_look && was.as_deref() != Some(m.as_str())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CARD: &str = r#"<div class="miniprofile_container">
        <span class="persona in-game">Oyuncu</span><span class="friend_status_in-game">Oyunda</span>
        <div class="miniprofile_gamesection">
            <img class="game_logo" src="https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/570/capsule_231x87.jpg">
            <div class="miniprofile_game_details">
                <span class="game_state">Oyunda</span>
                <span class="miniprofile_game_name">Dota 2</span>
                <span class="rich_presence">Dereceli: Juggernaut - Sv. 12 &amp; 3 öldürme</span>
            </div>
        </div></div>"#;

    #[test]
    fn reads_the_line_of_the_running_game() {
        assert_eq!(steam_card_line(CARD, "570").as_deref(), Some("Dereceli: Juggernaut - Sv. 12 & 3 öldürme"));
    }

    #[test]
    fn another_game_on_the_card_is_not_ours() {
        assert_eq!(steam_card_line(CARD, "730"), None);
    }

    #[test]
    fn an_offline_card_says_nothing() {
        let off = r#"<span class="persona offline">X</span><span class="friend_status_offline">Offline</span>
            <div class="miniprofile_detailssection not_in_game"></div>"#;
        assert_eq!(steam_card_line(off, "570"), None);
    }
}
