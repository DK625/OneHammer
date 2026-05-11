# V4 Exit-State Readiness Review

Human-readable readiness check. Each question must be answered YES or NO. Any NO or "not sure" → verdict is `NEEDS-REVISION` (not `BLOCKED` — revision is possible in-place; `BLOCKED` is reserved for V1-iteration-exhausted and V2-NO cases).

## Question Set

### Q1. Exit-state reachability

If every story reaches its `done looks like`, does the current phase exit state hold?

- YES if every exit criterion in `phase-<n>-contract.md` can be traced to at least one story's `done looks like`
- NO if any exit criterion has no story backing

### Q2. Story-to-bead closure

If every current-phase bead closes successfully, will every story be done?

- YES if every story has bead coverage for all parts of its `done looks like`
- NO if any story has an uncovered part

### Q3. Demo credibility

Is the phase demo walkthrough in `phase-<n>-contract.md` credible given the story + bead set?

- YES if a user / stakeholder would see the described behavior after this phase ships
- NO if the demo references behavior that would still be missing

### Q4. Whole-feature alignment

Does this phase still make sense in `phase-plan.md`?

- YES if later phases can still build on this phase's exit state
- NO if the phase boundary moved during decomposition and later phases are now blocked or duplicated

### Q5. Fullstack contract integrity (one_hammer specific)

Backend contract changes (if any) come from either:

- a prior COMPLETED phase (already shipped), OR
- the current phase's backend bead set

They must NEVER be implicitly deferred to a future phase while frontend beads in this phase depend on them.

- YES if every frontend bead's backend dependency is accounted for
- NO if any FE bead depends on a backend contract that is not owned anywhere

### Q6. Risk alignment

Every HIGH-risk item for this phase either:

- has a V2 spike with a YES verdict, OR
- is explicitly deferred to a later phase (documented in `phase-plan.md`)

- YES if all HIGH risks have a spike or a documented deferral
- NO if any HIGH risk is silently unaddressed

### Q7. Docs-sync integrity

Match the state snapshot against the docs-sync decision table from V1.4. If V1.4 passed with a note about a skip_reason, ensure that reason is still valid.

- YES if V1.4 conditions still hold
- NO if the skip_reason no longer applies (e.g. beads changed scope since V1)

## Routing Table

| Failing question | Fix file |
|---|---|
| Q1 Exit-state | `phase-<n>-contract.md` (tighten exit) or story map (add story) |
| Q2 Story closure | beads (add missing work) or story map (tighten `done looks like`) |
| Q3 Demo credibility | `phase-<n>-contract.md` (rewrite demo) or beads (add what the demo needs) |
| Q4 Whole-feature | `phase-plan.md` (rebalance phase boundaries) |
| Q5 Fullstack contract | either promote backend bead into this phase or push FE bead to a later phase |
| Q6 Risk alignment | V2 spike (create missing) or `phase-plan.md` (document deferral) |
| Q7 Docs-sync | Phase 6 docs-sync substep (create bead or re-record skip_reason) |

## Output for V5

V4 produces a summary block that feeds directly into V5's final report:

```text
V4 Exit-State Readiness:
- Q1 exit reachable:        <YES|NO>
- Q2 story-to-bead closure: <YES|NO>
- Q3 demo credible:         <YES|NO>
- Q4 phase-plan aligned:    <YES|NO>
- Q5 fullstack contract:    <YES|NO>
- Q6 risk aligned:          <YES|NO>
- Q7 docs-sync valid:       <YES|NO>
```

All seven must be YES for verdict `READY`.
