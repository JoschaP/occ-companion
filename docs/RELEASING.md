# Releasing

Releases are automated. You normally do **nothing** except merge Conventional
Commits to `main`.

## What happens on merge to `main`

1. **`release.yml`** runs [semantic-release](https://semantic-release.gitbook.io/):
   it analyzes commits, computes the next version, updates `CHANGELOG.md` and the
   manifests (`package.json`, `Cargo.toml`, `tauri.conf.json`), tags, and
   publishes a GitHub Release.
2. The build matrix compiles native bundles (macOS arm64 + Intel, Windows,
   Linux) and attaches them to the release.
3. **`package-managers.yml`** updates the Homebrew cask and Scoop manifest.

Version bumps follow the commit types: `fix:` → patch, `feat:` → minor,
`feat!:` / `BREAKING CHANGE:` → major. While the project is `0.x`, breaking
changes stay below `1.0` until a `1.0.0` is cut intentionally.

## Tap/bucket write access (already configured)

Pushing to the **separate** tap/bucket repos uses write-enabled **SSH deploy
keys**, stored as the secrets `HOMEBREW_TAP_DEPLOY_KEY` and
`SCOOP_BUCKET_DEPLOY_KEY`. Without them the package-manager step logs a warning
and skips (the release itself still succeeds).

To rotate them (all via CLI — no PAT needed):

```bash
ssh-keygen -t ed25519 -f tapkey -N "" -C occ-secure-exports-ci
gh repo deploy-key add tapkey.pub --repo JoschaP/homebrew-tap --allow-write --title occ-secure-exports-ci
gh secret set HOMEBREW_TAP_DEPLOY_KEY --repo JoschaP/occ-secure-exports < tapkey
# repeat for scoop-bucket → SCOOP_BUCKET_DEPLOY_KEY
```

## Publishing bundles for an existing tag (manual)

To (re)build and publish a specific tag — e.g. to bootstrap the first release:

```bash
gh workflow run build-release.yml -f tag=v0.1.0
```

This builds the bundles, attaches them to the `v0.1.0` release, and updates the
package managers.

## Code signing (optional)

Bundles are unsigned by default. To sign/notarize, add the documented secrets
(see the README's *Signing & notarization* section) — the workflows already
consume them.
