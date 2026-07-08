# LLM narrative timeout budget and fallback observability

ADR-023: LLM コーチング narrative の timeout 既定見直し・lease 内バッチ有界化・silent fallback の可観測化

# Status

Proposed

# Context

ADR-021 は ImprovementMessageGenerator に LLM provider（claude -p subscription / Ollama）を導入し、録音固有事実を grounding した coaching narrative を feedbackLayers として生成する設計を確定した。その D3/D6/M-LLM-6 は呼び出し timeout を `llmNarrativeTimeoutMilliseconds`（既定 30000ms）とし、超過時は AbortController で子プロセスに SIGTERM を送って reject → 決定論ルールベースに fallback する。pre-loop batch は並列度 `llmNarrativeMaxConcurrency`（既定 3）でチャンク化する。ADR-021 Notes の Risks は cold ~8.8s / warm ~4.1s（4 番目調査の probe 実測）を根拠に『5 finding 並列 ~9s』を best-case として記し、lease 300s 内に収まると仮定していた。

ADR-021 実装後の runtime 検証（2026-06-19, live `claude -p` を real entrypoint で実行）で、この latency 仮定が実態と乖離していることが判明した。grounding prompt を付けた本番の narrative 生成 1 回あたりの wall time は **~40s（実測）** で、probe 値の 4.1s/8.8s とは桁が違う。結果、既定 30000ms timeout を超過した呼び出しが SIGTERM→reject→fallback に落ち、`LLM_COACHING_PROVIDER=claude-code` でも 18 finding 中 LLM narrative を得たのは 1 件のみ、残りは rule-based に silent fallback した（`llm_narrative_cache` も 1 行）。この fallback は ADR-021 D1 の設計どおりで narrative が空にはならない（壊れてはいない）が、**(a) LLM の付加価値がほぼ出ない** うえ **(b) どの finding がどの reason で fallback したかが一切ログに出ず観測できない**（factory の 4 つの fallback 点 — invoker reject/timeout・JSON parse 失敗・grounding 検証失敗・cache error — はいずれも fallbackLayers を返すだけで silent）。

lease の現状（オンディスク確認済み）: 実 lease は `config.analysisJobLeaseDurationMilliseconds`（既定 **300000ms = 300s**、env `ANALYSIS_JOB_LEASE_DURATION_MS`）で、registry.ts が `leaseDurationSeconds: Math.floor(config.analysisJobLeaseDurationMilliseconds / 1000)` として run-assessment-job に渡す（run-assessment-job schema の `leaseDurationSeconds` default 60 は registry が値を渡すため実機では使われない）。timeout を実測 ~40s に合わせて引き上げると総ジョブ時間が増え、`ceil(findingCount / concurrency) × timeout` が 300s lease を超えうる（例: timeout 60s・concurrency 3・finding 18 で realistic ~240s、worst-case 360s。finding 30 で 600s）。よって timeout 引き上げは lease との結合を解かないと lease 満了→（in-process 単一 runner の MVP では二重処理は起きにくいが）lease semantics が脆くなる。

logger 基盤（オンディスク確認済み）: `infrastructure/logger.ts` の `createStructuredLogger(nodeEnv): Logger` が debug/info/warn/error を JSON 構造化出力する。run-assessment-job は既に `dependencies.logger`（port/logger の Logger 型）を保持し lease 取得等で `logger.info` を出している。metrics 基盤（Prometheus/OTel 等）はローカル MVP に存在しない。

本 ADR は ADR-021 の責務境界・provider 機構・grounding contract・cache 設計には一切触れず、**運用パラメータ（timeout 既定）と batch 有界化と可観測性**のみを決定し、ADR-021 の latency 仮定を実測値で訂正する。

# Decision

