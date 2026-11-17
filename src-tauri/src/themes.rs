//! Themes people make and share: small JSON files in the app's "themes" folder.
//! A theme names one of the built-in themes as its base and overrides what it likes:
//! colours, type, corners, surfaces, the backdrop (a picture too), touches, rules for
//! single parts of the window and CSS. The window applies it.

use serde_json::{json, Value};
use std::path::{Path, PathBuf};

// a theme may carry a background picture and its own fonts
const MAX_BYTES: u64 = 16 * 1024 * 1024;

pub fn dir(app_dir: &Path) -> PathBuf {
    app_dir.join("themes")
}

/// a file name from the theme's name: letters, digits and dashes
pub fn slug(name: &str) -> String {
    let s: String = name
        .trim()
        .replace('İ', "i")
        .to_lowercase()
        .chars()
        .map(|c| match c {
            'ç' => 'c', 'ğ' => 'g', 'ı' => 'i', 'ö' => 'o', 'ş' => 's', 'ü' => 'u',
            c if c.is_ascii_alphanumeric() => c,
            _ => '-',
        })
        .collect();
    let s = s.split('-').filter(|p| !p.is_empty()).collect::<Vec<_>>().join("-");
    if s.is_empty() { "tema".into() } else { s.chars().take(48).collect() }
}

/// an object of plain values (numbers, yes/no, short text, lists of short text)
fn flat(v: &Value, max: usize) -> Value {
    let Some(o) = v.as_object() else { return Value::Null };
    let keep = |x: &Value| match x {
        Value::String(s) => s.len() <= max,
        Value::Number(_) | Value::Bool(_) => true,
        Value::Array(a) => a.len() <= 8 && a.iter().all(|i| i.as_str().is_some_and(|s| s.len() <= max)),
        _ => false,
    };
    let m: serde_json::Map<String, Value> = o.iter().filter(|(k, x)| k.len() <= 24 && keep(x)).map(|(k, x)| (k.clone(), x.clone())).take(40).collect();
    Value::Object(m)
}

/// a data: URL of one of the given kinds, or nothing
fn data_url(v: &Value, kinds: &[&str], max: usize) -> Option<String> {
    let s = v.as_str()?;
    let head = s.get(..s.find(";base64,")?)?.to_ascii_lowercase();
    let ok = kinds.iter().any(|k| head == format!("data:{k}"));
    let clean = s.chars().all(|c| !c.is_whitespace() && !matches!(c, '"' | '\'' | ')' | '('));
    (ok && clean && s.len() <= max).then(|| s.to_string())
}

const IMAGES: &[&str] = &["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif", "image/avif"];
const FONTS: &[&str] = &[
    "font/ttf", "font/otf", "font/woff", "font/woff2", "application/font-woff", "application/font-woff2",
    "application/x-font-ttf", "application/x-font-otf", "application/octet-stream", "application/vnd.ms-opentype",
];

/// the layout: plain values, plus the lists of hidden and ordered parts and renamed lines
fn layout(v: &Value) -> Value {
    let mut l = flat(v, 24);
    let Some(o) = l.as_object_mut() else { return Value::Null };
    for k in ["hide", "order", "sections", "texts"] {
        o.remove(k);
    }
    for k in ["hide", "order", "sections"] {
        if let Some(a) = v[k].as_array() {
            let ids: Vec<Value> = a
                .iter()
                .filter_map(|i| i.as_str().filter(|s| !s.is_empty() && s.len() <= 32))
                .map(|s| json!(s))
                .take(80)
                .collect();
            o.insert(k.into(), Value::Array(ids));
        }
    }
    if let Some(t) = v["texts"].as_object() {
        let m: serde_json::Map<String, Value> = t
            .iter()
            .filter(|(k, x)| !k.is_empty() && k.len() <= 200 && x.as_str().is_some_and(|s| s.len() <= 480))
            .take(300)
            .map(|(k, x)| (k.clone(), x.clone()))
            .collect();
        o.insert("texts".into(), Value::Object(m));
    }
    l
}

