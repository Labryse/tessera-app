//! Save files for emulated games: snapshots kept by Tessera, mirrored to a cloud
//! folder the user picks (OneDrive, Google Drive, Dropbox…). The cloud app moves
//! the files between PCs; Tessera never runs a server.
//!
//! A game's identity is its ROM id (system + CRC), so the same ROM on another PC
//! finds its saves even when the file is named differently. Saves are restored
//! next to the ROM under the ROM's own name, which is where mGBA (and most
//! emulators by default) look for them.

use crate::db;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};

/// battery saves and save states that sit next to a ROM
const SAVE_EXTS: &[&str] = &[
    "sav", "srm", "sa1", "sgm", "dsv", "eep", "fla", "mcr", "mcd",
    "ss0", "ss1", "ss2", "ss3", "ss4", "ss5", "ss6", "ss7", "ss8", "ss9",
];
const KEEP: usize = 15;
const CLOUD_SUBDIR: &str = "Tessera Saves";

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub ext: String,
    pub size: u64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub game_id: String,
    pub title: String,
    pub system: String,
    pub created: i64,
    pub machine: String,
    pub reason: String,
    pub hash: String,
    pub files: Vec<FileEntry>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub id: String,
    #[serde(flatten)]
    pub manifest: Manifest,
    pub local: bool,
    pub cloud: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalFile {
    pub name: String,
    pub ext: String,
    pub size: u64,
    pub modified: i64,
}

pub fn key(game_id: &str) -> String {
    game_id.replace(':', "_")
}

fn machine() -> String {
    std::env::var("COMPUTERNAME").unwrap_or_else(|_| "Bu bilgisayar".into())
}

pub fn cloud_dir(c: &rusqlite::Connection) -> Option<PathBuf> {
    db::setting(c, "saveCloudDir").and_then(|v| v.as_str().map(PathBuf::from)).filter(|p| p.exists())
}

/// a sensible default: the OneDrive folder, if this PC has one
pub fn suggested_cloud() -> Option<String> {
    for var in ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"] {
        if let Ok(p) = std::env::var(var) {
            let p = PathBuf::from(p);
            if p.exists() {
                return Some(p.join("Tessera").to_string_lossy().to_string());
            }
        }
    }
    let gd = PathBuf::from(std::env::var("USERPROFILE").unwrap_or_default()).join("Google Drive");
    gd.exists().then(|| gd.join("Tessera").to_string_lossy().to_string())
}

fn rom_path(meta: &Value) -> Option<PathBuf> {
    meta["romPath"].as_str().map(PathBuf::from)
}

/// the save files that belong to this ROM right now
pub fn local_files(meta: &Value) -> Vec<PathBuf> {
    let Some(rom) = rom_path(meta) else { return vec![] };
    let (Some(dir), Some(stem)) = (rom.parent(), rom.file_stem()) else { return vec![] };
    let stem = stem.to_string_lossy().to_lowercase();
    let Ok(rd) = std::fs::read_dir(dir) else { return vec![] };
    let mut out: Vec<PathBuf> = rd
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.is_file()
                && p.file_stem().is_some_and(|s| s.to_string_lossy().to_lowercase() == stem)
                && p.extension().is_some_and(|x| SAVE_EXTS.contains(&x.to_string_lossy().to_lowercase().as_str()))
        })
        .collect();
    out.sort();
    out
}

pub fn describe_local(meta: &Value) -> Vec<LocalFile> {
    local_files(meta)
        .into_iter()
        .filter_map(|p| {
            let m = std::fs::metadata(&p).ok()?;
            Some(LocalFile {
                name: p.file_name()?.to_string_lossy().to_string(),
                ext: p.extension()?.to_string_lossy().to_lowercase(),
                size: m.len(),
                modified: m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs() as i64).unwrap_or(0),
            })
        })
        .collect()
}

fn hash_files(files: &[PathBuf]) -> String {
    let mut h = crc32fast::Hasher::new();
    for f in files {
        h.update(f.extension().map(|x| x.to_string_lossy().to_lowercase()).unwrap_or_default().as_bytes());
        if let Ok(b) = std::fs::read(f) {
            h.update(&b);
        }
    }
    format!("{:08x}", h.finalize())
}

fn read_snapshots(root: &Path) -> Vec<(String, Manifest)> {
    let Ok(rd) = std::fs::read_dir(root) else { return vec![] };
    let mut out: Vec<(String, Manifest)> = rd
        .flatten()
        .filter_map(|e| {
            let m = std::fs::read_to_string(e.path().join("manifest.json")).ok()?;
            Some((e.file_name().to_string_lossy().to_string(), serde_json::from_str(&m).ok()?))
        })
        .collect();
    out.sort_by(|a, b| b.1.created.cmp(&a.1.created));
    out
}

