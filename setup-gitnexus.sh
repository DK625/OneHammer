#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  setup-gitnexus.sh — One-command GitNexus setup for fullstack projects
#
#  Usage (run from project root):
#    bash setup-gitnexus.sh
#
#  Or via curl (from project root):
#    curl -fsSL https://raw.githubusercontent.com/your-org/your-repo/main/setup-gitnexus.sh | bash
#
#  What this script does:
#    1. Install gitnexus@latest globally (binary, not npx)
#    2. Run gitnexus setup (configure editors + skills + hooks globally)
#    3. Analyze codebase (build knowledge graph → generate CLAUDE.md, AGENTS.md, skills)
#    4. Move MCP config: ~/.mcp.json → .mcp.json (project scope, binary command)
#    5. Move hooks: ~/.claude/settings.json → .claude/settings.json (project scope)
#    6. Copy + install custom hook JS (block Grep/Glob/Read + Serena redirect + cascade context→query→augment)
#    7. Remove global skills (project has its own from analyze)
#    8. Append workspace structure + technical guidelines to CLAUDE.md
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Colors ───────────────────────────────────────────────────────────────────
CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'

log()  { echo -e "${CYAN}[setup]${NC} $1"; }
ok()   { echo -e "${GREEN}  ✓${NC} $1"; }
warn() { echo -e "${YELLOW}  ⚠${NC}  $1"; }
die()  { echo -e "${RED}  ✗${NC} $1"; exit 1; }
step() { echo -e "\n${BOLD}── Step $1 ──────────────────────────────────────${NC}"; }

# ── Paths ─────────────────────────────────────────────────────────────────────
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
GLOBAL_MCP="$HOME/.mcp.json"
GLOBAL_SETTINGS="$HOME/.claude/settings.json"
GLOBAL_SKILLS_DIR="$HOME/.claude/skills/gitnexus"
GLOBAL_HOOK_SRC="$HOME/.claude/hooks/gitnexus/gitnexus-hook.cjs"

PROJECT_MCP="$PROJECT_ROOT/.mcp.json"
PROJECT_CLAUDE_DIR="$PROJECT_ROOT/.claude"
PROJECT_SETTINGS="$PROJECT_CLAUDE_DIR/settings.json"
PROJECT_HOOK_DIR="$PROJECT_CLAUDE_DIR/hooks/gitnexus"
PROJECT_HOOK_FILE="$PROJECT_HOOK_DIR/gitnexus-hook.cjs"
CLAUDE_MD="$PROJECT_ROOT/CLAUDE.md"

echo -e "\n${BOLD}${CYAN}GitNexus Setup${NC} — ${PROJECT_ROOT}\n"

# ── Prereqs ───────────────────────────────────────────────────────────────────
command -v node >/dev/null 2>&1 || die "Node.js is required. Install via: https://nodejs.org"
command -v npm  >/dev/null 2>&1 || die "npm is required."
command -v jq   >/dev/null 2>&1 || die "jq is required. Install with: apt install jq  (or brew install jq)"

# ─────────────────────────────────────────────────────────────────────────────
step "1/8 — Install gitnexus@latest globally"
# ─────────────────────────────────────────────────────────────────────────────
npm install -g gitnexus@latest --silent 2>/dev/null || npm install -g gitnexus@latest
GITNEXUS_BIN="$(which gitnexus)"
ok "gitnexus $(gitnexus --version) → $GITNEXUS_BIN"

# ─────────────────────────────────────────────────────────────────────────────
step "2/8 — gitnexus setup (configure editors, skills, hooks globally)"
# ─────────────────────────────────────────────────────────────────────────────
gitnexus setup
ok "MCP, hooks, and skills configured globally"

# ─────────────────────────────────────────────────────────────────────────────
step "3/8 — Analyze codebase (build knowledge graph)"
# ─────────────────────────────────────────────────────────────────────────────
cd "$PROJECT_ROOT"
gitnexus analyze
ok "Knowledge graph built → CLAUDE.md, AGENTS.md, and skills generated"

# ─────────────────────────────────────────────────────────────────────────────
step "4/8 — Move MCP config: ~/.mcp.json → .mcp.json (project scope)"
# ─────────────────────────────────────────────────────────────────────────────
# After setup, gitnexus MCP entry is in ~/.mcp.json with npx command.
# We move it to project .mcp.json and use the global binary directly
# to avoid npm registry timeout (30s) on every session start.

