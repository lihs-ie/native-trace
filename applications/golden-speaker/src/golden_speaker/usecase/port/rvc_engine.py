"""RVC 音色変換エンジン ポート（依存逆転インターフェース）。

usecase 層は RVC の実装詳細を知らない。infrastructure が このプロトコルを満たす。
RVC import は infrastructure/rvc_engine.py だけに限定する（ADR-012 / ADR-006 パターン）。
"""

from typing import Protocol


class RvcEnginePort(Protocol):
    """RVC 音色変換エンジンのポート。

    learner_audio_bytes: 学習者音声 WAV バイト列。
    target_voice: 変換先 VCTK 話者 id。
    Returns: 変換済み WAV バイト列。
    Raises: RuntimeError — モデル未ロード / 推論失敗時。
    """

    def convert(
        self,
        learner_audio_bytes: bytes,
        target_voice: str,
    ) -> bytes:
        """学習者音声を target_voice の音色に変換した WAV バイト列を返す。

        モデルが利用不可の場合は RuntimeError を送出する。
        """
        ...
