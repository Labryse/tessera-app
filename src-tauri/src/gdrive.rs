//! Google Drive save sync.
//!
//! Sign-in happens in the user's own browser (Google does not allow embedded
//! web views); Tessera listens on a one-shot local address for the answer and
//! uses PKCE, so the exchanged code is useless to anyone else. The only
//! permission asked for is `drive.appdata`: a hidden folder that belongs to
//! Tessera alone. Tessera cannot see any other file in the user's Drive.
//!
//! Each save snapshot is one small file in that folder: the manifest plus the
//! save files, base64 in JSON. Its metadata (appProperties) carries the game
//! and snapshot id, so listing everything is a single request.

use crate::saves::Manifest;
use crate::{db, AppState};
use base64::engine::general_purpose::{STANDARD, URL_SAFE, URL_SAFE_NO_PAD};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const AUTH: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN: &str = "https://oauth2.googleapis.com/token";
const FILES: &str = "https://www.googleapis.com/drive/v3/files";
const UPLOAD: &str = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
const SCOPE: &str = "https://www.googleapis.com/auth/drive.appdata openid email";
const REFRESH_KEY: &str = "google-drive-refresh";
const KEEP: usize = 15;

type Res<T> = Result<T, String>;

// ---------------------------------------------------------------- the app's Google client

#[derive(Deserialize, Clone)]
pub struct Client {
    pub client_id: String,
    pub client_secret: String,
}

fn client_file(dir: &Path) -> PathBuf {
    dir.join("google-oauth.json")
}

/// The OAuth client of this Tessera build: the JSON file Google Cloud gives
/// ("Download JSON"), placed in the app's data folder. A published build can
/// bake it in with TESSERA_GOOGLE_CLIENT_ID / TESSERA_GOOGLE_CLIENT_SECRET.
pub fn client(dir: &Path) -> Option<Client> {
    if let (Some(id), Some(secret)) = (option_env!("TESSERA_GOOGLE_CLIENT_ID"), option_env!("TESSERA_GOOGLE_CLIENT_SECRET")) {
        return Some(Client { client_id: id.into(), client_secret: secret.into() });
    }
    let v: Value = serde_json::from_str(&std::fs::read_to_string(client_file(dir)).ok()?).ok()?;
    let c = v.get("installed").or_else(|| v.get("web")).unwrap_or(&v);
    Some(Client { client_id: c["client_id"].as_str()?.into(), client_secret: c["client_secret"].as_str()?.into() })
}

