# Dependency Installation

## CLI Tools

### jq (JSON Processor)

**Windows (PowerShell):**
```powershell
mkdir "C:\tools" -ErrorAction SilentlyContinue
Invoke-WebRequest -Uri "https://github.com/jqlang/jq/releases/download/jq-1.8.1/jq-windows-amd64.exe" -OutFile "C:\tools\jq.exe"
$oldPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($oldPath -notlike "*C:\tools*") {
    [Environment]::SetEnvironmentVariable("Path", $oldPath + ";C:\tools", "User")
}
```

**macOS:** `brew install jq`
**Linux:** `sudo apt install jq` or `sudo dnf install jq`

### bd (Bead Management CLI)

```bash
go install github.com/nicobailon/bd@latest

# Or download binary from releases:
# https://github.com/nicobailon/bd/releases

# Initialize in project
bd init
```

### bv (Beads Viewer)

```bash
go install github.com/nicobailon/bv@latest

# Or download binary from releases:
# https://github.com/nicobailon/bv/releases

# Verify
bv --version
```

---

## MCP Servers

### exa (Web Search)

**Option 1: HTTP MCP (recommended)**
```json
{
  "mcpServers": {
    "exa": {
      "type": "http",
      "url": "https://mcp.exa.ai/mcp?exaApiKey=<YOUR_EXA_API_KEY>",
      "headers": {}
    }
  }
}
```

**Option 2: stdio MCP**
```bash
claude mcp add -e EXA_API_KEY=<your-key> exa -- npx -y exa-mcp-server
```

### serena (Code Editing)

Already configured via `.serena/` directory.

---

## Verification

Run these to verify installation:

```bash
jq --version
bd --help
bv --version
```

For MCP servers, check `.mcp.json` exists and servers are running.
