//! Tauri command surface — the only bridge between the WebView and the core.
//!
//! All secret material is resolved here and kept in process memory (the active
//! `Session`); it is never sent back to the frontend.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use aws_sdk_s3::Client;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::crypto::{self, Identity};
use crate::download;
use crate::error::{AppError, AppResult};
use crate::profile::{self, ConnectionProfile, StoredSecrets};
use crate::s3::{self, ObjectInfo};

/// In-memory session for the connected bucket. Holds secrets; never serialized.
pub struct Session {
    client: Client,
    bucket: String,
    base_prefix: String,
    identities: Arc<Vec<Identity>>,
}

#[derive(Default)]
pub struct AppState {
    session: tokio::sync::Mutex<Option<Session>>,
}

// ---- DTOs -----------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyPairDto {
    public_key: String,
    private_key: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretStatus {
    has_secret: bool,
    has_key: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectResult {
    bucket: String,
    base_prefix: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Credentials {
    secret_access_key: Option<String>,
    age_key: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent {
    key: String,
    done: u64,
    total: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileResult {
    key: String,
    ok: bool,
    error: Option<String>,
    path: Option<String>,
    bytes: u64,
}

/// One file to download. `rel_path` is the destination path relative to the
/// chosen folder (folder structure to preserve), with `.age` already stripped
/// from the final segment by the frontend. The backend sanitizes it against
/// path traversal regardless (see `download::safe_dest_path`).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadItem {
    pub key: String,
    pub rel_path: String,
}

// ---- helpers --------------------------------------------------------------

fn config_dir(app: &AppHandle) -> AppResult<PathBuf> {
    app.path()
        .app_config_dir()
        .map_err(|e| AppError::Config(format!("Could not locate the config directory: {e}")))
}

/// Resolve the S3 secret and age key for a profile from the given overrides or
/// the OS secure store, then parse the key into identities.
async fn resolve_credentials(
    profile: &ConnectionProfile,
    creds: &Credentials,
) -> AppResult<(String, Vec<Identity>)> {
    // Read any stored secrets once (single keychain access). Inline overrides
    // from the form take precedence and avoid the read entirely when both are
    // supplied.
    let needs_store = creds.secret_access_key.as_deref().unwrap_or("").is_empty()
        || creds.age_key.as_deref().unwrap_or("").is_empty();
    let stored = if needs_store {
        profile::get_secrets(&profile.id)?
    } else {
        StoredSecrets::default()
    };

    let secret = match &creds.secret_access_key {
        Some(s) if !s.is_empty() => s.clone(),
        _ => stored
            .s3_secret
            .ok_or_else(|| AppError::Config("No secret access key available.".into()))?,
    };

    let key_material = match &creds.age_key {
        Some(k) if !k.is_empty() => k.clone(),
        _ => stored
            .age_key
            .ok_or_else(|| AppError::Key("No private key available.".into()))?,
    };

    let identities = crypto::parse_identities(&key_material)?;
    Ok((secret, identities))
}

// ---- commands -------------------------------------------------------------

/// Generate a fresh age key pair. The private key is returned once for the user
/// to save; it is not persisted by this call.
#[tauri::command]
pub fn generate_keypair() -> KeyPairDto {
    let kp = crypto::generate_keypair();
    KeyPairDto {
        public_key: kp.public_key,
        private_key: kp.private_key,
    }
}

/// Write secret material so it is owner-only **from creation** — on unix the
/// file is opened with mode 0600 (no world-readable window between create and
/// chmod), and existing-file permissions are tightened too. Errors propagate so
/// a failed chmod never silently leaves a key world-readable. On Windows the
/// file inherits the user-profile ACL (owner-only by default).
fn write_secret_file(path: &std::path::Path, contents: &str) -> AppResult<()> {
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(path)?;
        f.set_permissions(std::fs::Permissions::from_mode(0o600))?;
        f.write_all(contents.as_bytes())?;
        f.sync_all()?;
        Ok(())
    }
    #[cfg(not(unix))]
    {
        std::fs::write(path, contents.as_bytes())?;
        Ok(())
    }
}

/// Write text to a user-chosen path. For secret material (`restrict = true`)
/// the file is created owner-only (see `write_secret_file`). The path comes
/// from the native save dialog, so the user authorizes the location.
#[tauri::command]
pub fn save_text_file(path: String, contents: String, restrict: bool) -> AppResult<()> {
    let path = PathBuf::from(path);
    if restrict {
        write_secret_file(&path, &contents)
    } else {
        std::fs::write(&path, contents.as_bytes())?;
        Ok(())
    }
}

#[tauri::command]
pub fn list_profiles(app: AppHandle) -> AppResult<Vec<ConnectionProfile>> {
    profile::load_profiles(&config_dir(&app)?)
}

/// Save profile metadata and, per the remember flags, store or clear secrets.
#[tauri::command]
pub fn save_profile(
    app: AppHandle,
    profile: ConnectionProfile,
    creds: Credentials,
) -> AppResult<()> {
    let dir = config_dir(&app)?;

    let new_secret = creds.secret_access_key.as_deref().filter(|s| !s.is_empty());
    let new_key = creds.age_key.as_deref().filter(|s| !s.is_empty());

    // Only read the existing bundle when a remembered field was left blank (an
    // edit that keeps the stored value) — a fresh save avoids the keychain read.
    let keep_secret = profile.remember_secret && new_secret.is_none();
    let keep_key = profile.remember_key && new_key.is_none();
    let mut stored = if keep_secret || keep_key {
        profile::get_secrets(&profile.id)?
    } else {
        StoredSecrets::default()
    };

    stored.s3_secret = if profile.remember_secret {
        new_secret.map(str::to_string).or(stored.s3_secret)
    } else {
        None
    };
    stored.age_key = if profile.remember_key {
        new_key.map(str::to_string).or(stored.age_key)
    } else {
        None
    };

    profile::set_secrets(&profile.id, &stored)?;
    profile::upsert_profile(&dir, profile)
}

#[tauri::command]
pub fn delete_profile(app: AppHandle, id: String) -> AppResult<()> {
    profile::delete_profile(&config_dir(&app)?, &id)
}

/// The age public key for a saved connection, derived from its stored private
/// key. `None` if no key is stored or it is not a native age key.
#[tauri::command]
pub fn profile_public_key(id: String) -> AppResult<Option<String>> {
    match profile::get_secrets(&id)?.age_key {
        Some(material) => Ok(crypto::public_key_for(&material)),
        None => Ok(None),
    }
}

/// Re-export a Rescue Kit for a saved connection whose key is stored. Writes the
/// kit to `path` with owner-only permissions. The private key never travels to
/// the frontend on this path.
#[tauri::command]
pub fn export_rescue_kit(id: String, path: String) -> AppResult<()> {
    let material = profile::get_secrets(&id)?
        .age_key
        .ok_or_else(|| AppError::Key("No private key is stored for this connection.".into()))?;
    let public = crypto::public_key_for(&material);
    let kit = rescue_kit_text(public.as_deref(), &material);

    write_secret_file(&PathBuf::from(path), &kit)
}

/// A human-readable recovery document; for age keys it is also a valid age
/// identity file (every non-key line is a `#` comment).
fn rescue_kit_text(public: Option<&str>, private: &str) -> String {
    let pub_line = match public {
        Some(p) => format!("#     {p}"),
        None => "#     (SSH key — your public key is your matching SSH public key)".to_string(),
    };
    format!(
        "# ============================================================\n\
         #   OCC Secure Exports — Key Rescue Kit\n\
         # ============================================================\n\
         #   This file is the ONLY way to decrypt your OCC data exports.\n\
         #   Keep it safe and private. It is never sent anywhere.\n\
         #\n\
         #   PUBLIC KEY — give this to the OCC so it can encrypt for you:\n\
         {pub_line}\n\
         #\n\
         #   PRIVATE KEY — your secret (below). If you lose it, your\n\
         #   exports can NEVER be recovered.\n\
         #\n\
         #   To restore: open OCC Secure Exports, add a connection, and paste\n\
         #   the private key into the \"Private key\" field. Or decrypt with:\n\
         #     age -d -i occ-secure-exports-rescue-kit.txt export.json.age > export.json\n\
         # ============================================================\n\
         \n\
         {private}\n"
    )
}

/// Report whether secrets are present in the secure store for a profile, so the
/// UI knows whether it must prompt for them.
#[tauri::command]
pub fn secret_status(id: String) -> AppResult<SecretStatus> {
    let stored = profile::get_secrets(&id)?;
    Ok(SecretStatus {
        has_secret: stored.s3_secret.is_some(),
        has_key: stored.age_key.is_some(),
    })
}

/// Open a connection: resolve credentials, build the client, validate by a
/// 1-object probe, and store the session.
#[tauri::command]
pub async fn connect(
    state: State<'_, AppState>,
    profile: ConnectionProfile,
    creds: Credentials,
) -> AppResult<ConnectResult> {
    let (secret, identities) = resolve_credentials(&profile, &creds).await?;
    let client = s3::build_client(&profile, &secret).await?;

    // Validate credentials/endpoint up front with a cheap request.
    client
        .list_objects_v2()
        .bucket(&profile.bucket)
        .max_keys(1)
        .set_prefix(if profile.base_prefix.is_empty() {
            None
        } else {
            Some(profile.base_prefix.clone())
        })
        .send()
        .await
        .map_err(|e| AppError::S3(s3::friendly_s3(&e)))?;

    let result = ConnectResult {
        bucket: profile.bucket.clone(),
        base_prefix: profile.base_prefix.clone(),
    };

    *state.session.lock().await = Some(Session {
        client,
        bucket: profile.bucket,
        base_prefix: profile.base_prefix,
        identities: Arc::new(identities),
    });

    Ok(result)
}

/// Per-object outcome of the key pre-check.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum KeyMatch {
    /// `.age` file the connected key can decrypt.
    Match,
    /// `.age` file encrypted for a different key.
    Mismatch,
    /// Not an `.age` file — downloads as-is.
    Plain,
    /// Could not be determined (unreadable header, fetch error).
    Unknown,
}

/// One object's key-check result. Returned per object so the frontend can
/// cache outcomes per key (a header never changes within a listing).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyCheck {
    pub key: String,
    pub status: KeyMatch,
}