/// keeps only what a theme may carry; None when it is not a theme at all
pub fn clean(v: &Value) -> Option<Value> {
    let name = v["name"].as_str()?.trim();
    let colors = v["colors"].as_object()?;
    if name.is_empty() || name.chars().count() > 60 {
        return None;
    }
    let colors: serde_json::Map<String, Value> = colors
        .iter()
        .filter(|(k, c)| k.len() <= 24 && c.as_str().is_some_and(|c| c.len() <= 64))
        .map(|(k, c)| (k.clone(), c.clone()))
        .collect();
    let text = |k: &str, max: usize| v[k].as_str().filter(|s| s.len() <= max).map(str::to_string);
    let mut backdrop = flat(&v["backdrop"], 64);
    if let Some(o) = backdrop.as_object_mut() {
        o.remove("image");
    }
    if let Some(img) = data_url(&v["backdrop"]["image"], IMAGES, 12 * 1024 * 1024) {
        backdrop["image"] = json!(img);
    }
    let fonts: Vec<Value> = v["fonts"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|f| {
                    let name = f["name"].as_str().filter(|n| !n.trim().is_empty() && n.len() <= 64)?;
                    Some(json!({ "name": name, "data": data_url(&f["data"], FONTS, 4 * 1024 * 1024)? }))
                })
                .take(4)
                .collect()
        })
        .unwrap_or_default();
    let rules: Vec<Value> = v["rules"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|r| {
                    let sel = r["sel"].as_str().filter(|s| !s.trim().is_empty() && s.len() <= 240)?;
                    let props = flat(&r["props"], 200);
                    let label = r["label"].as_str().filter(|s| s.len() <= 60);
                    Some(json!({ "sel": sel, "label": label, "props": props }))
                })
                .take(300)
                .collect()
        })
        .unwrap_or_default();
    let opt = |x: Value| if x.as_object().is_some_and(|o| !o.is_empty()) { x } else { Value::Null };
    Some(json!({
        "tessera": 2,
        "name": name,
        "author": text("author", 60),
        "base": text("base", 24).unwrap_or_else(|| "graphite".into()),
        "colors": colors,
        "radius": v["radius"].as_f64().map(|r| r.clamp(0.0, 32.0)),
        "radii": opt(flat(&v["radii"], 8)),
        "type": opt(flat(&v["type"], 64)),
        "fonts": fonts,
        "surface": opt(flat(&v["surface"], 16)),
        "backdrop": opt(backdrop),
        "touches": opt(flat(&v["touches"], 64)),
        "layout": opt(layout(&v["layout"])),
        "rules": rules,
        "background": text("background", 4000),
        "css": text("css", 40000),
    }))
}

pub fn list(app_dir: &Path) -> Vec<Value> {
    let Ok(rd) = std::fs::read_dir(dir(app_dir)) else { return vec![] };
    let mut out: Vec<Value> = rd
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x.eq_ignore_ascii_case("json")))
        .filter(|e| e.metadata().is_ok_and(|m| m.len() <= MAX_BYTES))
        .filter_map(|e| {
            let v: Value = serde_json::from_str(&std::fs::read_to_string(e.path()).ok()?).ok()?;
            let mut t = clean(&v)?;
            t["id"] = json!(e.path().file_stem()?.to_string_lossy());
            Some(t)
        })
        .collect();
    let key = |v: &Value| (v["name"].as_str().unwrap_or("").to_lowercase(), v["id"].as_str().unwrap_or("").to_string());
    out.sort_by_key(key);
    out
}

/// writes a theme; an id keeps its file (editing), otherwise a new file is named after it
pub fn save(app_dir: &Path, theme: &Value, id: Option<&str>) -> Result<String, String> {
    let t = clean(theme).ok_or_else(|| crate::tr!("Bu bir Tessera teması değil.", "This is not a Tessera theme."))?;
    let d = dir(app_dir);
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    let id = match id.map(slug) {
        Some(id) => id,
        None => {
            let base = slug(t["name"].as_str().unwrap_or("tema"));
            let mut id = base.clone();
            let mut n = 2;
            while d.join(format!("{id}.json")).exists() {
                id = format!("{base}-{n}");
                n += 1;
            }
            id
        }
    };
    let body = serde_json::to_string_pretty(&t).map_err(|e| e.to_string())?;
    std::fs::write(d.join(format!("{id}.json")), body).map_err(|e| e.to_string())?;
    Ok(id)
}

pub fn import(app_dir: &Path, path: &Path) -> Result<String, String> {
    if std::fs::metadata(path).map_err(|e| e.to_string())?.len() > MAX_BYTES {
        return Err(crate::tr!("Tema dosyası çok büyük.", "The theme file is too large."));
    }
    let v: Value = serde_json::from_str(&std::fs::read_to_string(path).map_err(|e| e.to_string())?)
        .map_err(|_| crate::tr!("Bu bir Tessera teması değil.", "This is not a Tessera theme."))?;
    save(app_dir, &v, None)
}

