# =============================================================================
#  setup-gitnexus.ps1 — One-command GitNexus setup for fullstack projects
#
#  Usage (run from project root):
#    powershell -ExecutionPolicy Bypass -File setup-gitnexus.ps1
#
#  What this script does:
#    1. Install gitnexus@1.5.3 globally (binary, not npx)
#    2. Run gitnexus setup (configure editors + skills + hooks globally)
#    3. Analyze codebase (build knowledge graph -> generate CLAUDE.md, AGENTS.md, skills)
#    4. Move MCP config: ~\.mcp.json -> .mcp.json (project scope, binary command)
#    5. Move hooks: ~\.claude\settings.json -> .claude\settings.json (project scope)
#    6. Copy + install custom hook JS (block Grep/Glob/Read + Serena redirect + cascade)
#    7. Remove global skills (project has its own from analyze)
#    8. Append workspace structure + technical guidelines to CLAUDE.md
# =============================================================================

#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Colors / Logging ──────────────────────────────────────────────────────────
function log  { param($msg) Write-Host "[setup] $msg" -ForegroundColor Cyan }
function ok   { param($msg) Write-Host "  v $msg"     -ForegroundColor Green }
function warn { param($msg) Write-Host "  ! $msg"     -ForegroundColor Yellow }
function die  { param($msg) Write-Host "  x $msg"     -ForegroundColor Red; exit 1 }
function step { param($msg) Write-Host "`n-- $msg ----------------------------------" -ForegroundColor White }

# ── Paths ─────────────────────────────────────────────────────────────────────
$PROJECT_ROOT       = $PSScriptRoot
if (-not $PROJECT_ROOT) { $PROJECT_ROOT = (Get-Location).Path }

$GLOBAL_MCP         = Join-Path $env:USERPROFILE ".mcp.json"
$GLOBAL_SETTINGS    = Join-Path $env:USERPROFILE ".claude\settings.json"
$GLOBAL_SKILLS_DIR  = Join-Path $env:USERPROFILE ".claude\skills\gitnexus"
$GLOBAL_HOOK_SRC    = Join-Path $env:USERPROFILE ".claude\hooks\gitnexus\gitnexus-hook.cjs"

$PROJECT_MCP        = Join-Path $PROJECT_ROOT ".mcp.json"
$PROJECT_CLAUDE_DIR = Join-Path $PROJECT_ROOT ".claude"
$PROJECT_SETTINGS   = Join-Path $PROJECT_CLAUDE_DIR "settings.json"
$PROJECT_HOOK_DIR   = Join-Path $PROJECT_CLAUDE_DIR "hooks\gitnexus"
$PROJECT_HOOK_FILE  = Join-Path $PROJECT_HOOK_DIR "gitnexus-hook.cjs"
$CLAUDE_MD          = Join-Path $PROJECT_ROOT "CLAUDE.md"

Write-Host "`nGitNexus Setup -- $PROJECT_ROOT`n" -ForegroundColor Cyan

# ── Prereqs ───────────────────────────────────────────────────────────────────
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    die "Node.js is required. Install via: https://nodejs.org"
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    die "npm is required."
}
if (-not (Get-Command jq -ErrorAction SilentlyContinue)) {
    warn "jq not found -- using PowerShell JSON handling (install: winget install jqlang.jq)"
}

# =============================================================================
step "1/8 -- Install gitnexus@1.5.3 globally"
# =============================================================================
npm install -g gitnexus@1.5.3 --silent 2>$null
if ($LASTEXITCODE -ne 0) { npm install -g gitnexus@1.5.3 }

$GITNEXUS_BIN = (Get-Command gitnexus -ErrorAction SilentlyContinue).Source
if (-not $GITNEXUS_BIN) { die "gitnexus binary not found after install." }

$GITNEXUS_VERSION = (gitnexus --version 2>$null)
ok "gitnexus $GITNEXUS_VERSION -> $GITNEXUS_BIN"

