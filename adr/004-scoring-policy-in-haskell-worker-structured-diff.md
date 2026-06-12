# Concentrate scoring policy in the Haskell worker and return a structured diff

ADR-004: Scoring policy in the Haskell worker, structured-diff contract

# Status

Proposed

# Context

The system stores six score dimensions (`overall`, `accuracy`, `nativeLikeness`, `pronunciation`, `connectedSpeech`, `prosody`), each a `NOT NULL` integer 0–100, wired from the domain through the database (`assessment_results`) to the UI (`ScoreRows`). `connectedSpeech` is therefore a mandatory, first-class score dimension — it cannot be left unscored.

Two policy questions follow:

1. **Where does scoring policy live** — the GOP-threshold-to-severity-to-`scoreImpact`-to-aggregate-`ScoreSet` mapping, including the strict-judgment calibration (REQ-NF-036)? Only a component with the audio has the acoustic signals; the frontend has no audio.
2. **How are connected-speech phenomena (weak forms, linking, flap, assimilation, reduction) treated** — as deductible per-location findings, or as presentation only?

A further constraint: improvement messages are generated in the frontend with a switchable `RuleBased`/`LLM` strategy (the worker must not embed an OpenAI client). The domain `AssessmentFinding.messageJa` is required, but the worker cannot produce it.

Alternatives considered:

- **Worker emits raw measurements only; the frontend domain computes scores.** Puts all calibration in TypeScript unit tests, but the frontend cannot recompute the aggregate `connectedSpeech` score from acoustic signals it never receives, and it splits the scoring locus.
- **Acoustically detect achievement of every connected-speech phenomenon and deduct per location.** Matches strict judgment most literally but is the most error-prone and the heaviest to build; mis-detection teaches false corrections.

# Decision

**Concentrate scoring policy in the Haskell worker.** The worker computes the aggregate `ScoreSet` and per-finding `severity` / `scoreImpact`; the `python-analyzer` returns raw measurements only. GOP-threshold calibration lives on the worker side.

The worker returns a **structured diff**, not finished messages: the existing wire `FindingDto` extended with `phenomenon` (a closed enum: `substitution`, `omission`, `insertion`, `connectedSpeech`, `weakForm`, `linking`, `flap`, `assimilation`, `reduction`, `epenthesis`, `lexicalStress` — 11 values total; `connectedSpeech` is retained for backward-compat legacy findings, while the 5 connected-speech sub-phenomena are the preferred fine-grained values) and `gop: number | null`, with `messageJa = null`. The frontend `ImprovementMessageGenerator` fills `messageJa` keyed on `phenomenon` + `expected` + `detected` before the domain `AssessmentFinding` is constructed; the domain invariant (`messageJa` required) is preserved because generation always runs first. The worker returns `messageJa = null` on the wire; the frontend 3-layer generator (M-104) produces the final `messageJa` from `catalogId` + `phenomenon` + phoneme contrast + word position.

**Connected-speech phenomena are presentation only.** The aggregate `connectedSpeech` score is derived from cheap forced-alignment by-products (inter-word silence at linking boundaries, schwa realization GOP at function words, speech rate). Body-range-pinned deductions are limited to phoneme-GOP errors (`substitution` / `omission` / `insertion`); connected-speech phenomena are shown as opportunities (`category = connectedSpeech`, `severity = suggestion`, `scoreImpact = 0`) and contribute only softly to the aggregate.

# Consequences

Positive:

- Aggregate and per-finding scores are coherent by construction because both are computed where the acoustic data lives.
- The wire contract is a minimal two-field extension of an existing type; `messageJa` is already nullable on the wire, so no domain change is needed.
- Presentation-only connected speech avoids teaching false corrections on the hardest-to-detect phenomena while still scoring the mandatory dimension.

Negative / trade-offs:

- Strict-judgment threshold calibration lives in Haskell/Python and is harder to exercise without audio fixtures than equivalent TypeScript unit tests would be.
- The proxy-derived `connectedSpeech` score is coarser than true per-phenomenon achievement scoring; this is an explicit accuracy-for-safety trade until calibration data accrues.

# Compliance

- A contract test asserts the worker response carries `messageJa = null` (the worker never authors messages) and includes `phenomenon` + `gop`.
- A check asserts the scoring policy (threshold → severity → scoreImpact → ScoreSet) exists only in the Haskell worker and that the frontend only fills `messageJa` / assigns identifiers.
- A test asserts connected-speech findings carry `severity = suggestion` and `scoreImpact = 0` (presentation only).

# Notes

- Author: lihs
- Approval date:
- Approver:
- Last updated: 2026-06-11
- Changes: Initial draft. Related: ADR-001 (GOP detection, source of `gop`), ADR-002 (IPA evidence). Supersedes the earlier intent for the worker to author `messageJa`.
