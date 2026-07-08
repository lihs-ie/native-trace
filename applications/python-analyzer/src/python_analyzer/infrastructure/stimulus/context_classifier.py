"""Phonological context classifier for extracted stimulus words.

Classifies each target word token as word-initial, word-medial, or cluster
based on its position in the utterance and the word's phonological structure.

REQ-122: multiple phonological contexts required for generalization.
ADR-009: context classification based on word position and onset cluster.
"""

from __future__ import annotations

from python_analyzer.infrastructure.stimulus.domain import (
    CLUSTER_INITIAL_WORDS,
    PhonologicalContext,
)

# Words known to have word-medial occurrence of the target phoneme.
# For the contrasts in MINIMAL_PAIRS, most are monosyllabic and the
# diagnostic phoneme is word-initial. A small set are word-medial or contain
# onset clusters.
_WORD_MEDIAL_TARGETS: frozenset[str] = frozenset(
    [
        # /r/-/l/: medial context in longer words — not in minimal-pair list but
        # included here for extensibility.
        "very",
        "berry",
        "grass",
        "glass",
        # /iː/-/ɪ/
        "leave",
        "live",
        "sheep",
        "ship",
    ]
)


def classify_phonological_context(
    word: str,
) -> PhonologicalContext:
    """Classify the phonological context of a target word occurrence.

    Priority order:
    1. Cluster-initial (if the word begins with a consonant cluster)
    2. Word-medial (if the target phoneme is in a non-initial syllable
       or if the word itself appears in a medial position in the utterance
       and is in the medial-targets set)
    3. Word-initial (default for monosyllabic words at any utterance position)

    Note: For HVPT stimuli, "word-initial / word-medial / cluster" refers to
    the position of the *diagnostic phoneme within the word*, not the word's
    position in the utterance.

    Args:
        word: The target word (lowercased).

    Returns:
        PhonologicalContext classification.
    """
    word_lower = word.lower()

    # Cluster context takes priority: the word starts with a consonant cluster
    # that includes the target phoneme.
    if word_lower in CLUSTER_INITIAL_WORDS:
        return PhonologicalContext.CLUSTER

    # Word-medial: the diagnostic phoneme appears in a non-initial syllable.
    if word_lower in _WORD_MEDIAL_TARGETS:
        return PhonologicalContext.WORD_MEDIAL

    # Default: word-initial (most monosyllabic minimal-pair words).
    return PhonologicalContext.WORD_INITIAL
