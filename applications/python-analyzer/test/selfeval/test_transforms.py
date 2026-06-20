"""純粋変換関数のユニットテスト（ネットワーク / アナライザ不要）。

numpy + scipy + soundfile のみに依存する変換ヘルパーを検証する。
アナライザや Docker は使用しない。

pytest でそのまま実行可能:
    pytest applications/python-analyzer/test/selfeval/test_transforms.py
"""

from __future__ import annotations

import numpy as np
import pytest

from test.selfeval.transforms import (
    LQAS_THRESHOLD_DBFS,
    add_pink_noise,
    compute_dbfs,
    scale_gain,
)

# ---------------------------------------------------------------------------
# テスト用ヘルパー
# ---------------------------------------------------------------------------


def _make_sine_wave(
    frequency: float = 440.0,
    duration_seconds: float = 1.0,
    sample_rate: int = 16000,
    amplitude: float = 0.3,
) -> np.ndarray:
    """テスト用サイン波を生成する（float32）。"""
    t = np.linspace(0, duration_seconds, int(sample_rate * duration_seconds), endpoint=False)
    return (amplitude * np.sin(2 * np.pi * frequency * t)).astype(np.float32)


def _measure_snr(signal: np.ndarray, noisy: np.ndarray) -> float:
    """SNR（dB）を計算する: 20 * log10(signal_rms / noise_rms)。"""
    noise = noisy - signal
    signal_rms = float(np.sqrt(np.mean(signal**2)))
    noise_rms = float(np.sqrt(np.mean(noise**2)))
    if noise_rms < 1e-12:
        return float("inf")
    return float(20.0 * np.log10(signal_rms / noise_rms))


# ---------------------------------------------------------------------------
# scale_gain テスト
# ---------------------------------------------------------------------------


class TestScaleGain:
    """scale_gain の単体テスト。"""

    def test_returns_scaled_waveform_and_dbfs(self) -> None:
        """スケール済み波形と dBFS の両方を返すこと。"""
        wav = _make_sine_wave(amplitude=0.3)
        scaled, measured_dbfs = scale_gain(wav, factor=1.0)
        assert isinstance(scaled, np.ndarray)
        assert isinstance(measured_dbfs, float)
        assert len(scaled) == len(wav)

    def test_scale_factor_halves_amplitude(self) -> None:
        """factor=0.5 で振幅が半分になること。"""
        wav = _make_sine_wave(amplitude=0.4)
        scaled, _ = scale_gain(wav, factor=0.5)
        assert abs(float(np.max(np.abs(scaled))) - float(np.max(np.abs(wav))) * 0.5) < 1e-4

    def test_scale_factor_doubles_amplitude(self) -> None:
        """factor=2.0 で振幅が 2 倍になること。"""
        wav = _make_sine_wave(amplitude=0.2)
        scaled, _ = scale_gain(wav, factor=2.0)
        assert abs(float(np.max(np.abs(scaled))) - float(np.max(np.abs(wav))) * 2.0) < 1e-4

    def test_dbfs_decreases_when_factor_less_than_one(self) -> None:
        """factor < 1.0 のとき dBFS が元より小さくなること。"""
        wav = _make_sine_wave(amplitude=0.3)
        _, base_dbfs = scale_gain(wav, factor=1.0)
        _, quiet_dbfs = scale_gain(wav, factor=0.5)
        assert quiet_dbfs < base_dbfs

    def test_dbfs_increases_when_factor_greater_than_one(self) -> None:
        """factor > 1.0 のとき dBFS が元より大きくなること。"""
        wav = _make_sine_wave(amplitude=0.1)
        _, base_dbfs = scale_gain(wav, factor=1.0)
        _, louder_dbfs = scale_gain(wav, factor=2.0)
        assert louder_dbfs > base_dbfs

    def test_dbfs_change_matches_expected_db(self) -> None:
        """factor=2.0 で dBFS が約 +6.02 dB 増加すること（20 * log10(2) ≈ 6.02）。"""
        wav = _make_sine_wave(amplitude=0.3)
        _, base_dbfs = scale_gain(wav, factor=1.0)
        _, louder_dbfs = scale_gain(wav, factor=2.0)
        delta = louder_dbfs - base_dbfs
        # 20 * log10(2) ≈ 6.02; 許容誤差 0.5 dB
        assert abs(delta - 6.02) < 0.5, f"期待 +6.02dB、実測 delta={delta:.3f}"

    def test_factor_half_reduces_by_six_db(self) -> None:
        """factor=0.5 で dBFS が約 -6.02 dB 減少すること。"""
        wav = _make_sine_wave(amplitude=0.3)
        _, base_dbfs = scale_gain(wav, factor=1.0)
        _, quiet_dbfs = scale_gain(wav, factor=0.5)
        delta = quiet_dbfs - base_dbfs
        assert abs(delta - (-6.02)) < 0.5, f"期待 -6.02dB、実測 delta={delta:.3f}"

    def test_lqas_window_stays_above_threshold_for_factor_half(self) -> None:
        """factor=0.5 でも LQAS 閾値（LQAS_THRESHOLD_DBFS）を上回ること（テスト前提確認）。"""
        # -15 dBFS 程度の入力をベースとする（スケール後 -21 dBFS; 閾値 -36 を超える）
        wav = _make_sine_wave(amplitude=0.18)
        _, measured_dbfs = scale_gain(wav, factor=0.5)
        # LQAS_THRESHOLD_DBFS（-36.0）を上回ること
        assert measured_dbfs > LQAS_THRESHOLD_DBFS, (
            f"LQAS window 外: measured={measured_dbfs:.1f} <= threshold={LQAS_THRESHOLD_DBFS}"
        )

    def test_waveform_length_unchanged(self) -> None:
        """スケーリング後も波形の長さが変わらないこと。"""
        wav = _make_sine_wave()
        scaled, _ = scale_gain(wav, factor=1.5)
        assert len(scaled) == len(wav)

    def test_identity_factor_returns_same_values(self) -> None:
        """factor=1.0 のとき元波形と数値的に同一であること。"""
        wav = _make_sine_wave(amplitude=0.2)
        scaled, _ = scale_gain(wav, factor=1.0)
        np.testing.assert_array_almost_equal(scaled, wav, decimal=6)


