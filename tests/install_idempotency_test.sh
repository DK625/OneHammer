#!/usr/bin/env bash
# Idempotency test for scripts/install.sh
#
# Installs twice into the same target repository and asserts that the second
# run succeeds, does not duplicate GitNexus hooks in settings.json, does not
# create nested managed directories, and preserves unrelated files.
#
# Usage: bash tests/install_idempotency_test.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT INT TERM

fail() { printf '[idempotency-test] FAIL: %s\n' "$*" >&2; exit 1; }
pass() { printf '[idempotency-test] ok: %s\n' "$*"; }

SRC="$WORK_DIR/source"
mkdir -p "$SRC"
cp -a "$REPO_ROOT/.claude" "$SRC/.claude"
cp -a "$REPO_ROOT/.mcp.json" "$SRC/.mcp.json"
cp -a "$REPO_ROOT/scripts" "$SRC/scripts"
git -C "$SRC" -c init.defaultBranch=master init -q
git -C "$SRC" add -A
git -C "$SRC" -c user.email=test@example.com -c user.name=test commit -qm 'test source'

TARGET="$WORK_DIR/target"
mkdir -p "$TARGET/scripts"
git -C "$TARGET" -c init.defaultBranch=master init -q
echo '#!/bin/sh' > "$TARGET/scripts/custom.sh"

run_install() {
  ONEHAMMER_SOURCE_REPO="file://$SRC" \
  ONEHAMMER_SOURCE_REF="master" \
  ONEHAMMER_TARGET_DIR="$TARGET" \
    bash < "$REPO_ROOT/scripts/install.sh"
}

run_install || fail "first run exited non-zero"
pass "first run succeeded"

run_install || fail "second run exited non-zero"
pass "second run succeeded"

# No duplicated GitNexus hooks in settings.json
PRE_COUNT=$(jq '[.hooks.PreToolUse[]?.hooks[]? | select(.command | test("gitnexus-hook"))] | length' \
  "$TARGET/.claude/settings.json")
POST_COUNT=$(jq '[.hooks.PostToolUse[]?.hooks[]? | select(.command | test("gitnexus-hook"))] | length' \
  "$TARGET/.claude/settings.json")
[[ "$PRE_COUNT" == "1" ]]  || fail "expected exactly 1 gitnexus PreToolUse hook, got $PRE_COUNT"
[[ "$POST_COUNT" == "1" ]] || fail "expected exactly 1 gitnexus PostToolUse hook, got $POST_COUNT"
pass "no duplicated gitnexus hooks"

# No nested managed directories, no OneHammer scripts leaked into target
[[ ! -e "$TARGET/.claude/skills/planning/planning" ]] || fail "nested planning/planning created"
[[ ! -e "$TARGET/scripts/install.sh" ]] || fail "installer must not copy scripts/ into the target"
pass "no nested directories, no scripts leaked"

jq empty "$TARGET/.claude/settings.json" || fail "settings.json corrupted"
jq empty "$TARGET/.mcp.json" || fail ".mcp.json corrupted"
pass "JSON still valid after rerun"

[[ -f "$TARGET/scripts/custom.sh" ]] || fail "unrelated scripts/custom.sh was deleted"
[[ -d "$TARGET/.beads" ]] || fail ".beads workspace missing after rerun"
pass "unrelated files and .beads preserved"

printf '[idempotency-test] ALL PASSED\n'
