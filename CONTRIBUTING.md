# Contributing to OCC Companion

Thanks for your interest! This is a small, security-focused desktop app — clear,
auditable changes are valued over clever ones.

## Ground rules

- **Never commit secrets** — private keys, secret access keys, real bucket
  credentials, or decrypted data. `.env*` is gitignored; keep it that way.
- Keep the security model intact (see [SECURITY.md](SECURITY.md)). Changes that
  weaken key isolation, the CSP, or fail-closed decryption need a strong reason.

## Development setup

Prerequisites: Rust (stable), Node 20+, pnpm, plus **CMake** and **NASM** (the
AWS SDK crypto backend builds native assembly). On Linux also install the
WebKitGTK toolchain — see the [README](README.md#prerequisites).

```bash
pnpm install
pnpm tauri dev      # run the app
```

### Task runner & dev shortcuts

A [`justfile`](justfile) bundles the common commands — run `just` to list them:

```bash
just dev        # run the app
just check      # everything CI runs (typecheck + tests + fmt + clippy)
just test       # frontend + Rust tests
just e2e        # e2e tests against the bucket (needs .env.test)
just seed       # seed demo data into the test bucket
just build      # production bundles
```

**Dev auto-seed:** if `.env.development.local` exists (gitignored), `just dev`
auto-creates a "Demo (dev)" connection so you don't re-enter test data. It is
dev-only (`import.meta.env.DEV`) and never runs in production builds. Seed it
from your `.env.test` values with `VITE_DEV_ENDPOINT`, `VITE_DEV_BUCKET`,
`VITE_DEV_REGION`, `VITE_DEV_ACCESS_KEY_ID`, `VITE_DEV_SECRET`,
`VITE_DEV_PATH_STYLE`, `VITE_DEV_AGE_KEY`.

## Checks (run before pushing)

```bash
pnpm exec tsc --noEmit                          # frontend types
pnpm test                                       # frontend tests (Vitest)
pnpm build                                       # frontend build

cd src-tauri
cargo fmt --all --check                          # formatting
cargo clippy --all-targets -- -D warnings        # lints
cargo test                                       # core + (skipped-without-creds) e2e
```

CI runs the same checks on every pull request.

### Testing against a real bucket (optional)

The `e2e` tests skip unless `.env.test` exists at the repo root. To run them,
create one with `OCC_TEST_ENDPOINT`, `OCC_TEST_BUCKET`, `OCC_TEST_REGION`,
`OCC_TEST_ACCESS_KEY_ID`, `OCC_TEST_SECRET_ACCESS_KEY`, `OCC_TEST_PATH_STYLE`.
Use a throwaway, bucket-scoped credential. This file must never be committed.

## Commits & pull requests

We use **[Conventional Commits](https://www.conventionalcommits.org/)** — they
drive automated versioning and the changelog via semantic-release:

- `feat: …` → minor release
- `fix: …` → patch release
- `feat!: …` or a `BREAKING CHANGE:` footer → major release
- `docs:`, `chore:`, `ci:`, `refactor:`, `test:` → no release

The **PR title** must follow this format (it becomes the changelog entry).
Commit messages are linted in CI.

Keep PRs focused, include tests for behaviour changes, and update the README
when behaviour changes.

## Releases

Maintainers don't tag by hand. Merging Conventional Commits to `main` triggers
semantic-release, which computes the version, updates the changelog and
manifests, creates the GitHub Release, and the CI builds and attaches the
macOS / Windows / Linux bundles.

By participating you agree your contributions are licensed under the project's
[MIT License](LICENSE).
