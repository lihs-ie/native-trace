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

# no-speech 番兵値。発話区間フレームが 0 件の場合に compute_speech_active_rms が返す。
# 呼び出し側はこの値（0.0）を検出して -100.0 dBFS などの番兵 dBFS に変換する。
NO_SPEECH_RMS_SENTINEL = 0.0


def _walk_frames(
    waveform_numpy: np.ndarray,
    frame_samples: int = ENERGY_FRAME_SAMPLES,
    silence_rms_threshold: float = ENERGY_SILENCE_RMS_THRESHOLD,
) -> tuple[list[np.ndarray], int]:
    """フレーム走査の共通実装。

    waveform_numpy を frame_samples フレームごとに RMS を計算し、
    silence_rms_threshold を超える（発話）フレームのサンプル列と
    発話フレーム総数を返す。

    Args:
        waveform_numpy: 1-D float32 配列（振幅 -1.0〜1.0 正規化済み）。
        frame_samples: 1 フレームのサンプル数。
        silence_rms_threshold: 無音判定 RMS 閾値。

    Returns:
        (speech_frame_samples, speech_frame_count):
            speech_frame_samples — 発話フレームのサンプル配列リスト。
            speech_frame_count — 発話フレームの総数（duration 計算用）。
    """
    speech_frame_samples: list[np.ndarray] = []
    speech_frame_count = 0

    for start in range(0, len(waveform_numpy), frame_samples):
        frame = waveform_numpy[start : start + frame_samples]
        rms = float(np.sqrt(np.mean(frame**2)))
        if rms > silence_rms_threshold:
            speech_frame_samples.append(frame)
            speech_frame_count += 1

    return speech_frame_samples, speech_frame_count


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
    _, speech_frame_count = _walk_frames(waveform_numpy, frame_samples, silence_rms_threshold)
    return speech_frame_count * frame_duration_seconds


def compute_speech_active_rms(
    waveform_numpy: np.ndarray,
    frame_samples: int = ENERGY_FRAME_SAMPLES,
    silence_rms_threshold: float = ENERGY_SILENCE_RMS_THRESHOLD,
) -> float:
    """発話区間フレームのみを対象とした RMS を計算する純関数。

    waveform_numpy を frame_samples フレームごとに RMS を計算し、
    silence_rms_threshold を超えるフレームを発話フレームとみなす。
    発話フレームに属するすべてのサンプルの二乗平均平方根（RMS）を返す。

    語間ポーズや末尾無音は除外されるため、全区間 RMS よりも真の発話ラウドネスを
    精度よく反映する（ADR-015 D1）。

    Args:
        waveform_numpy: 1-D float32 配列（振幅 -1.0〜1.0 正規化済み）。
        frame_samples: 1 フレームのサンプル数（デフォルト 320 = 20ms at 16kHz）。
        silence_rms_threshold: 無音判定 RMS 閾値（デフォルト ENERGY_SILENCE_RMS_THRESHOLD）。

    Returns:
        発話区間フレームの RMS（0.0 < rms <= 1.0 の範囲）。
        発話フレームが 0 件の場合は NO_SPEECH_RMS_SENTINEL（0.0）を返す。
        呼び出し側は戻り値が NO_SPEECH_RMS_SENTINEL（< 1e-9）のとき
        no-speech 番兵 dBFS（例: -100.0）を使用すること。
    """
    if len(waveform_numpy) == 0:
        return NO_SPEECH_RMS_SENTINEL

    speech_frame_samples, speech_frame_count = _walk_frames(
        waveform_numpy, frame_samples, silence_rms_threshold
    )
    if speech_frame_count == 0:
        return NO_SPEECH_RMS_SENTINEL

    all_speech_samples = np.concatenate(speech_frame_samples)
    return float(np.sqrt(np.mean(all_speech_samples**2)))
