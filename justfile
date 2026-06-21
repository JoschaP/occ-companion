# OCC Secure Exports task runner — `just <target>` (https://github.com/casey/just)

# List available targets
default:
    @just --list

# Install JS dependencies
install:
    pnpm install

# Run the app in development (auto-seeds a demo connection from .env.development.local)
dev:
    pnpm tauri dev

# Production bundles (.dmg / .msi / .deb / .AppImage)
build:
    pnpm tauri build

# --- quality gates (same as CI) ---

# Everything CI runs: types, tests, format, lints
check: typecheck test-fe lint test-rs

# TypeScript typecheck
typecheck:
    pnpm exec tsc --noEmit

# Frontend unit tests (Vitest)
test-fe:
    pnpm test

# Rust format check + clippy (deny warnings)
lint:
    cd src-tauri && cargo fmt --all --check
    cd src-tauri && cargo clippy --all-targets -- -D warnings

# Apply rustfmt
fmt:
    cd src-tauri && cargo fmt --all

# Rust tests (unit + profiles; e2e skips without .env.test)
test-rs:
    cd src-tauri && cargo test

# All tests
test: test-fe test-rs

# End-to-end tests against the bucket (needs .env.test)
e2e:
    cd src-tauri && cargo test --test e2e -- --nocapture

# Seed demo data into the test bucket (needs mc alias `occ-test` + .env.test)
seed:
    ./scripts/seed-demo.sh

# Remove build artifacts
clean:
    rm -rf dist
    cd src-tauri && cargo clean