**D1 — `llmNarrativeTimeoutMilliseconds` の既定を 30000 → 60000ms に引き上げる。** ADR-021 D3/D6/M-LLM-6 が定めた 30000ms 既定は、grounded narrative の実測 wall time ~40s を下回るため大半の呼び出しを SIGTERM→fallback に落とす。既定を 60000ms とし、実測 p50 ~40s に十分なマージンを与える（cold 起動 + CLAUDE.md/hooks ロード overhead + 低スペック CPU 直列化を吸収）。env `LLM_NARRATIVE_TIMEOUT_MS` での上書きは従来どおり。これは ADR-021 D3 の AbortController→SIGTERM 機構・fallback 経路そのものは不変で、しきい値の既定値のみを変更する。

**D2 — LLM narrative を付与する finding 数を上限化し、バッチ総時間を lease 内に決定論的に収める。** 新 config `llmNarrativeMaxFindings`（`z.coerce.number().int().positive().default(8)`、env `LLM_NARRATIVE_MAX_FINDINGS`）を追加する。run-assessment-job の pre-loop batch は、`generateFeedbackLayersAsync` が定義されている場合でも、全 finding ではなく **severity 降順 → functionalLoad（high>medium>low）降順**で選んだ上位 `llmNarrativeMaxFindings` 件のみを LLM 生成対象とし、残りの finding は同期 rule-based feedbackLayers をそのまま使う（ADR-021 の解決順序 `findingDraft.feedbackLayers ?? precomputed.get(index) ?? generateFeedbackLayers(input)` で、上限外 finding は precomputed Map に入らないため自然に rule-based へ落ちる）。これにより worst-case バッチ = `ceil(llmNarrativeMaxFindings / llmNarrativeMaxConcurrency) × llmNarrativeTimeoutMilliseconds` = `ceil(8/3) × 60s = 180s` となり、**finding 総数に依らず既存 300s lease 内に収まる**。`llmNarrativeMaxConcurrency` は 3 のまま維持する（claude -p の spawn は ~200-500ms の起動 overhead と CPU バウンドな本体を持ち、並列度を上げると低スペック単一マシンで全呼び出しが直列化して遅延する）。lease（`analysisJobLeaseDurationMilliseconds`）の既定変更は不要。運用上 `llmNarrativeMaxFindings` または `llmNarrativeTimeoutMilliseconds` を引き上げる場合は不変条件 `ceil(llmNarrativeMaxFindings / llmNarrativeMaxConcurrency) × llmNarrativeTimeoutMilliseconds < analysisJobLeaseDurationMilliseconds` を維持すること（超える場合は lease を併せて引き上げる）。

**D3 — silent fallback を構造化ログで可観測にする。** ADR-021 で factory の 4 つの fallback 点（invoker reject/timeout・JSON parse 失敗・grounding 検証失敗・cache error）はいずれも fallbackLayers を返すだけで観測手段が無かった。これを次のとおり可観測化する: (1) LLM ACL factory（create-llm-improvement-message-generator.ts）に optional な `logger?: Logger`（port/logger の型）を deps として追加し、各 fallback 点で `logger?.warn("llm narrative fallback", { reason, provider, providerModel })` を出す。`reason` は `"timeout" | "invoker_error" | "parse_failed" | "grounding_rejected" | "cache_error"` の固定列挙とする。(2) run-assessment-job の pre-loop batch は完了後に `dependencies.logger.info("llm narrative batch", { provider, requested, llmSuccess, llmFallback, byReason })` のジョブ単位サマリを 1 行出す（`requested` = LLM 対象に選ばれた finding 数 = `min(findingCount, llmNarrativeMaxFindings)`、`llmSuccess` = narrative 採用数、`llmFallback` = fallback 数、`byReason` = reason 別内訳）。(3) registry が LLM factory 構築時に既存 logger を渡す。metrics 基盤は導入せず、既存 structured logger のみで完結する。grounding 検証で弾いた hallucination も `grounding_rejected` として可視化されるため、prompt/モデル品質の運用監視にも使える。

