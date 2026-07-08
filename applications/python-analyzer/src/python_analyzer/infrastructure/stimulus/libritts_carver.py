"""LibriTTS carve-out pipeline.

Extracts minimal-pair word stimuli from the LibriTTS train-clean-100 corpus
and the cdminix/libritts-aligned pre-computed TextGrid alignments.

Pipeline:
  (a) Stream the LibriTTS tar.gz for normalized transcripts
  (b) Grep transcripts for target words
  (c) Look up corresponding TextGrid from libritts-aligned archive
  (d) Extract word boundaries from TextGrid
  (e) Cut the word audio segment
  (f) RMS quality filter
  (g) Context classification
  (h) Collect until >=5 speakers, mixed sex, multiple contexts per contrast

ADR-009: all extraction confined to python-analyzer (ADR-005 layer closure).
No MFA run required (pre-computed alignments from cdminix/libritts-aligned).
"""

from __future__ import annotations

import logging
import os
import re
import tarfile
from pathlib import Path

from python_analyzer.infrastructure.stimulus.audio_carver import (
    carve_word_segment,
    passes_quality_filter,
)
from python_analyzer.infrastructure.stimulus.context_classifier import (
    classify_phonological_context,
)
from python_analyzer.infrastructure.stimulus.domain import (
    CORE_CONTRASTS,
    MINIMAL_PAIRS,
    ContrastIdentifier,
    StimulusAsset,
    StimulusIdentifier,
    StimulusSource,
)
from python_analyzer.infrastructure.stimulus.speaker_metadata import (
    load_speaker_sex_map,
)
from python_analyzer.infrastructure.stimulus.textgrid_parser import (
    find_word_boundary,
    parse_textgrid_word_intervals,
)

logger = logging.getLogger(__name__)

# Maximum stimuli to collect per (contrast, word) pair to keep bundle size tractable.
MAX_STIMULI_PER_WORD = 20

# Minimum distinct speakers required per contrast (REQ-122).
MIN_SPEAKERS_PER_CONTRAST = 5


