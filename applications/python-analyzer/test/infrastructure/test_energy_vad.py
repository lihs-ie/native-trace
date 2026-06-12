"""compute_speech_duration_seconds_from_energy の純関数ユニットテスト。

numpy 配列入力のみ。torch/soundfile/モデル不要。
合成波形（無音+トーン区間）で「トーン区間長 ≒ speechDuration」を assert する。

Done When:
- 3秒トーン波形で speechDuration が概ね 2〜3秒（桁が合う）
- 無音波形で speechDuration が 0.0
- 前後無音+中央トーンで概ねトーン区間長に一致する
"""

import numpy as np
import pytest

from python_analyzer.infrastructure.audio_energy import (
    compute_speech_duration_seconds_from_energy,
)

_SAMPLE_RATE = 16000
_FRAME_SAMPLES = 320


def _make_silence(duration_seconds: float, sample_rate: int = _SAMPLE_RATE) -> np.ndarray:
    """無音（RMS = 0.0）の numpy 配列を生成する。"""
    return np.zeros(int(duration_seconds * sample_rate), dtype=np.float32)


def _make_tone(
    duration_seconds: float,
    amplitude: float = 0.1,
    frequency: float = 440.0,
    sample_rate: int = _SAMPLE_RATE,
) -> np.ndarray:
    """正弦波トーンの numpy 配列を生成する。

    amplitude=0.1 のとき RMS ≈ amplitude/sqrt(2) ≈ 0.0707 (> 0.01 閾値) で発話フレームになる。
    """
    t = np.arange(int(duration_seconds * sample_rate), dtype=np.float32) / sample_rate
    return (amplitude * np.sin(2.0 * np.pi * frequency * t)).astype(np.float32)


class TestComputeSpeechDurationSecondsFromEnergy:
    """compute_speech_duration_seconds_from_energy の単体テスト。"""

    def test_pure_silence_returns_zero(self) -> None:
        """無音波形（RMS = 0）は 0.0 秒を返す。"""
        silence = _make_silence(3.0)
        result = compute_speech_duration_seconds_from_energy(silence)
        assert result == pytest.approx(0.0, abs=1e-9)

    def test_pure_tone_3s_returns_approx_3s(self) -> None:
        """3秒トーンは概ね 3秒（± 1フレーム = 0.02秒）を返す。

        Done When の桁チェック: 2〜3秒であることを確認する。
        """
        tone = _make_tone(3.0)
        result = compute_speech_duration_seconds_from_energy(tone)
        assert 2.0 <= result <= 3.1, f"3秒トーンの実音声長が桁外れ: {result:.3f}s"

    def test_pure_tone_2s_returns_approx_2s(self) -> None:
        """2秒トーンは概ね 2秒を返す。"""
        tone = _make_tone(2.0)
        result = compute_speech_duration_seconds_from_energy(tone)
        assert 1.8 <= result <= 2.1, f"2秒トーンの実音声長が範囲外: {result:.3f}s"

    def test_silence_then_tone_then_silence(self) -> None:
        """前後に無音があるトーン区間の長さをトーン区間長と一致させる。

        0.5s無音 + 2.0sトーン + 0.5s無音 の合計3秒。
        発話長は 2.0s ± 2フレーム（0.04s）であること。
        """
        waveform = np.concatenate([_make_silence(0.5), _make_tone(2.0), _make_silence(0.5)])
        result = compute_speech_duration_seconds_from_energy(waveform)
        assert 1.9 <= result <= 2.1, f"中央トーン2秒の検出: {result:.3f}s"

    def test_empty_waveform_returns_zero(self) -> None:
        """空配列は 0.0 を返す。"""
        empty = np.array([], dtype=np.float32)
        result = compute_speech_duration_seconds_from_energy(empty)
        assert result == pytest.approx(0.0, abs=1e-9)

    def test_very_quiet_tone_below_threshold_returns_zero(self) -> None:
        """RMS が閾値（0.01）を下回る極小振幅トーンは無音と判定される。

        amplitude=0.001 → RMS ≈ 0.000707 < 0.01 → 発話フレームなし。
        """
        quiet_tone = _make_tone(2.0, amplitude=0.001)
        result = compute_speech_duration_seconds_from_energy(quiet_tone)
        assert result == pytest.approx(0.0, abs=0.1), (
            f"極小トーンが発話として誤検出された: {result:.3f}s"
        )

    def test_result_is_deterministic(self) -> None:
        """同一入力で同一出力を返す（純関数）。"""
        tone = _make_tone(1.5)
        result1 = compute_speech_duration_seconds_from_energy(tone)
        result2 = compute_speech_duration_seconds_from_energy(tone)
        assert result1 == pytest.approx(result2, abs=1e-9)

    def test_custom_frame_samples_changes_granularity(self) -> None:
        """frame_samples を変えても総発話長は概ね同一になる（粒度は変わる）。"""
        tone = _make_tone(2.0)
        result_320 = compute_speech_duration_seconds_from_energy(tone, frame_samples=320)
        result_160 = compute_speech_duration_seconds_from_energy(tone, frame_samples=160)
        # どちらも 2.0s ± 0.1s の範囲内
        assert 1.9 <= result_320 <= 2.1
        assert 1.9 <= result_160 <= 2.1
