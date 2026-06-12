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
class PhonemeGopMeasurement:
    """1 音素あたりの GOP 計測値と時間境界。"""

    phoneme: PhonemeLabel
    gop: GopScore
    start_milliseconds: int
    end_milliseconds: int


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
