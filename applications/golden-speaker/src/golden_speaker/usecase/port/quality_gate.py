"""品質ゲート ポート（依存逆転インターフェース）。

usecase 層は具体的な品質計測手法を知らない。
infrastructure/quality_gate.py がこのプロトコルを実装する。
"""

from typing import Protocol


class QualityGatePort(Protocol):
    """音声品質ゲートのポート。

    変換済み WAV バイト列を受け取り、品質ゲート通過可否と理由を返す。
    """

    def check(self, audio_bytes: bytes) -> tuple[bool, str | None]:
        """品質ゲートを評価する。

        Args:
            audio_bytes: 変換済み WAV バイト列。

        Returns:
            (passed, withhold_reason):
              passed=True の場合 withhold_reason は None。
              passed=False の場合 withhold_reason は理由文字列。
        """
        ...
