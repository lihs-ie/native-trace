---
name: live-stack-ops
description: NativeTrace のローカル実機スタック（worker/analyzer/golden/aai/frontend）を最新コードで立ち上げ・反映確認・smoke する runbook。「ローカル環境を起動して」「最新コードを反映して」「実機検証して」「worker/analyzer に curl したい」「コード変更が反映されない」「EADDRINUSE」「no such table」の場面で必ず参照する。docker rebuild 鉄則・port/env 一覧・health poll・worker/analyzer curl レシピ（multipart metadata の正確な形）・db:migrate・pnpm dev 再起動を含む。
---

# live-stack-ops — ローカル実機スタック運用

## サービス構成（compose.yaml が正）

| service | port | 実体 | 備考 |
|---|---|---|---|
| worker | 8787 | Haskell Servant | `ANALYZER_URL=http://analyzer:8788`、各下流 timeout 120s 明示（default 30s 禁止 — incident 2026-06-14） |
| analyzer | 8788 | Python FastAPI | healthcheck `start_period: 180s`（モデルロードが重い。起動直後の Connection refused は正常） |
| golden | 8789 | RVC 変換 | `--profile golden` 時のみ起動。未起動でも worker は正常動作 |
| aai | 8790 | 調音特徴 | `--profile aai` 時のみ起動 |
| frontend | 3000 | `pnpm dev`（compose 外） | ジョブ runner は instrumentation.ts でこのプロセス内に住む |

DB: `applications/frontend/data/native-trace.db`（`DB_PATH` で上書き可、drizzle.config.ts が正）。

## 鉄則: コードはイメージ焼き込み

worker/analyzer/golden/aai は **bind-mount 無し**。コード変更後は必ず:

```bash
docker compose up -d --build --wait worker analyzer
```

`restart` / `docker cp` では反映されない。反映の証明までやる:

```bash
# analyzer: 新コード断片を in-image grep（イメージ内 root は /app/src/python_analyzer/）
docker compose exec -T analyzer grep -c "<新コードの一意な断片>" /app/src/python_analyzer/<file>.py
# worker（コンパイル済みで grep 不可）: イメージ作成時刻 > ソース mtime を照合
docker inspect --format '{{.Created}}' native-trace-worker
```

## Bring-up シーケンス（「ローカル環境を最新コードで」の定型）

```bash
lsof -ti :3000 -ti :8787 -ti :3100 2>/dev/null | xargs kill 2>/dev/null || true   # EADDRINUSE 予防
docker compose up -d --build --wait worker analyzer
pnpm --filter @native-trace/frontend db:migrate    # dev server は auto-migrate しない（下記）
nohup pnpm dev > /tmp/nt-dev.log 2>&1 &
for p in 8787 8788 3000; do
  for i in $(seq 1 60); do curl -fsS "http://localhost:$p/health" >/dev/null 2>&1 && break; sleep 2; done
done
grep "AnalysisJobRunner" /tmp/nt-dev.log   # runner 起動 tick を確認
```

docker build は長い（analyzer torch 系 ~2GB、worker Haskell 5–10 分）。2 分超は `run_in_background` + ログファイル + `echo "EXIT ${PIPESTATUS[0]}"` で監視し、進捗を報告する。

## 変更種別ごとの反映条件

| 変更 | 必要な操作 |
|---|---|
| worker/analyzer/golden/aai のコード | `docker compose up -d --build --wait <service>` |
| frontend `registry.ts`（DI）/ `instrumentation.ts` | **pnpm dev フル再起動**。globalThis container singleton が hot-reload を生き延び stale 500 になる |
| frontend `schema.ts` | `pnpm --filter @native-trace/frontend db:generate` → 生成 SQL を目視 → `db:migrate`。**両方必要**。`no such table` は migrate 漏れ（typecheck 緑でも実機で割れる） |
| analyzer の新 Python 依存 | pyproject **と Dockerfile の pip リスト両方**（`verify-analyzer-deps.sh` がゲート）。kokoro は phonemizer-fork + espeakng-loader 必須 |

## Python 実行環境マップ

- analyzer コードの正は **Docker 内**。host venv は Python 3.14 に drift しており soundfile/scipy/kokoro 等が無い — host で `ModuleNotFoundError` が出ても Docker 内が通れば正常。
- host で pytest する場合は `PYTHONPATH=src`、Docker-only 依存のテストは skip されるのが期待挙動。analyzer pytest の正式実行は Docker 内。

## Live smoke curl レシピ

### worker 採点（POST /v1/pronunciation-assessments、multipart: `audio` + `metadata`）

metadata JSON の形（`Types.hs` AssessmentRequest が正。referenceText や speakerSex という field は**無い** — 本文は `sectionBodyText`）:

```bash
METADATA='{"analysisJob":"<ULID>","analysisRun":"<ULID>","recordingAttempt":"<ULID>","section":"<ULID>","sectionBodyText":"hello world","expectedLanguage":"en","targetAccent":"generalAmerican","requestedMetrics":[],"assessmentSchemaVersion":"<ver>","tokenizerVersion":"<ver>","audio":{"mimeType":"audio/wav","byteLength":64000,"durationMilliseconds":2000}}'
curl -fsS -X POST http://localhost:8787/v1/pronunciation-assessments \
  -F "audio=@/tmp/nt.wav;type=audio/wav" -F "metadata=$METADATA"
```

version 系の有効値は frontend の run-assessment-job 実装から取るのが確実。他 route: `/v1/pronunciation-assessments/shadowing`（parts: `learner_audio` ほか）、`/v1/golden-speaker/convert`、`/v1/gop-delta`（JSON）— `Api.hs` が正。

### analyzer 生計測（POST /v1/analyze、app.py で定義）

```bash
curl -fsS -X POST http://localhost:8788/v1/analyze \
  -F "audio=@/tmp/nt.wav;type=audio/wav" \
  -F 'metadata={"referenceText":"hello world","mimeType":"audio/wav","durationMilliseconds":2000,"speakerSex":"unknown"}'
```

`speakerSex` は `'F'|'M'|'unknown'` のみ（`'male'/'female'` 禁止）。`/v1/tts`・`/v1/shadowing-lag`（parts: `reference_audio` + `learner_audio` + `metadata={referenceText,mimeType,durationMilliseconds}`）は `interface/http_handler.py` が正。

### 期待レスポンス形（偽 green 防止）

GOP は**負値**、phenomenon は自由文字列、nBest は garbage があり得る（"hello world" top-1 が `[v,n,l,w,w,ɹ,l,n]` でも drift ではない）。詳細は real-shape-fixtures / pronunciation-scoring-debug skill。