**D4 — ADR-021 を amend し、latency 仮定を実測値で訂正する。** ADR-021 D3/D6/M-LLM-6 の timeout 既定記述（30000ms）に「ADR-023 により既定 60000ms へ改訂」を、ADR-021 Notes Risks の cold ~8.8s/warm ~4.1s・『5 finding 並列 ~9s』best-case 記述に「ADR-023: grounded narrative の実測 wall time は ~40s/call で、この probe 値は本番 latency を表さない。timeout 既定は ADR-023 で 60000ms、LLM 対象 finding は `llmNarrativeMaxFindings`(既定 8) に上限化して 300s lease 内に有界化」を追記する。ADR-021 の Related/Changes に ADR-023 を追記する。worker 契約・provider 機構・grounding contract・cache 設計は不変。

# Contract changes

- **frontend infrastructure/config/index.ts — configSchema**: `llmNarrativeTimeoutMilliseconds` の `.default(30000)` を `.default(60000)` に変更（env `LLM_NARRATIVE_TIMEOUT_MS` は不変）。新規追加: `llmNarrativeMaxFindings: z.coerce.number().int().positive().default(8)`（env `LLM_NARRATIVE_MAX_FINDINGS`）。`createConfig` の safeParse 入力に `LLM_NARRATIVE_MAX_FINDINGS` のマッピングを追加。既存の他フィールドは不変。
- **frontend acl/improvement-message/llm/create-llm-improvement-message-generator.ts — createLlmImprovementMessageGenerator の deps**: optional `logger?: Logger`（`usecase/port/logger` の型）を追加。4 つの fallback 点で `logger?.warn("llm narrative fallback", { reason, provider, providerModel })` を出す。`reason` 列挙は `"timeout" | "invoker_error" | "parse_failed" | "grounding_rejected" | "cache_error"`。logger 未指定時は従来どおり無音（後方互換）。narrative の戻り値・cache 挙動・grounding 検証は不変。
- **frontend usecase/run-assessment-job/index.ts — pre-loop batch**: `generateFeedbackLayersAsync` 定義時、全 finding ではなく severity 降順→functionalLoad 降順で上位 `llmNarrativeMaxConcurrency` … ではなく上位 `llmNarrativeMaxFindings` 件のみを LLM 対象に選び（`findingDraft.severity` / `findingDraft.functionalLoad` で順序付け）、選ばれた finding index のみ precomputed Map に入れる。上限外 finding は Map に入らないため解決順序で rule-based に落ちる（既存の解決順序ロジックは不変）。バッチ完了後に `dependencies.logger.info("llm narrative batch", { provider, requested, llmSuccess, llmFallback, byReason })` を出す。`llmNarrativeMaxFindings` は deps 経由（ADR-021 で `llmNarrativeMaxConcurrency` を optional dep として渡した同じ要領で、registry 無改修またはもう 1 つの optional dep として渡す）。rule-based 選択時（async 未定義）は現状同期パスを維持し挙動不変。
- **frontend registry.ts — LLM provider 分岐**: `createLlmImprovementMessageGenerator(...)` 呼び出しに既存 `logger` を渡す。`createRunAssessmentJob` の deps に `llmNarrativeMaxFindings: config.llmNarrativeMaxFindings` を渡す（ADR-021 で `llmNarrativeMaxConcurrency` を追加した optional dep と同様の最小追加。改修は dep の追加に限り generator pass-through は不変）。
- **adr/021-llm-coaching-narrative-switchable-claude-ollama-rule-fallback.md — D3/D6/M-LLM-6 timeout 既定・Notes Risks・Related**: D4 に従い ADR-023 への参照と実測 latency 訂正を追記。worker 契約（messageJa=null / structured diff）と ADR-021 の他決定は不変。
- **なし: Haskell Types.hs / python-analyzer schema / wire 契約（AnalysisResponse / AssessmentFinding / EngineFindingDto）**: 本 ADR は frontend の config・ACL・usecase・registry に閉じる。

# Alternatives considered

