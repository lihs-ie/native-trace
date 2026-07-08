"""uvicorn エントリポイント。

`uvicorn golden_speaker.main:app` または `golden_speaker.app:app` で起動する。
"""

from golden_speaker.app import app  # noqa: F401

__all__ = ["app"]
