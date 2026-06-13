"""Stimulus asset store: persistence and manifest management.

Writes carved/synthesised stimuli to disk and maintains a JSON attribution
manifest required by CC BY 4.0 on redistribution.

ADR-009:
- Each bundled stimulus asset carries source corpus license attribution.
- Attribution manifest ships with assets.
- CC BY-NC sources MUST NOT be mixed in (REQ-NF-101 / fitness check).
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from python_analyzer.infrastructure.stimulus.domain import (
    ContrastIdentifier,
    PhonologicalContext,
    StimulusAsset,
    StimulusSource,
)

logger = logging.getLogger(__name__)

# Manifest filename within the assets directory.
MANIFEST_FILENAME = "attribution-manifest.json"

# Forbidden license prefixes (CC BY-NC and variants).
# ADR-009 / REQ-NF-101: these must never appear in bundled stimuli.
FORBIDDEN_LICENSE_PREFIXES: tuple[str, ...] = (
    "CC-BY-NC",
    "cc-by-nc",
    "CC BY-NC",
    "cc by-nc",
)


class StimulusAssetStore:
    """Manages the on-disk curated stimulus asset directory.

    Directory layout:
        <base_directory>/
            attribution-manifest.json
            libritts/
                r-l/
                    right__<speaker>__word-initial__libritts.wav
                    ...
                ae-ah/
                    ...
            kokoro/
                th-s/
                    think__af_heart__word-initial__kokoro.wav
                    ...
    """

    def __init__(self, base_directory: Path) -> None:
        self._base_directory = base_directory
        self._base_directory.mkdir(parents=True, exist_ok=True)

    def write_assets(
        self,
        assets_by_contrast: dict[ContrastIdentifier, list[StimulusAsset]],
    ) -> None:
        """Write all assets to disk and generate the attribution manifest.

        Args:
            assets_by_contrast: Dict from contrast to list of StimulusAsset.
        """
        manifest_records: list[dict[str, Any]] = []

        for _contrast, assets in assets_by_contrast.items():
            for asset in assets:
                file_path = self._asset_path(asset)
                file_path.parent.mkdir(parents=True, exist_ok=True)
                file_path.write_bytes(asset.wav_bytes)

                manifest_records.append(asset.to_attribution_record())

        manifest_path = self._base_directory / MANIFEST_FILENAME
        with manifest_path.open("w", encoding="utf-8") as manifest_file:
            json.dump(manifest_records, manifest_file, indent=2, ensure_ascii=False)

        logger.info(
            "Wrote %d stimulus assets to %s with manifest",
            sum(len(a) for a in assets_by_contrast.values()),
            self._base_directory,
        )

    def load_manifest(self) -> list[dict[str, Any]]:
        """Load the attribution manifest from disk.

        Returns:
            List of attribution record dicts.

        Raises:
            FileNotFoundError: If the manifest does not exist.
        """
        manifest_path = self._base_directory / MANIFEST_FILENAME
        if not manifest_path.exists():
            raise FileNotFoundError(
                f"Attribution manifest not found: {manifest_path}. "
                "Run the carve pipeline first."
            )
        with manifest_path.open("r", encoding="utf-8") as manifest_file:
            return json.load(manifest_file)

    def query_stimuli(
        self,
        contrast: ContrastIdentifier,
        context: PhonologicalContext | None = None,
    ) -> list[dict[str, Any]]:
        """Query stimulus metadata from the manifest.

        Args:
            contrast: Phoneme contrast to filter by.
            context: Optional phonological context filter.

        Returns:
            List of attribution records matching the query.

        Raises:
            FileNotFoundError: If the manifest does not exist.
        """
        records = self.load_manifest()
        filtered = [r for r in records if r.get("contrast") == contrast]

        if context is not None:
            filtered = [r for r in filtered if r.get("context") == context.value]

        return filtered

    def get_stimulus_wav_bytes(self, stimulus_identifier_string: str) -> bytes:
        """Load WAV bytes for a stimulus by its identifier string.

        Args:
            stimulus_identifier_string: The identifier string from the manifest.

        Returns:
            WAV bytes.

        Raises:
            FileNotFoundError: If the WAV file does not exist.
        """
        # Parse parts: contrast__word__speaker__context__source
        parts = stimulus_identifier_string.split("__")
        if len(parts) < 5:
            raise ValueError(
                f"Invalid stimulus identifier string: {stimulus_identifier_string!r}"
            )

        contrast = parts[0]
        word = parts[1]
        speaker = parts[2]
        context_value = parts[3]
        source_value = parts[4]

        source_dir = "libritts" if source_value == StimulusSource.LIBRITTS.value else "kokoro"
        filename = f"{word}__{speaker}__{context_value}__{source_value}.wav"
        file_path = self._base_directory / source_dir / contrast / filename

        if not file_path.exists():
            raise FileNotFoundError(
                f"Stimulus WAV not found: {file_path}"
            )

        return file_path.read_bytes()

    def assert_no_cc_by_nc(self) -> None:
        """Assert that no CC BY-NC licensed assets are present in the store.

        ADR-009 / REQ-NF-101: CC BY-NC sources (L2-ARCTIC etc.) must not be
        mixed into bundled stimuli.

        Raises:
            ValueError: If any CC BY-NC licensed asset is found.
        """
        if not (self._base_directory / MANIFEST_FILENAME).exists():
            # No manifest yet — nothing to check.
            return

        records = self.load_manifest()
        violations: list[str] = []

        for record in records:
            license_id = record.get("license_identifier", "")
            for forbidden_prefix in FORBIDDEN_LICENSE_PREFIXES:
                if forbidden_prefix in str(license_id):
                    violations.append(
                        f"CC BY-NC violation: {record.get('stimulus_identifier')} "
                        f"has license {license_id!r}"
                    )
                    break

        if violations:
            raise ValueError(
                "CC BY-NC assets detected in stimulus store (REQ-NF-101 violation):\n"
                + "\n".join(violations)
            )

    def _asset_path(self, asset: StimulusAsset) -> Path:
        """Compute the on-disk path for a stimulus asset."""
        source_dir = (
            "libritts"
            if asset.identifier.source == StimulusSource.LIBRITTS
            else "kokoro"
        )
        contrast_dir = asset.identifier.contrast
        filename = (
            f"{asset.identifier.word}"
            f"__{asset.identifier.speaker_identifier}"
            f"__{asset.identifier.context.value}"
            f"__{asset.identifier.source.value}.wav"
        )
        return self._base_directory / source_dir / contrast_dir / filename
