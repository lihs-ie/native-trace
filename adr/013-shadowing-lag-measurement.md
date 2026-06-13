# Measure shadowing lag with DTW over phoneme boundaries in a dedicated analyzer endpoint

ADR-013: shadowing lag measurement

# Status: Accepted

# Context

REQ-125 specifies a **shadowing** training mode (training sub-4): the learner repeats after a model
voice in real time, and the system measures how far the learner trails the model so that, when the
lag is too large, practice starts from slow playback. The research report records shadowing as a
production-side intervention with moderate-to-strong evidence for comprehensibility, fluency, and
prosody (Whitworth & Rose 2025 systematic review, 44 studies; Hamada 2016/2018 for Japanese EFL),
and explicitly notes that **shadowing has no effect for learners whose lag is large — they should
start from slow playback** (research §3.3-3, line 141). Segmental effects are uncertain, so the
evaluation focus is rhythm / pause / speech-rate, not fine segmental scoring.

The lag-measurement capability does not exist today. `python-analyzer` (ADR-005, onion architecture)
holds raw acoustic measurement: it already runs a wav2vec2 forced aligner that produces phoneme-level
time boundaries, parselmouth prosody extraction, and an energy-based VAD. The Haskell worker reaches
the analyzer over the `ANALYZER_URL` HTTP boundary (ADR-004 `AnalyzerClient.hs` pattern), and the
training screen spec (`docs/specs/training-screen.md` M-TR-7) already names the UI surface
(`.lag` / `.lag-needle` / `.callout` / `.speed`) and the persistence shape (a `training_sessions`
row with `kind='shadowing'` and `session_accuracy IS NULL`, per ADR-007 Training Context and ADR-008
time-series data model). What is undecided is **how lag is computed, what threshold triggers slow
playback, and through which API the two audios (model + learner) are submitted** — these are the
decisions this ADR records.

The shadowing input is structurally asymmetric to the existing analysis input: lag measurement needs
**two** audios (the model reference and the learner recording) aligned against each other, whereas
`POST /v1/analyze` takes a single learner audio plus a reference *text*.

Alternatives considered for the lag algorithm:

- **(1) DTW (Dynamic Time Warping) over phoneme boundaries.** Take the wav2vec2 phoneme boundaries
  of both the model and the learner, align the two boundary sequences with DTW, and derive a
  per-segment lag series plus a mean lag (milliseconds). It reuses the aligner already present in the
  analyzer, captures following-drift across the whole utterance (not just the start), and yields a
  per-segment series that the `.lag-needle` UI can express. Insertion/deletion mismatches (a phoneme
  spoken by one party and not the other) can distort a naive alignment; this is mitigated with DTW
  local-path constraints and an outlier-robust median over the per-segment differences.
- **(2) Energy-envelope cross-correlation.** Cross-correlate the RMS energy envelopes of the two
  audios and take `argmax` as a single global shift. Simplest to implement, but it collapses the
  whole utterance to one shift and is pulled by leading/trailing silence; it cannot express the
  frame-level following drift the feature is meant to surface.
- **(3) VAD onset difference.** Use the existing energy VAD to detect each speaker's speech-onset
  time and take the difference. Lightest, but it measures only the *start* offset and is blind to
  mid-utterance drift and pause-position differences.

Alternatives considered for the API surface:

- **(a) A new `POST /v1/shadowing-lag` endpoint** taking `reference_audio` + `learner_audio`.
- **(b) Extending `POST /v1/analyze`** with an optional `shadow_reference_audio` field.

# Decision

**Measure shadowing lag (REQ-125) with DTW over wav2vec2 phoneme boundaries, exposed through a new
`POST /v1/shadowing-lag` analyzer endpoint, with a configurable slow-playback threshold defaulting to
500 ms and client-side slow playback.**

1. **DTW over phoneme boundaries.** The analyzer aligns the model and learner wav2vec2 phoneme
   boundary sequences with DTW and computes a **per-segment lag series** and a **mean lag in
   milliseconds**. The displayed and threshold-tested value is the frame-level following lag, not a
   single onset offset. Alignment is made robust to insertion/deletion with DTW local-path
   constraints and an outlier-robust (median-based) aggregation. Energy cross-correlation and VAD
   onset difference are **not adopted** — they cannot express following drift at the precision the
   feature requires.

2. **New `POST /v1/shadowing-lag` endpoint.** The endpoint takes `reference_audio` + `learner_audio`
   and returns `{ lagMilliseconds, recommendSlowPlayback, perSegmentLag, ... }`. `POST /v1/analyze`
   is **not** extended: its single-audio-plus-reference-text signature is asymmetric to the
   two-audio shadowing input, and separating the endpoints keeps the existing analysis contract
   backward compatible (consistent with ADR-005's boundary discipline and training-screen M-TR-4's
   "reuse existing contract" constraint, which the asymmetry would otherwise violate). The worker
   reaches the new endpoint over the same `ANALYZER_URL` HTTP boundary as the existing analyze call
   (ADR-004 pattern), re-decoding the JSON into a worker DTO rather than importing analyzer types.

3. **Configurable threshold, default 500 ms.** When `lagMilliseconds` exceeds the threshold, the
   response sets `recommendSlowPlayback` and the UI surfaces the slow-playback call-to-action
   (`.callout`) starting at 0.7x (`.speed`). The threshold is **not** embedded as a domain literal:
   it is externalized as a configuration value (`SHADOWING_LAG_THRESHOLD_MS`) and carried through to
   the frontend via the worker response so a single source governs both the server-side decision and
   the client display. The default of 500 ms is an initial value chosen for the MVP (roughly two to
   three syllable durations of ≈ 200–300 ms); the literature gives no specific figure, so the value
   is tunable from observed data without code change.

