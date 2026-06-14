"""HTTP API スキーマ定義（契約、lock）。

GoldenConversionResponse は worker / frontend が参照する public contract。
フィールド名は camelCase（lock — worker/frontend がこれに合わせる）。
"""

from pydantic import BaseModel


class GoldenConversionResponse(BaseModel):
    """POST /v1/convert レスポンス（公開 contract、camelCase、lock）。

    audioBase64: 変換済み WAV を Base64 エンコードした文字列。
      品質ゲート不通過時は null。
    qualityGatePassed: 品質ゲートを通過した場合 True。
    withholdReason: ゲート不通過時の理由文字列（通過時は null）。
      例: "quality_gate_failed" / "model_unavailable"
    targetVoice: 変換に使用した VCTK 話者 id 等（UI 表示用）。
      「自分の声」と謳わない — 汎用 VCTK ネイティブ声（M-GRV-7）。
    """

    audioBase64: str | None  # noqa: N815
    qualityGatePassed: bool  # noqa: N815
    withholdReason: str | None  # noqa: N815
    targetVoice: str  # noqa: N815


class HealthResponse(BaseModel):
    """GET /health レスポンス。"""

    status: str


class ConvertMetadata(BaseModel):
    """POST /v1/convert の metadata フォームフィールド。"""

    mimeType: str  # noqa: N815
