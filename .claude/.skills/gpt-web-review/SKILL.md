---
name: gpt-web-review
description: Manual-only skill. Gather safe relevant context, send it to ChatGPT web via Oracle CLI, support file attachments for large context, and save the raw GPT/Oracle response to /opt/gpt-response without summarizing.
argument-hint: "<task/question>"
disable-model-invocation: true
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash(git diff *)
  - Bash(git ls-files *)
  - Bash(find *)
  - Bash(wc *)
  - Bash(head *)
  - Bash(cat *)
  - Bash(mkdir *)
  - Bash(oracle *)
  - Bash(tee *)
---

# Oracle Spec Bridge

User request:

```text
$ARGUMENTS
```

## Goal

Use ChatGPT web as the stronger reasoning model through Oracle CLI.

Do only this:

1. Gather relevant safe context.
2. Send the request to ChatGPT web through Oracle.
3. Support large context by attaching files with `--file`.
4. Save the raw Oracle/GPT response to `/opt/gpt-response`.
5. Return the raw response to the user.

Do not summarize, rewrite, or clean up GPT's answer.
Do not create files inside `.claude`.
Do not run setup/preflight checks unless Oracle fails.

## Core command

**ALWAYS use file attachment mode.** Never summarize file content into `-p`.

The `-p` prompt must contain only the task/question and a list of attached filenames. Never paste file content or excerpts into `-p`.

Default command (always):

```bash
oracle --engine browser \
  --model gpt-5.5 \
  --browser-thinking-time extended \
  --browser-model-strategy current \
  --browser-attachments auto \
  --browser-bundle-files \
  --browser-attachment-timeout 120s \
  -p "<task/question only — no file content>" \
  --file "path/to/relevant-file-1" \
  --file "path/to/relevant-file-2" \
  --file "!node_modules/**" \
  --file "!dist/**" \
  --file "!build/**" \
  --file "!.next/**" \
  --file "!coverage/**" \
  --file "!.env*" \
  --file "!**/*secret*" \
  --file "!**/*credential*" \
  --file "!**/*token*"
```

Do not use MCP.
Do not use presets.
Do not use `gpt-5.5-pro`.

## File attachment rules

- **ALWAYS attach full files via `--file`** — never summarize, excerpt, or paste file content into `-p`.
- **`-p` contains only**: the task description, a numbered list of attached filenames, and any explicit constraints/output format.
- **`--browser-attachments auto`** is always required.
- **`--browser-bundle-files`** is always required when sending multiple files — oracle bundles them into a single archive. Use `--browser-bundle-format zip` (available since v0.12.0) if ChatGPT has trouble with the default bundle format.
- **`--browser-attachment-timeout 120s`** is always required to prevent false `attachment-send-not-ready` timeouts on large uploads (fixed in v0.13.0, but the flag is still needed for slow connections).
- No hard file count limit when using `--browser-bundle-files` — send as many relevant files as needed.
- Prefer targeted individual files over broad globs.
- Do not attach the whole repo unless the user explicitly asks.
- If a relevant file is large, still attach it via `--file` — do not truncate or summarize it into the prompt.

## Context selection

Identify which files are relevant, then attach them all via `--file`. Do NOT read file content and paste it into `-p`.

**Step 1 — find relevant files** (use Glob/Bash/find):

```text
CLAUDE.md
AGENTS.md
README.md
docs/**/*.md
.claude/skills/**/SKILL.md
.claude/commands/**/*.md
.claude/agents/**/*.md
package.json
src/**/*
tests/**/*
```

**Step 2 — add them as `--file` arguments.** That is all. Do not read their content into the prompt.

For code review/change tasks, also capture the diff:

```bash
git diff > /tmp/current.diff
```

Then attach `/tmp/current.diff` as `--file "/tmp/current.diff"` — do not paste diff content into `-p`.

## Security

Never send secrets or private data.

Exclude:

```text
.env*
*.pem
*.key
*.p12
*.pfx
id_rsa
id_ed25519
*secret*
*credential*
*token*
*.sqlite
*.db
*.dump
*.bak
node_modules
dist
build
.next
coverage
```

Redact API keys, bearer tokens, JWTs, passwords, database URLs, cookies, customer data.

Use placeholders:

```text
[REDACTED_SECRET]
[REDACTED_TOKEN]
[REDACTED_DB_URL]
[REDACTED_CUSTOMER_DATA]
```

## Prompt format

Use this prompt in `-p` — task description only, no file content:

```markdown
You are ChatGPT web using GPT-5.5 Extended Thinking.

The local model is weaker at reasoning. Give a clear, concrete answer/spec that the local model can follow.

## User request

<exact user request>

## Attached files

<numbered list of filenames attached with --file>

## Constraints

- All context is in the attached files — read them fully.
- Do not assume files not shown.
- Do not rely on information not in the attached files.
- Prefer concrete steps.
- Name files/functions/classes when possible.
- If context is missing, say exactly what is missing.

## Required output

Return:
1. direct answer / decision
2. concrete steps or implementation spec
3. risks / assumptions
4. validation checks if code changes are involved
```

**Critical**: The `## Relevant context` section is REMOVED from the prompt. All context comes from attached files only.

## Save raw response

Always save the raw command output to:

```text
/opt/gpt-response/
```

Use a timestamped filename:

```bash
mkdir -p /opt/gpt-response

oracle --engine browser \
  --model gpt-5.5 \
  --browser-thinking-time extended \
  --browser-model-strategy current \
  -p "<prompt>" 2>&1 | tee "/opt/gpt-response/$(date +%Y%m%d-%H%M%S)-oracle-response.txt"
```

For large context:

```bash
mkdir -p /opt/gpt-response

oracle --engine browser \
  --model gpt-5.5 \
  --browser-thinking-time extended \
  --browser-model-strategy current \
  --browser-attachments auto \
  --browser-bundle-files \
  --browser-attachment-timeout 120s \
  -p "<short prompt>" \
  --file "relevant-file-1" \
  --file "relevant-file-2" \
  --file "!node_modules/**" \
  --file "!dist/**" \
  --file "!build/**" \
  --file "!.next/**" \
  --file "!coverage/**" \
  --file "!.env*" \
  --file "!**/*secret*" \
  --file "!**/*credential*" \
  --file "!**/*token*" \
  2>&1 | tee "/opt/gpt-response/$(date +%Y%m%d-%H%M%S)-oracle-response.txt"
```

The saved file should contain raw Oracle output. Do not edit it.

## Final response

Return the Oracle output as-is.

At the top, include only one short line with the saved path:

```markdown
Raw response saved to: /opt/gpt-response/<filename>

<raw Oracle output>
```

If Oracle fails, show the raw error and the saved path. Diagnose only after showing the raw error.
