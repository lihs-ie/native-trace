"""F0 連続性品質ゲート実装（M-GRV-3）。

librosa（ISC） + numpy（BSD-3）を使用。
parselmouth（GPL-3.0）は使用しない（license-clean, ADR-012）。

F0 を pyin アルゴリズム（librosa）で抽出し、ピッチ崩壊（非連続 / 0 化）の割合が
GOLDEN_QUALITY_THRESHOLD env で指定した閾値を超えた場合に withhold する（M-GRV-3）。

QualityGatePort プロトコルを満たす。
"""

import io
import logging
import os
import wave

import librosa
import numpy as np

logger = logging.getLogger(__name__)

# 環境変数からピッチ崩壊許容割合の閾値を読む（domain literal 禁止 — M-GRV-3）
# GOLDEN_QUALITY_THRESHOLD: 0.0–1.0、この割合を超えるフレームが unvoiced なら withhold
_DEFAULT_QUALITY_THRESHOLD = 0.5


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


class F0ContinuityQualityGate:
    """F0 連続性に基づく品質ゲート（M-GRV-3）。

    librosa の pyin アルゴリズムで F0 を抽出し、
    voiced フレーム数 / 全フレーム数 が GOLDEN_QUALITY_THRESHOLD を下回れば
    品質ゲート不通過とする。

    使用ライブラリ: librosa（ISC license）/ numpy（BSD-3-Clause）— license-clean。
    """

    def check(self, audio_bytes: bytes) -> tuple[bool, str | None]:
        """F0 連続性品質ゲートを評価する。

        Args:
            audio_bytes: 変換済み WAV バイト列。

        Returns:
            (passed, withhold_reason):
              passed=True なら withhold_reason=None。
              passed=False なら withhold_reason="quality_gate_failed"。
        """
        threshold = _load_quality_threshold()

        try:
            waveform, sample_rate = _wav_bytes_to_float_array(audio_bytes)
        except ValueError as decode_error:
            logger.warning("Quality gate WAV decode failed: %s", decode_error)
            return False, "quality_gate_failed"

        # 無音または極端に短い音声は品質ゲート不通過とする
        if len(waveform) < sample_rate * 0.1:
            logger.info("Audio too short for quality gate (< 100ms)")
            return False, "quality_gate_failed"

        try:
            # librosa pyin: voiced/unvoiced フラグを返す（ISC license, license-clean）
            _f0, voiced_flag, _voiced_prob = librosa.pyin(
                waveform,
                fmin=float(librosa.note_to_hz("C2")),
                fmax=float(librosa.note_to_hz("C7")),
                sr=sample_rate,
            )
        except Exception as pyin_error:
            logger.warning("pyin F0 extraction failed: %s", pyin_error)
            return False, "quality_gate_failed"

        if voiced_flag is None or len(voiced_flag) == 0:
            logger.info("No voiced frames detected")
            return False, "quality_gate_failed"

        voiced_ratio = float(np.sum(voiced_flag)) / float(len(voiced_flag))
        logger.debug("voiced_ratio=%.3f, threshold=%.3f", voiced_ratio, threshold)

        # voiced_ratio が (1 - threshold) 以上なら通過
        # threshold は「unvoiced 許容割合」なので voiced < (1 - threshold) なら withhold
        if voiced_ratio < (1.0 - threshold):
            logger.info(
                "Quality gate failed: voiced_ratio=%.3f < %.3f",
                voiced_ratio,
                1.0 - threshold,
            )
            return False, "quality_gate_failed"

        return True, None
