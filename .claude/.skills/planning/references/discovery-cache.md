# Phase 0.5: Feature-Scoped Discovery Setup

After Phase 0 pre-flight, before launching Phase 1 agents.

## Key Principle

Do **not** maintain a global full-project discovery cache as the primary planning artifact.

This repository already has live code-intelligence indexes (Serena + GitNexus). Discovery should be:
- feature-scoped,
- evidence-based,
- and regenerated/updated per feature.

Use:
- `history/<feature>/discovery.md`
- `history/<feature>/discovery-lanes/*.md`

## Decision Flow

### If `history/<feature>/discovery.md` exists

```text
✅ Feature discovery exists.
- Reuse as baseline
- Refresh sections impacted by new requirements
```

Minimum refresh checks (4 orthogonal dimensions):
1. Architecture (topology / modules / entry points)
2. Reusable patterns
3. Technical constraints
4. External references (design patterns, API docs, library refs)

Within each dimension, honor the fullstack cross-cutting rule from `CLAUDE.md`: sweep both `onehammerStore` and `onehammerUI` where relevant; backend findings come first as contract source of truth, then frontend impact based on that contract.

### If `history/<feature>/discovery.md` does NOT exist

```text
⏳ No feature discovery found. Running Phase 1 discovery lanes...
```

Proceed to Phase 1 and generate all lane artifacts.

## Phase 1 lane outputs (required)

Write these files from agent outputs:

- `history/<feature>/discovery-lanes/1-architecture.md`
- `history/<feature>/discovery-lanes/2-patterns.md`
- `history/<feature>/discovery-lanes/3-constraints.md`
- `history/<feature>/discovery-lanes/4-external.md`

Then compile:
- `history/<feature>/discovery.md`

## Discovery synthesis template (minimum)

`history/<feature>/discovery.md` should contain:

```markdown
# Feature Discovery: <feature>

## Scope
## Architecture Findings (backend → frontend order)
## Backend/API Contract Changes
## Frontend Impact (based on contract)
## Existing Patterns To Reuse
## Technical Constraints
## External References (Exa evidence)
## GitNexus Evidence
- query: ...
- context: ...
- impact: ...

## Serena Evidence
- symbols/files inspected: ...

## Risks
## Open Questions
## Discovery Gaps
```

## Notes

- Avoid introducing `history/full-project-discovery/` as required source-of-truth.
- Use indexes as truth, markdown as feature-specific snapshot for planning handoff.
- Keep discovery compact and current to this feature only.
