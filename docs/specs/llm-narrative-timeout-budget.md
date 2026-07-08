# Spec: llm-narrative-timeout-budget

<!-- 設計の正 / 背景:
       adr/023-llm-narrative-timeout-budget-and-fallback-observability.md (Proposed, 2026-06-19)
         D1: llmNarrativeTimeoutMilliseconds default 30000 → 60000
         D2: llmNarrativeMaxFindings 新規 config + pre-loop batch 上限化 (severity desc → functionalLoad desc)
         D3: factory に optional logger? + 4 fallback 点の warn + バッチ後 info サマリ + registry pass-through
         D4: ADR-021 D3/D6/M-LLM-6 / Notes Risks を実測値で amend
     現状コード確認 (2026-06-19):
       config/index.ts: llmNarrativeTimeoutMilliseconds.default(30000) — 変更要。
                        llmNarrativeMaxFindings 未存在 — 追加要。
       create-llm-improvement-message-generator.ts: deps に logger? 未存在 — 追加要。
                        4 fallback 点 (cache-error L96 / invoker reject L113 / parse fail L117-119 /
                        grounding fail L125-126) はいずれも warn を出さず silent — 変更要。
       run-assessment-job/index.ts: pre-loop batch は全 finding を allInputs にマップ (L564)。
                        severity/functionalLoad 上位 N 件への絞り込みは未実装 — 変更要。
                        バッチ後の logger.info サマリは未実装 — 追加要。
                        deps に llmNarrativeMaxFindings? は未存在 — 追加要。
       registry.ts: createLlmImprovementMessageGenerator 呼び出しに logger を渡していない — 変更要。
                    createRunAssessmentJob に llmNarrativeMaxFindings を渡していない — 変更要。
     依存:
       ADR-021 実装ランディング済み (llmNarrativeMaxConcurrency dep / provider 分岐 / factory / invoker / cache 等)。
       本 spec は ADR-021 実装の「上に載せる差分」のみを定義する。
     配線点 (agent-policy §wiring):
       frontend: infrastructure/config/index.ts (default 変更 + 新フィールド + env マッピング)
       frontend: acl/improvement-message/llm/create-llm-improvement-message-generator.ts (deps + warn 追加)
       frontend: usecase/run-assessment-job/index.ts (上限化 + サマリログ + deps 追加)
       frontend: registry.ts (logger pass-through + llmNarrativeMaxFindings dep 追加)
       adr/021-llm-coaching-narrative-switchable-claude-ollama-rule-fallback.md (D4 amend)
     強制レイヤ: scripts/verify-*.sh + fitness hook + CI -->

## Goal

- `llmNarrativeTimeoutMilliseconds` の既定を実測 ~40s/call に合わせて 30000 → 60000ms に引き上げ、
  大半の上位 finding が LLM narrative を得られるようにする（ADR-023 D1）。
- LLM 生成対象 finding 数を `llmNarrativeMaxFindings`（既定 8）に上限化し、
  worst-case バッチ時間 `ceil(8/3) × 60s = 180s` を既存 300s lease 内に決定論的に収める（ADR-023 D2）。
  対象は severity 降順 → functionalLoad（high > medium > low）降順の上位 N 件。上限外 finding は既存 rule-based パスへ落ちる。
- silent だった 4 fallback 点と pre-loop バッチ完了後に構造化ログを追加し、
  timeout 頻発・grounding 棄却率・cache miss を運用で観測可能にする（ADR-023 D3）。
- ADR-021 の latency 仮定（probe ~9s）を実測値（~40s/call）で訂正する（ADR-023 D4）。

## Must (満たさなければ done でない)

### D1 — timeout 既定変更

- [ ] **M-TMO-1 (`llmNarrativeTimeoutMilliseconds` default 30000 → 60000)**
  `applications/frontend/src/infrastructure/config/index.ts` の `configSchema` 内
  `llmNarrativeTimeoutMilliseconds` フィールドの `.default(30000)` を `.default(60000)` に変更すること。
  env `LLM_NARRATIVE_TIMEOUT_MS` でのオーバーライドは変更しないこと（不変）。
  他の全 config フィールドは変更しないこと。

### D2 — finding 上限化

