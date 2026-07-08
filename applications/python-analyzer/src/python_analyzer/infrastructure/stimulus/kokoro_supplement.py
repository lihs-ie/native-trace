"""Kokoro TTS long-tail supplement for HVPT stimuli.

Generates multi-talker stimuli for long-tail contrasts using the existing
Kokoro-82M TTS infrastructure (ADR-001 / M-124).

ADR-009: long-tail contrasts supplemented by Kokoro (Apache-2.0).
select_multi_talker_voices provides >=5 voices, mixed sex (REQ-122).
"""

from __future__ import annotations

import logging

from python_analyzer.infrastructure.kokoro_tts import (
    select_multi_talker_voices,
    synthesize_speech,
)
from python_analyzer.infrastructure.stimulus.context_classifier import (
    classify_phonological_context,
)
from python_analyzer.infrastructure.stimulus.domain import (
    LONG_TAIL_CONTRASTS,
    MINIMAL_PAIRS,
    ContrastIdentifier,
    StimulusAsset,
    StimulusIdentifier,
    StimulusSource,
)

logger = logging.getLogger(__name__)

# Kokoro voices to use per word: 5 voices minimum for REQ-122.
# select_multi_talker_voices(5, require_mixed_sex=True) returns 3F + 2M.
VOICES_PER_WORD = 5


def _voice_sex(voice_id: str) -> str:
    """Return 'F' for af_* voices, 'M' for am_* voices."""
    if voice_id.startswith("af_"):
        return "F"
    if voice_id.startswith("am_"):
        return "M"
    return "unknown"


def run_long_tail_supplement(
    voices_per_word: int = VOICES_PER_WORD,
) -> dict[ContrastIdentifier, list[StimulusAsset]]:
    """Generate long-tail stimuli via Kokoro TTS for all long-tail contrasts.

    Synthesizes each minimal-pair word with multiple Kokoro voices to satisfy
    REQ-122 (>=5 talkers, mixed sex, multiple contexts).

    Args:
        voices_per_word: Number of Kokoro voices to synthesize per word (>=5).

    Returns:
        Dict mapping contrast identifier to list of StimulusAsset objects.
    """
    voices = select_multi_talker_voices(
        count=max(voices_per_word, 5),
        require_mixed_sex=True,
    )
    logger.info("Long-tail supplement: using %d Kokoro voices: %s", len(voices), voices)

    results: dict[ContrastIdentifier, list[StimulusAsset]] = {
        contrast: [] for contrast in LONG_TAIL_CONTRASTS
    }

    for contrast in LONG_TAIL_CONTRASTS:
        for word_a, word_b in MINIMAL_PAIRS[contrast]:
            for word in (word_a, word_b):
                for voice_id in voices:
                    try:
                        wav_bytes = synthesize_speech(text=word, speed=0.9, voice=voice_id)
                    except (ValueError, RuntimeError) as synthesis_error:
                        logger.warning(
                            "Kokoro synthesis failed for word=%s voice=%s: %s",
                            word,
                            voice_id,
                            synthesis_error,
                        )
                        continue

                    sex = _voice_sex(voice_id)
                    context = classify_phonological_context(word)

                    stimulus_identifier = StimulusIdentifier(
                        contrast=contrast,
                        word=word.lower(),
                        speaker_identifier=voice_id,
                        context=context,
                        source=StimulusSource.KOKORO,
                    )

                    asset = StimulusAsset(
                        identifier=stimulus_identifier,
                        wav_bytes=wav_bytes,
                        source_corpus="Kokoro-82M TTS",
                        license_identifier="Apache-2.0",
                        speaker_sex=sex,  # type: ignore[arg-type]
                        original_utterance_identifier=None,
                        word_start_seconds=None,
                        word_end_seconds=None,
                    )

                    results[contrast].append(asset)

        # Log summary for this contrast.
        assets = results[contrast]
        speaker_ids = {a.identifier.speaker_identifier for a in assets}
        sexes = {a.speaker_sex for a in assets}
        contexts = {a.identifier.context for a in assets}
        logger.info(
            "Long-tail contrast %s: %d assets, %d speakers, sexes=%s, contexts=%s",
            contrast,
            len(assets),
            len(speaker_ids),
            sexes,
            {c.value for c in contexts},
        )

    return results
