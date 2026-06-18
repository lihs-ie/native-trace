"""音色変換ユースケース。

domain / usecase/port のみに依存。rvc-python / fastapi / torch を直接 import しない。
品質ゲートは infrastructure.quality_gate に委譲（QualityGatePort 経由）。
"""

import logging

from golden_speaker.domain.conversion_result import ConversionResult
from golden_speaker.usecase.port.rvc_engine import RvcEnginePort
from golden_speaker.usecase.port.quality_gate import QualityGatePort

logger = logging.getLogger(__name__)

_DEFAULT_TARGET_VOICE = "p231"  # VCTK 話者 id（汎用ネイティブ声 — 自己声ではない）


class ConvertVoiceUseCase:
    """学習者音声を VCTK 汎用ネイティブ声へ音色変換するユースケース。

    RVC エンジンと品質ゲートをポート経由で利用し、
    変換結果（ConversionResult）を返す。

    「自分の声」ではなく「汎用 VCTK ネイティブ声」への変換であることに注意（ADR-012 / M-GRV-7）。
    GPU 学習なしの CPU MVP では学習者固有モデルは存在しない。
    """

    def __init__(
        self,
        engine: RvcEnginePort,
        quality_gate: QualityGatePort,
        target_voice: str = _DEFAULT_TARGET_VOICE,
    ) -> None:
        self._engine = engine
        self._quality_gate = quality_gate
        self._target_voice = target_voice

    def execute(
        self,
        learner_audio_bytes: bytes,
    ) -> ConversionResult:
        """音色変換を実行し ConversionResult を返す。

        Args:
            learner_audio_bytes: 学習者音声 WAV バイト列。

        Returns:
            ConversionResult。品質ゲート通過時は audio_bytes に変換音声を含む。
            モデル利用不可時は quality_gate_passed=False, withhold_reason="model_unavailable"。
        """
        # モデル不在など RVC 推論失敗時はフォールバック結果を返す（HTTP 200 業務ロジック）
        try:
            converted_bytes = self._engine.convert(
                learner_audio_bytes=learner_audio_bytes,
                target_voice=self._target_voice,
            )
        except RuntimeError as engine_error:
            logger.warning("RVC engine conversion failed: %s", engine_error)
            return ConversionResult(
                audio_bytes=None,
                quality_gate_passed=False,
                withhold_reason="model_unavailable",
                target_voice=self._target_voice,
            )

        # 品質ゲート（F0 連続性）チェック
        gate_passed, withhold_reason = self._quality_gate.check(converted_bytes)
        if not gate_passed:
            logger.info("Quality gate failed: %s", withhold_reason)
            return ConversionResult(
                audio_bytes=None,
                quality_gate_passed=False,
                withhold_reason=withhold_reason,
                target_voice=self._target_voice,
            )

        return ConversionResult(
            audio_bytes=converted_bytes,
            quality_gate_passed=True,
            withhold_reason=None,
            target_voice=self._target_voice,
        )
