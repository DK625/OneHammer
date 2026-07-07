# V3 Bead Quality Checklist — CRITICAL vs MINOR classifier

This is the classifier the V3.5 fresh-eyes reviewer uses when generating flags. Also used by V3.1–V3.4 as the baseline for "is this bead ready?".

## CRITICAL — executor will fail

A CRITICAL flag means an executor reading the bead alone will either fail to complete it correctly, produce a wrong result, or be blocked with no path forward. ALL CRITICAL flags must be fixed before V4.

### C1. Assumed context

The bead references a decision, pattern, or choice that is not spelled out in the bead itself.

- Fail: "Implement auth following the pattern we decided on"
- Fail: "Same approach as BR-003" (the executor may not have read BR-003)
- Pass: "Implement auth using JWT RS256 via `jose`. Token expiry 24h. Refresh token 7d in httpOnly cookie."

### C2. Vague acceptance criteria

"Done" is not verifiable by anyone other than the original planner.

- Fail: "Make sure the UI looks right"
- Fail: "Add proper error handling"
- Pass: "POST /api/users with valid payload returns 201 + user object (no password field). Duplicate email returns 409. Missing required field returns 400 with field name in error."

### C3. Scope overload

Bead spans multiple layers / concerns / subsystems.

- Fail: one bead implements DB layer + API layer + frontend + integration tests
- Fail: 5+ "and also" connectors in the action section
- Pass: bead covers exactly one concern, one layer, one set of related files

### C4. Missing implementation path

Bead says what to build but not how, and "how" has multiple incompatible interpretations.

- Fail: "Add rate limiting to the API" (IP? user? token-bucket? which library?)
- Pass: "Use `express-rate-limit`. 100 requests per 15-minute window per IP. Return 429 + `Retry-After`. Exempt `/health`."

### C5. Broken or missing verify step

- Fail: no `verify:` field
- Fail: `verify: make sure it works`
- Fail: `verify: write tests` (this is implementation, not verification)
- Pass: `verify: npm test -- --grep 'RateLimiter' → 5 green. curl 101 sequential requests → 101st returns 429.`

### C6. Cross-surface contract mismatch

A consumer-side bead (UI, client, worker, service, or another repo) references an endpoint/schema/interface that is not defined or owned by any prior-phase or current-phase provider bead.

- Fail: FE bead calls `POST /api/v2/rooms/batch` but no backend bead creates that route
- Pass: FE bead cites the backend bead (`br-abc`) that owns the endpoint

## MINOR — executor will guess

A MINOR flag means the executor can probably complete the bead but will make judgment calls the planner did not intend to leave open. Fix recommended, not blocking.

### M1. Missing rationale

Bead makes a specific technical choice without explaining why.

- Example: "Use `pg` not `drizzle` for this query" — fine, but executors may second-guess if unsure why

### M2. Implicit file assumptions

Bead refers to files that may or may not exist and does not state create-vs-read.

### M3. Ambiguous scope boundary

Two beads partially overlap. Not duplicates — just a fuzzy boundary.

### M4. No notes on known tradeoffs

A technical choice with plausible alternatives and no note explaining the choice.

## Calibration targets

A polished bead set should have:

- 0–2 CRITICAL flags total (if more, plan needs another polish round before V4)
- 3–8 MINOR flags (normal)
- Majority of beads clean

If a set of ~20 beads shows > 5 CRITICAL flags, the plan needs significant rework — individual bead fixes will not be sufficient.

## Do NOT flag

- Short beads whose scope is genuinely narrow (brevity is fine)
- Architectural decisions the reviewer disagrees with (that is planning's domain)
- Beads that reference other beads by ID (valid pattern — executor reads the graph)
- Missing features outside this bead's scope
- Style / naming / formatting preferences
