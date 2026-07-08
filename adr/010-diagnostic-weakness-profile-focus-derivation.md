# Derive focus sounds from a rule-based diagnosis into a persisted weakness profile updated by EWMA

ADR-010: diagnostic / weakness-profile / focus-sound derivation

# Status: Accepted

# Context

ADR-007 separates diagnosis, training, and progress into the **Training Context**, where the
`DiagnosticSession` aggregate produces a persistent `WeaknessProfile` holding focus sounds ranked by
FL rank × occurrence frequency × mastery, updated thereafter by an exponentially weighted moving
average. ADR-008 fixes the storage shape: `weakness_profiles` and `diagnostic_sessions` are dedicated
normalized tables, not JSON BLOBs. Those two ADRs establish *where* the diagnosis and profile live and
*how* they are persisted. They do not specify *how the profile is computed* — the diagnostic sentence-set
composition, the `WeaknessProfile` initialization path, the focus-sound priority formula, and the
incremental-update rule are absent from the design-layer documents.

REQ-121 (Must) specifies a short (2–5 minute) read-aloud diagnostic that initializes a weakness profile
and is thereafter updated incrementally from everyday analysis results, with the diagnostic sentence set
covering the catalog's high-FL contrasts, vowel epenthesis, and prosody. REQ-112 (Must) specifies that
focus-sound priority is computed dynamically from three terms (FL rank × occurrence frequency × mastery),
not a fixed list, and is refined incrementally on every analysis. REQ-113 (Should) requires that the
proficiency-adaptive switching logic — the segmental/prosodic focus mix shifting as mastery rises — be
**written down in a design document**; that document does not yet exist, and this ADR supplies the
algorithm it requires.

The research basis is settled. E-9 (Munro & Derwing 2006; Brown 1988) establishes that error priority is
governed by functional load: high-FL errors (/r/-/l/, vowel contrasts) damage comprehensibility while
low-FL errors (/θ/-/s/) do not accumulate, so /θ/ is "detected but labelled low priority, explained by
FL". E-10 (Saito, Trofimovich & Isaacs 2016) establishes that prosody helps at all proficiency levels
while segmental accuracy helps only advanced learners, so the focus mix is proficiency-dependent. B-4
records the commercial CAPT loop pattern: short diagnosis → focus-sound extraction → daily drills →
**the diagnostic profile is updated from daily results, with no separate re-diagnosis test**.

The implementation already carries part of this. `applications/frontend/src/domain/error-catalog/data/japanese-l1-catalog.json`
holds the error catalog with per-item `confusionSet`, `functionalLoad` (`max`/`high`/.../`low`),
`intelligibilityImpact`, `recommendedTraining`, and `evidenceIds` — the confusion sets are implemented but
unreflected in the design documents. `FocusSoundDto` (`applications/frontend/src/lib/api-types.ts`) carries
`pair`, `phenomenon`, `functionalLoad`, `occurrences`, `priority`, `reasonJa`, `catalogId` — focus sounds
computed **per analysis result, with no time series and no persistence**. There is no diagnosis-driven
initialization path and no persisted incremental update; that is the gap this ADR closes.

NativeTrace's OSS-worker direction (ADR-001 rejects delegating analysis to a hosted LLM/ASR API on the
local-CPU constraint REQ-007) frames the open design choice: whether the diagnosis-to-focus derivation may
call an LLM, or must stay rule-based.

# Decision

**Implement diagnosis → weakness profile → focus-sound generation as a deterministic rule-based pipeline,
persist the resulting `WeaknessProfile`, and update it thereafter by an exponentially weighted moving
average. No LLM participates in the derivation.**

1. **Rule-based diagnosis over a fixed read-aloud sentence set.** A short (2–5 minute) diagnostic
   presents a read-aloud sentence set composed to cover the catalog's high-FL contrasts, vowel
   epenthesis, and prosody (REQ-121 acceptance). The recordings are scored through the **existing worker /
   analyzer contract** (ADR-004): `python-analyzer` returns raw GOP / NBest measurements and the
   `phenomenon` evidence, and the Haskell worker returns the structured diff. The diagnosis introduces no
   second, hidden scoring path.