- [ ] **M-TMO-2 (`llmNarrativeMaxFindings` config フィールド追加)**
  `configSchema` に以下を追加すること（既存フィールドは変更しないこと）:
  - フィールド: `llmNarrativeMaxFindings: z.coerce.number().int().positive().default(8)`
  - env マッピング: `createConfig` の `safeParse` 入力に `llmNarrativeMaxFindings: process.env.LLM_NARRATIVE_MAX_FINDINGS` を追加すること。
  `llmNarrativeMaxConcurrency`（既定 3）および `analysisJobLeaseDurationMilliseconds`（既定 300000）は変更しないこと。

- [ ] **M-TMO-3 (pre-loop batch — severity/functionalLoad 上位 N 件に絞り込み)**
  `applications/frontend/src/usecase/run-assessment-job/index.ts` の pre-loop batch 処理（現在 `allInputs = draft.findings.map(...)` で全 finding を列挙している箇所）を以下のとおり変更すること:
  1. `draft.findings` を severity 降順 → functionalLoad 降順でソートした順序で、LLM 対象とする **元配列の index 集合**を決定すること。
     - severity 順位: `critical > major > minor > suggestion`（高いほど先）。実値は `domain/assessment-result.ts` の `FindingSeverity`。
     - functionalLoad 順位: **`max > high > mid > low`（高いほど先）**。実値は `oss-worker/schema.ts` / `domain/error-catalog` の `FunctionalLoadRank` = `"max" | "high" | "mid" | "low"`。
       **注意（topology で確認・spec 訂正済み 2026-06-19）**: 当初記述の `high > medium > low` は誤り。コードに `"medium"` は存在せず正しくは `"mid"`、かつ `"max"` が最上位。`null` および未知値は最下位（rank 0）に並べること。
     - 同点（severity 同一・functionalLoad 同一）の finding 間の順序は安定（元配列 index 昇順）であること。
  2. ソート後の上位 `llmNarrativeMaxFindings` 件に対応する **元 finding index** のみを LLM 生成対象（invoker 呼び出し対象）として `precomputed Map` に格納すること。**Map のキーは必ず元配列 index（sorted 後の位置ではない）**であること（ORPHAN RISK 1: sorted index で keying すると解決ループの `precomputed.get(findingIndex)` が原 index 参照とズレて全 finding が誤割当/rule-based に落ちる）。
  3. 上限外の finding は `precomputed.get(index)` が `undefined` を返すため、既存の解決順序
     `findingDraft.feedbackLayers ?? precomputed.get(index) ?? generateFeedbackLayers(input)` により
     自然に rule-based へ落ちること。既存の解決順序ロジックは変更しないこと。
  4. rule-based 選択（`generateFeedbackLayersAsync` が `undefined`）のときは現状の同期パスを維持し、
     この選択ロジックを一切適用しないこと。

- [ ] **M-TMO-4 (バッチ有界不変条件 — 既定値での成立)**
  既定値 `llmNarrativeMaxFindings=8 / llmNarrativeMaxConcurrency=3 / llmNarrativeTimeoutMilliseconds=60000 / analysisJobLeaseDurationMilliseconds=300000` において
  `ceil(8 / 3) × 60000 = 180000 < 300000` が成立すること。
  config の単体テストでこの算術不変条件を数値 assert すること。

- [ ] **M-TMO-5 (`llmNarrativeMaxFindings` を run-assessment-job deps に追加)**
  `RunAssessmentJobDependencies` 型に `llmNarrativeMaxFindings?: number` を追加すること
  （`llmNarrativeMaxConcurrency?: number` を追加した既存パターンと同様の optional dep）。
  pre-loop batch 内で `dependencies.llmNarrativeMaxFindings ?? 8` を上限値として使うこと。
  `registry.ts` の `createRunAssessmentJob(...)` 呼び出しに
  `llmNarrativeMaxFindings: config.llmNarrativeMaxFindings` を追加すること。
  `createRunAssessmentJob` のその他の呼び出し引数は変更しないこと。

### D3 — fallback 可観測化

- [ ] **M-TMO-6 (LLM factory deps に `logger?: Logger` 追加)**
  `applications/frontend/src/acl/improvement-message/llm/create-llm-improvement-message-generator.ts`
  の `LlmImprovementMessageGeneratorDeps` 型に `logger?: Logger` を追加すること
  （`usecase/port/logger` の `Logger` 型）。
  `logger` 未指定時は従来どおり無音（後方互換）。
  factory シグネチャの他の deps は変更しないこと。

