# Security Policy

OCC Secure Exports handles a private decryption key, so security is the product's
core promise. Thank you for helping keep it trustworthy.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately via GitHub Security Advisories:
<https://github.com/JoschaP/occ-secure-exports/security/advisories/new>

Include what you found, how to reproduce it, and the impact. We aim to
acknowledge within a few days and to coordinate a fix and disclosure with you.

When reporting, **never include your private key, secret access key, or any
decrypted data** — they are never required to demonstrate an issue.

## Supported versions

The latest released version receives security fixes. Releases follow semantic
versioning; security fixes ship as patch releases.

## Security model (what we guarantee)

- **The private key never leaves the device.** No telemetry, no analytics, no
  phone-home. The only outbound connections are to the user-configured S3
  endpoint and a version check against the GitHub releases API; both run in the
  Rust core, never the WebView.
- **The WebView cannot reach the network.** A strict Content-Security-Policy
  (`default-src 'self'`) confines the UI; all S3 traffic runs in the Rust core,
  so key material in the UI cannot be exfiltrated by a frontend request.
- **Secrets live in the OS secure store** (Keychain / Credential Manager /
  Secret Service), not in plaintext on disk, and only when the user opts in. The
  sole exception is the optional **Rescue Kit**, a plaintext key file the user
  explicitly chooses to save; it is never sent anywhere.
- **Streaming, fail-closed decryption.** Files are decrypted to a temp file,
  verified, then atomically renamed; on any error the temp file is removed, so
  no partial or plaintext output is ever left behind.
- **Output paths are sanitized** so a crafted object key cannot escape the
  chosen download folder.

These properties are why the app is open source: they are meant to be audited.
Relevant code: `src-tauri/src/crypto.rs`, `download.rs`, `s3.rs`.
