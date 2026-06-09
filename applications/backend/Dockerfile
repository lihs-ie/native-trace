# --- Build stage -------------------------------------------------
FROM haskell:9.10.3-slim-bookworm AS builder

WORKDIR /build

# Build dependencies first so source edits reuse the cached layer.
# Stub source dirs keep `cabal` from compiling local components here.
COPY cabal.project native-trace-worker.cabal ./
RUN mkdir -p src app test \
  && cabal update \
  && cabal build --only-dependencies all

COPY . .
RUN cabal install exe:native-trace-worker \
      --installdir=/output \
      --install-method=copy \
      --overwrite-policy=always

# --- Runtime stage -----------------------------------------------
FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl libgmp10 \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /output/native-trace-worker /usr/local/bin/native-trace-worker

ENV WORKER_PORT=8787
EXPOSE 8787

CMD ["native-trace-worker"]
