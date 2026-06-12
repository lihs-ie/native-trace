"""HTTP ルーター: POST /v1/analyze と GET /health。

app.py の Composition Root で include_router して登録される。
/v1/analyze の実装は app.py の DI 結線後に追加される。
"""

import logging

from fastapi import APIRouter

from python_analyzer.interface.schema import HealthResponse

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """ヘルスチェックエンドポイント。"""
    return HealthResponse(status="ok")
