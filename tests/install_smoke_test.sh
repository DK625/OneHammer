#!/usr/bin/env bash
# Smoke test for scripts/install.sh
#
# Builds a temporary source repository from the current working tree (so
# uncommitted changes are exercised), installs into a fresh temporary Git
# repository, and asserts the required scaffold, JSON validity, and CLI
# health. Uses already-installed br/bv/gitnexus when present, so it does
# not force global reinstalls on every run.
#
# Usage: bash tests/install_smoke_test.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT INT TERM

fail() { printf '[smoke-test] FAIL: %s\n' "$*" >&2; exit 1; }
pass() { printf '[smoke-test] ok: %s\n' "$*"; }

# ── Build a temp source repo from the current working tree ──────────────────
SRC="$WORK_DIR/source"
mkdir -p "$SRC"
cp -a "$REPO_ROOT/.claude" "$SRC/.claude"
cp -a "$REPO_ROOT/.mcp.json" "$SRC/.mcp.json"
cp -a "$REPO_ROOT/scripts" "$SRC/scripts"
cp -a "$REPO_ROOT/README.md" "$SRC/README.md"
git -C "$SRC" -c init.defaultBranch=master init -q
git -C "$SRC" add -A
git -C "$SRC" -c user.email=test@example.com -c user.name=test commit -qm 'test source'

# ── Fresh target repo with pre-existing unrelated files ─────────────────────
TARGET="$WORK_DIR/target"
mkdir -p "$TARGET/scripts" "$TARGET/.claude/hooks"
git -C "$TARGET" -c init.defaultBranch=master init -q
echo '#!/bin/sh' > "$TARGET/scripts/custom.sh"
echo '// custom' > "$TARGET/.claude/hooks/custom.mjs"

# ── Run installer through stdin, exactly like `curl | bash` ─────────────────
ONEHAMMER_SOURCE_REPO="file://$SRC" \
ONEHAMMER_SOURCE_REF="master" \
ONEHAMMER_TARGET_DIR="$TARGET" \
  bash < "$REPO_ROOT/scripts/install.sh" \
  || fail "installer exited non-zero"

# ── Assertions ───────────────────────────────────────────────────────────────
for d in \
  "$TARGET/.claude/hooks" \
  "$TARGET/.claude/skills/planning" \
  "$TARGET/.claude/skills/planning-validator" \
  "$TARGET/.claude/skills/onehammer-forge" \
  "$TARGET/scripts" \
  "$TARGET/.beads"; do
  [[ -d "$d" ]] || fail "missing directory: $d"
done
pass "required directories exist"

for f in \
  "$TARGET/.claude/settings.json" \
  "$TARGET/.mcp.json" \
  "$TARGET/scripts/install.sh" \
  "$TARGET/scripts/uninstall.sh"; do
  [[ -f "$f" ]] || fail "missing file: $f"
done
pass "required files exist"

[[ ! -e "$TARGET/.claude/.skills" ]] || fail ".claude/.skills must not be created in target"
[[ ! -e "$TARGET/.claude/skills/codex" ]] || fail "unmanaged skill 'codex' must not be copied"
pass "skill layout is correct"

jq empty "$TARGET/.claude/settings.json" || fail "invalid JSON: settings.json"
jq empty "$TARGET/.mcp.json" || fail "invalid JSON: .mcp.json"
pass "JSON files are valid"

[[ -f "$TARGET/scripts/custom.sh" ]] || fail "unrelated scripts/custom.sh was deleted"
[[ -f "$TARGET/.claude/hooks/custom.mjs" ]] || fail "unrelated hook custom.mjs was deleted"
pass "unrelated files preserved"

br --help >/dev/null 2>&1 || fail "br health check"
bv --help >/dev/null 2>&1 || fail "bv health check"
jq --version >/dev/null 2>&1 || fail "jq health check"
gitnexus --help >/dev/null 2>&1 || fail "gitnexus health check"
pass "CLI health checks"

printf '[smoke-test] ALL PASSED\n'
