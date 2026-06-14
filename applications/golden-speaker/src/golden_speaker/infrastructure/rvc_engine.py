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
_HF_MODEL_FILENAME_TEMPLATE = "{voice}.pth"

# デフォルト話者
DEFAULT_TARGET_VOICE = "p225"


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

            # rvc-python RVCInference API
            # RVCInference(model_path).infer_file(input, output, f0method) が基本 API
            # CPU 推論: device="cpu", f0method="rmvpe"（MIT）
            rvc = RVCInference(model_path=str(model_path), device="cpu")
            rvc.infer_file(
                input_path=input_path,
                output_path=output_path,
                f0method="rmvpe",
            )
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
    """VCTK モデルで利用可能な話者リストを返す（情報提供用）。

    実際の利用可否は HF DL 成功に依存する。
    """
    return [
        "p225", "p226", "p227", "p228", "p229",
        "p230", "p231", "p232", "p233", "p234",
        "p236", "p237", "p238", "p239", "p240",
        "p241", "p243", "p244", "p245", "p246",
        "p247", "p248", "p249", "p250", "p251",
        "p252", "p253", "p254", "p255", "p256",
        "p257", "p258", "p259", "p260", "p261",
        "p262", "p263", "p264", "p265", "p266",
        "p267", "p268", "p269", "p270", "p271",
        "p272", "p273", "p274", "p275", "p276",
        "p277", "p278", "p279", "p280", "p281",
        "p282", "p283", "p284", "p285", "p286",
        "p287", "p288", "p292", "p293", "p294",
        "p295", "p297", "p298", "p299", "p300",
        "p301", "p302", "p303", "p304", "p305",
        "p306", "p307", "p308", "p310", "p311",
        "p312", "p313", "p314", "p316", "p317",
        "p318", "p323", "p326", "p329", "p330",
        "p333", "p334", "p335", "p336", "p339",
        "p340", "p341", "p343", "p345", "p347",
        "p351", "p360", "p361", "p362", "p363",
        "p364", "p374", "p376",
    ]
