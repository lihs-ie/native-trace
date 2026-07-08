"""Tests for the StimulusAssetStore.

Tests persistence, manifest generation, query, and CC BY-NC exclusion check.
Uses a temporary directory for isolation.
"""

from __future__ import annotations

import io
import struct
import wave
from pathlib import Path

import pytest

from python_analyzer.infrastructure.stimulus.asset_store import StimulusAssetStore
from python_analyzer.infrastructure.stimulus.domain import (
    PhonologicalContext,
    StimulusAsset,
    StimulusIdentifier,
    StimulusSource,
)


def _make_minimal_wav() -> bytes:
    """Generate the smallest valid WAV for fixture use."""
    buffer = io.BytesIO()
    with wave.open(buffer, "w") as wav_writer:
        wav_writer.setnchannels(1)
        wav_writer.setsampwidth(2)
        wav_writer.setframerate(16000)
        wav_writer.writeframes(struct.pack("<h", 1000) * 160)
    return buffer.getvalue()


def _make_test_asset(
    contrast: str = "r-l",
    word: str = "right",
    speaker: str = "19",
    context: PhonologicalContext = PhonologicalContext.WORD_INITIAL,
    source: StimulusSource = StimulusSource.LIBRITTS,
    license_identifier: str = "CC-BY-4.0",
) -> StimulusAsset:
    stimulus_identifier = StimulusIdentifier(
        contrast=contrast,  # type: ignore[arg-type]
        word=word,
        speaker_identifier=speaker,
        context=context,
        source=source,
    )
    return StimulusAsset(
        identifier=stimulus_identifier,
        wav_bytes=_make_minimal_wav(),
        source_corpus="LibriTTS train-clean-100",
        license_identifier=license_identifier,
        speaker_sex="F",
        original_utterance_identifier="19_198_000001_000000",
        word_start_seconds=0.05,
        word_end_seconds=0.35,
    )


class TestStimulusAssetStoreWriteAndLoad:
    """Tests for write_assets + load_manifest."""

    def test_writes_manifest_with_correct_fields(self, tmp_path: Path) -> None:
        store = StimulusAssetStore(tmp_path)
        asset = _make_test_asset()
        store.write_assets({"r-l": [asset]})  # type: ignore[arg-type]

        manifest = store.load_manifest()
        assert len(manifest) == 1
        record = manifest[0]
        assert record["contrast"] == "r-l"
        assert record["word"] == "right"
        assert record["speaker_identifier"] == "19"
        assert record["license_identifier"] == "CC-BY-4.0"
        assert record["source_corpus"] == "LibriTTS train-clean-100"

    def test_wav_file_written_to_correct_path(self, tmp_path: Path) -> None:
        store = StimulusAssetStore(tmp_path)
        asset = _make_test_asset()
        store.write_assets({"r-l": [asset]})  # type: ignore[arg-type]

        expected = tmp_path / "libritts" / "r-l" / "right__19__word-initial__libritts.wav"
        assert expected.exists()
        assert len(expected.read_bytes()) > 0

    def test_raises_when_manifest_absent(self, tmp_path: Path) -> None:
        store = StimulusAssetStore(tmp_path)
        with pytest.raises(FileNotFoundError):
            store.load_manifest()


class TestStimulusAssetStoreQuery:
    """Tests for query_stimuli."""

    def test_returns_records_for_contrast(self, tmp_path: Path) -> None:
        store = StimulusAssetStore(tmp_path)
        asset_a = _make_test_asset(contrast="r-l", word="right")
        asset_b = _make_test_asset(contrast="r-l", word="light", speaker="26")
        asset_c = _make_test_asset(contrast="ae-ah", word="bat", speaker="32")
        store.write_assets(
            {  # type: ignore[arg-type]
                "r-l": [asset_a, asset_b],
                "ae-ah": [asset_c],
            }
        )

        results = store.query_stimuli("r-l")  # type: ignore[arg-type]
        assert len(results) == 2
        contrasts = {r["contrast"] for r in results}
        assert contrasts == {"r-l"}

    def test_context_filter(self, tmp_path: Path) -> None:
        store = StimulusAssetStore(tmp_path)
        initial_asset = _make_test_asset(word="right", context=PhonologicalContext.WORD_INITIAL)
        cluster_asset = _make_test_asset(
            word="grass",
            speaker="26",
            context=PhonologicalContext.CLUSTER,
        )
        store.write_assets({"r-l": [initial_asset, cluster_asset]})  # type: ignore[arg-type]

        initial_results = store.query_stimuli(
            "r-l",
            context=PhonologicalContext.WORD_INITIAL,  # type: ignore[arg-type]
        )
        assert len(initial_results) == 1
        assert initial_results[0]["word"] == "right"

        cluster_results = store.query_stimuli(
            "r-l",
            context=PhonologicalContext.CLUSTER,  # type: ignore[arg-type]
        )
        assert len(cluster_results) == 1
        assert cluster_results[0]["word"] == "grass"


class TestStimulusAssetStoreCcByNcExclusion:
    """Tests for assert_no_cc_by_nc (REQ-NF-101 / ADR-009 fitness check)."""

    def test_clean_manifest_passes(self, tmp_path: Path) -> None:
        store = StimulusAssetStore(tmp_path)
        asset = _make_test_asset(license_identifier="CC-BY-4.0")
        store.write_assets({"r-l": [asset]})  # type: ignore[arg-type]
        # Should not raise.
        store.assert_no_cc_by_nc()

    def test_cc_by_nc_license_raises(self, tmp_path: Path) -> None:
        store = StimulusAssetStore(tmp_path)
        asset = _make_test_asset(license_identifier="CC-BY-NC-4.0")
        store.write_assets({"r-l": [asset]})  # type: ignore[arg-type]
        with pytest.raises(ValueError, match="CC BY-NC"):
            store.assert_no_cc_by_nc()

    def test_apache_license_passes(self, tmp_path: Path) -> None:
        store = StimulusAssetStore(tmp_path)
        asset = _make_test_asset(
            source=StimulusSource.KOKORO,
            license_identifier="Apache-2.0",
        )
        store.write_assets({"r-l": [asset]})  # type: ignore[arg-type]
        store.assert_no_cc_by_nc()

    def test_no_manifest_passes_silently(self, tmp_path: Path) -> None:
        store = StimulusAssetStore(tmp_path)
        # Should not raise when manifest does not exist.
        store.assert_no_cc_by_nc()


class TestGetStimulusWavBytes:
    """Tests for get_stimulus_wav_bytes."""

    def test_loads_written_wav(self, tmp_path: Path) -> None:
        store = StimulusAssetStore(tmp_path)
        asset = _make_test_asset()
        store.write_assets({"r-l": [asset]})  # type: ignore[arg-type]

        manifest = store.load_manifest()
        stimulus_id = manifest[0]["stimulus_identifier"]
        loaded_bytes = store.get_stimulus_wav_bytes(stimulus_id)
        assert len(loaded_bytes) > 0

    def test_raises_for_missing_stimulus(self, tmp_path: Path) -> None:
        store = StimulusAssetStore(tmp_path)
        with pytest.raises(FileNotFoundError):
            store.get_stimulus_wav_bytes("r-l__right__99__word-initial__libritts")
