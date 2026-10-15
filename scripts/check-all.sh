#!/usr/bin/env bash
# Run every check CI runs, locally.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "== Versions";             node scripts/sync-versions.mjs --check
echo "== Prettier";             pnpm format:check
echo "== TypeScript typecheck"; pnpm typecheck
echo "== ESLint";               pnpm lint
echo "== Tests";                pnpm test
echo "== Build";                pnpm build
echo "== cargo fmt";            cargo fmt --all -- --check
echo "== cargo clippy";         cargo clippy --workspace --all-targets -- -D warnings
echo "== cargo test";           cargo test --workspace
echo "== Flutter";              (cd apps/mobile && flutter pub get && flutter analyze && flutter test)
echo "All checks passed."