2. **Projection onto the error catalog to initialize the `WeaknessProfile`.** The diagnosis findings are
   projected onto the Japanese-L1 error catalog (`japanese-l1-catalog.json`) by matching the detected
   substitution against each item's `confusionSet`, carrying the item's `functionalLoad`,
   `intelligibilityImpact`, and `recommendedTraining` onto the profile. This is the same catalog-projection
   mechanism the per-result `FocusSoundDto.catalogId` already uses (REQ-105), extended to seed a persistent
   profile. The initialized `WeaknessProfile` is written to `weakness_profiles` (ADR-008).

3. **Three-term focus-sound priority (REQ-112).** Each focus-sound candidate receives a priority score

   ```
   priority = w1·normalizedFunctionalLoadRank + w2·occurrenceFrequency + w3·(1 − mastery)
   ```

   FL rank is the catalog's `functionalLoad` mapped to a normalized rank; occurrence frequency is the
   observed rate of that error across analyses; mastery is the per-contrast proficiency estimate. As
   mastery of a contrast rises, its `(1 − mastery)` term falls, lowering that focus's weight and shifting
   the focus mix — this is the proficiency-adaptive switching REQ-113 requires written down: the segmental
   vs. prosodic composition moves dynamically with the mastery estimate rather than via a hand-tuned level
   gate. Low-FL contrasts (/θ/-/s/) carry a low `normalizedFunctionalLoadRank` and therefore surface as
   "detected, low priority, explained by FL" rather than being suppressed (REQ-112, E-9).

4. **Incremental update by EWMA, no re-diagnosis test (B-4).** After initialization, the profile is updated
   from everyday analysis and training results — the same worker/analyzer scoring path — by an exponentially
   weighted moving average:

   ```
   profile_new = α·observation + (1 − α)·profile_old
   ```

   applied to per-contrast occurrence frequency and mastery, so focus-sound priority recomputes on each
   analysis (REQ-112: refined incrementally). No separate re-diagnosis test is ever scheduled (B-4). The
   smoothing factor `α` and the weights `w1`, `w2`, `w3` are **configuration values**, not constants baked
   into this ADR; their concrete values are fixed in the implementation spec / config so they can be
   calibrated without amending the decision.

5. **Derivation locus is the Training Context use-case layer.** The worker performs only raw measurement and
   scoring (ADR-004); the catalog projection, three-term priority synthesis, and EWMA update run in the
   Training Context use-case layer (ADR-007), reading and writing `weakness_profiles` / `diagnostic_sessions`.
   The worker does not synthesize focus sounds.

Identifier naming follows the project rules (`docs/03-detailed-design/domain.md`): the aggregate
self-identifier field is `identifier`, identifier types are `DiagnosticSessionIdentifier` /
`WeaknessProfileIdentifier`, and references to other aggregates are named after the referenced model
without an `Identifier` suffix — consistent with ADR-007.

**Constraints (must remain true for this decision to hold)**:

- The diagnosis-to-focus derivation is deterministic and rule-based. No LLM call appears on the Training
  Context scoring or focus-derivation path.
- Diagnostic scoring reuses the existing worker / analyzer contract (ADR-004). The Training Context adds no
  second scoring path of its own (the ADR-007 constraint, applied to diagnosis).
- The priority formula and the EWMA update rule are written into `docs/03-detailed-design` (REQ-113
  acceptance: the switching logic is documented in a design document).
- `α`, `w1`, `w2`, `w3` are configuration values fixed in the implementation spec / config, not hard-coded
  literals in domain logic.

# Consequences

Positive:

- The derivation is reproducible: identical inputs yield identical focus sounds, which a hosted-LLM
  derivation could not guarantee and which calibration against self-recorded ground truth (REQ-NF-104)
  depends on.
