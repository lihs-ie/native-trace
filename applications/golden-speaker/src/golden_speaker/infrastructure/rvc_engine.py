"""RVC 音色変換エンジン実装（ADR-012 / ADR-006 パターン）。

RVC import はこのファイルにのみ行う。
usecase / domain / interface は RvcEnginePort プロトコル経由でのみ参照する。
rvc-python（MIT, PyPI） + torch CPU wheel（BSD-3）を使用。
モデル重みは HF_HOME volume 経由で供給（イメージ非焼込、M-GRV-10）。

ターゲット声: Nekochu/RVC-VCTK_Voice-sample（Apache-2.0）
エンコーダ: ContentVec / hubert_base（MIT）、pitch: rmvpe（MIT）
"""

import io
import logging
import os
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)

# HuggingFace Hub でモデルを DL するため hf_hub_download を使用する（M-GRV-10）
_HF_REPO_ID = "Nekochu/RVC-VCTK_Voice-sample"
# repo のレイアウトは F/{voice}/F{voice}.pth（女性 VCTK 話者）。retrieval index は
# 可変ハッシュ名のため MVP では DL せず、.pth のみで推論する（retrieval なし）。
_HF_MODEL_FILENAME_TEMPLATE = "F/{voice}/F{voice}.pth"

# repo に実在する女性 VCTK 話者（Nekochu/RVC-VCTK_Voice-sample の F/ 配下）
_AVAILABLE_VOICES = ["p231", "p238", "p249", "p262", "p280", "p323", "p340"]

# デフォルト話者（repo に実在するもの）
DEFAULT_TARGET_VOICE = "p231"


def _get_model_path(target_voice: str) -> Path:
    """HF Hub からモデルを DL し、ローカルキャッシュパスを返す。

    HF_HOME env（compose.yaml で hf-cache volume にマウント）にキャッシュする（M-GRV-10）。
    モデルが存在しない場合は RuntimeError を送出する。
    """
    try:
        from huggingface_hub import hf_hub_download  # noqa: PLC0415
    except ImportError as import_error:
        raise RuntimeError("huggingface_hub is not installed") from import_error

    filename = _HF_MODEL_FILENAME_TEMPLATE.format(voice=target_voice)
    try:
        model_path = hf_hub_download(repo_id=_HF_REPO_ID, filename=filename)
        return Path(model_path)
    except Exception as download_error:
        raise RuntimeError(
            f"Model download failed for voice={target_voice}: {download_error}"
        ) from download_error


class RvcEngine:
    """rvc-python を使った音色変換エンジン（RvcEnginePort 実装）。

    RVC import はこのクラス内でのみ行う（ADR-012 封じ込め規則）。
    CPU 推論パス（torch CPU wheel）で動作する（M-GRV-2 / REQ-NF-102）。
    """

    def __init__(self, target_voice: str = DEFAULT_TARGET_VOICE) -> None:
        self._target_voice = target_voice
        self._model_path: Path | None = None

    def _ensure_model(self, target_voice: str) -> Path:
        """モデルパスを取得してキャッシュする。未ダウンロードなら HF から DL する。"""
        if self._model_path is None or self._target_voice != target_voice:
            self._model_path = _get_model_path(target_voice)
            self._target_voice = target_voice
        return self._model_path

    def convert(
        self,
        learner_audio_bytes: bytes,
        target_voice: str,
    ) -> bytes:
        """学習者音声を target_voice の音色に変換した WAV バイト列を返す。

        Args:
            learner_audio_bytes: 学習者音声 WAV バイト列。
            target_voice: VCTK 話者 id（例: "p225"）。

        Returns:
            変換済み WAV バイト列。

        Raises:
            RuntimeError: モデル利用不可 / RVC 推論失敗時。
        """
        # モデルパスを取得する（HF DL or キャッシュ）
        model_path = self._ensure_model(target_voice)

        # RVC import はこのスコープにのみ行う（封じ込め）
        try:
            from rvc_python.infer import RVCInference  # noqa: PLC0415
        except ImportError as import_error:
            raise RuntimeError("rvc-python is not installed") from import_error

        # 入力 WAV をテンポラリファイルに書き出す（rvc-python がファイルパスを要求する）
        with (
            tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as input_tmp,
            tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as output_tmp,
        ):
            input_path = input_tmp.name
            output_path = output_tmp.name

        try:
            Path(input_path).write_bytes(learner_audio_bytes)

            # rvc-python RVCInference API（実 signature: infer_file(input_path, output_path)）。
            # f0method は set_params 経由で設定する。CPU 推論: device="cpu", f0method="rmvpe"（MIT）。
            rvc = RVCInference(model_path=str(model_path), device="cpu")
            rvc.set_params(f0method="rmvpe")
            rvc.infer_file(input_path=input_path, output_path=output_path)
            converted_bytes = Path(output_path).read_bytes()
        except Exception as infer_error:
            raise RuntimeError(f"RVC inference failed: {infer_error}") from infer_error
        finally:
            # テンポラリファイルを削除する
            _safe_unlink(input_path)
            _safe_unlink(output_path)

        return converted_bytes


def _safe_unlink(path: str) -> None:
    """ファイルが存在する場合のみ削除する。"""
    try:
        Path(path).unlink(missing_ok=True)
    except Exception as unlink_error:
        logger.warning("Failed to delete temp file %s: %s", path, unlink_error)


def get_available_voices() -> list[str]:
    """golden サービスで利用可能な話者リストを返す（情報提供用）。

    Nekochu/RVC-VCTK_Voice-sample の F/ 配下に実在する女性 VCTK 話者のみ。
    """
    return list(_AVAILABLE_VOICES)