fn prune(root: &Path) {
    for (id, _) in read_snapshots(root).into_iter().skip(KEEP) {
        let _ = std::fs::remove_dir_all(root.join(id));
    }
}

fn write_snapshot(root: &Path, id: &str, files: &[PathBuf], m: &Manifest) -> std::io::Result<()> {
    let dir = root.join(id);
    std::fs::create_dir_all(&dir)?;
    for f in files {
        if let Some(ext) = f.extension() {
            std::fs::copy(f, dir.join(format!("save.{}", ext.to_string_lossy().to_lowercase())))?;
        }
    }
    std::fs::write(dir.join("manifest.json"), serde_json::to_vec_pretty(m)?)?;
    prune(root);
    Ok(())
}

pub struct Ctx<'a> {
    pub data: &'a Path,
    pub cloud: Option<PathBuf>,
}

impl Ctx<'_> {
    fn local_root(&self, game_id: &str) -> PathBuf {
        self.data.join("saves").join(key(game_id))
    }
    fn cloud_root(&self, game_id: &str) -> Option<PathBuf> {
        self.cloud.as_ref().map(|c| c.join(CLOUD_SUBDIR).join(key(game_id)))
    }
}

/// copies the current saves into a snapshot (both places) unless nothing changed
pub fn snapshot(ctx: &Ctx, game_id: &str, title: &str, meta: &Value, reason: &str) -> Result<Option<String>, String> {
    let files = local_files(meta);
    if files.is_empty() {
        return Ok(None);
    }
    let hash = hash_files(&files);
    let local = ctx.local_root(game_id);
    let cloud = ctx.cloud_root(game_id);
    let latest = read_snapshots(&local).into_iter().next().map(|s| s.1.hash);
    let cloud_latest = cloud.as_ref().and_then(|c| read_snapshots(c).into_iter().next().map(|s| s.1.hash));
    if latest.as_deref() == Some(hash.as_str()) && (cloud.is_none() || cloud_latest.as_deref() == Some(hash.as_str())) {
        return Ok(None);
    }
    let created = db::now();
    let id = format!("{created}-{hash}");
    let m = Manifest {
        game_id: game_id.into(),
        title: title.into(),
        system: meta["system"].as_str().unwrap_or_default().into(),
        created,
        machine: machine(),
        reason: reason.into(),
        hash: hash.clone(),
        files: files.iter().map(|f| FileEntry {
            ext: f.extension().map(|x| x.to_string_lossy().to_lowercase()).unwrap_or_default(),
            size: std::fs::metadata(f).map(|m| m.len()).unwrap_or(0),
        }).collect(),
    };
    if latest.as_deref() != Some(hash.as_str()) {
        write_snapshot(&local, &id, &files, &m).map_err(|e| e.to_string())?;
    }
    if let Some(c) = &cloud {
        if cloud_latest.as_deref() != Some(hash.as_str()) {
            write_snapshot(c, &id, &files, &m).map_err(|e| crate::tr!("Bulut klasörüne yazılamadı: {e}", "Could not write to the cloud folder: {e}"))?;
        }
    }
    Ok(Some(id))
}

pub fn list(ctx: &Ctx, game_id: &str) -> Vec<Snapshot> {
    let mut all: Vec<Snapshot> = read_snapshots(&ctx.local_root(game_id))
        .into_iter()
        .map(|(id, manifest)| Snapshot { id, manifest, local: true, cloud: false })
        .collect();
    if let Some(c) = ctx.cloud_root(game_id) {
        for (id, manifest) in read_snapshots(&c) {
            match all.iter_mut().find(|s| s.manifest.hash == manifest.hash) {
                Some(s) => s.cloud = true,
                None => all.push(Snapshot { id, manifest, local: false, cloud: true }),
            }
        }
    }
    all.sort_by(|a, b| b.manifest.created.cmp(&a.manifest.created));
    all
}

