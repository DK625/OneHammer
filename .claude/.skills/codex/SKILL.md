---
name: codex
description: |
  Invoke Codex (GPT-5.4, xhigh reasoning) to review something from the current conversation.

  ALWAYS use this skill when the user types `/codex review <anything>` — including but not limited to:
  - `/codex review code` — review recently changed/written code via git
  - `/codex review phương án` — review options/approaches Claude just listed
  - `/codex review ý tưởng` — review an idea or concept discussed in conversation
  - `/codex review plan` — review an execution plan or roadmap
  - `/codex review commit` — review the most recent commit
  - `/codex fix this bug` — fix current bug
  - `/codex <any review request>` — any time user wants a second opinion from Codex

  Also trigger when user says "cho codex xem", "hỏi codex", "nhờ codex review", "gửi codex", "codex đánh giá",
  or any phrasing asking to get Codex's input on something.
---

# Codex Review Skill

Codex (GPT-5.4 with extra-high reasoning) acts as a powerful second opinion. It can read local files
directly — so reference file paths, not file contents. It reasons deeply before responding, making it
excellent for evaluation, trade-off analysis, and catching things that fast review misses.

**Always include these flags:**

```
-m gpt-5.4 -c model_reasoning_effort="xhigh"
```

- `-m gpt-5.4 -c model_reasoning_effort="xhigh"` — force the right model and reasoning level, because
  the user's config may have been changed to a different model/effort since these instructions were written

**Disable MCP servers to prevent disconnections:**

Codex sessions with xhigh reasoning run long (60-180s+). MCP connections are unreliable over long sessions — they
frequently disconnect mid-run, causing the entire response to be lost. **Always disable all MCP servers** when
running Codex.

```
-c mcp_servers.<server_name>.enabled=false
```

- Repeat for each MCP server configured in `~/.codex/config.toml`
- Example: `-c mcp_servers.mcp_agent_mail.enabled=false` if MCP Agent Mail is configured
- Example: `-c mcp_servers.my_mcp.enabled=false` for any other MCP server
- **Only disable servers that actually exist in the config** — referencing a nonexistent server causes
  "invalid transport" error. Check `~/.codex/config.toml` under `[mcp_servers]` to see which are configured.

**Quick way to find MCP server names:**
```bash
grep -oP 'mcp_servers\.\K[^.]+' ~/.codex/config.toml 2>/dev/null || echo "no config found"
```

---

## Review Types and Commands

### 1. `review code` — Review changed code

Use the built-in `codex exec review` subcommand. It automatically diffs against git.

**Choose the right flag based on context:**

| Situation | Command |
|-----------|---------|
| Uncommitted work (staged + unstaged) | `codex exec review --uncommitted -m gpt-5.4 -c model_reasoning_effort="xhigh" [MCP_FLAG]` |
| Review the last commit | `codex exec review --commit HEAD -m gpt-5.4 -c model_reasoning_effort="xhigh" [MCP_FLAG]` |
| Review all changes vs main branch | `codex exec review --base main -m gpt-5.4 -c model_reasoning_effort="xhigh" [MCP_FLAG]` |
| Review with custom focus | Add a prompt: `codex exec review --uncommitted -m gpt-5.4 -c model_reasoning_effort="xhigh" [MCP_FLAG] "Focus on security and edge cases"` |

> `[MCP_FLAG]` = `-c mcp_servers.<name>.enabled=false` for each MCP server in `~/.codex/config.toml`. Disable all MCP servers to avoid disconnect-lost responses. Only include flags for servers that exist in config.

Always add context as a prompt if you know what the code is trying to do — Codex reviews better with intent.

### 2. `review phương án` — Review options/approaches

Extract the options from the recent conversation and build a self-contained prompt.

```bash
codex exec -m gpt-5.4 -c model_reasoning_effort="xhigh" [MCP_FLAG] "$(cat <<'EOF'
<paste the options/approaches Claude just listed>

Context: <the problem statement / requirement>

Please evaluate each option. Consider: trade-offs, risks, implementation complexity, and long-term
maintainability. Recommend the best option with clear reasoning.
EOF
)"
```

### 3. `review ý tưởng` — Review an idea

Extract the idea and any relevant file paths from the conversation.

```bash
codex exec -m gpt-5.4 -c model_reasoning_effort="xhigh" [MCP_FLAG] "$(cat <<'EOF'
Idea to evaluate: <describe the idea>

Relevant codebase context:
- <list relevant file paths if applicable>

Please evaluate: feasibility, potential issues, missing pieces, and suggested improvements.
EOF
)"
```

### 4. `review plan` — Review an execution plan

```bash
codex exec -m gpt-5.4 -c model_reasoning_effort="xhigh" [MCP_FLAG] "$(cat <<'EOF'
Execution plan to review:
<paste the plan steps>

Codebase: <working directory or key file paths>

Please review for: completeness, correct sequencing, missing steps, risks, and anything that could
go wrong in practice.
EOF
)"
```

### 5. `review commit` — Review a specific commit

```bash
codex exec review --commit <SHA or HEAD> -m gpt-5.4 -c model_reasoning_effort="xhigh" [MCP_FLAG]
```

---

## Execution Steps

1. **Identify review type** from the user's command (code / phương án / ý tưởng / plan / other)

2. **Extract context** from the conversation:
   - For code: use `git status` and `git diff --stat` to find changed files
   - For phương án: copy the options Claude listed verbatim
   - For ý tưởng/plan: summarize the idea/plan from recent messages, identify related file paths

3. **Construct the command** using the appropriate template above

4. **Run via Bash tool** with a generous timeout (300 seconds minimum, 600 for complex reviews):
   ```
   timeout=300000
   ```

5. **Present results** to the user:
   - Show Codex's analysis directly
   - Add a brief synthesis if Codex's output needs framing or if you notice something to highlight
   - If Codex recommends changes, offer to implement them

---

## Language

Match the user's language in your prompt to Codex:
- If user writes in Vietnamese → write the Codex prompt in Vietnamese
- If user writes in English → write the Codex prompt in English
- Mixed is fine too — Codex handles both well

---

## Common Pitfalls

- **Don't paste file contents** — just give paths. Codex reads them itself.
- **Always include `-m gpt-5.4 -c model_reasoning_effort="xhigh"`** — the user's config may point to a different model. Never rely on defaults.
- **Disable MCP servers** — MCP connections are unstable over long xhigh reasoning sessions. They disconnect mid-run and cause the full response to be lost. Add `-c mcp_servers.<name>.enabled=false` for each MCP server in `~/.codex/config.toml`. Only reference servers that exist in config — nonexistent ones cause "invalid transport" error.
- **Do give intent context** — "this code implements X" helps Codex review more accurately than just showing diffs.
- **Timeout**: Codex with xhigh reasoning can take 60-180 seconds. Don't set timeout, please wait until done.

