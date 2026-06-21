//! Connection-profile persistence and secret storage.
//!
//! Metadata is exercised against a real temp config dir; secrets run against an
//! in-memory mock keyring (so no OS keychain prompt). These cover the logic
//! behind the connection-settings commands.

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use occ_secure_exports_lib::profile::{
    self, delete_secrets, get_secrets, set_secrets, ConnectionProfile, StoredSecrets,
};

fn tmp_dir(tag: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("occ-prof-{}-{}-{}", tag, std::process::id(), nanos))
}

fn profile(id: &str, name: &str) -> ConnectionProfile {
    ConnectionProfile {
        id: id.into(),
        name: name.into(),
        endpoint: "https://s3.example.com".into(),
        region: "us-east-1".into(),
        bucket: "bucket".into(),
        access_key_id: "AKIA".into(),
        path_style: true,
        base_prefix: String::new(),
        remember_secret: true,
        remember_key: false,
    }
}

#[test]
fn profiles_and_secrets() {
    // Route secret storage to the in-memory mock store for the whole process.
    keyring::set_default_credential_builder(keyring::mock::default_credential_builder());

    let dir = tmp_dir("crud");

    // Empty to start.
    assert!(profile::load_profiles(&dir).unwrap().is_empty());

    // Insert.
    profile::upsert_profile(&dir, profile("p1", "First")).unwrap();
    let all = profile::load_profiles(&dir).unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].name, "First");
    assert_eq!(all[0].id, "p1");

    // Update in place (same id).
    profile::upsert_profile(&dir, profile("p1", "Renamed")).unwrap();
    let all = profile::load_profiles(&dir).unwrap();
    assert_eq!(all.len(), 1, "same id must update, not duplicate");
    assert_eq!(all[0].name, "Renamed");

    // Add a second.
    profile::upsert_profile(&dir, profile("p2", "Second")).unwrap();
    assert_eq!(profile::load_profiles(&dir).unwrap().len(), 2);

    // Secret API exercises cleanly (the mock keyring is per-Entry, so it can't
    // model persistence across separate Entry::new calls — real round-trips are
    // covered by the live keychain; here we assert the code paths don't error).
    set_secrets(
        "p1",
        &StoredSecrets {
            s3_secret: Some("s3-secret-value".into()),
            age_key: Some("AGE-SECRET-KEY-1XXXX".into()),
        },
    )
    .unwrap();
    get_secrets("p1").unwrap();
    // Writing an empty set clears the entry; reading a missing one is no-op.
    set_secrets("p1", &StoredSecrets::default()).unwrap();
    delete_secrets("p2").unwrap();

    // Deleting a profile removes it from the list (and clears secrets best-effort).
    profile::delete_profile(&dir, "p1").unwrap();
    let all = profile::load_profiles(&dir).unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].id, "p2");

    let _ = std::fs::remove_dir_all(&dir);
}
