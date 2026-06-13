"""HTTP API スキーマ定義（Pydantic）。

Haskell worker から呼べる確定仕様（task-contract §HTTP 契約）に準拠。
全フィールド camelCase（wire-contracts.md C1/C2 準拠）。
"""

from pydantic import BaseModel, Field


class AnalysisMetadata(BaseModel):
    """POST /v1/analyze の metadata パート。"""

    referenceText: str = Field(description="参照テキスト（例: Hello, world.）")
    targetAccent: str = Field(default="generalAmerican", description="アクセント指定")
    mimeType: str = Field(description="音声 MIME タイプ（例: audio/wav）")
    durationMilliseconds: int = Field(description="音声の長さ（ミリ秒）")


# --- C1-a NBest ---


class NBestCandidateResponse(BaseModel):
    """CTC logits の上位候補（1 件分）。"""

    phoneme: str
    confidence: float = Field(description="softmax 確率 0–1")


class PhonemeGopResponse(BaseModel):
    """1 音素の GOP 計測値レスポンス（C1-a nBest 追加）。"""

    phoneme: str
    gop: float
    startMs: int
    endMs: int
    nBest: list[NBestCandidateResponse] = Field(
        default_factory=list,
        description="CTC logits 上位候補。確率降順、len>=3（C1-a）。",
    )
    # M-102R-b / C-A2W: 単語内位置。JSON key は wordPosition（camelCase 既定）。
    # 値: "initial" | "medial" | "final"。取得前は null。
    wordPosition: str | None = Field(
        default=None,
        description='単語内位置。"initial" | "medial" | "final"。C-A2W 契約。',
    )


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


# --- C1-b F0 ---


class F0ContourResponse(BaseModel):
    """F0 輪郭レスポンス（C1-b）。"""

    timesMs: list[int] = Field(description="フレーム時刻（発話開始基準）")
    valuesHz: list[float] = Field(description="F0 値。無声フレームは 0。timesMs と同長")


# --- C1-c wordStress ---


class WordStressResponse(BaseModel):
    """単語ごとの強勢計測値（C1-c）。"""

    word: str
    wordIndex: int = Field(description="0始まり、本文トークン順")
    startMs: int
    endMs: int
    expectedStress: int = Field(
        description="0=無強勢 / 1=第1強勢 / 2=第2強勢（espeak 強勢記号から）"
    )
    predictedStress: int = Field(description="F0/強度/持続時間からの実測推定 0/1/2")


# --- C1-d rhythm ---


class RhythmResponse(BaseModel):
    """リズム指標レスポンス（C1-d）。"""

    npviVocalic: float = Field(description="母音持続時間の nPVI（英語高/日本語低）")
    referenceNpviVocalic: float = Field(
        description="英語参照帯の代表値（定数）。UI のリズムバー参照線用"
    )


# --- C1-e weakFormRealizations ---


class WeakFormRealizationResponse(BaseModel):
    """機能語弱形実現レスポンス（C1-e）。"""

    word: str
    wordIndex: int
    startMs: int
    endMs: int
    expectedWeak: bool = Field(description="機能語なので基本 true")
    realizedWeak: bool = Field(description="schwa 化 + 短縮していれば true")


# --- C1-f syllables ---


class InsertedVowelResponse(BaseModel):
    """挿入母音（epenthesis）レスポンス。"""

    positionMs: int
    vowel: str = Field(description="挿入母音 IPA（[ɯ]/[o]/[i] 等）")


class SyllableResponse(BaseModel):
    """単語ごとの音節数計測値（C1-f）。"""

    word: str
    wordIndex: int
    expectedSyllableCount: int = Field(description="辞書音節数（espeak の母音核カウント）")
    actualSyllableCount: int = Field(description="検出音素列の母音核カウント")
    insertedVowels: list[InsertedVowelResponse] = Field(
        default_factory=list,
        description="挿入母音 IPA と位置。無ければ []",
    )


# --- TTS リクエスト ---


class TtsRequest(BaseModel):
    """POST /v1/tts リクエスト（C2）。

    ADR-009: voice は optional（省略時 af_heart）。既存呼び出し元との後方互換を維持する。
    """

    text: str = Field(description="合成対象テキスト")
    speed: float = Field(default=1.0, ge=0.5, le=1.0, description="再生速度 0.5–1.0")
    voice: str | None = Field(
        default=None,
        description=(
            "Kokoro voice ID（省略時は af_heart）。"
            "af_heart / af_bella / af_nicole / af_aoede / af_sarah / af_sky / "
            "af_alloy / af_nova / af_shimmer / af_jessica / af_kore / "
            "am_michael / am_puck / am_fenrir / am_echo / am_eric / "
            "am_liam / am_onyx / am_adam / am_santa"
        ),
    )


# --- 主レスポンス ---


class AnalysisResponse(BaseModel):
    """POST /v1/analyze の成功レスポンス（C1 全フィールド追加）。"""

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
    # C1-b F0 輪郭（parselmouth）
    f0Contour: F0ContourResponse | None = Field(
        default=None, description="F0 輪郭（parselmouth）"
    )
    # C1-c 語強勢
    wordStress: list[WordStressResponse] = Field(
        default_factory=list, description="語強勢の期待値と実測値（単語単位）"
    )
    # C1-d リズム
    rhythm: RhythmResponse | None = Field(default=None, description="nPVI リズム指標")
    # C1-e 弱形実現
    weakFormRealizations: list[WeakFormRealizationResponse] = Field(
        default_factory=list,
        description="機能語の弱形実現（C1-e）。既存 schwaRealizations を補強",
    )
    # C1-f 音節
    syllables: list[SyllableResponse] = Field(
        default_factory=list, description="音節数と epenthesis 検出（C1-f）"
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


# --- HVPT 刺激配信 (ADR-009 / REQ-122) ---


class StimulusMetadata(BaseModel):
    """HVPT 刺激の帰属・コンテキストメタデータ。

    ADR-009: 各刺激は source corpus / license / speaker / context を保持する。
    CC BY 4.0 帰属義務を manifest で満たす。
    """

    stimulusIdentifier: str = Field(description="刺激の一意識別子文字列")
    contrast: str = Field(description="音素対立 (例: 'r-l', 'ae-ah')")
    word: str = Field(description="刺激の語形 (例: 'right', 'light')")
    speakerIdentifier: str = Field(description="話者 ID (LibriTTS speaker ID or Kokoro voice ID)")
    speakerSex: str = Field(description="話者性別: 'F' / 'M' / 'unknown'")
    context: str = Field(description="音韻文脈: 'word-initial' / 'word-medial' / 'cluster'")
    sourceCorpus: str = Field(description="音源コーパス (例: 'LibriTTS train-clean-100')")
    licenseIdentifier: str = Field(description="ライセンス識別子 (例: 'CC-BY-4.0')")


class StimulusResponse(BaseModel):
    """GET /v1/stimuli の 1 刺激レスポンス。

    音声バイナリは Base64 エンコードして wavBase64 に格納する。
    """

    metadata: StimulusMetadata
    wavBase64: str = Field(description="WAV バイナリの Base64 エンコード文字列")
