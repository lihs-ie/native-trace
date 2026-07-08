"""uvicorn エントリポイント。

`uvicorn aai.main:app` または `aai.app:app` で起動する。
"""

from aai.app import app  # noqa: F401

__all__ = ["app"]