- [ ] **M-TMO-7 (4 fallback 点に `logger?.warn` 追加)**
  `createLlmImprovementMessageGenerator` 内の以下 4 箇所の fallback 点それぞれで、
  fallback を返す直前に `logger?.warn("llm narrative fallback", { reason, provider, providerModel })` を出すこと:
  - cache error（`cacheResult.isErr()` のとき）: `reason: "cache_error"`
  - invoker reject / timeout（`catch` ブロック）: `reason: "timeout"` または `"invoker_error"`
    ただし `reason` は ADR-023 D3 が定める固定列挙値
    `"timeout" | "invoker_error" | "parse_failed" | "grounding_rejected" | "cache_error"` の
    いずれか 1 つであること。invoker reject / timeout を区別する必要がある場合は
    AbortController のタイムアウト起因かどうかで `"timeout"` / `"invoker_error"` を使い分けること。
    区別しない実装で両方 `"invoker_error"` とする場合はその旨を ADR-023 D3 の列挙から選択すること
    （`"invoker_error"` は列挙内に存在する）。
  - raw output 空（`!rawOutput || rawOutput.trim() === ""`）: `reason: "parse_failed"`
  - grounding 検証失敗（`!validationResult.valid`）: `reason: "grounding_rejected"`
  logger が未指定のとき（`logger === undefined`）は warn を出さないこと。

- [ ] **M-TMO-8 (run-assessment-job — バッチ後 `logger.info` サマリ)**
  `run-assessment-job/index.ts` の pre-loop batch が完了した後（`precomputed Map` が確定した時点）に
  LLM プロバイダが有効（`generateFeedbackLayersAsync` が定義されている）場合のみ
  以下を 1 行出すこと:
  ```
  dependencies.logger.info("llm narrative batch", {
    provider,         // LLM provider 文字列 (registry から deps 経由)
    requested,        // min(findingCount, llmNarrativeMaxFindings) — LLM 対象に選ばれた件数
    llmSuccess,       // precomputed Map の size（invoker 成功 + cache hit 件数）
    llmFallback,      // requested - llmSuccess
    byReason,         // Record<reason, number> — reason 別の fallback 内訳
  })
  ```
  `provider` は `dependencies.improvementMessageGenerator` から得るか registry から deps に追加して渡すこと
  （どちらでもよい。observable な文字列であれば可）。
  `byReason` を集計するため、factory 側の `logger.warn` から reason を run-assessment-job に
  伝搬させるか、run-assessment-job 自身が promise resolve/reject の結果を観測して集計すること
  （実装方法は問わないが `byReason` が reason 別の数値 map として JSON に出力されること）。
  rule-based 選択（`generateFeedbackLayersAsync` が undefined）のときはサマリを出さないこと。

- [ ] **M-TMO-9 (registry — LLM factory に `logger` を渡す)**
  `applications/frontend/src/registry.ts` の `createLlmImprovementMessageGenerator({...})` 呼び出しに
  既存 `logger`（`createStructuredLogger(config.nodeEnv)` で構築済みの変数）を追加で渡すこと:
  ```typescript
  createLlmImprovementMessageGenerator({
    provider: config.llmCoachingProvider,
    invoker,
    cache: narrativeCache,
    fallback: fallbackGenerator,
    promptVersion: config.llmNarrativePromptVersion,
    providerModel,
    logger,   // ← 追加
  })
  ```
  registry の他の箇所は変更しないこと。

### D4 — ADR-021 amend

- [ ] **M-TMO-10 (ADR-021 D3/M-LLM-6 の timeout 既定記述に ADR-023 訂正注記を追記)**
  `adr/021-llm-coaching-narrative-switchable-claude-ollama-rule-fallback.md` の
  D3 記述および M-LLM-6 の「timeout 30000ms」言及箇所に
  「ADR-023 により既定 60000ms へ改訂」の注記が追記されていること。

- [ ] **M-TMO-11 (ADR-021 Notes Risks の latency 仮定を実測値で訂正)**
  同 ADR の Notes Risks に `cold ~8.8s / warm ~4.1s` / `5 finding 並列 ~9s` の記述が存在する箇所に
  「ADR-023: grounded narrative 実測 wall time は ~40s/call で、probe 値は本番 latency を表さない。
  timeout 既定は ADR-023 で 60000ms、LLM 対象 finding は llmNarrativeMaxFindings（既定 8）に
  上限化して 300s lease 内（ceil(8/3)×60s=180s）に有界化」の訂正が追記されていること。
  ただし ADR-021 には既に `【ADR-023 で訂正】` 注記が存在するため（確認済み）、
  この Must は「注記が存在すること」の verify-only であること。

