#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  install.sh — OneHammer one-command bootstrap installer
#
#  Public usage (run inside the target project's Git repository):
#
#    curl -fsSL \
#      https://raw.githubusercontent.com/DK625/OneHammer/master/scripts/install.sh \
#      | bash
#
#  What it does:
#    1. Installs into the CURRENT DIRECTORY (or --target/ONEHAMMER_TARGET_DIR
#       when set) — run it from your project root.
#    2. Checks prerequisites (git, curl, awk, node, npm) and ensures jq.
#    3. Shallow-clones the OneHammer source into a temp directory.
#    4. Validates all mandatory source paths BEFORE touching the target.
#    5. Copies the project scaffold: .claude/hooks, the managed skills
#       (planning and onehammer-forge, including bundled Herdr references),
#       .claude/settings.json,
#       and .mcp.json — backing up differing JSON configs.
#    6. Installs/wires Herdr and the planning toolchain: br, bv, GitNexus,
#       Beads workspace, and the user-level GitNexus hook (this logic used to
#       live in scripts/setup-planning-toolchain.sh and is now inlined here).
#    7. Verifies everything and prints a summary.
#
#  Environment overrides (CLI flags take precedence):
#    ONEHAMMER_SOURCE_REPO  default https://github.com/DK625/OneHammer.git
#    ONEHAMMER_SOURCE_REF   default master
#    ONEHAMMER_TARGET_DIR   default <current directory>
#    ONEHAMMER_FORCE        default 0
#    ONEHAMMER_ANALYZE      default 0
#    ONEHAMMER_HERDR_INSTALL_URL default https://herdr.dev/install.sh
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SOURCE_REPO="${ONEHAMMER_SOURCE_REPO:-https://github.com/DK625/OneHammer.git}"
SOURCE_REF="${ONEHAMMER_SOURCE_REF:-master}"
TARGET_DIR="${ONEHAMMER_TARGET_DIR:-}"
FORCE_INSTALL="${ONEHAMMER_FORCE:-0}"
RUN_ANALYZE="${ONEHAMMER_ANALYZE:-0}"
HERDR_INSTALL_URL="${ONEHAMMER_HERDR_INSTALL_URL:-https://herdr.dev/install.sh}"

LOCAL_BIN="$HOME/.local/bin"
USER_HOOK_DIR="${GITNEXUS_USER_HOOK_DIR:-$HOME/.claude/hooks/gitnexus}"
USER_HOOK_FILE="$USER_HOOK_DIR/gitnexus-hook.cjs"

MANAGED_SKILLS=(planning onehammer-forge)

JQ_VERSION="1.7.1"
JQ_BASE_URL="https://github.com/jqlang/jq/releases/download/jq-${JQ_VERSION}"
# Official sha256sum.txt of the jq 1.7.1 release
JQ_SHA_LINUX_AMD64="5942c9b0934e510ee61eb3e30273f1b3fe2590df93933a93d7c58b81d19c8ff5"
JQ_SHA_LINUX_ARM64="4dd2d8a0661df0b22f1bb9a1f9830f06b6f3b8f7d91211a1ef5d7c4f06a8b4a5"
JQ_SHA_MACOS_AMD64="4155822bbf5ea90f5c79cf254665975eb4274d426d0709770c21774de5407443"
JQ_SHA_MACOS_ARM64="0bbe619e663e0de2c550be2fe0d240d076799d6f8a652b70fa04aea8a8362e8a"

PHASE="bootstrap"
TEMP_DIR=""
TARGET_ROOT=""
SOURCE_COMMIT=""
BACKUP_DIR=""

log()  { printf '[onehammer-install] %s\n' "$*"; }
warn() { printf '[onehammer-install] WARN: %s\n' "$*" >&2; }
die()  { printf '[onehammer-install] ERROR (%s): %s\n' "$PHASE" "$*" >&2; exit 1; }

cleanup() {
  if [[ -n "$TEMP_DIR" && -d "$TEMP_DIR" ]]; then
    rm -rf "$TEMP_DIR"
  fi
}

