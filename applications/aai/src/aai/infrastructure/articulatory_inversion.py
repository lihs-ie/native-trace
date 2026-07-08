"""articulatory/articulatory (Apache-2.0) による調音逆推定エンジン実装（ADR-019）。

articulatory package の import はこのファイルにのみ行う（封じ込め規則: M-AAI-3）。
torch/checkpoint が不在の環境でも import error にならず graceful degrade する
（golden の rvc_engine.py の try/except ImportError 遅延 import パターンを踏襲）。

モデル重みは HF_HOME volume 経由で供給（イメージ非焼込, M-GRV-10 前例と同型）。

S-AAI-3: transitive 依存（torch 等）に GPL が混入した場合は ADR-006 前例
（service 境界隔離 + ast-grep allow を aai に拡張 + ADR amend）で対処する。
実装時に `pip show articulatory` および `pip show torch` で依存ツリーを確認すること。
torch は BSD-3-Clause であり GPL 混入は今のところ確認されていないが、
transitive dep が変わった場合は本コメントを更新し ADR-019 を amend すること。

===== 純粋ヘルパー関数（unit-testable, モデル非依存） =====

- _map_12dim_ema_to_6_coords: D3-a 写像（numpy EMA フレーム → 6 wire 座標）
- _normalize_coords_zscore: D3-b 発話内 z-score 正規化 → [-1, 1] クランプ
- _compute_display_eligibility: D3-c 表示適格性プロキシ計算
"""

import io
import logging
from typing import Any

import numpy as np

from aai.domain.articulatory_estimate import (
    ArticulatoryInversionResult,
    PhonemeArticulatoryEstimate,
)

logger = logging.getLogger(__name__)

# EMA チャネルインデックス（articulatory/articulatory の 12-dim 出力順に基づく）
# 6 sensor × XY: [lower_incisor_x, lower_incisor_y,
#                  upper_lip_x, upper_lip_y,
#                  lower_lip_x, lower_lip_y,
#                  tongue_tip_x, tongue_tip_y,
#                  tongue_body_x, tongue_body_y,
#                  tongue_dorsum_x, tongue_dorsum_y]
_IDX_LOWER_INCISOR_X = 0
_IDX_LOWER_INCISOR_Y = 1
_IDX_UPPER_LIP_X = 2
_IDX_UPPER_LIP_Y = 3
_IDX_LOWER_LIP_X = 4
_IDX_LOWER_LIP_Y = 5
_IDX_TONGUE_TIP_X = 6
_IDX_TONGUE_TIP_Y = 7
_IDX_TONGUE_BODY_X = 8
_IDX_TONGUE_BODY_Y = 9
_IDX_TONGUE_DORSUM_X = 10
_IDX_TONGUE_DORSUM_Y = 11


def _map_12dim_ema_to_6_coords(ema_frames: np.ndarray) -> np.ndarray:
    """D3-a: 12-dim EMA フレーム列を 6 wire 座標フレーム列に写像する（純粋ヘルパー）。

    lip aperture（唇の開き）は native EMA チャネルではなく上下唇センサーから導出する:
    - lipApertureY = lowerLipY − upperLipY  （唇の縦開き）
    - lipApertureX = (upperLipX + lowerLipX) / 2  （唇の前後位置中点）

    下顎切歯（lower incisor）と舌体（tongue body）は wire に出さない（D3-a drop）。
    MVP の矢状断面 SVG オーバーレイは舌先・舌背・唇の 3 点で足りるため。

    Args:
        ema_frames: shape (n_frames, 12) の numpy 配列（生 mm）。

    Returns:
        shape (n_frames, 6) の numpy 配列。
        列順: [tongue_tip_x, tongue_tip_y, tongue_dorsum_x, tongue_dorsum_y,
               lip_aperture_x, lip_aperture_y]
    """
    tongue_tip_x = ema_frames[:, _IDX_TONGUE_TIP_X]
    tongue_tip_y = ema_frames[:, _IDX_TONGUE_TIP_Y]
    tongue_dorsum_x = ema_frames[:, _IDX_TONGUE_DORSUM_X]
    tongue_dorsum_y = ema_frames[:, _IDX_TONGUE_DORSUM_Y]
    upper_lip_x = ema_frames[:, _IDX_UPPER_LIP_X]
    upper_lip_y = ema_frames[:, _IDX_UPPER_LIP_Y]
    lower_lip_x = ema_frames[:, _IDX_LOWER_LIP_X]
    lower_lip_y = ema_frames[:, _IDX_LOWER_LIP_Y]

    # lipApertureY = lowerLipY − upperLipY（唇の縦開き）
    lip_aperture_y = lower_lip_y - upper_lip_y
    # lipApertureX = (upperLipX + lowerLipX) / 2（唇の前後位置中点）
    lip_aperture_x = (upper_lip_x + lower_lip_x) / 2.0

    # 6 wire 座標を結合する（lower_incisor と tongue_body を drop）
    return np.stack(
        [tongue_tip_x, tongue_tip_y, tongue_dorsum_x, tongue_dorsum_y,
         lip_aperture_x, lip_aperture_y],
        axis=1,
    )


