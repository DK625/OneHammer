#!/usr/bin/env bash
set -Eeuo pipefail

CONTROL_ROOT="${1:-${CLAUDE_PROJECT_DIR:-$(pwd -P)}}"
TEST_FILE="$CONTROL_ROOT/.claude/hooks/planning/tests/phase0_index_root.test.mjs"
RESOLVER="$CONTROL_ROOT/.claude/hooks/planning/resolve_index_root.mjs"

[[ -f "$TEST_FILE" ]] || { printf '[planning-test] missing test file: %s\n' "$TEST_FILE" >&2; exit 1; }

node --test "$TEST_FILE"

# Optional real-path integration fixture. Set all three variables to exercise a local nested-repo case
# without hardcoding any team, repository, or machine path into the shared toolkit.
EXACT_CONTROL="${PLANNING_TEST_CONTROL_ROOT:-}"
EXACT_SOURCE="${PLANNING_TEST_SOURCE_PATH:-}"
EXACT_TARGET="${PLANNING_TEST_TARGET_ROOT:-}"
if [[ -n "$EXACT_CONTROL" || -n "$EXACT_SOURCE" || -n "$EXACT_TARGET" ]]; then
  [[ -n "$EXACT_CONTROL" && -n "$EXACT_SOURCE" && -n "$EXACT_TARGET" ]] || {
    printf '[planning-test] set PLANNING_TEST_CONTROL_ROOT, PLANNING_TEST_SOURCE_PATH, and PLANNING_TEST_TARGET_ROOT together\n' >&2
    exit 1
  }
  [[ -d "$EXACT_CONTROL" && -f "$EXACT_SOURCE" && -d "$EXACT_TARGET" ]] || {
    printf '[planning-test] configured real-path fixture is missing: control=%s source=%s target=%s\n' "$EXACT_CONTROL" "$EXACT_SOURCE" "$EXACT_TARGET" >&2
    exit 1
  }
  JSON="$(node "$RESOLVER" --control-root "$EXACT_CONTROL" --pwd "$EXACT_CONTROL" --source "$EXACT_SOURCE")"
  TARGET="$(printf '%s' "$JSON" | node -e 'let s=""; process.stdin.on("data", c => s += c); process.stdin.on("end", () => { const x=JSON.parse(s); if (!x.ok) process.exit(2); process.stdout.write(x.target_root); });')"
  [[ "$TARGET" == "$EXACT_TARGET" ]] || {
    printf '[planning-test] configured nested case failed: expected=%s actual=%s\n' "$EXACT_TARGET" "$TARGET" >&2
    exit 1
  }
  printf '[planning-test] configured nested case ok: %s -> %s\n' "$EXACT_SOURCE" "$TARGET"
else
  printf '[planning-test] portable nested fixtures passed; no optional real-path fixture configured\n'
fi
