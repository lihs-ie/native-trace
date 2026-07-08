# Source HVPT identification stimuli from a hybrid of curated natural speech and the existing Kokoro exemplar TTS

ADR-009: HVPT stimulus hybrid (curated natural speech + Kokoro TTS)

# Status: Accepted

# Context

ADR-007 introduces the Training Context, whose `HvptTrial` aggregate models one forced-choice
identification trial holding a stimulus reference, the learner's response, and correctness. ADR-008
persists those trials in the `hvpt_trials` table, where each row references its `training_sessions`
row and the stimulus, the contrast presented, the response, and correctness. Neither ADR decides where
the stimulus audio itself comes from. That is this ADR's question.

REQ-122 (HVPT 知覚訓練) specifies the stimulus requirements as acceptance criteria: the task is
**identification** (multi-talker forced-choice), not discrimination (g 0.95 vs 0.57); the stimuli must
span **five or more talkers, mixed sex, and multiple phonological contexts** (word-initial / word-medial
/ cluster), because a single talker does not generalize; each trial gives correct/incorrect feedback plus
playback of the correct sound (production transfer g 0.94 vs 0.45); response labels are spelling /
keyword / IPA (no images); sessions are bounded to 20–30 minutes with cumulative training time recorded.
REQ-122 states that the stimulus source should **prefer natural speech such as VCTK / LibriTTS
(CC BY 4.0)**.

The research report records the corpus options (T-7): **VCTK** (110 talkers, CC BY 4.0) and **LibriTTS**
(2,456 talkers, CC BY 4.0) can compose multi-talker minimal-pair stimuli; supplementing shortfalls with
TTS synthesis is held back because whether synthetic speech reproduces the HVPT effect is unverified, so
natural speech is preferred. The same report (3.4 / E-8) records that the Japanese-L1 confusion set is
derivable in advance from the Japanese phonological system and connects to the GOP error classifier and
NBest diagnosis — so the contrasts the stimuli must cover (`/r/`–`/l/`, `/θ/`–`/s/`, and the rest of the
confusion set) are known up front, not discovered at runtime.

REQ-NF-101 (OSS license constraint) sets the redistribution rule: production inclusion is CC BY 4.0 /
Apache-2.0 / MIT / BSD by default; **L2-ARCTIC (CC BY-NC) must not be redistributed in production**.
ADR-006 is the precedent for judging a license boundary in an ADR — there for GPL-3.0 process isolation,
here for which corpora may be bundled and which may not.

The exemplar TTS path already exists and is wired. ADR-001 (and its M-124 follow-on) added a Kokoro-82M
(Apache-2.0) exemplar synthesizer at
`applications/python-analyzer/src/python_analyzer/infrastructure/kokoro_tts.py`, exposed at the `/v1/tts`
endpoint, with a General American voice and a 0.5–1.0 speed parameter. It already produces General
American reference audio on CPU.

NativeTrace is a local MVP: single learner, single machine, no third-party distribution.

# Decision

**Source HVPT identification stimuli with a hybrid strategy.** The core high-functional-load contrasts —
the Japanese-L1 confusion set's central oppositions (`/r/`–`/l/`, `/æ/`–`/ʌ/`, `/iː/`–`/ɪ/`, `/v/`–`/b/`,
and the rest) — are drawn from a **curated subset of LibriTTS (CC BY 4.0)** carved out and bundled with the
analyzer. The **long-tail contrasts** are supplemented by synthesizing from the **existing Kokoro-82M
exemplar TTS** (ADR-001 / M-124, already implemented) using its multiple American voice embeddings
(11 female `af_*` + 9 male `am_*`) for talker variation.

