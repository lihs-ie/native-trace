# Separate diagnosis, training, and progress into a Training Context distinct from the Pronunciation Practice Context

ADR-007: Training Context bounded context

# Status: Accepted

# Context

The domain design document (`docs/03-detailed-design/domain.md`, DD-001) defines a single
bounded context for the MVP — the **Pronunciation Practice Context** (PPC) — with nine aggregates:
`Material`, `SectionSeries`, `Section`, `RecordingAttempt`, `AudioFile`, `AnalysisRun`,
`AnalysisJob`, `AssessmentResult`, and `AnalysisEngine`. The PPC models one workflow: a learner
practices a `Section`, recording is auto-analyzed after stop, and results are shown as in-text
highlights. Every aggregate in that context serves that single record-once-analyze-once loop.

The pronunciation-feedback requirements add a Phase 3 capability set that the PPC does not cover.
REQ-121 specifies a short (2–5 minute) diagnostic that initializes a weakness profile and is then
incrementally updated from everyday analysis results. REQ-122 specifies an HVPT perceptual training
module with multi-talker forced-choice identification trials and cumulative training time. REQ-123
specifies minimal-pair production drills with immediate, target-phoneme-scoped evaluation. REQ-125
specifies a shadowing mode with weekly session counts. REQ-127 specifies an equal-interval spacing
scheduler with a 60% per-session accuracy gate. REQ-129 specifies progress visualization (per-focus
score trend over time, a CEFR three-subscale radar, and cumulative training time). These requirements
are specified down to acceptance criteria, but the design-layer documents (domain / use-case /
infrastructure) contain no model for them — the design layer for diagnosis, training, and progress is
absent.

The research report (`docs/06-research/pronunciation-feedback-research.md`) records that the current
product "evaluates and stops — no training loop exists" (C-7), and that commercial CAPT products share
one loop pattern (B-4): short diagnosis → focus-sounds extraction → daily drills → **the diagnostic
profile is updated incrementally from daily drill results** (no separate re-diagnosis test), with
progress shown as multi-axis score trends plus focus-sounds consumption. This loop is a time-series
workflow over many sessions, structurally different from the PPC's single record-once-analyze-once
practice.

Alternatives considered:

- **(a) New bounded context "Training Context", referencing the PPC by identifier only.** Keeps the
  PPC's nine aggregates untouched and models diagnosis, training, and progress as their own context
  with their own aggregates. The two contexts are coupled only through identifier references, matching
  the existing rule that cross-aggregate references carry identifiers only.
- **(b) Add the new aggregates to the PPC.** Lighter to wire initially, but raises the PPC's coupling:
  the practice loop and the training loop would share one context boundary despite having distinct
  lifecycles (one-shot practice vs. multi-session time-series training). Later separation would then
  cost a context split across persisted data.
- **(c) Split only progress into a CQRS read context, keeping diagnosis and training in the PPC.**
  Diagnosis and training are themselves new time-series workflows, so isolating only the read side
  leaves the heavier new write models inside the PPC and yields an inconsistent partial split.

# Decision

**Separate diagnosis, training, and progress from the Pronunciation Practice Context into a new
bounded context, the Training Context.** The Training Context stands alongside the existing PPC; the
PPC's nine aggregates are not modified.

The Training Context holds six aggregates. Each follows the project naming rules
(`docs/03-detailed-design/domain.md`: self-identifier field named `identifier`, identifier type named
`XXXIdentifier`, references to other aggregates named after the referenced model without an
`Identifier` suffix):

1. **`DiagnosticSession`** (identifier: `DiagnosticSessionIdentifier`) — one short diagnostic run that
   produces a `WeaknessProfile`.
2. **`WeaknessProfile`** (identifier: `WeaknessProfileIdentifier`) — persistent per learner. Holds focus
   sounds ranked by FL rank × occurrence frequency × mastery, updated thereafter with an exponentially
   weighted moving average as everyday results accrue.
3. **`TrainingSession`** (identifier: `TrainingSessionIdentifier`) — one HVPT / drill / shadowing
   session, holding its trials and cumulative time.
4. **`HvptTrial`** (identifier: `HvptTrialIdentifier`) — one identification trial (stimulus reference,
   response, correctness).
5. **`SpacingSchedule`** (identifier: `SpacingScheduleIdentifier`) — per-contrast next-presentation time
   and state.
6. **`ProgressSnapshot`** (identifier: `ProgressSnapshotIdentifier`) — a timestamped aggregate (CEFR
   subscales + per-focus scores + cumulative training time).

