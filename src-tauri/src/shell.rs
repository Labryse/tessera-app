//! Living in the background: the tray icon, closing to the tray, starting with
//! Windows, and Windows notifications (wishlist sales, sessions while hidden).

use crate::{db, AppState};
use serde_json::{json, Value};
use std::time::Duration;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_notification::NotificationExt;

pub const HIDDEN_ARG: &str = "--hidden";
const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const RUN_NAME: &str = "Tessera";

/// the user's choices for life in the background; all on unless turned off
pub fn pref(st: &AppState, key: &str) -> bool {
    db::setting(&st.db.lock().unwrap(), key).and_then(|v| v.as_bool()).unwrap_or(true)
}

pub fn prefs(st: &AppState) -> Value {
    json!({
        "closeToTray": pref(st, "closeToTray"),
        "notifyWishlist": pref(st, "notifyWishlist"),
        "notifySessions": pref(st, "notifySessions"),
        "notifyTracked": pref(st, "notifyTracked"),
        "autostart": autostart_on(),
    })
}

// ---------------------------------------------------------------- the window

/// the main window, made here so a start with Windows can stay hidden (and quiet)
pub fn main_window(app: &tauri::App) -> tauri::Result<()> {
    let hidden = std::env::args().any(|a| a == HIDDEN_ARG);
    let conf = app.config().app.windows.iter().find(|w| w.label == "main").cloned().expect("main window in tauri.conf.json");
    let win = WebviewWindowBuilder::from_config(app.handle(), &conf)?
        .visible(!hidden)
        .initialization_script(if hidden { "window.__TESSERA_HIDDEN__ = true;" } else { "" })
        .build()?;
    let handle = app.handle().clone();
    win.on_window_event(move |ev| {
        if let WindowEvent::CloseRequested { api, .. } = ev {
            let st = handle.state::<AppState>();
            if pref(&st, "closeToTray") {
                api.prevent_close();
                if let Some(w) = handle.get_webview_window("main") {
                    let _ = w.hide();
                }
                // say it once, so a closed window that keeps counting is no surprise
                let c = st.db.lock().unwrap();
                if db::setting(&c, "trayHintShown").is_none() {
                    let _ = db::set_setting(&c, "trayHintShown", &json!(true));
                    drop(c);
                    notify(&handle, crate::l("Tessera arka planda", "Tessera is in the background"), crate::l("Süreleri saymaya devam ediyor. Simgesi saatin yanında; çıkmak için sağ tıkla.", "It keeps counting playtime. Its icon is next to the clock; right-click it to quit."));
                }
            }
        }
    });
    Ok(())
}

