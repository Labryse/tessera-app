//! Updates: Tessera asks the address in tauri.conf.json (plugins.updater.endpoints)
//! for a newer signed version. With no address set, it never asks.

use serde_json::{json, Value};
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

pub fn configured(app: &AppHandle) -> bool {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|u| u.get("endpoints"))
        .and_then(Value::as_array)
        .is_some_and(|e| !e.is_empty())
}

/// is there a newer version? (nothing is downloaded yet)
pub async fn check(app: &AppHandle) -> Result<Value, String> {
    let current = app.package_info().version.to_string();
    if !configured(app) {
        return Ok(json!({ "configured": false, "current": current }));
    }
    let up = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    Ok(match up {
        Some(u) => json!({ "configured": true, "current": current, "available": true, "version": u.version, "notes": u.body, "date": u.date.map(|d| d.to_string()) }),
        None => json!({ "configured": true, "current": current, "available": false }),
    })
}

/// downloads the new version, checks its signature, installs it and restarts
pub async fn install(app: &AppHandle) -> Result<(), String> {
    let Some(u) = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())? else {
        return Err(crate::l("Yeni sürüm yok.", "No new version.").into());
    };
    u.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    app.restart();
}