The persisted tables are `diagnostic_sessions`, `weakness_profiles`, `training_sessions`,
`hvpt_trials`, `spacing_schedules`, and `progress_snapshots`.

**The Training Context references the PPC by identifier only.** Where training reuses an evaluated
recording or a practiced text — for instance a diagnostic that ingests an `AssessmentResult`, or a drill
generated from a `Section` — the Training Context holds the `AssessmentResult` / `Section` identifier,
not the PPC aggregate. This applies the domain rule that cross-aggregate references carry identifiers
only; here it is extended to the cross-context boundary. The Training Context does not import PPC
internal implementation.

**Scoring stays where ADR-004 placed it.** Immediate evaluation of a produced drill (REQ-123: target-
phoneme-scoped GOP / NBest diagnosis returned within seconds) reuses the Haskell worker's scoring locus
from ADR-004 — the worker computes severity / `scoreImpact` from a structured diff with a closed
`phenomenon` enum, and `python-analyzer` returns raw measurements only. The Training Context does not
introduce a second scoring policy; it requests evaluation through the same worker boundary and stores
the returned scores on `HvptTrial` / `TrainingSession` / `ProgressSnapshot`.

**Constraints (must remain true for this decision to hold)**:

- The Training Context references the PPC exclusively through `AssessmentResult` / `Section`
  identifiers. Any import of a PPC aggregate's internal type into the Training Context (or vice versa)
  voids the context boundary.
- The PPC's nine aggregates remain unchanged by this ADR. Training-specific state lives only in the six
  Training Context aggregates and their tables.
- Drill evaluation requests scoring from the Haskell worker (ADR-004). The Training Context must not
  compute GOP-threshold-to-severity scoring of its own.

# Consequences

Positive:

- The single record-once-analyze-once practice loop (PPC) and the multi-session diagnosis → training →
  progress loop (Training Context) have independent lifecycles and independent aggregate sets, so neither
  loop's evolution forces a change to the other.
- The context boundary is enforced by the same dependency-direction checks already governing the
  codebase, so the identifier-only coupling is machine-checked rather than assumed.
- Drill evaluation reuses the worker scoring locus (ADR-004) without duplicating calibration, keeping a
  single source of scoring policy across practice and training.

Negative / trade-offs:

- A second bounded context adds aggregates, tables, and use-case wiring beyond the PPC, which is more
  surface than adding the same models inside the existing context.
- The identifier-only boundary means training flows that need PPC data resolve it through use-case ports
  rather than direct aggregate access, adding an indirection at the context edge.

Alternatives considered:

- **(b) Add the new aggregates to the PPC** is rejected: it raises the PPC's coupling and defers, at
  higher cost, a context split that the distinct lifecycles already justify now.
- **(c) Split only progress into a CQRS read context** is rejected: diagnosis and training are
  themselves new write-side workflows, so a read-only partial split is inconsistent and leaves the heavier
  new models inside the PPC.

# Compliance

- The Training Context occupies its own directories under each layer, and the existing fitness functions
  apply to them: the ESLint `architecture-import/no-restricted-paths` rule enforces layer and context
  boundaries, and the ast-grep rules enforce the no-class constraint and layer closure (Drizzle / OpenAI
  SDK / `process.env` confinement). Per the same-PR rule for new layers established in ADR-005,
  introducing the Training Context directories ships the corresponding fitness-function entries in the
  same PR.
- The dependency-direction check asserts that the Training Context imports no PPC internal
  implementation and references the PPC only through `AssessmentResult` / `Section` identifiers, and that
  the PPC imports nothing from the Training Context. Both run in the edit-time fitness hook and in CI.
- Drill evaluation goes through the Haskell worker boundary (ADR-004); no GOP-threshold scoring policy is
  added to the Training Context.

# Notes

- Author: lihs
- Approval date: 2026-06-13
- Approver:
- Last updated: 2026-06-13
- Changes: Initial entry. Related: ADR-004 (scoring policy concentrated in the Haskell worker;
  structured-diff contract reused for drill evaluation), ADR-005 (onion architecture and fitness
  functions; same-PR rule for new layers). Originating requirements: REQ-121 (diagnostic / weakness
  profile), REQ-122 (HVPT), REQ-123 (minimal-pair production drills), REQ-125 (shadowing), REQ-127
  (spacing scheduler), REQ-129 (progress visualization). Research basis: B-4 (diagnosis → drill →
  incremental-update loop), C-7 (no training loop exists today).
