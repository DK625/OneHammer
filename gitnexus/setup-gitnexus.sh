#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_SETTINGS="$PROJECT_ROOT/.claude/settings.json"
PROJECT_GITNEXUS_HOOK_DIR="$PROJECT_ROOT/.claude/hooks/gitnexus"
LOCAL_BIN="$HOME/.local/bin"

USER_HOOK_DIR="${GITNEXUS_USER_HOOK_DIR:-$HOME/.claude/hooks/gitnexus}"
USER_HOOK_FILE="$USER_HOOK_DIR/gitnexus-hook.cjs"
RUN_ANALYZE=0
FORCE_INSTALL="${GITNEXUS_FORCE_INSTALL:-0}"

usage() {
  cat <<'EOF'
Usage:
  gitnexus/setup-gitnexus.sh [--analyze] [--force-install]

Installs the Phase 0 planning CLIs (`br`, `bv`, GitNexus), initializes this
repository's Beads workspace, and wires Claude Code settings to the standard
user-level GitNexus hook at ~/.claude/hooks/gitnexus/gitnexus-hook.cjs.

This script intentionally does not create or modify .mcp.json, and it removes
any project-local copied GitNexus hook under .claude/hooks/gitnexus.

Options:
  --analyze         Run `gitnexus analyze` after installing/wiring hooks
  --force-install   Reinstall br, bv, and GitNexus even when binaries exist
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-analyze)
      RUN_ANALYZE=0
      ;;
    --analyze)
      RUN_ANALYZE=1
      ;;
    --force-install)
      FORCE_INSTALL=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

