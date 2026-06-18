"""compute_speech_active_rms の純関数ユニットテスト（ADR-015 D1）。

numpy 配列入力のみ。torch/soundfile/モデル不要。
合成波形（無音+トーン区間）で発話区間 RMS が全区間 RMS より大きく、
かつ無音量の変化に対して不変であることを assert する。

Done When (from spec):
  (a) loud frames + leading/trailing silence → speech-active RMS reflects the loud part,
      NOT diluted by silence.
  (b) all-silence input → no-speech sentinel (0.0).
  (c) silence-dilution property: same loud segment with more appended silence yields
      the SAME speech-active RMS (whole-file RMS would drop).
"""

import math

import numpy as np
import pytest

from python_analyzer.infrastructure.audio_energy import (
    ENERGY_SILENCE_RMS_THRESHOLD,
    NO_SPEECH_RMS_SENTINEL,
    compute_speech_active_rms,
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


class TestComputeSpeechActiveRms:
    """compute_speech_active_rms の単体テスト。"""

    # (b) all-silence input → no-speech sentinel
    def test_pure_silence_returns_no_speech_sentinel(self) -> None:
        """無音波形は NO_SPEECH_RMS_SENTINEL (0.0) を返す。"""
        silence = _make_silence(3.0)
        result = compute_speech_active_rms(silence)
        assert result == NO_SPEECH_RMS_SENTINEL
        assert result < 1e-9  # caller uses < 1e-9 to detect sentinel

    def test_empty_waveform_returns_no_speech_sentinel(self) -> None:
        """空配列は NO_SPEECH_RMS_SENTINEL (0.0) を返す。"""
        empty = np.array([], dtype=np.float32)
        result = compute_speech_active_rms(empty)
        assert result == NO_SPEECH_RMS_SENTINEL

    def test_very_quiet_tone_below_threshold_returns_sentinel(self) -> None:
        """RMS が閾値（0.01）を下回る極小振幅トーンは sentinel を返す。"""
        quiet_tone = _make_tone(2.0, amplitude=0.001)
        result = compute_speech_active_rms(quiet_tone)
        assert result < 1e-9, f"極小トーンが発話 RMS として誤検出された: {result}"

    # (a) loud frames + leading/trailing silence → speech-active RMS reflects the loud part
    def test_tone_with_silence_reflects_tone_rms(self) -> None:
        """前後の無音を含む波形で speech-active RMS がトーン区間の RMS を反映する。

        期待: speech_active_rms ≈ amplitude / sqrt(2)（正弦波の理論 RMS）
        """
        amplitude = 0.1
        tone = _make_tone(2.0, amplitude=amplitude)
        waveform = np.concatenate([_make_silence(0.5), tone, _make_silence(0.5)])

        result = compute_speech_active_rms(waveform)

        expected_rms = amplitude / math.sqrt(2.0)
        # 許容誤差: フレーム境界の端数で数 % の誤差が生じる
        assert result == pytest.approx(expected_rms, rel=0.05), (
            f"speech-active RMS={result:.5f}, expected≈{expected_rms:.5f}"
        )

    def test_speech_active_rms_is_greater_than_whole_file_rms(self) -> None:
        """発話区間 RMS は無音を含む全区間 RMS より大きい（無音希釈の除去）。

        (a) の直接検証: speech-active RMS > whole-file RMS when silence is present.
        """
        tone = _make_tone(1.0, amplitude=0.1)
        long_silence = _make_silence(4.0)  # 4x the tone duration
        waveform = np.concatenate([long_silence, tone, long_silence])

        whole_rms = float(np.sqrt(np.mean(waveform**2)))
        speech_active = compute_speech_active_rms(waveform)

        assert speech_active > whole_rms, (
            f"speech_active_rms={speech_active:.5f} should exceed whole_rms={whole_rms:.5f}"
        )
        # Must be significantly larger (silence dilutes whole-file RMS substantially)
        assert speech_active > whole_rms * 2.0, (
            f"speech-active RMS not sufficiently larger than whole-file RMS"
        )

    # (c) silence-dilution property: appending more silence does NOT change speech-active RMS
    def test_appending_silence_does_not_change_speech_active_rms(self) -> None:
        """同一発話区間に無音を追加しても speech-active RMS は変わらない。

        (c) silence-dilution property: the invariance that whole-file RMS lacks.
        """
        tone = _make_tone(1.0, amplitude=0.1)

        short_silence = _make_silence(0.1)
        long_silence = _make_silence(3.0)

        waveform_short = np.concatenate([short_silence, tone, short_silence])
        waveform_long = np.concatenate([long_silence, tone, long_silence])

        rms_short = compute_speech_active_rms(waveform_short)
        rms_long = compute_speech_active_rms(waveform_long)

        assert rms_short == pytest.approx(rms_long, rel=1e-4), (
            f"speech-active RMS changed with added silence: short={rms_short:.6f}, long={rms_long:.6f}"
        )

        # Also confirm that whole-file RMS DOES change (to show the property is meaningful)
        whole_short = float(np.sqrt(np.mean(waveform_short**2)))
        whole_long = float(np.sqrt(np.mean(waveform_long**2)))
        assert whole_long < whole_short * 0.8, (
            "Whole-file RMS should drop significantly with added silence (test setup check)"
        )

    def test_pure_tone_rms_matches_theory(self) -> None:
        """無音なしの純粋トーンは理論 RMS（amplitude/sqrt(2)）に一致する。"""
        amplitude = 0.2
        tone = _make_tone(2.0, amplitude=amplitude)
        result = compute_speech_active_rms(tone)
        expected_rms = amplitude / math.sqrt(2.0)
        assert result == pytest.approx(expected_rms, rel=0.05)

    def test_result_is_deterministic(self) -> None:
        """同一入力で同一出力を返す（純関数）。"""
        waveform = np.concatenate([_make_silence(0.3), _make_tone(1.0), _make_silence(0.3)])
        result1 = compute_speech_active_rms(waveform)
        result2 = compute_speech_active_rms(waveform)
        assert result1 == pytest.approx(result2, abs=1e-9)

    def test_result_is_within_valid_rms_range(self) -> None:
        """発話区間 RMS は (0, 1] の範囲内（float32 振幅 -1.0〜1.0 のため）。"""
        waveform = np.concatenate([_make_silence(0.5), _make_tone(1.0, amplitude=0.3)])
        result = compute_speech_active_rms(waveform)
        assert 0.0 < result <= 1.0

    def test_sentinel_maps_to_no_speech_dbfs_via_caller_convention(self) -> None:
        """呼び出し側規約: sentinel (< 1e-9) → -100.0 dBFS の変換が正しく動作する。

        measure_audio_quality の実装パターンを模倣して検証する。
        """
        silence = _make_silence(2.0)
        speech_active_rms = compute_speech_active_rms(silence)

        # Caller convention (mirroring wav2vec2_aligner.py measure_audio_quality)
        if speech_active_rms < 1e-9:
            mean_dbfs = -100.0
        else:
            mean_dbfs = 20.0 * math.log10(speech_active_rms)

        assert mean_dbfs == -100.0

    def test_threshold_constant_is_reachable(self) -> None:
        """ENERGY_SILENCE_RMS_THRESHOLD が公開されており値が期待通り。

        WARN-5: sentinel path が孤立していないことを確認する。
        """
        assert ENERGY_SILENCE_RMS_THRESHOLD == pytest.approx(0.01)

    def test_no_speech_sentinel_constant_value(self) -> None:
        """NO_SPEECH_RMS_SENTINEL が 0.0 であることを確認（呼び出し側の < 1e-9 判定と一致）。"""
        assert NO_SPEECH_RMS_SENTINEL == 0.0
        assert NO_SPEECH_RMS_SENTINEL < 1e-9