# =============================================================================
step "2/8 -- gitnexus setup (configure editors, skills, hooks globally)"
# =============================================================================
gitnexus setup
if ($LASTEXITCODE -ne 0) { die "gitnexus setup failed." }
ok "MCP, hooks, and skills configured globally"

# =============================================================================
step "3/8 -- Analyze codebase (build knowledge graph)"
# =============================================================================
Push-Location $PROJECT_ROOT
gitnexus analyze
if ($LASTEXITCODE -ne 0) { Pop-Location; die "gitnexus analyze failed." }
Pop-Location
ok "Knowledge graph built -> CLAUDE.md, AGENTS.md, and skills generated"

# =============================================================================
step "4/8 -- Move MCP config: ~\.mcp.json -> .mcp.json (project scope)"
# =============================================================================
if (-not (Test-Path $GLOBAL_MCP)) {
    warn "~\.mcp.json not found -- creating project .mcp.json from scratch"
    @{ mcpServers = @{ gitnexus = @{ command = "gitnexus"; args = @("mcp") } } } |
        ConvertTo-Json -Depth 10 | Set-Content $PROJECT_MCP -Encoding UTF8
} else {
    $existingProjectMcp = if (Test-Path $PROJECT_MCP) {
        Get-Content $PROJECT_MCP -Raw | ConvertFrom-Json -AsHashtable
    } else { @{} }

    if (-not $existingProjectMcp.ContainsKey('mcpServers')) { $existingProjectMcp['mcpServers'] = @{} }
    $existingProjectMcp['mcpServers']['gitnexus'] = @{ command = $GITNEXUS_BIN; args = @("mcp") }
    $existingProjectMcp | ConvertTo-Json -Depth 10 | Set-Content $PROJECT_MCP -Encoding UTF8

    $globalMcpObj = Get-Content $GLOBAL_MCP -Raw | ConvertFrom-Json -AsHashtable
    if ($globalMcpObj.ContainsKey('mcpServers') -and $globalMcpObj['mcpServers'].ContainsKey('gitnexus')) {
        $globalMcpObj['mcpServers'].Remove('gitnexus')
    }
    $globalMcpObj | ConvertTo-Json -Depth 10 | Set-Content $GLOBAL_MCP -Encoding UTF8
}
ok "MCP config -> $PROJECT_MCP (using binary: $GITNEXUS_BIN)"

# =============================================================================
step "5/8 -- Move hooks: ~\.claude\settings.json -> .claude\settings.json"
# =============================================================================
New-Item -ItemType Directory -Force -Path $PROJECT_CLAUDE_DIR | Out-Null

if (-not (Test-Path $GLOBAL_SETTINGS)) {
    warn "~\.claude\settings.json not found -- skipping hook migration"
} else {
    $globalSettingsObj = Get-Content $GLOBAL_SETTINGS -Raw | ConvertFrom-Json -AsHashtable

    function Get-GitNexusHooks {
        param([hashtable]$settings, [string]$hookType)
        if (-not $settings['hooks'] -or -not $settings['hooks'].ContainsKey($hookType)) { return @() }
        return @($settings['hooks'][$hookType] | Where-Object {
            $_.hooks | Where-Object { $_.command -match 'gitnexus' }
        })
    }

    $gnPreHooks  = Get-GitNexusHooks $globalSettingsObj 'PreToolUse'
    $gnPostHooks = Get-GitNexusHooks $globalSettingsObj 'PostToolUse'

    if (Test-Path $PROJECT_SETTINGS) {
        $projSettings = Get-Content $PROJECT_SETTINGS -Raw | ConvertFrom-Json -AsHashtable
        if (-not $projSettings.ContainsKey('hooks')) { $projSettings['hooks'] = @{} }
        $existPre  = if ($projSettings['hooks']['PreToolUse'])  { @($projSettings['hooks']['PreToolUse'])  } else { @() }
        $existPost = if ($projSettings['hooks']['PostToolUse']) { @($projSettings['hooks']['PostToolUse']) } else { @() }
        $projSettings['hooks']['PreToolUse']  = $existPre  + $gnPreHooks
        $projSettings['hooks']['PostToolUse'] = $existPost + $gnPostHooks
        $projSettings | ConvertTo-Json -Depth 10 | Set-Content $PROJECT_SETTINGS -Encoding UTF8
    } else {
        @{ hooks = @{ PreToolUse = $gnPreHooks; PostToolUse = $gnPostHooks } } |
            ConvertTo-Json -Depth 10 | Set-Content $PROJECT_SETTINGS -Encoding UTF8
    }

    foreach ($hookType in @('PreToolUse', 'PostToolUse')) {
        if ($globalSettingsObj['hooks'] -and $globalSettingsObj['hooks'].ContainsKey($hookType)) {
            $globalSettingsObj['hooks'][$hookType] = @(
                $globalSettingsObj['hooks'][$hookType] | Where-Object {
                    -not ($_.hooks | Where-Object { $_.command -match 'gitnexus' })
                }
            )
        }
    }
    $globalSettingsObj | ConvertTo-Json -Depth 10 | Set-Content $GLOBAL_SETTINGS -Encoding UTF8
    ok "Hooks migrated to $PROJECT_SETTINGS"
}

