"""RVC 音色変換エンジン実装（ADR-012 / ADR-006 パターン）。

RVC import はこのファイルにのみ行う。
usecase / domain / interface は RvcEnginePort プロトコル経由でのみ参照する。
rvc-python（MIT, PyPI） + torch CPU wheel（BSD-3）を使用。
モデル重みは HF_HOME volume 経由で供給（イメージ非焼込、M-GRV-10）。

ターゲット声: Nekochu/RVC-VCTK_Voice-sample（Apache-2.0）
エンコーダ: ContentVec / hubert_base（MIT）、pitch: rmvpe（MIT）

rmvpe 専用モデル・インデックスのレイアウト:
  .pth:   F/{voice}/rmvpe/F{voice}rmvpe.pth
  .index: F/{voice}/rmvpe/added_IVF*_Fp{voice}rmvpe_v2.index
  （Nekochu/RVC-VCTK_Voice-sample repo に実在することを確認済み）
"""

import logging
import os
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)

# HuggingFace Hub でモデルを DL するため hf_hub_download を使用する（M-GRV-10）
_HF_REPO_ID = "Nekochu/RVC-VCTK_Voice-sample"

# rmvpe 専用 .pth テンプレート（repo に実在するパス）
_HF_MODEL_FILENAME_TEMPLATE = "F/{voice}/rmvpe/F{voice}rmvpe.pth"

# repo に実在する rmvpe 専用インデックスファイル名（話者ごとに IVF 数が異なるため全列挙）
# キーは話者 id、値は F/{voice}/rmvpe/ 配下のインデックスファイル名
_HF_INDEX_FILENAME_MAP: dict[str, str] = {
    "p231": "F/p231/rmvpe/added_IVF1216_Flat_nprobe_1_Fp231rmvpe_v2.index",
    "p238": "F/p238/rmvpe/added_IVF1617_Flat_nprobe_1_Fp238rmvpe_v2.index",
    "p249": "F/p249/rmvpe/added_IVF1104_Flat_nprobe_1_Fp249rmvpe_v2.index",
    "p262": "F/p262/rmvpe/added_IVF1305_Flat_nprobe_1_Fp262rmvpe_v2.index",
    "p280": "F/p280/rmvpe/added_IVF1400_Flat_nprobe_1_Fp280rmvpe_v2.index",
    "p323": "F/p323/rmvpe/added_IVF1581_Flat_nprobe_1_Fp323rmvpe_v2.index",
    "p340": "F/p340/rmvpe/added_IVF1046_Flat_nprobe_1_Fp340rmvpe_v2.index",
}

# repo に実在する女性 VCTK 話者（Nekochu/RVC-VCTK_Voice-sample の F/ 配下）
_AVAILABLE_VOICES = list(_HF_INDEX_FILENAME_MAP.keys())

# デフォルト話者（repo に実在するもの）
DEFAULT_TARGET_VOICE = "p231"

# デフォルト pitch shift 半音数（GOLDEN_F0_UP_KEY env で上書き可能）
# p231 は女性話者、一般的な男性学習者との差は 10–12 半音が目安
_DEFAULT_F0_UP_KEY = 12


def _load_f0_up_key() -> int:
    """GOLDEN_F0_UP_KEY env を読み込む。未設定時はデフォルト値を使用する。"""
    raw = os.environ.get("GOLDEN_F0_UP_KEY", str(_DEFAULT_F0_UP_KEY))
    try:
        return int(raw)
    except ValueError:
        logger.warning(
            "GOLDEN_F0_UP_KEY=%r is not an integer, using default %d",
            raw,
            _DEFAULT_F0_UP_KEY,
        )
        return _DEFAULT_F0_UP_KEY


