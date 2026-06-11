"""FastAPI アプリケーション生成 + DI 結線（Composition Root）。

http_handler の router をここで include_router して /health を登録する。
/v1/analyze は Composition Root でインスタンス化された use_case を使って直接定義する。
"""

import json
import logging

from fastapi import FastAPI, File, Form, HTTPException, UploadFile

from python_analyzer.domain.audio import AudioInput
from python_analyzer.infrastructure.espeak_g2p import EspeakG2P
from python_analyzer.infrastructure.speech_rate import SpeechRateAnalyzer
from python_analyzer.infrastructure.wav2vec2_aligner import Wav2Vec2Aligner
from python_analyzer.interface import http_handler
from python_analyzer.interface.schema import (
    AnalysisMetadata,
    AnalysisResponse,
    ErrorDetail,
    ErrorResponse,
    InterWordSilenceResponse,
    PhonemeGopResponse,
    SchwaRealizationResponse,
)
from python_analyzer.usecase.analyze_pronunciation import AnalyzePronunciationUseCase


logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    """FastAPI アプリを生成して返す。

    infrastructure の実インスタンスを生成し、AnalyzePronunciationUseCase に注入する。
    /health と /v1/analyze の両 endpoint を登録する。
    """
    application = FastAPI(
        title="NativeTrace Python Analyzer",
        description="発音解析 HTTP API: espeak-ng g2p + wav2vec2 phoneme-CTC + 強制整列",
        version="1.0.0",
    )

    # infrastructure の実インスタンスを生成する
    g2p = EspeakG2P()
    aligner = Wav2Vec2Aligner()
    speech_rate_analyzer = SpeechRateAnalyzer()

    # usecase を生成する
    use_case = AnalyzePronunciationUseCase(
        g2p_port=g2p,
        aligner_port=aligner,
        speech_rate_port=speech_rate_analyzer,
    )

    # /health を http_handler router から include する
    application.include_router(http_handler.router)

    # /v1/analyze を Composition Root で直接定義して use_case を注入する
    @application.post(
        "/v1/analyze",
        response_model=AnalysisResponse,
        responses={
            500: {"model": ErrorResponse},
            400: {"model": ErrorResponse},
        },
    )
    async def analyze(
        audio: UploadFile = File(..., description="音声バイナリ（WAV/WebM/OGG）"),
        metadata: str = Form(..., description="application/json メタデータ"),
    ) -> AnalysisResponse:
        """発音解析エンドポイント。

        multipart/form-data で音声と metadata を受け取り生計測結果を返す。採点はしない。
        """
        # metadata を JSON パースする
        try:
            meta = AnalysisMetadata.model_validate(json.loads(metadata))
        except Exception as parse_error:
            logger.error("metadata パースエラー: %s", parse_error)
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
            audio_bytes = await audio.read()
        except Exception as read_error:
            logger.error("音声読み込みエラー: %s", read_error)
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

        audio_input = AudioInput(
            content=audio_bytes,
            mime_type=meta.mimeType,
            duration_milliseconds=meta.durationMilliseconds,
        )

        # ユースケースを実行する
        try:
            result = use_case.execute(
                audio=audio_input,
                reference_text=meta.referenceText,
                target_accent=meta.targetAccent,
            )
        except Exception as execution_error:
            logger.error("発音解析エラー: %s", execution_error, exc_info=True)
            raise HTTPException(
                status_code=500,
                detail=ErrorResponse(
                    error=ErrorDetail(
                        code="ANALYSIS_ERROR",
                        message=f"発音解析中にエラーが発生しました: {execution_error}",
                        retryable=True,
                    )
                ).model_dump(),
            ) from execution_error

        # per_phoneme_gop が空の場合は 500 を返す（task-contract §HTTP 契約）
        if not result.per_phoneme_gop:
            logger.error("per_phoneme_gop が空: 整列に失敗している可能性がある")
            raise HTTPException(
                status_code=500,
                detail=ErrorResponse(
                    error=ErrorDetail(
                        code="ALIGNMENT_FAILED",
                        message="音素整列に失敗しました（perPhonemeGop が空）",
                        retryable=True,
                    )
                ).model_dump(),
            )

        return AnalysisResponse(
            expectedIpa=result.expected_ipa.to_string(),
            detectedIpa=result.detected_ipa.to_string(),
            perPhonemeGop=[
                PhonemeGopResponse(
                    phoneme=gop_m.phoneme.value,
                    gop=gop_m.gop.value,
                    startMs=gop_m.start_milliseconds,
                    endMs=gop_m.end_milliseconds,
                )
                for gop_m in result.per_phoneme_gop
            ],
            interWordSilences=[
                InterWordSilenceResponse(
                    startMs=s.start_milliseconds,
                    endMs=s.end_milliseconds,
                    durationMs=s.duration_milliseconds,
                )
                for s in result.inter_word_silences
            ],
            schwaRealizations=[
                SchwaRealizationResponse(
                    phoneme=schwa.phoneme.value,
                    startMs=schwa.start_milliseconds,
                    endMs=schwa.end_milliseconds,
                    realized=schwa.realized,
                )
                for schwa in result.schwa_realizations
            ],
            speechRatePhonemePerSecond=result.speech_rate_phoneme_per_second,
        )

    return application


# モジュールレベルで app インスタンスを生成する（uvicorn のエントリポイント用）
app = create_app()
