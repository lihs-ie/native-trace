# Detect pronunciation errors with wav2vec2 phoneme-CTC GOP and forced alignment

ADR-001: GOP-based pronunciation error detection

# Status

Proposed

# Context

The pronunciation analysis engine must produce, for Japanese learners of English, the *difference* between the expected and the actually-produced pronunciation, and a concrete correction — not merely a highlight (REQ-014, REQ-015). The design, UI, and data contracts already carry IPA evidence (`expected.ipa` / `detected.ipa`) and per-finding score impact end to end; the only missing piece is an engine that actually analyses the audio. The current `applications/backend/src/NativeTrace/Worker/Scoring.hs` is an explicit placeholder: it never reads the audio bytes, always returns `evidenceIpa = Nothing`, and selects findings from a hash of text/byte-length/duration.

The engine must run locally on CPU (REQ-007) and the judgment is expected to be strict (REQ-NF-036). We need a method that, given a known reference text, scores how well each expected phoneme was actually pronounced and estimates what was produced instead where the score is low.

Alternatives considered:

- **Free phoneme recognition only** (transcribe what was said, then diff against the reference). Rejected: without alignment to the reference it conflates recognition errors with pronunciation errors and gives no per-phoneme goodness signal.
- **Montreal Forced Aligner / Kaldi classic GOP.** This is the canonical GOP lineage and is acoustically solid, but it carries a heavy Kaldi dependency, emits ARPABET that must be remapped, and has a large container footprint — disproportionate for a local MVP.
- **Delegate analysis to a hosted LLM/ASR API.** Rejected: violates the local-CPU constraint (REQ-007) and the OSS-worker direction.

# Decision

Detect pronunciation errors with **Goodness of Pronunciation (GOP)** computed from a **wav2vec2 phoneme-level CTC model** combined with **forced alignment**.

The reference text is converted to an expected phoneme sequence (see ADR-002). The audio is force-aligned to that sequence; each expected phoneme receives a GOP score derived from the model's frame posteriors. Low-GOP regions are passed through free phoneme recognition to estimate what was produced instead (the `detected` evidence). GOP is computed for **every** expected phoneme — it is an inherently whole-utterance mechanism — so the pipeline is not specialised to any single phoneme pair.

This analysis runs in a new **Python analysis service** (`python-analyzer`) added to `docker compose`, called synchronously over HTTP by the Haskell worker. The worker remains responsible for validation, scoring policy, and response construction (see ADR-004); the Python service performs raw measurement only.

Concrete bindings (MVP, calibratable later):

- Acoustic model: **`facebook/wav2vec2-lv-60-espeak-cv-ft`** (multilingual phoneme CTC emitting eSpeak IPA labels, Apache-2.0, ungated on the Hugging Face Hub). Its label space matches the eSpeak g2p of ADR-002. The model is cached via a mounted Hugging Face cache volume and downloaded on first run, not baked into the image.
- Forced alignment: **`torchaudio.functional.forced_align`** over the model's CTC emissions (fallback: the `ctc-segmentation` library if eSpeak label alignment proves unreliable on CPU).
- GOP formula (pre-calibration): **the mean log-posterior of the aligned phoneme over its aligned frames**, `GOP(p) = (1/T) Σ_t log P(p | x_t)`. Thresholds are calibrated later against self-recorded ground truth.
- whisper is not used (see ADR-003); the reference text is known, so no ASR transcription is required.

# Consequences

Positive:

- Per-phoneme GOP gives exactly the signal REQ-015 needs: a localized "how wrong, and what instead" per expected phoneme.
- wav2vec2 phoneme-CTC runs on CPU and avoids the Kaldi toolchain, keeping the local footprint manageable (REQ-007).
- A single whole-utterance mechanism covers all phonemes; no per-error-type detector has to be built.

Negative / trade-offs:

- GOP thresholds require calibration; mis-set thresholds produce false positives that teach wrong corrections. Calibration is handled separately (self-recorded ground truth; representative pairs first, conservative defaults elsewhere).
- Adds a new runtime service and a new language (Python) to the stack, with the wiring and fitness-function obligations that implies (see ADR-005).
- wav2vec2 emissions are noisier than a dedicated acoustic model on short or low-quality recordings; the asynchronous job queue already tolerates multi-second to minute latencies.

# Compliance

- A contract test asserts the Haskell-worker ↔ `python-analyzer` HTTP schema (request: audio + reference text + target accent; response: per-phoneme GOP array, alignment boundaries, detected IPA, inter-word silence, schwa realization, speech rate).
- An integration test drives the whole-phoneme GOP pipeline end to end (audio in → findings with `phenomenon` + `gop` out) and is wired into `backend-ci`.
- `docker compose` must declare the `python-analyzer` service; `wiring_manifest.yml` must register the `haskell-worker → python-analyzer` edge.

# Notes

- Author: lihs
- Approval date:
- Approver:
- Last updated: 2026-06-11
- Changes: Initial draft; then pinned concrete bindings (model `facebook/wav2vec2-lv-60-espeak-cv-ft`, GOP = mean log-posterior over aligned frames, `torchaudio.forced_align`, espeak-ng-synthesized test fixture) during the first agent-dev implementation run. Related: ADR-002 (phoneme representation), ADR-003 (Whisper deferral), ADR-004 (scoring policy), ADR-005 (Python service architecture).
