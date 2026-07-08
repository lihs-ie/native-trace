"""F0 連続性品質ゲート実装（M-GRV-3 / OQ-1 確定設計）。

parselmouth（GPL-3.0, golden-speaker サービス内に隔離 — ADR-012改訂/ADR-006）を使用。
librosa / torch は使用しない。

【設計方針 — OQ-1 確定値】
品質ゲートは「変換後音声の F0 連続性（ピッチ崩壊割合）」のみを評価する。

  評価指標: 変換後音声の unvoiced フレーム割合
  閾値:    GOLDEN_QUALITY_THRESHOLD（env, 0.0–1.0, unvoiced 許容割合）
  通過条件: unvoiced_rate <= threshold
  不通過:   unvoiced_rate > threshold → withholdReason = "quality_gate_failed"

  デフォルト 0.5 = compose.yaml と一致（unvoiced が 50% 以下なら通過）。
  通常の有声音声は unvoiced 20–40% → 通過。
  F0 崩壊音声は unvoiced 80%+ → withhold。

【逆インセンティブ不在の根拠】
  - 入力音声を quality_gate.check() に渡さない（シグネチャが output のみ）。
  - 入出力の RMS 比・相互相関・類似度を評価しない。
  - 強変換出力（入力と周波数・音色が大きく異なる）でも、
    出力の有声フレーム比が十分なら通過する。
  - ピッチが女性方向に大きくシフトした出力も F0 が連続なら pass。

【入出力比較を使わない理由】
  入出力の類似度を評価すると「変換が弱いほど通過」という逆インセンティブが生じる
  （旧実装の設計バグ。M-GCF-4 で廃止）。

QualityGatePort プロトコルを満たす。
"""

import io
import logging
import os
import wave

import numpy as np

logger = logging.getLogger(__name__)

# unvoiced 許容割合の閾値を環境変数から読む（domain literal 禁止 — M-GRV-3）
# GOLDEN_QUALITY_THRESHOLD: 0.0–1.0。unvoiced フレーム割合がこの値以下なら通過。
# デフォルト 0.5 は compose.yaml の設定値と一致（50% unvoiced まで許容）。
_DEFAULT_QUALITY_THRESHOLD = 0.5

# F0 抽出の最小ピッチ（Hz）— 人声の下限（M-GRV-3）
_PITCH_FLOOR_HZ = 75.0

# F0 抽出の最大ピッチ（Hz）— 高域ノイズ回避（女性 p231 の F0 上限を十分超える）
_PITCH_CEILING_HZ = 600.0


def _load_quality_threshold() -> float:
    """GOLDEN_QUALITY_THRESHOLD env を読み込む。未設定時はデフォルト値を使用する。"""
    raw = os.environ.get("GOLDEN_QUALITY_THRESHOLD", str(_DEFAULT_QUALITY_THRESHOLD))
    try:
        value = float(raw)
    except ValueError:
        logger.warning(
            "GOLDEN_QUALITY_THRESHOLD=%r is not a float, using default %s",
            raw,
            _DEFAULT_QUALITY_THRESHOLD,
        )
        return _DEFAULT_QUALITY_THRESHOLD
    if not (0.0 <= value <= 1.0):
        logger.warning(
            "GOLDEN_QUALITY_THRESHOLD=%s is out of [0,1], clamping",
            value,
        )
        return max(0.0, min(1.0, value))
    return value


def _wav_bytes_to_float_array(audio_bytes: bytes) -> tuple[np.ndarray, int]:
    """WAV バイト列を float32 配列と sample_rate に変換する。

    Returns:
        (waveform_float32, sample_rate)
    Raises:
        ValueError: WAV として読み込めない場合。
    """
    try:
        with wave.open(io.BytesIO(audio_bytes)) as wav_file:
            n_channels = wav_file.getnchannels()
            sample_width = wav_file.getsampwidth()
            sample_rate = wav_file.getframerate()
            frames = wav_file.readframes(wav_file.getnframes())
    except Exception as wave_error:
        raise ValueError(f"WAV parse failed: {wave_error}") from wave_error

    if sample_width == 2:
        raw = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    elif sample_width == 4:
        raw = np.frombuffer(frames, dtype=np.int32).astype(np.float32) / 2147483648.0
    else:
        raise ValueError(f"Unsupported sample_width={sample_width}")

    if n_channels > 1:
        raw = raw.reshape(-1, n_channels).mean(axis=1)

    return raw, sample_rate


