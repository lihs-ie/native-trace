"""純関数オーディオ変換ヘルパー（ADR-031 D10 metamorphic floor 用）。

依存: numpy, scipy, soundfile のみ（librosa は使用禁止）。
本番コードへの import は禁止（test scope 専用モジュール）。

LQAS 閾値: meanDbfs < -36.0 dBFS で low_quality 判定（ADR-015 D1 / audioQualityMinMeanDbfs）。
閾値リテラルはここにハードコードせず LQAS_THRESHOLD_DBFS を参照する（calibratable 旨を明記）。
"""

from __future__ import annotations

import io
import json
import logging
from typing import TYPE_CHECKING

import numpy as np
import soundfile as sf
from scipy.signal import lfilter

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)

# --- calibratable しきい値 ---
# ADR-015 audioQualityMinMeanDbfs に対応する。
# 実機 Scoring.hs/worker の定数と合わせること（calibratable — 変更時は両側を更新）。
LQAS_THRESHOLD_DBFS: float = -36.0

# energy-VAD 用フレームサイズ（audio_energy.py と同じ定数）
_ENERGY_FRAME_SAMPLES: int = 320
_ENERGY_SILENCE_RMS_THRESHOLD: float = 0.01


# ---------------------------------------------------------------------------
# dBFS 計算（speech-active RMS、VAD 付き）
# ---------------------------------------------------------------------------


def _compute_speech_active_rms(waveform: np.ndarray) -> float:
    """発話区間フレームのみを対象とした RMS を計算する（audio_energy.py のミラー）。

    librosa を使わずに speech-active meanDbfs を再現する。
    発話フレームが 0 件の場合は 0.0（番兵値）を返す。
    """
    speech_frames: list[np.ndarray] = []
    for start in range(0, len(waveform), _ENERGY_FRAME_SAMPLES):
        frame = waveform[start : start + _ENERGY_FRAME_SAMPLES]
        rms = float(np.sqrt(np.mean(frame**2)))
        if rms > _ENERGY_SILENCE_RMS_THRESHOLD:
            speech_frames.append(frame)

    if not speech_frames:
        return 0.0

    all_samples = np.concatenate(speech_frames)
    return float(np.sqrt(np.mean(all_samples**2)))


def compute_dbfs(waveform: np.ndarray) -> float:
    """waveform の speech-active meanDbfs（dBFS）を計算して返す。

    発話フレームが 0 件（no-speech）の場合は -100.0 を返す（番兵値）。
    アナライザの compute_speech_active_rms と同じアルゴリズムを使用する。
    """
    rms = _compute_speech_active_rms(waveform)
    if rms < 1e-9:
        return -100.0
    return float(20.0 * np.log10(rms))


# ---------------------------------------------------------------------------
# scale_gain — 振幅スケーリング
# ---------------------------------------------------------------------------


def scale_gain(audio_array: np.ndarray, factor: float) -> tuple[np.ndarray, float]:
    """振幅を factor 倍してスケーリングした波形と、変換後の speech-active dBFS を返す。

    Args:
        audio_array: 1-D float32 配列（振幅 -1.0〜1.0 正規化済み）。
        factor: スケールファクター（例: 0.5 で -6 dBFS、2.0 で +6 dBFS）。

    Returns:
        (scaled_waveform, measured_dbfs):
            scaled_waveform: スケーリング後の波形。クリッピングはしない。
            measured_dbfs: スケーリング後の speech-active dBFS（送信前確認用）。
    """
    scaled = audio_array * factor
    measured_dbfs = compute_dbfs(scaled)
    return scaled, measured_dbfs


# ---------------------------------------------------------------------------
# add_pink_noise — ピンクノイズ加算
# ---------------------------------------------------------------------------


def _generate_pink_noise(length: int, rng: np.random.Generator) -> np.ndarray:
    """Voss-McCartney 近似で 1/f ピンクノイズを生成する（scipy.signal.lfilter 使用）。

    パワースペクトル密度が周波数に反比例（1/f）するノイズを生成する。
    white noise に AR(1) フィルタ（近似）を適用する簡易実装。

    Args:
        length: サンプル数。
        rng: numpy random Generator インスタンス（再現性のため外から渡す）。

    Returns:
        長さ length の float64 配列（RMS ≈ 1.0 に正規化済み）。
    """
    white_noise = rng.standard_normal(length)
    # 簡易 1/f フィルタ: IIR フィルタで白色雑音を染色する
    # coefficients: 1/(1 - 0.99 z^{-1}) に近い AR フィルタ
    b = np.array([1.0])
    a = np.array([1.0, -0.99])
    pink = lfilter(b, a, white_noise)
    rms = float(np.sqrt(np.mean(pink**2)))
    if rms < 1e-12:
        return white_noise
    return pink / rms  # type: ignore[return-value]


