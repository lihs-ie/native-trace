"""発音解析ドメインの音素関連型定義。

純粋データ型のみ。外部ライブラリ（torch/phonemizer/fastapi）に依存しない。
"""

from dataclasses import dataclass

# IPA 母音核として認識する文字セット（音節カウント・母音持続時間・強勢計算に使用）。
# usecase / infrastructure の各所で共有するドメイン語彙。
VOWEL_NUCLEI: frozenset[str] = frozenset("aeiouæɑɒɔəɛɪɨɵʊʌœøɯɤɐɞɘ")

# schwa（シュワ）音の IPA 記号。弱形・シュワ実現検出で共有するドメイン語彙。
SCHWA_PHONEME = "ə"


@dataclass(frozen=True)
class PhonemeLabel:
    """IPA 音素ラベル。"""

    value: str

    def __post_init__(self) -> None:
        if not self.value:
            raise ValueError("PhonemeLabel cannot be empty")


@dataclass(frozen=True)
class GopScore:
    """GOP（Goodness of Pronunciation）スコア。

    整列フレームの平均 log 事後確率: GOP(p) = (1/T) * sum(log P(p|x_t))
    """

    value: float


@dataclass(frozen=True)
class IpaSequence:
    """IPA 音素列。"""

    phonemes: tuple[PhonemeLabel, ...]

    @classmethod
    def from_string(cls, ipa_string: str) -> "IpaSequence":
        """IPA 文字列から音素列を生成する。"""
        labels = tuple(PhonemeLabel(p) for p in ipa_string.split() if p)
        return cls(phonemes=labels)

    def to_string(self) -> str:
        """音素列を空白区切り文字列に変換する。"""
        return " ".join(p.value for p in self.phonemes)


@dataclass(frozen=True)
class AlignmentBoundary:
    """強制整列により得られた音素の時間境界。"""

    phoneme: PhonemeLabel
    start_milliseconds: int
    end_milliseconds: int

    def __post_init__(self) -> None:
        if self.start_milliseconds < 0:
            raise ValueError("start_milliseconds must be non-negative")
        if self.end_milliseconds < self.start_milliseconds:
            raise ValueError("end_milliseconds must be >= start_milliseconds")
