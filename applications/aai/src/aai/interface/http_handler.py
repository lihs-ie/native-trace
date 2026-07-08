"""HTTP ルーター: GET /health + POST /v1/articulatory-inversion。

app.py の Composition Root で include_router して登録される（ORPHAN-E 配線点）。
/v1/articulatory-inversion は multipart/form-data で learner_audio (音声バイト列) と
metadata (JSON 文字列) を受け取り ArticulatoryInversionResponse を返す。

audio を JSON に base64 で詰めないこと（golden の非対称を踏襲 — multipart request のみ）。
HTTP ステータスは常に 200（degrade 時は perPhoneme=[], ガードレールは worker 側）。
"""

import json
import logging

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from aai.interface.schema import (
    ArticulatoryEstimateResponse,
    ArticulatoryInversionResponse,
    HealthResponse,
    InversionMetadata,
)

logger = logging.getLogger(__name__)

router = APIRouter()

# Composition Root から注入される InvertArticulationUseCase（型注釈は forward reference で解決）
_invert_articulation_use_case: "InvertArticulationUseCase | None" = None


def set_invert_articulation_use_case(use_case: "InvertArticulationUseCase") -> None:
    """Composition Root から InvertArticulationUseCase を注入する。

    app.py の create_app() が呼び出す。
    """
    global _invert_articulation_use_case  # noqa: PLW0603
    _invert_articulation_use_case = use_case


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """ヘルスチェックエンドポイント。"""
    return HealthResponse(status="ok")


@router.post(
    "/v1/articulatory-inversion",
    response_model=ArticulatoryInversionResponse,
    summary="調音逆推定 (ADR-019 / M-AAI-2)",
    responses={
        503: {"description": "Use case not initialized"},
        400: {"description": "Invalid request"},
    },
)
async def articulatory_inversion(
    learner_audio: UploadFile = File(  # noqa: B008
        ..., description="学習者音声（WAV バイト列）"
    ),
    metadata: str = Form(  # noqa: B008
        ..., description="application/json: {mimeType, sampleRate, boundaries}"
    ),
) -> ArticulatoryInversionResponse:
    """調音逆推定エンドポイント（ADR-019 / M-AAI-2）。

    learner_audio（学習者音声）から articulatory/articulatory (Apache-2.0) で
    EMA 軌跡を推定し、6 wire 座標 + displayEligibility を音素ごとに返す。

    HTTP ステータスは常に 200（モデル不在・推論失敗時は perPhoneme=[]、
    D4 ガードレールは worker 側で適用する）。

    Request は multipart/form-data のみ受け付ける。JSON base64 body は受け付けない
    （golden の非対称を踏襲、M-AAI-2 contract）。
    """
    if _invert_articulation_use_case is None:
        raise HTTPException(
            status_code=503,
            detail="invert articulation use case is not initialized",
        )

    # metadata をパースする
    try:
        parsed_metadata = InversionMetadata.model_validate(json.loads(metadata))
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

    # boundaries を dict 形式に変換する
    boundaries = [
        {"phoneme": b.phoneme, "startMs": b.startMs, "endMs": b.endMs}
        for b in parsed_metadata.boundaries
    ]

    # ユースケースを実行する
    result = _invert_articulation_use_case.execute(
        learner_audio_bytes=learner_audio_bytes,
        sample_rate=parsed_metadata.sampleRate,
        boundaries=boundaries,
    )

    per_phoneme_responses = [
        ArticulatoryEstimateResponse(
            phoneme=estimate.phoneme,
            startMs=estimate.start_ms,
            endMs=estimate.end_ms,
            tongueTipX=estimate.tongue_tip_x,
            tongueTipY=estimate.tongue_tip_y,
            tongueDorsumX=estimate.tongue_dorsum_x,
            tongueDorsumY=estimate.tongue_dorsum_y,
            lipApertureX=estimate.lip_aperture_x,
            lipApertureY=estimate.lip_aperture_y,
            displayEligibility=estimate.display_eligibility,
        )
        for estimate in result.per_phoneme
    ]

    return ArticulatoryInversionResponse(perPhoneme=per_phoneme_responses)


# 型アノテーション用の forward reference を解決する
from aai.usecase.invert_articulation import InvertArticulationUseCase  # noqa: E402
