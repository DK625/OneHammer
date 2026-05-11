# PLANNING_STATUS — Human-Readable Mirror

This file is the **human-readable mirror** of `.planning/state/planning-state-v2.json`.

Write this to `history/<feature>/PLANNING_STATUS.md` **every time** you update the machine state. Both files must stay in sync at every phase transition — the JSON is for the hook/guard, the Markdown is for the user and for quick resume after compaction.

---

## Required Sections

### 1. Header block

```markdown
# Planning Status: <feature>

**Feature**          : <feature-slug>
**Started**          : <ISO8601>
**Current Phase**    : <phase id> — <phase name>
**Phase Plan Approved** : phase_plan_approved = true | false
**Approval Response**   : Approve | Revise | pending
**State file**       : .planning/state/planning-state-v2.json
**Last updated**     : <ISO8601>
```

### 2. Completed phases checklist

Render the master checklist with the completed phases checked:

```markdown
## Completed Phases

- [x] Phase 0   — Pre-flight
- [x] Phase 0.5 — Feature discovery setup
- [x] Phase 1   — 4 discovery lane outputs + artifacts
- [x] Phase 1.5 — Business clarification
- [ ] Phase 1.6 — Test clarification
- [ ] Phase 2   — Oracle synthesis
- [ ] Phase 2.5 — Whole-feature phase plan + approval gate
- [ ] Phase 3   — Phase contracts for all planned phases
- [ ] Phase 4   — Story maps for all planned phases
- [ ] Phase 5   — Decomposition
- [ ] Phase 7   — Validation gate
- [ ] Phase 8   — Execution plan
```

### 3. Artifacts table

List every artifact written so far with its path, so a fresh context can find files fast:

```markdown
## Artifacts

| Artifact | Path |
|---|---|
| Source request | history/<feature>/requirements/<timestamp>-<slug>.md (or legacy tmp2.md) |
| Discovery lanes | history/<feature>/discovery-lanes/*.md |
| Discovery synthesis | history/<feature>/discovery.md |
| Requirements | history/<feature>/requirements.md |
| Approach | history/<feature>/approach.md |
| Phase plan | history/<feature>/phase-plan.md |
| Phase contracts | history/<feature>/contracts/*.md |
| Story maps | history/<feature>/story-maps/*.md |
| Test scenarios | history/<feature>/test-scenarios.md |
| Execution plan | history/<feature>/execution-plan.md |
```

Only include rows for artifacts that actually exist.

### 4. Next action

```markdown
## Next Action

<one-sentence description of the very next step the pipeline will take>
```

### 5. Notes (optional)

If there are warnings, skipped substeps, pending approvals, or user-specific context, surface them here so the next resume does not have to re-read the full JSON.

---

## Writing Rules

1. Overwrite the file on every phase transition — do not append.
2. Keep the file short (target < 100 lines). It is a dashboard, not a log.
3. Never put secrets, long prose, or agent outputs here — those belong in the phase artifacts.
4. If a phase is `skipped`, mark it `- [~]` with a one-line reason so the reader sees intent.
5. Keep `Source request` aligned with the active requirement source pointer in state (`phase_outputs.0.requirement_source_path` or `phase_outputs."1.5".requirement_source_path`).
6. Do not drift from the JSON — if you update one, update the other in the same turn.
