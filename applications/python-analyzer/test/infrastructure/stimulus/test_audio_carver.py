"""Tests for the WAV audio carving utilities.

Tests carve_word_segment, compute_rms, and passes_quality_filter using
synthetic WAV fixtures generated in memory.
"""

from __future__ import annotations

import io
import struct
import wave

import pytest

from python_analyzer.infrastructure.stimulus.audio_carver import (
    carve_word_segment,
    compute_rms,
    passes_quality_filter,
)


def _make_synthetic_wav(
    duration_seconds: float = 0.5,
    sample_rate: int = 16000,
    amplitude: float = 0.5,
    frequency_hz: float = 440.0,
) -> bytes:
    """Generate a synthetic sine-wave WAV for testing."""
    import math

    num_samples = int(duration_seconds * sample_rate)
    buffer = io.BytesIO()
    with wave.open(buffer, "w") as wav_writer:
        wav_writer.setnchannels(1)
        wav_writer.setsampwidth(2)  # 16-bit
        wav_writer.setframerate(sample_rate)
        pcm_bytes = b""
        for i in range(num_samples):
            t = i / sample_rate
            value = int(amplitude * 32767 * math.sin(2 * math.pi * frequency_hz * t))
            pcm_bytes += struct.pack("<h", value)
        wav_writer.writeframes(pcm_bytes)
    return buffer.getvalue()


def _make_silent_wav(duration_seconds: float = 0.5, sample_rate: int = 16000) -> bytes:
    """Generate a silent WAV (all zeros)."""
    num_samples = int(duration_seconds * sample_rate)
    buffer = io.BytesIO()
    with wave.open(buffer, "w") as wav_writer:
        wav_writer.setnchannels(1)
        wav_writer.setsampwidth(2)
        wav_writer.setframerate(sample_rate)
        wav_writer.writeframes(b"\x00\x00" * num_samples)
    return buffer.getvalue()


class TestCarveWordSegment:
    """Tests for carve_word_segment."""

    def test_carves_middle_segment(self) -> None:
        source = _make_synthetic_wav(duration_seconds=1.0)
        carved = carve_word_segment(source, start_seconds=0.3, end_seconds=0.6)
        # Result should be a valid WAV.
        with wave.open(io.BytesIO(carved), "r") as reader:
            assert reader.getnframes() > 0
            assert reader.getframerate() == 16000

    def test_carves_from_start(self) -> None:
        source = _make_synthetic_wav(duration_seconds=1.0)
        carved = carve_word_segment(source, start_seconds=0.0, end_seconds=0.3)
        with wave.open(io.BytesIO(carved), "r") as reader:
            assert reader.getnframes() > 0

    def test_padding_does_not_exceed_file_bounds(self) -> None:
        source = _make_synthetic_wav(duration_seconds=0.5)
        # start_seconds near the beginning — padding should be clamped to 0.
        carved = carve_word_segment(
            source, start_seconds=0.0, end_seconds=0.2, padding_seconds=0.1
        )
        with wave.open(io.BytesIO(carved), "r") as reader:
            assert reader.getnframes() > 0

    def test_raises_for_inverted_range(self) -> None:
        source = _make_synthetic_wav(duration_seconds=1.0)
        with pytest.raises(ValueError):
            carve_word_segment(source, start_seconds=0.8, end_seconds=0.1)


class TestComputeRms:
    """Tests for compute_rms."""

    def test_sine_wave_rms_is_positive(self) -> None:
        wav = _make_synthetic_wav(amplitude=0.5)
        rms = compute_rms(wav)
        assert rms > 0.0

    def test_silent_wav_rms_is_zero(self) -> None:
        wav = _make_silent_wav()
        rms = compute_rms(wav)
        assert rms == pytest.approx(0.0)

    def test_amplitude_proportional(self) -> None:
        low_wav = _make_synthetic_wav(amplitude=0.1)
        high_wav = _make_synthetic_wav(amplitude=0.8)
        assert compute_rms(low_wav) < compute_rms(high_wav)

    def test_rms_bounded_zero_to_one(self) -> None:
        wav = _make_synthetic_wav(amplitude=1.0)
        rms = compute_rms(wav)
        assert 0.0 <= rms <= 1.0


class TestPassesQualityFilter:
    """Tests for passes_quality_filter."""

    def test_loud_segment_within_duration_passes(self) -> None:
        wav = _make_synthetic_wav(duration_seconds=0.3, amplitude=0.5)
        assert passes_quality_filter(wav, duration_seconds=0.3) is True

    def test_silent_segment_fails_rms(self) -> None:
        wav = _make_silent_wav(duration_seconds=0.3)
        assert passes_quality_filter(wav, duration_seconds=0.3) is False

    def test_too_short_fails(self) -> None:
        wav = _make_synthetic_wav(duration_seconds=0.05, amplitude=0.5)
        assert passes_quality_filter(wav, duration_seconds=0.05) is False

    def test_too_long_fails(self) -> None:
        wav = _make_synthetic_wav(duration_seconds=1.5, amplitude=0.5)
        assert passes_quality_filter(wav, duration_seconds=1.5) is False

    def test_minimum_duration_boundary(self) -> None:
        wav = _make_synthetic_wav(duration_seconds=0.08, amplitude=0.5)
        # Exactly at the minimum boundary — should pass.
        assert passes_quality_filter(wav, duration_seconds=0.08) is True

    def test_maximum_duration_boundary(self) -> None:
        wav = _make_synthetic_wav(duration_seconds=1.2, amplitude=0.5)
        # Exactly at the maximum boundary — should pass.
        assert passes_quality_filter(wav, duration_seconds=1.2) is True