- [ ] **M-TMO-12 (ADR-021 Related / Changes に ADR-023 参照が存在する)**
  同 ADR の Related セクションおよび末尾の Changes/Related に ADR-023 への参照が存在すること。
  ADR-021 の worker 契約（messageJa=null / structured diff）・provider 機構・
  grounding contract・cache 設計の記述は削除・変更しないこと。

## Should (望ましいが必須でない)

- **S-TMO-1**: `configSchema` の `llmNarrativeMaxFindings` フィールドのコメントに、
  `ceil(llmNarrativeMaxFindings / llmNarrativeMaxConcurrency) × llmNarrativeTimeoutMilliseconds < analysisJobLeaseDurationMilliseconds`
  の不変条件を運用注記として記載すること。
- **S-TMO-2**: `llmNarrativeTimeoutMilliseconds` フィールドのコメントを
  「既定 60000ms（ADR-023。実測 ~40s/call に対応）」に更新すること。
- **S-TMO-3**: `createLlmImprovementMessageGenerator` の JSDoc に ADR-023 D3 の reason 列挙値を記載すること。
- **S-TMO-4**: pre-loop batch の sorting ロジックに、なぜ severity → functionalLoad 順かのコメント
  （ADR-023 D2: LLM を最も重要な finding に集中投下する）を記載すること。

## 受入条件 (acceptance — Must の確認方法)

- **M-TMO-1** →
  `grep -n "llmNarrativeTimeoutMilliseconds" applications/frontend/src/infrastructure/config/index.ts`
  で `.default(60000)` が確認できること（`.default(30000)` が残存しないこと）。
  config 単体テストで `createConfig()` の `llmNarrativeTimeoutMilliseconds` が `60000` であることを assert すること（`LLM_NARRATIVE_TIMEOUT_MS` 未設定時）。
  `pnpm typecheck` 緑。

- **M-TMO-2** →
  `grep -n "llmNarrativeMaxFindings\|LLM_NARRATIVE_MAX_FINDINGS" applications/frontend/src/infrastructure/config/index.ts`
  で フィールド定義と env マッピングの両方が確認できること。
  config 単体テストで `createConfig()` の `llmNarrativeMaxFindings` が `8` であることを assert すること（`LLM_NARRATIVE_MAX_FINDINGS` 未設定時）。
  `pnpm typecheck` 緑。

- **M-TMO-3** →
  単体テスト: finding が `llmNarrativeMaxFindings` 件を超える入力（例: 10 finding、上限 8）で
  pre-loop batch を実行したとき、`generateFeedbackLayersAsync` が高々 8 回しか呼ばれないことを
  テストダブル（テストファイル限定）で assert すること（`llmNarrativeMaxFindings + 1` 回以上呼ばれないこと）。
  選択順序テスト: severity=critical > severity=major の finding が先に選ばれること、
  同 severity のとき functionalLoad=high > functionalLoad=mid が先に選ばれること（実値 `max > high > mid > low`、`null`/未知値は最下位）を assert すること。
  同点 finding（severity 同一・functionalLoad 同一）の選択が安定（元の finding 配列 index 順）であることを assert すること。
  LLM 対象に選ばれた finding の feedbackLayers が precomputed Map から正しい元 index で解決されること（ORPHAN RISK 1 の回帰）を assert すること。
  `pnpm test --run` 緑。

- **M-TMO-4** →
  config 単体テストで `Math.ceil(8 / 3) * 60000 < 300000` を数値演算で assert すること（yes/no: `true`）。
  `pnpm test --run` 緑。

- **M-TMO-5** →
  `grep -n "llmNarrativeMaxFindings" applications/frontend/src/usecase/run-assessment-job/index.ts`
  で `RunAssessmentJobDependencies` 型と使用箇所（`dependencies.llmNarrativeMaxFindings ?? 8`）が確認できること。
  `grep -n "llmNarrativeMaxFindings" applications/frontend/src/registry.ts`
  で `createRunAssessmentJob({..., llmNarrativeMaxFindings: config.llmNarrativeMaxFindings})` が確認できること。
  `pnpm typecheck` 緑。

