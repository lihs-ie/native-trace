"""uvicorn エントリポイント。

docker compose の CMD: uvicorn python_analyzer.main:app --host 0.0.0.0 --port 8788
"""

import os

import uvicorn

from python_analyzer.app import app

__all__ = ["app"]

if __name__ == "__main__":
    # ANALYZER_PORT 環境変数からポートを取得する（デフォルト 8788）
    port = int(os.environ.get("ANALYZER_PORT", "8788"))
    uvicorn.run(
        "python_analyzer.app:app",
        host="0.0.0.0",
        port=port,
        log_level="info",
    )
