<!--
PR titles must follow Conventional Commits (e.g. "feat: …", "fix: …").
The title becomes part of the changelog and drives the next version.
-->

## What & why

<!-- What does this change and why? Link any related issue (#123). -->

## How was it tested?

- [ ] `pnpm test` (frontend) passes
- [ ] `cargo test` (core) passes
- [ ] `cargo clippy --all-targets -- -D warnings` is clean
- [ ] Tried it in the running app (`pnpm tauri dev`) where relevant

## Checklist

- [ ] No secrets, keys, or private data in the diff, tests, or screenshots
- [ ] Conventional Commit PR title
- [ ] Docs/README updated if behaviour changed