usage() {
  cat <<'EOF'
Usage:
  install.sh [options]

Options:
  --source-repo <url>  Override toolkit repository
  --ref <ref>          Branch, tag, or commit to install
  --target <path>      Override target project root (default: current directory)
  --analyze            Run gitnexus analyze after install
  --force              Reinstall managed CLIs and managed scaffold
  -h, --help           Show help

Environment variables (CLI arguments win):
  ONEHAMMER_SOURCE_REPO, ONEHAMMER_SOURCE_REF, ONEHAMMER_TARGET_DIR,
  ONEHAMMER_FORCE, ONEHAMMER_ANALYZE, ONEHAMMER_HERDR_INSTALL_URL
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --source-repo)
        [[ $# -ge 2 ]] || die "--source-repo requires a value"
        SOURCE_REPO="$2"; shift ;;
      --ref)
        [[ $# -ge 2 ]] || die "--ref requires a value"
        SOURCE_REF="$2"; shift ;;
      --target)
        [[ $# -ge 2 ]] || die "--target requires a value"
        TARGET_DIR="$2"; shift ;;
      --analyze)       RUN_ANALYZE=1 ;;
      --force)         FORCE_INSTALL=1 ;;
      -h|--help)       usage; exit 0 ;;
      *)               usage >&2; die "unknown option: $1" ;;
    esac
    shift
  done

  [[ -n "$SOURCE_REPO" ]] || die "source repository must not be empty"
  [[ -n "$SOURCE_REF" ]]  || die "source ref must not be empty"
}

resolve_target_root() {
  PHASE="resolve-target"
  if [[ -n "$TARGET_DIR" ]]; then
    [[ -d "$TARGET_DIR" ]] || die "target directory does not exist: $TARGET_DIR"
    TARGET_ROOT="$(cd "$TARGET_DIR" && pwd -P)"
  else
    # Install into the current directory — no Git-root resolution, what you
    # stand in is what gets installed.
    TARGET_ROOT="$(pwd -P)"
  fi
  [[ -n "$TARGET_ROOT" && "$TARGET_ROOT" != "/" ]] || die "refusing to install into: '$TARGET_ROOT'"
  log "target project: $TARGET_ROOT"
}

check_prerequisites() {
  PHASE="preflight"
  local cmd
  for cmd in git curl awk node npm; do
    command -v "$cmd" >/dev/null 2>&1 \
      || die "$cmd is required before installing OneHammer"
  done
}

ensure_jq() {
  PHASE="ensure-jq"
  if command -v jq >/dev/null 2>&1 && jq --version >/dev/null 2>&1; then
    log "jq already installed: $(command -v jq)"
    return 0
  fi

  log "jq not found, installing"

  # Prefer the host package manager when we have privileges
  local sudo_cmd=""
  if [[ "$(id -u)" != "0" ]]; then
    if command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
      sudo_cmd="sudo -n"
    fi
  fi

  if [[ "$(id -u)" == "0" || -n "$sudo_cmd" ]]; then
    if command -v apt-get >/dev/null 2>&1; then
      if DEBIAN_FRONTEND=noninteractive $sudo_cmd apt-get update -qq \
        && DEBIAN_FRONTEND=noninteractive $sudo_cmd apt-get install -y -qq jq; then
        jq --version >/dev/null 2>&1 && { log "jq installed via apt-get: $(command -v jq)"; return 0; }
      fi
      warn "apt-get install jq failed, falling back to official binary"
    elif command -v dnf >/dev/null 2>&1; then
      if $sudo_cmd dnf install -y -q jq; then
        jq --version >/dev/null 2>&1 && { log "jq installed via dnf: $(command -v jq)"; return 0; }
      fi
      warn "dnf install jq failed, falling back to official binary"
    elif command -v yum >/dev/null 2>&1; then
      if $sudo_cmd yum install -y -q jq; then
        jq --version >/dev/null 2>&1 && { log "jq installed via yum: $(command -v jq)"; return 0; }
      fi
      warn "yum install jq failed, falling back to official binary"
    fi
  fi

  if [[ "$(uname -s)" == "Darwin" ]] && command -v brew >/dev/null 2>&1; then
    if brew install jq; then
      jq --version >/dev/null 2>&1 && { log "jq installed via brew: $(command -v jq)"; return 0; }
    fi
    warn "brew install jq failed, falling back to official binary"
  fi

  install_jq_binary
}

