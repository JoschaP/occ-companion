# OCC Secure Exports

[![CI](https://github.com/JoschaP/occ-secure-exports/actions/workflows/ci.yml/badge.svg)](https://github.com/JoschaP/occ-secure-exports/actions/workflows/ci.yml)
[![Release](https://github.com/JoschaP/occ-secure-exports/actions/workflows/release.yml/badge.svg)](https://github.com/JoschaP/occ-secure-exports/actions/workflows/release.yml)
[![Latest release](https://img.shields.io/github/v/release/JoschaP/occ-secure-exports?sort=semver)](https://github.com/JoschaP/occ-secure-exports/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-informational.svg)](LICENSE)

A small, open-source desktop app that lets you pull your **age-encrypted data
exports** out of your own S3 bucket and decrypt them — with no command line.

It is the recipient-side counterpart to the **OCC** (the cloud console)
"controlled egress" export feature: the OCC encrypts each artifact with *age*
for your public key and uploads the ciphertext to a bucket **you** own. Only you
hold the private key. OCC Secure Exports is the tool that turns those `.age` objects
back into plaintext, on your machine.

![OCC Secure Exports — the connection screen](docs/screenshot.png)

---

## What it does

1. You enter your S3 connection (endpoint, region, bucket, access key, path-style
   toggle) and your **age private key** — or generate a fresh key pair in-app
   (with an enforced **Rescue Kit** download so the key is never lost).
2. It shows a **single file explorer** of the bucket: a folder tree grouped by key
   prefix, with names, sizes and dates, and multi-select.
3. On selection it does a **key pre-check** — a tiny range request reads just the
   `age` header to tell you up front whether your key can decrypt the selection
   (*"key matches"* / *"key can't decrypt N"*), without downloading the files.
4. You pick files **or whole folders** and click **“Download …”**, then choose a
   destination:
   - `.age` objects are **streamed and decrypted on the fly**, saved without the
     `.age` extension (`export.json.age` → `export.json`). The button reads
     *“Download … & decrypt”*.
   - Non-`.age` objects **pass through unchanged** (the button reads just
     *“Download …”*).
   - Folder downloads **preserve the directory structure** under the destination.
5. A progress dialog shows each file; everything is **fail-closed and atomic**
   (see the security model below).
6. After a period of inactivity the connection auto-closes and the in-memory key
   is dropped (an active download keeps the session alive).

---

## Install

### Homebrew (macOS)

```bash
brew install --cask JoschaP/tap/occ-secure-exports
```

### Scoop (Windows)

```powershell
scoop bucket add occ-secure-exports https://github.com/JoschaP/scoop-bucket
scoop install occ-secure-exports
```

### Direct download

Grab the installer for your OS from the
[Releases](https://github.com/JoschaP/occ-secure-exports/releases) page —
`.dmg` (macOS, Apple Silicon + Intel), `.msi`/`.exe` (Windows),
`.deb`/`.AppImage` (Linux).

> Builds are currently **unsigned**. macOS: right-click the app → **Open** the
> first time (Gatekeeper). Windows: **More info → Run anyway** (SmartScreen).
> Installing via Homebrew/Scoop generally avoids these prompts.

## Security model — your key stays local

This is the whole promise of the product, so it is built to be auditable:

- **The private key never leaves the device.** No telemetry, no analytics, no
  phone-home. The only outbound connections are to the S3 endpoint you configure
  and a version check against the **GitHub releases API** (to tell you when an
  update is out — it sends nothing but the request). Both happen in the Rust
  core, never the WebView.
- **The WebView cannot reach the network.** A strict Content-Security-Policy
  (`default-src 'self'`) is set in [`tauri.conf.json`](src-tauri/tauri.conf.json).
  All S3 traffic happens in the Rust core (`aws-sdk-s3`), never in the browser
  layer — so key material in the UI physically cannot be exfiltrated by a network
  request from the frontend.
- **Secrets live in the OS secure store**, not in plaintext on disk: macOS
  Keychain, Windows Credential Manager, Linux Secret Service (libsecret), via the
  [`keyring`](https://crates.io/crates/keyring) crate. Connection *metadata*
  (endpoint, bucket, access-key **id**) is stored as plain JSON in the app config
  dir; the secret access key and the private age key are stored only in the
  secure store, and only if you opt in ("remember"). Otherwise the key is held in
  memory for the session and discarded. The **one** plaintext-on-disk path is the
  **Rescue Kit** you may *optionally* save when generating a key — that file is
  written only on your explicit action, to a location you choose, and never sent
  anywhere.
- **Streaming decryption.** S3 `GetObject` → `age` decrypt → file writer, in
  64 KiB chunks. A multi-GB artifact never sits fully in memory.
- **Fail-closed, atomic writes.** Each file is decrypted to a temp file next to
  the destination, `fsync`'d, then atomically renamed. On *any* error — wrong
  key, corrupt object, integrity failure — the temp file is deleted and **no
  partial or plaintext file is left behind**.
- **HTTPS by default.** Plain-`http://` endpoints trigger a loud warning.

### Verify it yourself

Because the app is open source, you can confirm the claims:

- Run a network capture (e.g. Wireshark, `mitmproxy`, Little Snitch) while using
  the app — you will see traffic **only** to your configured S3 endpoint, and the
  key never on the wire.
- Read the crypto and I/O paths: [`crypto.rs`](src-tauri/src/crypto.rs),
  [`download.rs`](src-tauri/src/download.rs), [`s3.rs`](src-tauri/src/s3.rs).

---

## Keys

OCC Secure Exports accepts two kinds of private key as decryption identities:

- **Native age keys** (`AGE-SECRET-KEY-1…`)
- **OpenSSH private keys** (ed25519 / rsa), unencrypted

Use **“Generate a key pair”** if you don't have one. Copy the **public** key into
the OCC export configuration; keep the **private** key — it is the only thing that
can ever decrypt your exports.

---

## How it pairs with the OCC export feature

| OCC (sender) | OCC Secure Exports (recipient) |
| --- | --- |
| You register a bucket you own + your age **public** key. | You add the same bucket + your **private** key. |
| For each export, the OCC encrypts with age for your public key and uploads `…json.age`. | You browse the bucket and download & decrypt. |
| The OCC never holds your private key. | The private key never leaves your device. |

Object keys typically look like
`{basePath}/{environment}/{application}/log-export/{date}/<file>.json.age`, but
the browser handles arbitrary prefixes — backups, snapshots and reports delivered
to the same bucket work the same way.

---

## Build

### Prerequisites

- [Rust](https://rustup.rs) (stable)
- Node.js 20+ and [pnpm](https://pnpm.io)
- **CMake** and **NASM** — the AWS SDK's crypto backend (`aws-lc-rs`) compiles
  native assembly. CMake ships on most systems; install NASM via your package
  manager (`brew install nasm`, `apt install nasm`, or `choco install nasm` /
  the [setup-nasm](https://github.com/ilammy/setup-nasm) action on Windows).
- Platform toolchain for Tauri 2 — see
  [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/).
  On Debian/Ubuntu: `libwebkit2gtk-4.1-dev`,
  `libayatana-appindicator3-dev`, `librsvg2-dev`, `build-essential`.

### Develop

```bash
pnpm install
pnpm tauri dev
```

### Build a release bundle

```bash
pnpm tauri build
```

Artifacts land in `src-tauri/target/release/bundle/` (`.dmg`/`.app`, `.msi`/`.exe`,
`.deb`/`.AppImage`).

### Platform support

Built natively for each OS (one CI runner per platform — no cross-compilation).
All crypto and S3 I/O is pure-Rust (rustls — no system OpenSSL).

| | macOS | Windows | Linux |
| --- | --- | --- | --- |
| Bundle | `.dmg` / `.app` (arm64 + x86_64) | `.msi` / `.exe` (NSIS) | `.deb` / `.AppImage` |
| WebView (runtime) | WKWebView — built in | WebView2 — present on Win 11; the installer bootstraps it otherwise | WebKitGTK (`libwebkit2gtk-4.1`) — pulled in by the `.deb` |
| Secure store | Keychain | Credential Manager | Secret Service (libsecret / gnome-keyring / KWallet) |
| Secret files (key, Rescue Kit) | `0600` | user-profile ACLs | `0600` |

On Linux without a Secret Service running, **"remember"** is unavailable but the
app still works with **"ask each time"**. Object keys are sanitized so a `/` or
`\` in a key can never escape the chosen download folder on any OS.

---

## Signing & notarization

Signing fields are stubbed in [`tauri.conf.json`](src-tauri/tauri.conf.json), and
the release workflow ([`.github/workflows/release.yml`](.github/workflows/release.yml))
documents exactly where to add the env vars. Builds are unsigned by default (an
empty `APPLE_CERTIFICATE` would break macOS bundling); provide the secrets below
and add the matching env vars to the build step to produce signed, notarized
builds.

### macOS (Apple notarization)

| Variable | Meaning |
| --- | --- |
| `APPLE_CERTIFICATE` | base64 of your **Developer ID Application** `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | password for that `.p12` |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Company (TEAMID)` |
| `APPLE_ID` | Apple ID used for notarization |
| `APPLE_PASSWORD` | app-specific password for that Apple ID |
| `APPLE_TEAM_ID` | your Apple Developer Team ID |

### Windows (Authenticode)

| Variable | Meaning |
| --- | --- |
| `WINDOWS_CERTIFICATE` | base64 of your code-signing `.pfx` |
| `WINDOWS_CERTIFICATE_PASSWORD` | password for that `.pfx` |

`digestAlgorithm` / `timestampUrl` are stubbed in `tauri.conf.json` (`sha256` +
DigiCert). Once a certificate thumbprint is configured, signing runs
automatically during `tauri build`.

### Linux

No OS signing required for `.deb`/`.AppImage`. Sign the AppImage with `gpg` if you
distribute a detached signature.

---

## Project layout

```
src/                     React + Mantine frontend (OCC design system)
  components/            ProfileList, ConnectionForm, KeygenDialog, Explorer, …
  hooks/                 useIdleDisconnect (inactivity auto-disconnect)
  lib/tree.ts            S3 keys → folder tree, download plan, formatting
  lib/keycheck.ts        key pre-check cache + summary (per-key, TTL'd)
  api.ts                 typed bridge to the Rust commands
  theme.ts               OCC Mantine theme (mirrors ../frontend)
src-tauri/src/
  crypto.rs              age keygen, identity parsing, header probe, streaming decrypt
  s3.rs                  client build (path-style), paginated listing, range fetch
  download.rs            stream → decrypt → temp → atomic rename (fail-closed)
  profile.rs             profiles (JSON) + bundled secrets (OS secure store)
  commands.rs            the Tauri command surface
  error.rs               serializable error type
```

A deeper walkthrough of the data flow and threat model lives in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Contributing

Issues and pull requests are welcome. The project uses
[Conventional Commits](https://www.conventionalcommits.org/) and an automated
release flow — see [CONTRIBUTING.md](CONTRIBUTING.md) for setup, the test
commands, and the commit/PR conventions. Please also read the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Releases

Releases are fully automated with
[semantic-release](https://semantic-release.gitbook.io/). Merging Conventional
Commits to `main` determines the next version, updates
[`CHANGELOG.md`](CHANGELOG.md), tags, and publishes a GitHub Release; CI then
builds and attaches the macOS / Windows / Linux bundles. Maintainers never tag
by hand.

## Security

The private key never leaves your device. To report a vulnerability, see
[SECURITY.md](SECURITY.md) — please use a private advisory, not a public issue.

## License

MIT — see [LICENSE](LICENSE).
