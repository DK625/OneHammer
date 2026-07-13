# Feature-Scoped Discovery Setup (Phase 0 → Phase 1)

Phase 0 already ensures target-repo-scoped `.planning/history/<feature>/` exists under `HISTORY_ROOT` (`phase_outputs.0.project_index_root`, fallback normal project root only when no target is selected). Resolve every relative path in this reference against `HISTORY_ROOT`. Do not delay a fresh Phase 1 launch to read broad context: after Phase 0 succeeds, spawn the missing External discovery lane immediately (one Agent call in its own message), then run the three main-agent lanes (Architecture, Patterns, Constraints) with GitNexus/Serena. Use this reference when verifying existing lane coverage and when compiling `discovery.md` from the lane files.

## Key Principle

Do **not** maintain a global full-project discovery cache as the primary planning artifact.

This repository already has live code-intelligence indexes (Serena + GitNexus). Discovery should be:
- feature-scoped,
- evidence-based,
- and regenerated/updated per feature.

Use:
- `.planning/history/<feature>/discovery.md`
- `.planning/history/<feature>/discovery-lanes/*.md`

## Decision Flow

### If `.planning/history/<feature>/discovery.md` exists

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

Within each dimension, honor the active repository/project instructions and discovered topology. Do not assume fixed backend/frontend folders. When multiple components or repositories are involved, sweep every relevant surface, report the contract provider/source-of-truth first, then downstream consumer impact; state any intentionally skipped surface and why.

### If `.planning/history/<feature>/discovery.md` does NOT exist

```text
⏳ No feature discovery found. Running Phase 1 discovery lanes...
```

Proceed to Phase 1 and generate all lane artifacts.

## Phase 1 lane outputs (required)

Each `general-purpose` lane agent writes its own full detailed, non-summary canonical file directly:

- `.planning/history/<feature>/discovery-lanes/1-architecture.md`
- `.planning/history/<feature>/discovery-lanes/2-patterns.md`
- `.planning/history/<feature>/discovery-lanes/3-constraints.md`
- `.planning/history/<feature>/discovery-lanes/4-external.md`

After all four lane files exist, the main agent reads them as sufficient context by default, self-fills only a specific remaining gap when necessary, and compiles:
- `.planning/history/<feature>/discovery.md`

Do not copy background response bodies into lane files and do not replace lane artifacts with main-agent summaries.

## Discovery synthesis template (minimum)

`.planning/history/<feature>/discovery.md` should contain:

```markdown
# Feature Discovery: <feature>

## Scope
## Architecture Findings (dependency / contract order)
## Contract / Interface Changes
## Dependent Consumer Impact (UI/API/worker/etc., as applicable)
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

- Avoid introducing `.planning/history/full-project-discovery/` as required source-of-truth.
- Use indexes as truth, markdown as feature-specific snapshot for planning handoff.
- Keep discovery compact and current to this feature only.
