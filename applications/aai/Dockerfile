# --- Build stage --------------------------------------------------
# Python 3.10: torch 2.2.x CPU wheel の互換性を確保するため固定
FROM python:3.10-slim AS builder

WORKDIR /build

# システム依存パッケージをインストールする
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       libsndfile1 \
       libsndfile1-dev \
       ffmpeg \
       curl \
       gcc \
       g++ \
       build-essential \
       git \
  && rm -rf /var/lib/apt/lists/*

# torch CPU wheel（BSD-3）をインストールする
# --index-url で CPU 専用 wheel を指定して CUDA 肥大を回避する（REQ-NF-102）
# モデル重みは Docker に焼かない（M-GRV-10 / ADR-019）— HF_HOME volume で供給する
COPY pyproject.toml ./

RUN pip install --no-cache-dir \
       "torch==2.2.2" \
       "torchaudio==2.2.2" \
       --index-url https://download.pytorch.org/whl/cpu

# articulatory/articulatory (Apache-2.0) をインストールする。
# PyPI パッケージ名: "articulatory"。
# PyPI に存在する場合は pip install articulatory で入る。
# PyPI に存在しない場合は GitHub から直接インストールする:
#   pip install "git+https://github.com/articulatory/articulatory.git"
# torch/checkpoint が不在の環境では graceful degrade するため、
# インストール失敗時もサービスは起動し perPhoneme=[] を返す（M-AAI-3）。
#
# S-AAI-3: transitive 依存（torch 等）に GPL が混入した場合は ADR-006 前例
# （service 境界隔離 + ast-grep allow を aai に拡張 + ADR amend）で対処する。
# torch は BSD-3-Clause であり現時点で GPL 混入は確認されていない。
# articulatory package の transitive dep を `pip show articulatory` で確認すること。
RUN pip install --no-cache-dir "articulatory" \
    || pip install --no-cache-dir "git+https://github.com/articulatory/articulatory.git" \
    || echo "WARNING: articulatory package could not be installed; service will run in degraded mode (perPhoneme=[])"

# アプリ依存をインストールする
RUN pip install --no-cache-dir \
       "fastapi>=0.115.0" \
       "uvicorn[standard]>=0.30.0" \
       "pydantic>=2.7.0" \
       "python-multipart>=0.0.9" \
       "librosa>=0.10.0" \
       "numpy>=1.24.0" \
       "soundfile>=0.12.0" \
       "huggingface_hub>=0.24.0" \
       "pytest>=8.3.0" \
       "pytest-asyncio>=0.24.0" \
       "httpx>=0.27.0" \
       "ruff>=0.7.0"

# --- Runtime stage ------------------------------------------------
FROM python:3.10-slim

WORKDIR /app

# ランタイム依存のシステムパッケージをインストールする
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       libsndfile1 \
       ffmpeg \
       curl \
  && rm -rf /var/lib/apt/lists/*

# Python パッケージをビルドステージからコピーする
COPY --from=builder /usr/local/lib/python3.10/site-packages /usr/local/lib/python3.10/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# アプリケーションコードをコピーする（モデル重みは含めない — M-GRV-10）
COPY src/ /app/src/
COPY test/ /app/test/

# PYTHONPATH を設定する
ENV PYTHONPATH=/app/src
ENV AAI_PORT=8790

# HF キャッシュは volume マウントで永続化する（モデル重みをイメージに焼かない — M-GRV-10）
VOLUME ["/root/.cache/huggingface"]

EXPOSE 8790

HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD curl -fsS http://localhost:8790/health || exit 1

# uvicorn で aai.app:app を起動する（ポート 8790）
CMD ["uvicorn", "aai.app:app", "--host", "0.0.0.0", "--port", "8790"]