- **M-TMO-6** →
  `grep -n "logger" applications/frontend/src/acl/improvement-message/llm/create-llm-improvement-message-generator.ts`
  で `LlmImprovementMessageGeneratorDeps` の `logger?: Logger` フィールドが確認できること。
  単体テスト: `logger` を渡さずに factory を構築したとき、従来どおりフォールバックが返ること（後方互換）を assert すること。
  `pnpm typecheck` 緑。

- **M-TMO-7** →
  単体テスト（テストファイル限定の logger テストダブルを使用）:
  - cache error 時（`findBySignature` が Err を返す）: `logger.warn` が `{ reason: "cache_error", provider, providerModel }` で呼ばれること。
  - invoker reject 時: `logger.warn` が `reason` が `"invoker_error"` または `"timeout"` のいずれかで呼ばれること（実装選択に従う）。
  - raw output 空（`""` を返す invoker）時: `logger.warn` が `reason: "parse_failed"` で呼ばれること。
  - grounding 検証失敗時: `logger.warn` が `reason: "grounding_rejected"` で呼ばれること。
  上記 4 ケース全てで `logger.warn` の第 1 引数が `"llm narrative fallback"` であること。
  `logger` 未指定時は `logger.warn` が呼ばれないこと（エラー不発）を assert すること。
  `pnpm test --run` 緑。

- **M-TMO-8** →
  単体テスト（テストファイル限定の logger テストダブルを使用）:
  finding 3 件・`llmNarrativeMaxFindings=3`・うち 2 件が invoker 成功、1 件が fallback の入力で
  pre-loop batch 実行後に `logger.info("llm narrative batch", context)` が 1 回呼ばれること。
  `context.requested === 3`、`context.llmSuccess === 2`、`context.llmFallback === 1`、
  `context.byReason` が reason 別の数値 map であること（`byReason[<reason>] >= 0` が成立）を assert すること。
  rule-based 選択（`generateFeedbackLayersAsync` が undefined）時は `logger.info("llm narrative batch", ...)` が呼ばれないことを assert すること。
  `pnpm test --run` 緑。

- **M-TMO-9** →
  `grep -n "logger" applications/frontend/src/registry.ts`
  で `createLlmImprovementMessageGenerator({..., logger, ...})` に `logger` が含まれていることが確認できること。
  LLM provider 有効時のみ渡されること（rule-based 分岐では createLlmImprovementMessageGenerator を呼ばないため無関係）。
  `pnpm typecheck` 緑。

- **M-TMO-10** →
  `grep -n "ADR-023\|60000" adr/021-llm-coaching-narrative-switchable-claude-ollama-rule-fallback.md`
  で D3 / M-LLM-6 相当箇所に `60000` への改訂注記と ADR-023 への参照が確認できること。

- **M-TMO-11** →
  `grep -n "ADR-023\|40s\|llmNarrativeMaxFindings" adr/021-llm-coaching-narrative-switchable-claude-ollama-rule-fallback.md`
  で Notes Risks の latency 訂正注記が確認できること。
  `grep -c "8.8s\|4.1s\|9s best-case" adr/021-llm-coaching-narrative-switchable-claude-ollama-rule-fallback.md`
  でヒットする場合は、その箇所に ADR-023 訂正注記が隣接していること（元の probe 値を削除する必要はない）。

- **M-TMO-12** →
  `grep -n "ADR-023" adr/021-llm-coaching-narrative-switchable-claude-ollama-rule-fallback.md`
  が 1 件以上ヒットすること。
  `grep -n "messageJa.*null\|worker.*not.*embed\|messageJa=null" adr/021-llm-coaching-narrative-switchable-claude-ollama-rule-fallback.md`
  で worker 契約記述が維持されていること（削除・改変なし）。

### Runtime 検証（live 観測 assert）

- **LIVE-TMO** →
  `LLM_COACHING_PROVIDER=claude-code` かつ `LLM_NARRATIVE_TIMEOUT_MS` 未設定（= 60000ms 適用）で
  実録音を含むセッションを `pnpm dev` 環境で assess したとき:
  (a) ジョブログに `"llm narrative batch"` の JSON が出力されること（`llmSuccess` / `llmFallback` / `byReason` キーを含む）。
  (b) `llmSuccess + llmFallback === requested` が成立すること（バッチカウント一致）。
  (c) finding 総数が `llmNarrativeMaxFindings`（8）を超えるジョブで、invoker 呼び出し数が 8 以下になること
      （ジョブ実行ログの `llm narrative batch` の `requested` フィールドが 8 以下であることで確認）。
  (d) timeout fallback が発生した場合に `"llm narrative fallback"` warn ログが `reason: "timeout"` で出ること。
  (e) バッチ総時間が 300s 以内に完了すること（ジョブが lease 内で complete/fail に遷移すること）。
  `.agent-evidence/llm-narrative-timeout-budget/commands.txt` に上記 (a)-(e) の実行コマンドと観測値を記録すること。