install_jq_binary() {
  local os arch asset sha
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os/$arch" in
    Linux/x86_64)           asset="jq-linux-amd64"; sha="$JQ_SHA_LINUX_AMD64" ;;
    Linux/aarch64|Linux/arm64) asset="jq-linux-arm64"; sha="$JQ_SHA_LINUX_ARM64" ;;
    Darwin/x86_64)          asset="jq-macos-amd64"; sha="$JQ_SHA_MACOS_AMD64" ;;
    Darwin/arm64)           asset="jq-macos-arm64"; sha="$JQ_SHA_MACOS_ARM64" ;;
    *)
      die "no supported jq installation mechanism for $os/$arch; install jq manually and re-run" ;;
  esac

  mkdir -p "$LOCAL_BIN"
  local tmp_bin
  tmp_bin="$(mktemp)"
  curl -fsSL -o "$tmp_bin" "$JQ_BASE_URL/$asset" \
    || { rm -f "$tmp_bin"; die "failed to download jq from $JQ_BASE_URL/$asset"; }

  local actual
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$tmp_bin" | awk '{print $1}')"
  elif command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "$tmp_bin" | awk '{print $1}')"
  else
    rm -f "$tmp_bin"
    die "neither sha256sum nor shasum is available to verify the jq download"
  fi

  if [[ "$actual" != "$sha" ]]; then
    rm -f "$tmp_bin"
    die "jq checksum mismatch for $asset (expected $sha, got $actual)"
  fi

  mv "$tmp_bin" "$LOCAL_BIN/jq"
  chmod +x "$LOCAL_BIN/jq"
  hash -r
  jq --version >/dev/null 2>&1 || die "installed jq binary is not runnable"
  log "jq $JQ_VERSION installed: $LOCAL_BIN/jq"
}