def run_core_carve_pipeline(
    corpus_archive_path: Path,
    alignment_archive_path: Path,
    output_directory: Path,
    max_stimuli_per_word: int = MAX_STIMULI_PER_WORD,
) -> dict[ContrastIdentifier, list[StimulusAsset]]:
    """Run the LibriTTS carve-out pipeline for all core contrasts.

    Args:
        corpus_archive_path: Path to LibriTTS train-clean-100.tar.gz.
        alignment_archive_path: Path to cdminix/libritts-aligned train_clean_100.tar.gz.
        output_directory: Directory to write carved WAV files and manifest.
        max_stimuli_per_word: Maximum stimuli per (contrast, word) pair.

    Returns:
        Dict mapping contrast identifier to list of StimulusAsset objects.
    """
    output_directory.mkdir(parents=True, exist_ok=True)

    logger.info("Loading speaker sex metadata from LibriTTS archive")
    speaker_sex_map = load_speaker_sex_map(corpus_archive_path)
    logger.info("Loaded sex metadata for %d speakers", len(speaker_sex_map))

    # Build the set of all target words across all core contrasts.
    target_words: set[str] = set()
    for contrast in CORE_CONTRASTS:
        for word_a, word_b in MINIMAL_PAIRS[contrast]:
            target_words.add(word_a.lower())
            target_words.add(word_b.lower())

    logger.info("Target words: %s", sorted(target_words))

    # Build word → list of (utterance_id, transcript) index from LibriTTS.
    # utterance_id = "{speaker}_{chapter}_{utterance}_{segment}" (basename without ext)
    logger.info("Scanning LibriTTS transcripts for target words")
    utterance_word_index = _build_utterance_word_index(corpus_archive_path, target_words)
    logger.info(
        "Found %d utterance-word hits",
        sum(len(v) for v in utterance_word_index.values()),
    )

    # Load alignment TextGrids for matched utterances.
    logger.info("Loading alignment TextGrids")
    alignment_map = _load_alignment_map(alignment_archive_path, set(utterance_word_index.keys()))
    logger.info("Loaded %d alignment TextGrids", len(alignment_map))

    # Build per-contrast results.
    results: dict[ContrastIdentifier, list[StimulusAsset]] = {
        contrast: [] for contrast in CORE_CONTRASTS
    }

    # Per-contrast, per-word speaker tracking for REQ-122.
    # contrast -> word -> set of speaker_ids already used
    per_contrast_word_speakers: dict[ContrastIdentifier, dict[str, set[str]]] = {
        contrast: {word: set() for pair in MINIMAL_PAIRS[contrast] for word in pair}
        for contrast in CORE_CONTRASTS
    }

    # Stream LibriTTS WAVs for matched utterances.
    logger.info("Carving word segments from LibriTTS audio")
    carved_utterances = 0
    with tarfile.open(corpus_archive_path, "r:gz") as corpus_archive:
        # Iterate the archive SEQUENTIALLY (forward-only). The previous version
        # looked up each needed WAV by name in hit order, which forces a gzip
        # stream to re-decompress from the start on every backward seek — O(n^2),
        # producing zero output after 30+ minutes on the 7.7 GB corpus. Walking
        # the archive once in stream order and extracting members as they appear
        # keeps the whole carve to a single O(n) pass.
        for member in corpus_archive:
            if not member.isfile() or not member.name.endswith(".wav"):
                continue
            utterance_id = member.name.rsplit("/", 1)[-1][: -len(".wav")]
            words_in_utterance = utterance_word_index.get(utterance_id)
            if words_in_utterance is None or utterance_id not in alignment_map:
                continue

            textgrid_content = alignment_map[utterance_id]
            try:
                word_intervals = parse_textgrid_word_intervals(textgrid_content)
            except ValueError as parse_error:
                logger.debug("TextGrid parse error for %s: %s", utterance_id, parse_error)
                continue

            # Read WAV bytes from the current archive member (forward read, no seek).
            file_obj = corpus_archive.extractfile(member)
            if file_obj is None:
                continue
            wav_bytes = file_obj.read()

            carved_utterances += 1
            if carved_utterances % 500 == 0:
                logger.info("Carved from %d matched utterances", carved_utterances)

            # Try to carve each target word found in this utterance.
            for word, contrasts_for_word in words_in_utterance.items():
                matching_intervals = find_word_boundary(word_intervals, word)
                if not matching_intervals:
                    continue

                for interval in matching_intervals:
                    duration = interval.duration_seconds()

                    # Carve the segment.
                    try:
                        segment_bytes = carve_word_segment(
                            wav_bytes,
                            interval.start_seconds,
                            interval.end_seconds,
                        )
                    except (ValueError, Exception) as carve_error:
                        logger.debug("Carve error for %s/%s: %s", utterance_id, word, carve_error)
                        continue

                    # Quality filter.
                    if not passes_quality_filter(segment_bytes, duration):
                        continue

                    # Extract speaker_id from utterance_id.
                    speaker_id = utterance_id.split("_")[0]
                    sex = speaker_sex_map.get(speaker_id, "unknown")

                    context = classify_phonological_context(word)

                    # Add to each contrast that uses this word.
                    for contrast in contrasts_for_word:
                        used_speakers = per_contrast_word_speakers[contrast][word]
                        current_count = sum(
                            1 for asset in results[contrast] if asset.identifier.word == word
                        )

                        if current_count >= max_stimuli_per_word:
                            continue

                        # Prefer new speakers for diversity.
                        if speaker_id in used_speakers and current_count >= min(
                            max_stimuli_per_word // 2, MIN_SPEAKERS_PER_CONTRAST
                        ):
                            continue

                        stimulus_identifier = StimulusIdentifier(
                            contrast=contrast,
                            word=word,
                            speaker_identifier=speaker_id,
                            context=context,
                            source=StimulusSource.LIBRITTS,
                        )

                        asset = StimulusAsset(
                            identifier=stimulus_identifier,
                            wav_bytes=segment_bytes,
                            source_corpus="LibriTTS train-clean-100",
                            license_identifier="CC-BY-4.0",
                            speaker_sex=sex,  # type: ignore[arg-type]
                            original_utterance_identifier=utterance_id,
                            word_start_seconds=interval.start_seconds,
                            word_end_seconds=interval.end_seconds,
                        )

                        results[contrast].append(asset)
                        used_speakers.add(speaker_id)

    # Log summary.
    for contrast, assets in results.items():
        speaker_ids = {a.identifier.speaker_identifier for a in assets}
        sexes = {a.speaker_sex for a in assets}
        contexts = {a.identifier.context for a in assets}
        logger.info(
            "Contrast %s: %d assets, %d speakers, sexes=%s, contexts=%s",
            contrast,
            len(assets),
            len(speaker_ids),
            sexes,
            {c.value for c in contexts},
        )

    return results