def _normalize_coords_zscore(coords_frames: np.ndarray) -> np.ndarray:
    """D3-b: 発話内 z-score 正規化 → [-1.0, 1.0] クランプ（純粋ヘルパー）。

    正規化は service の責務であり、モデルが正規化済み座標を出すわけではない。
    articulatory/articulatory の Speech-to-EMA checkpoint は生 mm 値を出力する。
    service がここで話者の vocal tract 長差を吸収するため z 化する。

    各チャネルについて発話全体（全フレーム）の平均・標準偏差で z-score を計算し、
    その後 [-1.0, 1.0] にクランプする。標準偏差が 0 の場合は 0.0 を返す（定数チャネル）。

    Args:
        coords_frames: shape (n_frames, 6) の numpy 配列（生 mm）。

    Returns:
        shape (n_frames, 6) の numpy 配列（z-score, [-1.0, 1.0] クランプ済）。
    """
    mean = np.nanmean(coords_frames, axis=0)
    std = np.nanstd(coords_frames, axis=0)

    # 標準偏差 0 除算を回避する（定数チャネルは 0.0 に写像する）
    safe_std = np.where(std == 0.0, 1.0, std)
    z_scored = (coords_frames - mean) / safe_std

    # std が 0 だったチャネルは 0.0 にする
    z_scored = np.where(np.broadcast_to(std == 0.0, z_scored.shape), 0.0, z_scored)

    return np.clip(z_scored, -1.0, 1.0)


def _compute_voicing_ratio(
    learner_audio_bytes: bytes,
    sample_rate: int,
    start_ms: int,
    end_ms: int,
) -> float:
    """セグメント内の有声フレーム比率を librosa で計算する（モデル非依存）。

    librosa (ISC) を使用する。parselmouth (GPL) は使用しない（ADR-006/012 封じ込め準拠）。
    aai service は Apache/MIT/BSD/ISC のみに依存する。

    F0 検出（yin アルゴリズム）で有声フレーム（F0 > 0）の比率を返す。
    librosa が利用不可の場合は保守的に 0.5 を返す。

    Args:
        learner_audio_bytes: 音声バイト列（WAV 等）。
        sample_rate: サンプルレート (Hz)。
        start_ms: セグメント開始時刻 (ms)。
        end_ms: セグメント終了時刻 (ms)。

    Returns:
        有声フレーム比率 [0.0, 1.0]。
    """
    try:
        import librosa  # noqa: PLC0415
    except ImportError:
        logger.warning("librosa not available; using conservative voicing_ratio=0.5")
        return 0.5

    try:
        audio_np, _ = librosa.load(
            io.BytesIO(learner_audio_bytes),
            sr=sample_rate,
            mono=True,
        )
        start_sample = int(start_ms * sample_rate / 1000)
        end_sample = int(end_ms * sample_rate / 1000)
        segment = audio_np[start_sample:end_sample]

        if len(segment) < 512:
            return 0.0

        # yin アルゴリズムで F0 を推定する
        f0 = librosa.yin(
            segment,
            fmin=librosa.note_to_hz("C2"),
            fmax=librosa.note_to_hz("C7"),
            sr=sample_rate,
        )
        voiced_frames = np.sum(f0 > 0)
        total_frames = len(f0)
        if total_frames == 0:
            return 0.0
        return float(voiced_frames) / float(total_frames)
    except Exception as error:
        logger.warning("voicing_ratio computation failed: %s", error)
        return 0.5


