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
       "httpx>=0.27.0" \
       "python-multipart>=0.0.9" \
       "soundfile>=0.12.0" \
       "numpy>=1.24.0" \
       "scipy>=1.11.0" \
       "praat-parselmouth>=0.4.3" \
       "kokoro>=0.9.4" \
       "misaki[en]>=0.9.4" \
       "phonemizer-fork>=3.3.2" \
       "espeakng-loader>=0.2.4" \
       "huggingface_hub>=0.24.0" \
       "pytest>=8.3.0" \
       "pytest-asyncio>=0.24.0" \
       "ruff>=0.7.0" \
       "pyright>=1.1.390"

# --- Curated HVPT stimuli (ADR-009) -------------------------------
# The carve-out (LibriTTS minimal-pair extraction + Kokoro long-tail supplement)
# runs OUT-OF-BAND on the dev host via `carve_runner.py`, NOT inside the Docker
# build: piping the 7.7 GB raw corpus through the build context made every build
# take >1 h. The carve produces a small curated subset (a few tens of MB) that is
# checked into `stimuli-assets/` and COPYed into the runtime image below. To
# regenerate the subset:
#   .venv/bin/python -m python_analyzer.infrastructure.stimulus.carve_runner \
#     --corpus <train-clean-100.tar.gz> --alignment <libritts-aligned/train_clean_100.tar.gz> \
#     --output stimuli-assets
# The raw 7.7 GB corpus is never bundled (gitignored under data/corpus-scratch).

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

# ruff の設定（line-length=100 等）をコンテナ内 lint ゲートで参照できるようにする。
# 実行時には不活性で、CI の `ruff check` / `ruff format --check` の設定を
# ホスト側と一致させるためだけに配置する（依存インストールには使用しない）。
COPY pyproject.toml /app/

# 事前 carve した curated stimulus assets をコピーする（ADR-009 / W-4）。
# 7.7 GB の raw corpus は同梱しない。carve 済アセット（数十 MB）のみ。
# stimuli-assets/ は carve_runner を dev host で実行して生成する（上記コメント参照）。
COPY stimuli-assets/ /app/src/python_analyzer/assets/stimuli/

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
