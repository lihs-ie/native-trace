---
name: analysis-job-triage
description: 解析ジョブが進まない・UI が一生ローディング（analyzing のまま）・解析失敗の原因調査のための frontend ジョブパイプライン triage。analysis_jobs/analysis_runs の SQLite 調査クエリ、requeue SQL テンプレート、エラーコード分類（retryable/nonRetryable）、runner 再起動ルールを含む。「ジョブが止まっている」「ローディングのまま変化しない」「解析が失敗する理由を知りたい」「requeue したい」場面で使う。
---

# analysis-job-triage — 解析ジョブ調査と復旧

## 仕組み（先にこれを理解する）

- **run の status は jobs から導出される**。非終端 job が 1 つでも残ると UI は永遠に `analyzing`（「一生ローディング」の正体）。
- ジョブ runner は `instrumentation.ts` 起動で **pnpm dev プロセス内に住む**。runner のコード変更・復旧には dev server フル再起動が必要（`AnalysisJobRunner: starting` を `/tmp/nt-dev.log` で確認）。
- runner は lease 方式（`lease_owner/lease_token/leased_until`）の singleton。処理は逐次。

## 調査クエリ

DB: `applications/frontend/data/native-trace.db`（e2e も同じファイル）。

```bash
sqlite3 applications/frontend/data/native-trace.db \
  "SELECT identifier, status, attempt_count, next_run_at, last_error_code, substr(last_error_message,1,120)
   FROM analysis_jobs ORDER BY created_at DESC LIMIT 10;"
sqlite3 applications/frontend/data/native-trace.db \
  "SELECT identifier, mode, status, started_at, completed_at FROM analysis_runs ORDER BY created_at DESC LIMIT 10;"
```

一次ソースは `last_error_code` / `last_error_message`。dev ログ（`grep -i error /tmp/nt-dev.log`）は補助。

## requeue テンプレート（列名は schema.ts が正）

```bash
NOW=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
sqlite3 applications/frontend/data/native-trace.db "
UPDATE analysis_jobs SET status='queued', attempt_count=0, next_run_at='$NOW',
  started_at=NULL, completed_at=NULL,
  lease_owner=NULL, lease_token=NULL, leased_until=NULL,
  last_error_code=NULL, last_error_message=NULL, updated_at='$NOW'
WHERE identifier='<JOB_ULID>';
UPDATE analysis_runs SET status='queued', started_at=NULL, completed_at=NULL
WHERE identifier='<RUN_ULID>';"
```

requeue 後は runner の次 tick を待つ（20–35 秒 sleep してから DB を再確認）。

## 失敗分類

| last_error_code / 症状 | 分類 | 対処 |
|---|---|---|
| `assessmentSchemaInvalid` | nonRetryable | oss-worker adaptor の zod schema と worker 実出力の不一致。requeue しても無駄 — schema/worker を直す |
| cloud エンジン 404 | nonRetryable | 設定/モデル指定を直す |
| worker cold-start timeout | retryable | worker health を待って requeue。timeout は明示 120s 系（incident 2026-06-14） |
| `low_quality_audio` | 入力品質 | 品質ゲート棄却。pronunciation-scoring-debug skill の triage 決定木へ |
| job が `running` のまま固まる | lease 残留 | dev server が死んで lease が孤児化。requeue テンプレで lease 列を NULL に戻す |

## 典型フロー（過去セッションで確立した手順）

1. DB で job/run の status と last_error を読む
2. 原因がコード側なら修正 → 反映（worker/analyzer なら `docker compose up -d --build`、runner なら dev 再起動 — live-stack-ops skill）
3. requeue テンプレ実行 → sleep 20–35s → DB 再確認 + `/tmp/nt-dev.log` を grep
4. 直ったことは UI ではなく DB の終端 status（`succeeded` 等）と `assessment_results` で確認する
