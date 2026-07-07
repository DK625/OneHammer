# Phase Plan: <Feature Name>

**Date**: <YYYY-MM-DD>
**Feature**: <feature-slug>
**Based on**:
- `history/<feature>/CONTEXT.md`
- `history/<feature>/discovery.md`
- `history/<feature>/approach.md`

## Readability Guardrails (must follow)

- Write mainly in Vietnamese; keep core technical terms in English.
- At first mention of a technical term, add a short Vietnamese explanation in parentheses.
- Avoid dense lines that stack multiple abstract terms without unpacking.
- For each `Why` statement, add one concrete `If skipped` scenario.
- For each story, use short `Input` + `Guarantee`; add `Failure avoided` when needed.

---

## 1. Feature Summary

> Explain the full feature in plain language. A non-planner should understand what is being built and why the work is being split.

`<2-4 sentences describing the real-world capability and why phased delivery makes sense.>`

---

## 2. Why This Breakdown

- `<Why Phase 1 must happen first>`
  
  If skipped: `<concrete failure scenario: who is impacted, what breaks, and why>`
- `<Why later phases are separate instead of folded into Phase 1>`
  
  If skipped: `<concrete failure scenario>`
- `<What risk or ambiguity this phased approach contains>`
  
  If skipped: `<concrete failure scenario>`

---

## 3. Phase Overview Table

| Phase | What Changes In Real Life | Why This Phase Exists Now | Demo Walkthrough | Unlocks Next |
|-------|----------------------------|---------------------------|------------------|--------------|
| Phase 1: `<name>` | `<what users/systems can now do>` | `<why first>` | `<simple proof>` | `<next phase>` |
| Phase 2: `<name>` | `<what becomes true next>` | `<why second>` | `<simple proof>` | `<next phase>` |
| Phase 3: `<name>` | `<what completes the feature>` | `<why later>` | `<simple proof>` | `<what follows>` |

Remove unused rows. Most features should fit in 2-4 phases.

---

## 4. Phase Details

### Phase 1: <Name>

- **What Changes In Real Life**: `<observable outcome>`
- **Why This Phase Exists Now**: `<why it must happen before later phases>`
- **If skipped**: `<concrete failure scenario>`
- **Stories Inside This Phase**:
  - **Story 1: `<name>`** — `<what happens in practical terms>`
    - Input: `<event/request/data entering this story>`
    - Guarantee: `<what must be true after this story>`
    - Failure avoided: `<optional, when non-obvious>`
  - **Story 2: `<name>`** — `<what happens in practical terms>`
    - Input: `<event/request/data entering this story>`
    - Guarantee: `<what must be true after this story>`
    - Failure avoided: `<optional, when non-obvious>`
  - **Story 3: `<name>`** — `<what happens in practical terms>`
    - Input: `<event/request/data entering this story>`
    - Guarantee: `<what must be true after this story>`
    - Failure avoided: `<optional, when non-obvious>`
- **Demo Walkthrough**: `<1 short paragraph>`
- **Unlocks Next**: `<next phase or capability>`

### Phase 2: <Name>

- **What Changes In Real Life**: `<observable outcome>`
- **Why This Phase Exists Now**: `<why it happens after Phase 1>`
- **If skipped**: `<concrete failure scenario>`
- **Stories Inside This Phase**:
  - **Story 1: `<name>`** — `<what happens in practical terms>`
    - Input: `<event/request/data entering this story>`
    - Guarantee: `<what must be true after this story>`
    - Failure avoided: `<optional, when non-obvious>`
  - **Story 2: `<name>`** — `<what happens in practical terms>`
    - Input: `<event/request/data entering this story>`
    - Guarantee: `<what must be true after this story>`
    - Failure avoided: `<optional, when non-obvious>`
  - **Story 3: `<name>`** — `<what happens in practical terms>`
    - Input: `<event/request/data entering this story>`
    - Guarantee: `<what must be true after this story>`
    - Failure avoided: `<optional, when non-obvious>`
- **Demo Walkthrough**: `<1 short paragraph>`
- **Unlocks Next**: `<next phase or capability>`

### Phase 3: <Name>

- **What Changes In Real Life**: `<observable outcome>`
- **Why This Phase Exists Now**: `<why it closes the feature>`
- **If skipped**: `<concrete failure scenario>`
- **Stories Inside This Phase**:
  - **Story 1: `<name>`** — `<what happens in practical terms>`
    - Input: `<event/request/data entering this story>`
    - Guarantee: `<what must be true after this story>`
    - Failure avoided: `<optional, when non-obvious>`
  - **Story 2: `<name>`** — `<what happens in practical terms>`
    - Input: `<event/request/data entering this story>`
    - Guarantee: `<what must be true after this story>`
    - Failure avoided: `<optional, when non-obvious>`
  - **Story 3: `<name>`** — `<what happens in practical terms>`
    - Input: `<event/request/data entering this story>`
    - Guarantee: `<what must be true after this story>`
    - Failure avoided: `<optional, when non-obvious>`
- **Demo Walkthrough**: `<1 short paragraph>`
- **Unlocks Next**: `<next feature, review, or ship>`

Remove unused phase sections and keep only the real phases.

---

## 5. Phase Order Check

> A human should be able to answer "why this phase before the next one?" without reading implementation details.

- [ ] Phase 1 is obviously first
- [ ] Each later phase depends on or benefits from the one before it
- [ ] No phase is just a technical bucket with no user/system meaning
- [ ] Every `Why` includes a concrete `If skipped` scenario
- [ ] Every story includes `Input` and `Guarantee`
- [ ] No sentence stacks 3+ abstract technical terms without unpacking

If any box is unchecked, revise the breakdown before asking for approval.

---

## 6. Approval Summary

> This is the short version presented to the user before full-feature decomposition (all declared phases) begins.

- **Current phase to prepare next**: `Phase <n> - <name>`
- **What the user should picture after that phase**: `<one sentence>`
- **What will not happen until later phases**: `<one sentence>`

