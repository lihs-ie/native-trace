"""HTTP API スキーマ定義（契約、lock）。

ArticulatoryInversionResponse は worker / frontend が参照する public contract。
フィールド名は camelCase（lock — worker/frontend がこれに合わせる）。

下顎切歯・舌体チャネル・生 mm・モデル内部 EMA index は絶対に露出しない（M-AAI-7）。
常に 6 座標（tongueTip/tongueDorsum/lipAperture XY）+ displayEligibility のみ。
"""

from pydantic import BaseModel


class ArticulatoryEstimateResponse(BaseModel):
    """per-phoneme の調音推定値（公開 contract、camelCase、lock）。

    座標はすべて発話内 z-score 正規化済み [-1.0, 1.0] の値（生 mm ではない）。
    displayEligibility はモデルの予測分散ではなく EMA 軌跡プロキシ [0.0, 1.0]。

    下顎切歯・舌体チャネル・生 mm・モデル内部 EMA index は露出しない（M-AAI-7）。
    """

    phoneme: str
    startMs: int  # noqa: N815
    endMs: int  # noqa: N815
    tongueTipX: float  # noqa: N815
    tongueTipY: float  # noqa: N815
    tongueDorsumX: float  # noqa: N815
    tongueDorsumY: float  # noqa: N815
    lipApertureX: float  # noqa: N815
    lipApertureY: float  # noqa: N815
    displayEligibility: float  # noqa: N815


class ArticulatoryInversionResponse(BaseModel):
    """POST /v1/articulatory-inversion レスポンス（公開 contract、camelCase、lock）。

    perPhoneme: 音素ごとの調音推定値リスト。
      graceful degrade 時（モデル不在・推論失敗）は空リスト。
      HTTP ステータスは常に 200（D4 ガードレールは worker 側で適用）。
    """

    perPhoneme: list[ArticulatoryEstimateResponse]  # noqa: N815


class HealthResponse(BaseModel):
    """GET /health レスポンス。"""

    status: str


class BoundaryInput(BaseModel):
    """metadata の音素境界要素。"""

    phoneme: str
    startMs: int  # noqa: N815
    endMs: int  # noqa: N815


class InversionMetadata(BaseModel):
    """POST /v1/articulatory-inversion の metadata フォームフィールド。"""

    mimeType: str  # noqa: N815
    sampleRate: int  # noqa: N815
    boundaries: list[BoundaryInput]