def _get_model_path(target_voice: str) -> Path:
    """HF Hub から rmvpe 専用 .pth を DL し、ローカルキャッシュパスを返す。

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


def _get_index_path(target_voice: str) -> Path | None:
    """HF Hub から rmvpe 専用 retrieval index を DL し、ローカルキャッシュパスを返す。

    index が repo に存在しない話者の場合は None を返す（index なしでも推論可能）。
    Nekochu/RVC-VCTK_Voice-sample repo に存在する話者は _HF_INDEX_FILENAME_MAP で管理する。
    """
    index_filename = _HF_INDEX_FILENAME_MAP.get(target_voice)
    if index_filename is None:
        logger.info(
            "No index filename registered for voice=%s; skipping retrieval index", target_voice
        )
        return None

    try:
        from huggingface_hub import hf_hub_download  # noqa: PLC0415
    except ImportError:
        logger.warning("huggingface_hub not installed; skipping retrieval index")
        return None

    try:
        index_path = hf_hub_download(repo_id=_HF_REPO_ID, filename=index_filename)
        return Path(index_path)
    except Exception as download_error:
        # index DL 失敗はソフト障害（.pth のみで推論続行）
        logger.warning(
            "Index download failed for voice=%s: %s; continuing without retrieval index",
            target_voice,
            download_error,
        )
        return None


class RvcEngine:
    """rvc-python を使った音色変換エンジン（RvcEnginePort 実装）。

    RVC import はこのクラス内でのみ行う（ADR-012 封じ込め規則）。
    CPU 推論パス（torch CPU wheel）で動作する（M-GRV-2 / REQ-NF-102）。

    pitch shift は f0up_key（半音数）を GOLDEN_F0_UP_KEY env または
    コンストラクタ引数で設定する。rmvpe 専用インデックスが存在する場合は
    retrieval index を使用して音色移転精度を高める。
    """

    def __init__(
        self,
        target_voice: str = DEFAULT_TARGET_VOICE,
        f0_up_key: int | None = None,
    ) -> None:
        self._target_voice = target_voice
        # f0_up_key が明示されない場合は env から読む
        self._f0_up_key: int = f0_up_key if f0_up_key is not None else _load_f0_up_key()
        self._model_path: Path | None = None
        self._index_path: Path | None = None

    def _ensure_model(self, target_voice: str) -> tuple[Path, Path | None]:
        """モデルパスとインデックスパスを取得してキャッシュする。

        未ダウンロードなら HF から DL する。
        Returns:
            (model_path, index_path_or_None)
        """
        if self._model_path is None or self._target_voice != target_voice:
            self._model_path = _get_model_path(target_voice)
            self._index_path = _get_index_path(target_voice)
            self._target_voice = target_voice
        return self._model_path, self._index_path

    def convert(
        self,
        learner_audio_bytes: bytes,
        target_voice: str,
    ) -> bytes:
        """学習者音声を target_voice の音色に変換した WAV バイト列を返す。

        Args:
            learner_audio_bytes: 学習者音声 WAV バイト列。
            target_voice: VCTK 話者 id（例: "p231"）。

        Returns:
            変換済み WAV バイト列。

        Raises:
            RuntimeError: モデル利用不可 / RVC 推論失敗時。
        """
        # モデルパスを取得する（HF DL or キャッシュ）
        model_path, index_path = self._ensure_model(target_voice)

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

            # rvc-python RVCInference API（rvc-python 0.1.5 実装確認済み）。
            # - model_path: .pth ファイルパス（rmvpe 専用 .pth を使用）
            # - index_path: retrieval .index ファイルパス（存在しない場合は ""）
            # - f0up_key: pitch shift 半音数（set_params で設定）
            # - f0method: pitch 抽出アルゴリズム（set_params で設定）
            # CPU 推論: device="cpu"（M-GRV-2 / REQ-NF-102）
            index_path_str = str(index_path) if index_path is not None else ""
            rvc = RVCInference(
                model_path=str(model_path),
                index_path=index_path_str,
                device="cpu",
            )
            rvc.set_params(f0method="rmvpe", f0up_key=self._f0_up_key)
            logger.info(
                "RVC inference: voice=%s, f0up_key=%d, index=%s",
                target_voice,
                self._f0_up_key,
                "yes" if index_path else "no",
            )
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