def _build_utterance_word_index(
    corpus_archive_path: Path,
    target_words: set[str],
) -> dict[str, dict[str, set[ContrastIdentifier]]]:
    """Index utterances by the target words they contain.

    Scans normalized transcript files (.normalized.txt) in the LibriTTS
    tar.gz archive. Returns a dict:
        utterance_id -> {word -> set of contrasts that need this word}

    Args:
        corpus_archive_path: Path to train-clean-100.tar.gz.
        target_words: Set of lowercase target words to search for.

    Returns:
        Dict mapping utterance_id to {word: set(contrast_ids)}.
    """
    # Build reverse index: word -> set of contrasts.
    word_to_contrasts: dict[str, set[ContrastIdentifier]] = {}
    for contrast in CORE_CONTRASTS:
        for word_a, word_b in MINIMAL_PAIRS[contrast]:
            for word in (word_a.lower(), word_b.lower()):
                word_to_contrasts.setdefault(word, set()).add(contrast)

    result: dict[str, dict[str, set[ContrastIdentifier]]] = {}

    # Precompile regex for word-boundary matching.
    word_patterns = {
        word: re.compile(r"\b" + re.escape(word) + r"\b", re.IGNORECASE) for word in target_words
    }

    with tarfile.open(corpus_archive_path, "r:gz") as archive:
        for member in archive.getmembers():
            if not member.name.endswith(".normalized.txt"):
                continue

            file_obj = archive.extractfile(member)
            if file_obj is None:
                continue

            transcript = file_obj.read().decode("utf-8", errors="replace").strip().lower()

            # Determine utterance_id: basename without .normalized.txt
            basename = os.path.basename(member.name)
            utterance_id = basename.replace(".normalized.txt", "")

            # Check which target words appear.
            found_words: dict[str, set[ContrastIdentifier]] = {}
            for word, pattern in word_patterns.items():
                if pattern.search(transcript):
                    found_words[word] = word_to_contrasts[word]

            if found_words:
                result[utterance_id] = found_words

    return result


def _load_alignment_map(
    alignment_archive_path: Path,
    utterance_ids: set[str],
) -> dict[str, str]:
    """Load TextGrid content for the requested utterance IDs.

    Args:
        alignment_archive_path: Path to cdminix/libritts-aligned train_clean_100.tar.gz.
        utterance_ids: Set of utterance IDs to load.

    Returns:
        Dict mapping utterance_id to TextGrid content (str).
    """
    result: dict[str, str] = {}

    if not alignment_archive_path.exists():
        logger.warning("Alignment archive not found: %s", alignment_archive_path)
        return result

    with tarfile.open(alignment_archive_path, "r:gz") as archive:
        for member in archive.getmembers():
            if not member.name.endswith(".TextGrid"):
                continue

            basename = os.path.basename(member.name)
            # Remove .TextGrid suffix.
            utterance_id = basename[: -len(".TextGrid")]

            if utterance_id not in utterance_ids:
                continue

            file_obj = archive.extractfile(member)
            if file_obj is None:
                continue

            content = file_obj.read().decode("utf-8", errors="replace")
            result[utterance_id] = content

            if len(result) >= len(utterance_ids):
                break

    return result
