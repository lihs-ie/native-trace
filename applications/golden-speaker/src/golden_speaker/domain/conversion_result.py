"""音色変換結果ドメイン値オブジェクト。

ドメイン層は infrastructure / fastapi に依存しない。
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class ConversionResult:
    """RVC 音色変換の結果。

    audio_bytes: 変換済み WAV バイト列。品質ゲート不通過時は None。
    quality_gate_passed: 品質ゲートを通過した場合 True。
    withhold_reason: ゲート不通過時の理由文字列（通過時は None）。
    target_voice: 変換に使用した VCTK 話者 id 等（UI 表示用）。
    """

    audio_bytes: bytes | None
    quality_gate_passed: bool
    withhold_reason: str | None
    target_voice: str
