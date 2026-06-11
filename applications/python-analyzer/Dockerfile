# --- Build stage --------------------------------------------------
FROM python:3.11-slim AS builder

WORKDIR /build

# システム依存パッケージをインストールする
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       espeak-ng \
       espeak-ng-data \
       libsndfile1 \
       libsndfile1-dev \
       ffmpeg \
       curl \
       gcc \
       g++ \
       build-essential \
  && rm -rf /var/lib/apt/lists/*

# pip の依存をインストールする（CPU-only torch を指定してサイズを抑える）
COPY pyproject.toml ./
RUN pip install --no-cache-dir --upgrade pip \
  && pip install --no-cache-dir \
       "torch>=2.4.0" \
       torchaudio \
       --index-url https://download.pytorch.org/whl/cpu \
  && pip install --no-cache-dir \
       "fastapi>=0.115.0" \
       "uvicorn[standard]>=0.30.0" \
       "pydantic>=2.7.0" \
       "transformers>=4.45.0" \
       "phonemizer>=3.3.0" \
       "httpx>=0.27.0" \
       "python-multipart>=0.0.9" \
       "soundfile>=0.12.0" \
       "numpy>=1.24.0" \
       "pytest>=8.3.0" \
       "pytest-asyncio>=0.24.0" \
       "ruff>=0.7.0" \
       "pyright>=1.1.390"

# --- Runtime stage ------------------------------------------------
FROM python:3.11-slim

WORKDIR /app

# ランタイム依存のシステムパッケージをインストールする
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       espeak-ng \
       espeak-ng-data \
       libsndfile1 \
       ffmpeg \
       curl \
  && rm -rf /var/lib/apt/lists/*

# Python パッケージをビルドステージからコピーする
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# アプリケーションコードをコピーする
COPY src/ /app/src/
COPY test/ /app/test/

# espeak-ng TTS で hello_world.wav fixture を合成する
# テストで参照する固定 fixture を build 時に生成してコピーする
RUN espeak-ng -v en-us -w /app/test/fixtures/hello_world.wav "Hello, world."

# PYTHONPATH を設定する
ENV PYTHONPATH=/app/src
ENV ANALYZER_PORT=8788

EXPOSE 8788

# HF キャッシュは volume マウントで永続化する
VOLUME ["/root/.cache/huggingface"]

CMD ["uvicorn", "python_analyzer.app:app", "--host", "0.0.0.0", "--port", "8788"]
