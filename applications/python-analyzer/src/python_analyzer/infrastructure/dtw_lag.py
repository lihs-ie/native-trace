"""DTW（Dynamic Time Warping）による音素境界ラグ計測インフラ実装（ADR-013）。

scipy.spatial.distance と numpy を使用。wav2vec2 aligner の音素境界列を
DTW で対応づけ、per-segment lag 列と中央値 lag を算出する。

アルゴリズム概要:
  1. reference_audio + learner_audio の両方を wav2vec2 forced_align で音素境界列を取得する。
  2. 各音素の開始時刻（ms）を特徴量として DTW で対応づける。
  3. 対応ペアの開始時刻差（learner - reference）を per-segment lag とする。
  4. 集約 lag は外れ値ロバストな中央値（np.median）を使用する（ADR-013）。
  5. DTW の局所制約（step pattern）で挿入/脱落による整列崩れを緩和する。
"""

import io
import logging
import wave

import numpy as np

from python_analyzer.domain.audio import AudioInput
from python_analyzer.domain.phoneme import AlignmentBoundary
from python_analyzer.domain.shadowing_lag import PhonemeSegmentLag, ShadowingLagMeasurement
from python_analyzer.infrastructure.audio_energy import (
    ENERGY_FRAME_SAMPLES,
    ENERGY_SILENCE_RMS_THRESHOLD,
    TARGET_SAMPLE_RATE,
    compute_speech_duration_seconds_from_energy,
)

logger = logging.getLogger(__name__)

# DTW 局所制約（step_pattern）のウィンドウ幅（音素数）。
# 挿入/脱落が多い場合でも整列が崩れにくくするために適度に広くとる。
_DTW_SAKOE_CHIBA_BAND = 10

# wave モジュールで WAV ヘッダー解析可能とみなす MIME タイプ集合（infra 層内部専用）。
# usecase.ports.WAV_MIME_TYPES と同一値（W41: 層をまたぐ import を避けるため複製）。
_WAV_MIME_TYPES: frozenset[str] = frozenset({"audio/wav", "audio/x-wav", "audio/wave"})


def compute_lag(
    reference_boundaries: tuple[AlignmentBoundary, ...],
    learner_boundaries: tuple[AlignmentBoundary, ...],
    reference_waveform: np.ndarray | None = None,
    learner_waveform: np.ndarray | None = None,
) -> ShadowingLagMeasurement:
    """DTW で音素境界列を対応づけてシャドーイングラグを計測する。

    Args:
        reference_boundaries: お手本音声の音素境界列（wav2vec2 forced_align 結果）。
        learner_boundaries: 学習者音声の音素境界列（wav2vec2 forced_align 結果）。
        reference_waveform: お手本の 16kHz モノ float32 waveform（VAD 計測用）。None 可。
        learner_waveform: 学習者の 16kHz モノ float32 waveform（VAD 計測用）。None 可。

    Returns:
        ShadowingLagMeasurement。境界列が空の場合は lag_milliseconds=0.0 を返す。
    """
    if not reference_boundaries or not learner_boundaries:
        logger.warning("音素境界が空: ラグを 0.0 ms として返す")
        return ShadowingLagMeasurement(
            lag_milliseconds=0.0,
            per_segment_lag=(),
            speech_rate_ratio=_compute_speech_rate_ratio(reference_waveform, learner_waveform),
            pause_count_learner=_count_pauses(learner_waveform),
            pause_count_reference=_count_pauses(reference_waveform),
        )

    # 音素開始時刻（ms）を 1-D 配列として抽出する
    reference_starts = np.array(
        [b.start_milliseconds for b in reference_boundaries], dtype=np.float64
    )
    learner_starts = np.array([b.start_milliseconds for b in learner_boundaries], dtype=np.float64)

    # DTW でインデックス対応を求める
    reference_indices, learner_indices = _dtw_align(reference_starts, learner_starts)

    # per-segment lag を計算する（learner 開始時刻 - reference 開始時刻）
    per_segment_lag: list[PhonemeSegmentLag] = []
    for reference_index, learner_index in zip(reference_indices, learner_indices, strict=False):
        ref_boundary = reference_boundaries[reference_index]
        learner_boundary = learner_boundaries[learner_index]
        lag_ms = float(learner_boundary.start_milliseconds - ref_boundary.start_milliseconds)
        per_segment_lag.append(
            PhonemeSegmentLag(
                phoneme=ref_boundary.phoneme.value,
                lag_milliseconds=lag_ms,
            )
        )

    # 集約 lag は外れ値ロバストな中央値
    lag_values = np.array([s.lag_milliseconds for s in per_segment_lag], dtype=np.float64)
    aggregate_lag = float(np.median(lag_values)) if len(lag_values) > 0 else 0.0

    return ShadowingLagMeasurement(
        lag_milliseconds=aggregate_lag,
        per_segment_lag=tuple(per_segment_lag),
        speech_rate_ratio=_compute_speech_rate_ratio(reference_waveform, learner_waveform),
        pause_count_learner=_count_pauses(learner_waveform),
        pause_count_reference=_count_pauses(reference_waveform),
    )


class DtwLagComputer:
    """usecase.ports.LagComputationPort の実装（ADR-013 / W41 依存逆転）。

    AudioInput から waveform を抽出し（numpy 変換は本クラス内部の責務）、
    音素境界列と合わせて compute_lag に委譲する。
    """

    def compute(
        self,
        reference_boundaries: tuple[AlignmentBoundary, ...],
        learner_boundaries: tuple[AlignmentBoundary, ...],
        reference_audio: AudioInput,
        learner_audio: AudioInput,
    ) -> ShadowingLagMeasurement:
        """音素境界列と音声から DTW でシャドーイングラグを計測する。"""
        reference_waveform = _load_waveform_numpy(reference_audio)
        learner_waveform = _load_waveform_numpy(learner_audio)

        return compute_lag(
            reference_boundaries=reference_boundaries,
            learner_boundaries=learner_boundaries,
            reference_waveform=reference_waveform,
            learner_waveform=learner_waveform,
        )