def _compute_display_eligibility(
    ema_segment_frames: np.ndarray,
    learner_audio_bytes: bytes,
    sample_rate: int,
    start_ms: int,
    end_ms: int,
) -> float:
    """D3-c: 表示適格性プロキシを計算する（純粋ヘルパー、モデル非依存）。

    displayEligibility = validFrameRatio × voicingRatio × durationAdequacy

    - validFrameRatio: NaN/不正でない EMA フレーム数 / セグメント内全フレーム数。
    - voicingRatio: セグメント内で基本周波数が検出された（有声）フレーム比率。
      audio から直接計算する（librosa yin, モデル非依存）。
    - durationAdequacy: min(1.0, (endMs − startMs) / 50)。
      50ms 未満の区間は EMA 軌跡が不安定（D3-c と整合）。

    displayEligibility はモデルの予測分散・不確実度ではなく EMA 軌跡から計算する
    合成スコアである（モデルが予測分散を出力するという根拠が無いため, ADR-019 verifier 指摘 #1）。

    Args:
        ema_segment_frames: shape (n_frames, 6) のセグメント EMA 座標（生 mm またはゼロ埋め可）。
        learner_audio_bytes: 音声バイト列。
        sample_rate: サンプルレート (Hz)。
        start_ms: セグメント開始時刻 (ms)。
        end_ms: セグメント終了時刻 (ms)。

    Returns:
        displayEligibility [0.0, 1.0]。
    """
    total_frames = len(ema_segment_frames)
    if total_frames == 0:
        return 0.0

    # validFrameRatio: NaN が無く全 6 座標が有限値であるフレーム数 / 全フレーム数
    valid_mask = np.all(np.isfinite(ema_segment_frames), axis=1)
    valid_frame_ratio = float(np.sum(valid_mask)) / float(total_frames)

    # voicingRatio: audio から librosa で計算する（モデル非依存）
    voicing_ratio = _compute_voicing_ratio(
        learner_audio_bytes=learner_audio_bytes,
        sample_rate=sample_rate,
        start_ms=start_ms,
        end_ms=end_ms,
    )

    # durationAdequacy: min(1.0, (endMs − startMs) / 50)
    duration_adequacy = min(1.0, (end_ms - start_ms) / 50.0)

    display_eligibility = valid_frame_ratio * voicing_ratio * duration_adequacy
    return float(np.clip(display_eligibility, 0.0, 1.0))


