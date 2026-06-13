"""Contract tests for GET /v1/stimuli.

Tests that the endpoint:
- Returns real stimulus metadata + non-empty WAV (Base64) for valid contrasts.
- Returns 404 when no stimuli exist for a contrast.
- Returns 422 for an invalid context parameter.
- Different contrasts return different stimuli (not a fixed dummy).

These tests use a pre-seeded temporary assets directory (no Kokoro/LibriTTS
runtime required).
"""

from __future__ import annotations

import base64
import io
import struct
import wave
from collections.abc import Generator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from python_analyzer.infrastructure.stimulus.asset_store import StimulusAssetStore
from python_analyzer.infrastructure.stimulus.domain import (
    PhonologicalContext,
    StimulusAsset,
    StimulusIdentifier,
    StimulusSource,
)


def _make_minimal_wav() -> bytes:
    """Generate a minimal valid WAV for fixtures."""
    buffer = io.BytesIO()
    with wave.open(buffer, "w") as wav_writer:
        wav_writer.setnchannels(1)
        wav_writer.setsampwidth(2)
        wav_writer.setframerate(16000)
        wav_writer.writeframes(struct.pack("<h", 2000) * 320)
    return buffer.getvalue()


def _make_asset(
    contrast: str,
    word: str,
    speaker: str,
    context: PhonologicalContext = PhonologicalContext.WORD_INITIAL,
    source: StimulusSource = StimulusSource.LIBRITTS,
) -> StimulusAsset:
    stimulus_identifier = StimulusIdentifier(
        contrast=contrast,  # type: ignore[arg-type]
        word=word,
        speaker_identifier=speaker,
        context=context,
        source=source,
    )
    is_libritts = source == StimulusSource.LIBRITTS
    return StimulusAsset(
        identifier=stimulus_identifier,
        wav_bytes=_make_minimal_wav(),
        source_corpus="LibriTTS train-clean-100" if is_libritts else "Kokoro-82M TTS",
        license_identifier="CC-BY-4.0" if is_libritts else "Apache-2.0",
        speaker_sex="F" if int(speaker[:2] if speaker[:2].isdigit() else "0") % 2 == 0 else "M",
    )


