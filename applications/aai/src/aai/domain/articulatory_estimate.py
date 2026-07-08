"""調音推定結果ドメイン値オブジェクト。

ドメイン層は infrastructure / fastapi に依存しない。
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class PhonemeArticulatoryEstimate:
    """音素ごとの調音推定結果。

    座標はすべて発話内 z-score 正規化済み [-1.0, 1.0] の値（生 mm ではない）。
    下顎切歯・舌体チャネルは wire に出さない（D3-a drop）。

    displayEligibility はモデルの予測分散ではなく、
    EMA 軌跡から計算した表示適格性プロキシ（D3-c）。
    """

    phoneme: str
    start_ms: int
    end_ms: int
    tongue_tip_x: float
    tongue_tip_y: float
    tongue_dorsum_x: float
    tongue_dorsum_y: float
    lip_aperture_x: float
    lip_aperture_y: float
    display_eligibility: float


@dataclass(frozen=True)
class ArticulatoryInversionResult:
    """調音逆推定結果（全音素）。

    graceful degrade 時は per_phoneme が空リスト。
    HTTP 200 は常に返し、失敗時は per_phoneme=[] で返す。
    """

    per_phoneme: list[PhonemeArticulatoryEstimate]
