"""FastAPI アプリケーション生成 + DI 結線（Composition Root）。

http_handler の router をここで include_router して
/health / /v1/tts / /v1/shadowing-lag を登録する。
/v1/analyze は Composition Root でインスタンス化された use_case を使って直接定義する。
C1 全フィールド（NBest/F0/wordStress/rhythm/weakForm/syllables）を AnalysisResponse に組み込む。
/v1/shadowing-lag は http_handler.router 経由で登録し use_case を DI する（ADR-013 / M-SHL-1）。
"""

import json
import logging

from fastapi import FastAPI, File, Form, HTTPException, UploadFile

from python_analyzer.domain.audio import AudioInput
from python_analyzer.infrastructure.espeak_g2p import EspeakG2P
from python_analyzer.infrastructure.prosody_analyzer import ProsodyAnalyzer
from python_analyzer.infrastructure.speech_rate import SpeechRateAnalyzer
from python_analyzer.infrastructure.wav2vec2_aligner import Wav2Vec2Aligner
from python_analyzer.interface import http_handler
from python_analyzer.interface.schema import (
    AnalysisMetadata,
    AnalysisResponse,
    ErrorDetail,
    ErrorResponse,
    F0ContourResponse,
    InsertedVowelResponse,
    InterWordSilenceResponse,
    NBestCandidateResponse,
    PhonemeAcousticResponse,
    PhonemeGopResponse,
    RhythmResponse,
    SchwaRealizationResponse,
    SyllableResponse,
    WeakFormRealizationResponse,
    WordStressResponse,
)
from python_analyzer.usecase.analyze_pronunciation import AnalyzePronunciationUseCase
from python_analyzer.usecase.compute_shadowing_lag import ComputeShadowingLagUseCase

logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    """FastAPI アプリを生成して返す。

    infrastructure の実インスタンスを生成し、AnalyzePronunciationUseCase に注入する。
    /health, /v1/tts, /v1/analyze, /v1/shadowing-lag の全 endpoint を登録する。
    """
    application = FastAPI(
        title="NativeTrace Python Analyzer",
        description="発音解析 HTTP API: espeak-ng g2p + wav2vec2 phoneme-CTC + 強制整列 + 韻律計測",
        version="2.0.0",
    )

    # infrastructure の実インスタンスを生成する
    g2p = EspeakG2P()
    aligner = Wav2Vec2Aligner()
    speech_rate_analyzer = SpeechRateAnalyzer()
    prosody_analyzer = ProsodyAnalyzer()

    # usecase を生成する（ProsodyPort 注入）
    use_case = AnalyzePronunciationUseCase(
        g2p_port=g2p,
        aligner_port=aligner,
        speech_rate_port=speech_rate_analyzer,
        prosody_port=prosody_analyzer,
    )

    # shadowing lag usecase を生成して http_handler に DI する（ADR-013 / M-SHL-1 ORPHAN-1）
    shadowing_lag_use_case = ComputeShadowingLagUseCase(
        g2p_port=g2p,
        aligner_port=aligner,
    )
    http_handler.set_shadowing_lag_use_case(shadowing_lag_use_case)

    # /health, /v1/tts, /v1/stimuli, /v1/shadowing-lag を http_handler router から include する
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
        C1 全フィールド（NBest/F0/wordStress/rhythm/weakForm/syllables）を返す。
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
                include_reference_f0=meta.includeReferenceF0,
                speaker_sex=meta.speakerSex,
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

        # C1-b F0 輪郭を schema に変換する
        f0_contour_response: F0ContourResponse | None = None
        if result.f0_contour is not None:
            f0_contour_response = F0ContourResponse(
                timesMs=list(result.f0_contour.times_milliseconds),
                valuesHz=list(result.f0_contour.values_hz),
            )

        # M-F0REF-a: reference F0 輪郭を schema に変換する（既存 F0ContourResponse 型を再利用）
        reference_f0_contour_response: F0ContourResponse | None = None
        if result.reference_f0_contour is not None:
            reference_f0_contour_response = F0ContourResponse(
                timesMs=list(result.reference_f0_contour.times_milliseconds),
                valuesHz=list(result.reference_f0_contour.values_hz),
            )

        # C1-d リズムを schema に変換する
        rhythm_response: RhythmResponse | None = None
        if result.rhythm is not None:
            rhythm_response = RhythmResponse(
                npviVocalic=result.rhythm.npvi_vocalic,
                referenceNpviVocalic=result.rhythm.reference_npvi_vocalic,
            )

        return AnalysisResponse(
            expectedIpa=result.expected_ipa.to_string(),
            detectedIpa=result.detected_ipa.to_string(),
            # C1-a nBest + M-102R-b wordPosition を含む perPhonemeGop
            perPhonemeGop=[
                PhonemeGopResponse(
                    phoneme=gop_m.phoneme.value,
                    gop=gop_m.gop.value,
                    startMs=gop_m.start_milliseconds,
                    endMs=gop_m.end_milliseconds,
                    nBest=[
                        NBestCandidateResponse(
                            phoneme=candidate.phoneme,
                            confidence=candidate.confidence,
                        )
                        for candidate in gop_m.n_best
                    ],
                    wordPosition=gop_m.word_position,
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
            meanDbfs=result.mean_dbfs,
            speechDurationSeconds=result.speech_duration_seconds,
            # C1-b F0
            f0Contour=f0_contour_response,
            # M-F0REF-a: お手本 F0 輪郭（Kokoro TTS + parselmouth）
            referenceF0Contour=reference_f0_contour_response,
            # C1-c 語強勢
            wordStress=[
                WordStressResponse(
                    word=ws.word,
                    wordIndex=ws.word_index,
                    startMs=ws.start_milliseconds,
                    endMs=ws.end_milliseconds,
                    expectedStress=ws.expected_stress,
                    predictedStress=ws.predicted_stress,
                )
                for ws in result.word_stresses
            ],
            # C1-d リズム
            rhythm=rhythm_response,
            # C1-e 弱形実現
            weakFormRealizations=[
                WeakFormRealizationResponse(
                    word=wf.word,
                    wordIndex=wf.word_index,
                    startMs=wf.start_milliseconds,
                    endMs=wf.end_milliseconds,
                    expectedWeak=wf.expected_weak,
                    realizedWeak=wf.realized_weak,
                )
                for wf in result.weak_form_realizations
            ],
            # C1-f 音節
            syllables=[
                SyllableResponse(
                    word=syl.word,
                    wordIndex=syl.word_index,
                    expectedSyllableCount=syl.expected_syllable_count,
                    actualSyllableCount=syl.actual_syllable_count,
                    insertedVowels=[
                        InsertedVowelResponse(
                            positionMs=iv.position_milliseconds,
                            vowel=iv.vowel,
                        )
                        for iv in syl.inserted_vowels
                    ],
                )
                for syl in result.syllables
            ],
            # M-APD-7: per-phoneme 音響計測を AnalysisResponse にマップする（ADR-018 D1）
            phonemeAcoustics=[
                PhonemeAcousticResponse(
                    phoneme=acoustic_measurement.phoneme,
                    startMs=acoustic_measurement.start_milliseconds,
                    endMs=acoustic_measurement.end_milliseconds,
                    f1Hz=acoustic_measurement.f1_hz,
                    f2Hz=acoustic_measurement.f2_hz,
                    f3Hz=acoustic_measurement.f3_hz,
                    spectralCentroidHz=acoustic_measurement.spectral_centroid_hz,
                    durationMs=acoustic_measurement.duration_milliseconds,
                )
                for acoustic_measurement in result.phoneme_acoustics
            ],
            # M-APD-6 / M-APD-11: speakerSex を echo する（worker が Hillenbrand ノルム照合に使用）
            speakerSex=meta.speakerSex,
        )

    return application


# モジュールレベルで app インスタンスを生成する（uvicorn のエントリポイント用）
app = create_app()