pub fn export(app_dir: &Path, id: &str, to: &Path) -> Result<(), String> {
    std::fs::copy(dir(app_dir).join(format!("{}.json", slug(id))), to).map(|_| ()).map_err(|e| e.to_string())
}

pub fn delete(app_dir: &Path, id: &str) -> Result<(), String> {
    match std::fs::remove_file(dir(app_dir).join(format!("{}.json", slug(id)))) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_files_and_keeps_only_theme_fields() {
        assert_eq!(slug("Gece Mavisi!"), "gece-mavisi");
        assert_eq!(slug("Çağrı'nın Şöleni"), "cagri-nin-soleni");
        assert_eq!(slug("   "), "tema");
        let t = clean(&json!({ "name": "X", "colors": { "accent": "#ff0000", "evil": 5 }, "radius": 99, "script": "alert(1)" })).unwrap();
        assert_eq!(t["colors"].as_object().unwrap().len(), 1);
        assert_eq!(t["radius"], 32.0);
        assert!(t.get("script").is_none());
        assert!(clean(&json!({ "colors": {} })).is_none());
    }

    #[test]
    fn keeps_the_studio_parts_and_drops_the_rest() {
        let t = clean(&json!({
            "name": "Tam", "colors": {},
            "type": { "body": "Bahnschrift", "scale": 110, "caps": true, "evil": { "x": 1 } },
            "backdrop": { "kind": "image", "image": "data:image/png;base64,AAAA", "dim": 40 },
            "fonts": [{ "name": "Mine", "data": "data:font/woff2;base64,AAAA" }, { "name": "Bad", "data": "https://x.y/f.woff2" }],
            "rules": [{ "sel": ".nav-item", "props": { "color": "#ff0000" } }, { "props": {} }],
        }))
        .unwrap();
        assert_eq!(t["type"]["scale"], 110);
        assert!(t["type"].get("evil").is_none());
        assert_eq!(t["backdrop"]["image"], "data:image/png;base64,AAAA");
        assert_eq!(t["fonts"].as_array().unwrap().len(), 1);
        assert_eq!(t["rules"].as_array().unwrap().len(), 1);
        let bad = clean(&json!({ "name": "X", "colors": {}, "backdrop": { "kind": "image", "image": "data:text/html;base64,AAAA" } })).unwrap();
        assert!(bad["backdrop"].get("image").is_none());
        assert!(clean(&json!({ "name": "X", "colors": {} })).unwrap()["surface"].is_null());
    }

    #[test]
    fn keeps_the_layout_lists_and_renamed_lines() {
        let many: Vec<String> = (0..12).map(|i| format!("part{i}")).collect();
        let t = clean(&json!({
            "name": "Düzen", "colors": {},
            "layout": {
                "nav": "top", "list": "left", "listWidth": 300, "hide": many, "order": ["stats", "all", { "x": 1 }],
                "texts": { "Tüm oyunlar": "Kütüphane", "Ayarlar": { "x": 1 } }, "evil": { "x": 1 },
            },
        }))
        .unwrap();
        let l = &t["layout"];
        assert_eq!(l["nav"], "top");
        assert_eq!(l["listWidth"], 300);
        assert_eq!(l["hide"].as_array().unwrap().len(), 12);
        assert_eq!(l["order"], json!(["stats", "all"]));
        assert_eq!(l["texts"], json!({ "Tüm oyunlar": "Kütüphane" }));
        assert!(l.get("evil").is_none());
    }

    #[test]
    fn saves_imports_and_lists() {
        let d = std::env::temp_dir().join(format!("tessera-themes-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        let id = save(&d, &json!({ "name": "Deniz", "base": "abyss", "colors": { "accent": "#00ffcc" } }), None).unwrap();
        assert_eq!(id, "deniz");
        assert_eq!(save(&d, &json!({ "name": "Deniz", "colors": {} }), None).unwrap(), "deniz-2");
        let l = list(&d);
        assert_eq!(l.len(), 2);
        assert_eq!(l[0]["base"], "abyss");
        let out = d.join("out.json");
        export(&d, "deniz", &out).unwrap();
        assert_eq!(import(&d, &out).unwrap(), "deniz-3");
        delete(&d, "deniz-2").unwrap();
        assert_eq!(list(&d).len(), 2);
        let _ = std::fs::remove_dir_all(&d);
    }
}
