"""HTTP ルーター: GET /health + POST /v1/tts。

app.py の Composition Root で include_router して登録される。
/v1/analyze の実装は app.py の DI 結線後に追加される。
/v1/tts は Kokoro-82M TTS を使って General American 音声を合成する（C2, M-124）。
"""

import logging

from fastapi import APIRouter
from fastapi.responses import Response

from python_analyzer.infrastructure.kokoro_tts import synthesize_speech
from python_analyzer.interface.schema import HealthResponse, TtsRequest

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """ヘルスチェックエンドポイント。"""
    return HealthResponse(status="ok")


@router.post("/v1/tts")
async def tts(request: TtsRequest) -> Response:
    """お手本 TTS エンドポイント（C2, M-124）。

    Kokoro-82M で General American 音声を合成し audio/wav バイト列を返す。
    speed パラメータ（0.5–1.0）を反映する。speed が違えば音声長が変わる。
    """
    wav_bytes = synthesize_speech(text=request.text, speed=request.speed)
    return Response(content=wav_bytes, media_type="audio/wav")