if [[ ! -f "$GLOBAL_MCP" ]]; then
  warn "~/.mcp.json not found — creating project .mcp.json from scratch"
  cat > "$PROJECT_MCP" << 'EOF'
{
  "mcpServers": {
    "gitnexus": {
      "command": "gitnexus",
      "args": ["mcp"]
    }
  }
}
EOF
else
  # Extract existing project .mcp.json (if any) and merge
  EXISTING_PROJECT_MCP="{}"
  [[ -f "$PROJECT_MCP" ]] && EXISTING_PROJECT_MCP=$(cat "$PROJECT_MCP")

  # Build new project .mcp.json: keep existing entries, add/override gitnexus with binary command
  jq -n \
    --argjson existing "$EXISTING_PROJECT_MCP" \
    --arg bin "$GITNEXUS_BIN" \
    '$existing * {"mcpServers": {"gitnexus": {"command": $bin, "args": ["mcp"]}}}' \
    > "$PROJECT_MCP"

  # Remove gitnexus from ~/.mcp.json
  jq 'del(.mcpServers.gitnexus)' "$GLOBAL_MCP" > "$GLOBAL_MCP.tmp" \
    && mv "$GLOBAL_MCP.tmp" "$GLOBAL_MCP"
fi

ok "MCP config → $PROJECT_MCP (using binary: $GITNEXUS_BIN)"

# ─────────────────────────────────────────────────────────────────────────────
step "5/8 — Move hooks: ~/.claude/settings.json → .claude/settings.json (project scope)"
# ─────────────────────────────────────────────────────────────────────────────
mkdir -p "$PROJECT_CLAUDE_DIR"

if [[ ! -f "$GLOBAL_SETTINGS" ]]; then
  warn "~/.claude/settings.json not found — skipping hook migration"