- **per-call timeout だけ引き上げ、バッチ対象 finding を有界化しない** — Pros: 実装が最小（既定 1 つの変更）。Cons: timeout を 60s に上げると `ceil(findingCount/3) × 60s` が finding 数に比例して伸び、finding が多いジョブで 300s lease を超える。lease 満了は in-process 単一 runner の MVP では二重処理を直ちには招かないが、lease semantics（再 lease・status 遷移）が脆くなり将来の multi-runner 化で破綻する。不採用: 総時間が非有界で lease 保証が崩れる。
- **lease（analysisJobLeaseDurationMilliseconds）を LLM 有効時に引き上げ、全 finding を LLM 対象にする** — Pros: 全 finding が narrative を得られる。Cons: 任意の finding 数に対する worst-case バッチ時間は非有界なので lease をどれだけ上げても十分でない場合が残る。lease を一律に大きくすると rule-based ジョブ（~7-9s で完了）まで長い lease を保持し、runner クラッシュ時の復旧が遅れる。provider 別 lease にすると config/registry が複雑化する。不採用: 上限化（D2）の方が決定論的で副作用が小さい。finding 数によらず lease を超えない保証が得られる。
- **`llmNarrativeMaxConcurrency` を上げてバッチ総時間を短縮する** — Pros: 並列度を上げれば総時間が縮みバッチが lease 内に収まりやすい。Cons: claude -p の spawn は ~200-500ms の起動 overhead（--bare 無しで CLAUDE.md/hooks/plugin をロード）と CPU バウンドな本体を持ち、ローカル単一マシンで並列度を上げると全プロセスが CPU を奪い合い 1 件あたりの wall time がかえって伸びる。不採用: 上限化（D2）で対象数を絞る方が低スペック環境で安定。concurrency は 3 維持。
- **Option D（deferred async narrative）: ジョブ成功後に別経路で narrative 生成し次回 read で差し替え** — Pros: ジョブ latency が narrative 生成から完全に独立する。Cons: ADR-021 Alternatives と同じく second write path・UI 二状態・単一パスモデルの破壊。不採用: ADR-021 の判断を踏襲。本 ADR は単一パスのまま batch を有界化することで latency 問題を解く。
- **metrics 基盤（Prometheus / OpenTelemetry）を導入して success/fallback を counter で出す** — Pros: 時系列での監視・アラートが可能。Cons: ローカル MVP に metrics 基盤・収集先が無く、新規インフラ配線（exporter / scrape / dashboard）を要する。不採用: 既存 structured logger（JSON 構造化出力）で reason 別内訳とジョブサマリを出せば運用観測には十分。将来 metrics が要れば logger フィールドを集計する形で後付けできる。

# Consequences

## Positive

- 実測 ~40s/call に対し timeout 60s で大半の上位 finding が LLM narrative を得られる（ADR-021 検証時の 1/18 から改善）。
- `llmNarrativeMaxFindings` 上限化で worst-case バッチが finding 総数に依らず `ceil(8/3)×60s = 180s` に有界化され、既存 300s lease を変更せず収まる。LLM は最も重要な finding（severity / functionalLoad 上位）に集中投下される。
- fallback が reason 付き warn + ジョブ単位サマリで可観測になり、timeout 頻発・grounding 棄却率・cache miss を運用で検知できる。grounding 検証で弾いた hallucination も `grounding_rejected` として可視化される。
- 既存 structured logger だけで完結し、新規インフラを増やさない。

## Negative

- 上位 `llmNarrativeMaxFindings` 件を超える低優先度 finding は、高速なハードウェアであっても LLM narrative を得ず rule-based のままになる（latency 有界化のための意図的なトレードオフ。`LLM_NARRATIVE_MAX_FINDINGS` で調整可能）。
- timeout 60s により、確実に失敗する呼び出し（claude 不調等）でも最大 60s ブロックしてから fallback するため、worst-case の 1 件あたり待ち時間が 30s から伸びる（バッチ全体は D2 の有界化で 300s lease 内）。
- `llmNarrativeMaxFindings` / `llmNarrativeTimeoutMilliseconds` / `llmNarrativeMaxConcurrency` を env で変更する際は不変条件 `ceil(maxFindings/concurrency) × timeout < lease` を運用者が再確認する必要がある（ADR と config コメントに明記）。
- fallback の warn ログは finding 数ぶん出るため、provider 有効かつ timeout 頻発時にログ量が増える（reason 集計はジョブサマリで担保）。