/// Pre-flight: for the selected keys, check (via a small header range request)
/// whether the connected key can decrypt each `.age` object. Non-age objects
/// come back as `plain`. Range requests run concurrently (bounded) so a large
/// selection doesn't block on dozens of sequential round-trips.
#[tauri::command]
pub async fn check_keys(state: State<'_, AppState>, keys: Vec<String>) -> AppResult<Vec<KeyCheck>> {
    use futures::stream::StreamExt;

    let (client, bucket, identities) = {
        let guard = state.session.lock().await;
        let session = guard.as_ref().ok_or(AppError::NotConnected)?;
        (
            session.client.clone(),
            session.bucket.clone(),
            session.identities.clone(),
        )
    };

    let out = futures::stream::iter(keys)
        .map(|key| {
            let client = client.clone();
            let bucket = bucket.clone();
            let identities = identities.clone();
            async move {
                let status = if !key.to_ascii_lowercase().ends_with(".age") {
                    KeyMatch::Plain
                } else {
                    match s3::fetch_prefix(&client, &bucket, &key, 65535).await {
                        Ok(bytes) => match crypto::matches_key(&bytes, &identities) {
                            Some(true) => KeyMatch::Match,
                            Some(false) => KeyMatch::Mismatch,
                            None => KeyMatch::Unknown,
                        },
                        Err(_) => KeyMatch::Unknown,
                    }
                };
                KeyCheck { key, status }
            }
        })
        .buffer_unordered(8)
        .collect::<Vec<_>>()
        .await;

    Ok(out)
}