**Amendment (2026-06-13, feasibility investigation):** The carve-out corpus is **LibriTTS, not VCTK**.
VCTK is structurally unable to supply multi-talker minimal pairs: its all-speaker common text (the Rainbow
Passage + "Please Call Stella", ~15–25 sentences) does not contain the needed minimal-pair words (only
`light` and `thick` appear, without their pair partners `right` / `sick`), and its per-speaker newspaper
sentences are unique, so a given word is read by at most one talker. LibriTTS (2,456 talkers reading
audiobooks) does carry common monosyllabic words (right/light, beat/bit, vote/boat) across hundreds of
talkers. Word boundaries are obtained from **`cdminix/libritts-aligned` (HuggingFace, CC BY 4.0,
pre-computed phone-level alignment for all LibriTTS splits)**, so no local Montreal Forced Aligner run is
required — the carve-out is "grep the transcripts for the target words → look up the pre-computed word
boundary → cut → quality-filter by RMS". VCTK remains a permitted auxiliary source only where it can
supply a target word for ≥5 talkers (rare in practice). Matched-sentence minimal pairs are not achievable
from LibriTTS (contexts differ per talker), which is consistent with HVPT's variability goal; the
word-initial / word-medial / cluster context coverage required by REQ-122 is satisfied by classifying
extracted tokens by their phonological context.

Natural speech is the primary source by design: whether the HVPT effect is reproduced by synthetic
speech is unverified (research T-7), so the curated natural-speech subset carries the contrasts where the
training payoff is highest and the talker-variability requirement (five or more talkers, mixed sex,
multiple contexts) is met by real talkers. The Kokoro supplement fills contrasts that the curated subset
does not cover, where the alternative is no stimulus at all.

Extraction is scoped, not wholesale. Only the audio for the targeted contrasts is cut from VCTK /
LibriTTS, not the whole corpora; carving out only the targeted contrasts keeps the bundled assets at a
hundreds-of-megabytes scale rather than the multi-gigabyte full corpora, which keeps the local MVP
tractable.

**Placement follows the Training Context vocabulary contract and the ADR-005 layer discipline.** Per the
bounded-context vocabulary shared verbatim with the sibling ADRs:

- New BC **Training Context**.
- The `HvptTrial` aggregate holds its stimulus **by identifier / reference**, not by embedding the audio;
  trials persist in the `hvpt_trials` table (ADR-008).

The stimulus assets live under the `python-analyzer` service (ADR-005 onion): the curated subset is
bundled as analyzer assets and served from there, and the carve-out / preprocessing pipeline (cutting the
targeted contrasts out of VCTK / LibriTTS, normalizing, labelling by contrast and context) runs **inside
`python-analyzer`**, not in the frontend or the Haskell worker. The Kokoro supplement reuses the existing
`kokoro_tts.py` synthesizer; no second TTS path is introduced.

**Constraints (must remain true for this decision to hold)**:

- Stimulus carve-out and preprocessing are confined to `applications/python-analyzer/`. Any stimulus
  extraction pipeline outside that directory voids the layer-closure judgment (ADR-005).
- Only CC BY 4.0 (and other production-permissive: Apache-2.0 / MIT / BSD) audio is bundled as stimulus
  assets. **L2-ARCTIC (CC BY-NC) — and any CC BY-NC source — must not be mixed into the bundled
  stimuli**, because REQ-NF-101 forbids its production redistribution.
- Each bundled stimulus asset carries its source corpus's license attribution (CC BY 4.0 requires
  attribution on redistribution). The attribution manifest ships with the assets.
- If the distribution model changes — bundling the analyzer for third parties, SaaS deployment serving
  end users, or any conveyance of the asset bundle outside the development team — the corpus license terms
  (CC BY 4.0 attribution, and the exclusion of any non-commercial source) must be re-evaluated before
  that change ships, as ADR-006 requires for its own boundary.

# Consequences

Positive:

- The talker-variability requirement of REQ-122 (five or more talkers, mixed sex, multiple contexts) is
  met by real talkers on the core contrasts, where natural speech matters most and where the research
  evidence for the HVPT effect is established.
- Coverage is complete: the long-tail contrasts that the curated subset does not reach are still
  trainable via the Kokoro supplement, so no contrast in the confusion set is left without a stimulus.
- The supplement reuses the already-wired `kokoro_tts.py` / `/v1/tts` path (ADR-001 / M-124); no new
  synthesizer, model download, or service is added for it.
- The contrasts to cover are the precomputed Japanese-L1 confusion set (research 3.4 / E-8), so the
  carve-out targets a known, finite list rather than an open-ended extraction.

Negative / trade-offs:

- The long-tail stimuli are synthetic, and whether synthetic speech reproduces the HVPT effect is
  unverified (research T-7). The supplement is therefore a coverage fallback, not an equal-quality
  substitute; if it proves ineffective for a contrast, that contrast must move to natural speech.
