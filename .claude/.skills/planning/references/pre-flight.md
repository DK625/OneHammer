# Phase 0: Pre-flight Check

**MANDATORY** — Run this before any phase. Do NOT skip.

Serena is required for semantic code discovery/editing. Exa is required for external research. GitNexus is required by `CLAUDE.md` for code intelligence / impact analysis. CLI tools (`br`, `bv`, `jq`) are required for planning workflow execution.

## Step 1: Check MCP Server Config

Read `.mcp.json` and verify these keys exist in `mcpServers`:

| MCP Server | Required By | Role | Fallback |
|---|---|---|---|
| `serena` | All code discovery/editing | Semantic code analysis | **MUST have** |
| `exa` | External research lane | External docs/pattern research | **MUST have** |
| `gitnexus` | Discovery + impact checks | Indexed code intelligence and blast radius | **MUST have** |

Hook enforcement can verify `.mcp.json` contains these server names, but only Claude/tool execution can verify runtime readiness.

## Step 2: Verify Tool Readiness

- Call `mcp__serena__check_onboarding_performed()`; onboard if needed, then re-check.
- Ask the user whether to reindex GitNexus before discovery, because an existing index can be stale or inaccurate even when present.
  Use `AskUserQuestion` with this exact shape:

```text
Header: GitNexus Reindex
Question: The current GitNexus index may be stale or inaccurate. Reindex GitNexus now before planning discovery?
Options: Yes, No
```

  If the user answers `Yes`, run `npx gitnexus analyze` and stop before Phase 0 completion if it fails. If the user answers `No`, continue with the current index and record that reindexing was explicitly skipped.
- Use available GitNexus MCP tools during discovery/impact analysis. If a GitNexus tool later reports a stale index, ask the user again before running `npx gitnexus analyze`.
- Run CLI checks:

```bash
br --help 2>&1
bv --help 2>&1
jq --version 2>&1
```

## Step 3: Record Phase 0 Evidence

When marking Phase 0 complete, `phase_outputs."0"` must include:

```json
{
  "status": "completed",
  "mcp_json_checked": true,
  "mcp_servers_verified": ["serena", "exa", "gitnexus"],
  "serena_onboarding_checked": true,
  "serena_ready": true,
  "gitnexus_reindex_asked": true,
  "gitnexus_reindex_response": "Yes|No",
  "gitnexus_reindex_ran": true,
  "gitnexus_reindex_ok": true,
  "gitnexus_reindex_skip_reason": null,
  "br_help_ok": true,
  "bv_help_ok": true,
  "jq_ok": true,
  "timestamp": "<ISO8601>"
}
```

For `gitnexus_reindex_response: "Yes"`, set `gitnexus_reindex_ran: true`, `gitnexus_reindex_ok: true`, and `gitnexus_reindex_skip_reason: null`. For `"No"`, set `gitnexus_reindex_ran: false`, `gitnexus_reindex_ok: null`, and `gitnexus_reindex_skip_reason: "User chose to continue with the existing GitNexus index"`.

The planning guard blocks Phase 0 completion if required evidence is missing.

## Stop Conditions

Stop before Phase 0 completion if any required MCP server is missing from `.mcp.json`, Serena is not ready after onboarding, the user answered `Yes` and `npx gitnexus analyze` failed, or `br`/`bv`/`jq` checks fail.
