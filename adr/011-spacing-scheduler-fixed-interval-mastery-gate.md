# Implement the spacing scheduler as a fixed 24-hour equal-interval state machine with a per-session mastery gate

ADR-011: spacing scheduler — fixed-interval, mastery-gated state machine

# Status: Accepted

# Context

ADR-007 introduces the Training Context with a `SpacingSchedule` aggregate, and ADR-008 persists a
`spacing_schedules` table whose lifecycle state column takes the values `due` / `gate` / `done` /
`rest` plus recent accuracy. Both ADRs name the aggregate, its identifier, its table, and its state
set, but neither fixes the algorithm that moves a contrast between those states or the timing that
decides when a contrast becomes a presentation candidate. The scheduling algorithm and the
state-transition table are absent: there is no rule for when a contrast is due, what gates a state
change, or when a session is cut off. Without that rule the `spacing_schedules` table has columns but
no behavior, and REQ-127 is unsatisfiable.

REQ-127 (分散学習スケジューラ, priority Should) gives the acceptance criteria directly: sessions for the
same contrast are proposed at roughly 24-hour equal intervals (extending intervals are explicitly not
required, because equal and expanding spacing show no significant difference); the interval is not
opened until the per-session accuracy reaches 60% (a minimum-mastery-strength gate); and one session is
cut off at 20–30 minutes.

The research report (`docs/06-research/pronunciation-feedback-research.md`) grounds each of those
values. §3.3-4 records that equal-interval and expanding spacing both produce roughly twice the delayed
effect of massed practice (Saito & Chen 2025: delayed d 0.99–1.21 vs 0.26) and that equal and expanding
intervals show **no significant difference**, with the explicit design implication that a roughly
24-hour equal interval is sufficient and Anki-style expanding intervals are not worth chasing, and that
the interval should not open until per-session accuracy exceeds 60%. §3.3-1 records that one HVPT
session is 20–30 minutes and that total training plateaus at 300–400 minutes, which fixes the
per-session cut-off and matches the 20–30-minute session bound REQ-121/REQ-122 already carry into
`training_sessions` (ADR-008).

The training-session history needed to feed the accuracy gate also does not exist yet outside the
schema introduced in ADR-008: before `training_sessions` and `hvpt_trials` are populated, there is no
per-session accuracy to gate on. This ADR fixes the algorithm that consumes that history once it is
written.

Alternatives considered:

- **(a) Fixed 24-hour equal-interval scheduler with a 60% per-session accuracy gate, as a state
  machine over `SpacingSchedule`.** Proposes the same contrast at a roughly 24-hour equal interval,
  opens the interval only after a session reaches 60% accuracy, and cuts the session at 20–30 minutes.
  The state set is exactly the `due` / `gate` / `done` / `rest` already persisted by ADR-008.
- **(b) SM-2 / Anki-style expanding-interval SRS.** Computes an ease factor and grows the interval on
  each successful review, as spaced-repetition flashcard systems do.
- **(c) Fixed-interval presentation queue with no mastery gate.** Re-presents each contrast every 24
  hours regardless of how the session went.

# Decision

**Implement the spacing scheduler as a fixed 24-hour equal-interval state machine with a per-session
mastery gate, persisted on the `SpacingSchedule` aggregate.** A contrast is re-proposed at a roughly
24-hour equal interval; a session is gated by a 60% per-session accuracy threshold; and a session is cut
off at 20–30 minutes. Expanding intervals (SRS / Anki-style) are not adopted: the research shows equal
and expanding spacing have no significant difference (§3.3-4), so a fixed equal interval satisfies the
requirement at the smallest implementation.

The three values are requirement-derived fixed constants, not tuned or estimated numbers:

