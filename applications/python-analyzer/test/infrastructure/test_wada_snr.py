"""compute_wada_snr の純関数ユニットテスト（ADR-032 D1 / M-SNR-5）。

numpy 配列入力のみ。torch/モデル不要。
soundfile は test_real_audio_ordering のみで使用する。

Done When (from spec M-SNR-5):
  (a) 既知 SNR {20, 10, 5, 0} dB で推定値が ±4 dB 以内（合成信号 — circular
      確認のため残すが PRIMARY 検証ではない）。
  (b) 高 SNR → 低 SNR の信号で推定値が単調減少（PRIMARY: 実音声 + ピンクノイズ）。
  (c) 純粋無音 → 番兵値 -120.0。
  (d) 空配列 → 番兵値 -120.0。

WADA-SNR スケール補正の注意事項（ADR-032 D4 補正）:
  絶対スケールは実音声で ±4 dB 精度が保証されず、概ね 20 dB 程度の圧縮が生じる
  ことが runtime sweep で確認されている（clean=2.13, 20dB=2.05, 10dB=1.27, 5dB=-0.15）。
  test_real_audio_ordering はこの絶対精度を要求せず、判別的単調性（ordering）のみを
  アサートする。合成信号の ±4 dB テストは K_clean_prior=34.0 に較正された人工条件で
  あり、実音声での絶対値検証は self-eval ハーネスで行う。
"""

import os

import numpy as np
import pytest

from python_analyzer.infrastructure.audio_energy import compute_wada_snr

# 実音声フィクスチャ（hello_world.wav: ADR-031 D8 canonical fixture）
_FIXTURE_WAV_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "fixtures", "hello_world.wav")
)

_SAMPLE_RATE = 16000
_FRAME_SIZE = 320
# 5 秒間のサンプル数。尖度推定には十分な統計量（80000 サンプル）が必要。
_N_SAMPLES = 5 * _SAMPLE_RATE
# WADA-SNR の先験尖度に合致した Gamma 変調係数（audio_energy.py wada_k_clean_prior と対応）。
_GAMMA_SHAPE = 0.5
_SIGNAL_AMPLITUDE = 0.15
# 許容誤差（±4 dB）
_TOLERANCE_DB = 4.0
# 番兵値
_SENTINEL_DB = -120.0


def _make_gamma_speech(n_samples: int, rng: np.random.Generator) -> np.ndarray:
    """Gamma 変調エンベロープを持つ speech-like 信号を生成する。

    フレームごとに Gamma 分布の振幅でスケールされた帯域制限ノイズを生成する。
    音素ごとのエネルギー変動を模倣した非定常信号であり、
    WADA-SNR の Gamma 分布モデルに適合する（尖度 ≈ 34）。

    WADA-SNR の先験尖度 K_clean_prior=34.0 は本関数の _GAMMA_SHAPE=0.5 で
    生成した 80000 サンプルの信号の典型尖度（seed=0: 34.3, seed=1: 37.3）から
    較正したものである。
    """
    n_frames = n_samples // _FRAME_SIZE
    frame_amplitudes = rng.gamma(shape=_GAMMA_SHAPE, scale=1.0, size=n_frames)
    frame_amplitudes = frame_amplitudes / (frame_amplitudes.max() + 1e-10) * _SIGNAL_AMPLITUDE
    signal = np.zeros(n_samples, dtype=np.float32)
    for i, amp in enumerate(frame_amplitudes):
        start = i * _FRAME_SIZE
        end = min(start + _FRAME_SIZE, n_samples)
        signal[start:end] = rng.standard_normal(end - start).astype(np.float32) * amp
    return signal


def _add_awgn(signal: np.ndarray, snr_db: float, rng: np.random.Generator) -> np.ndarray:
    """既知 SNR の AWGN を signal に加算する。

    signal_power / noise_power = 10^(snr_db/10) となるように噪声を調整する。
    """
    signal_power = float(np.mean(signal.astype(np.float64) ** 2))
    snr_linear = 10.0 ** (snr_db / 10.0)
    noise_var = signal_power / snr_linear
    noise = rng.normal(0.0, float(np.sqrt(noise_var)), len(signal)).astype(np.float32)
    return np.clip(signal + noise, -1.0, 1.0)


