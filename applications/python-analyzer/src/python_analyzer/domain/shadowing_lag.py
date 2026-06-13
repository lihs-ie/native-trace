"""シャドーイングラグ計測のドメイン型定義（ADR-013）。

純粋データ型のみ。外部ライブラリに依存しない。
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class PhonemeSegmentLag:
    """音素単位の追随ラグ。

    DTW で対応づけられた音素ペアの開始時刻差（ミリ秒）。
    正値=学習者が遅い、負値=学習者が先行。
    """

    phoneme: str
    lag_milliseconds: float


@dataclass(frozen=True)
class ShadowingLagMeasurement:
    """シャドーイングラグ計測結果。

    lag_milliseconds: per_segment_lag の外れ値ロバスト中央値（ADR-013）。
    per_segment_lag: 音素単位のラグ列。DTW 対応ペアから算出。
    speech_rate_ratio: 学習者発話長 / お手本発話長。計算困難なら None。
    pause_count_learner: 学習者の VAD 無音区間数。計算困難なら None。
    pause_count_reference: お手本の VAD 無音区間数。計算困難なら None。
    """

    lag_milliseconds: float
    per_segment_lag: tuple[PhonemeSegmentLag, ...]
    speech_rate_ratio: float | None
    pause_count_learner: int | None
    pause_count_reference: int | None