pub fn show(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

pub fn window_visible(app: &AppHandle) -> bool {
    app.get_webview_window("main").and_then(|w| w.is_visible().ok()).unwrap_or(false)
}

// ---------------------------------------------------------------- tray

pub fn tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", crate::l("Tessera’yı aç", "Open Tessera"), true, None::<&str>)?;
    let pick = MenuItem::with_id(app, "pick", "Ne oynasam?", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", crate::l("Çıkış", "Quit"), true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &pick, &PredefinedMenuItem::separator(app)?, &quit])?;
    let mut b = TrayIconBuilder::with_id("main")
        .tooltip("Tessera")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, ev| match ev.id().as_ref() {
            "open" => show(app),
            "pick" => {
                show(app);
                let _ = app.emit("open-picker", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, ev| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev {
                show(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        b = b.icon(icon.clone());
    }
    b.build(app)?;
    Ok(())
}

/// the tray's tooltip says what is running
pub fn tray_tooltip(app: &AppHandle, playing: &[String]) {
    if let Some(t) = app.tray_by_id("main") {
        let text = if playing.is_empty() { "Tessera".to_string() } else { crate::tr!("Tessera · {} oynanıyor", "Tessera · playing {}", playing.join(", ")) };
        let _ = t.set_tooltip(Some(text));
    }
}

// ---------------------------------------------------------------- notifications

pub fn notify(app: &AppHandle, title: &str, body: &str) {
    let _ = app.notification().builder().title(title).body(body).show();
}

/// a session that ended while the window was away
pub fn session_ended(app: &AppHandle, title: &str, minutes: i64) {
    if minutes < 1 || window_visible(app) || !pref(&app.state::<AppState>(), "notifySessions") {
        return;
    }
    let h = minutes / 60;
    let m = minutes % 60;
    let time = match (h, m) {
        (0, m) => crate::tr!("{m} dk", "{m} min"),
        (h, 0) => crate::tr!("{h} sa", "{h} h"),
        (h, m) => crate::tr!("{h} sa {m} dk", "{h} h {m} min"),
    };
    notify(app, title, &crate::tr!("{time} oynadın", "You played {time}"));
}

/// every half hour: is it time to look at the wishlist again (every six hours)?
pub fn wishlist_watch(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(60)).await;
        loop {
            let st = app.state::<AppState>();
            let has_steam = st.db.lock().unwrap().query_row("SELECT 1 FROM accounts WHERE platform = 'steam'", [], |_| Ok(())).is_ok();
            let last = crate::wishlist::saved(&st)["checkedAt"].as_i64().unwrap_or(0);
            if has_steam && db::now() - last > 6 * 3600 {
                if let Ok(r) = crate::wishlist::refresh(&st).await {
                    let _ = app.emit("wishlist", &r);
                    if pref(&st, "notifyWishlist") {
                        tell_changes(&app, &r["changes"]);
                    }
                }
            }
            // games followed from "Fiyat ara"
            if crate::prices::key().is_some() && db::now() - crate::track::last_check(&st) > crate::track::EVERY {
                if let Ok(cheaper) = crate::track::check(&st).await {
                    let _ = app.emit("tracked", crate::track::list(&st));
                    if pref(&st, "notifyTracked") {
                        if let Some((title, body)) = crate::track::message(&cheaper) {
                            notify(&app, &title, &body);
                        }
                    }
                }
            }
            tokio::time::sleep(Duration::from_secs(30 * 60)).await;
        }
    });
}

fn tell_changes(app: &AppHandle, changes: &Value) {
    let Some(list) = changes.as_array() else { return };
    let sale: Vec<&Value> = list.iter().filter(|c| c["kind"] == "sale").collect();
    let out: Vec<&Value> = list.iter().filter(|c| c["kind"] == "released").collect();
    let name = |c: &Value| c["name"].as_str().unwrap_or(crate::l("Bir oyun", "A game")).to_string();
    match sale.len() {
        0 => {}
        1 => notify(app, crate::l("İstek listende indirim", "Sale on your wishlist"), &crate::tr!("{} %{} indirimde · {}", "{} is {}% off · {}", name(sale[0]), sale[0]["discount"], sale[0]["price"].as_str().unwrap_or(""))),
        n => notify(app, crate::l("İstek listende indirim", "Sale on your wishlist"), &crate::tr!("{n} oyun indirime girdi: {}", "{n} games went on sale: {}", sale.iter().take(3).map(|c| name(c)).collect::<Vec<_>>().join(", "))),
    }
    match out.len() {
        0 => {}
        1 => notify(app, crate::l("İstek listendeki oyun çıktı", "A game on your wishlist is out"), &name(out[0])),
        n => notify(app, crate::l("İstek listende çıkanlar", "Out from your wishlist"), &crate::tr!("{n} oyun çıktı: {}", "{n} games came out: {}", out.iter().take(3).map(|c| name(c)).collect::<Vec<_>>().join(", "))),
    }
}

// ---------------------------------------------------------------- start with Windows

fn run_key() -> Option<winreg::RegKey> {
    winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER)
        .open_subkey_with_flags(RUN_KEY, winreg::enums::KEY_READ | winreg::enums::KEY_WRITE)
        .ok()
}

pub fn autostart_on() -> bool {
    run_key().and_then(|k| k.get_value::<String, _>(RUN_NAME).ok()).is_some()
}

/// starts hidden in the tray when Windows starts
pub fn set_autostart(on: bool) -> Result<(), String> {
    let k = run_key().ok_or(crate::l("Başlangıç ayarı açılamadı.", "Could not open the startup setting."))?;
    if on {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        k.set_value(RUN_NAME, &format!("\"{}\" {HIDDEN_ARG}", exe.display())).map_err(|e| e.to_string())
    } else {
        match k.delete_value(RUN_NAME) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
            _ => Ok(()),
        }
    }
}