#[tauri::command]
pub async fn list_objects(
    state: State<'_, AppState>,
    prefix: Option<String>,
) -> AppResult<Vec<ObjectInfo>> {
    let guard = state.session.lock().await;
    let session = guard.as_ref().ok_or(AppError::NotConnected)?;
    let prefix = prefix.unwrap_or_else(|| session.base_prefix.clone());
    s3::list_objects(&session.client, &session.bucket, &prefix).await
}

#[tauri::command]
pub async fn disconnect(state: State<'_, AppState>) -> AppResult<()> {
    *state.session.lock().await = None;
    Ok(())
}

const RELEASES_URL: &str = "https://github.com/JoschaP/occ-secure-exports/releases";

/// Result of the update check.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current: String,
    pub latest: String,
    pub update_available: bool,
    pub url: String,
}

/// Check the GitHub releases API for a newer version. This is the *only*
/// outbound connection besides the configured S3 endpoint. It runs in the core
/// (the WebView CSP forbids network egress), and fails soft: any error returns
/// `update_available: false` so an offline machine is never disrupted.
#[tauri::command]
pub async fn check_update(app: AppHandle) -> AppResult<UpdateInfo> {
    let current = app.package_info().version.to_string();
    let fallback = UpdateInfo {
        current: current.clone(),
        latest: current.clone(),
        update_available: false,
        url: RELEASES_URL.to_string(),
    };

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
    {
        Ok(c) => c,
        Err(_) => return Ok(fallback),
    };

    let resp = client
        .get("https://api.github.com/repos/JoschaP/occ-secure-exports/releases/latest")
        .header("User-Agent", "occ-secure-exports")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await;
    let resp = match resp {
        Ok(r) if r.status().is_success() => r,
        _ => return Ok(fallback),
    };
    let json: serde_json::Value = match resp.json().await {
        Ok(j) => j,
        Err(_) => return Ok(fallback),
    };

    Ok(parse_update(&json, &current))
}

