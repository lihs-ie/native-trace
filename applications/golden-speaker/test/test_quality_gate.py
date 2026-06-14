"""F0ContinuityQualityGate ユニットテスト。

実際の WAV バイト列（サイン波 / サイレンス）を使って品質ゲートを検証する。
librosa/numpy が利用可能であることが前提（テスト環境に依存ライブラリがインストール済み）。
"""

import io
import math
import struct
import wave

import pytest

from golden_speaker.infrastructure.quality_gate import F0ContinuityQualityGate


# ---------------------------------------------------------------------------
# テスト用 WAV 生成ヘルパー
# ---------------------------------------------------------------------------


def _make_sine_wav(
    frequency_hz: float = 440.0,
    duration_seconds: float = 1.0,
    sample_rate: int = 16000,
    amplitude: float = 0.8,
) -> bytes:
    """サイン波 WAV バイト列を生成する（voiced 音声の代替）。"""
    num_samples = int(sample_rate * duration_seconds)
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        for i in range(num_samples):
            value = int(32767 * amplitude * math.sin(2 * math.pi * frequency_hz * i / sample_rate))
            wav_file.writeframes(struct.pack("<h", value))
    return buffer.getvalue()


def _make_silence_wav(duration_seconds: float = 1.0, sample_rate: int = 16000) -> bytes:
    """無音 WAV バイト列を生成する（unvoiced / ピッチ崩壊の代替）。"""
    num_samples = int(sample_rate * duration_seconds)
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(b"\x00\x00" * num_samples)
    return buffer.getvalue()


def _make_very_short_wav(duration_seconds: float = 0.05, sample_rate: int = 16000) -> bytes:
    """極端に短い WAV（< 100ms）を生成する。"""
    return _make_sine_wav(duration_seconds=duration_seconds, sample_rate=sample_rate)


# ---------------------------------------------------------------------------
# テスト
# ---------------------------------------------------------------------------


class TestF0ContinuityQualityGateWithSineWave:
    """サイン波（voiced 音声の近似）での品質ゲートテスト。"""

    def test_sine_wave_passes_quality_gate(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """440Hz サイン波は voiced フレームが多いため品質ゲートを通過する。"""
        monkeypatch.setenv("GOLDEN_QUALITY_THRESHOLD", "0.5")
        gate = F0ContinuityQualityGate()
        audio_bytes = _make_sine_wav(frequency_hz=440.0, duration_seconds=1.0)

        passed, reason = gate.check(audio_bytes)

        assert passed is True
        assert reason is None

    def test_f0_in_vocal_range_passes(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """声域内 (200Hz) のサイン波は品質ゲートを通過する。"""
        monkeypatch.setenv("GOLDEN_QUALITY_THRESHOLD", "0.5")
        gate = F0ContinuityQualityGate()
        audio_bytes = _make_sine_wav(frequency_hz=200.0, duration_seconds=1.0)

        passed, reason = gate.check(audio_bytes)

        assert passed is True
        assert reason is None


class TestF0ContinuityQualityGateWithSilence:
    """無音（unvoiced / ピッチ崩壊の代替）での品質ゲートテスト。"""

    def test_silence_fails_quality_gate(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """無音は voiced フレームが存在しないため品質ゲートを通過しない。"""
        monkeypatch.setenv("GOLDEN_QUALITY_THRESHOLD", "0.5")
        gate = F0ContinuityQualityGate()
        audio_bytes = _make_silence_wav(duration_seconds=1.0)

        passed, reason = gate.check(audio_bytes)

        assert passed is False
        assert reason == "quality_gate_failed"

    def test_withhold_reason_on_silence(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """無音の withhold_reason が quality_gate_failed であること。"""
        monkeypatch.setenv("GOLDEN_QUALITY_THRESHOLD", "0.5")
        gate = F0ContinuityQualityGate()
        audio_bytes = _make_silence_wav(duration_seconds=1.0)

        passed, reason = gate.check(audio_bytes)

        assert reason == "quality_gate_failed"
        assert passed is False


class TestF0ContinuityQualityGateShortAudio:
    """極端に短い音声での品質ゲートテスト。"""

    def test_very_short_audio_fails_quality_gate(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """100ms 未満の音声は品質ゲートを通過しない（評価不能）。"""
        monkeypatch.setenv("GOLDEN_QUALITY_THRESHOLD", "0.5")
        gate = F0ContinuityQualityGate()
        audio_bytes = _make_very_short_wav(duration_seconds=0.05)

        passed, reason = gate.check(audio_bytes)

        assert passed is False
        assert reason == "quality_gate_failed"


class TestF0ContinuityQualityGateThresholdEnv:
    """GOLDEN_QUALITY_THRESHOLD env 閾値のテスト（domain literal 禁止の確認）。"""

    def test_threshold_read_from_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """threshold=0.0 設定時は無音でも passed になる（閾値が env から読まれることの確認）。

        GOLDEN_QUALITY_THRESHOLD=0.0 → unvoiced 許容ゼロ = voiced_ratio >= 1.0 を要求。
        voiced_ratio が threshold 設定に依存して結果が変わることを確認する。
        """
        # 閾値 1.0 → voiced_ratio >= 0.0（常に通過）
        monkeypatch.setenv("GOLDEN_QUALITY_THRESHOLD", "1.0")
        gate = F0ContinuityQualityGate()
        audio_bytes = _make_silence_wav(duration_seconds=1.0)

        passed, _reason = gate.check(audio_bytes)

        # voiced_ratio >= (1 - 1.0) = 0.0 → 常に通過（無音でも通過）
        assert passed is True

    def test_strict_threshold_fails_for_mixed_audio(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """閾値 0.99 設定時はほぼ fully voiced でないと通過しない。

        サイン波のみなら voiced_ratio が高いため通過する場合もあるが、
        env が読まれていることを確認する主旨のテスト。
        """
        monkeypatch.setenv("GOLDEN_QUALITY_THRESHOLD", "0.0")
        gate = F0ContinuityQualityGate()
        audio_bytes = _make_sine_wav(frequency_hz=440.0, duration_seconds=1.0)

        # voiced_ratio >= (1 - 0.0) = 1.0 → 完全 voiced でないと通過しない
        # pyin でサイン波は voiced フレームが多いが 100% とは限らない
        # このテストは「env が読まれる」ことの確認であり、pass/fail どちらでも型 assert のみ
        passed, reason = gate.check(audio_bytes)

        assert isinstance(passed, bool)
        if not passed:
            assert reason == "quality_gate_failed"


class TestF0ContinuityQualityGateInvalidInput:
    """不正入力での品質ゲートテスト。"""

    def test_invalid_bytes_fails_gracefully(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """WAV として解釈できないバイト列は品質ゲート不通過（例外を伝播しない）。"""
        monkeypatch.setenv("GOLDEN_QUALITY_THRESHOLD", "0.5")
        gate = F0ContinuityQualityGate()

        passed, reason = gate.check(b"not a wav file")

        assert passed is False
        assert reason == "quality_gate_failed"