def add_pink_noise(audio_array: np.ndarray, target_snr_db: float) -> np.ndarray:
    """指定 SNR（dB）のピンクノイズを加算した波形を返す。

    SNR = 20 * log10(signal_rms / noise_rms) を満たすように
    ノイズの振幅を調整してから加算する。

    Args:
        audio_array: 1-D float32/float64 配列（振幅 -1.0〜1.0 正規化済み）。
        target_snr_db: 目標 SNR（dB）。値が小さいほどノイズが大きい。

    Returns:
        ノイズを加算した波形（同じ dtype、同じ長さ）。
    """
    rng = np.random.default_rng(seed=42)  # 再現性のため固定シード
    signal_rms = float(np.sqrt(np.mean(audio_array**2)))
    if signal_rms < 1e-12:
        return audio_array.copy()

    pink_noise = _generate_pink_noise(len(audio_array), rng)
    # noise_rms を SNR 式から逆算する
    noise_rms_target = signal_rms / (10.0 ** (target_snr_db / 20.0))
    scaled_noise = pink_noise * noise_rms_target
    return (audio_array + scaled_noise).astype(audio_array.dtype)  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# WAV シリアライズ / デシリアライズ ユーティリティ
# ---------------------------------------------------------------------------


def load_wav(path: str) -> tuple[np.ndarray, int]:
    """WAV ファイルを読み込んで (waveform_float32, sample_rate) を返す。

    soundfile を使用して float32 に正規化して返す（librosa 禁止）。
    """
    waveform, sample_rate = sf.read(path, dtype="float32", always_2d=False)
    if waveform.ndim == 2:
        # ステレオ → モノラル変換（平均）
        waveform = waveform.mean(axis=1)
    return waveform, sample_rate


def to_wav_bytes(waveform: np.ndarray, sample_rate: int) -> bytes:
    """waveform を WAV バイナリに変換して返す（soundfile 使用）。"""
    buffer = io.BytesIO()
    sf.write(buffer, waveform, sample_rate, format="WAV", subtype="PCM_16")
    return buffer.getvalue()


# ---------------------------------------------------------------------------
# /v1/analyze 呼び出しヘルパー
# ---------------------------------------------------------------------------


def call_analyze(
    analyzer_url: str,
    wav_bytes: bytes,
    reference_text: str,
    duration_milliseconds: int,
    sample_rate: int = 16000,
) -> dict:
    """analyzer の POST /v1/analyze を multipart/form-data で呼び出す。

    nBest は /v1/analyze から直接取得する（DB heatmap は nBest を持たない — ORPHAN-1）。
    worker→DB コントラクト（PhonemeHeatEntry）は nBest を strip するため、
    confidence/entropy 測定は必ず /v1/analyze を直接呼ぶこと。

    Args:
        analyzer_url: analyzer の base URL（例: "http://localhost:8788"）。
        wav_bytes: WAV バイナリ。
        reference_text: 参照テキスト（例: "hello world"）。
        duration_milliseconds: 音声長（ミリ秒）。
        sample_rate: サンプリングレート（Hz）。デフォルト 16000。

    Returns:
        AnalysisResponse の JSON を dict として返す。
        エラー時は例外を raise する。
    """
    import urllib.request

    metadata = json.dumps(
        {
            "referenceText": reference_text,
            "mimeType": "audio/wav",
            "durationMilliseconds": duration_milliseconds,
            "targetAccent": "generalAmerican",
            "includeReferenceF0": False,
            "speakerSex": "unknown",
        }
    )

    boundary = "SELFEVAL_BOUNDARY_01"
    body_parts: list[bytes] = []

    # audio パート
    audio_header = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="audio"; filename="audio.wav"\r\n'
        f"Content-Type: audio/wav\r\n\r\n"
    ).encode()
    body_parts.append(audio_header)
    body_parts.append(wav_bytes)
    body_parts.append(b"\r\n")

    # metadata パート
    meta_header = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="metadata"\r\n'
        f"Content-Type: application/json\r\n\r\n"
    ).encode()
    body_parts.append(meta_header)
    body_parts.append(metadata.encode("utf-8"))
    body_parts.append(b"\r\n")

    # 終端
    body_parts.append(f"--{boundary}--\r\n".encode())

    body = b"".join(body_parts)
    content_type = f"multipart/form-data; boundary={boundary}"

    request = urllib.request.Request(
        f"{analyzer_url}/v1/analyze",
        data=body,
        headers={"Content-Type": content_type},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))
