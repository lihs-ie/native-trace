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

# --- Carve-out stage: download alignment + run carve pipeline -----
# ADR-009: curated stimulus assets are baked into the image at build time.
# The raw LibriTTS corpus (7.7 GB) is NOT bundled; only the carved subset.
# The alignment archive (~100 MB) is downloaded from HuggingFace at build time.
# CORPUS_ARCHIVE_PATH must be provided as a build ARG pointing to a bind-mounted
# or pre-copied train-clean-100.tar.gz on the build host.
# Acceptable to skip if corpus is unavailable: long-tail Kokoro supplement will
# still be generated (see carve_runner.py).
FROM builder AS carver

WORKDIR /carve

# Copy application source for the carve runner.
COPY src/ /carve/src/

ENV PYTHONPATH=/carve/src

# Download the libritts-aligned TextGrid archive from HuggingFace.
ARG HF_TOKEN=""
RUN python -c "
from huggingface_hub import hf_hub_download
import os
token = os.environ.get('HF_TOKEN') or None
path = hf_hub_download(
    'cdminix/libritts-aligned',
    'data/train_clean_100.tar.gz',
    repo_type='dataset',
    token=token,
    local_dir='/carve/alignment',
)
print('Alignment archive downloaded to:', path)
import shutil
shutil.copy(path, '/carve/alignment/train_clean_100.tar.gz')
"

# Copy the LibriTTS corpus archive if provided (optional: bind-mount or COPY).
# If not present, only the Kokoro long-tail supplement will be generated.
ARG CORPUS_ARCHIVE_PATH=""
COPY data/corpus-scratch/train-clean-100.tar.gz /carve/corpus/train-clean-100.tar.gz

# Run the carve pipeline to generate curated stimulus assets + manifest.
# Output: /carve/assets/stimuli/{libritts,kokoro}/<contrast>/*.wav + attribution-manifest.json
RUN python -m python_analyzer.infrastructure.stimulus.carve_runner \
      --corpus   /carve/corpus/train-clean-100.tar.gz \
      --alignment /carve/alignment/train_clean_100.tar.gz \
      --output   /carve/assets/stimuli

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

# Carve stage で生成した curated stimulus assets をコピーする（ADR-009 / W-4）。
# 7.7 GB の raw corpus は同梱しない。carve 済アセット（数百 MB）のみ。
COPY --from=carver /carve/assets/stimuli/ /app/src/python_analyzer/assets/stimuli/

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
