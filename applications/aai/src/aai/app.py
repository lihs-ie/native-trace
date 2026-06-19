"""FastAPI アプリケーション生成 + DI 結線（Composition Root）。

http_handler の router をここで include_router して
GET /health + POST /v1/articulatory-inversion を登録する（ORPHAN-E 配線点）。

articulatory import は infrastructure/articulatory_inversion.py のみ（ADR-019 封じ込め）。
モデル重みは HF_HOME volume 経由で供給（イメージ非焼込, M-GRV-10）。
"""

import logging

from fastapi import FastAPI

from aai.infrastructure.articulatory_inversion import ArticulatoryInversionEngine
from aai.interface import http_handler
from aai.usecase.invert_articulation import InvertArticulationUseCase

logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    """FastAPI アプリを生成して返す。

    infrastructure の実インスタンスを生成し、InvertArticulationUseCase に注入する。
    GET /health + POST /v1/articulatory-inversion の全 endpoint を include_router で登録する。
    """
    application = FastAPI(
        title="NativeTrace AAI Service",
        description=(
            "音響→調音逆推定 HTTP API（ADR-019）。"
            "学習者音声から articulatory/articulatory (Apache-2.0) で EMA 軌跡を推定し、"
            "6 wire 座標 + displayEligibility を音素ごとに返す。"
            "GPU-optional 隔離 service（profiles:[aai]）。"
        ),
        version="1.0.0",
    )

    # infrastructure の実インスタンスを生成する（articulatory import は engine 内のみ）
    engine = ArticulatoryInversionEngine()

    # usecase を生成する（Port 注入）
    use_case = InvertArticulationUseCase(engine=engine)

    # http_handler に usecase を DI する
    # （ORPHAN-E: include_router で /v1/articulatory-inversion を到達可能にする）
    http_handler.set_invert_articulation_use_case(use_case)

    # GET /health + POST /v1/articulatory-inversion を router から include する（ORPHAN-E 配線点）
    application.include_router(http_handler.router)

    return application


# モジュールレベルで app インスタンスを生成する（uvicorn のエントリポイント用）
app = create_app()