/// Decide the update outcome from a GitHub releases JSON payload. Pure (no I/O)
/// so it can be unit-tested; falls back to "no update" when the payload lacks a
/// usable tag.
fn parse_update(json: &serde_json::Value, current: &str) -> UpdateInfo {
    let fallback = UpdateInfo {
        current: current.to_string(),
        latest: current.to_string(),
        update_available: false,
        url: RELEASES_URL.to_string(),
    };
    let latest = json["tag_name"]
        .as_str()
        .unwrap_or("")
        .trim_start_matches('v')
        .to_string();
    if latest.is_empty() {
        return fallback;
    }
    let url = json["html_url"]
        .as_str()
        .unwrap_or(RELEASES_URL)
        .to_string();
    UpdateInfo {
        current: current.to_string(),
        update_available: version_gt(&latest, current),
        latest,
        url,
    }
}

/// True if semver `a` (major.minor.patch) is strictly newer than `b`. A
/// pre-release suffix (`-beta.1`) is stripped before comparing, and missing or
/// non-numeric parts are treated as 0 — good enough for our `x.y.z` tags.
fn version_gt(a: &str, b: &str) -> bool {
    let parse = |s: &str| -> [u64; 3] {
        let core = s.split('-').next().unwrap_or(s);
        let mut out = [0u64; 3];
        for (i, part) in core.split('.').take(3).enumerate() {
            out[i] = part.trim().parse().unwrap_or(0);
        }
        out
    };
    parse(a) > parse(b)
}