@pytest.fixture(scope="module")
def seeded_assets_dir(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Create a temporary assets directory pre-seeded with test stimuli."""
    directory = tmp_path_factory.mktemp("stimuli")
    store = StimulusAssetStore(directory)

    # Seed r-l contrast with 5 speakers, mixed sex, multiple contexts.
    rl_assets = [
        _make_asset("r-l", "right", "19", PhonologicalContext.WORD_INITIAL),
        _make_asset(
            "r-l", "right", "26", PhonologicalContext.WORD_INITIAL, StimulusSource.LIBRITTS
        ),
        _make_asset("r-l", "light", "32", PhonologicalContext.WORD_INITIAL),
        _make_asset("r-l", "grass", "40", PhonologicalContext.CLUSTER),
        _make_asset("r-l", "glass", "60", PhonologicalContext.CLUSTER),
    ]

    # Seed ae-ah contrast (different contrast for cross-contrast test).
    aeah_assets = [
        _make_asset("ae-ah", "bat", "19", PhonologicalContext.WORD_INITIAL),
        _make_asset("ae-ah", "but", "26", PhonologicalContext.WORD_INITIAL),
    ]

    store.write_assets({  # type: ignore[arg-type]
        "r-l": rl_assets,
        "ae-ah": aeah_assets,
    })

    return directory


@pytest.fixture(scope="module")
def client(seeded_assets_dir: Path) -> Generator[TestClient, None, None]:
    """TestClient wired to the app with the seeded assets directory."""
    import python_analyzer.interface.http_handler as handler_module

    # Temporarily redirect the assets directory to the seeded temp dir.
    original_assets_dir = handler_module._ASSETS_DIR
    handler_module._ASSETS_DIR = seeded_assets_dir

    from python_analyzer.app import app
    with TestClient(app) as test_client:
        yield test_client

    handler_module._ASSETS_DIR = original_assets_dir


class TestGetStimuliEndpoint:
    """Tests for GET /v1/stimuli."""

    def test_returns_200_with_real_metadata(self, client: TestClient) -> None:
        response = client.get("/v1/stimuli?contrast=r-l")
        assert response.status_code == 200

        data = response.json()
        assert isinstance(data, list)
        assert len(data) > 0

    def test_each_item_has_required_fields(self, client: TestClient) -> None:
        response = client.get("/v1/stimuli?contrast=r-l")
        assert response.status_code == 200

        for item in response.json():
            assert "metadata" in item, "missing 'metadata' field"
            assert "wavBase64" in item, "missing 'wavBase64' field"
            metadata = item["metadata"]
            assert metadata["contrast"] == "r-l"
            assert metadata["word"] != ""
            assert metadata["speakerIdentifier"] != ""
            assert metadata["licenseIdentifier"] in ("CC-BY-4.0", "Apache-2.0")

    def test_wav_base64_is_valid_wav(self, client: TestClient) -> None:
        response = client.get("/v1/stimuli?contrast=r-l&limit=1")
        assert response.status_code == 200

        item = response.json()[0]
        wav_bytes = base64.b64decode(item["wavBase64"])
        # Should be a valid WAV.
        with wave.open(io.BytesIO(wav_bytes), "r") as reader:
            assert reader.getnframes() > 0

    def test_wav_is_not_empty(self, client: TestClient) -> None:
        response = client.get("/v1/stimuli?contrast=r-l&limit=1")
        assert response.status_code == 200

        item = response.json()[0]
        wav_bytes = base64.b64decode(item["wavBase64"])
        assert len(wav_bytes) > 44, "WAV must contain more than just a header"

    def test_context_filter_word_initial(self, client: TestClient) -> None:
        response = client.get("/v1/stimuli?contrast=r-l&context=word-initial")
        assert response.status_code == 200

        for item in response.json():
            assert item["metadata"]["context"] == "word-initial"

    def test_context_filter_cluster(self, client: TestClient) -> None:
        response = client.get("/v1/stimuli?contrast=r-l&context=cluster")
        assert response.status_code == 200

        for item in response.json():
            assert item["metadata"]["context"] == "cluster"

    def test_different_contrasts_return_different_words(self, client: TestClient) -> None:
        rl_response = client.get("/v1/stimuli?contrast=r-l&limit=50")
        aeah_response = client.get("/v1/stimuli?contrast=ae-ah&limit=50")

        assert rl_response.status_code == 200
        assert aeah_response.status_code == 200

        rl_words = {item["metadata"]["word"] for item in rl_response.json()}
        aeah_words = {item["metadata"]["word"] for item in aeah_response.json()}

        # The two contrasts must have different word sets.
        assert rl_words != aeah_words, (
            "Different contrasts must serve different words; "
            "this would indicate a fixed dummy set"
        )

    def test_404_for_unknown_contrast(self, client: TestClient) -> None:
        response = client.get("/v1/stimuli?contrast=xx-yy")
        assert response.status_code == 404

    def test_422_for_invalid_context(self, client: TestClient) -> None:
        response = client.get("/v1/stimuli?contrast=r-l&context=invalid-ctx")
        assert response.status_code == 422

    def test_limit_respected(self, client: TestClient) -> None:
        response = client.get("/v1/stimuli?contrast=r-l&limit=2")
        assert response.status_code == 200
        assert len(response.json()) <= 2

    def test_license_is_not_cc_by_nc(self, client: TestClient) -> None:
        """REQ-NF-101: No CC BY-NC licensed stimuli may be served."""
        response = client.get("/v1/stimuli?contrast=r-l&limit=50")
        assert response.status_code == 200

        for item in response.json():
            license_id = item["metadata"]["licenseIdentifier"]
            assert "NC" not in license_id.upper(), (
                f"CC BY-NC license detected in served stimulus: {license_id}"
            )
