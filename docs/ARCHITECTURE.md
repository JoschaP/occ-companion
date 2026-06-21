# Architecture

OCC Secure Exports is a [Tauri 2](https://tauri.app) desktop app. It has two
parts separated by a hard trust boundary:

- a **WebView frontend** (React + TypeScript + Mantine) that renders the UI, and
- a **Rust core** that does all networking (S3) and all cryptography (`age`).

Everything sensitive — the private key, the S3 secret, the decryption — lives in
the Rust core. The frontend is treated as the *less* trusted half and is
deliberately fenced off from the network.

```
┌─────────────────────────── Tauri app process ───────────────────────────┐
│                                                                          │
│   WebView (frontend)                    Rust core (backend)              │
│   ────────────────────                  ──────────────────────           │
│   React UI, Mantine            invoke   commands.rs  ── Session ─┐        │
│   Explorer / forms        ───────────▶  (the only bridge)        │        │
│   api.ts (typed bridge)   ◀───────────                           │        │
│                             results     crypto.rs   s3.rs   download.rs   │
│   CSP: default-src 'self'               │           │       │            │
│   (no network egress)                   │           │       │            │
└─────────────────────────────────────────┼───────────┼───────┼────────────┘
                                           │           │       │
                            OS secure store│   S3 (HTTPS)│      │ local disk
                          (Keychain / etc.)▼           ▼       ▼
```

## Trust boundary

The WebView can only talk to the core through the **Tauri command surface**
(`src-tauri/src/commands.rs`), exposed to the frontend as typed wrappers in
[`src/api.ts`](../src/api.ts). It has **no other capabilities**:

- A strict Content-Security-Policy (`default-src 'self'`, set in
  [`tauri.conf.json`](../src-tauri/tauri.conf.json)) means the WebView cannot
  open any network connection. Even a hostile script injected into the frontend
  (e.g. via a compromised npm dependency) **cannot exfiltrate** the key, because
  the only way out of the WebView is an `invoke()` to the core, and the core
  never forwards key material anywhere except the configured S3 endpoint and the
  OS secure store.
- All S3 traffic and all `age` operations run in Rust. The private key, once
  parsed, is held as `age::Identity` values inside the in-memory `Session` and is
  **never serialized back to the frontend**.
- The only outbound connections are the configured **S3 endpoint** and a
  **version check** against the GitHub releases API (`check_update`) — both in
  the core. The update check fails soft (offline → "no update") and sends
  nothing but the request.

## Components

### Frontend (`src/`)

| File | Responsibility |
| --- | --- |
| `App.tsx` | Orchestrator: view state (list / form / explorer), download progress modal, idle auto-disconnect wiring |
| `components/Explorer.tsx` | Bucket tree, multi-select, key pre-check, download trigger, status bar |
| `components/ConnectionForm.tsx` | Add/edit a connection; key entry / generation |
| `components/KeygenDialog.tsx` | Generate a key pair; enforce Rescue Kit download |
| `hooks/useIdleDisconnect.ts` | Drop the session after inactivity (pauses while a download runs) |
| `lib/tree.ts` | `buildTree` (keys → folder tree), `buildDownloadPlan` (selection → per-file destination paths), `checkableAgeKeys` |
| `lib/keycheck.ts` | Per-key check cache with a TTL and summary aggregation |
| `api.ts` | Typed `invoke()` wrappers + event listeners |

### Rust core (`src-tauri/src/`)

| File | Responsibility |
| --- | --- |
| `commands.rs` | The command surface; holds the in-memory `Session` (client, bucket, parsed identities) |
| `crypto.rs` | `age` keygen, identity parsing (native age + OpenSSH), **header probe** (`matches_key`), streaming decrypt |
| `s3.rs` | Client construction (path-style, bounded timeouts, retries), paginated listing, **range fetch** |
| `download.rs` | `GetObject` stream → `age` decrypt (or pass-through) → temp file → `fsync` → atomic rename; `safe_dest_path` |
| `profile.rs` | Connection metadata (plain JSON) + secrets (OS secure store, one bundled entry per profile) |
| `error.rs` | Serializable, user-friendly error type |

## Key data flows

### Connect

`connect(profile, creds)` resolves the S3 secret and age key — from the form, or
from the OS secure store in a **single keychain read** — parses the key into
identities, builds the S3 client, validates with a 1-object probe, and stores the
`Session`. Connection metadata is plain JSON in the app config dir; secrets are
**only** in the secure store, and only if the user opted in.

### Key pre-check (on selection)

For the selected `.age` files, `check_keys` issues a **64 KiB HTTP range request**
per object (`Range: bytes=0-65535`) and runs `crypto::matches_key`, which tries to
decrypt only the `age` header. This reveals whether the connected key fits —
*without downloading the files*. Results are cached per object key with a TTL on
the frontend, so fast navigation doesn't re-probe.

### Download & decrypt

```
S3 GetObject (async ByteStream)
   → SyncIoBridge (async→sync, on a spawn_blocking worker)
   → age streaming decrypt  (.age)   |   byte copy (non-.age, pass-through)
   → BufWriter to a temp file next to the destination
   → fsync → atomic rename to the final name
```

Each file streams in 64 KiB chunks, so a multi-GB artifact never sits fully in
memory. The destination path comes from a frontend-built plan (folder structure
preserved) and is **re-sanitized** by `safe_dest_path` against path traversal.
On **any** error — wrong key, corrupt object, integrity failure, I/O error — the
temp file is removed, so no partial or plaintext output is ever left behind
(**fail-closed**).

## Threat model

| Concern | Mitigation |
| --- | --- |
| Frontend compromise (malicious dep, XSS) exfiltrating the key | CSP `default-src 'self'` — the WebView has no network egress; the key only exists as identities in the Rust core |
| Key/secret persisted in plaintext | Secrets live only in the OS secure store; metadata JSON never contains them. The only plaintext key file is the Rescue Kit the user *optionally* saves |
| Crafted object key escaping the download folder (`../`, `..\`) | `safe_dest_path` drops `.`/`..`/empty segments; tested in `download.rs` |
| Wrong key / corrupt data yielding a partial or plaintext file | Decrypt to temp + atomic rename; delete-on-error (fail-closed) |
| Memory exhaustion on huge artifacts | Fixed 64 KiB streaming, never fully buffered |
| Unattended decrypted key sitting in memory | Idle auto-disconnect drops the session |
| Untrusted/`http://` endpoints | HTTPS by default; plain-HTTP triggers a loud warning |

## Why pure-Rust crypto/TLS

S3 and TLS use `rustls` (no system OpenSSL), and `age` is a pure-Rust
implementation — so builds are reproducible across platforms and don't depend on
a system crypto library. The AWS SDK's `aws-lc-rs` backend compiles native
assembly, which is why **CMake + NASM** are build prerequisites.
