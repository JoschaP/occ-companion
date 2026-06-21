//! Tauri command surface — the only bridge between the WebView and the core.
//!
//! All secret material is resolved here and kept in process memory (the active
//! `Session`); it is never sent back to the frontend.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use aws_sdk_s3::Client;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::crypto::{self, Identity};
use crate::download;
use crate::error::{AppError, AppResult};
use crate::profile::{self, ConnectionProfile, SecretKind};
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
    let secret = match &creds.secret_access_key {
        Some(s) if !s.is_empty() => s.clone(),
        _ => profile::get_secret(&profile.id, SecretKind::S3Secret)?
            .ok_or_else(|| AppError::Config("No secret access key available.".into()))?,
    };

    let key_material = match &creds.age_key {
        Some(k) if !k.is_empty() => k.clone(),
        _ => profile::get_secret(&profile.id, SecretKind::AgeKey)?
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

/// Write text to a user-chosen path. For secret material (`restrict = true`)
/// the file is created with owner-only permissions (0600) on unix. The path
/// comes from the native save dialog, so the user authorizes the location.
#[tauri::command]
pub fn save_text_file(path: String, contents: String, restrict: bool) -> AppResult<()> {
    let path = PathBuf::from(path);
    std::fs::write(&path, contents.as_bytes())?;
    #[cfg(unix)]
    if restrict {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
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

    if profile.remember_secret {
        if let Some(secret) = creds.secret_access_key.as_deref().filter(|s| !s.is_empty()) {
            profile::set_secret(&profile.id, SecretKind::S3Secret, secret)?;
        }
    } else {
        profile::delete_secret(&profile.id, SecretKind::S3Secret)?;
    }

    if profile.remember_key {
        if let Some(key) = creds.age_key.as_deref().filter(|s| !s.is_empty()) {
            profile::set_secret(&profile.id, SecretKind::AgeKey, key)?;
        }
    } else {
        profile::delete_secret(&profile.id, SecretKind::AgeKey)?;
    }

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
    match profile::get_secret(&id, SecretKind::AgeKey)? {
        Some(material) => Ok(crypto::public_key_for(&material)),
        None => Ok(None),
    }
}

/// Re-export a Rescue Kit for a saved connection whose key is stored. Writes the
/// kit to `path` with owner-only permissions. The private key never travels to
/// the frontend on this path.
#[tauri::command]
pub fn export_rescue_kit(id: String, path: String) -> AppResult<()> {
    let material = profile::get_secret(&id, SecretKind::AgeKey)?
        .ok_or_else(|| AppError::Key("No private key is stored for this connection.".into()))?;
    let public = crypto::public_key_for(&material);
    let kit = rescue_kit_text(public.as_deref(), &material);

    let path = PathBuf::from(path);
    std::fs::write(&path, kit.as_bytes())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
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
         #   OCC Companion — Key Rescue Kit\n\
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
         #   To restore: open OCC Companion, add a connection, and paste\n\
         #   the private key into the \"Private key\" field. Or decrypt with:\n\
         #     age -d -i occ-companion-rescue-kit.txt export.json.age > export.json\n\
         # ============================================================\n\
         \n\
         {private}\n"
    )
}

/// Report whether secrets are present in the secure store for a profile, so the
/// UI knows whether it must prompt for them.
#[tauri::command]
pub fn secret_status(id: String) -> AppResult<SecretStatus> {
    Ok(SecretStatus {
        has_secret: profile::get_secret(&id, SecretKind::S3Secret)?.is_some(),
        has_key: profile::get_secret(&id, SecretKind::AgeKey)?.is_some(),
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
/// whether the connected key can decrypt each `.age` object. Returns one entry
/// per input key, in order; non-age objects come back as `plain`.
#[tauri::command]
pub async fn check_keys(state: State<'_, AppState>, keys: Vec<String>) -> AppResult<Vec<KeyCheck>> {
    let (client, bucket, identities) = {
        let guard = state.session.lock().await;
        let session = guard.as_ref().ok_or(AppError::NotConnected)?;
        (
            session.client.clone(),
            session.bucket.clone(),
            session.identities.clone(),
        )
    };

    let mut out = Vec::with_capacity(keys.len());
    for key in keys {
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
        out.push(KeyCheck { key, status });
    }
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

/// Download and decrypt the selected keys into `dest_dir`. Emits
/// `download://progress` per chunk (throttled) and returns a per-file summary.
#[tauri::command]
pub async fn download_decrypt(
    app: AppHandle,
    state: State<'_, AppState>,
    keys: Vec<String>,
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
    let mut results = Vec::with_capacity(keys.len());

    for key in keys {
        let dest_path = dest.join(download::plaintext_file_name(&key));
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
