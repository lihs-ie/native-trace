"""FastAPI アプリケーション生成 + DI 結線（Composition Root）。

http_handler の router をここで include_router して
GET /health + POST /v1/convert を登録する（ORPHAN-1 配線点）。

RVC import は infrastructure/rvc_engine.py のみ（ADR-012 / ADR-006 封じ込め）。
品質ゲートは infrastructure/quality_gate.py（F0 連続性, librosa/numpy, license-clean）。
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
            "学習者音声を RVC (MIT) で CPU 変換し F0 連続性品質ゲートを通過した音声を返す。"
            "「自分の声」ではなく「汎用 VCTK ネイティブ声」への変換（M-GRV-7）。"
        ),
        version="1.0.0",
    )

    # target_voice は環境変数で上書き可能（非必須、デフォルト p225）
    target_voice = os.environ.get("GOLDEN_TARGET_VOICE", DEFAULT_TARGET_VOICE)

    # infrastructure の実インスタンスを生成する（RVC import は rvc_engine.py のみ）
    engine = RvcEngine(target_voice=target_voice)
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