def _compute_unvoiced_rate_parselmouth(
    waveform: np.ndarray,
    sample_rate: int,
) -> float:
    """parselmouth で F0 フレームを抽出し unvoiced フレーム割合を計算する。

    parselmouth は rvc-python の transitive dep として golden-speaker イメージに入っている
    （ADR-012改訂/ADR-006: GPL-3.0 だが golden-speaker サービス境界内に隔離）。

    Returns:
        unvoiced_rate: 0.0–1.0（unvoiced フレームの割合）
    """
    try:
        import parselmouth  # noqa: PLC0415
    except ImportError:
        logger.warning("parselmouth not available; falling back to numpy autocorrelation F0")
        return _compute_unvoiced_rate_numpy(waveform, sample_rate)

    sound = parselmouth.Sound(waveform.astype(np.float64), sampling_frequency=sample_rate)
    pitch = sound.to_pitch(
        pitch_floor=_PITCH_FLOOR_HZ,
        pitch_ceiling=_PITCH_CEILING_HZ,
    )
    f0_values = pitch.selected_array["frequency"]

    if len(f0_values) == 0:
        logger.info("F0 extraction returned no frames (too short or silent)")
        return 1.0  # 全フレーム unvoiced として withhold

    n_unvoiced = int(np.sum(f0_values == 0.0))
    unvoiced_rate = n_unvoiced / len(f0_values)
    logger.debug(
        "F0 frames=%d, unvoiced=%d, unvoiced_rate=%.3f",
        len(f0_values),
        n_unvoiced,
        unvoiced_rate,
    )
    return unvoiced_rate


def _compute_unvoiced_rate_numpy(
    waveform: np.ndarray,
    sample_rate: int,
) -> float:
    """numpy autocorrelation による F0 推定で unvoiced フレーム割合を計算する。

    parselmouth が利用不可の場合のフォールバック。
    フレーム長 25ms / シフト 10ms でエネルギー基準の有声/無声判定を行う。

    Returns:
        unvoiced_rate: 0.0–1.0
    """
    frame_length = int(sample_rate * 0.025)  # 25ms
    hop_length = int(sample_rate * 0.010)  # 10ms

    if len(waveform) < frame_length:
        return 1.0

    # RMS エネルギーベースの有声/無声判定（簡易版）
    energy_threshold = 0.01  # -40dBFS 相当
    n_voiced = 0
    n_total = 0

    for start in range(0, len(waveform) - frame_length, hop_length):
        frame = waveform[start : start + frame_length]
        rms = float(np.sqrt(np.mean(frame**2)))
        if rms > energy_threshold:
            n_voiced += 1
        n_total += 1

    if n_total == 0:
        return 1.0

    return 1.0 - (n_voiced / n_total)


class F0ContinuityQualityGate:
    """F0 連続性品質ゲート（M-GRV-3 / OQ-1 確定設計）。

    変換後音声の unvoiced フレーム割合で「ピッチ崩壊」を検出する。
    入力音声との比較は一切行わない（逆インセンティブ除去 — M-GCF-4）。

    使用ライブラリ: parselmouth（GPL-3.0, golden-speaker 内隔離 — ADR-012改訂）
      + numpy（BSD-3-Clause）フォールバック。
    """

    def check(self, audio_bytes: bytes) -> tuple[bool, str | None]:
        """F0 連続性品質ゲートを評価する。

        変換後音声の unvoiced フレーム割合が GOLDEN_QUALITY_THRESHOLD 以下なら通過。
        通過条件: unvoiced_rate <= threshold（threshold = GOLDEN_QUALITY_THRESHOLD env）

        Args:
            audio_bytes: 変換済み WAV バイト列（入力音声は受け取らない — 逆インセンティブ除去）。

        Returns:
            (passed, withhold_reason):
              passed=True なら withhold_reason=None。
              passed=False なら withhold_reason="quality_gate_failed"。
        """
        unvoiced_threshold = _load_quality_threshold()

        try:
            waveform, sample_rate = _wav_bytes_to_float_array(audio_bytes)
        except ValueError as decode_error:
            logger.warning("Quality gate WAV decode failed: %s", decode_error)
            return False, "quality_gate_failed"

        # 極端に短い音声は F0 抽出不能として withhold
        if len(waveform) < sample_rate * 0.1:
            logger.info("Audio too short for F0 quality gate (< 100ms)")
            return False, "quality_gate_failed"

        # NaN / Inf チェック（RVC 推論崩壊の検出）
        if not np.all(np.isfinite(waveform)):
            logger.warning("Quality gate failed: output contains NaN or Inf")
            return False, "quality_gate_failed"

        # 完全無音チェック（F0 抽出前のガード）
        rms = float(np.sqrt(np.mean(waveform**2)))
        if rms < 1e-6:
            logger.info("Quality gate failed: output is completely silent (RMS=%.2e)", rms)
            return False, "quality_gate_failed"

        # F0 フレームの unvoiced 割合を計算する
        unvoiced_rate = _compute_unvoiced_rate_parselmouth(waveform, sample_rate)

        logger.debug(
            "F0 quality gate: unvoiced_rate=%.3f, threshold=%.3f",
            unvoiced_rate,
            unvoiced_threshold,
        )

        if unvoiced_rate > unvoiced_threshold:
            logger.info(
                "Quality gate failed: unvoiced_rate=%.3f > threshold=%.3f (F0 discontinuity)",
                unvoiced_rate,
                unvoiced_threshold,
            )
            return False, "quality_gate_failed"

        logger.debug(
            "Quality gate passed: unvoiced_rate=%.3f <= threshold=%.3f",
            unvoiced_rate,
            unvoiced_threshold,
        )
        return True, None
