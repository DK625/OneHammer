#!/usr/bin/env bash
set -Eeuo pipefail

CONTROL_ROOT="${1:-${CLAUDE_PROJECT_DIR:-$(pwd -P)}}"
TEST_FILE="$CONTROL_ROOT/.claude/hooks/planning/tests/toolkit_genericity.test.mjs"

[[ -f "$TEST_FILE" ]] || { printf '[planning-test] missing test file: %s\n' "$TEST_FILE" >&2; exit 1; }
node --test "$TEST_FILE"
