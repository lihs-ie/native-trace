"""Tests for CC BY-NC license exclusion fitness check.

REQ-NF-101 / ADR-009: L2-ARCTIC and any CC BY-NC source must not appear
in bundled stimuli. Tests assert_no_cc_by_nc and the FORBIDDEN_LICENSE_PREFIXES.
"""

from __future__ import annotations

import io
import struct
import wave
from pathlib import Path

import pytest

from python_analyzer.infrastructure.stimulus.asset_store import (
    FORBIDDEN_LICENSE_PREFIXES,
    StimulusAssetStore,
)
from python_analyzer.infrastructure.stimulus.domain import (
    PhonologicalContext,
    StimulusAsset,
    StimulusIdentifier,
    StimulusSource,
)


def _make_minimal_wav() -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "w") as wav_writer:
        wav_writer.setnchannels(1)
        wav_writer.setsampwidth(2)
        wav_writer.setframerate(16000)
        wav_writer.writeframes(struct.pack("<h", 500) * 160)
    return buffer.getvalue()


def _asset_with_license(license_id: str, word: str = "right") -> StimulusAsset:
    stimulus_identifier = StimulusIdentifier(
        contrast="r-l",  # type: ignore[arg-type]
        word=word,
        speaker_identifier="test-speaker",
        context=PhonologicalContext.WORD_INITIAL,
        source=StimulusSource.LIBRITTS,
    )
    return StimulusAsset(
        identifier=stimulus_identifier,
        wav_bytes=_make_minimal_wav(),
        source_corpus="Test corpus",
        license_identifier=license_id,
        speaker_sex="F",
    )


class TestForbiddenLicensePrefixes:
    """Verify the FORBIDDEN_LICENSE_PREFIXES constant covers key variants."""

    def test_cc_by_nc_uppercase_covered(self) -> None:
        assert any("CC-BY-NC" in p for p in FORBIDDEN_LICENSE_PREFIXES)

    def test_cc_by_nc_lowercase_covered(self) -> None:
        assert any("cc-by-nc" in p.lower() for p in FORBIDDEN_LICENSE_PREFIXES)


class TestAssertNoCcByNc:
    """Integration tests for assert_no_cc_by_nc."""

    def test_cc_by_nc_4_0_raises(self, tmp_path: Path) -> None:
        store = StimulusAssetStore(tmp_path)
        store.write_assets({"r-l": [_asset_with_license("CC-BY-NC-4.0")]})  # type: ignore[arg-type]
        with pytest.raises(ValueError, match="CC BY-NC"):
            store.assert_no_cc_by_nc()

    def test_cc_by_nc_2_0_raises(self, tmp_path: Path) -> None:
        store = StimulusAssetStore(tmp_path)
        store.write_assets({"r-l": [_asset_with_license("CC-BY-NC-2.0")]})  # type: ignore[arg-type]
        with pytest.raises(ValueError):
            store.assert_no_cc_by_nc()

    def test_cc_by_4_0_passes(self, tmp_path: Path) -> None:
        store = StimulusAssetStore(tmp_path)
        store.write_assets({"r-l": [_asset_with_license("CC-BY-4.0")]})  # type: ignore[arg-type]
        store.assert_no_cc_by_nc()  # should not raise

    def test_apache_2_0_passes(self, tmp_path: Path) -> None:
        store = StimulusAssetStore(tmp_path)
        store.write_assets({"r-l": [_asset_with_license("Apache-2.0")]})  # type: ignore[arg-type]
        store.assert_no_cc_by_nc()  # should not raise

    def test_mix_of_clean_and_nc_raises(self, tmp_path: Path) -> None:
        store = StimulusAssetStore(tmp_path)
        clean = _asset_with_license("CC-BY-4.0", word="right")
        nc = _asset_with_license("CC-BY-NC-4.0", word="light")
        store.write_assets({"r-l": [clean, nc]})  # type: ignore[arg-type]
        with pytest.raises(ValueError, match="CC BY-NC"):
            store.assert_no_cc_by_nc()
