"""HTTP ルーター: GET /health + POST /v1/convert。

app.py の Composition Root で include_router して登録される（ORPHAN-1 配線点）。
/v1/convert は multipart/form-data で learner_audio (WAV) と metadata を受け取り
GoldenConversionResponse を返す。
"""

import base64
import json
import logging

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from golden_speaker.interface.schema import (
    ConvertMetadata,
    GoldenConversionResponse,
    HealthResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter()

# Composition Root から注入される ConvertVoiceUseCase（型注釈は forward reference で解決）
_convert_voice_use_case: "ConvertVoiceUseCase | None" = None


def set_convert_voice_use_case(use_case: "ConvertVoiceUseCase") -> None:
    """Composition Root から ConvertVoiceUseCase を注入する。

    app.py の create_app() が呼び出す。
    """
    global _convert_voice_use_case  # noqa: PLW0603
    _convert_voice_use_case = use_case


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """ヘルスチェックエンドポイント。"""
    return HealthResponse(status="ok")


@router.post(
    "/v1/convert",
    response_model=GoldenConversionResponse,
    summary="音色変換 (ADR-012 / M-GRV-1)",
    responses={
        503: {"description": "Use case not initialized"},
        400: {"description": "Invalid request"},
    },
)
async def convert(
    learner_audio: UploadFile = File(  # noqa: B008
        ..., description="学習者音声（WAV バイト列）"
    ),
    metadata: str = Form(  # noqa: B008
        ..., description="application/json: {mimeType}"
    ),
) -> GoldenConversionResponse:
    """音色変換エンドポイント（ADR-012 / M-GRV-1）。

    learner_audio（学習者 WAV）を汎用 VCTK ネイティブ声へ RVC で音色変換する。
    変換結果は品質ゲート（F0 連続性）を通過した場合のみ audioBase64 に格納する。
    品質ゲート不通過時は audioBase64=null, qualityGatePassed=false, withholdReason に理由を返す。
    HTTP ステータスは常に 200（ゲート判定は業務ロジック）。
    「自分の声」ではなく「汎用 VCTK ネイティブ声」への変換（M-GRV-7）。
    """
    if _convert_voice_use_case is None:
        raise HTTPException(
            status_code=503,
            detail="convert voice use case is not initialized",
        )

    # metadata をパースする
    try:
        ConvertMetadata.model_validate(json.loads(metadata))
    except Exception as parse_error:
        logger.error("metadata parse error: %s", parse_error)
        raise HTTPException(
            status_code=400,
            detail=f"metadata parse failed: {parse_error}",
        ) from parse_error

    # 音声バイナリを読み込む
    try:
        learner_audio_bytes = await learner_audio.read()
    except Exception as read_error:
        logger.error("audio read error: %s", read_error)
        raise HTTPException(
            status_code=400,
            detail=f"audio read failed: {read_error}",
        ) from read_error

    # ユースケースを実行する
    result = _convert_voice_use_case.execute(learner_audio_bytes=learner_audio_bytes)

    audio_base64: str | None = None
    if result.audio_bytes is not None:
        audio_base64 = base64.b64encode(result.audio_bytes).decode("ascii")

    return GoldenConversionResponse(
        audioBase64=audio_base64,
        qualityGatePassed=result.quality_gate_passed,
        withholdReason=result.withhold_reason,
        targetVoice=result.target_voice,
    )


# 型アノテーション用の forward reference を解決する
from golden_speaker.usecase.convert_voice import ConvertVoiceUseCase  # noqa: E402