def _load_waveform_numpy(audio: AudioInput) -> np.ndarray | None:
    """AudioInput の WAV バイト列から 16kHz モノラル float32 numpy 配列を取得する。

    WAV 形式以外または読み込み失敗時は None を返す（VAD はスキップ）。
    soundfile / torch は使わず wave モジュールのみで読む（VAD は純 numpy）。

    W41: usecase/compute_shadowing_lag.py から移設（numpy import ごと）。
    """
    mime_normalized = audio.mime_type.split(";")[0].strip().lower()
    if mime_normalized not in _WAV_MIME_TYPES:
        return None

    try:
        with wave.open(io.BytesIO(audio.content)) as wav_file:
            n_channels = wav_file.getnchannels()
            sample_width = wav_file.getsampwidth()
            n_frames = wav_file.getnframes()
            raw_bytes = wav_file.readframes(n_frames)

        # PCM サンプルを float32 に変換する
        if sample_width == 2:
            samples = np.frombuffer(raw_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        elif sample_width == 1:
            samples = (np.frombuffer(raw_bytes, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
        else:
            return None

        # ステレオをモノラルに変換する
        if n_channels > 1:
            samples = samples.reshape(-1, n_channels).mean(axis=1)

        return samples
    except Exception:
        return None


def _dtw_align(
    reference_sequence: np.ndarray,
    learner_sequence: np.ndarray,
) -> tuple[list[int], list[int]]:
    """DTW で 2 つの 1-D 時刻列を対応づけてインデックスペアリストを返す。

    Sakoe-Chiba バンド制約を適用して挿入/脱落による整列崩れを緩和する。
    O(N*M) dp テーブルを構築し、最適経路をバックトラックする。

    Returns:
        (reference_indices, learner_indices): 対応インデックスのリスト。
    """
    n = len(reference_sequence)
    m = len(learner_sequence)

    # コスト行列を構築する（絶対値差）
    inf = np.inf
    dp = np.full((n + 1, m + 1), inf)
    dp[0, 0] = 0.0

    band = _DTW_SAKOE_CHIBA_BAND

    for i in range(1, n + 1):
        # Sakoe-Chiba バンド: |i - j| <= band
        j_start = max(1, i - band)
        j_end = min(m, i + band)
        for j in range(j_start, j_end + 1):
            cost = abs(reference_sequence[i - 1] - learner_sequence[j - 1])
            dp[i, j] = cost + min(dp[i - 1, j], dp[i, j - 1], dp[i - 1, j - 1])

    # バックトラックして対応インデックスを取得する
    reference_indices: list[int] = []
    learner_indices: list[int] = []

    i, j = n, m
    while i > 0 and j > 0:
        reference_indices.append(i - 1)
        learner_indices.append(j - 1)
        min_prev = min(dp[i - 1, j], dp[i, j - 1], dp[i - 1, j - 1])
        if dp[i - 1, j - 1] == min_prev:
            i -= 1
            j -= 1
        elif dp[i - 1, j] == min_prev:
            i -= 1
        else:
            j -= 1

    reference_indices.reverse()
    learner_indices.reverse()

    return reference_indices, learner_indices


def _compute_speech_rate_ratio(
    reference_waveform: np.ndarray | None,
    learner_waveform: np.ndarray | None,
) -> float | None:
    """VAD 発話長から話速比（学習者 / お手本）を計算する。

    どちらかが None または 0 の場合は None を返す。
    """
    if reference_waveform is None or learner_waveform is None:
        return None
    reference_duration = compute_speech_duration_seconds_from_energy(
        reference_waveform,
        sample_rate=TARGET_SAMPLE_RATE,
        frame_samples=ENERGY_FRAME_SAMPLES,
        silence_rms_threshold=ENERGY_SILENCE_RMS_THRESHOLD,
    )
    learner_duration = compute_speech_duration_seconds_from_energy(
        learner_waveform,
        sample_rate=TARGET_SAMPLE_RATE,
        frame_samples=ENERGY_FRAME_SAMPLES,
        silence_rms_threshold=ENERGY_SILENCE_RMS_THRESHOLD,
    )
    if reference_duration <= 0.0:
        return None
    return learner_duration / reference_duration


def _count_pauses(waveform: np.ndarray | None) -> int | None:
    """VAD で無音区間（ポーズ）の数をカウントする。

    無音→有音の立ち上がり回数から推定する。
    waveform が None の場合は None を返す。
    """
    if waveform is None:
        return None

    frame_samples = ENERGY_FRAME_SAMPLES
    threshold = ENERGY_SILENCE_RMS_THRESHOLD

    is_speech_frames: list[bool] = []
    for start in range(0, len(waveform), frame_samples):
        frame = waveform[start : start + frame_samples]
        rms = float(np.sqrt(np.mean(frame**2)))
        is_speech_frames.append(rms > threshold)

    # 有音→無音→有音 の遷移回数をカウントする
    pause_count = 0
    in_pause = False
    for is_speech in is_speech_frames:
        if not is_speech and not in_pause:
            in_pause = True
        elif is_speech and in_pause:
            in_pause = False
            pause_count += 1

    return pause_count
