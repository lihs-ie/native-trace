"""Stimulus domain types for the HVPT carve-out pipeline.

These are pure value types used within the python-analyzer service only.
ADR-005: domain layer, no I/O, no side effects.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Literal


class PhonologicalContext(StrEnum):
    """Phonological context of the target word in the utterance.

    REQ-122: multiple phonological contexts (word-initial / word-medial / cluster)
    required for generalization.
    """

    WORD_INITIAL = "word-initial"
    WORD_MEDIAL = "word-medial"
    CLUSTER = "cluster"


class StimulusSource(StrEnum):
    """Provenance of the stimulus audio.

    ADR-009: curated natural speech (LibriTTS) or Kokoro-synthesized supplement.
    """

    LIBRITTS = "libritts"
    KOKORO = "kokoro"


# Phoneme contrasts: core (LibriTTS) and long-tail (Kokoro supplement).
# Source: japanese-l1-catalog.json confusionSet.
CoreContrastIdentifier = Literal[
    "r-l",
    "ae-ah",
    "iy-ih",
    "v-b",
]

LongTailContrastIdentifier = Literal[
    "th-s",
    "dh-z",
    "aa-ae",
    "s-sh",
]

ContrastIdentifier = CoreContrastIdentifier | LongTailContrastIdentifier

# Minimal-pair words per contrast.
# Each entry: (word_a, word_b) — word_a carries the first phoneme of the contrast.
MINIMAL_PAIRS: dict[ContrastIdentifier, list[tuple[str, str]]] = {
    # core: LibriTTS carve-out targets
    "r-l": [
        ("right", "light"),
        ("road", "load"),
        ("rake", "lake"),
        ("grass", "glass"),
        ("fry", "fly"),
    ],
    "ae-ah": [
        ("bat", "but"),
        ("cat", "cut"),
        ("ran", "run"),
    ],
    "iy-ih": [
        ("beat", "bit"),
        ("sheep", "ship"),
        ("leave", "live"),
    ],
    "v-b": [
        ("vote", "boat"),
        ("van", "ban"),
        ("very", "berry"),
    ],
    # long-tail: Kokoro supplement
    "th-s": [
        ("think", "sink"),
        ("thick", "sick"),
    ],
    "dh-z": [
        ("than", "zan"),
        ("the", "zee"),
    ],
    "aa-ae": [
        ("hot", "hat"),
        ("cot", "cat"),
    ],
    "s-sh": [
        ("see", "she"),
        ("sip", "ship"),
    ],
}

# Contrasts that must be carved from LibriTTS (natural speech core).
CORE_CONTRASTS: frozenset[ContrastIdentifier] = frozenset(["r-l", "ae-ah", "iy-ih", "v-b"])

# Contrasts supplemented by Kokoro (long-tail).
LONG_TAIL_CONTRASTS: frozenset[ContrastIdentifier] = frozenset(["th-s", "dh-z", "aa-ae", "s-sh"])

# Cluster-initial words: first consonant cluster is the diagnostic context.
CLUSTER_INITIAL_WORDS: frozenset[str] = frozenset(
    ["grass", "glass", "fry", "fly", "think", "thick"]
)


@dataclass(frozen=True)
class StimulusIdentifier:
    """Unique identifier for a carved stimulus.

    Composed of contrast + word + speaker + context to guarantee uniqueness.
    """

    contrast: ContrastIdentifier
    word: str
    speaker_identifier: str
    context: PhonologicalContext
    source: StimulusSource

    def as_string(self) -> str:
        """Return a filesystem-safe identifier string."""
        return (
            f"{self.contrast}__{self.word}__{self.speaker_identifier}"
            f"__{self.context.value}__{self.source.value}"
        )


@dataclass
class StimulusAsset:
    """A single carved-out stimulus audio file with attribution metadata.

    ADR-009: each asset carries its source corpus license attribution.
    CC BY 4.0 requires attribution on redistribution.
    """

    identifier: StimulusIdentifier
    wav_bytes: bytes
    # Attribution fields (CC BY 4.0 requirement).
    source_corpus: str  # e.g. "LibriTTS train-clean-100" or "Kokoro-82M TTS"
    license_identifier: str  # e.g. "CC-BY-4.0" or "Apache-2.0"
    speaker_sex: Literal["F", "M", "unknown"]
    # Original utterance context (LibriTTS only).
    original_utterance_identifier: str | None = None
    word_start_seconds: float | None = None
    word_end_seconds: float | None = None

    def to_attribution_record(self) -> dict[str, object]:
        """Return a serialisable attribution record for the manifest."""
        return {
            "stimulus_identifier": self.identifier.as_string(),
            "contrast": self.identifier.contrast,
            "word": self.identifier.word,
            "speaker_identifier": self.identifier.speaker_identifier,
            "speaker_sex": self.speaker_sex,
            "context": self.identifier.context.value,
            "source": self.identifier.source.value,
            "source_corpus": self.source_corpus,
            "license_identifier": self.license_identifier,
            "original_utterance_identifier": self.original_utterance_identifier,
            "word_start_seconds": self.word_start_seconds,
            "word_end_seconds": self.word_end_seconds,
        }


@dataclass
class ContrastCarveSummary:
    """Summary of carved stimuli for one phoneme contrast.

    Used to verify REQ-122: >=5 talkers, mixed sex, multiple contexts.
    """

    contrast: ContrastIdentifier
    source: StimulusSource
    speaker_identifiers: list[str] = field(default_factory=list)
    speaker_sexes: list[Literal["F", "M", "unknown"]] = field(default_factory=list)
    contexts: list[PhonologicalContext] = field(default_factory=list)
    word_count: int = 0
    asset_count: int = 0

    def speaker_count(self) -> int:
        return len(set(self.speaker_identifiers))

    def has_mixed_sex(self) -> bool:
        sexes = set(self.speaker_sexes) - {"unknown"}
        return "F" in sexes and "M" in sexes

    def context_set(self) -> set[PhonologicalContext]:
        return set(self.contexts)

    def satisfies_req122(self) -> bool:
        """Check REQ-122: >=5 speakers, mixed sex, multiple contexts."""
        return self.speaker_count() >= 5 and self.has_mixed_sex() and len(self.context_set()) >= 2
