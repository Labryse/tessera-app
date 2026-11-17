//! A program's own icon, taken from its .exe and kept as a small PNG, so an
//! emulator shows up with the face its users already know.

use std::path::{Path, PathBuf};

fn b64(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for c in bytes.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

fn cache_file(cache: &Path, exe: &Path) -> PathBuf {
    let id = crate::scan::exe_id(&exe.to_string_lossy());
    cache.join("icons").join(format!("{id}.png"))
}

/// a data: URL with the exe's icon, extracted once and then read from the cache
pub fn exe_icon(cache: &Path, exe: &Path) -> Option<String> {
    if !exe.exists() {
        return None;
    }
    let file = cache_file(cache, exe);
    if !file.exists() {
        std::fs::create_dir_all(file.parent()?).ok()?;
        let q = |p: &Path| p.to_string_lossy().replace('\'', "''");
        let script = format!(
            "Add-Type -AssemblyName System.Drawing; \
             $i = [System.Drawing.Icon]::ExtractAssociatedIcon('{}'); \
             if ($i) {{ $i.ToBitmap().Save('{}', [System.Drawing.Imaging.ImageFormat]::Png) }}",
            q(exe),
            q(&file)
        );
        let mut cmd = std::process::Command::new("powershell");
        cmd.args(["-NoProfile", "-NonInteractive", "-Command", &script]);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // no console window
        }
        let _ = cmd.output();
    }
    let bytes = std::fs::read(&file).ok()?;
    Some(format!("data:image/png;base64,{}", b64(&bytes)))
}

#[cfg(test)]
mod tests {
    #[test]
    fn base64() {
        assert_eq!(super::b64(b"Man"), "TWFu");
        assert_eq!(super::b64(b"Ma"), "TWE=");
        assert_eq!(super::b64(b"M"), "TQ==");
    }
}

#[cfg(test)]
mod live {
    #[test]
    #[ignore = "extracts the mGBA icon on this PC"]
    fn mgba_icon() {
        let exe = std::path::PathBuf::from(std::env::var("USERPROFILE").unwrap()).join("Desktop").join("mGBA").join("mGBA.exe");
        let url = super::exe_icon(&std::env::temp_dir().join("tessera-icons"), &exe).unwrap();
        println!("icon data url: {} chars, starts {}", url.len(), &url[..30]);
    }
}
