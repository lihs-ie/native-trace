"""生計測結果のドメイン型定義。

採点ポリシーは持たない（採点は Haskell worker, ADR-004）。
"""

from dataclasses import dataclass, field

from python_analyzer.domain.phoneme import (
    AlignmentBoundary,
    GopScore,
    IpaSequence,
    PhonemeLabel,
)


@dataclass(frozen=True)
class NBestCandidate:
    """CTC logits の上位候補（1 件分）。"""

    phoneme: str
    confidence: float  # softmax 確率 0–1


@dataclass(frozen=True)
class PhonemeGopMeasurement:
    """1 音素あたりの GOP 計測値と時間境界。"""

    phoneme: PhonemeLabel
    gop: GopScore
    start_milliseconds: int
    end_milliseconds: int
    n_best: tuple[NBestCandidate, ...] = field(default_factory=tuple)
    # 単語内位置: "initial" | "medial" | "final"（M-102R-b, C-A2W 契約）
    word_position: str | None = None


@dataclass(frozen=True)
class F0Contour:
    """F0（基本周波数）輪郭計測値。parselmouth で計測する。"""

    times_milliseconds: tuple[int, ...]  # 発話開始基準
    values_hz: tuple[float, ...]  # 無声フレームは 0.0


@dataclass(frozen=True)
class WordStressMeasurement:
    """単語ごとの強勢計測値。"""

    word: str
    word_index: int  # 0始まり、本文トークン順
    start_milliseconds: int
    end_milliseconds: int
    expected_stress: int  # 0=無強勢 / 1=第1強勢 / 2=第2強勢 (espeak 強勢記号から)
    predicted_stress: int  # F0/強度/持続時間から推定 0/1/2


@dataclass(frozen=True)
class RhythmMeasurement:
    """リズム指標（nPVI など）。"""

    npvi_vocalic: float  # 母音持続時間の nPVI
    reference_npvi_vocalic: float  # 英語参照帯の代表値 (定数)


@dataclass(frozen=True)
class WeakFormRealization:
    """機能語の弱形実現情報。"""

    word: str
    word_index: int
    start_milliseconds: int
    end_milliseconds: int
    expected_weak: bool  # 機能語なので基本 True
    realized_weak: bool  # schwa 化 + 短縮していれば True


@dataclass(frozen=True)
class InsertedVowel:
    """挿入母音（epenthesis）の検出情報。"""

    position_milliseconds: int
    vowel: str  # IPA ([ɯ]/[o]/[i] 等)


@dataclass(frozen=True)
class SyllableMeasurement:
    """単語ごとの音節数計測値。"""

    word: str
    word_index: int
    expected_syllable_count: int  # 辞書音節数 (espeak の母音核カウント)
    actual_syllable_count: int  # 検出音素列の母音核カウント
    inserted_vowels: tuple[InsertedVowel, ...]  # 挿入母音。無ければ ()


@dataclass(frozen=True)
class InterWordSilence:
    """単語間無音区間。"""

    start_milliseconds: int
    end_milliseconds: int

    @property
    def duration_milliseconds(self) -> int:
        return self.end_milliseconds - self.start_milliseconds


@dataclass(frozen=True)
class SchwaRealization:
    """シュワ音（/ə/）の実現情報。"""

    phoneme: PhonemeLabel
    start_milliseconds: int
    end_milliseconds: int
    realized: bool


@dataclass(frozen=True)
class RawMeasurementResult:
    """HTTP レスポンスの骨格となる生計測結果。

    採点・判定はしない。全フィールドが計測値。
    """

    expected_ipa: IpaSequence
    detected_ipa: IpaSequence
    per_phoneme_gop: tuple[PhonemeGopMeasurement, ...]
    inter_word_silences: tuple[InterWordSilence, ...]
    schwa_realizations: tuple[SchwaRealization, ...]
    speech_rate_phoneme_per_second: float
    alignment_boundaries: tuple[AlignmentBoundary, ...] = field(default_factory=tuple)
    # 録音品質計測値。低品質判定は採点層(Haskell worker)が行う。
    mean_dbfs: float = 0.0
    speech_duration_seconds: float = 0.0
    # C1 追加フィールド (pronunciation-feedback-v2)
    f0_contour: F0Contour | None = None
    word_stresses: tuple[WordStressMeasurement, ...] = field(default_factory=tuple)
    rhythm: RhythmMeasurement | None = None
    weak_form_realizations: tuple[WeakFormRealization, ...] = field(default_factory=tuple)
    syllables: tuple[SyllableMeasurement, ...] = field(default_factory=tuple)
