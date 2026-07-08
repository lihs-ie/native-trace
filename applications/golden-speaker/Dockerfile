# --- Build stage --------------------------------------------------
# Python 3.10: rvc-python の依存 fairseq==0.12.2 / omegaconf==2.0.6 が 3.11+ でビルド困難なため固定
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
  && rm -rf /var/lib/apt/lists/*

# torch CPU wheel（BSD-3）+ rvc-python（MIT）をインストールする
# --index-url で CPU 専用 wheel を指定して CUDA 肥大を回避する（M-GRV-2 / REQ-NF-102）
# モデル重みは Docker に焼かない（M-GRV-10 / ADR-012）— HF_HOME volume で供給する
COPY pyproject.toml ./
# pip<24 に固定する。pip 24+ は omegaconf==2.0.6（rvc-python の依存）の不正な
# version 指定子メタデータ（".*" suffix）を拒否してビルドが失敗するため。
RUN pip install --no-cache-dir "pip<24" \
  && pip install --no-cache-dir \
       "torch==2.2.2" \
       "torchaudio==2.2.2" \
       --index-url https://download.pytorch.org/whl/cpu \
  # rvc-python==0.1.5 とアプリ依存を 1 コマンドで入れて numpy を共解決させる。
  # 分割すると librosa→numba が numpy>=1.24 を引き、後段の rvc-python(numpy<=1.23.5)と衝突する。
  # rvc-python は fairseq==0.12.2 / praat-parselmouth(GPL, golden サービス内に隔離 — ADR-012改訂/ADR-006) を引く。
  && pip install --no-cache-dir \
       "rvc-python==0.1.5" \
       "fastapi>=0.115.0" \
       "uvicorn[standard]>=0.30.0" \
       "pydantic>=2.7.0" \
       "python-multipart>=0.0.9" \
       "librosa>=0.10.0" \
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
ENV GOLDEN_PORT=8789

# HF キャッシュは volume マウントで永続化する（モデル重みをイメージに焼かない — M-GRV-10）
VOLUME ["/root/.cache/huggingface"]

EXPOSE 8789

HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD curl -fsS http://localhost:8789/health || exit 1

CMD ["uvicorn", "golden_speaker.app:app", "--host", "0.0.0.0", "--port", "8789"]
