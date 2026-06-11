# Defer Whisper ASR out of the MVP until the accuracy slice

ADR-003: Whisper deferral

# Status

Proposed

# Context

An earlier engine sketch listed "whisper + wav2vec2 + GOP" together. Whisper is an automatic speech recognition (ASR) model that transcribes what was said. The MVP target is the `pronunciation` score dimension: per-phoneme GOP against a *known* reference text (ADR-001).

In a known-reference pronunciation assessment, forced alignment runs directly from the reference text to the audio; no transcription is required to compute GOP. Whisper's value is in the `accuracy` score dimension — detecting skips, insertions, and substitutions against the reference (whether the learner read the right words at all) — which is a separate score column and a separate vertical slice.

Alternatives considered:

- **Keep whisper + wav2vec2 from the start (the original sketch).** This would land accuracy and pronunciation together, but it adds a heavy ASR dependency the MVP does not need, widens the wiring surface, and broadens what must be verified before the first end-to-end slice is proven.

# Decision

**Defer Whisper out of the MVP.** The MVP vertical slice computes the `pronunciation` score from wav2vec2 phoneme-CTC GOP + forced alignment only (ADR-001). Whisper is introduced later, when the `accuracy` slice (skip/insertion/substitution against the reference text) is built.

# Consequences

Positive:

- Removes a large model dependency from the first slice, shrinking the wiring and the surface to verify while the heavy detection pipeline is being proven end to end.
- Keeps the MVP focused on a single score dimension (pronunciation) with a single acoustic model.

Negative / trade-offs:

- The `accuracy` score dimension is not yet driven by real analysis in the MVP; it is produced by a conservative placeholder until the accuracy slice lands. This must be stated in the MVP scope, not hidden.
- Reintroducing Whisper later adds a second model and its own wiring; that cost is moved, not removed.

# Compliance

- An import/dependency check asserts that no Whisper dependency is present in MVP code paths until the accuracy slice ADR supersedes this constraint.
- The MVP scope document states explicitly that the `accuracy` dimension is placeholder-driven until the accuracy slice.

# Notes

- Author: lihs
- Approval date:
- Approver:
- Last updated: 2026-06-11
- Changes: Initial draft. Related: ADR-001 (GOP detection). To be revisited by a future "accuracy slice" ADR that introduces Whisper.