/// Download and decrypt the selected keys into `dest_dir`. Emits
/// `download://progress` per chunk (throttled) and returns a per-file summary.
#[tauri::command]
pub async fn download_decrypt(
    app: AppHandle,
    state: State<'_, AppState>,
    items: Vec<DownloadItem>,
    dest_dir: String,
) -> AppResult<Vec<FileResult>> {
    let (client, bucket, identities) = {
        let guard = state.session.lock().await;
        let session = guard.as_ref().ok_or(AppError::NotConnected)?;
        (
            session.client.clone(),
            session.bucket.clone(),
            session.identities.clone(),
        )
    };

    let dest = PathBuf::from(dest_dir);
    let mut results = Vec::with_capacity(items.len());

    for item in items {
        let DownloadItem { key, rel_path } = item;
        let dest_path = download::safe_dest_path(&dest, &rel_path);
        let progress = progress_emitter(app.clone(), key.clone());

        let outcome = download::download_and_decrypt(
            &client,
            &bucket,
            &key,
            &dest_path,
            identities.clone(),
            progress,
        )
        .await;

        let result = match outcome {
            Ok(bytes) => FileResult {
                key,
                ok: true,
                error: None,
                path: Some(dest_path.to_string_lossy().to_string()),
                bytes,
            },
            Err(e) => FileResult {
                key,
                ok: false,
                error: Some(e.to_string()),
                path: None,
                bytes: 0,
            },
        };
        let _ = app.emit("download://file", result.clone());
        results.push(result);
    }

    Ok(results)
}

/// Build a throttled progress callback (emits at most ~ every 512 KiB).
fn progress_emitter(app: AppHandle, key: String) -> impl Fn(u64, u64) + Send + 'static {
    let last = Arc::new(AtomicU64::new(0));
    move |done: u64, total: u64| {
        let prev = last.load(Ordering::Relaxed);
        if done == total || done.saturating_sub(prev) >= 512 * 1024 {
            last.store(done, Ordering::Relaxed);
            let _ = app.emit(
                "download://progress",
                ProgressEvent {
                    key: key.clone(),
                    done,
                    total,
                },
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_update, version_gt};

    #[test]
    fn version_gt_compares_semver() {
        assert!(version_gt("0.7.0", "0.6.0"));
        assert!(version_gt("1.0.0", "0.9.9"));
        assert!(version_gt("0.6.1", "0.6.0"));
        assert!(!version_gt("0.6.0", "0.6.0"));
        assert!(!version_gt("0.6.0", "0.7.0"));
        assert!(!version_gt("0.5.9", "0.6.0"));
        // Missing/odd parts default to 0.
        assert!(version_gt("0.6", "0.5.9"));
        assert!(!version_gt("garbage", "0.1.0"));
        // Pre-release suffix is stripped before comparing.
        assert!(!version_gt("1.0.0-beta.1", "1.0.0"));
        assert!(version_gt("1.0.1-beta.1", "1.0.0"));
    }

    #[test]
    fn parse_update_reads_tag_and_decides() {
        let json = serde_json::json!({
            "tag_name": "v0.9.0",
            "html_url": "https://github.com/JoschaP/occ-secure-exports/releases/tag/v0.9.0"
        });
        let info = parse_update(&json, "0.8.0");
        assert_eq!(info.latest, "0.9.0"); // 'v' stripped
        assert!(info.update_available);
        assert!(info.url.ends_with("v0.9.0"));

        // Same version → no update.
        assert!(!parse_update(&json, "0.9.0").update_available);
    }

    #[test]
    fn parse_update_falls_back_when_payload_is_unusable() {
        // Missing tag → no update, releases URL.
        let info = parse_update(&serde_json::json!({}), "0.8.0");
        assert!(!info.update_available);
        assert_eq!(info.latest, "0.8.0");
        assert!(info.url.contains("/releases"));

        // Tag present but no html_url → still works, falls back to releases URL.
        let info = parse_update(&serde_json::json!({ "tag_name": "v1.0.0" }), "0.8.0");
        assert!(info.update_available);
        assert!(info.url.contains("/releases"));
    }
}