log() { printf '[gitnexus-setup] %s\n' "$*"; }
die() { printf '[gitnexus-setup] ERROR: %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || die "Node.js is required"
command -v npm >/dev/null 2>&1 || die "npm is required"
command -v curl >/dev/null 2>&1 || die "curl is required"
command -v jq >/dev/null 2>&1 || die "jq is required"

NPM_PREFIX="$(npm prefix -g 2>/dev/null || npm config get prefix)"
mkdir -p "$LOCAL_BIN"
export PATH="$LOCAL_BIN:$NPM_PREFIX/bin:$PATH"

log "project root: $PROJECT_ROOT"

if [[ "$FORCE_INSTALL" == "1" ]] || ! command -v br >/dev/null 2>&1; then
  log "installing br latest to $LOCAL_BIN"
  curl -fsSL "https://raw.githubusercontent.com/Dicklesworthstone/beads_rust/main/install.sh?$(date +%s)" \
    | bash -s -- --dest "$LOCAL_BIN" --skip-skills --no-gum
  hash -r
else
  log "br already installed: $(command -v br)"
fi

command -v br >/dev/null 2>&1 || die "br binary is still not on PATH after install"

if [[ "$FORCE_INSTALL" == "1" ]] || ! command -v bv >/dev/null 2>&1; then
  log "installing bv latest to $LOCAL_BIN"
  curl -fsSL "https://raw.githubusercontent.com/Dicklesworthstone/beads_viewer/main/install.sh?$(date +%s)" \
    | INSTALL_DIR="$LOCAL_BIN" bash
  hash -r
else
  log "bv already installed: $(command -v bv)"
fi

command -v bv >/dev/null 2>&1 || die "bv binary is still not on PATH after install"

br --help >/dev/null 2>&1 || die "br --help failed"
bv --help >/dev/null 2>&1 || die "bv --help failed"
jq --version >/dev/null 2>&1 || die "jq --version failed"
log "Phase 0 CLI health ok: br, bv, jq"

if [[ -d "$PROJECT_ROOT/.beads" ]]; then
  log "Beads workspace already initialized: $PROJECT_ROOT/.beads"
else
  log "initializing Beads workspace"
  (cd "$PROJECT_ROOT" && br init)
fi

if [[ "$FORCE_INSTALL" == "1" ]] || ! command -v gitnexus >/dev/null 2>&1; then
  log "installing gitnexus@latest globally"
  ONNXRUNTIME_NODE_INSTALL="${ONNXRUNTIME_NODE_INSTALL:-skip}" \
    GITNEXUS_SKIP_OPTIONAL_GRAMMARS="${GITNEXUS_SKIP_OPTIONAL_GRAMMARS:-1}" \
    npm install -g gitnexus@latest
  hash -r
else
  log "gitnexus already installed: $(command -v gitnexus)"
fi

command -v gitnexus >/dev/null 2>&1 || die "gitnexus binary is still not on PATH after install"

NPM_GLOBAL_ROOT="$(npm root -g)"
GITNEXUS_CLI_PATH="$NPM_GLOBAL_ROOT/gitnexus/dist/cli/index.js"
PACKAGE_HOOK_DIR="$NPM_GLOBAL_ROOT/gitnexus/hooks/claude"
[[ -f "$GITNEXUS_CLI_PATH" ]] || die "GitNexus CLI not found: $GITNEXUS_CLI_PATH"
[[ -d "$PACKAGE_HOOK_DIR" ]] || die "GitNexus package hook dir not found: $PACKAGE_HOOK_DIR"

mkdir -p "$USER_HOOK_DIR"

HOOK_SRC="$PACKAGE_HOOK_DIR/gitnexus-hook.cjs"
[[ -f "$HOOK_SRC" ]] || die "GitNexus hook source not found: $HOOK_SRC"

HOOK_SRC="$HOOK_SRC" USER_HOOK_FILE="$USER_HOOK_FILE" GITNEXUS_CLI_PATH="$GITNEXUS_CLI_PATH" node <<'NODE'
const fs = require('fs');

const src = process.env.HOOK_SRC;
const dest = process.env.USER_HOOK_FILE;
const cliPath = process.env.GITNEXUS_CLI_PATH.replace(/\\/g, '/');
const literal = "let cliPath = path.resolve(__dirname, '..', '..', 'dist', 'cli', 'index.js');";

let content = fs.readFileSync(src, 'utf8');
if (content.includes(literal)) {
  content = content.replace(literal, `let cliPath = ${JSON.stringify(cliPath)};`);
}
fs.writeFileSync(dest, content);
NODE

for helper in hook-lock.cjs hook-db-lock-probe.cjs resolve-analyze-cmd.cjs pre-tool-use.sh session-start.sh win-rm-list-json.ps1; do
  if [[ -f "$PACKAGE_HOOK_DIR/$helper" ]]; then
    cp -a "$PACKAGE_HOOK_DIR/$helper" "$USER_HOOK_DIR/$helper"
  fi
done

chmod +x "$USER_HOOK_FILE" "$USER_HOOK_DIR/pre-tool-use.sh" "$USER_HOOK_DIR/session-start.sh" 2>/dev/null || true
log "user hook installed: $USER_HOOK_FILE"

if [[ -d "$PROJECT_GITNEXUS_HOOK_DIR" ]]; then
  rm -rf "$PROJECT_GITNEXUS_HOOK_DIR"
  log "removed project-local copied hook: $PROJECT_GITNEXUS_HOOK_DIR"
fi

mkdir -p "$(dirname "$PROJECT_SETTINGS")"
HOOK_COMMAND='node "$HOME/.claude/hooks/gitnexus/gitnexus-hook.cjs"'

HOOK_COMMAND="$HOOK_COMMAND" PROJECT_SETTINGS="$PROJECT_SETTINGS" node <<'NODE'
const fs = require('fs');

const settingsPath = process.env.PROJECT_SETTINGS;
const hookCommand = process.env.HOOK_COMMAND;

function readJson(path) {
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

function stripGitNexusHooks(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => {
      const hooks = (Array.isArray(entry.hooks) ? entry.hooks : [])
        .filter((hook) => !/gitnexus-hook\.cjs|\.claude\/hooks\/gitnexus\//.test(String(hook.command || '')));
      return { ...entry, hooks };
    })
    .filter((entry) => entry.hooks.length > 0);
}

const settings = readJson(settingsPath);
settings.hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};
settings.hooks.PreToolUse = stripGitNexusHooks(settings.hooks.PreToolUse);
settings.hooks.PostToolUse = stripGitNexusHooks(settings.hooks.PostToolUse);

settings.hooks.PreToolUse.unshift({
  matcher: 'Grep|Glob|Bash',
  hooks: [{
    type: 'command',
    command: hookCommand,
    timeout: 10,
    statusMessage: 'Enriching with GitNexus graph context...',
  }],
});

settings.hooks.PostToolUse.unshift({
  matcher: 'Bash',
  hooks: [{
    type: 'command',
    command: hookCommand,
    timeout: 10,
    statusMessage: 'Checking GitNexus index freshness...',
  }],
});

fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
NODE
log "settings updated: $PROJECT_SETTINGS"

if [[ "$RUN_ANALYZE" == "1" ]]; then
  log "running gitnexus analyze"
  (cd "$PROJECT_ROOT" && gitnexus analyze)
else
  log "skipping gitnexus analyze"
fi

printf '{"hook_event_name":"PreToolUse","cwd":"%s","tool_name":"Grep","tool_input":{"pattern":"setupGitNexus"}}' "$PROJECT_ROOT" \
  | node "$USER_HOOK_FILE" >/dev/null
log "hook smoke test passed"

log "done. Restart Claude Code so it reloads .claude/settings.json"