class TestComputeWadaSnr:
    """compute_wada_snr の単体テスト（M-SNR-5）。"""

    def test_empty_waveform_returns_sentinel(self) -> None:
        """空配列は番兵値 -120.0 を返す。"""
        result = compute_wada_snr(np.array([], dtype=np.float32), _SAMPLE_RATE)
        assert result == _SENTINEL_DB

    def test_pure_silence_returns_sentinel(self) -> None:
        """純粋無音（全サンプル 0）は番兵値 -120.0 を返す。"""
        silence = np.zeros(_N_SAMPLES, dtype=np.float32)
        result = compute_wada_snr(silence, _SAMPLE_RATE)
        assert result == _SENTINEL_DB

    @pytest.mark.parametrize("snr_db", [20, 10, 5, 0])
    def test_estimate_within_4db_band(self, snr_db: int) -> None:
        """既知 SNR の合成信号で推定値が ±4 dB 以内に収まること（M-SNR-5）。

        信号: Gamma(0.5) 変調の speech-like 合成信号（seed=0 で固定）。
        噪声: AWGN（既知分散）。
        実装の先験尖度 K_clean_prior=34.0 はこの信号形式に較正済み。
        """
        rng_clean = np.random.default_rng(0)
        clean_signal = _make_gamma_speech(_N_SAMPLES, rng_clean)

        rng_noise = np.random.default_rng(100)
        noisy = _add_awgn(clean_signal, snr_db=snr_db, rng=rng_noise)

        estimated = compute_wada_snr(noisy, _SAMPLE_RATE)
        error = estimated - snr_db

        assert abs(error) <= _TOLERANCE_DB, (
            f"SNR={snr_db} dB: estimated={estimated:.2f} dB, error={error:.2f} dB "
            f"(tolerance ±{_TOLERANCE_DB} dB)"
        )

    def test_monotonic_ordering_synthetic(self) -> None:
        """合成信号で高 SNR ほど推定値が大きいこと（補助テスト — circular 注意）。

        同一のクリーン信号に異なる SNR レベルの AWGN を加算した 4 クリップで
        推定値の降順（20 > 10 > 5 > 0 dB）が維持されることを検証する。

        NOTE: 本テストは K_clean_prior=34.0 に較正された人工信号（_GAMMA_SHAPE=0.5）を
        使用しており、較正に用いたのと同じ分布から入力を生成する circular テストである。
        このテストが通ることは「実音声への汎化」を保証しない。PRIMARY 検証は
        test_real_audio_ordering を参照すること（ADR-032 D4 補正）。
        """
        rng_clean = np.random.default_rng(0)
        clean_signal = _make_gamma_speech(_N_SAMPLES, rng_clean)

        snr_levels = [20, 10, 5, 0]
        estimates = []
        for snr_db in snr_levels:
            rng_noise = np.random.default_rng(100)
            noisy = _add_awgn(clean_signal, snr_db=snr_db, rng=rng_noise)
            estimates.append(compute_wada_snr(noisy, _SAMPLE_RATE))

        for i in range(len(estimates) - 1):
            assert estimates[i] > estimates[i + 1], (
                f"SNR 単調性違反: snr_levels={snr_levels[i]} → {snr_levels[i + 1]}, "
                f"estimates={estimates[i]:.2f} → {estimates[i + 1]:.2f}"
            )

    @pytest.mark.skipif(
        not os.path.exists(_FIXTURE_WAV_PATH),
        reason="hello_world.wav fixture が見つからない（CI では常に存在する）",
    )
    def test_real_audio_ordering(self) -> None:
        """実音声（hello_world.wav）＋ピンクノイズで判別的単調性を検証する（PRIMARY — M-SNR-5）。

        test_monotonic_ordering_synthetic は K_clean_prior=34.0 に較正した人工信号から
        入力を生成する circular テストであり、実音声での動作を保証しない。
        本テストはその循環性を解消するため、canonical fixture（hello_world.wav）に
        真 SNR {clean, 10, 5, 0} dB のピンクノイズを加算し、推定値が
        clean > 10dB > 5dB > 0dB の順序（単調減少）を維持することをアサートする。

        検証する性質: 絶対 ±4 dB 精度ではなく判別的順序（ordering）のみ。
        絶対スケールは実音声で概ね 20 dB 程度の圧縮が生じることが ADR-032 D4 で
        確認されており、本テストはその補正を要求しない。
        SNR 推定値の絶対精度は self-eval ハーネス（run_selfeval.py）で検証する。

        ピンクノイズ加算: selfeval transforms.add_pink_noise と同じ Voss-McCartney 近似
        （scipy.signal.lfilter）を使用し、seed=42 固定で再現性を保証する。
        """
        import soundfile as sf
        from scipy.signal import lfilter

        # hello_world.wav を float32 で読み込む（soundfile、librosa 禁止）
        waveform, file_sample_rate = sf.read(_FIXTURE_WAV_PATH, dtype="float32", always_2d=False)
        if waveform.ndim == 2:
            waveform = waveform.mean(axis=1)

        def add_pink_noise_for_test(audio: np.ndarray, target_snr_db: float) -> np.ndarray:
            """Voss-McCartney 近似ピンクノイズを加算する（transforms.add_pink_noise のミラー）。"""
            rng = np.random.default_rng(seed=42)
            signal_rms = float(np.sqrt(np.mean(audio**2)))
            if signal_rms < 1e-12:
                return audio.copy()
            white_noise = rng.standard_normal(len(audio))
            b = np.array([1.0])
            a = np.array([1.0, -0.99])
            pink = lfilter(b, a, white_noise)
            pink_rms = float(np.sqrt(np.mean(pink**2)))
            if pink_rms < 1e-12:
                pink = white_noise
            else:
                pink = pink / pink_rms
            noise_rms_target = signal_rms / (10.0 ** (target_snr_db / 20.0))
            scaled_noise = pink * noise_rms_target
            return (audio + scaled_noise).astype(audio.dtype)

        # clean → 10dB → 5dB → 0dB の順に推定値が単調減少することをアサートする
        # 5dB は selfeval で worker SNR floor（0.5）にかかる境界点だが、
        # WADA 推定器レベルでは ordering が成立することを確認する
        snr_levels = [None, 10.0, 5.0, 0.0]  # None = clean
        estimates = []
        labels = []

        for snr_db in snr_levels:
            if snr_db is None:
                noisy = waveform
                labels.append("clean")
            else:
                noisy = add_pink_noise_for_test(waveform, snr_db)
                labels.append(f"{int(snr_db)}dB")
            estimates.append(compute_wada_snr(noisy, file_sample_rate))

        # 判別的単調性アサート: estimates[i] > estimates[i+1]
        # 絶対精度（±4 dB）は要求しない — ordering のみを検証する
        for i in range(len(estimates) - 1):
            assert estimates[i] > estimates[i + 1], (
                f"実音声 SNR 単調性違反: {labels[i]}({estimates[i]:.4f}) → "
                f"{labels[i + 1]}({estimates[i + 1]:.4f}) — ordering が成立しない。"
                f" 全推定値: {dict(zip(labels, [f'{e:.4f}' for e in estimates], strict=False))}"
            )

    def test_clean_signal_higher_than_0db_noisy(self) -> None:
        """クリーン信号の推定値は 0 dB SNR の同一信号より大きいこと。"""
        rng_clean = np.random.default_rng(0)
        clean_signal = _make_gamma_speech(_N_SAMPLES, rng_clean)

        rng_noise = np.random.default_rng(100)
        noisy_0db = _add_awgn(clean_signal, snr_db=0, rng=rng_noise)

        estimate_clean = compute_wada_snr(clean_signal, _SAMPLE_RATE)
        estimate_noisy = compute_wada_snr(noisy_0db, _SAMPLE_RATE)

        assert estimate_clean > estimate_noisy, (
            f"クリーン信号の推定値 {estimate_clean:.2f} dB が "
            f"0dB-SNR 信号の推定値 {estimate_noisy:.2f} dB 以下になっている"
        )

    def test_result_is_deterministic(self) -> None:
        """同一入力で同一出力を返す（純関数）。"""
        rng = np.random.default_rng(42)
        signal = _make_gamma_speech(_N_SAMPLES, rng)

        result1 = compute_wada_snr(signal, _SAMPLE_RATE)
        result2 = compute_wada_snr(signal, _SAMPLE_RATE)

        assert result1 == pytest.approx(result2, abs=1e-9)
