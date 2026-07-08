"""FastAPI アプリケーション生成 + DI 結線（Composition Root）。

http_handler の router をここで include_router して
GET /health + POST /v1/convert を登録する（ORPHAN-1 配線点）。

RVC import は infrastructure/rvc_engine.py のみ（ADR-012 / ADR-006 封じ込め）。
品質ゲートは infrastructure/quality_gate.py（F0 連続性, parselmouth/numpy, GPL は golden-speaker 境界内に隔離 — ADR-012改訂/ADR-006）。
モデル重みは HF_HOME volume 経由で供給（イメージ非焼込, M-GRV-10）。
"""

import logging
import os

from fastapi import FastAPI

from golden_speaker.infrastructure.quality_gate import F0ContinuityQualityGate
from golden_speaker.infrastructure.rvc_engine import DEFAULT_TARGET_VOICE, RvcEngine
from golden_speaker.interface import http_handler
from golden_speaker.usecase.convert_voice import ConvertVoiceUseCase

logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    """FastAPI アプリを生成して返す。

    infrastructure の実インスタンスを生成し、ConvertVoiceUseCase に注入する。
    GET /health + POST /v1/convert の全 endpoint を include_router で登録する。
    """
    application = FastAPI(
        title="NativeTrace Golden Speaker",
        description=(
            "汎用 VCTK ネイティブ声への音色変換 HTTP API（ADR-012）。"
            "学習者音声を RVC (MIT) で CPU 変換し出力妥当性品質ゲートを通過した音声を返す。"
            "「自分の声」ではなく「汎用 VCTK ネイティブ声」への変換（M-GRV-7）。"
        ),
        version="1.0.0",
    )

    # target_voice は環境変数で上書き可能（非必須、デフォルト p231）
    target_voice = os.environ.get("GOLDEN_TARGET_VOICE", DEFAULT_TARGET_VOICE)

    # f0_up_key は環境変数で上書き可能（非必須、デフォルト 12 半音）
    # GOLDEN_F0_UP_KEY: pitch shift 半音数（正=高く, 負=低く）
    # p231（女性話者）への変換では一般的な男性学習者との差 10–12 半音が目安
    raw_f0_up_key = os.environ.get("GOLDEN_F0_UP_KEY")
    f0_up_key: int | None = None
    if raw_f0_up_key is not None:
        try:
            f0_up_key = int(raw_f0_up_key)
        except ValueError:
            logger.warning(
                "GOLDEN_F0_UP_KEY=%r is not an integer; RvcEngine will use its own default",
                raw_f0_up_key,
            )

    # infrastructure の実インスタンスを生成する（RVC import は rvc_engine.py のみ）
    engine = RvcEngine(target_voice=target_voice, f0_up_key=f0_up_key)
    quality_gate = F0ContinuityQualityGate()

    # usecase を生成する（Port 注入）
    use_case = ConvertVoiceUseCase(
        engine=engine,
        quality_gate=quality_gate,
        target_voice=target_voice,
    )

    # http_handler に usecase を DI する（ORPHAN-1: include_router で /v1/convert を到達可能にする）
    http_handler.set_convert_voice_use_case(use_case)

    # GET /health + POST /v1/convert を router から include する（ORPHAN-1 配線点）
    application.include_router(http_handler.router)

    return application


# モジュールレベルで app インスタンスを生成する（uvicorn のエントリポイント用）
app = create_app()
