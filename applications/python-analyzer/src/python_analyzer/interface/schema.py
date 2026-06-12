"""HTTP API スキーマ定義（Pydantic）。

Haskell worker から呼べる確定仕様（task-contract §HTTP 契約）に準拠。
"""

from pydantic import BaseModel, Field


class AnalysisMetadata(BaseModel):
    """POST /v1/analyze の metadata パート。"""

    referenceText: str = Field(description="参照テキスト（例: Hello, world.）")
    targetAccent: str = Field(default="generalAmerican", description="アクセント指定")
    mimeType: str = Field(description="音声 MIME タイプ（例: audio/wav）")
    durationMilliseconds: int = Field(description="音声の長さ（ミリ秒）")


class PhonemeGopResponse(BaseModel):
    """1 音素の GOP 計測値レスポンス。"""

    phoneme: str
    gop: float
    startMs: int
    endMs: int


class InterWordSilenceResponse(BaseModel):
    """単語間無音区間レスポンス。"""

    startMs: int
    endMs: int
    durationMs: int


class SchwaRealizationResponse(BaseModel):
    """シュワ音実現レスポンス。"""

    phoneme: str
    startMs: int
    endMs: int
    realized: bool


class AnalysisResponse(BaseModel):
    """POST /v1/analyze の成功レスポンス。"""

    expectedIpa: str
    detectedIpa: str
    perPhonemeGop: list[PhonemeGopResponse]
    interWordSilences: list[InterWordSilenceResponse]
    schwaRealizations: list[SchwaRealizationResponse]
    speechRatePhonemePerSecond: float
    # 録音品質計測値（採点はしない。低品質判定は Haskell worker が行う）。
    meanDbfs: float = Field(default=0.0, description="波形 RMS の dBFS 値（0 dBFS = フルスケール）")
    speechDurationSeconds: float = Field(
        default=0.0, description="forced_align 非 blank フレームから推定した実音声長（秒）"
    )


class ErrorDetail(BaseModel):
    """エラー詳細。"""

    code: str
    message: str
    retryable: bool


class ErrorResponse(BaseModel):
    """4xx/5xx エラーレスポンス。"""

    error: ErrorDetail


class HealthResponse(BaseModel):
    """GET /health レスポンス。"""

    status: str