## Non-goals (今回やらない)

- **metered API / 新 subprocess / 新 network 経路の追加**: ADR-021 が確定した provider 機構・invoker・cache は変更しない。
- **`llmNarrativeMaxConcurrency` の既定変更**: 3 のまま（ADR-023 D2 明示）。
- **`analysisJobLeaseDurationMilliseconds` の変更**: 300000ms のまま（ADR-023 D2 明示）。
- **metrics 基盤（Prometheus / OTel）の導入**: 既存 structured logger のみで完結する（ADR-023 D3 明示）。
- **UI 変更**: design-system-v3 / DetailPanelV2 / ArticulationCard は変更しない（ADR-023 は UI に触れない）。
- **grounding contract / cache 設計 / timeout SIGTERM 機構の変更**: timeout の既定値のみを変更し、AbortController→SIGTERM の機構は不変。
- **rule-based 生成器の挙動変更**: `createRuleBasedImprovementMessageGenerator` は変更しない。
- **Haskell Types.hs / python-analyzer schema / wire 契約の変更**: 本 spec は frontend config・ACL・usecase・registry に閉じる。
- **finding 総数が `llmNarrativeMaxFindings` 以内のジョブの挙動変更**: 全 finding が LLM 対象のまま（上限は cap として機能するだけ）。

## Risk

- level: **high-risk**
- escalate_to_opus: **true**
- 理由（触れる境界領域）:

  **assessment-job critical path への変更**
  pre-loop batch の finding 選択ロジック（severity/functionalLoad ソート + 上限化）は
  `runAssessmentJob` の critical path 上にあり、バグがあると全 finding が LLM 対象から外れるか
  逆に全 finding が LLM 呼び出しに入って lease を超える可能性がある。
  blast radius = LLM 有効環境のすべての assessment job に影響。

  **config default 変更の副作用**
  `llmNarrativeTimeoutMilliseconds` の既定変更は、現行 `LLM_COACHING_PROVIDER=claude-code` を
  設定している運用環境で即時に 60s timeout が適用される。失敗する呼び出しの待ち時間が 30s → 60s に伸びる。
  env override で旧値（30000）に戻すことは可能だが、M-TMO-4 の不変条件を破る可能性がある。

  **不変条件の env override 破壊リスク**
  `llmNarrativeMaxFindings` / `llmNarrativeTimeoutMilliseconds` / `llmNarrativeMaxConcurrency` を
  env で変更した場合に `ceil(maxFindings/concurrency) × timeout < lease` を破れる。
  例: `LLM_NARRATIVE_MAX_FINDINGS=30, LLM_NARRATIVE_TIMEOUT_MS=60000, LLM_NARRATIVE_MAX_CONCURRENCY=3`
  → `ceil(30/3) × 60s = 600s > 300s`。spec の M-TMO-4 が既定値の成立のみを保証し、
  env override への事前ガードは設けない（ADR-023 D2 の運用者責任）。

  **DI / registry 変更**
  registry.ts への `logger` pass-through と `llmNarrativeMaxFindings` dep 追加は
  `globalThis` container singleton の stale 化（memory: nextjs-registry-edit-needs-dev-restart）を
  引き起こすため `pnpm dev` 再起動が必要。CI ではこの問題は発生しない。

## Open questions

なし。ADR-023 は D1–D4・Compliance・Alternatives・Notes で全判断が grill-locked。
- `"timeout"` vs `"invoker_error"` の区別: ADR-023 D3 は両方を列挙内に含めており、
  実装が AbortController 起因と他の reject を区別しない場合に `"invoker_error"` に統一する選択肢も
  列挙内で許容されている。M-TMO-7 の受入条件はどちらでも通るよう `"invoker_error" または "timeout"` と記した。
  これは実装者が選択する事項であり、仕様として未確定点ではない（列挙値の 2 択から任意に選ぶ）。