# ---------------------------------------------------------------------------
# add_pink_noise テスト
# ---------------------------------------------------------------------------


class TestAddPinkNoise:
    """add_pink_noise の単体テスト。"""

    def test_returns_same_length(self) -> None:
        """ノイズ加算後も波形の長さが変わらないこと。"""
        wav = _make_sine_wave()
        noisy = add_pink_noise(wav, target_snr_db=20.0)
        assert len(noisy) == len(wav)

    def test_returns_same_dtype(self) -> None:
        """入力と同じ dtype を返すこと。"""
        wav = _make_sine_wave().astype(np.float32)
        noisy = add_pink_noise(wav, target_snr_db=20.0)
        assert noisy.dtype == wav.dtype

    def test_snr_20db_within_tolerance(self) -> None:
        """SNR=20 dB のノイズを加算したとき、実測 SNR が目標値の ±3 dB 以内であること。"""
        wav = _make_sine_wave(amplitude=0.4, duration_seconds=2.0)
        noisy = add_pink_noise(wav, target_snr_db=20.0)
        measured_snr = _measure_snr(wav, noisy)
        assert abs(measured_snr - 20.0) < 3.0, (
            f"SNR target=20.0dB, measured={measured_snr:.2f}dB"
        )

    def test_snr_10db_within_tolerance(self) -> None:
        """SNR=10 dB のノイズを加算したとき、実測 SNR が目標値の ±3 dB 以内であること。"""
        wav = _make_sine_wave(amplitude=0.4, duration_seconds=2.0)
        noisy = add_pink_noise(wav, target_snr_db=10.0)
        measured_snr = _measure_snr(wav, noisy)
        assert abs(measured_snr - 10.0) < 3.0, (
            f"SNR target=10.0dB, measured={measured_snr:.2f}dB"
        )

    def test_snr_5db_within_tolerance(self) -> None:
        """SNR=5 dB のノイズを加算したとき、実測 SNR が目標値の ±4 dB 以内であること。"""
        wav = _make_sine_wave(amplitude=0.4, duration_seconds=2.0)
        noisy = add_pink_noise(wav, target_snr_db=5.0)
        measured_snr = _measure_snr(wav, noisy)
        assert abs(measured_snr - 5.0) < 4.0, (
            f"SNR target=5.0dB, measured={measured_snr:.2f}dB"
        )

    def test_lower_snr_means_more_noise(self) -> None:
        """SNR が低いほどノイズ量が多いこと（ノイズ RMS 単調増加）。"""
        wav = _make_sine_wave(amplitude=0.3, duration_seconds=2.0)
        noise_rms_list = []
        for snr_db in [20.0, 10.0, 5.0]:
            noisy = add_pink_noise(wav, target_snr_db=snr_db)
            noise = noisy - wav
            noise_rms_list.append(float(np.sqrt(np.mean(noise**2))))

        # SNR が下がるにつれてノイズ RMS が増加すること
        assert noise_rms_list[0] < noise_rms_list[1] < noise_rms_list[2], (
            f"SNR 20/10/5 に対してノイズ RMS が単調増加しない: {noise_rms_list}"
        )

    def test_deterministic_with_same_seed(self) -> None:
        """同じ入力に対して deterministic な出力を返すこと（seed=42 固定）。"""
        wav = _make_sine_wave(amplitude=0.3)
        noisy_1 = add_pink_noise(wav, target_snr_db=15.0)
        noisy_2 = add_pink_noise(wav, target_snr_db=15.0)
        np.testing.assert_array_equal(noisy_1, noisy_2)

    def test_noisy_differs_from_original(self) -> None:
        """ノイズ加算後は元波形と異なること。"""
        wav = _make_sine_wave(amplitude=0.3)
        noisy = add_pink_noise(wav, target_snr_db=10.0)
        assert not np.allclose(wav, noisy), "ノイズが加算されていない（元波形と同一）"


# ---------------------------------------------------------------------------
# compute_dbfs テスト
# ---------------------------------------------------------------------------


class TestComputeDbfs:
    """compute_dbfs の単体テスト。"""

    def test_returns_negative_value_for_non_silence(self) -> None:
        """非無音波形で負の dBFS 値を返すこと。"""
        wav = _make_sine_wave(amplitude=0.3)
        dbfs = compute_dbfs(wav)
        assert dbfs < 0.0

    def test_returns_sentinel_for_silence(self) -> None:
        """無音波形で -100.0 dBFS（番兵値）を返すこと。"""
        silence = np.zeros(16000, dtype=np.float32)
        dbfs = compute_dbfs(silence)
        assert dbfs == pytest.approx(-100.0, abs=0.1)

    def test_louder_signal_has_higher_dbfs(self) -> None:
        """振幅が大きい波形ほど高い dBFS を返すこと。"""
        wav_quiet = _make_sine_wave(amplitude=0.1)
        wav_loud = _make_sine_wave(amplitude=0.5)
        assert compute_dbfs(wav_quiet) < compute_dbfs(wav_loud)
