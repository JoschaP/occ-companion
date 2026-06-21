//! Connection profiles and secure credential storage.
//!
//! Split by sensitivity:
//!   * Non-secret metadata (endpoint, region, bucket, access key *id*, flags)
//!     lives in a plain JSON file in the app config dir.
//!   * Secrets (the S3 *secret* access key and the private age key) live ONLY
//!     in the OS secure store via the `keyring` crate — Keychain on macOS,
//!     Credential Manager on Windows, Secret Service on Linux. They never touch
//!     the JSON file or any other plaintext on disk.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

/// Keyring service name. One entry per profile holds all of its secrets.
const KEYRING_SERVICE: &str = "de.occ-secure-exports.app";
const PROFILES_FILE: &str = "profiles.json";

/// Both secrets for a connection, stored together in a single keyring entry so
/// the OS prompts for keychain access at most once per connect. Either field
/// may be absent (the user chose not to remember it).
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredSecrets {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub s3_secret: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub age_key: Option<String>,
}

impl StoredSecrets {
    pub fn is_empty(&self) -> bool {
        self.s3_secret.is_none() && self.age_key.is_none()
    }
}

/// Legacy per-kind accounts (pre-bundling). Read once to migrate forward.
#[derive(Clone, Copy)]
enum LegacyKind {
    S3Secret,
    AgeKey,
}

impl LegacyKind {
    fn suffix(self) -> &'static str {
        match self {
            LegacyKind::S3Secret => "s3-secret",
            LegacyKind::AgeKey => "age-key",
        }
    }
}

/// A saved connection. Contains NO secrets.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionProfile {
    pub id: String,
    pub name: String,
    pub endpoint: String,
    pub region: String,
    pub bucket: String,
    pub access_key_id: String,
    #[serde(default)]
    pub path_style: bool,
    /// Optional prefix the browser starts at (e.g. a tenant base path).
    #[serde(default)]
    pub base_prefix: String,
    /// Whether the S3 secret is kept in the OS secure store.
    #[serde(default)]
    pub remember_secret: bool,
    /// Whether the private age key is kept in the OS secure store.
    #[serde(default)]
    pub remember_key: bool,
}

fn profiles_path(config_dir: &Path) -> PathBuf {
    config_dir.join(PROFILES_FILE)
}

/// Load all saved profiles. Missing file → empty list.
pub fn load_profiles(config_dir: &Path) -> AppResult<Vec<ConnectionProfile>> {
    let path = profiles_path(config_dir);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let data = std::fs::read_to_string(&path)?;
    if data.trim().is_empty() {
        return Ok(Vec::new());
    }
    let profiles: Vec<ConnectionProfile> = serde_json::from_str(&data)?;
    Ok(profiles)
}

fn write_profiles(config_dir: &Path, profiles: &[ConnectionProfile]) -> AppResult<()> {
    std::fs::create_dir_all(config_dir)?;
    let path = profiles_path(config_dir);
    let json = serde_json::to_string_pretty(profiles)?;
    // Write atomically (temp + rename) so a crash mid-write can't leave a torn
    // JSON file that wipes the user's connections on next load.
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json)?;
    std::fs::rename(&tmp, &path)?;
    Ok(())
}

/// Insert or update a profile (matched by id) and persist metadata.
pub fn upsert_profile(config_dir: &Path, profile: ConnectionProfile) -> AppResult<()> {
    let mut profiles = load_profiles(config_dir)?;
    match profiles.iter_mut().find(|p| p.id == profile.id) {
        Some(existing) => *existing = profile,
        None => profiles.push(profile),
    }
    write_profiles(config_dir, &profiles)
}

/// Remove a profile and its associated secrets.
pub fn delete_profile(config_dir: &Path, id: &str) -> AppResult<()> {
    let mut profiles = load_profiles(config_dir)?;
    profiles.retain(|p| p.id != id);
    write_profiles(config_dir, &profiles)?;
    // Best-effort secret cleanup; ignore "not found".
    let _ = delete_secrets(id);
    Ok(())
}

/// True when a keyring error means the OS secure store itself is unavailable
/// (e.g. no Secret Service / gnome-keyring running on a headless Linux box) as
/// opposed to a logic error. In that case "remember" degrades to ask-each-time
/// instead of failing the operation.
fn is_backend_unavailable(e: &keyring::Error) -> bool {
    matches!(
        e,
        keyring::Error::PlatformFailure(_) | keyring::Error::NoStorageAccess(_)
    )
}

/// Build the bundled-secrets keyring entry. Returns the raw `keyring::Error` so
/// callers can distinguish a backend outage (degrade) from a real failure —
/// `Entry::new` itself can fail with `PlatformFailure` when there is no D-Bus
/// session bus (headless Linux), *before* any get/set call.
fn creds_entry(id: &str) -> Result<keyring::Entry, keyring::Error> {
    let account = format!("{id}::creds");
    keyring::Entry::new(KEYRING_SERVICE, &account)
}

