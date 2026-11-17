//! Crash notes for bug reports. A panic is written to errors.log in the app's folder;
//! nothing leaves the computer unless the user opens the report and sends it.

use serde_json::{json, Value};
use std::io::Write;
use std::path::{Path, PathBuf};

const MAX: u64 = 64 * 1024;

fn file(dir: &Path) -> PathBuf {
    dir.join("errors.log")
}

/// panics go to errors.log (and still to the console)
pub fn install(dir: PathBuf) {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let at = info.location().map(|l| format!("{}:{}", l.file(), l.line())).unwrap_or_default();
        let msg = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "panic".into());
        let path = file(&dir);
        // a long log starts over
        if std::fs::metadata(&path).is_ok_and(|m| m.len() > MAX) {
            let _ = std::fs::remove_file(&path);
        }
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
            let _ = writeln!(f, "[{}] panic at {at}: {msg}", crate::db::now());
        }
        previous(info);
    }));
}

fn os() -> String {
    sysinfo::System::long_os_version().unwrap_or_else(|| "Windows".into())
}

/// what a report starts from: version, Windows version, where to send it, recent crashes
pub fn info(dir: &Path) -> Value {
    let log = std::fs::read_to_string(file(dir)).unwrap_or_default();
    let tail: String = log.lines().rev().take(12).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n");
    json!({
        "version": env!("CARGO_PKG_VERSION"),
        "os": os(),
        "repo": option_env!("TESSERA_REPO").filter(|r| !r.is_empty()),
        "log": tail,
    })
}

pub fn clear(dir: &Path) {
    let _ = std::fs::remove_file(file(dir));
}
