//! End-to-end tests against a real S3/MinIO bucket.
//!
//! These exercise the full core path: build a client, encrypt a payload for an
//! age key, upload it, list it, then stream-download-and-decrypt it back and
//! verify the plaintext — plus the fail-closed behaviour on a wrong key.
//!
//! Credentials come from `.env.test` at the repo root (gitignored). If that
//! file or its required keys are missing, the tests SKIP (so CI stays green
//! without secrets). Run locally with:
//!
//! ```sh
//! cargo test --test e2e -- --nocapture
//! ```

use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use aws_sdk_s3::primitives::ByteStream;
use aws_sdk_s3::Client;

use occ_companion_lib::crypto::{self, generate_keypair};
use occ_companion_lib::download::{self, plaintext_file_name};
use occ_companion_lib::profile::ConnectionProfile;
use occ_companion_lib::s3;

/// Parse a minimal `.env`-style file (`KEY=value`, optional surrounding quotes).
fn load_env() -> Option<HashMap<String, String>> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.env.test");
    let contents = std::fs::read_to_string(path).ok()?;
    let mut map = HashMap::new();
    for line in contents.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            let v = v.trim().trim_matches('"').trim_matches('\'');
            map.insert(k.trim().to_string(), v.to_string());
        }
    }
    Some(map)
}

/// Build a test profile + secret from the env, or `None` to signal "skip".
fn test_profile() -> Option<(ConnectionProfile, String)> {
    let env = load_env()?;
    let get = |k: &str| env.get(k).filter(|s| !s.is_empty()).cloned();

    let profile = ConnectionProfile {
        id: "e2e-test".into(),
        name: "e2e".into(),
        endpoint: get("OCC_TEST_ENDPOINT")?,
        region: get("OCC_TEST_REGION").unwrap_or_else(|| "us-east-1".into()),
        bucket: get("OCC_TEST_BUCKET")?,
        access_key_id: get("OCC_TEST_ACCESS_KEY_ID")?,
        path_style: get("OCC_TEST_PATH_STYLE")
            .map(|v| v == "true")
            .unwrap_or(true),
        base_prefix: String::new(),
        remember_secret: false,
        remember_key: false,
    };
    let secret = get("OCC_TEST_SECRET_ACCESS_KEY")?;
    Some((profile, secret))
}

/// Encrypt `plaintext` for an age public key (the e2e counterpart to the app's
/// decryption).
fn encrypt_for(public_key: &str, plaintext: &[u8]) -> Vec<u8> {
    let recipient: age::x25519::Recipient = public_key.parse().expect("valid public key");
    let encryptor =
        age::Encryptor::with_recipients(std::iter::once(&recipient as &dyn age::Recipient))
            .expect("encryptor");
    let mut out = Vec::new();
    let mut writer = encryptor.wrap_output(&mut out).unwrap();
    writer.write_all(plaintext).unwrap();
    writer.finish().unwrap();
    out
}

fn unique_key(label: &str) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("tests/e2e/{}-{}-{}.json.age", label, std::process::id(), nanos)
}

async fn put_object(client: &Client, bucket: &str, key: &str, body: Vec<u8>) {
    client
        .put_object()
        .bucket(bucket)
        .key(key)
        .body(ByteStream::from(body))
        .send()
        .await
        .expect("put_object");
}

async fn delete_object(client: &Client, bucket: &str, key: &str) {
    let _ = client.delete_object().bucket(bucket).key(key).send().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn e2e_upload_list_download_decrypt() {
    let Some((profile, secret)) = test_profile() else {
        eprintln!("SKIP e2e_upload_list_download_decrypt: .env.test not configured");
        return;
    };

    let client = s3::build_client(&profile, &secret)
        .await
        .expect("build client");

    let kp = generate_keypair();
    let plaintext = b"{\"event\":\"log-export\",\"rows\":3,\"note\":\"e2e roundtrip\"}";
    let key = unique_key("roundtrip");
    let ciphertext = encrypt_for(&kp.public_key, plaintext);

    put_object(&client, &profile.bucket, &key, ciphertext.clone()).await;

    // List: the object must appear with its ciphertext size.
    let objects = s3::list_objects(&client, &profile.bucket, "tests/e2e/")
        .await
        .expect("list");
    let listed = objects
        .iter()
        .find(|o| o.key == key)
        .expect("uploaded object must be listed");
    assert_eq!(listed.size, ciphertext.len() as u64, "listed size mismatch");

    // Download + decrypt into a temp dir; the `.age` suffix must be stripped.
    let dir = std::env::temp_dir().join(format!("occ-e2e-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let out_name = plaintext_file_name(&key);
    assert!(!out_name.ends_with(".age"), "extension must be stripped");
    let dest = dir.join(&out_name);

    let identities = Arc::new(crypto::parse_identities(&kp.private_key).unwrap());
    let written = download::download_and_decrypt(
        &client,
        &profile.bucket,
        &key,
        &dest,
        identities,
        |_, _| {},
    )
    .await
    .expect("download & decrypt");

    let decrypted = std::fs::read(&dest).expect("output file exists");
    assert_eq!(decrypted, plaintext, "decrypted content must match original");
    assert_eq!(written, plaintext.len() as u64);

    // Cleanup.
    let _ = std::fs::remove_dir_all(&dir);
    delete_object(&client, &profile.bucket, &key).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn e2e_wrong_credentials_gives_clear_message() {
    let Some((profile, _)) = test_profile() else {
        eprintln!("SKIP e2e_wrong_credentials_gives_clear_message: .env.test not configured");
        return;
    };

    // Right endpoint/bucket, wrong secret → must surface a clear access error,
    // not a raw SDK dump.
    let client = s3::build_client(&profile, "this-is-not-the-real-secret")
        .await
        .expect("build client");
    let err = s3::list_objects(&client, &profile.bucket, "")
        .await
        .expect_err("wrong credentials must fail");

    let msg = err.to_string().to_lowercase();
    assert!(
        msg.contains("access denied") || msg.contains("access key"),
        "expected a clear credentials message, got: {msg}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn e2e_wrong_key_is_fail_closed() {
    let Some((profile, secret)) = test_profile() else {
        eprintln!("SKIP e2e_wrong_key_is_fail_closed: .env.test not configured");
        return;
    };

    let client = s3::build_client(&profile, &secret)
        .await
        .expect("build client");

    let alice = generate_keypair();
    let bob = generate_keypair();
    let key = unique_key("wrongkey");
    let ciphertext = encrypt_for(&alice.public_key, b"only alice may read this");
    put_object(&client, &profile.bucket, &key, ciphertext).await;

    let dir = std::env::temp_dir().join(format!("occ-e2e-wrong-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let dest = dir.join(plaintext_file_name(&key));

    // Decrypt with Bob's key — must fail AND leave no output file behind.
    let bob_ids = Arc::new(crypto::parse_identities(&bob.private_key).unwrap());
    let result = download::download_and_decrypt(
        &client,
        &profile.bucket,
        &key,
        &dest,
        bob_ids,
        |_, _| {},
    )
    .await;

    assert!(result.is_err(), "wrong key must fail");
    assert!(
        !dest.exists(),
        "fail-closed: no plaintext file may be left on a failed decrypt"
    );

    let _ = std::fs::remove_dir_all(&dir);
    delete_object(&client, &profile.bucket, &key).await;
}