- **Interval = 24 hours** (REQ-127 acceptance criterion; §3.3-4 "24h 程度の等間隔で十分").
- **Gate threshold = 60% per-session accuracy** (REQ-127 acceptance criterion; §3.3-4 "正答率 >60% に
  達してから間隔を空ける").
- **Session cut-off = 20–30 minutes** (REQ-127 acceptance criterion; §3.3-1 "1 セッション 20–30 分").

**State machine.** The aggregate moves over the four states ADR-008 already persists
(`rest` / `due` / `gate` / `done`):

- **`rest`** — the next presentation time has not yet arrived. The contrast is not a presentation
  candidate.
- **`rest` → `due`** — 24 hours have elapsed since the last session; the contrast becomes a
  presentation candidate.
- **`due` → session** — the learner runs a `TrainingSession` for the contrast. The session ends at the
  prescribed trial count or at the 20–30-minute cut-off, whichever comes first. The session's
  per-session accuracy is computed from its `HvptTrial` correctness.
- **session → `done`** — per-session accuracy ≥ 60%: the gate is passed. The interval is opened: the
  next presentation time is set to now + 24 hours and the contrast returns to `rest`.
- **session → `gate`** — per-session accuracy < 60%: the gate is not passed. The interval is **not**
  opened; the contrast is re-presented at a short interval (it does not wait the full 24 hours) so the
  learner re-drills the same contrast before mastery strength is reached.

The interval only opens through the `done` transition; a sub-60% session never advances the 24-hour
clock. This is exactly the "do not open the interval until 60%" mastery gate REQ-127 requires.

**Placement.** The state-transition logic and the time arithmetic (elapsed-since-last-session, next
presentation time) live in the **Training Context's use-case / domain layer as pure logic**, consistent
with ADR-007's placement of training behavior and the repository's onion discipline (domain and use-case
layers hold no infrastructure). The use case reads `training_sessions` / `hvpt_trials` to compute
per-session accuracy and writes the resulting state and next-presentation time back to
`spacing_schedules`. Identifiers follow the project naming rules: the aggregate's self-identifier field
is `identifier` of type `SpacingScheduleIdentifier`, and references to other aggregates are named after
the referenced model without an `Identifier` suffix (ADR-007).

**Constraints (must remain true for this decision to hold):**

- The scheduler is **deterministic**: state transitions and the next-presentation time are a pure
  function of persisted state (last-session time, per-session accuracy) and the current clock. No
  randomness participates in scheduling; an expanding-interval ease factor is not introduced.
- Every state transition is **persisted on `SpacingSchedule`** (`spacing_schedules`): the `due` / `gate`
  / `done` / `rest` state and the next-presentation time are written back, not held only in memory. The
  schedule is reconstructable from the row.
- The interval (24 hours), the gate threshold (60%), and the session cut-off (20–30 minutes) stay equal
  to their REQ-127 values. Changing any of them requires re-deriving from the requirement and the
  research, not silent tuning.
- The interval opens only on a gate-passing (`done`) transition. A sub-60% session must route to `gate`
  and re-present at a short interval; it must not advance the 24-hour clock.

# Consequences

Positive:

- REQ-127 is satisfied at the smallest implementation that meets it. A fixed equal interval plus a
  threshold gate is a small pure state machine — no ease-factor model, no review-history scoring — and
  the research (§3.3-4) says nothing more is warranted because expanding intervals carry no significant
  advantage.
- The scheduler is deterministic and fully persisted, so the next presentation candidate is reproducible
  and unit-testable: given a row's last-session time, accuracy, and a clock, the next state and next
  presentation time are fixed.
- The state set matches `spacing_schedules` exactly (ADR-008), so no schema change is needed to carry the
  scheduler; the aggregate and table already hold every field the state machine writes.
- The "interval opens only on a 60% session" rule encodes the mastery gate in the transition function
  itself, so a contrast that has not reached mastery strength cannot drift onto the long interval.

Negative / trade-offs:

- A fixed 24-hour interval does not lengthen as a contrast is mastered, so a well-mastered contrast is
  still re-proposed daily rather than at a growing cadence. The research finds no significant loss from
  this (equal vs expanding: no significant difference), but it does mean more presentations of mastered
  contrasts than an expanding schedule would issue.
- The accuracy gate depends on `training_sessions` / `hvpt_trials` being populated (ADR-008). Until a
  session has run, a contrast has no per-session accuracy and cannot pass the gate; the scheduler is
  inert for a contrast with no session history.
- The short-interval re-presentation on a failed gate is a second timing path beside the 24-hour
  interval; the use case must keep both the failed-gate short interval and the passed-gate 24-hour
  interval coherent on the same aggregate.

Alternatives considered:

- **(b) SM-2 / Anki-style expanding-interval SRS is rejected.** The research shows equal and expanding
  spacing have no significant difference (§3.3-4), so an ease-factor model and per-review interval growth
  add complexity the evidence does not justify. It is over-engineered for a requirement that an equal
  interval already meets.
- **(c) Fixed-interval queue with no mastery gate is rejected.** It cannot satisfy REQ-127's 60%
  per-session accuracy gate: re-presenting every 24 hours regardless of session accuracy would open the
  interval before mastery strength is reached, which the acceptance criterion forbids.

# Compliance

- The state-transition logic and time arithmetic live in the Training Context use-case / domain layer
  (ADR-007 placement), so the existing fitness functions apply: the ESLint
  `architecture-import/no-restricted-paths` rule keeps the dependency direction inward, and the ast-grep
  rules keep the no-class constraint and the layer closure (Drizzle / `process.env` confinement) — the
  scheduler use case holds no infrastructure import.
- A use-case unit test asserts the three requirement values directly: that the opened interval is 24
  hours, that the gate threshold is 60% per-session accuracy, and that a sub-60% session routes to `gate`
  and does not advance the 24-hour clock while a ≥60% session routes to `done` and opens the interval.
  The test asserts the values equal their REQ-127 numbers, so a drift in any constant fails the test.
- A use-case unit test asserts the scheduler is **deterministic**: with a fixed last-session time,
  accuracy, and injected clock, the next state and next presentation time are fixed across runs (no
  randomness participates).
- Every transition is written back to `spacing_schedules` through the repository; a test asserts the
  resulting `due` / `gate` / `done` / `rest` state and next-presentation time are persisted on the
  `SpacingSchedule` row, not held only in memory.
- The 20–30-minute session cut-off is enforced in the use case and the training UI: a `TrainingSession`
  ends at the cut-off (or the prescribed trial count) before its accuracy is gated. The cut-off upper
  bound is asserted so a session cannot run past it.
- No schema change ships with this ADR: `spacing_schedules` already carries the `due` / `gate` / `done` /
  `rest` state and recent accuracy (ADR-008). If a future change adds a scheduler column, the
  `frontend-schema-needs-migration` wiring rule (ADR-008) requires the matching migration in the same PR.

# Notes

- Author: lihs
- Approval date: 2026-06-13
- Approver:
- Last updated: 2026-06-13
- Changes: Initial entry. Related: ADR-007 (introduces the Training Context and the `SpacingSchedule`
  aggregate this ADR gives behavior to), ADR-008 (persists the `spacing_schedules` table and its
  `due` / `gate` / `done` / `rest` state set used here). Originating requirement: REQ-127 (分散学習
  スケジューラ). Research basis: §3.3-4 (equal vs expanding spacing: no significant difference; ~24h equal
  interval and >60% accuracy gate sufficient), §3.3-1 (HVPT session 20–30 min, plateau at 300–400 min).