class ArticulatoryInversionEngine:
    """articulatory/articulatory (Apache-2.0) を使った調音逆推定エンジン。

    articulatory package の import はこのクラス内でのみ行う（ADR-019 封じ込め規則）。
    torch/checkpoint が不在の環境では RuntimeError を送出する。
    graceful degrade は usecase で処理する。
    EMA checkpoint は HF_HOME volume 経由で供給（イメージ非焼込, M-GRV-10）。

    S-AAI-2: articulatory/articulatory の MNGU0 checkpoint は単一英国男性話者由来で
    日本語訛り /r/→[ɾ] は学習分布外。cross-speaker 汎化が弱いため、最も feedback が
    必要な /r/-/l/ でガードレールにより suppress されうる（motivation と suppress 挙動の緊張）。
    """

    def __init__(self) -> None:
        self._model: Any = None

    def _ensure_model(self) -> Any:
        """articulatory モデルをロードしてキャッシュする。

        articulatory package / torch が不在の場合は RuntimeError を送出する。
        """
        if self._model is not None:
            return self._model

        # articulatory package の lazy import（封じ込め）
        # torch/checkpoint 不在環境で graceful degrade するため try/except で囲む
        try:
            import articulatory  # noqa: PLC0415
        except ImportError as import_error:
            raise RuntimeError("articulatory package is not installed") from import_error

        try:
            # articulatory/articulatory の Speech-to-EMA モデルをロードする
            # モデル名は "acoustic_to_ema" (Speech-to-EMA checkpoint, MNGU0 学習済)
            model = articulatory.load_model("acoustic_to_ema")
            self._model = model
            return self._model
        except Exception as load_error:
            raise RuntimeError(f"articulatory model load failed: {load_error}") from load_error

    def invert(
        self,
        learner_audio_bytes: bytes,
        sample_rate: int,
        boundaries: list[dict],
    ) -> ArticulatoryInversionResult:
        """音声から調音軌跡を推定する。

        Args:
            learner_audio_bytes: 学習者音声バイト列（WAV 等）。
            sample_rate: 音声サンプルレート (Hz)。
            boundaries: 音素境界リスト。各要素は {"phoneme": str, "startMs": int, "endMs": int}。

        Returns:
            ArticulatoryInversionResult。

        Raises:
            RuntimeError: articulatory package 不在 / モデルロード失敗時。
        """
        model = self._ensure_model()

        try:
            import librosa  # noqa: PLC0415
        except ImportError as import_error:
            raise RuntimeError("librosa is not installed") from import_error

        # 音声を numpy に変換する
        try:
            audio_np, loaded_sr = librosa.load(
                io.BytesIO(learner_audio_bytes),
                sr=None,
                mono=True,
            )
        except Exception as load_error:
            raise RuntimeError(f"audio load failed: {load_error}") from load_error

        if loaded_sr != sample_rate:
            try:
                audio_np = librosa.resample(audio_np, orig_sr=loaded_sr, target_sr=sample_rate)
            except Exception as resample_error:
                raise RuntimeError(f"audio resample failed: {resample_error}") from resample_error

        # articulatory モデルで全音声の EMA フレームを推定する
        # articulatory/articulatory の API: model.predict(audio, sample_rate) -> EMA frames
        try:
            # articulatory package の実 API を呼び出す
            # 返値は shape (n_frames, 12) の numpy 配列（生 mm）
            all_ema_frames = _call_articulatory_model(model, audio_np, sample_rate)
        except Exception as infer_error:
            raise RuntimeError(f"articulatory inference failed: {infer_error}") from infer_error

        if all_ema_frames is None or len(all_ema_frames) == 0:
            return ArticulatoryInversionResult(per_phoneme=[])

        # 全フレームに D3-a 写像を適用する
        all_6coords = _map_12dim_ema_to_6_coords(all_ema_frames)

        # D3-b: 発話内 z-score 正規化 → [-1.0, 1.0] クランプ（全フレームで正規化する）
        normalized_coords = _normalize_coords_zscore(all_6coords)

        # EMA フレームレート（articulatory/articulatory は 200Hz で出力）
        ema_fps = 200.0

        per_phoneme_estimates = []
        for boundary in boundaries:
            phoneme = boundary["phoneme"]
            start_ms = boundary["startMs"]
            end_ms = boundary["endMs"]

            # EMA フレームインデックスに変換する
            start_frame = int(start_ms / 1000.0 * ema_fps)
            end_frame = int(end_ms / 1000.0 * ema_fps)
            start_frame = max(0, min(start_frame, len(normalized_coords)))
            end_frame = max(0, min(end_frame, len(normalized_coords)))

            if start_frame >= end_frame:
                # セグメントのフレームが取れない場合は全ゼロのフレームを 1 枚用意する
                segment_normalized = np.zeros((1, 6))
            else:
                segment_normalized = normalized_coords[start_frame:end_frame]

            # D3-c: 表示適格性プロキシを計算する
            # 元の 6 座標（正規化前）のセグメントを渡して validFrameRatio を計算する
            if start_frame >= end_frame:
                segment_raw = np.zeros((1, 6))
            else:
                segment_raw = all_6coords[start_frame:end_frame]

            display_eligibility = _compute_display_eligibility(
                ema_segment_frames=segment_raw,
                learner_audio_bytes=learner_audio_bytes,
                sample_rate=sample_rate,
                start_ms=start_ms,
                end_ms=end_ms,
            )

            # 代表座標として平均値を使用する（全フレームの中央値も検討したが平均が安定）
            mean_coords = np.nanmean(segment_normalized, axis=0)
            if np.any(np.isnan(mean_coords)):
                mean_coords = np.zeros(6)

            per_phoneme_estimates.append(
                PhonemeArticulatoryEstimate(
                    phoneme=phoneme,
                    start_ms=start_ms,
                    end_ms=end_ms,
                    tongue_tip_x=float(mean_coords[0]),
                    tongue_tip_y=float(mean_coords[1]),
                    tongue_dorsum_x=float(mean_coords[2]),
                    tongue_dorsum_y=float(mean_coords[3]),
                    lip_aperture_x=float(mean_coords[4]),
                    lip_aperture_y=float(mean_coords[5]),
                    display_eligibility=float(display_eligibility),
                )
            )

        return ArticulatoryInversionResult(per_phoneme=per_phoneme_estimates)


def _call_articulatory_model(model: Any, audio_np: np.ndarray, sample_rate: int) -> np.ndarray:
    """articulatory モデルの推論 API を呼び出す（API 差異を吸収するラッパー）。

    articulatory/articulatory の公開 API:
    - モデルオブジェクトが predict / infer / forward などのメソッドを持つ場合に対応する。
    - 入力: audio_np (1D numpy float32 配列), sample_rate (int)。
    - 出力: shape (n_frames, 12) の EMA フレーム配列（生 mm）。

    Returns:
        shape (n_frames, 12) の numpy 配列。
    """
    # articulatory package の実際の API を試みる（複数のシグネチャに対応）
    if hasattr(model, "predict"):
        return np.asarray(model.predict(audio_np, sample_rate))
    if hasattr(model, "infer"):
        return np.asarray(model.infer(audio_np, sample_rate))
    if callable(model):
        import torch  # noqa: PLC0415
        audio_tensor = torch.from_numpy(audio_np).float()
        output = model(audio_tensor)
        if hasattr(output, "numpy"):
            return output.numpy()
        return np.asarray(output)

    raise RuntimeError("articulatory model has no known inference API (predict/infer/__call__)")
