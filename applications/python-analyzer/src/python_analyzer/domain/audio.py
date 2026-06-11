"""音声入力のドメイン型定義。"""

from dataclasses import dataclass


@dataclass(frozen=True)
class AudioInput:
    """音声バイナリと付属メタデータ。

    bytes は WAV/WebM/OGG 等のエンコード済みデータ。
    """

    content: bytes
    mime_type: str
    duration_milliseconds: int

    def __post_init__(self) -> None:
        if not self.content:
            raise ValueError("AudioInput content must not be empty")
        if not self.mime_type:
            raise ValueError("AudioInput mime_type must not be empty")
        if self.duration_milliseconds < 0:
            raise ValueError("duration_milliseconds must be non-negative")
