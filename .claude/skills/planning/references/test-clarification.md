# Phase 1.6: Test Clarification

**After Phase 1.5 business clarification, ask user about testing expectations in Phase 1.6.**

## Why This Phase Exists

Different features need different testing approaches. Don't assume - ask user what they want to verify and how.

## ⚠️ CRITICAL: E2E Tests MUST Have Evidence

| Feature Mode | FE Evidence | BE Evidence | Integration Evidence |
|--------------|-------------|-------------|----------------------|
| fullstack | Interpreted screenshots at important checkpoints (before action + after/final state, with what each image proves) | API call proof + response (and DB/query when relevant) | FE action must map to browser-observed BE side-effect/response proof with method + path + status |
| fe-only | Interpreted screenshots at important checkpoints (before action + after/final state, with what each image proves) | N/A (explicitly mark) | Browser flow assertion proving expected UX state; network/API cue may be explicit N/A only for UI-only behavior |
| be-only | N/A (explicitly mark) | API call proof + response (and DB/query when relevant) | API/DB consistency assertion |

For every FE-involving mode (`fullstack`, `fe-only`), use `agent-browser` E2E, capture screenshots at user-approved important moments, then inspect/read those screenshots and write what each image proves or disproves.

**NOT acceptable:**
- ❌ "Code review only"
- ❌ "Test should pass"
- ❌ "Manual test" without screenshots
- ❌ Screenshot files captured but not read/interpreted
- ❌ HAR/network artifact with `0 requests` used as proof

## Step 1: Ask User via AskUserQuestion

Phase 1.6 still follows the strict pipeline gate: **exactly 8 questions in 2 rounds, 4 questions per round**.

Language and recommendation convention (same as Phase 1.5): write question text, option labels, and option descriptions in Vietnamese (keep technical terms like `fullstack`/`fe-only`/`be-only`, screenshot, curl in English). Put your recommended option FIRST with the label suffix ` (Khuyến nghị)` and a one-sentence description of why it fits this feature.

Required question themes across 2 rounds:
1. Feature test mode classification: `fullstack`, `fe-only`, or `be-only`.
2. Golden path proof and failure-path proof.
3. Evidence requirements for FE/BE/integration based on chosen mode.
4. Environment/seed data and sign-off owner.
5. **FE screenshot timing selection (mandatory when FE is involved)**.

When FE is involved (`fullstack` or `fe-only`), include a question that lists screenshot timing candidates so the user can choose checkpoints. Example options:

- Before login / before entering form input
- After click `Save` / `Submit`
- After redirect completes
- After toast/alert appears
- After table/list refreshes
- Final state at destination page

For `fe-only`, default FE test approach is `agent-browser` E2E (not manual-only visual check).

## Step 2: Create Test Scenarios (MANDATORY)

**CRITICAL:** Write `test-scenarios.md` after Phase 1.6 reaches 8/8 and before advancing to Phase 2.

Do **not** add extra AskUserQuestion review pauses in this step; Phase 1.6 AskUserQuestion usage is already fixed to 2 rounds of 4 questions.

**Test Scenario Template:**

```markdown
# Test Scenarios: <Feature Name>

## Overview
- **Feature:** <feature description>
- **Feature Mode:** fullstack | fe-only | be-only
- **Test Type:** E2E / API / Integration
- **Skill Reference:** agent-browser (for FE-involving modes), curl/sql for backend verification

## Prerequisites
- [ ] Dev server running
- [ ] Test credentials available (from .env)

## Test Cases

| # | Test Case | Steps | Expected Result | Priority |
|---|-----------|-------|-----------------|----------|
| 1 | <case name> | <steps> | <expected> | HIGH |
| 2 | <case name> | <steps> | <expected> | HIGH |

## Evidence Matrix

| Case | Evidence Owner Bead | FE Screenshot Evidence | BE API/Logic Evidence | FE↔BE Integration Evidence |
|------|---------------------|-------------------------|------------------------|-----------------------------|
| TC1 | `BE/API bead` or `FE/UI bead` | `<before path + after/final path + what each image proves>` or `N/A` | `<curl + response / query>` or `N/A` | `<browser-observed method + path + status + network artifact>` or `N/A` |
| TC2 | `BE/API bead` or `FE/UI bead` | `<before path + after/final path + what each image proves>` or `N/A` | `<curl + response / query>` or `N/A` | `<browser-observed method + path + status + network artifact>` or `N/A` |

For fullstack mode, split evidence ownership by default: BE/API beads own curl/HTTP proof, while FE/UI beads own agent-browser screenshots and browser-observed FE↔BE cues. Do not combine those evidence owners in one bead unless Phase 5 records a `Single-session exception:`.

## FE Screenshot Checkpoints (when FE is involved)

- Required checkpoints selected in Phase 1.6:
  - [ ] Before action: <example: before clicking Save>
  - [ ] After action: <example: after clicking Save>
  - [ ] Final state: <example: after redirect/page settled>
- Optional checkpoints:
  - [ ] Before login
  - [ ] After login redirect
  - [ ] After toast appears
  - [ ] After list/table refresh

## Edge Cases

| # | Edge Case | Expected Behavior |
|---|-----------|-------------------|
| E1 | <edge case> | <behavior> |

## Test Commands (API/BE)

\`\`\`bash
curl -X PUT "http://localhost:8000/api/endpoint" \
  -H "Authorization: Bearer {token}"
\`\`\`

## Browser Runbook (FE/UI bead)

- Browser Runbook Reference: `.claude/lessons/browser-runbook.md`
- Required browser flow summary: `<base URL/env source, login/session method, start page, fixture/precondition, action sequence, expected network/API cue, expected UI state, before screenshot path, after/final screenshot path, screenshot interpretation requirement, network artifact/requests log path, quality-gate command/result classification>`
- Runbook delta expectation: `<unchanged | durable login/navigation/selector/network/UI discovery to append to .claude/lessons/browser-runbook.md during the FE/browser bead>`
- Stop rule: if the browser flow fails because BE/API behavior is wrong, report the API cue and route back to the BE/API bead instead of expanding FE scope.
- Do not create feature-specific runbook files; keep durable route/login/selector/state discoveries in the single lessons runbook.
```

**Save test scenarios to:** `.planning/history/<feature>/test-scenarios.md`

## Bead linkage note

Detailed bead creation still belongs to **Phase 5** (after required approvals).  
Do not create extra AskUserQuestion review pauses or Phase-1.6-only bead flows that conflict with the strict pipeline gates.

## Rules

1. **Phase 1.6 question contract is fixed**: exactly 8 questions in 2 AskUserQuestion rounds of 4.
2. **Mode-aware evidence is mandatory**: fullstack / fe-only / be-only must be explicit in test scenarios.
3. **FE-involving modes require agent-browser E2E evidence** with screenshots at user-approved important checkpoints.
4. **Direct results**: show concrete outputs (screenshot paths, curl responses, query results).
5. **No unittest-only validation**: use real API calls / real browser flow / real integration behavior.
