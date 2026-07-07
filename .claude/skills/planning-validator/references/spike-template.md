# Spike Artifact Template

Use this template only after the validator has returned a spike recommendation and the user has explicitly approved separate spike execution. Default validation must not create spike beads, spawn spike Agents, write spike artifacts, or close spike beads.

Every approved spike closes with ONE artifact on disk and ONE `br close` reason that starts with `YES:` or `NO:`.

## File path

```
history/<feature>/spike-<risk-slug>.md
```

`<risk-slug>` is a kebab-case shorthand of the HIGH-risk item (e.g. `spike-notion-rate-limit.md`, `spike-fe-auth-token-rotation.md`).

## Template

```markdown
# Spike: <risk title>

- Feature: <feature>
- Phase: Phase <n>
- Bead ID: <br-id>
- Time-box: 30 minutes
- Started: <ISO8601>
- Closed: <ISO8601>

## The question

> Single yes/no question. Example:
> "Can the active project's import worker call the external API without exceeding its documented rate limit when batch-importing 500 rows?"

## What was tried

Brief bullet list of the concrete actions taken during the time-box:

- <step 1 — include commands / file paths touched>
- <step 2>
- <step 3>

## Evidence

- Logs / metric snippets / request-response pairs
- Link to the code explored (file + line range)
- GitNexus / Serena queries run, if any

## Verdict

**YES** — <one-sentence restatement of the validated approach and its constraints>

-- OR --

**NO** — <one-sentence restatement of the blocker and why it breaks the approach>

## Constraints discovered

- Constraint 1 (e.g. "max 3 req/sec, must batch + sleep 350ms between calls")
- Constraint 2

## Impact on current phase

- Beads that need edits: <list of br-ids>
- Story-map edits: <yes/no, which stories>
- Contract edits: <yes/no, which fields>

## If NO — required replan

- Root cause of the blocker
- Smallest plausible alternative approach
- Which phase of `planning` the caller must return to (typically Phase 2 / Oracle Synthesis)
```

## Closure commands

```bash
# YES — approach validated
br close <id> --reason "YES: <constraint summary> — see history/<feature>/spike-<risk-slug>.md"

# NO — approach blocked
br close <id> --reason "NO: <blocker> — see history/<feature>/spike-<risk-slug>.md"
```

## Rules

- Exactly ONE question per spike. If two questions, create two spikes.
- 30-minute hard time-box. If the answer is not clear at 30 minutes, close with NO + "timed out, approach too ambiguous to validate inside the time-box" and escalate.
- Spike findings must be read before the affected beads are touched in V3.