/// puts a snapshot back next to the ROM; what was there is snapshotted first
pub fn restore(ctx: &Ctx, game_id: &str, title: &str, meta: &Value, snap_id: &str) -> Result<(), String> {
    let rom = rom_path(meta).ok_or(crate::l("Bu oyunun ROM dosyası bilinmiyor.", "This game’s ROM file is unknown."))?;
    let dir = rom.parent().ok_or(crate::l("ROM klasörü bulunamadı.", "ROM folder not found."))?;
    let stem = rom.file_stem().ok_or(crate::l("ROM adı okunamadı.", "Could not read the ROM name."))?.to_string_lossy().to_string();
    let source = [Some(ctx.local_root(game_id)), ctx.cloud_root(game_id)]
        .into_iter()
        .flatten()
        .map(|r| r.join(snap_id))
        .find(|p| p.join("manifest.json").exists())
        .ok_or(crate::l("Kayıt bulunamadı.", "Save not found."))?;
    snapshot(ctx, game_id, title, meta, crate::l("Geri yüklemeden önce", "Before restoring"))?;
    for f in local_files(meta) {
        let _ = std::fs::remove_file(f);
    }
    for e in std::fs::read_dir(&source).map_err(|e| e.to_string())?.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if let Some(ext) = name.strip_prefix("save.") {
            std::fs::copy(e.path(), dir.join(format!("{stem}.{ext}"))).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

pub fn delete(ctx: &Ctx, game_id: &str, snap_id: &str) {
    let _ = std::fs::remove_dir_all(ctx.local_root(game_id).join(snap_id));
    if let Some(c) = ctx.cloud_root(game_id) {
        let _ = std::fs::remove_dir_all(c.join(snap_id));
    }
}

/// a ROM that has no save here but has one in the cloud: bring the newest one down
pub fn restore_if_missing(ctx: &Ctx, game_id: &str, title: &str, meta: &Value) -> bool {
    if !local_files(meta).is_empty() || ctx.cloud.is_none() {
        return false;
    }
    let Some(latest) = list(ctx, game_id).into_iter().find(|s| s.cloud) else { return false };
    restore(ctx, game_id, title, meta, &latest.id).is_ok()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudGame {
    pub game_id: String,
    pub title: String,
    pub system: String,
    pub latest: i64,
    pub machine: String,
    pub count: usize,
}

/// every game that has saves in the cloud folder, from any PC
pub fn cloud_overview(cloud: &Path) -> Vec<CloudGame> {
    let Ok(rd) = std::fs::read_dir(cloud.join(CLOUD_SUBDIR)) else { return vec![] };
    let mut out: Vec<CloudGame> = rd
        .flatten()
        .filter_map(|e| {
            let snaps = read_snapshots(&e.path());
            let (_, m) = snaps.first()?.clone();
            Some(CloudGame { game_id: m.game_id, title: m.title, system: m.system, latest: m.created, machine: m.machine, count: snaps.len() })
        })
        .collect();
    out.sort_by(|a, b| b.latest.cmp(&a.latest));
    out
}


#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn snapshot_restore_roundtrip_across_names() {
        let base = std::env::temp_dir().join("tessera-saves-test");
        let _ = std::fs::remove_dir_all(&base);
        let pc1 = base.join("pc1");
        let pc2 = base.join("pc2");
        let cloud = base.join("cloud");
        for d in [&pc1, &pc2, &cloud] {
            std::fs::create_dir_all(d).unwrap();
        }
        // PC 1: "Pokemon Unbound.gba" with a battery save
        std::fs::write(pc1.join("Pokemon Unbound.gba"), b"rom").unwrap();
        std::fs::write(pc1.join("Pokemon Unbound.sav"), b"save-v1").unwrap();
        let meta1 = json!({ "romPath": pc1.join("Pokemon Unbound.gba").to_string_lossy(), "system": "gba" });
        let data1 = base.join("data1");
        let ctx1 = Ctx { data: &data1, cloud: Some(cloud.clone()) };
        assert!(snapshot(&ctx1, "rom:gba:abc", "Unbound", &meta1, "test").unwrap().is_some());
        assert!(snapshot(&ctx1, "rom:gba:abc", "Unbound", &meta1, "test").unwrap().is_none(), "unchanged saves are not copied again");

        // PC 2: same ROM under another name, no save yet → comes down from the cloud
        std::fs::write(pc2.join("unbound_v2.gba"), b"rom").unwrap();
        let meta2 = json!({ "romPath": pc2.join("unbound_v2.gba").to_string_lossy(), "system": "gba" });
        let data2 = base.join("data2");
        let ctx2 = Ctx { data: &data2, cloud: Some(cloud.clone()) };
        assert!(restore_if_missing(&ctx2, "rom:gba:abc", "Unbound", &meta2));
        assert_eq!(std::fs::read(pc2.join("unbound_v2.sav")).unwrap(), b"save-v1");
        assert_eq!(cloud_overview(&cloud).len(), 1);
        let _ = std::fs::remove_dir_all(&base);
    }
}