# Compliance

- config 既定 test: `llmNarrativeTimeoutMilliseconds` の既定が 60000、`llmNarrativeMaxFindings` の既定が 8 であることを assert。
- batch 有界化 test: finding 数が `llmNarrativeMaxFindings` を超える入力で、invoker（generateFeedbackLayersAsync）が高々 `llmNarrativeMaxFindings` 回しか呼ばれず、上限外 finding は rule-based feedbackLayers になることを assert。
- 選択順序 test: LLM 対象に選ばれる finding が severity 降順→functionalLoad 降順の上位 N 件であることを assert（同点時の決定性も確認）。
- 可観測性 test: 各 fallback reason（timeout / invoker_error / parse_failed / grounding_rejected / cache_error）で `logger.warn` が対応する reason で呼ばれること、バッチ後に `logger.info("llm narrative batch", {...})` が `requested/llmSuccess/llmFallback/byReason` を含んで呼ばれることを assert（logger をテストダブルで観測、テストファイル限定）。
- 不変条件 test/lint: `ceil(llmNarrativeMaxFindings / llmNarrativeMaxConcurrency) × llmNarrativeTimeoutMilliseconds < analysisJobLeaseDurationMilliseconds` が既定値で成立すること（180s < 300s）を config test で確認。
- runtime 検証: `LLM_COACHING_PROVIDER=claude-code` かつ timeout 60s で実録音を assess し、(a) 複数の上位 finding（高々 `llmNarrativeMaxFindings` 件）が rule-based と異なる LLM narrative を得てバッチが 300s lease 内に完了すること、(b) ジョブログに `llm narrative batch` サマリが出て `llmSuccess/llmFallback/byReason` が観測できること、(c) timeout に落ちた finding が `reason:"timeout"` の warn を出すこと、を live で観測 assert する。

# Notes

- Risks:
  - 実測 ~40s/call は本セッション（2026-06-19）の 1 環境での観測値であり、ハードウェア・claude バージョン・モデル・プロンプト長で変動する。timeout 60s でも遅い環境では fallback が増えうるが、D3 の可観測化で運用検知できる。`LLM_NARRATIVE_TIMEOUT_MS` でさらに引き上げる場合は D2 の不変条件を維持すること。
  - `llmNarrativeMaxFindings` 上限化は「重要な finding ほど narrative の価値が高い」という前提に立つ。severity/functionalLoad が narrative 価値の良い代理であるかは設計仮定で、エビデンスは薄い（ADR-021 Notes E-15 と同様）。
  - claude -p の cold/warm 差・fence 出力の非決定性（ADR-021 実装時の `stripCodeFence` で吸収済）により latency と成功率はばらつく。byReason サマリで `parse_failed` が高い場合は出力形の再点検が要る。
  - logger.warn のログ量増加は provider 有効時のみ。rule-based 既定では LLM 経路自体が動かないためログは出ない。
- Amends: ADR-021 D3/D6/M-LLM-6 の timeout 既定（30000→60000）と Notes Risks の latency 仮定（probe ~9s → 実測 ~40s）と Related。worker の structured-diff / messageJa=null 契約・provider 機構・grounding contract・cache 設計は不変。
- Depends on: ADR-021（LLM narrative provider 機構・timeout/SIGTERM 機構・pre-loop batch・fallback 経路 — 本 ADR が運用パラメータと可観測性を上書きする対象）。ADR-004（worker は narrative を author しない責務境界 — 不変）。
- Author: lihs
- Last updated: 2026-06-19
- Related: ADR-021（LLM coaching narrative — 本 ADR が timeout 既定・batch 有界化・fallback 可観測性を amend）、ADR-004（scoring/narrative 責務境界 — 不変）。
