---
name: fullcycle-selfeval-drift-ops
description: ADR-031/032 の full-cycle E2E ハーネス・self-eval・drift sentinel の運用 runbook。pnpm test:fullcycle / pnpm test:drift / run_selfeval.py の起動方法、SELFEVAL/DRIFT verdict 行の文法、FAIL[KNOWN] の意味、fingerprint re-pin の規律（compute_fingerprint.py --write のみ）、nBest 検証は /v1/analyze 直叩き、を含む。「fullcycle を回して」「self-eval して」「drift チェック」「fingerprint を re-pin」「SELFEVAL が FAIL」の場面で使う。
---

# fullcycle-selfeval-drift-ops — ADR-031/032 ハーネス運用

## Entrypoints（逐語実行 — promoted rule `entrypoint_verbatim_execution`。便利な独自引数への差し替え禁止）

```bash
pnpm test:fullcycle <case>        # = node --experimental-strip-types test/fullcycle/driver.ts（frontend）
pnpm test:drift                   # = fullcycle:up → drift_check.py --analyzer-url http://localhost:8788
python3 applications/python-analyzer/test/selfeval/run_selfeval.py \
  --analyzer-url http://localhost:8788 [--fixture <wav>]
```

case registry は `applications/frontend/test/fullcycle/driver.ts` 末尾（現在: `gop-delta` → `cases/gop-delta.case.ts`）。

## driver の実行シーケンス（触る前に知っておく制約）

1. `docker compose up -d --build --wait worker analyzer`
2. throwaway DB に `pnpm db:migrate`（**db:push 禁止**）→ `seedSkeleton()`
3. **production `next start`** を `FULLCYCLE_PORT`（default 3099）で起動 — dev server 不可（ORPHAN-4: dev では実配線を検証したことにならない）
4. 実 route への POST → 有界 poll → verdict 行 → `run_selfeval.py` へ shell-out → `docker compose down`
5. **case は逐次のみ**（AnalysisJobRunner が singleton lease のため並列不可）

## verdict 行の文法

```
SELFEVAL <family> <case> PASS|FAIL|FAIL[KNOWN] observed=<k:v,...>
DRIFT fingerprint=match status=skip
DRIFT <entryIdentifier> <benign|regression> fingerprint=mismatch classification=<...>
```

- exit code: SELFEVAL は bare `FAIL` のみ非ゼロ。`FAIL[KNOWN]` は `_KNOWN_FAILURES`（run_selfeval.py）記載の追跡中欠陥で exit に影響しないが、**行は必ず出力される（隠蔽禁止）**。現在の KNOWN: `noise_monotonicity`（ADR-032 SNR gate 無効化に伴う open defect）。
- DRIFT は regression 1 件以上で exit 1。benign のみなら 0。

## drift の分類と re-pin 規律（最重要）

- regression（human gate へエスカレーション）: GOP sign-flip / out-of-band（ε=2.0 GOP units）/ structural 変化 / IPA 変化が過半数。
- benign: IPA 変化が少数（拡散 CTC ノイズ class）→ `advisoryIpaDrift` に記録。**nBest の garbage は drift ではない**。
- `drift_check.py` は **manifest.json を絶対に書き換えない**。re-pin は明示的に:

```bash
python3 applications/python-analyzer/test/selfeval/compute_fingerprint.py --write
```

- re-pin の前に対象を **stage/commit しておく**（committed-baseline gate。`git checkout --` は INDEX 版復元なので復旧には使えない — cp バックアップ方式）。
- fingerprint 計算は **live image が必須**（`docker compose up` 済みであること。ローカルソースからの計算は無効）。

## 検証の作法

- nBest の観測は **DB からではなく `/v1/analyze` 直叩き**で取る。DB 経由は空配列で vacuous PASS になる（ORPHAN-1）。
- Must 動詞 → tier: returns/computes/算出 → **tier-1（fullcycle 必須）**、renders/描画 → tier-2（Playwright fake capture: `--use-file-for-fake-audio-capture`、macOS は `--no-sandbox` 併用）。
- Loop-A（自動修正可）と Loop-B の境界: `Scoring.hs` の calibratable 定数（gopFloor/threshold 等）は **human-gated、propose-only**。self-eval FAIL を理由に自動で定数をいじらない。