# =============================================================================
step "6/8 -- Install custom hook JS"
# =============================================================================
New-Item -ItemType Directory -Force -Path $PROJECT_HOOK_DIR | Out-Null

$GITNEXUS_CLI_PATH = (node -e "try{console.log(require.resolve('gitnexus/dist/cli/index.js'))}catch{console.log('')}" 2>$null)
$GITNEXUS_CLI_PATH = if ($GITNEXUS_CLI_PATH) { $GITNEXUS_CLI_PATH.Trim() } else { "" }

if (Test-Path $GLOBAL_HOOK_SRC) {
    $hookContent = Get-Content $GLOBAL_HOOK_SRC -Raw
    # Dùng [regex]::Replace để tránh lỗi parse dấu " trong -replace
    $cliPathEscaped = $GITNEXUS_CLI_PATH.Replace('\', '\\')
    $replacement = 'let cliPath = "' + $cliPathEscaped + '"'
    $hookContent = [regex]::Replace($hookContent, 'let cliPath = "[^"]*"', $replacement)
    $hookContent | Set-Content $PROJECT_HOOK_FILE -Encoding UTF8
    ok "Hook copied + CLI path updated -> $PROJECT_HOOK_FILE"
} else {
    warn "Global hook not found at $GLOBAL_HOOK_SRC -- writing template"

    # Hook JS được build từ nhiều string ghép lại để tránh vấn đề here-string với
    # ký tự ' (single-quote) đầu dòng và $ trong code JS.
    # Toàn bộ JS dùng double-quote nên an toàn trong @"..."@ của PowerShell,
    # chỉ cần escape `$ ở những chỗ PowerShell sẽ expand biến.
    $cliPathForJs = $GITNEXUS_CLI_PATH.Replace('\', '\\')

    $jsHeader = @"
#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

let cliPath = "$cliPathForJs";

function readInput() {
  try { return JSON.parse(fs.readFileSync(0, "utf-8")); } catch { return {}; }
}

function findGitNexusDir(startDir) {
  let dir = startDir || process.cwd();
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, ".gitnexus");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function resolveCliPath() {
  if (cliPath) return cliPath;
  try { return require.resolve("gitnexus/dist/cli/index.js"); } catch { return ""; }
}

function runGitNexusCli(resolvedCli, args, cwd, timeout) {
  if (resolvedCli) {
    return spawnSync(process.execPath, [resolvedCli, ...args], {
      encoding: "utf-8", timeout, cwd, stdio: ["pipe", "pipe", "pipe"]
    });
  }
  return spawnSync("cmd", ["/c", "npx", "-y", "gitnexus", ...args], {
    encoding: "utf-8", timeout: timeout + 5000, cwd, stdio: ["pipe", "pipe", "pipe"]
  });
}

function extractPattern(toolName, toolInput) {
  if (toolName === "Grep") return toolInput.pattern || null;
  if (toolName === "Glob") {
    const raw = toolInput.pattern || "";
    const match = raw.match(/[*\\/]([a-zA-Z][a-zA-Z0-9_-]{2,})/);
    return match ? match[1] : null;
  }
  if (toolName === "Bash") {
    const cmd = toolInput.command || "";
    if (/\brg\b|\bgrep\b/.test(cmd)) {
      const tokens = cmd.split(/\s+/);
      let foundCmd = false, skipNext = false;
      const flagsWithValues = new Set(["-e","-f","-m","-A","-B","-C","-g","--glob","-t","--type","--include","--exclude"]);
      for (const token of tokens) {
        if (skipNext) { skipNext = false; continue; }
        if (!foundCmd) { if (/\brg`$|\bgrep`$/.test(token)) foundCmd = true; continue; }
        if (token.startsWith("-")) { if (flagsWithValues.has(token)) skipNext = true; continue; }
        const cleaned = token.replace(/['"]/g, "");
        return cleaned.length >= 3 ? cleaned : null;
      }
      return null;
    }
    if (/\bfindstr\b/.test(cmd)) {
      const m = cmd.match(/findstr\s+(?:\/[a-zA-Z]\s+)*["']?([^\s"'/][^\s"']{2,})["']?/);
      return m ? m[1].replace(/['"]/g, "") : null;
    }
    if (/\bfind\b/.test(cmd)) {
      const nameMatch = cmd.match(/-name\s+['"]?([^'"\s|;]+)['"]?/);
      if (nameMatch) {
        const stripped = nameMatch[1].replace(/[*?'"]/g, "").replace(/\.[^.]+`$/, "");
        if (stripped.length >= 3) return stripped;
      }
    }
  }
  return null;
}

function enrichWithGitNexus(resolvedCli, pattern, cwd, totalTimeout) {
  const isIdentifier = /^[a-zA-Z_][a-zA-Z0-9_]{2,}`$/.test(pattern);
  const half = Math.floor(totalTimeout * 0.45);
  if (isIdentifier) {
    try {
      const child = runGitNexusCli(resolvedCli, ["context", pattern], cwd, half);
      if (!child.error && child.status === 0) {
        const out = (child.stdout || "").trim();
        if (out && !out.includes('"status": "ambiguous"') && !out.includes('"status": "not_found"') && out !== "{}") return out;
      }
    } catch {}
  }
  try {
    const child = runGitNexusCli(resolvedCli, ["query", pattern], cwd, half);
    if (!child.error && child.status === 0) {
      const out = (child.stdout || "").trim();
      if (out && out !== '{"processes":[]}' && out !== "{}") return out;
    }
  } catch {}
  try {
    const child = runGitNexusCli(resolvedCli, ["augment", "--", pattern], cwd, Math.floor(totalTimeout * 0.4));
    if (!child.error && child.status === 0) {
      const out = (child.stderr || "").trim();
      if (out) return out;
    }
  } catch {}
  return "";
}
"@

    # Phần thứ 2: các hàm block/read/main -- không có $ nào cần escape thêm
    $jsFooter = @"

function blockWithContext(pattern) {
  const name = pattern || "...";
  const reason = [
    "Grep/Glob blocked -- dung Serena (LSP) hoac GitNexus thay the.",
    "",
    "* mcp__serena__find_symbol({name: " + JSON.stringify(name) + "})",
    "* mcp__serena__find_referencing_symbols({name: " + JSON.stringify(name) + "})",
    "* mcp__gitnexus__context({name: " + JSON.stringify(name) + "})",
    "* mcp__gitnexus__query({query: " + JSON.stringify(name) + "})",
    "* Bash(grep / find)  <- escape hatch neu MCP khong du",
  ].join("\n");
  process.stderr.write(reason + "\n");
  process.exit(2);
}

const CODE_EXTS = /\.(py|ts|tsx|js|jsx)`$/;
const NARROW_LIMIT = 100;

function handleRead(toolInput, cwd) {
  const filePath = (toolInput.file_path || "").replace(/\\/g, "/");
  if (!CODE_EXTS.test(filePath)) return;
  const limit = toolInput.limit;
  if (typeof limit === "number" && limit <= NARROW_LIMIT) return;
  const rel = filePath.replace(cwd.replace(/\\/g, "/") + "/", "");
  const reason = [
    "Read(" + rel + ") blocked -- dung Serena de doc theo symbol.",
    "",
    "1. Overview:   mcp__serena__get_symbols_overview({path: " + JSON.stringify(rel) + "})",
    "2. Symbol:     mcp__serena__find_symbol({name: \"SymbolName\", include_body: true, relative_path: " + JSON.stringify(rel) + "})",
    "3. Refs:       mcp__serena__find_referencing_symbols({name: \"SymbolName\"})",
    "4. GitNexus:   mcp__gitnexus__context({name: \"SymbolName\"})",
    "5. Fallback:   Read voi offset+limit <= " + NARROW_LIMIT + " dong",
  ].join("\n");
  process.stderr.write(reason + "\n");
  process.exit(2);
}

function sendHookResponse(hookEventName, message) {
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext: message } }));
}

function handlePreToolUse(input) {
  const cwd = input.cwd || process.cwd();
  if (!findGitNexusDir(cwd)) return;
  const toolName = input.tool_name || "";
  const toolInput = input.tool_input || {};
  if (!["Grep","Glob","Bash","Read"].includes(toolName)) return;
  if (toolName === "Read") { handleRead(toolInput, cwd); return; }
  const pattern = extractPattern(toolName, toolInput);
  if (toolName === "Grep" || toolName === "Glob") { blockWithContext(pattern || ""); return; }
  if (!pattern || pattern.length < 3) return;
  const result = enrichWithGitNexus(resolveCliPath(), pattern, cwd, 12000);
  if (result) sendHookResponse("PreToolUse", result);
}

function handlePostToolUse(input) {
  const toolName = input.tool_name || "";
  if (toolName !== "Bash") return;
  const command = (input.tool_input || {}).command || "";
  if (!/\bgit\s+(commit|merge|rebase|cherry-pick|pull)(\s|`$)/.test(command)) return;
  const toolOutput = input.tool_output || {};
  if (toolOutput.exit_code !== undefined && toolOutput.exit_code !== 0) return;
  const cwd = input.cwd || process.cwd();
  const gitNexusDir = findGitNexusDir(cwd);
  if (!gitNexusDir) return;
  let currentHead = "";
  try {
    const r = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8", timeout: 3000, cwd, stdio: ["pipe","pipe","pipe"] });
    currentHead = (r.stdout || "").trim();
  } catch { return; }
  if (!currentHead) return;
  let lastCommit = "", hadEmbeddings = false;
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(gitNexusDir, "meta.json"), "utf-8"));
    lastCommit = meta.lastCommit || "";
    hadEmbeddings = meta.stats && meta.stats.embeddings > 0;
  } catch {}
  if (currentHead === lastCommit) return;
  const analyzeCmd = "gitnexus analyze" + (hadEmbeddings ? " --embeddings" : "");
  sendHookResponse("PostToolUse", "GitNexus index stale (last: " + (lastCommit ? lastCommit.slice(0,7) : "never") + "). Run " + analyzeCmd + " to update.");
}

function main() {
  try {
    const input = readInput();
    const handlers = { PreToolUse: handlePreToolUse, PostToolUse: handlePostToolUse };
    const handler = handlers[input.hook_event_name || ""];
    if (handler) handler(input);
  } catch {}
}
main();
"@

    ($jsHeader + $jsFooter) | Set-Content $PROJECT_HOOK_FILE -Encoding UTF8
    ok "Hook template written -> $PROJECT_HOOK_FILE"
}

# Cập nhật đường dẫn hook trong settings.json
if (Test-Path $PROJECT_SETTINGS) {
    $settingsRaw = Get-Content $PROJECT_SETTINGS -Raw
    $hookPathJson = $PROJECT_HOOK_FILE.Replace('\', '\\')
    $replacement2 = 'node \"' + $hookPathJson + '\"'
    $settingsRaw = [regex]::Replace($settingsRaw, 'node \\"[^\\"]*gitnexus-hook\\.cjs\\"', $replacement2)
    $settingsRaw | Set-Content $PROJECT_SETTINGS -Encoding UTF8
    ok "Hook path updated in $PROJECT_SETTINGS"
}

# Cập nhật timeout + matcher
if (Test-Path $PROJECT_SETTINGS) {
    $settingsObj = Get-Content $PROJECT_SETTINGS -Raw | ConvertFrom-Json -AsHashtable
    foreach ($hookType in @('PreToolUse', 'PostToolUse')) {
        $timeout = if ($hookType -eq 'PreToolUse') { 15 } else { 10 }
        if ($settingsObj['hooks'] -and $settingsObj['hooks'].ContainsKey($hookType)) {
            foreach ($entry in $settingsObj['hooks'][$hookType]) {
                if ($hookType -eq 'PreToolUse') { $entry['matcher'] = 'Grep|Glob|Bash|Read' }
                foreach ($h in $entry['hooks']) { $h['timeout'] = $timeout }
            }
        }
    }
    $settingsObj | ConvertTo-Json -Depth 10 | Set-Content $PROJECT_SETTINGS -Encoding UTF8
    ok "Settings: timeout=15s, matcher=Grep|Glob|Bash|Read"
}

# =============================================================================
step "7/8 -- Remove global skills (project has its own from analyze)"
# =============================================================================
if (Test-Path $GLOBAL_SKILLS_DIR) {
    Remove-Item -Recurse -Force $GLOBAL_SKILLS_DIR
    ok "Global skills removed: $GLOBAL_SKILLS_DIR"
} else {
    warn "Global skills not found -- already removed or not installed"
}

# =============================================================================
step "8/8 -- Append workspace structure + technical guidelines to CLAUDE.md"
# =============================================================================
$claudeMdContent = if (Test-Path $CLAUDE_MD) { Get-Content $CLAUDE_MD -Raw } else { "" }
if ($claudeMdContent -match '<!--gitnexus-->') {
    warn "gitnexus block already in CLAUDE.md -- skipping"
} else {
    $wsSection = @"

<!--gitnexus-->
## workspace structure
this workspace is indexed as a single project root containing two main components:
- **<repo A>**: <brief description about backend>
- **<repo B>**: <brief description about fronted>

### fullstack workflow
1. analyze backend impact in <repo A> directory first
2. extract the api/contract changes explicitly
3. analyze frontend impact in <repo B> based on that contract
4. produce one merged fullstack plan

### technical guidelines
- do not search for <repo A> or <repo B> as separate repositories
- all file paths must be relative to the root (e.g., ``<repo A>/main.py`` or ``<repo B>/src/app``)
- treat the backend as the source of truth for api contracts
<!--gitnexus:end-->
"@
    Add-Content -Path $CLAUDE_MD -Value $wsSection -Encoding UTF8
    ok "gitnexus block appended to $CLAUDE_MD"
}

# =============================================================================
$status = (gitnexus status 2>$null | Select-String '\d+,?\d* nodes' |
    ForEach-Object { $_.Matches[0].Value } | Select-Object -First 1)
if (-not $status) { $status = "run gitnexus status" }

Write-Host ""
Write-Host "===============================================" -ForegroundColor Green
Write-Host "  GitNexus setup complete!"                     -ForegroundColor Green
Write-Host "===============================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Knowledge graph:   $status"            -ForegroundColor Cyan
Write-Host "  MCP config:        $PROJECT_MCP"       -ForegroundColor Cyan
Write-Host "  Hook:              $PROJECT_HOOK_FILE"  -ForegroundColor Cyan
Write-Host "  Project settings:  $PROJECT_SETTINGS"  -ForegroundColor Cyan
Write-Host ""
Write-Host "  Next step: Restart Claude Code to reload MCP server." -ForegroundColor Yellow
Write-Host ""