else
  # Extract only the PreToolUse / PostToolUse hook blocks that reference gitnexus
  GITNEXUS_HOOKS=$(jq '{
    "PreToolUse": (.hooks.PreToolUse // [] | map(select(.hooks[]?.command | test("gitnexus"; "i")))),
    "PostToolUse": (.hooks.PostToolUse // [] | map(select(.hooks[]?.command | test("gitnexus"; "i"))))
  }' "$GLOBAL_SETTINGS")

  if [[ -f "$PROJECT_SETTINGS" ]]; then
    # Merge into existing project settings — hooks array concat, not replace
    jq -s '
      .[0] as $proj | .[1] as $gn |
      $proj * {
        "hooks": {
          "PreToolUse":  (($proj.hooks.PreToolUse  // []) + ($gn.PreToolUse  // []) | unique_by(.matcher)),
          "PostToolUse": (($proj.hooks.PostToolUse // []) + ($gn.PostToolUse // []) | unique_by(.matcher))
        }
      }
    ' "$PROJECT_SETTINGS" <(echo "$GITNEXUS_HOOKS") > "$PROJECT_SETTINGS.tmp" \
      && mv "$PROJECT_SETTINGS.tmp" "$PROJECT_SETTINGS"
  else
    echo "{\"hooks\": $GITNEXUS_HOOKS}" | jq '.' > "$PROJECT_SETTINGS"
  fi

  # Remove gitnexus hooks from global settings
  jq 'del(.hooks.PreToolUse[]  | select(.hooks[]?.command | test("gitnexus"; "i")))
    | del(.hooks.PostToolUse[] | select(.hooks[]?.command | test("gitnexus"; "i")))' \
    "$GLOBAL_SETTINGS" > "$GLOBAL_SETTINGS.tmp" \
    && mv "$GLOBAL_SETTINGS.tmp" "$GLOBAL_SETTINGS"

  ok "Hooks migrated to $PROJECT_SETTINGS"
fi

# ─────────────────────────────────────────────────────────────────────────────
step "6/8 — Install custom hook JS (block Grep/Glob/Read + Serena redirect + cascade enrichment)"
# ─────────────────────────────────────────────────────────────────────────────
mkdir -p "$PROJECT_HOOK_DIR"

# Resolve the gitnexus CLI path for the hook (prefer global node_modules path)
GITNEXUS_CLI_PATH=$(node -e "try{console.log(require.resolve('gitnexus/dist/cli/index.js'))}catch{console.log('')}" 2>/dev/null || echo "")

if [[ -f "$GLOBAL_HOOK_SRC" ]]; then
  # Copy the hook and update the hardcoded CLI path to current global install
  sed "s|let cliPath = \"[^\"]*\"|let cliPath = \"${GITNEXUS_CLI_PATH}\"|" \
    "$GLOBAL_HOOK_SRC" > "$PROJECT_HOOK_FILE"
  ok "Hook copied + CLI path updated → $PROJECT_HOOK_FILE"
else
  warn "Global hook not found at $GLOBAL_HOOK_SRC — writing template"
  # Write minimal hook template (full cascade: context → query → augment)
  cat > "$PROJECT_HOOK_FILE" << 'HOOKEOF'
#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function readInput() {
  try { return JSON.parse(fs.readFileSync(0, 'utf-8')); } catch { return {}; }
}

function findGitNexusDir(startDir) {
  let dir = startDir || process.cwd();
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, '.gitnexus');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function resolveCliPath() {
  try { return require.resolve('gitnexus/dist/cli/index.js'); } catch { return ''; }
}

function runGitNexusCli(cliPath, args, cwd, timeout) {
  if (cliPath) {
    return spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf-8', timeout, cwd, stdio: ['pipe','pipe','pipe'] });
  }
  return spawnSync('npx', ['-y', 'gitnexus', ...args], { encoding: 'utf-8', timeout: timeout + 5000, cwd, stdio: ['pipe','pipe','pipe'] });
}

function extractPattern(toolName, toolInput) {
  if (toolName === 'Grep') return toolInput.pattern || null;
  if (toolName === 'Glob') {
    const raw = toolInput.pattern || '';
    const match = raw.match(/[*\/]([a-zA-Z][a-zA-Z0-9_-]{2,})/);
    return match ? match[1] : null;
  }
  if (toolName === 'Bash') {
    const cmd = toolInput.command || '';
    if (/\brg\b|\bgrep\b/.test(cmd)) {
      const tokens = cmd.split(/\s+/);
      let foundCmd = false, skipNext = false;
      const flagsWithValues = new Set(['-e','-f','-m','-A','-B','-C','-g','--glob','-t','--type','--include','--exclude']);
      for (const token of tokens) {
        if (skipNext) { skipNext = false; continue; }
        if (!foundCmd) { if (/\brg$|\bgrep$/.test(token)) foundCmd = true; continue; }
        if (token.startsWith('-')) { if (flagsWithValues.has(token)) skipNext = true; continue; }
        const cleaned = token.replace(/['"]/g, '');
        return cleaned.length >= 3 ? cleaned : null;
      }
      return null;
    }
    if (/\bfind\b/.test(cmd)) {
      const nameMatch = cmd.match(/-name\s+['"]?([^'"\s|;]+)['"]?/);
      if (nameMatch) {
        const stripped = nameMatch[1].replace(/[*?'"]/g, '').replace(/\.[^.]+$/, '');
        if (stripped.length >= 3) return stripped;
      }
      const pathMatch = cmd.match(/-path\s+['"]?([^'"\s|;]+)['"]?/);
      if (pathMatch) {
        const segments = pathMatch[1].split('/').map(s => s.replace(/[*?'"]/g, '')).filter(s => s.length >= 3);
        if (segments.length > 0) return segments[segments.length - 1];
      }
      return null;
    }
  }
  return null;
}

function enrichWithGitNexus(cliPath, pattern, cwd, totalTimeout) {
  const isIdentifier = /^[a-zA-Z_][a-zA-Z0-9_]{2,}$/.test(pattern);
  const half = Math.floor(totalTimeout * 0.45);
  if (isIdentifier) {
    try {
      const child = runGitNexusCli(cliPath, ['context', pattern], cwd, half);
      if (!child.error && child.status === 0) {
        const out = (child.stdout || '').trim();
        if (out && !out.includes('"status": "ambiguous"') && !out.includes('"status": "not_found"') && out !== '{}') return out;
      }
    } catch {}
  }
  try {
    const child = runGitNexusCli(cliPath, ['query', pattern], cwd, half);
    if (!child.error && child.status === 0) {
      const out = (child.stdout || '').trim();
      if (out && out !== '{"processes":[]}' && out !== '{}') return out;
    }
  } catch {}
  try {
    const child = runGitNexusCli(cliPath, ['augment', '--', pattern], cwd, Math.floor(totalTimeout * 0.4));
    if (!child.error && child.status === 0) {
      const out = (child.stderr || '').trim();
      if (out) return out;
    }
  } catch {}
  return '';
}

// Block Grep/Glob immediately (exit 2 = Claude Code block mechanism)
// No enrichment before block — avoids timeout causing block to fail
function blockWithContext(pattern) {
  const name = pattern || '…';
  const reason = [
    'Grep/Glob blocked — dùng Serena (LSP) hoặc GitNexus thay thế.',
    '',
    '• mcp__serena__find_symbol({name: "' + name + '"})',
    '• mcp__serena__find_referencing_symbols({name: "' + name + '"})',
    '• mcp__gitnexus__context({name: "' + name + '"})',
    '• mcp__gitnexus__query({query: "' + name + '"})',
    '• Bash(grep / find)  ← escape hatch nếu MCP không đủ',
  ].join('\n');
  process.stderr.write(reason + '\n');
  process.exit(2);
}

// Block broad Read of code files — redirect to Serena symbol-first
const CODE_EXTS = /\.(py|ts|tsx|js|jsx)$/;
const NARROW_LIMIT = 100;

function handleRead(toolInput, cwd) {
  const filePath = toolInput.file_path || '';
  if (!CODE_EXTS.test(filePath)) return; // non-code → allow
  const limit = toolInput.limit;
  const hasNarrowLimit = typeof limit === 'number' && limit <= NARROW_LIMIT;
  if (hasNarrowLimit) return; // targeted read → allow
  const rel = filePath.replace(cwd + '/', '').replace(/^\/opt\/[^/]+\//, '');
  const reason = [
    'Read(' + rel + ') blocked — dùng Serena để đọc theo symbol, không đọc cả file.',
    '',
    '1. Overview:   mcp__serena__get_symbols_overview({path: "' + rel + '"})',
    '2. Symbol:     mcp__serena__find_symbol({name: "SymbolName", include_body: true, relative_path: "' + rel + '"})',
    '3. Refs:       mcp__serena__find_referencing_symbols({name: "SymbolName"})',
    '4. GitNexus:   mcp__gitnexus__context({name: "SymbolName"})',
    '5. Fallback:   Read với offset+limit ≤ ' + NARROW_LIMIT + ' dòng nếu cần context xung quanh',
  ].join('\n');
  process.stderr.write(reason + '\n');
  process.exit(2);
}

function sendHookResponse(hookEventName, message) {
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext: message } }));
}

function handlePreToolUse(input) {
  const cwd = input.cwd || process.cwd();
  if (!path.isAbsolute(cwd) || !findGitNexusDir(cwd)) return;
  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};
  if (!['Grep','Glob','Bash','Read'].includes(toolName)) return;

  // Read: symbol-first redirect
  if (toolName === 'Read') { handleRead(toolInput, cwd); return; }

  const pattern = extractPattern(toolName, toolInput);

  // Grep/Glob: block immediately (no enrichment — avoids hook timeout)
  if (toolName === 'Grep' || toolName === 'Glob') {
    blockWithContext(pattern || '');
    return;
  }

  // Bash: enrich context (no block — escape hatch)
  if (!pattern || pattern.length < 3) return;
  const result = enrichWithGitNexus(resolveCliPath(), pattern, cwd, 12000);
  if (result) sendHookResponse('PreToolUse', result);
}

function handlePostToolUse(input) {
  const toolName = input.tool_name || '';
  if (toolName !== 'Bash') return;
  const command = (input.tool_input || {}).command || '';
  if (!/\bgit\s+(commit|merge|rebase|cherry-pick|pull)(\s|$)/.test(command)) return;
  const toolOutput = input.tool_output || {};
  if (toolOutput.exit_code !== undefined && toolOutput.exit_code !== 0) return;
  const cwd = input.cwd || process.cwd();
  if (!path.isAbsolute(cwd)) return;
  const gitNexusDir = findGitNexusDir(cwd);
  if (!gitNexusDir) return;
  let currentHead = '';
  try {
    const r = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8', timeout: 3000, cwd, stdio: ['pipe','pipe','pipe'] });
    currentHead = (r.stdout || '').trim();
  } catch { return; }
  if (!currentHead) return;
  let lastCommit = '', hadEmbeddings = false;
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(gitNexusDir, 'meta.json'), 'utf-8'));
    lastCommit = meta.lastCommit || '';
    hadEmbeddings = meta.stats && meta.stats.embeddings > 0;
  } catch {}
  if (currentHead === lastCommit) return;
  const analyzeCmd = `gitnexus analyze${hadEmbeddings ? ' --embeddings' : ''}`;
  sendHookResponse('PostToolUse', `GitNexus index stale (last: ${lastCommit ? lastCommit.slice(0,7) : 'never'}). Run \`${analyzeCmd}\` to update.`);
}

function main() {
  try {
    const input = readInput();
    const handlers = { PreToolUse: handlePreToolUse, PostToolUse: handlePostToolUse };
    const handler = handlers[input.hook_event_name || ''];
    if (handler) handler(input);
  } catch {}
}
main();
HOOKEOF
  ok "Hook template written → $PROJECT_HOOK_FILE"
fi

# Update hook command path in project settings.json to use project-local hook
HOOK_CMD="node \"${PROJECT_HOOK_FILE}\""
if [[ -f "$PROJECT_SETTINGS" ]]; then
  # Replace any absolute ~/.claude/hooks path with the project-local path
  sed -i "s|node \"[^\"]*gitnexus-hook.cjs\"|${HOOK_CMD}|g" "$PROJECT_SETTINGS"
  ok "Hook path updated in $PROJECT_SETTINGS"
fi

# Update settings: timeout 15s + ensure matcher includes Read (for V2 Read block)
if [[ -f "$PROJECT_SETTINGS" ]]; then
  jq '
    .hooks.PreToolUse[].hooks[].timeout  = 15 |
    .hooks.PostToolUse[].hooks[].timeout = 10 |
    .hooks.PreToolUse[].matcher = "Grep|Glob|Bash|Read"
  ' "$PROJECT_SETTINGS" > "$PROJECT_SETTINGS.tmp" \
    && mv "$PROJECT_SETTINGS.tmp" "$PROJECT_SETTINGS" 2>/dev/null || true
  ok "Settings: timeout=15s, matcher=Grep|Glob|Bash|Read"
fi

# ─────────────────────────────────────────────────────────────────────────────
step "7/8 — Remove global skills (project has its own from analyze)"
# ─────────────────────────────────────────────────────────────────────────────
if [[ -d "$GLOBAL_SKILLS_DIR" ]]; then
  rm -rf "$GLOBAL_SKILLS_DIR"
  ok "Global skills removed: $GLOBAL_SKILLS_DIR"
else
  warn "Global skills not found — already removed or not installed"
fi

# ─────────────────────────────────────────────────────────────────────────────
step "8/8 — Append workspace structure + technical guidelines to CLAUDE.md"
# ─────────────────────────────────────────────────────────────────────────────
if grep -q "workspace structure" "$CLAUDE_MD" 2>/dev/null; then
  warn "workspace structure already in CLAUDE.md — skipping"
else
  cat >> "$CLAUDE_MD" << 'WSEOF'

## workspace structure
this workspace is indexed as a single project root containing two main components:
- **onehammerStore**: python backend
- **onehammerUI**: nextjs frontend

### fullstack workflow
1. analyze backend impact in onehammerStore directory first
2. extract the api/contract changes explicitly
3. analyze frontend impact in onehammerUI based on that contract
4. produce one merged fullstack plan

### technical guidelines
- do not search for onehammerStore or onehammerUI as separate repositories
- all file paths must be relative to the root (e.g., `onehammerStore/main.py` or `onehammerUI/src/app`)
- treat the backend as the source of truth for api contracts
WSEOF
  ok "workspace structure appended to $CLAUDE_MD"
fi

# ─────────────────────────────────────────────────────────────────────────────
echo -e "\n${GREEN}${BOLD}═══════════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  GitNexus setup complete!${NC}"
echo -e "${GREEN}${BOLD}═══════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${CYAN}Knowledge graph:${NC}   $(gitnexus status 2>/dev/null | grep -oP '\d+,?\d* nodes' || echo 'run gitnexus status')"
echo -e "  ${CYAN}MCP config:${NC}        $PROJECT_MCP"
echo -e "  ${CYAN}Hook:${NC}              $PROJECT_HOOK_FILE"
echo -e "  ${CYAN}Project settings:${NC}  $PROJECT_SETTINGS"
echo ""
echo -e "  ${YELLOW}Next step:${NC} Restart Claude Code to reload MCP server."
echo ""
