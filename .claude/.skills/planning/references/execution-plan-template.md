# Execution Plan Template

Save to `history/<feature>/execution-plan.md`

```markdown
# Execution Plan: <Feature Name>

Epic: <epic-id>
Generated: <date>

## Overview

| Total Tasks | Backend | Frontend | Tests |
|-------------|---------|----------|-------|
| <total>     | <count> | <count>  | <count> |

---

## Tracks

| Track | Agent       | Beads (in order)      | File Scope        | Worker Type |
| ----- | ----------- | --------------------- | ----------------- | ----------- |
| 1     | BlueLake    | one_hammer-r35 → one_hammer-c02 | `onehammerStore/**` | Backend     |
| 2     | GreenCastle | one_hammer-ku2                   | `onehammerUI/**`    | **Frontend** |
| 3     | RedStone    | one_hammer-7cb → one_hammer-0co  | `onehammerUI/**`    | **Frontend** |
| 4     | YellowHill  | one_hammer-iui → one_hammer-f4s  | Evidence            | **Testing** |

---

## Track Details

### Track 1: BlueLake - <track-description>

**File scope**: `packages/sdk/**`
**Worker Type**: Backend
**Beads**:

1. `one_hammer-r35`: <title> - <brief description>
2. `one_hammer-c02`: <title> - <brief description>
3. `one_hammer-2qa`: <title> - <brief description>

### Track 2: GreenCastle - <track-description>

**File scope**: `packages/cli/**`
**Worker Type**: Backend
**Beads**:

1. `one_hammer-ku2`: <title> - <brief description>
2. `one_hammer-7cb`: <title> - <brief description>

### Track 3: RedStone - <track-description>

**File scope**: `apps/ui/**`
**Worker Type**: **Frontend (requires ui-ux-pro-max skill)**
**Skill Reference**: Read `.claude/skills/ui-ux-pro-max/SKILL.md` before implementing
**Beads**:

1. `one_hammer-0co`: <title> - <brief description>
2. `one_hammer-4hw`: <title> - <brief description>

### Track 4: YellowHill - Testing

**File scope**: Split testing by evidence surface
**Worker Type**: **Testing (use curl/HTTP for BE, agent-browser for FE/UI)**
**Beads**:

1. `one_hammer-iui`: TEST-BE: <backend/API runtime proof> - curl/HTTP response, auth/source, DB query when relevant
2. `one_hammer-f4s`: TEST-FE: <frontend/browser proof> - read `.claude/lessons/browser-runbook.md`, use agent-browser, capture screenshot path, verify expected UI state + browser-observed API cue, and record runbook delta

### Track 5: DocsSync - Documentation Sync

**File scope**: `history/**`
**Worker Type**: Docs Sync
**Runs AFTER**: All implementation + test tracks complete
**Beads**:

1. `one_hammer-ena`: SIGNOFF: Review linked evidence and record approval/revise gaps
2. `<actual-beads-id>`: SYNC: Update any required follow-up artifact only if the feature plan explicitly calls for it

---

## Cross-Track Dependencies

```
Core BE (one_hammer-r35) ──┬──► BE cleanup/runtime lane ───────┐
                            ├──► FE/UI lane ───────────────────┤
                            └──► Fixture/evidence lane ────────┤
                                                               └──► Evidence/sign-off fan-in
```

**Parallelization**:
- Keep independent BE, FE, fixture, and evidence tracks **parallel-ready** whenever their file scopes and prerequisites do not overlap.
- Use fan-out/fan-in: core BE/API contract work can unlock multiple BE/FE/evidence lanes; sign-off fans in only after the required BE and FE evidence beads finish.
- Do not force one testing track to wait for all implementation tracks; a BE evidence bead may start as soon as its BE prerequisites and fixtures are ready, while a browser evidence bead waits only for its linked BE evidence and relevant FE UI bead.
- If dependency uncertainty remains, record the reason and add only the minimal blocking edge.

---

## Key Learnings (from Spikes)

- <learning 1>
- <learning 2>

---

## Worker Instructions Summary

| Track | Worker Type | Special Instructions |
|-------|-------------|---------------------|
| 1, 2  | Backend     | Standard worker.md |
| 3     | **Frontend** | **MUST load ui-ux-pro-max skill** |
| 4     | **Testing** | **Split TEST-BE curl/HTTP proof from TEST-FE agent-browser screenshot proof; TEST-FE reads and updates `.claude/lessons/browser-runbook.md`** |
| 5     | Docs Sync   | Update BA knowledge files |

---

## Acceptance Criteria Summary

| Feature | How to Verify |
|---------|---------------|
| <feature 1> | <verification method> |
| <feature 2> | <verification method> |

---

## Estimated Time

| Track | Tasks | Estimated Time |
|-------|-------|----------------|
| Track 1 (Backend) | <count> tasks | ~<time> |
| Track 2 (Backend) | <count> tasks | ~<time> |
| Track 3 (Frontend) | <count> tasks | ~<time> |
| Track 4 (Testing) | <count> tasks | ~<time> |
| Track 5 (Docs Sync) | <count> tasks | ~<time> |
| **Total** | <total> tasks | **~<total time>** |
```

## Phase 8: Track Planning Steps

### Step 1: Get Parallel Tracks

```bash
bv --robot-plan 2>/dev/null | jq '.plan.tracks'
bv --robot-plan 2>/dev/null | jq '.plan.summary.highest_impact'
```

### Step 2: Assign File Scopes

For each track, determine the file scope based on beads:

```bash
br show <actual-beads-id>  # Look at description for file hints
```

**Rules:**
- File scopes must NOT overlap between tracks
- Use glob patterns: `onehammerStore/**`, `onehammerUI/**`, `history/<feature>/**`, or narrower scopes from the bead descriptions
- Keep non-overlapping tracks separate and parallel-ready; only merge when overlap is unavoidable or a real prerequisite requires serialization

### Step 3: Generate Agent Names

Assign unique adjective+noun names:
- BlueLake, GreenCastle, RedStone, PurpleBear, etc.

### Step 4: Validate

```bash
# No cycles (must be [])
bv --robot-insights 2>/dev/null | jq '.cycles'

# All beads assigned
bv --robot-plan 2>/dev/null | jq '.plan.unassigned'

# Check for stale/blocked issues
bv --robot-alerts 2>/dev/null | jq '.'
```
