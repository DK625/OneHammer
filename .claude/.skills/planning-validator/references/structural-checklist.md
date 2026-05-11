# V1 Structural Checklist — Artifact + Section Schema

Use this as the definitive list for V1 structural verification. A missing artifact or a missing mandatory section is an automatic `BLOCKED`.

## Artifacts that MUST exist

| Path | Required | Notes |
|------|----------|-------|
| `history/<feature>/CONTEXT.md` or `history/<feature>/requirements.md` | one of two | locked decisions live here |
| `history/<feature>/discovery.md` | yes | 10-section synthesis |
| `history/<feature>/discovery-lanes/*.md` | recommended | 4 lane files (architecture/patterns/constraints/external) |
| `history/<feature>/approach.md` | yes | 4 mandatory sections |
| `history/<feature>/phase-plan.md` | yes | approved by user |
| `history/<feature>/phase-<n>-contract.md` | yes | current phase only |
| `history/<feature>/phase-<n>-story-map.md` | yes | current phase only |
| Beads with `phase-<n>` label or tag | yes | ≥ 1 |

## `discovery.md` — 10 mandatory sections

1. Scope
2. Architecture Findings (backend → frontend order)
3. Backend/API Contract Changes (or "None")
4. Frontend Impact (based on contract)
5. Existing Patterns To Reuse
6. Technical Constraints
7. External References (Exa evidence)
8. GitNexus Evidence (query / context / impact snippets)
9. Serena Evidence (symbols / files inspected)
10. Risks + Open Questions + Discovery Gaps (can be split into three subsections)

## `approach.md` — 4 mandatory sections

1. Gap Analysis
2. Recommended Approach
3. Alternatives Considered
4. Risk Map (LOW / MEDIUM / HIGH per item, with mitigation)

## `phase-<n>-contract.md` — 8 fields

1. What this phase changes
2. Why this phase exists now
3. Entry state
4. Exit state (observable)
5. Demo walkthrough
6. Unlocks (what later phases or features become possible)
7. Out of scope
8. Failure or pivot signals

## `phase-<n>-story-map.md` — per-story fields

For every story:

- Name / ID
- What happens in this story
- Why now
- Contributes to (which exit criterion)
- Creates (observable artifacts / behaviors)
- Unlocks
- Done looks like (runnable / observable)

Plus a Story-to-Bead mapping table that names each bead and its story.

## Beads — per-bead fields

Each bead must carry:

- Title with phase marker (e.g. `[Phase 2]`) or `phase-<n>` label
- Story reference
- Action description
- Acceptance / `verify:` field (runnable command or observable assertion)
- Completion evidence gate: the bead says not to run `br close` until required runtime evidence is captured in the close reason or a named evidence artifact
- BE/runtime verification details when applicable: API endpoint/method, auth/token source, expected status/response cues, DB query proof when named
- Migration/provisioning decision clause when applicable: inspect existing Alembic revisions first, classify schema/data/seed/existing-proof/no-migration, and avoid duplicate seed migrations
- FE verification details when applicable: `agent-browser` action and screenshot checkpoint/path
- File-scope hint (which paths it will touch)
- Dependencies declared via `br dep add`

## Fullstack fields (one_hammer specific)

When a phase touches both `onehammerStore` and `onehammerUI`:

- `phase-<n>-contract.md` must state which contract fields are being added/changed in the backend
- `phase-<n>-story-map.md` must order backend stories before frontend stories that depend on them
- Beads must label their half: backend beads touch `onehammerStore/**`, frontend beads touch `onehammerUI/**`

If a phase is pure-frontend or pure-backend, state that explicitly in the contract's "Out of scope" field.
