## [0.9.2](https://github.com/JoschaP/occ-secure-exports/compare/v0.9.1...v0.9.2) (2026-06-21)


### Bug Fixes

* **core:** degrade gracefully when the OS secure store is unavailable ([30bcb15](https://github.com/JoschaP/occ-secure-exports/commit/30bcb153221cce7bd6fb177a4533e88634cf6ef0))

## [0.9.1](https://github.com/JoschaP/occ-secure-exports/compare/v0.9.0...v0.9.1) (2026-06-21)


### Bug Fixes

* **core:** harden secret file writes, secret store, and listing robustness ([5f1c765](https://github.com/JoschaP/occ-secure-exports/commit/5f1c7658936eaf91065b478518ee9b9f8baf2d2a))
* **ui+ci:** guard concurrent downloads, robust listeners, Linux keyring build ([1b9ce1a](https://github.com/JoschaP/occ-secure-exports/commit/1b9ce1afc38402420ac77a04cd05e016341ebb29))

# [0.9.0](https://github.com/JoschaP/occ-secure-exports/compare/v0.8.0...v0.9.0) (2026-06-21)


### Features

* download queue in a docked sidebar with show-in-folder & retry ([4e6c95b](https://github.com/JoschaP/occ-secure-exports/commit/4e6c95bbc2b13c97deccff3421450b2ae17384f1))

# [0.8.0](https://github.com/JoschaP/occ-secure-exports/compare/v0.7.0...v0.8.0) (2026-06-21)


### Features

* check for a newer version against the GitHub releases API ([b4a3af1](https://github.com/JoschaP/occ-secure-exports/commit/b4a3af1d59f1a2c897c0d3cb26e7da8cbef3ff89))
* make the Rescue Kit download optional + honest key-storage wording ([e542283](https://github.com/JoschaP/occ-secure-exports/commit/e542283106ec7cbe523e78178346fc8b2aa10595))

# [0.7.0](https://github.com/JoschaP/occ-secure-exports/compare/v0.6.0...v0.7.0) (2026-06-21)


### Features

* size the connection screen to its content ([3e03297](https://github.com/JoschaP/occ-secure-exports/commit/3e03297516272605d4555cb9bd7fa19c1da672bc))

# [0.6.0](https://github.com/JoschaP/occ-secure-exports/compare/v0.5.0...v0.6.0) (2026-06-21)


### Features

* rebrand to "OCC Secure Exports" ([4732879](https://github.com/JoschaP/occ-secure-exports/commit/473287901313cd72de91ed605dbb012a92367c4d))

# [0.5.0](https://github.com/JoschaP/occ-secure-exports/compare/v0.4.0...v0.5.0) (2026-06-21)


### Features

* new app icon — OCC document with a padlock ([1b7387e](https://github.com/JoschaP/occ-secure-exports/commit/1b7387e6cff7a4dec7065da3fd20bcc8bfca21f7))

# [0.4.0](https://github.com/JoschaP/occ-secure-exports/compare/v0.3.0...v0.4.0) (2026-06-21)


### Bug Fixes

* bundle a profile's secrets into one keychain entry (single prompt) ([0c4c621](https://github.com/JoschaP/occ-secure-exports/commit/0c4c6217c7642933c19d07ae0349108f199dd2f6))


### Features

* status bar reflects the current selection size ([1aee9f1](https://github.com/JoschaP/occ-secure-exports/commit/1aee9f1e04e1017b6d7d1177926f5f899ac3d9a7))

# [0.3.0](https://github.com/JoschaP/occ-secure-exports/compare/v0.2.1...v0.3.0) (2026-06-21)


### Features

* preserve folder structure on download, idle-disconnect, fewer keychain prompts ([c7fc27c](https://github.com/JoschaP/occ-secure-exports/commit/c7fc27c3e68158f322d0672a756491ae8140e5c1))

## [0.2.1](https://github.com/JoschaP/occ-secure-exports/compare/v0.2.0...v0.2.1) (2026-06-21)


### Bug Fixes

* scope key pre-check to selected files and cache results per object ([fff94d0](https://github.com/JoschaP/occ-secure-exports/commit/fff94d0f6b5e8ae91caa00f287f89d535b1be182))

# [0.2.0](https://github.com/JoschaP/occ-secure-exports/compare/v0.1.1...v0.2.0) (2026-06-21)


### Features

* pass through non-age files and pre-check key on selection ([c1e02c7](https://github.com/JoschaP/occ-secure-exports/commit/c1e02c76862b13a8fec40c7fa055543c8c573cdb))

## [0.1.1](https://github.com/JoschaP/occ-secure-exports/compare/v0.1.0...v0.1.1) (2026-06-21)


### Bug Fixes

* **ci:** build unsigned bundles — drop empty signing env that broke macOS [skip ci] ([8216a10](https://github.com/JoschaP/occ-secure-exports/commit/8216a104a0fe4ded17ec71bf3b841ebbf357533d))

# 1.0.0 (2026-06-20)


### Bug Fixes

* **s3:** disable stalled-stream protection for slow or bursty transfers ([0845a79](https://github.com/JoschaP/occ-secure-exports/commit/0845a79947e8b780255c1eb8cf77410ce1f4ae23))