fetch_source() {
  PHASE="fetch-source"
  local src_dir="$TEMP_DIR/onehammer"

  log "fetching $SOURCE_REPO@$SOURCE_REF"
  if ! git clone --depth 1 --branch "$SOURCE_REF" "$SOURCE_REPO" "$src_dir" 2>/dev/null; then
    # Fallback for refs that cannot be shallow-cloned as branch/tag (e.g. a commit SHA)
    warn "shallow clone of ref '$SOURCE_REF' failed, trying full clone + checkout"
    rm -rf "$src_dir"
    git clone "$SOURCE_REPO" "$src_dir" \
      || die "unable to clone source repository: $SOURCE_REPO"
    git -C "$src_dir" checkout --quiet "$SOURCE_REF" \
      || die "unable to checkout ref: $SOURCE_REF"
  fi

  SOURCE_COMMIT="$(git -C "$src_dir" rev-parse HEAD)"
  log "source commit: $SOURCE_COMMIT"

  SRC_ROOT="$src_dir"

  case "$TARGET_ROOT/" in
    "$TEMP_DIR"/*) die "target project must not be the temporary source checkout" ;;
  esac
}

validate_source() {
  PHASE="validate-source"

  [[ -d "$SRC_ROOT/.claude/hooks" ]]        || die "missing mandatory source path: .claude/hooks/"
  [[ -f "$SRC_ROOT/.claude/settings.json" ]] || die "missing mandatory source path: .claude/settings.json"
  [[ -f "$SRC_ROOT/.mcp.json" ]]            || die "missing mandatory source path: .mcp.json"

  # Prefer .claude/skills/, fall back to .claude/.skills/
  if [[ -d "$SRC_ROOT/.claude/skills" ]]; then
    SRC_SKILL_ROOT="$SRC_ROOT/.claude/skills"
  elif [[ -d "$SRC_ROOT/.claude/.skills" ]]; then
    SRC_SKILL_ROOT="$SRC_ROOT/.claude/.skills"
  else
    die "missing skill root: neither .claude/skills/ nor .claude/.skills/ exists in source"
  fi

  local skill
  for skill in "${MANAGED_SKILLS[@]}"; do
    [[ -d "$SRC_SKILL_ROOT/$skill" ]] \
      || die "missing mandatory skill in source: $skill (looked in $SRC_SKILL_ROOT)"
  done
}

backup_if_different() {
  # $1 = source file, $2 = target file, $3 = display name
  local src="$1" dst="$2" name="$3"

  if [[ ! -f "$dst" ]]; then
    mkdir -p "$(dirname "$dst")"
    cp -a "$src" "$dst"
    log "installed $name"
    return 0
  fi

  if cmp -s "$src" "$dst"; then
    log "$name is already up to date"
    return 0
  fi

  if [[ -z "$BACKUP_DIR" ]]; then
    BACKUP_DIR="$TARGET_ROOT/.onehammer-backup/$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$BACKUP_DIR"
  fi
  cp -a "$dst" "$BACKUP_DIR/$(basename "$dst")"
  cp -a "$src" "$dst"
  log "$name differed; previous version backed up to $BACKUP_DIR/$(basename "$dst")"
}

install_scaffold() {
  PHASE="install-scaffold"

  # Hooks: merge, overwriting matching paths but preserving unrelated files
  mkdir -p "$TARGET_ROOT/.claude/hooks"
  cp -a "$SRC_ROOT/.claude/hooks/." "$TARGET_ROOT/.claude/hooks/"
  log "installed .claude/hooks/"

  # Managed skills: replace each directory as a complete unit
  mkdir -p "$TARGET_ROOT/.claude/skills"
  local skill
  for skill in "${MANAGED_SKILLS[@]}"; do
    rm -rf "${TARGET_ROOT:?}/.claude/skills/$skill"
    cp -a "$SRC_SKILL_ROOT/$skill" "$TARGET_ROOT/.claude/skills/$skill"
    log "installed .claude/skills/$skill/"
  done

  # JSON configs: never silently destroy existing project configuration
  backup_if_different "$SRC_ROOT/.claude/settings.json" "$TARGET_ROOT/.claude/settings.json" ".claude/settings.json"
  backup_if_different "$SRC_ROOT/.mcp.json" "$TARGET_ROOT/.mcp.json" ".mcp.json"
}

# ── Planning toolchain (formerly scripts/setup-planning-toolchain.sh) ────────

install_herdr() {
  PHASE="toolchain-herdr"

  mkdir -p "$LOCAL_BIN"
  export PATH="$LOCAL_BIN:$PATH"

  if [[ "$FORCE_INSTALL" == "1" ]] || ! command -v herdr >/dev/null 2>&1; then
    log "installing Herdr latest to $LOCAL_BIN"
    if ! curl -fsSL --retry 3 --connect-timeout 10 --max-time 30 "$HERDR_INSTALL_URL" \
      | HERDR_INSTALL_DIR="$LOCAL_BIN" sh; then
      die "failed to install Herdr from $HERDR_INSTALL_URL"
    fi
    hash -r
  else
    log "Herdr already installed: $(command -v herdr)"
  fi

  command -v herdr >/dev/null 2>&1 || die "herdr binary is still not on PATH after install"
  herdr --version >/dev/null 2>&1 || die "herdr --version failed"
  log "Herdr health ok: $(herdr --version)"
}

install_planning_clis() {
  PHASE="toolchain-clis"

  local npm_prefix
  npm_prefix="$(npm prefix -g 2>/dev/null || npm config get prefix)"
  mkdir -p "$LOCAL_BIN"
  export PATH="$LOCAL_BIN:$npm_prefix/bin:$PATH"

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

  if [[ -d "$TARGET_ROOT/.beads" ]]; then
    log "Beads workspace already initialized: $TARGET_ROOT/.beads"
  else
    log "initializing Beads workspace"
    (cd "$TARGET_ROOT" && br init)
  fi
}

install_gitnexus() {
  PHASE="toolchain-gitnexus"

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

  local npm_global_root gitnexus_cli_path package_hook_dir hook_src
  npm_global_root="$(npm root -g)"
  gitnexus_cli_path="$npm_global_root/gitnexus/dist/cli/index.js"
  package_hook_dir="$npm_global_root/gitnexus/hooks/claude"
  [[ -f "$gitnexus_cli_path" ]] || die "GitNexus CLI not found: $gitnexus_cli_path"
  [[ -d "$package_hook_dir" ]] || die "GitNexus package hook dir not found: $package_hook_dir"

  mkdir -p "$USER_HOOK_DIR"

  hook_src="$package_hook_dir/gitnexus-hook.cjs"
  [[ -f "$hook_src" ]] || die "GitNexus hook source not found: $hook_src"

  HOOK_SRC="$hook_src" USER_HOOK_FILE="$USER_HOOK_FILE" GITNEXUS_CLI_PATH="$gitnexus_cli_path" node <<'NODE'
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

  local helper
  for helper in hook-lock.cjs hook-db-lock-probe.cjs resolve-analyze-cmd.cjs pre-tool-use.sh session-start.sh win-rm-list-json.ps1; do
    if [[ -f "$package_hook_dir/$helper" ]]; then
      cp -a "$package_hook_dir/$helper" "$USER_HOOK_DIR/$helper"
    fi
  done

  chmod +x "$USER_HOOK_FILE" "$USER_HOOK_DIR/pre-tool-use.sh" "$USER_HOOK_DIR/session-start.sh" 2>/dev/null || true
  log "user hook installed: $USER_HOOK_FILE"

  if [[ -d "$TARGET_ROOT/.claude/hooks/gitnexus" ]]; then
    rm -rf "$TARGET_ROOT/.claude/hooks/gitnexus"
    log "removed project-local copied hook: $TARGET_ROOT/.claude/hooks/gitnexus"
  fi
}

wire_project_settings() {
  PHASE="toolchain-settings"

  local project_settings="$TARGET_ROOT/.claude/settings.json"
  mkdir -p "$(dirname "$project_settings")"

  HOOK_COMMAND='node "$HOME/.claude/hooks/gitnexus/gitnexus-hook.cjs"' \
  PROJECT_SETTINGS="$project_settings" node <<'NODE'
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
  log "settings updated: $project_settings"

  if [[ "$RUN_ANALYZE" == "1" ]]; then
    log "running gitnexus analyze"
    (cd "$TARGET_ROOT" && gitnexus analyze)
  else
    log "skipping gitnexus analyze"
  fi

  printf '{"hook_event_name":"PreToolUse","cwd":"%s","tool_name":"Grep","tool_input":{"pattern":"setupGitNexus"}}' "$TARGET_ROOT" \
    | node "$USER_HOOK_FILE" >/dev/null
  log "hook smoke test passed"
}

verify_installation() {
  PHASE="verify"

  local path
  for path in \
    "$TARGET_ROOT/.claude/hooks" \
    "$TARGET_ROOT/.claude/skills/planning" \
    "$TARGET_ROOT/.claude/skills/onehammer-forge" \
    "$TARGET_ROOT/.beads"; do
    [[ -d "$path" ]] || die "verification failed, missing directory: $path"
  done

  for path in \
    "$TARGET_ROOT/.claude/settings.json" \
    "$TARGET_ROOT/.mcp.json"; do
    [[ -f "$path" ]] || die "verification failed, missing file: $path"
  done

  jq empty "$TARGET_ROOT/.claude/settings.json" || die "invalid JSON: .claude/settings.json"
  jq empty "$TARGET_ROOT/.mcp.json" || die "invalid JSON: .mcp.json"

  br --help >/dev/null 2>&1 || die "br health check failed"
  bv --help >/dev/null 2>&1 || die "bv health check failed"
  jq --version >/dev/null 2>&1 || die "jq health check failed"
  gitnexus --help >/dev/null 2>&1 || die "gitnexus health check failed"
  herdr --version >/dev/null 2>&1 || die "herdr health check failed"
}

print_summary() {
  PHASE="summary"
  log "installation complete"
  log "target: $TARGET_ROOT"
  log "source: $SOURCE_REPO@$SOURCE_REF"
  log "source commit: $SOURCE_COMMIT"
  log "installed: .claude/hooks, .claude/skills/{planning,onehammer-forge}, .claude/settings.json, .mcp.json, .beads"
  log "br: $(command -v br)"
  log "bv: $(command -v bv)"
  log "jq: $(command -v jq)"
  log "gitnexus: $(command -v gitnexus)"
  log "herdr: $(command -v herdr)"
  if [[ -n "$BACKUP_DIR" ]]; then
    log "previous configuration backed up under: $BACKUP_DIR"
  fi
  case ":$PATH:" in
    *":$LOCAL_BIN:"*) ;;
    *) warn "add $LOCAL_BIN to your PATH to use br/bv/herdr in new shells" ;;
  esac
  log "restart Claude Code to reload project settings"
}

main() {
  parse_args "$@"

  resolve_target_root
  check_prerequisites
  ensure_jq

  TEMP_DIR="$(mktemp -d)"
  trap cleanup EXIT INT TERM

  fetch_source
  validate_source
  install_scaffold

  install_herdr
  install_planning_clis
  install_gitnexus
  wire_project_settings

  verify_installation
  print_summary
}

# Redirect stdin from /dev/null so that no inner command can consume the
# remainder of the script when it is executed via `curl ... | bash`.
main "$@" </dev/null
