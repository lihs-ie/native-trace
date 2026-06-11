# Unify phoneme representation on espeak-ng IPA and place g2p in the Python analysis service

ADR-002: espeak-ng IPA unification and g2p placement

# Status

Proposed

# Context

GOP detection (ADR-001) force-aligns the audio against an expected phoneme sequence and compares it to the detected phonemes. For that comparison to be meaningful, the *expected* phonemes (from grapheme-to-phoneme conversion of the reference text) and the *detected* phonemes (from the wav2vec2 model) must live in the same phoneme inventory. The UI displays IPA-based General American notation, and the internal analysis is allowed to handle ARPABET/IPA conversion (REQ-016).

The detected side comes from a wav2vec2 model trained on espeak IPA labels, so detected phonemes are espeak IPA. The open question is how the expected side is produced and normalized to match.

Alternatives considered:

- **CMUdict ARPABET as the canonical expected representation, converted to IPA.** ARPABET carries lexical stress (0/1/2), useful later for prosody, but its inventory does not line up cleanly with espeak IPA (e.g. `ɚ/ɝ`, the flap `ɾ`), forcing a maintained reconciliation table and a separate g2p fallback for out-of-vocabulary words.
- **Two normalization tables mapping CMUdict (expected) and espeak (detected) onto a separate General American canonical inventory.** Most flexible, but two normalization tables to maintain — too heavy for the MVP.

# Decision

Unify both sides on **espeak-ng IPA**. The reference text is converted to expected IPA with **espeak-ng phonemization (`en-us` voice)**, and the detected phonemes come from the espeak-IPA-trained wav2vec2 model. Because both sides share the espeak inventory, the normalization table is minimized to near-identity.

**Grapheme-to-phoneme (g2p) runs in the Python analysis service** (via `phonemizer`/espeak-ng), not in the Haskell worker. This supersedes the earlier intent to place g2p in the Haskell worker: the Haskell worker holds no g2p or acoustic logic and concentrates on validation, scoring policy, and response construction (ADR-004).

General American is selected through the espeak-ng `en-us` voice.

# Consequences

Positive:

- Expected and detected phonemes occupy the same space by construction, so GOP comparison needs no lossy cross-inventory mapping.
- A single phonemizer (espeak-ng) drives both g2p and the model's label space, removing a class of inventory-mismatch bugs.
- Out-of-vocabulary words are handled by espeak-ng's own rules, so no dictionary-miss fallback path is needed.

Negative / trade-offs:

- espeak-ng IPA is coarser on lexical stress than CMUdict; stress/prosody work (a later slice) will need an additional stress source. Acceptable: the MVP targets phoneme GOP, not stress.
- Ties the expected representation to espeak-ng's `en-us` rule quality; egregious g2p errors must be caught during calibration.

# Compliance

- An ast-grep rule asserts that g2p (espeak-ng/phonemizer usage) exists only inside the Python analysis service and is absent from the Haskell worker and the frontend.
- A normalization test asserts that expected and detected phonemes are drawn from the same espeak inventory (round-trip / inventory-membership assertions on a fixture set).

# Notes

- Author: lihs
- Approval date:
- Approver:
- Last updated: 2026-06-11
- Changes: Initial draft. Supersedes the earlier "g2p in the Haskell worker" intent. Related: ADR-001 (GOP detection), ADR-004 (scoring policy), ADR-005 (Python service architecture).
