"""Carve pipeline runner: orchestrates LibriTTS + Kokoro stimulus extraction.

This module is the single entry point for building the curated stimulus asset set.
It is called from the Dockerfile RUN step to pre-build assets during image build.

Usage (Docker build step):
    python -m python_analyzer.infrastructure.stimulus.carve_runner \\
        --corpus   /data/corpus-scratch/train-clean-100.tar.gz \\
        --alignment /data/alignment/train_clean_100.tar.gz \\
        --output   /app/src/python_analyzer/assets/stimuli

ADR-009: all carving confined to python-analyzer (ADR-005 layer closure).
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from python_analyzer.infrastructure.stimulus.asset_store import StimulusAssetStore
from python_analyzer.infrastructure.stimulus.domain import (
    ContrastIdentifier,
    StimulusAsset,
)
from python_analyzer.infrastructure.stimulus.kokoro_supplement import (
    run_long_tail_supplement,
)
from python_analyzer.infrastructure.stimulus.libritts_carver import (
    run_core_carve_pipeline,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def run(
    corpus_archive_path: Path,
    alignment_archive_path: Path,
    output_directory: Path,
) -> None:
    """Run the full carve pipeline and write assets + manifest to disk.

    Args:
        corpus_archive_path: Path to train-clean-100.tar.gz.
        alignment_archive_path: Path to cdminix/libritts-aligned train_clean_100.tar.gz.
        output_directory: Directory to write carved assets and manifest.
    """
    all_assets: dict[ContrastIdentifier, list[StimulusAsset]] = {}

    # Step 1: LibriTTS core carve-out.
    if corpus_archive_path.exists() and alignment_archive_path.exists():
        logger.info("Running LibriTTS core carve pipeline")
        core_assets = run_core_carve_pipeline(
            corpus_archive_path=corpus_archive_path,
            alignment_archive_path=alignment_archive_path,
            output_directory=output_directory,
        )
        all_assets.update(core_assets)
        logger.info(
            "Core carve complete: %d contrasts",
            len(core_assets),
        )
    else:
        logger.warning(
            "LibriTTS or alignment archive not found — skipping core carve. "
            "corpus=%s alignment=%s",
            corpus_archive_path,
            alignment_archive_path,
        )

    # Step 2: Kokoro long-tail supplement.
    logger.info("Running Kokoro long-tail supplement")
    long_tail_assets = run_long_tail_supplement()
    all_assets.update(long_tail_assets)
    logger.info("Long-tail supplement complete: %d contrasts", len(long_tail_assets))

    # Step 3: Persist to disk with attribution manifest.
    store = StimulusAssetStore(output_directory)
    store.write_assets(all_assets)

    # Step 4: Assert no CC BY-NC assets (fitness check).
    store.assert_no_cc_by_nc()
    logger.info("CC BY-NC fitness check passed")

    # Summary.
    total = sum(len(a) for a in all_assets.values())
    logger.info("Carve pipeline complete: %d total stimulus assets written", total)

    for contrast, assets in all_assets.items():
        speaker_ids = {a.identifier.speaker_identifier for a in assets}
        sexes = {a.speaker_sex for a in assets}
        contexts = {a.identifier.context.value for a in assets}
        satisfies = (
            len(speaker_ids) >= 5
            and "F" in sexes
            and "M" in sexes
            and len(contexts) >= 2
        )
        logger.info(
            "  %s: %d assets, %d speakers, sexes=%s, contexts=%s, REQ-122=%s",
            contrast,
            len(assets),
            len(speaker_ids),
            sexes,
            contexts,
            "PASS" if satisfies else "WARN",
        )


def main() -> None:
    """CLI entry point for the carve runner."""
    parser = argparse.ArgumentParser(
        description="Run the HVPT stimulus carve pipeline (ADR-009)"
    )
    parser.add_argument(
        "--corpus",
        type=Path,
        default=Path("/data/corpus-scratch/train-clean-100.tar.gz"),
        help="Path to LibriTTS train-clean-100.tar.gz",
    )
    parser.add_argument(
        "--alignment",
        type=Path,
        default=Path("/data/alignment/train_clean_100.tar.gz"),
        help="Path to cdminix/libritts-aligned train_clean_100.tar.gz",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("/app/src/python_analyzer/assets/stimuli"),
        help="Output directory for carved assets and manifest",
    )

    parsed_args = parser.parse_args()

    try:
        run(
            corpus_archive_path=parsed_args.corpus,
            alignment_archive_path=parsed_args.alignment,
            output_directory=parsed_args.output,
        )
    except Exception as error:
        logger.error("Carve pipeline failed: %s", error, exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
