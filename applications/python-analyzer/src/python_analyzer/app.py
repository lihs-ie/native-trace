"""FastAPI アプリケーション生成 + DI 結線（Composition Root）。

http_handler の router をここで include_router して
/health / /v1/tts / /v1/stimuli / /v1/analyze / /v1/shadowing-lag を登録する。
ルート定義は全て interface/http_handler.py に置き（W42）、
use case を要するルートは setter（set_analyze_pronunciation_use_case /
set_shadowing_lag_use_case）で DI する。
"""

from fastapi import FastAPI

from python_analyzer.infrastructure.dtw_lag import DtwLagComputer
from python_analyzer.infrastructure.espeak_g2p import EspeakG2P
from python_analyzer.infrastructure.prosody_analyzer import ProsodyAnalyzer
from python_analyzer.infrastructure.speech_rate import SpeechRateAnalyzer
from python_analyzer.infrastructure.wav2vec2_aligner import Wav2Vec2Aligner
from python_analyzer.interface import http_handler
from python_analyzer.usecase.analyze_pronunciation import AnalyzePronunciationUseCase
from python_analyzer.usecase.compute_shadowing_lag import ComputeShadowingLagUseCase


def create_app() -> FastAPI:
    """FastAPI アプリを生成して返す。

    infrastructure の実インスタンスを生成し、use case に注入する。
    /health, /v1/tts, /v1/stimuli, /v1/analyze, /v1/shadowing-lag の
    全 endpoint は http_handler.router の include_router で登録される。
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

    # 発音解析 usecase を生成して http_handler に DI する（W42: setter パターン）
    use_case = AnalyzePronunciationUseCase(
        g2p_port=g2p,
        aligner_port=aligner,
        speech_rate_port=speech_rate_analyzer,
        prosody_port=prosody_analyzer,
    )
    http_handler.set_analyze_pronunciation_use_case(use_case)

    # shadowing lag usecase を生成して http_handler に DI する（ADR-013 / M-SHL-1 ORPHAN-1）
    lag_computation = DtwLagComputer()
    shadowing_lag_use_case = ComputeShadowingLagUseCase(
        g2p_port=g2p,
        aligner_port=aligner,
        lag_computation_port=lag_computation,
    )
    http_handler.set_shadowing_lag_use_case(shadowing_lag_use_case)

    # 全 endpoint を http_handler router から include する
    application.include_router(http_handler.router)

    return application


# モジュールレベルで app インスタンスを生成する（uvicorn のエントリポイント用）
app = create_app()