- A carve-out / preprocessing pipeline and a bundled asset set are added to `python-analyzer` — more
  surface than synthesizing every stimulus on demand, and the bundled assets enlarge the repository's
  distributed footprint by hundreds of megabytes.
- Two stimulus provenances (curated natural / Kokoro-synthesized) must be tracked per stimulus so that
  effect measurement and license attribution stay correct per source.

Alternatives considered:

- **(1) Hybrid: curated natural-speech core + Kokoro supplement. [Adopted]** Puts real talkers on the
  high-functional-load contrasts where the HVPT evidence holds and the talker-variability requirement
  bites, and fills the long tail from the existing TTS. Scoped extraction keeps the bundle tractable for a
  local MVP. Cost is a carve-out pipeline and a hundreds-of-megabytes asset bundle, proportionate to a
  Must requirement.
- **(2) Kokoro TTS variation only. [Rejected]** Synthesizing every stimulus from the existing TTS would
  add no corpus and no carve-out pipeline, but whether synthetic speech reproduces the HVPT effect is
  unverified (T-7), and a single-talker TTS cannot supply the five-or-more-talker, mixed-sex variability
  REQ-122 requires for generalization. It fails the talker-diversity acceptance criterion.
- **(3) Full VCTK / LibriTTS only. [Rejected]** Bundling the corpora and extracting every contrast from
  natural speech would be the purest fit to "prefer natural speech", but the multi-gigabyte bundle and a
  full carve-out pipeline are disproportionate for a local MVP. Scoped extraction plus a TTS fallback
  reaches full contrast coverage at a fraction of the footprint.

# Compliance

- The bundled stimulus assets ship with an **asset manifest declaring each source corpus's license**
  (CC BY 4.0 attribution for VCTK / LibriTTS). The manifest is the attribution artifact CC BY 4.0
  requires on redistribution.
- A **fitness check (path / manifest, grep or ast-grep) asserts that no CC BY-NC source — L2-ARCTIC in
  particular — is present in the bundled stimuli**, enforcing the REQ-NF-101 non-commercial-exclusion
  rule at the gate rather than by review. It runs in the edit-time fitness hook and in CI, consistent
  with the license-boundary enforcement style of ADR-006.
- The stimulus carve-out and preprocessing are confined to `applications/python-analyzer/` (ADR-005 layer
  closure); the Kokoro supplement reuses `kokoro_tts.py` and adds no second synthesizer.
- Any change to the distribution model (third-party bundling, SaaS launch, conveyance of the asset bundle)
  must include a re-evaluation of the corpus license terms before that change ships.

# Notes

- Author: lihs
- Approval date: 2026-06-13
- Approver:
- Last updated: 2026-06-18 (amended)
- Amended 2026-06-18 (pronunciation-remediation batch): ADR-018 (acoustic-phonetic diagnosis) adds an analysis-request `AnalysisMetadata.speakerSex` field that reuses this ADR's HVPT-stimulus `StimulusMetadata.speakerSex` value set (`Literal['F','M','unknown']`) to avoid a second convention in the codebase. This ADR's stimulus fields and their meaning are unchanged.
- Changes: Initial entry. **Amended 2026-06-13** after a feasibility investigation: carve-out corpus
  narrowed from "VCTK / LibriTTS" to **LibriTTS** (VCTK's common text lacks the minimal-pair words and its
  per-speaker text gives ≤1 talker per word); word boundaries sourced from `cdminix/libritts-aligned`
  (CC BY 4.0, pre-computed, no local MFA); Kokoro supplement uses its 20 American voice embeddings for
  talker variation. Related: ADR-007 (Training Context bounded context; `HvptTrial` holds its
  stimulus by reference), ADR-001 (Kokoro-82M exemplar TTS and GOP pipeline reused for the synthetic
  supplement), ADR-006 (license-boundary judgment precedent). Originating requirements: REQ-122 (HVPT
  perceptual training), REQ-NF-101 (OSS license constraint; L2-ARCTIC non-redistribution). Research basis:
  T-7 (VCTK / LibriTTS corpora; synthetic-supplement effect unverified), 3.4 / E-8 (precomputed
  Japanese-L1 confusion set).