fn legacy_entry(id: &str, kind: LegacyKind) -> AppResult<keyring::Entry> {
    let account = format!("{id}::{}", kind.suffix());
    keyring::Entry::new(KEYRING_SERVICE, &account).map_err(AppError::from)
}

fn legacy_get(id: &str, kind: LegacyKind) -> Option<String> {
    legacy_entry(id, kind).ok()?.get_password().ok()
}

/// Best-effort deletion of a legacy per-kind entry; ignores any error.
fn legacy_delete(id: &str, kind: LegacyKind) {
    if let Ok(entry) = legacy_entry(id, kind) {
        let _ = entry.delete_credential();
    }
}

/// Read both secrets for a profile in a single keyring access. If only the old
/// per-kind entries exist, they are read once and migrated into the bundled
/// entry (and the old ones removed) so subsequent connects prompt only once.
pub fn get_secrets(id: &str) -> AppResult<StoredSecrets> {
    let entry = match creds_entry(id) {
        Ok(e) => e,
        // No secure store at all (e.g. no D-Bus session bus on headless Linux):
        // behave as if nothing was remembered so the UI falls back to ask-each-time.
        Err(e) if is_backend_unavailable(&e) => return Ok(StoredSecrets::default()),
        Err(e) => return Err(AppError::from(e)),
    };
    match entry.get_password() {
        // A malformed entry must not silently read as "no secrets" — that would
        // look like the user never saved them. Surface it so they re-enter.
        Ok(json) => serde_json::from_str(&json).map_err(|_| {
            AppError::Keyring("the stored credentials are corrupted; please re-enter them".into())
        }),
        Err(keyring::Error::NoEntry) => migrate_legacy(id),
        // Secure store unavailable: same graceful fallback.
        Err(e) if is_backend_unavailable(&e) => Ok(StoredSecrets::default()),
        Err(e) => Err(AppError::from(e)),
    }
}

fn migrate_legacy(id: &str) -> AppResult<StoredSecrets> {
    let secrets = StoredSecrets {
        s3_secret: legacy_get(id, LegacyKind::S3Secret),
        age_key: legacy_get(id, LegacyKind::AgeKey),
    };
    if !secrets.is_empty() {
        // Best-effort: bundle forward, then drop the old entries.
        let _ = set_secrets(id, &secrets);
        legacy_delete(id, LegacyKind::S3Secret);
        legacy_delete(id, LegacyKind::AgeKey);
    }
    Ok(secrets)
}

/// Store both secrets in a single keyring entry. Writing an empty set deletes
/// the entry instead. Returns `false` when the OS secure store is unavailable
/// (e.g. no Secret Service running on Linux) so nothing could be stored — the
/// caller should fall back to ask-each-time; any other failure propagates.
pub fn set_secrets(id: &str, secrets: &StoredSecrets) -> AppResult<bool> {
    if secrets.is_empty() {
        delete_secrets(id)?;
        return Ok(true);
    }
    let json = serde_json::to_string(secrets)?;
    let entry = match creds_entry(id) {
        Ok(e) => e,
        Err(e) if is_backend_unavailable(&e) => return Ok(false),
        Err(e) => return Err(AppError::from(e)),
    };
    match entry.set_password(&json) {
        Ok(()) => Ok(true),
        Err(e) if is_backend_unavailable(&e) => Ok(false),
        Err(e) => Err(AppError::from(e)),
    }
}

/// Delete a profile's bundled (and any leftover legacy) secrets. A missing
/// entry or an unavailable secure store is treated as already-clean.
pub fn delete_secrets(id: &str) -> AppResult<()> {
    match creds_entry(id) {
        Ok(entry) => match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) if is_backend_unavailable(&e) => {}
            Err(e) => return Err(AppError::from(e)),
        },
        // No store to delete from → already clean.
        Err(e) if is_backend_unavailable(&e) => {}
        Err(e) => return Err(AppError::from(e)),
    }
    legacy_delete(id, LegacyKind::S3Secret);
    legacy_delete(id, LegacyKind::AgeKey);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn boxed() -> Box<dyn std::error::Error + Send + Sync> {
        Box::from("backend down")
    }

    #[test]
    fn backend_unavailable_only_for_store_outages() {
        // A missing daemon / no access surfaces as these — degrade gracefully.
        assert!(is_backend_unavailable(&keyring::Error::PlatformFailure(
            boxed()
        )));
        assert!(is_backend_unavailable(&keyring::Error::NoStorageAccess(
            boxed()
        )));
        // Logic errors must NOT be swallowed as "no store".
        assert!(!is_backend_unavailable(&keyring::Error::NoEntry));
        assert!(!is_backend_unavailable(&keyring::Error::BadEncoding(vec![
            0xff
        ])));
    }
}
