"""HTTP ルーター: GET /health + POST /v1/tts + GET /v1/stimuli + POST /v1/shadowing-lag。

app.py の Composition Root で include_router して登録される。
/v1/analyze の実装は app.py の DI 結線後に追加される。
/v1/tts は Kokoro-82M TTS を使って General American 音声を合成する（C2, M-124）。
/v1/stimuli は ADR-009 の curated stimulus assets を配信する（REQ-122 / W-1）。
/v1/shadowing-lag は ADR-013 の DTW ラグ計測エンドポイントを提供する（M-SHL-1）。
"""

import base64
import json
import logging
import random
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response

from python_analyzer.infrastructure.kokoro_tts import (
    DEFAULT_VOICE,
    synthesize_speech,
)
from python_analyzer.interface.schema import (
    ErrorDetail,
    ErrorResponse,
    HealthResponse,
    PerSegmentLagResponse,
    ShadowingLagMetadata,
    ShadowingLagResponse,
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


# ---------------------------------------------------------------------------
# Shadowing lag measurement endpoint (ADR-013 / M-SHL-1).
# DI は app.py の Composition Root で行う。
# ここでは router に endpoint を定義して include_router で結線する。
# ---------------------------------------------------------------------------

# Composition Root から注入された ComputeShadowingLagUseCase を保持する module-level 変数。
# app.py の create_app() が set_shadowing_lag_use_case() で設定する。
_shadowing_lag_use_case: "ComputeShadowingLagUseCase | None" = None


def set_shadowing_lag_use_case(use_case: "ComputeShadowingLagUseCase") -> None:  # noqa: ANN001
    """Composition Root から shadowing lag use case を注入する。

    app.py の create_app() が呼び出す。
    """
    global _shadowing_lag_use_case  # noqa: PLW0603
    _shadowing_lag_use_case = use_case


@router.post(
    "/v1/shadowing-lag",
    response_model=ShadowingLagResponse,
    responses={
        400: {"model": ErrorResponse},
        500: {"model": ErrorResponse},
    },
    summary="シャドーイングラグ計測 (ADR-013 / M-SHL-1)",
)
async def shadowing_lag(  # noqa: B008
    reference_audio: UploadFile = File(  # noqa: B008
        ..., description="お手本音声（WAV バイト列; Kokoro TTS 生成済み）"
    ),
    learner_audio: UploadFile = File(  # noqa: B008
        ..., description="学習者録音（WAV バイト列）"
    ),
    metadata: str = Form(  # noqa: B008
        ..., description="application/json: {referenceText, mimeType, durationMilliseconds}"
    ),
) -> ShadowingLagResponse:
    """シャドーイングラグ計測エンドポイント（ADR-013）。

    reference_audio（お手本）と learner_audio（学習者）を
    wav2vec2 強制整列 + DTW で対応づけ、追随ラグ（ミリ秒）を計測して返す。
    lagMilliseconds は実音声由来の計測値（固定値・乱数禁止: ADR-013 制約）。
    """
    from python_analyzer.domain.audio import AudioInput

    if _shadowing_lag_use_case is None:
        raise HTTPException(
            status_code=500,
            detail=ErrorResponse(
                error=ErrorDetail(
                    code="USE_CASE_NOT_INITIALIZED",
                    message="shadowing lag use case が初期化されていません",
                    retryable=False,
                )
            ).model_dump(),
        )

    # metadata をパースする
    try:
        meta = ShadowingLagMetadata.model_validate(json.loads(metadata))
    except Exception as parse_error:
        logger.error("shadowing-lag metadata パースエラー: %s", parse_error)
        raise HTTPException(
            status_code=400,
            detail=ErrorResponse(
                error=ErrorDetail(
                    code="INVALID_METADATA",
                    message=f"metadata のパースに失敗しました: {parse_error}",
                    retryable=False,
                )
            ).model_dump(),
        ) from parse_error

    # 音声バイナリを読み込む
    try:
        reference_audio_bytes = await reference_audio.read()
        learner_audio_bytes = await learner_audio.read()
    except Exception as read_error:
        logger.error("shadowing-lag 音声読み込みエラー: %s", read_error)
        raise HTTPException(
            status_code=400,
            detail=ErrorResponse(
                error=ErrorDetail(
                    code="AUDIO_READ_ERROR",
                    message=f"音声の読み込みに失敗しました: {read_error}",
                    retryable=True,
                )
            ).model_dump(),
        ) from read_error

    reference_audio_input = AudioInput(
        content=reference_audio_bytes,
        mime_type=meta.mimeType,
        duration_milliseconds=meta.durationMilliseconds,
    )
    learner_audio_input = AudioInput(
        content=learner_audio_bytes,
        mime_type=meta.mimeType,
        duration_milliseconds=meta.durationMilliseconds,
    )

    # ユースケースを実行する
    try:
        result = _shadowing_lag_use_case.execute(
            reference_audio=reference_audio_input,
            learner_audio=learner_audio_input,
            reference_text=meta.referenceText,
        )
    except Exception as execution_error:
        logger.error("shadowing-lag 計測エラー: %s", execution_error, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=ErrorResponse(
                error=ErrorDetail(
                    code="LAG_MEASUREMENT_ERROR",
                    message=f"シャドーイングラグ計測中にエラーが発生しました: {execution_error}",
                    retryable=True,
                )
            ).model_dump(),
        ) from execution_error

    return ShadowingLagResponse(
        lagMilliseconds=result.lag_milliseconds,
        perSegmentLag=[
            PerSegmentLagResponse(
                phoneme=segment.phoneme,
                lagMilliseconds=segment.lag_milliseconds,
            )
            for segment in result.per_segment_lag
        ],
        speechRateRatio=result.speech_rate_ratio,
        pauseCountLearner=result.pause_count_learner,
        pauseCountReference=result.pause_count_reference,
    )


# 型アノテーション用の forward reference を解決する
from python_analyzer.usecase.compute_shadowing_lag import ComputeShadowingLagUseCase  # noqa: E402