4. **Client-side slow playback.** The 0.7x slow playback is realized in the browser via
   `AudioContext.playbackRate`, not by server-side re-synthesis. This avoids an extra synthesis API
   call and keeps latency low; the model audio is already the Kokoro TTS / reference clip the
   shadowing player holds.

5. **Shadowing sessions persist in the Training Context.** A completed shadowing session is recorded
   as a `training_sessions` row with `kind='shadowing'` and `session_accuracy IS NULL` (ADR-007
   Training Context, ADR-008 time-series model), since shadowing is evaluated on rhythm/pause/rate
   rather than a segmental accuracy score. The lag value belongs to the measurement response, not to
   the session accuracy.

**Constraints (must remain true for this decision to hold)**:

- The lag value returned by `POST /v1/shadowing-lag` is derived from the two real audios; a fixed or
  synthetic value voids this decision. A contract test asserts that a different learner recording
  yields a different lag.
- `POST /v1/analyze` keeps its existing single-audio signature; shadowing lag must not be folded into
  it. The analysis contract stays backward compatible.
- The slow-playback threshold stays externalized as configuration; it must not be hard-coded as a
  domain literal in any of the three layers.
- The Training Context boundary holds: the shadowing session references the Pronunciation Practice
  Context only by identifier and imports no PPC internal types (ADR-007 dependency-direction check
  stays green).

# Consequences

Positive:

- DTW over the already-present phoneme aligner reuses existing analyzer assets and yields a
  per-segment lag series rich enough for the `.lag-needle` UI, capturing following drift across the
  utterance rather than a single onset offset.
- A separate endpoint keeps the existing analyze and scoring contracts untouched, so the heavier
  two-audio shadowing path cannot regress the single-audio analysis flow.
- Externalizing the threshold makes the unproven 500 ms figure tunable from real usage without a code
  change, and carrying it through the worker response keeps the server decision and the client
  display consistent.
- Client-side `playbackRate` avoids a synthesis round-trip, keeping the slow-playback start
  responsive.

Negative / trade-offs:

- DTW over phoneme boundaries is the heaviest of the three candidates in compute and implementation
  complexity, and insertion/deletion mismatches require explicit robustness handling; a naive
  alignment would distort the lag.
- A new analyzer endpoint adds a routing/public-export wiring point in three languages (analyzer
  router + `include_router`, worker route + DTO, frontend schema/mapper) and requires a Docker
  rebuild, with the Haskell worker route carrying cabal-test cost.
- The 500 ms default is not evidence-based; if observed data shows it mis-triggers, the threshold is
  re-tuned (the externalized config makes this cheap, but the initial value is a judgement, not a
  finding).

Alternatives considered:

- **(2) Energy-envelope cross-correlation** is rejected: a single global shift cannot express the
  frame-level following drift the feature surfaces, and it is pulled by leading/trailing silence.
- **(3) VAD onset difference** is rejected: it measures only the start offset and is blind to
  mid-utterance drift and pause-position differences.
- **(b) Extending `POST /v1/analyze`** is rejected: the two-audio shadowing input is asymmetric to
  the single-audio-plus-reference-text analyze signature, and folding it in would expand the existing
  analysis contract that other flows depend on.

# Compliance

- The new analyzer endpoint is wired through both the `interface/http_handler.py` router and the
  `app.py` `include_router`, and the worker route is added to the `WorkerApi` type and the
  `Application.hs` handler with the cabal exposed-modules updated, per the project's wiring
  contract; `wiring_manifest.yml` registers the worker → analyzer `/v1/shadowing-lag` HTTP edge
  alongside the existing analyze edge.
- A contract/runtime test asserts the lag is derived from the real audios (a different learner
  recording produces a different `lagMilliseconds`), preventing a fixed or stubbed value from passing
  as live measurement.
- A check asserts the slow-playback threshold is read from configuration (`SHADOWING_LAG_THRESHOLD_MS`)
  and not hard-coded as a domain literal in the analyzer, worker, or frontend, consistent with the
  no-domain-literal discipline.
- The code-review rubric verifies that `POST /v1/analyze` retains its single-audio signature (no
  shadowing fields), and that a completed shadowing session persists a `training_sessions` row with
  `kind='shadowing'` and `session_accuracy IS NULL` (ADR-007 / ADR-008), referencing PPC by
  identifier only.
- Introducing the new endpoint ships its fitness-function entries (wiring manifest, contract test) in
  the same PR, per the same-PR rule for new wiring (ADR-005).

# Notes

- Author: lihs
- Approval date: 2026-06-14
- Approver:
- Last updated: 2026-06-14
- Changes: Initial entry. Related: ADR-007 (Training Context bounded context; the shadowing session
  and its usage record belong to the training loop and reference PPC by identifier only), ADR-008
  (training/progress time-series data model; the `training_sessions` row with `kind='shadowing'`),
  ADR-005 (Python analyzer onion architecture and service-boundary discipline; same-PR fitness-function
  rule), ADR-004 (Haskell worker → analyzer HTTP client pattern reused for the new endpoint), ADR-009
  (Kokoro native TTS as the model voice the shadowing player reproduces). Originating requirement:
  REQ-125 (shadowing + lag measurement). Research basis: §3.3-3 (shadowing evidence; lag-too-large
  learners start from slow playback; Whitworth & Rose 2025; Hamada 2016/2018).
