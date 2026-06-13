"""HTTP ルーター: GET /health + POST /v1/tts + GET /v1/stimuli。

app.py の Composition Root で include_router して登録される。
/v1/analyze の実装は app.py の DI 結線後に追加される。
/v1/tts は Kokoro-82M TTS を使って General American 音声を合成する（C2, M-124）。
/v1/stimuli は ADR-009 の curated stimulus assets を配信する（REQ-122 / W-1）。
"""

import base64
import logging
import random
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from python_analyzer.infrastructure.kokoro_tts import (
    DEFAULT_VOICE,
    synthesize_speech,
)
from python_analyzer.interface.schema import (
    ErrorDetail,
    ErrorResponse,
    HealthResponse,
    StimulusMetadata,
    StimulusResponse,
    TtsRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """ヘルスチェックエンドポイント。"""
    return HealthResponse(status="ok")


@router.post("/v1/tts")
async def tts(request: TtsRequest) -> Response:
    """お手本 TTS エンドポイント（C2, M-124, ADR-009）。

    Kokoro-82M で General American 音声を合成し audio/wav バイト列を返す。
    speed パラメータ（0.5–1.0）を反映する。speed が違えば音声長が変わる。
    voice パラメータ省略時は af_heart（後方互換）。
    """
    resolved_voice = request.voice if request.voice is not None else DEFAULT_VOICE
    try:
        wav_bytes = synthesize_speech(
            text=request.text,
            speed=request.speed,
            voice=resolved_voice,
        )
    except ValueError as validation_error:
        raise HTTPException(
            status_code=422,
            detail=ErrorResponse(
                error=ErrorDetail(
                    code="INVALID_VOICE",
                    message=str(validation_error),
                    retryable=False,
                )
            ).model_dump(),
        ) from validation_error
    return Response(content=wav_bytes, media_type="audio/wav")


# ---------------------------------------------------------------------------
# Stimulus asset base directory.
# The path is determined at import time so it works both in Docker (build-time
# assets at /app/src/python_analyzer/assets/stimuli) and in local development
# (relative to this file's package location).
# ---------------------------------------------------------------------------
_ASSETS_DIR = Path(__file__).parent.parent / "assets" / "stimuli"


@router.get(
    "/v1/stimuli",
    response_model=list[StimulusResponse],
    summary="HVPT 刺激配信 (ADR-009 / REQ-122)",
    responses={
        200: {"description": "刺激メタデータ + WAV (Base64) のリスト"},
        404: {"model": ErrorResponse, "description": "指定対立の刺激が存在しない"},
        422: {"model": ErrorResponse, "description": "パラメータ不正"},
    },
)
async def get_stimuli(
    contrast: str = Query(
        ...,
        description=(
            "音素対立 (例: 'r-l', 'ae-ah', 'iy-ih', 'v-b', "
            "'th-s', 'dh-z', 'aa-ae', 's-sh')"
        ),
    ),
    context: str | None = Query(
        default=None,
        description="音韻文脈フィルタ: 'word-initial' / 'word-medial' / 'cluster'",
    ),
    limit: int = Query(
        default=10,
        ge=1,
        le=50,
        description="返す刺激の最大件数 (1–50)",
    ),
) -> list[StimulusResponse]:
    """HVPT 識別課題用の実刺激メタデータ + 音声を返す。

    ADR-009: curated natural speech (LibriTTS CC BY 4.0) + Kokoro 補完。
    偽刺激なし (agent-policy)。各刺激は帰属 manifest から取得する。

    REQ-122: >=5 話者・男女混在・複数音韻文脈を保証するには、
    carve パイプライン完了後に manifest が存在すること。
    """
    from python_analyzer.infrastructure.stimulus.asset_store import StimulusAssetStore
    from python_analyzer.infrastructure.stimulus.domain import PhonologicalContext

    store = StimulusAssetStore(_ASSETS_DIR)

    # Validate context parameter.
    phonological_context: PhonologicalContext | None = None
    if context is not None:
        try:
            phonological_context = PhonologicalContext(context)
        except ValueError as context_error:
            raise HTTPException(
                status_code=422,
                detail=ErrorResponse(
                    error=ErrorDetail(
                        code="INVALID_CONTEXT",
                        message=(
                            f"無効な context 値: {context!r}。"
                            "有効値: 'word-initial' / 'word-medial' / 'cluster'"
                        ),
                        retryable=False,
                    )
                ).model_dump(),
            ) from context_error

    try:
        records = store.query_stimuli(
            contrast=contrast,  # type: ignore[arg-type]
            context=phonological_context,
        )
    except FileNotFoundError as not_found_error:
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(
                error=ErrorDetail(
                    code="STIMULI_NOT_FOUND",
                    message=(
                        f"対立 '{contrast}' の刺激が見つかりません。"
                        "carve パイプラインを実行して manifest を生成してください。"
                    ),
                    retryable=False,
                )
            ).model_dump(),
        ) from not_found_error

    if not records:
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(
                error=ErrorDetail(
                    code="STIMULI_NOT_FOUND",
                    message=(
                        f"対立 '{contrast}'"
                        + (f", context='{context}'" if context else "")
                        + " に一致する刺激がありません。"
                    ),
                    retryable=False,
                )
            ).model_dump(),
        )

    # Shuffle for variability across sessions, then take limit.
    shuffled = list(records)
    random.shuffle(shuffled)
    selected = shuffled[:limit]

    responses: list[StimulusResponse] = []
    for record in selected:
        stimulus_id = record["stimulus_identifier"]
        try:
            wav_bytes = store.get_stimulus_wav_bytes(stimulus_id)
        except FileNotFoundError:
            logger.warning("Stimulus WAV missing for identifier: %s", stimulus_id)
            continue

        wav_base64 = base64.b64encode(wav_bytes).decode("ascii")

        metadata = StimulusMetadata(
            stimulusIdentifier=stimulus_id,
            contrast=record.get("contrast", ""),
            word=record.get("word", ""),
            speakerIdentifier=record.get("speaker_identifier", ""),
            speakerSex=record.get("speaker_sex", "unknown"),
            context=record.get("context", ""),
            sourceCorpus=record.get("source_corpus", ""),
            licenseIdentifier=record.get("license_identifier", ""),
        )

        responses.append(StimulusResponse(metadata=metadata, wavBase64=wav_base64))

    if not responses:
        raise HTTPException(
            status_code=404,
            detail=ErrorResponse(
                error=ErrorDetail(
                    code="STIMULI_NOT_FOUND",
                    message=(
                        "刺激 WAV ファイルが見つかりません。"
                        "Docker rebuild が必要な可能性があります。"
                    ),
                    retryable=True,
                )
            ).model_dump(),
        )

    return responses