/// takes the downloaded client_secret_….json and keeps it in the app's folder
pub fn install_client(dir: &Path, from: &Path) -> Res<()> {
    let text = std::fs::read_to_string(from).map_err(|e| e.to_string())?;
    let v: Value = serde_json::from_str(&text).map_err(|_| crate::l("Bu bir Google istemci dosyası değil.", "This is not a Google client file.").to_string())?;
    let c = v.get("installed").ok_or(crate::l("Bu dosya “Masaüstü uygulaması” türünde bir istemciye ait değil. Google Cloud’da istemci türünü “Masaüstü uygulaması” seç.", "This file is not for a “Desktop app” client. In Google Cloud, choose “Desktop app” as the client type."))?;
    if c["client_id"].as_str().is_none() || c["client_secret"].as_str().is_none() {
        return Err(crate::l("Dosyada istemci kimliği eksik.", "The file has no client ID.").into());
    }
    std::fs::write(client_file(dir), text).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------- sign-in

fn random_b64(n: usize) -> String {
    let mut b = vec![0u8; n];
    getrandom::fill(&mut b).expect("system randomness");
    URL_SAFE_NO_PAD.encode(b)
}

const DONE_PAGE: &str = "<!doctype html><meta charset=utf-8><title>Tessera</title>\
<body style=\"font-family:system-ui;background:#141414;color:#ecebe8;display:grid;place-items:center;height:100vh;margin:0\">\
<div style=\"text-align:center\"><h1 style=\"font-weight:600\">Tessera bağlandı · Tessera connected</h1>\
<p style=\"color:#b0aea9\">Bu sekmeyi kapatıp Tessera’ya dönebilirsin. · You can close this tab and go back to Tessera.</p></div>";

const FAIL_PAGE: &str = "<!doctype html><meta charset=utf-8><title>Tessera</title>\
<body style=\"font-family:system-ui;background:#141414;color:#ecebe8;display:grid;place-items:center;height:100vh;margin:0\">\
<div style=\"text-align:center\"><h1 style=\"font-weight:600\">Bağlantı tamamlanmadı · Not connected</h1>\
<p style=\"color:#b0aea9\">Tessera’ya dönüp tekrar deneyebilirsin. · Go back to Tessera and try again.</p></div>";

/// waits for Google to send the browser back with a code
fn wait_for_code(listener: TcpListener, state: &str) -> Res<String> {
    listener.set_nonblocking(false).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(300);
    loop {
        if Instant::now() > deadline {
            return Err(crate::l("Google girişi zaman aşımına uğradı.", "Google sign-in timed out.").into());
        }
        let (mut s, _) = listener.accept().map_err(|e| e.to_string())?;
        let _ = s.set_read_timeout(Some(Duration::from_secs(5)));
        // the request line can arrive in pieces: read until the headers end
        let mut got = Vec::new();
        let mut buf = [0u8; 4096];
        while !got.windows(4).any(|w| w == b"\r\n\r\n") && got.len() < 16 * 1024 {
            match s.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => got.extend_from_slice(&buf[..n]),
            }
        }
        let req = String::from_utf8_lossy(&got).to_string();
        let path = req.split_whitespace().nth(1).unwrap_or("/");
        let Ok(url) = url::Url::parse(&format!("http://localhost{path}")) else { continue };
        let q: std::collections::HashMap<String, String> = url.query_pairs().map(|(k, v)| (k.into(), v.into())).collect();
        if !q.contains_key("code") && !q.contains_key("error") {
            // the browser asking for /favicon.ico and the like
            let _ = s.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
            continue;
        }
        let ok = q.get("state").map(String::as_str) == Some(state) && q.contains_key("code");
        let page = if ok { DONE_PAGE } else { FAIL_PAGE };
        let _ = s.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{page}", page.len()).as_bytes());
        if let Some(err) = q.get("error") {
            return Err(if err == "access_denied" { "Google’da izin verilmedi.".into() } else { format!("Google: {err}") });
        }
        if !ok {
            return Err(crate::l("Google’dan gelen yanıt doğrulanamadı.", "Could not verify Google’s answer.").into());
        }
        return Ok(q["code"].clone());
    }
}

fn email_from_id_token(t: &str) -> Option<String> {
    let payload = t.split('.').nth(1)?;
    let bytes = URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).or_else(|_| URL_SAFE.decode(payload)).ok()?;
    let v: Value = serde_json::from_slice(&bytes).ok()?;
    v["email"].as_str().map(str::to_string)
}

