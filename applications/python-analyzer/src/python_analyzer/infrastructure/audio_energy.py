"""エネルギーベース VAD による発話長計測の純関数モジュール。

numpy のみに依存し、soundfile/torch を一切 import しない。
ローカル環境（soundfile 不在）でもテスト可能とするために wav2vec2_aligner.py から分離する。
"""

import numpy as np

# ---- エネルギーベース VAD 定数（calibratable） ----

# エネルギーフレーム長（サンプル数）。20ms × 16000Hz = 320 サンプル。
ENERGY_FRAME_SAMPLES = 320
# 無音判定 RMS 閾値（振幅 0〜1 スケール）。この値以下のフレームは無音とみなす。
# calibratable threshold: 実録音 -25dB 台では RMS ≈ 0.056 なのでここより大きく検出される。
ENERGY_SILENCE_RMS_THRESHOLD = 0.01
# wav2vec2 が期待するサンプリングレート（Hz）。
TARGET_SAMPLE_RATE = 16000


def compute_speech_duration_seconds_from_energy(
    waveform_numpy: np.ndarray,
    sample_rate: int = TARGET_SAMPLE_RATE,
    frame_samples: int = ENERGY_FRAME_SAMPLES,
    silence_rms_threshold: float = ENERGY_SILENCE_RMS_THRESHOLD,
) -> float:
    """エネルギーベース VAD で実発話長（秒）を計算する純関数。

    waveform_numpy を frame_samples フレームごとに RMS を計算し、
    silence_rms_threshold を超えるフレームを発話フレームとみなして合計時間を返す。

    Args:
        waveform_numpy: 1-D float32 配列（振幅 -1.0〜1.0 正規化済み）。
        sample_rate: サンプリングレート（Hz）。
        frame_samples: 1 フレームのサンプル数。
        silence_rms_threshold: 無音判定 RMS 閾値。

    Returns:
        実発話長（秒）。無音のみの場合は 0.0 を返す。
    """
    if len(waveform_numpy) == 0:
        return 0.0

    frame_duration_seconds = frame_samples / sample_rate
    speech_frames = 0

    for start in range(0, len(waveform_numpy), frame_samples):
        frame = waveform_numpy[start : start + frame_samples]
        rms = float(np.sqrt(np.mean(frame**2)))
        if rms > silence_rms_threshold:
            speech_frames += 1

    return speech_frames * frame_duration_seconds
