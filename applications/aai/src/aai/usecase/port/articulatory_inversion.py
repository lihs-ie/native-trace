"""調音逆推定エンジン ポート（依存逆転インターフェース）。

usecase 層は articulatory package の実装詳細を知らない。
infrastructure が このプロトコルを満たす。
articulatory import は infrastructure/articulatory_inversion.py だけに限定する（ADR-019）。
"""

from typing import Protocol

from aai.domain.articulatory_estimate import ArticulatoryInversionResult


class ArticulatoryInversionPort(Protocol):
    """調音逆推定エンジンのポート。

    learner_audio_bytes: 学習者音声バイト列。
    sample_rate: 音声サンプルレート (Hz)。
    boundaries: 音素境界リスト (phoneme, start_ms, end_ms)。

    Returns: ArticulatoryInversionResult。
      graceful degrade 時は per_phoneme が空リスト。
    """

    def invert(
        self,
        learner_audio_bytes: bytes,
        sample_rate: int,
        boundaries: list[dict],
    ) -> ArticulatoryInversionResult:
        """音声から調音軌跡を推定する。

        モデルが利用不可の場合は RuntimeError を送出する。
        """
        ...
