"""HTTP API スキーマ定義（Pydantic）。

Haskell worker から呼べる確定仕様（task-contract §HTTP 契約）に準拠。
全フィールド camelCase（wire-contracts.md C1/C2 準拠）。
"""

from typing import Literal

from pydantic import BaseModel, Field


class AnalysisMetadata(BaseModel):
    """POST /v1/analyze の metadata パート。"""

    referenceText: str = Field(description="参照テキスト（例: Hello, world.）")
    targetAccent: str = Field(default="generalAmerican", description="アクセント指定")
    mimeType: str = Field(description="音声 MIME タイプ（例: audio/wav）")
    durationMilliseconds: int = Field(description="音声の長さ（ミリ秒）")
    # M-F0REF-a (optional): False のとき reference F0 計算をスキップして None を返す。
    # default True で後方互換。section cache が不要な再計算を避けるために使用する。
    includeReferenceF0: bool = Field(
        default=True,
        description="True のとき referenceText を Kokoro TTS 合成して reference F0 を抽出する",
    )
    # M-APD-6: 話者性別（ADR-009 / ADR-018 D1–D3）。
    # 値集合は 'F' / 'M' / 'unknown' のみ（'male'/'female' は使用しないこと）。
    # 省略時は "unknown"（後方互換）。maximum_formant_hz 選択に使用する（ADR-018 D2）。
    speakerSex: Literal["F", "M", "unknown"] = Field(
        default="unknown",
        description="話者性別: 'F' / 'M' / 'unknown'（ADR-009 値集合）",
    )


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


# --- M-APD-6: per-phoneme 音響計測レスポンス (ADR-018 D1–D3) ---


class PhonemeAcousticResponse(BaseModel):
    """1 音素あたりのフォルマント・スペクトル重心・持続時間計測レスポンス（ADR-018 D1）。

    全フィールド camelCase（wire-contracts.md 準拠）。
    Haskell worker の AnalyzerClient.hs PhonemeAcoustic FromJSON と一致すること。
    """

    phoneme: str
    startMs: int
    endMs: int
    # フォルマント周波数 Hz。40ms 未満区間では None（ADR-018 D3 ガード）。
    f1Hz: float | None
    f2Hz: float | None
    f3Hz: float | None
    # スペクトル重心 Hz。30ms 未満区間では None（ADR-018 D3 ガード）。
    spectralCentroidHz: float | None
    # 持続時間は境界差分で常に算出（ガードなし）。
    durationMs: int


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
    meanDbfs: float = Field(
        default=0.0,
        description=(
            "発話区間フレーム RMS の dBFS 値（代表的な発話ラウドネス; ADR-015 D1）。"
            "energy-VAD（320 サンプル / 20ms フレーム）で抽出した発話区間のみの RMS を"
            "20 * log10(rms) で変換する。語間ポーズや末尾無音は除外される。"
            "発話区間フレームが 0 件（no-speech）の場合は -100.0 dBFS（番兵値）。"
        ),
    )
    estimatedSnrDb: float = Field(
        description=(
            "WADA-SNR（Kim & Stern 2008）による reference-free SNR 推定値（dB）。"
            "発話区間サンプルの振幅分布形状（Gamma shape）から加性ガウス雑音下での SNR を推定する。"
            "発話区間フレームが 0 件（no-speech）の場合は -120.0（番兵値）。"
            "worker が audioQualityMinSnrDb ゲートで使用する（ADR-032 D2）。"
        ),
    )
    speechDurationSeconds: float = Field(
        default=0.0, description="forced_align 非 blank フレームから推定した実音声長（秒）"
    )
    # C1-b F0 輪郭（parselmouth）
    f0Contour: F0ContourResponse | None = Field(default=None, description="F0 輪郭（parselmouth）")
    # M-F0REF-a: お手本（referenceText）の Kokoro TTS 音声から抽出した F0 輪郭。
    # 既存 F0ContourResponse 型を再利用（同一 JSON 形状: timesMs / valuesHz）。
    # 抽出不可時は null（後方互換・reference 不在時に学習者経路を壊さない）。
    referenceF0Contour: F0ContourResponse | None = Field(
        default=None, description="お手本 F0 輪郭（Kokoro TTS + parselmouth）"
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
    # M-APD-6: per-phoneme 音響計測（ADR-018 D1–D3）
    # Haskell worker が AnalyzerResult.analyzedPhonemeAcoustics として FromJSON する。
    phonemeAcoustics: list[PhonemeAcousticResponse] = Field(
        default_factory=list,
        description="per-phoneme フォルマント・スペクトル重心・持続時間計測（ADR-018 D1）",
    )
    # M-APD-6 / M-APD-11: speakerSex を analyzer→worker に echo する
    # （ADR-018 D1 AnalyzerResult 経由）。
    # worker が hillenbrandGaVowelFormants ノルム照合に使用する（ADR-018 D4）。
    # S-APD-4 拡張点: 将来 re-record delta 表示（D9）で acousticEvidence との diff 追跡に利用可能。
    speakerSex: str = Field(
        default="unknown",
        description="話者性別 echo: 'F' / 'M' / 'unknown'（ADR-009 値集合）。"
        "worker が偏差判定に使用",
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


# --- シャドーイングラグ計測 (ADR-013) ---


class ShadowingLagMetadata(BaseModel):
    """POST /v1/shadowing-lag の metadata パート。"""

    referenceText: str = Field(description="両音声が発話しているテキスト（アライナーが要求）")
    mimeType: str = Field(description="音声 MIME タイプ（例: audio/wav）")
    durationMilliseconds: int = Field(description="音声の長さ（ミリ秒）")


class PerSegmentLagResponse(BaseModel):
    """音素単位のラグ計測値。"""

    phoneme: str = Field(description="音素ラベル（IPA）")
    lagMilliseconds: float = Field(description="この音素の追随ラグ（ミリ秒、正=学習者が遅い）")


class ShadowingLagResponse(BaseModel):
    """POST /v1/shadowing-lag の成功レスポンス（ADR-013）。

    lagMilliseconds: DTW 音素境界対応から得た追随ラグの中央値（ms）。実音声由来。
    perSegmentLag: 音素単位のラグ列。
    speechRateRatio: 学習者発話長 / お手本発話長。計算困難なら null。
    pauseCountLearner / pauseCountReference: VAD 無音区間数。計算困難なら null。
    """

    lagMilliseconds: float = Field(
        description="追随ラグ中央値（ミリ秒）。正値=学習者が遅い、負値=先行。実音声由来必須。"
    )
    perSegmentLag: list[PerSegmentLagResponse] = Field(
        description="音素単位のラグ列（DTW 対応ペアから算出）"
    )
    speechRateRatio: float | None = Field(
        default=None,
        description="学習者発話長 / お手本発話長。VAD 発話長から算出。計算困難なら null。",
    )
    pauseCountLearner: int | None = Field(
        default=None,
        description="学習者音声の VAD 無音区間数。計算困難なら null。",
    )
    pauseCountReference: int | None = Field(
        default=None,
        description="お手本音声の VAD 無音区間数。計算困難なら null。",
    )