- Diagnosis reuses the already-built GOP / NBest / `phenomenon` contract (ADR-001, ADR-002, ADR-004) and the
  already-implemented catalog confusion sets, so no new scoring engine or signal-processing path is written.
- Persisting the `WeaknessProfile` and updating it by EWMA satisfies REQ-121's incremental-update mandate
  without ever re-administering the diagnostic (B-4), removing the user friction of repeated diagnosis.
- The single OSS-worker direction (ADR-001) is preserved end-to-end; the focus derivation introduces no
  network dependency on a proprietary model and no research-consistency exposure from generative output.

Negative / trade-offs:

- A rule-based projection is only as good as the catalog and the priority weights; mis-tuned `w1`/`w2`/`w3`
  or an incomplete `confusionSet` produces a mis-ranked focus list. This is bounded by isolating the weights
  to configuration and the projection to the catalog data file, both editable without code change.
- EWMA smoothing trades responsiveness for stability: a genuine, sudden improvement in one contrast is
  reflected only after several observations, governed by `α`. This is the intended behavior (avoiding
  single-recording noise driving the focus mix), but it means the profile lags an abrupt real change.

Alternatives considered:

- **(1) Rule-based derivation with a persisted EWMA-updated profile.** Adopted. It is the only option that
  satisfies REQ-121's incremental-update requirement while keeping the derivation deterministic and aligned
  with the OSS-worker direction, and it reuses the existing scoring contract and catalog.
- **(2) Pure rule-based derivation recomputed per analysis with no persistence.** Rejected: without a
  persisted profile there is nothing to update incrementally, so REQ-121's "initialize once, then update from
  everyday results" loop cannot be expressed — every analysis would re-derive from scratch with no carried
  mastery state.
- **(3) LLM-assisted derivation.** Rejected: it is in tension with the OSS basic direction (ADR-001), would
  require a research-consistency guard over generative output, and lowers reproducibility, which calibration
  against self-recorded ground truth (REQ-NF-104) and the deterministic priority formula both depend on.

# Compliance

- A check asserts that the Training Context scoring and focus-derivation path contains **no LLM call** —
  the derivation is deterministic rule-based code. This is verified in the wiring rubric
  (`rubric/core/wiring.md`) and the layer-import checks, consistent with the no-class / layer-closure
  fitness functions established in ADR-005.
- A review against the wiring rubric confirms that diagnostic scoring goes through the existing worker /
  analyzer contract (ADR-004) and that the Training Context introduces no hidden second scoring path — the
  same boundary ADR-007 enforces for drill evaluation, applied here to diagnosis.
- The priority formula (`priority = w1·normalizedFunctionalLoadRank + w2·occurrenceFrequency +
  w3·(1 − mastery)`) and the EWMA update rule (`profile_new = α·observation + (1 − α)·profile_old`) are
  written into `docs/03-detailed-design`, satisfying the REQ-113 acceptance criterion that the
  proficiency-adaptive switching logic be documented in a design document.
- `α`, `w1`, `w2`, `w3` live in configuration; no diagnostic-tuning literal is embedded in domain logic.

# Notes

- Author: lihs
- Approval date: 2026-06-13
- Approver:
- Last updated: 2026-06-13
- Changes: Initial entry. Related: ADR-007 (Training Context; `DiagnosticSession` / `WeaknessProfile`
  aggregates and `diagnostic_sessions` / `weakness_profiles` tables this ADR derives into), ADR-002
  (espeak IPA / confusion-set basis), ADR-004 (`phenomenon` enum and worker scoring contract reused for
  diagnostic scoring), ADR-008 (time-series storage shape of the persisted profile). Originating
  requirements: REQ-112 (three-term focus priority), REQ-113 (proficiency-adaptive switching, design-doc
  mandate), REQ-121 (diagnostic / weakness profile / incremental update). Research basis: E-9 (functional
  load priority), E-10 (proficiency-dependent segmental vs. prosodic priority), B-4 (diagnosis → drill →
  incremental update, no re-diagnosis test).