/// the whole sign-in: browser, consent, code, tokens. Returns the account's e-mail.
pub async fn connect(st: &AppState) -> Res<String> {
    let c = client(&st.dir).ok_or(crate::l("Google Drive bağlantısı için önce kurulum dosyası gerekiyor.", "Google Drive needs the setup file first."))?;
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let redirect = format!("http://127.0.0.1:{}", listener.local_addr().map_err(|e| e.to_string())?.port());
    let verifier = random_b64(48);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let state = random_b64(16);
    let mut url = url::Url::parse(AUTH).unwrap();
    url.query_pairs_mut()
        .append_pair("client_id", &c.client_id)
        .append_pair("redirect_uri", &redirect)
        .append_pair("response_type", "code")
        .append_pair("scope", SCOPE)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", &state)
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent");
    open::that_detached(url.as_str()).map_err(|e| e.to_string())?;

    let st2 = state.clone();
    let code = tauri::async_runtime::spawn_blocking(move || wait_for_code(listener, &st2)).await.map_err(|e| e.to_string())??;
    let tok: Value = st
        .http
        .post(TOKEN)
        .form(&[
            ("code", code.as_str()),
            ("client_id", &c.client_id),
            ("client_secret", &c.client_secret),
            ("code_verifier", &verifier),
            ("redirect_uri", &redirect),
            ("grant_type", "authorization_code"),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let refresh = tok["refresh_token"].as_str().ok_or_else(|| crate::tr!("Google oturum anahtarı vermedi: {}", "Google did not give a session key: {}", tok["error_description"].as_str().or(tok["error"].as_str()).unwrap_or(crate::l("bilinmeyen hata", "unknown error"))))?;
    crate::secret_set(REFRESH_KEY, Some(refresh))?;
    let email = tok["id_token"].as_str().and_then(email_from_id_token).unwrap_or_else(|| crate::l("Google hesabı", "Google account").into());
    db::set_setting(&st.db.lock().unwrap(), "driveEmail", &json!(email)).map_err(|e| e.to_string())?;
    if let (Some(a), Some(exp)) = (tok["access_token"].as_str(), tok["expires_in"].as_u64()) {
        *ACCESS.lock().unwrap() = Some((a.into(), Instant::now() + Duration::from_secs(exp.saturating_sub(60))));
    }
    Ok(email)
}

pub fn disconnect(st: &AppState) -> Res<()> {
    if let Some(r) = crate::secret_get(REFRESH_KEY) {
        // tell Google too, so the permission disappears from the account page
        let http = st.http.clone();
        tauri::async_runtime::spawn(async move {
            let _ = http.post("https://oauth2.googleapis.com/revoke").form(&[("token", r)]).send().await;
        });
    }
    crate::secret_set(REFRESH_KEY, None)?;
    *ACCESS.lock().unwrap() = None;
    db::set_setting(&st.db.lock().unwrap(), "driveEmail", &Value::Null).map_err(|e| e.to_string())
}

pub fn connected(st: &AppState) -> Option<String> {
    crate::secret_get(REFRESH_KEY)?;
    db::setting(&st.db.lock().unwrap(), "driveEmail").and_then(|v| v.as_str().map(str::to_string)).or(Some(crate::l("Google hesabı", "Google account").into()))
}

static ACCESS: Mutex<Option<(String, Instant)>> = Mutex::new(None);

async fn token(st: &AppState) -> Res<String> {
    if let Some((t, until)) = ACCESS.lock().unwrap().clone() {
        if Instant::now() < until {
            return Ok(t);
        }
    }
    let c = client(&st.dir).ok_or(crate::l("Google kurulum dosyası yok.", "No Google setup file."))?;
    let refresh = crate::secret_get(REFRESH_KEY).ok_or(crate::l("Google Drive bağlı değil.", "Google Drive is not connected."))?;
    let tok: Value = st
        .http
        .post(TOKEN)
        .form(&[("client_id", c.client_id.as_str()), ("client_secret", &c.client_secret), ("refresh_token", &refresh), ("grant_type", "refresh_token")])
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let a = tok["access_token"].as_str().ok_or_else(|| {
        if tok["error"] == "invalid_grant" { crate::l("Google bağlantısının süresi dolmuş; yeniden bağlan.", "The Google connection expired; connect again.").to_string() } else { format!("Google: {}", tok["error"]) }
    })?;
    let exp = tok["expires_in"].as_u64().unwrap_or(3600);
    *ACCESS.lock().unwrap() = Some((a.into(), Instant::now() + Duration::from_secs(exp.saturating_sub(60))));
    Ok(a.into())
}

// ---------------------------------------------------------------- the app folder

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Remote {
    pub file_id: String,
    pub game: String,
    pub snap: String,
    pub manifest: Manifest,
}

fn remote_from(f: &Value) -> Option<Remote> {
    let p = &f["appProperties"];
    // the manifest rides in the description; appProperties values are capped at 124 bytes
    let manifest: Manifest = serde_json::from_str(f["description"].as_str()?).ok()?;
    Some(Remote { file_id: f["id"].as_str()?.into(), game: p["game"].as_str()?.into(), snap: p["snap"].as_str()?.into(), manifest })
}

/// every snapshot in Drive, optionally for one game only
pub async fn list(st: &AppState, game_key: Option<&str>) -> Res<Vec<Remote>> {
    let t = token(st).await?;
    let mut out = vec![];
    let mut page: Option<String> = None;
    loop {
        let mut q: Vec<(&str, String)> = vec![
            ("spaces", "appDataFolder".into()),
            ("fields", "nextPageToken,files(id,appProperties,description)".into()),
            ("pageSize", "1000".into()),
        ];
        if let Some(k) = game_key {
            q.push(("q", format!("appProperties has {{ key='game' and value='{k}' }}")));
        }
        if let Some(p) = &page {
            q.push(("pageToken", p.clone()));
        }
        let v: Value = st.http.get(FILES).bearer_auth(&t).query(&q).send().await.map_err(|e| e.to_string())?.json().await.map_err(|e| e.to_string())?;
        if let Some(err) = v["error"]["message"].as_str() {
            return Err(format!("Google Drive: {err}"));
        }
        out.extend(v["files"].as_array().into_iter().flatten().filter_map(remote_from));
        match v["nextPageToken"].as_str() {
            Some(p) => page = Some(p.into()),
            None => break,
        }
    }
    out.sort_by(|a, b| b.manifest.created.cmp(&a.manifest.created));
    Ok(out)
}

/// sends one local snapshot folder up
pub async fn upload(st: &AppState, game_key: &str, snap: &str, dir: &Path) -> Res<()> {
    let manifest = std::fs::read_to_string(dir.join("manifest.json")).map_err(|e| e.to_string())?;
    let mut files = vec![];
    for e in std::fs::read_dir(dir).map_err(|e| e.to_string())?.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if let Some(ext) = name.strip_prefix("save.") {
            files.push(json!({ "ext": ext, "data": STANDARD.encode(std::fs::read(e.path()).map_err(|e| e.to_string())?) }));
        }
    }
    let body = json!({ "manifest": serde_json::from_str::<Value>(&manifest).unwrap_or(Value::Null), "files": files }).to_string();
    let m: Value = serde_json::from_str(&manifest).unwrap_or(Value::Null);
    let meta = json!({
        "name": format!("{game_key}__{snap}.tsave"),
        "parents": ["appDataFolder"],
        "description": m.to_string(),
        "appProperties": { "game": game_key, "snap": snap },
    });
    let boundary = format!("tessera{}", random_b64(9).replace(['-', '_'], "x"));
    let mut payload = Vec::new();
    write!(payload, "--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{meta}\r\n--{boundary}\r\nContent-Type: application/json\r\n\r\n").ok();
    payload.extend_from_slice(body.as_bytes());
    write!(payload, "\r\n--{boundary}--\r\n").ok();
    let t = token(st).await?;
    let r = st
        .http
        .post(UPLOAD)
        .bearer_auth(&t)
        .header("Content-Type", format!("multipart/related; boundary={boundary}"))
        .body(payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !r.status().is_success() {
        let v: Value = r.json().await.unwrap_or(Value::Null);
        return Err(crate::tr!("Google Drive’a yüklenemedi: {}", "Could not upload to Google Drive: {}", v["error"]["message"].as_str().unwrap_or(crate::l("bilinmeyen hata", "unknown error"))));
    }
    Ok(())
}

/// brings one snapshot down into a local snapshot folder
pub async fn download(st: &AppState, file_id: &str, into: &Path) -> Res<()> {
    let t = token(st).await?;
    let v: Value = st
        .http
        .get(format!("{FILES}/{file_id}"))
        .bearer_auth(&t)
        .query(&[("alt", "media")])
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(into).map_err(|e| e.to_string())?;
    for f in v["files"].as_array().into_iter().flatten() {
        let ext = f["ext"].as_str().ok_or(crate::l("Bozuk kayıt dosyası.", "Broken save file."))?;
        let data = STANDARD.decode(f["data"].as_str().unwrap_or_default()).map_err(|e| e.to_string())?;
        std::fs::write(into.join(format!("save.{ext}")), data).map_err(|e| e.to_string())?;
    }
    std::fs::write(into.join("manifest.json"), serde_json::to_vec_pretty(&v["manifest"]).unwrap_or_default()).map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn delete(st: &AppState, file_id: &str) -> Res<()> {
    let t = token(st).await?;
    st.http.delete(format!("{FILES}/{file_id}")).bearer_auth(&t).send().await.map_err(|e| e.to_string())?;
    Ok(())
}

/// makes Drive hold every local snapshot of a game, and no more than the newest few
pub async fn push_game(st: &AppState, game_id: &str) -> Res<usize> {
    let key = crate::saves::key(game_id);
    let local_root = st.dir.join("saves").join(&key);
    let remote = list(st, Some(&key)).await?;
    let have: std::collections::HashSet<String> = remote.iter().map(|r| r.manifest.hash.clone()).collect();
    let mut local: Vec<(String, Manifest)> = std::fs::read_dir(&local_root)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let m: Manifest = serde_json::from_str(&std::fs::read_to_string(e.path().join("manifest.json")).ok()?).ok()?;
            Some((e.file_name().to_string_lossy().to_string(), m))
        })
        .collect();
    local.sort_by(|a, b| b.1.created.cmp(&a.1.created));
    let mut sent = 0;
    for (snap, m) in local.iter().take(KEEP) {
        if !have.contains(&m.hash) {
            upload(st, &key, snap, &local_root.join(snap)).await?;
            sent += 1;
        }
    }
    if sent > 0 {
        for r in list(st, Some(&key)).await?.into_iter().skip(KEEP) {
            let _ = delete(st, &r.file_id).await;
        }
    }
    Ok(sent)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn browser(port: u16, path: &str) -> String {
        let mut s = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
        // never wait forever on a reply in a test
        s.set_read_timeout(Some(std::time::Duration::from_secs(5))).unwrap();
        // in pieces, the way a slow connection would deliver it
        for part in ["GET ", path, " HTTP/1.1\r\n", "Host: localhost\r\n\r\n"] {
            s.write_all(part.as_bytes()).unwrap();
            s.flush().unwrap();
        }
        let mut out = String::new();
        let _ = s.read_to_string(&mut out);
        out
    }

    #[test]
    fn loopback_accepts_only_the_right_state() {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let t = std::thread::spawn(move || wait_for_code(l, "good"));
        browser(port, "/favicon.ico");
        let page = browser(port, "/?state=good&code=4%2Fabc");
        assert_eq!(t.join().unwrap().unwrap(), "4/abc");
        assert!(page.contains("Tessera bağlandı"));

        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let t = std::thread::spawn(move || wait_for_code(l, "good"));
        browser(port, "/?state=forged&code=x");
        assert!(t.join().unwrap().is_err(), "a forged state is refused");
    }

    #[test]
    fn email_in_id_token() {
        let payload = URL_SAFE_NO_PAD.encode(br#"{"email":"someone@example.com"}"#);
        assert_eq!(email_from_id_token(&format!("h.{payload}.s")).as_deref(), Some("someone@example.com"));
    }

    #[test]
    fn client_file_shapes() {
        let dir = std::env::temp_dir().join("tessera-gclient");
        let _ = std::fs::create_dir_all(&dir);
        let src = dir.join("client_secret_x.json");
        std::fs::write(&src, r#"{"installed":{"client_id":"id.apps.googleusercontent.com","client_secret":"sec"}}"#).unwrap();
        install_client(&dir, &src).unwrap();
        assert_eq!(client(&dir).unwrap().client_id, "id.apps.googleusercontent.com");
        std::fs::write(&src, r#"{"web":{"client_id":"a","client_secret":"b"}}"#).unwrap();
        assert!(install_client(&dir, &src).is_err(), "a web client is refused");
    }
}
