# Spec: llm-coaching-narrative

<!-- 設計の正 / 背景:
       adr/021-llm-coaching-narrative-switchable-claude-ollama-rule-fallback.md (Proposed, 2026-06-18)
         D1: LLM adaptor factory — createLlmImprovementMessageGenerator, wraps real rule-based as fallback
         D2: port input extension (gop/functionalLoad), async method, batch parallel pre-loop
         D3: claude -p subprocess invoker (spawn, NOT exec; keychain auth; no ANTHROPIC_API_KEY in env)
         D4: grounding contract (transform-only system prompt + structured user prompt + output validation)
         D5: LlmNarrativeCache port + drizzle repo + sha256 signature
         D6: 8 new config fields + registry branch (default rule-based)
         D7: Ollama invoker (fetch POST /api/generate stream:false)
         D8: NO UI change — narrative rides existing feedbackLayers
         D9: ADR-004 amendment (un-defer LLM strategy)
     現状コード確認 (2026-06-19):
       port: detectedTopCandidate/nBest は ADR-020 で既に追加済み。gop/functionalLoad/generateFeedbackLayersAsync は未追加。
       run-assessment-job: detectedTopCandidate/nBest は両呼び出し点（generate/generateFeedbackLayers）へ既配線。
                           gop/functionalLoad は findingsWithId 構築時には参照されているが generator 入力には未配線。
                           pre-loop batch 並列生成は未実装。
       registry.ts: L360 = createRuleBasedImprovementMessageGenerator() のみ（分岐なし）。
       config/index.ts: LLM 関連フィールドなし。
       schema.ts: llm_narrative_cache テーブルなし。
     依存 ADR:
       ADR-004 (D9 amendment 対象): Context L18 "switchable RuleBased/LLM strategy" defer 解除
       ADR-020: detectedTopCandidate/nBest 配線ずみ (M-LLM-1 の前提条件として landing 済み)
     配線点 (agent-policy §wiring):
       frontend: usecase/port/improvement-message-generator.ts (型拡張)
       frontend: usecase/port/llm-narrative-cache.ts (新規 port)
       frontend: usecase/run-assessment-job/index.ts (gop/functionalLoad 配線 + pre-loop batch)
       frontend: acl/improvement-message/llm/ (新規 4 ファイル)
       frontend: infrastructure/drizzle/schema.ts (llm_narrative_cache テーブル)
       frontend: infrastructure/drizzle/repositories/llm-narrative-cache-repository.ts (新規)
       frontend: infrastructure/config/index.ts (8 フィールド追加)
       frontend: registry.ts (L360 分岐に置換)
       root: .ast-grep/rules/ (llm-env-access 補助ルール新規)
       adr/004-*.md (Context L18 + Changes/Related 追記)
     強制レイヤ: scripts/verify-no-stub-placeholder.sh / verify-wiring.sh + fitness hook + CI -->

## Goal

- `ImprovementMessageGenerator` に LLM provider（claude -p subscription / local Ollama）を追加し、
  learner の実録音固有事実（gop / detectedTopCandidate / nBest / functionalLoad）を grounding した
  coaching narrative を feedbackLayers（whatJa/whyJa/howJa）として生成する。
- 既定は rule-based のまま（opt-in まで挙動不変）。error / timeout / grounding 違反は
  決定論ルールベース生成器（本番実コード）に fallback し、学習者に空文が届かないことを保証する。
- ADR-004 Context L18 の LLM defer（REQ-106）を解除し、provider-switchable として active に記録する。

## Must (満たさなければ done でない)

### ポート拡張 (D2)

- [ ] **M-LLM-1 (ImprovementMessageGeneratorInput — gop / functionalLoad 追加)**
  `applications/frontend/src/usecase/port/improvement-message-generator.ts` の
  `ImprovementMessageGeneratorInput` に以下の任意フィールドを追加すること。
  既存 11 フィールド（phenomenon / expected / detected / wordPositionLabel / catalogId /
  wordPair / expectedPronunciation / insertedVowel / insertionPositionMs /
  detectedTopCandidate / nBest）は変更しないこと（後方互換）:
  - `gop?: number | null`
  - `functionalLoad?: string | null`

- [ ] **M-LLM-2 (ImprovementMessageGenerator — generateFeedbackLayersAsync 追加)**
  同ファイルの `ImprovementMessageGenerator` 型に
  `generateFeedbackLayersAsync?: (input: ImprovementMessageGeneratorInput) => Promise<FeedbackLayersOutput>`
  を追加すること。同期メソッド `generate` / `generateFeedbackLayers` は不変。
  rule-based 生成器はこのメソッドを実装しない（undefined のまま）。
  LLM 生成器のみ実装する。

### run-assessment-job 配線 (D2)

- [ ] **M-LLM-3 (run-assessment-job — gop / functionalLoad の両呼び出し点配線)**
  `usecase/run-assessment-job/index.ts` の `generate` 呼び出しに渡す input オブジェクトと
  `generateFeedbackLayers` 呼び出しに渡す input オブジェクトの両方に
  `gop: findingDraft.gop ?? null` と `functionalLoad: findingDraft.functionalLoad ?? null`
  を追加で渡すこと。
  どちらか片方のみでは要件を満たさない（2 点とも必須）。

- [ ] **M-LLM-4 (run-assessment-job — pre-loop batch 並列生成)**
  `findingsWithId` 構築ループの前に、`generateFeedbackLayersAsync` が定義されている場合、
  全 finding の input オブジェクトを構築し、並列度上限（`config.llmNarrativeMaxConcurrency`、既定 3）で
  チャンク化した Promise.all で並列生成し、`Map<number, FeedbackLayersOutput>`（finding index → output）
  に格納すること。
  ループ内の `feedbackLayers` 解決順序は:
  `findingDraft.feedbackLayers ?? precomputed.get(index) ?? generateFeedbackLayers(input)`。
  `messageJa` は解決済み `feedbackLayers.whatJa` を採用すること。
  `generateFeedbackLayersAsync` が undefined のとき（rule-based 選択）は現状の同期ループを維持し、
  挙動を変えないこと。

### LLM ACL (D1)

- [ ] **M-LLM-5 (LLM adaptor factory)**
  `applications/frontend/src/acl/improvement-message/llm/create-llm-improvement-message-generator.ts`
  を factory + plain object で新規作成すること（クラス構文禁止）。
  シグネチャ:
  ```
  createLlmImprovementMessageGenerator(deps: {
    provider: "claude-code" | "ollama";
    invoker: LlmNarrativeInvoker;
    cache: LlmNarrativeCache;
    fallback: ImprovementMessageGenerator;
    promptVersion: string;
    providerModel: string;
  }): ImprovementMessageGenerator
  ```
  `fallback` は `createRuleBasedImprovementMessageGenerator()` の実コードを渡す（stub 不可）。
  invoker が error / timeout / 空 result / grounding 検証失敗（D4）のいずれかで失敗した場合、
  `fallback.generateFeedbackLayers(input)` の結果をそのまま返すこと。
  `generate` は `generateFeedbackLayers(input).whatJa` を返すこと（rule-based と同一規約）。
  同ファイルまたは同ディレクトリ内で
  `LlmNarrativeInvoker = (system: string, user: string) => Promise<string>` 型を定義すること。
  `process.env` を直接参照しないこと（config 値は deps 経由で受け取ること）。

### claude -p subprocess invoker (D3)

- [ ] **M-LLM-6 (claude-code invoker — spawn args + env)**
  `acl/improvement-message/llm/claude-code-narrative-invoker.ts` を新規作成すること。
  `child_process.spawn`（`exec` 不可）で以下の正確な引数ベクタで起動すること:
  `["-p", "--output-format", "json", "--no-session-persistence", "--system-prompt", systemPromptText, "--model", providerModel, userPromptText]`
  `--bare` を引数に含めないこと（含めると keychain/OAuth が読まれず subscription 経路が壊れる）。
  `env` オブジェクトに `ANTHROPIC_API_KEY` を渡さないこと（metered 経路の混入防止）。
  `claudeExecutablePath` は deps 経由で受け取ること（process.env 直参照禁止）。
  stdout を Buffer 収集し JSON parse して `result` フィールドを取り出し、
  そこから `{ whatJa, whyJa, howJa }` を JSON.parse すること（D4 system prompt が JSON 限定出力を強制）。
  `total_cost_usd` フィールドは参照しないこと（notional 表示値、課金実体でない）。
  `AbortController` で `llmNarrativeTimeoutMilliseconds`（既定 30000ms）の timeout を設け、
  超過時は子プロセスへ `SIGTERM` を送ること。
  timeout / 非 0 exit / parse 失敗は reject（LLM adaptor で fallback に落とす）。

- [ ] **M-LLM-7 (Docker / claude PATH 不在 downgrade)**
  `registry.ts` の provider 分岐において、`provider === "claude-code"` かつ
  Docker 環境（`NEXT_RUNTIME` 等の config 由来判定）または `claude` が PATH に存在しないとき、
  provider を rule-based に強制 downgrade してその旨をログに記録すること。
  downgrade 後は `createRuleBasedImprovementMessageGenerator()` が使われ、
  `generateFeedbackLayersAsync` が undefined になること（narrative が空にならないことを保証）。

### grounding contract (D4)

- [ ] **M-LLM-8 (grounding-prompt.ts — system prompt + user prompt builder)**
  `acl/improvement-message/llm/grounding-prompt.ts` を新規作成すること。
  system prompt（固定文、英語）は以下の内容を含むこと:
  "You are a pronunciation coach for Japanese (L1) speakers learning English.
  You receive a structured FINDING object and a CATALOG object.
  Output ONLY a JSON object with exactly three string fields whatJa, whyJa, howJa, all in Japanese.
  You MUST NOT introduce any phonetic claim, IPA symbol, articulatory direction, formant value,
  or word form not present in the FINDING or CATALOG objects.
  Use only the IPA symbols and words given.
  If a field cannot be grounded, copy the corresponding FALLBACK text verbatim.
  Do not add markdown, preamble, or commentary."
  user prompt の構造:
  - `FINDING`: `{ phenomenon, expected{text,ipa}, detected{text,ipa}, wordPositionLabel, gop, detectedTopCandidate, nBest[{phoneme,confidence}], insertedVowel, insertionPositionMs, wordPair, expectedPronunciation, functionalLoad }` — D2 拡張入力フィールドから供給
  - `ACOUSTIC`: acoustic-phonetic 計測 ADR が供給する場合のみ存在。供給されないときはキー自体を省くこと（キーを省略すると正常動作すること）
  - `CATALOG`: `{ l1MechanismJa, articulation.stepsJa, articulation.mannerJa, confusionSet, functionalLoad, intelligibilityImpact }` — ErrorCatalogEntry から取得
  - `FALLBACK`: rule-based 生成器が同じ input に対して返す `{ whatJa, whyJa, howJa }`

- [ ] **M-LLM-9 (出力検証 — fallback + cache 不格納)**
  `grounding-prompt.ts` または LLM adaptor 内に出力検証ロジックを実装すること。
  以下の条件を 1 つでも満たさない返り値は採用せず fallback を返し、cache に格納しないこと:
  (a) 返り値が厳密に 3 キー `whatJa` / `whyJa` / `howJa` のみを持つ object であること
  (b) 各値が空でない string であること
  (c) 各値の文字列長が 4 文字以上 400 文字以下であること
  (d) FINDING / CATALOG / ACOUSTIC のいずれにも出現しない IPA 風トークン
      （`/.../ ` 記法、スラッシュで囲まれた文字列）を含まないこと

### cache (D5)

- [ ] **M-LLM-10 (LlmNarrativeCache port)**
  `applications/frontend/src/usecase/port/llm-narrative-cache.ts` を新規作成すること。
  ```typescript
  export type LlmNarrativeCache = {
    findBySignature(signature: string): ResultAsync<FeedbackLayersOutput | null, DomainError>;
    store(
      signature: string,
      layers: FeedbackLayersOutput,
      metadata: { provider: string; model: string; promptVersion: string },
    ): ResultAsync<void, DomainError>;
  };
  ```

- [ ] **M-LLM-11 (cache signature + adaptor フロー)**
  cache 署名は以下フィールドを `|` 区切りで連結した文字列の sha256 であること:
  `phenomenon | expected.ipa | detected.ipa | catalogId | wordPositionLabel | detectedTopCandidate | insertedVowel | promptVersion | providerModel`
  adaptor のフロー（この順序を守ること）:
  1. 署名計算
  2. `findBySignature` → hit なら即返す（LLM 呼び出しなし）
  3. miss なら invoker 実行
  4. D4 検証通過のみ `store`（検証失敗は store しない）
  5. 返す

- [ ] **M-LLM-12 (drizzle schema — llm_narrative_cache テーブル)**
  `applications/frontend/src/infrastructure/drizzle/schema.ts` に以下のテーブルを追加すること:
  ```typescript
  sqliteTable("llm_narrative_cache", {
    signature: text("signature").primaryKey(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    whatJa: text("what_ja").notNull(),
    whyJa: text("why_ja").notNull(),
    howJa: text("how_ja").notNull(),
    createdAt: text("created_at").notNull(),
  })
  ```
  schema.ts 変更後に `pnpm db:generate` を実行し、migration ファイル（`drizzle/000N_*.sql`）を
  生成すること。生成しないと live DB で "no such table" が発生する（memory: drizzle-migration-regenerate-after-schema）。

- [ ] **M-LLM-13 (drizzle cache repository)**
  `infrastructure/drizzle/repositories/llm-narrative-cache-repository.ts` を新規作成すること。
  `createDrizzleLlmNarrativeCacheRepository(database: DrizzleDatabase): LlmNarrativeCache`。
  `findBySignature` は `SELECT` by signature。`store` は `INSERT OR REPLACE`。

### Ollama invoker (D7)

- [ ] **M-LLM-14 (Ollama invoker)**
  `acl/improvement-message/llm/ollama-narrative-invoker.ts` を新規作成すること。
  `fetch(ollamaEndpoint + "/api/generate", { method: "POST", body: JSON.stringify({ model: ollamaModel, system: systemPromptText, prompt: userPromptText, stream: false }), signal: AbortSignal.timeout(timeoutMs) })`
  で実行し、`response.json().response` を取り出すこと。
  D4 と同一の出力検証・parse をかけること。
  connection refused（daemon 未起動）は reject → LLM adaptor で fallback。

### config + registry (D6)

- [ ] **M-LLM-15 (configSchema — 8 フィールド追加)**
  `infrastructure/config/index.ts` の `configSchema` に以下を追加すること
  （既存フィールドは変更しないこと）:
  | フィールド名 | 型 / デフォルト | env 変数名 |
  |---|---|---|
  | `llmCoachingProvider` | `z.enum(["claude-code","ollama","rule-based"]).default("rule-based")` | `LLM_COACHING_PROVIDER` |
  | `ollamaEndpoint` | `z.string().url().default("http://localhost:11434")` | `OLLAMA_ENDPOINT` |
  | `ollamaModel` | `z.string().min(1).default("llama3.1:8b")` | `OLLAMA_MODEL` |
  | `claudeCodeExecutablePath` | `z.string().min(1).default("claude")` | `CLAUDE_CODE_PATH` |
  | `claudeCodeModel` | `z.string().min(1).default("sonnet")` | `CLAUDE_CODE_MODEL` |
  | `llmNarrativeTimeoutMilliseconds` | `z.coerce.number().int().positive().default(30000)` | `LLM_NARRATIVE_TIMEOUT_MS` |
  | `llmNarrativePromptVersion` | `z.string().min(1).default("v1")` | `LLM_NARRATIVE_PROMPT_VERSION` |
  | `llmNarrativeMaxConcurrency` | `z.coerce.number().int().positive().default(3)` | `LLM_NARRATIVE_MAX_CONCURRENCY` |
  `createConfig` の `safeParse` 入力に上記 env 変数のマッピングを追加すること。

- [ ] **M-LLM-16 (registry.ts — provider 分岐に置換)**
  `registry.ts` の `const improvementMessageGenerator = createRuleBasedImprovementMessageGenerator()`
  （現 L360 付近）を以下の分岐に置換すること:
  - `config.llmCoachingProvider === "rule-based"`（既定）: 現状どおり `createRuleBasedImprovementMessageGenerator()` を使う（挙動不変）。
  - `"claude-code"` / `"ollama"`: `createDrizzleLlmNarrativeCacheRepository(database)` を構築し、
    provider 別 invoker を組み、`createLlmImprovementMessageGenerator({ provider, invoker, cache, fallback: createRuleBasedImprovementMessageGenerator(), promptVersion: config.llmNarrativePromptVersion, providerModel: config.claudeCodeModel | config.ollamaModel })` を `improvementMessageGenerator` にする。
  `createRunAssessmentJob({ ..., improvementMessageGenerator })` の呼び出し側は無改修であること。
  Docker / claude PATH 不在のとき M-LLM-7 に従い rule-based に downgrade すること。

### UI 非変更 (D8)

- [ ] **M-LLM-17 (UI 無改修)**
  `DetailPanelV2` / `ArticulationCard` 等の表示コンポーネントを改修しないこと。
  narrative は既存 `feedbackLayers`（`EngineFindingDto.feedbackLayers: FeedbackLayersDto`）に乗るため、
  UI 無改修で LLM 文に切り替わること。
  provider バッジ等の出所表示を UI に追加しないこと（first slice では narrative の出所を表示しない）。
  `design-system-v3.html` への準拠義務は UI 表面を触るときに適用される。本 ADR では UI を触らないため
  design rule は no-op で満たされる。

### ast-grep 補助ルール (Contract changes)

- [ ] **M-LLM-18 (ast-grep — llm ACL の process.env 直読み禁止)**
  リポジトリルート `.ast-grep/rules/` 配下に補助 ast-grep ルール（例:
  `no-process-env-in-llm-acl.yml`）を新規追加すること。
  `acl/improvement-message/llm/**` 内で `process.env` を直読みするコードを禁止すること
  （既存 `environment-access-only-in-config.yml` と同ディレクトリ。frontend 配下ではない）。
  `pnpm fitness`（`ast-grep scan`）で違反が 0 件であること。

### ADR-004 改訂 (D9)

- [ ] **M-LLM-19 (ADR-004 Context L18 + Changes/Related 追記)**
  `adr/004-scoring-policy-in-haskell-worker-structured-diff.md` の
  Context L18「switchable RuleBased/LLM strategy（the worker must not embed an OpenAI client）」に
  以下を追記すること:
  「LLM 経路は ADR-021 により un-defer（REQ-106 defer 解除）。provider 切替（claude-code subscription /
  ollama / rule-based fallback）で active。worker の structured-diff / messageJa=null 契約は不変。」
  同 ADR の末尾 Changes/Related に ADR-021 を追記すること。
  worker 契約（messageJa=null / structured diff）を変更しないこと。

## Should (望ましいが必須でない)

- **S-LLM-1 (promptVersion bump 運用ルール)**: `grounding-prompt.ts` のコメントに、
  system/user prompt template を変更する際は `LLM_NARRATIVE_PROMPT_VERSION` を bump しないと
  旧 cache が stale narrative を返す運用リスクがある旨を記載すること（memory: ADR-021 Notes 参照）。
- **S-LLM-2 (cold start 警告)**: `claude-code-narrative-invoker.ts` のコメントに
  cold ~8.8s / warm ~4.1s の実測値と、CLAUDE.md（`.ast-grep/` hook を含む）ロードによる
  +200-500ms overhead の注記を入れること（--bare 不使用の副作用）。
- **S-LLM-3 (Ollama 品質限界の明示)**: `ollama-narrative-invoker.ts` のコメントに
  小モデル（7B クラス）の日本語音声説明品質が Claude 未満であり、grounding 検証で弾いた分は
  fallback に落ちるため LLM の付加価値が出ない finding が増える可能性を記載すること。
- **S-LLM-4 (concurrent finding 上限の観測記録)**: `.agent-evidence/` の `commands.txt` に、
  5 finding 並列の wall time 実測値（best-case 楽観値と実際の差）を記録すること。

## 受入条件 (acceptance — Must の確認方法)

- **M-LLM-1** →
  `grep -n "gop\|functionalLoad" applications/frontend/src/usecase/port/improvement-message-generator.ts`
  で `ImprovementMessageGeneratorInput` 内に `gop?: number | null` と `functionalLoad?: string | null` が確認できること。
  `pnpm typecheck` 緑。

- **M-LLM-2** →
  `grep -n "generateFeedbackLayersAsync" applications/frontend/src/usecase/port/improvement-message-generator.ts`
  で optional メソッド定義が確認できること。
  `grep -n "generateFeedbackLayersAsync" applications/frontend/src/acl/improvement-message/rule-based/create-rule-based-improvement-message-generator.ts`
  が 0 件であること（rule-based は未実装）。
  `pnpm typecheck` 緑。

- **M-LLM-3** →
  `grep -n "gop\|functionalLoad" applications/frontend/src/usecase/run-assessment-job/index.ts`
  で `generate` 呼び出し input と `generateFeedbackLayers` 呼び出し input の両方のブロックに
  `gop: findingDraft.gop ?? null` と `functionalLoad: findingDraft.functionalLoad ?? null` が確認できること（片方のみは不可）。
  `pnpm typecheck` 緑。

- **M-LLM-4** →
  `grep -n "generateFeedbackLayersAsync\|precomputed\|llmNarrativeMaxConcurrency" applications/frontend/src/usecase/run-assessment-job/index.ts`
  で pre-loop batch 生成ブロックと Map 参照 + 解決順序（`findingDraft.feedbackLayers ?? precomputed.get(index) ?? generateFeedbackLayers(input)`）が確認できること。
  unit test: `generateFeedbackLayersAsync` を持つ mock generator（テストファイル限定）を使い、
  concurrency=2 で 4 finding を処理したとき invoker が高々 2 並列で呼ばれることを assert すること。
  rule-based（`generateFeedbackLayersAsync` undefined）選択時に既存同期パスが通ることを snapshot テストで assert すること。
  `pnpm test --run` 緑。

- **M-LLM-5** →
  `ls applications/frontend/src/acl/improvement-message/llm/create-llm-improvement-message-generator.ts`
  でファイルが存在すること。
  `grep -n "class " applications/frontend/src/acl/improvement-message/llm/`（再帰）が 0 件であること（クラス禁止）。
  unit test: `invoker` が reject した場合、`generateFeedbackLayers` の結果が `fallback.generateFeedbackLayers(input)` と完全一致することを assert すること。
  `pnpm test --run` 緑。

- **M-LLM-6** →
  unit test（spawn をテストダブルで差し替えるテストファイル限定の構造）で以下を assert すること:
  - spawn に渡す args に `"-p"` / `"--output-format"` / `"json"` / `"--no-session-persistence"` /
    `"--system-prompt"` / `"--model"` が含まれること
  - `"--bare"` が args に含まれないこと
  - spawn に渡す `env` オブジェクトに `ANTHROPIC_API_KEY` キーが存在しないこと
  `pnpm test --run` 緑。

- **M-LLM-7** →
  unit test: `claudeCodeExecutablePath = "/nonexistent/claude"` で invoker を生成した場合、
  `improvementMessageGenerator.generateFeedbackLayersAsync` が undefined か、または
  呼び出し時に `fallback.generateFeedbackLayers(input)` の結果を返すことを assert すること。
  `pnpm test --run` 緑。

- **M-LLM-8** →
  `grep -n "You are a pronunciation coach" applications/frontend/src/acl/improvement-message/llm/grounding-prompt.ts`
  でシステムプロンプト文字列が確認できること。
  `grep -n "FINDING\|CATALOG\|FALLBACK\|ACOUSTIC" applications/frontend/src/acl/improvement-message/llm/grounding-prompt.ts`
  で user prompt のキー構造が確認できること。
  `pnpm typecheck` 緑。

- **M-LLM-9** →
  unit test（テストファイル限定）で以下の LLM 返り値それぞれについて fallback が返ることを assert すること:
  - キーが 4 つある object（`{ whatJa, whyJa, howJa, extra: "x" }`）
  - `whatJa` が空文字列 `""`
  - `howJa` が 3 文字（4 文字未満）
  - FINDING / CATALOG に存在しない `/θ/` トークンを含む string
  上記 4 ケース全て: `fallback.generateFeedbackLayers(input)` と完全一致すること。
  検証通過時のみ `cache.store` が呼ばれることを assert すること（失敗時は呼ばれないこと）。
  `pnpm test --run` 緑。

- **M-LLM-10** →
  `ls applications/frontend/src/usecase/port/llm-narrative-cache.ts`
  でファイルが存在すること。
  `grep -n "findBySignature\|store" applications/frontend/src/usecase/port/llm-narrative-cache.ts`
  で両メソッドの型定義が確認できること。
  `pnpm typecheck` 緑。

- **M-LLM-11** →
  unit test: 同一 input で 2 回 `generateFeedbackLayersAsync` を呼んだとき、
  1 回目は `invoker` が呼ばれ `cache.store` が実行されること。
  2 回目は `invoker` が呼ばれず `cache.findBySignature` の hit で即返ることを assert すること。
  `promptVersion` / `providerModel` / `detectedTopCandidate` を変えると別署名になることを assert すること。
  `pnpm test --run` 緑。

- **M-LLM-12** →
  `grep -n "llm_narrative_cache" applications/frontend/src/infrastructure/drizzle/schema.ts`
  でテーブル定義が確認できること。
  `ls applications/frontend/drizzle/` で `000N_*llm*` または `000N_*.sql`（タイムスタンプ最新）に
  `llm_narrative_cache` を含む migration ファイルが存在すること。
  `cat <migration-file> | grep "llm_narrative_cache"` で DDL が確認できること。
  migration を適用した DB で `SELECT * FROM llm_narrative_cache LIMIT 0` が "no such table" を返さないこと
  （`pnpm db:migrate` または devserver 起動後に SQLite で確認）。

- **M-LLM-13** →
  `ls applications/frontend/src/infrastructure/drizzle/repositories/llm-narrative-cache-repository.ts`
  でファイルが存在すること。
  `grep -n "INSERT OR REPLACE\|findBySignature\|store" applications/frontend/src/infrastructure/drizzle/repositories/llm-narrative-cache-repository.ts`
  で両操作が確認できること。
  `pnpm typecheck` 緑。

- **M-LLM-14** →
  `ls applications/frontend/src/acl/improvement-message/llm/ollama-narrative-invoker.ts`
  でファイルが存在すること。
  unit test: `fetch` をテストダブルで差し替え（テストファイル限定）、
  - `POST /api/generate` / `stream: false` / `signal` が渡されることを assert すること
  - `fetch` が connection refused 相当で reject したとき invoker が reject することを assert すること
  `pnpm test --run` 緑。

- **M-LLM-15** →
  `grep -n "llmCoachingProvider\|ollamaEndpoint\|ollamaModel\|claudeCodeExecutablePath\|claudeCodeModel\|llmNarrativeTimeoutMilliseconds\|llmNarrativePromptVersion\|llmNarrativeMaxConcurrency" applications/frontend/src/infrastructure/config/index.ts`
  で 8 フィールドすべてが確認できること。
  `grep -n "LLM_COACHING_PROVIDER\|OLLAMA_ENDPOINT\|OLLAMA_MODEL\|CLAUDE_CODE_PATH\|CLAUDE_CODE_MODEL\|LLM_NARRATIVE_TIMEOUT_MS\|LLM_NARRATIVE_PROMPT_VERSION\|LLM_NARRATIVE_MAX_CONCURRENCY" applications/frontend/src/infrastructure/config/index.ts`
  で 8 env 変数マッピングが確認できること。
  `pnpm typecheck` 緑。

- **M-LLM-16** →
  `grep -n "llmCoachingProvider\|createLlmImprovementMessageGenerator\|createDrizzleLlmNarrativeCacheRepository" applications/frontend/src/registry.ts`
  で provider 分岐・LLM factory 呼び出し・cache repo 構築が確認できること。
  `grep -n "createRunAssessmentJob" applications/frontend/src/registry.ts`
  の引数が変更されていないこと（`improvementMessageGenerator` の pass-through のみ）。
  `pnpm typecheck` 緑。

- **M-LLM-17** →
  `git diff HEAD -- applications/frontend/src/components/ applications/frontend/src/app/` の変更行が 0 件であること
  （UI コンポーネント / App Router ページに変更なし）。

- **M-LLM-18** →
  `ls .ast-grep/rules/` で llm-env 禁止ルールの YAML ファイルが存在すること。
  `ast-grep scan --rule .ast-grep/rules/<new-rule>.yml applications/frontend/src/acl/improvement-message/llm/`
  が 0 violations であること（実装が `process.env` を直参照しないこと）。
  `pnpm fitness` 緑。

- **M-LLM-19** →
  `grep -n "ADR-021\|un-defer\|active" adr/004-scoring-policy-in-haskell-worker-structured-diff.md`
  で Context L18 への追記と Changes/Related の ADR-021 参照が確認できること。
  `grep -n "messageJa = null\|worker must not embed" adr/004-scoring-policy-in-haskell-worker-structured-diff.md`
  で既存の worker 契約記述が維持されていること（削除・改変なし）。

### Compliance 項目（ADR Compliance 節 → 受入条件への翻訳）

- **spawn-arg assertion（ADR Compliance 4 行目）** → M-LLM-6 の unit test で yes/no 判定可能（上記）
- **fallback-equivalence test（ADR Compliance 5 行目）** → M-LLM-5 の unit test で yes/no 判定可能（上記）
- **grounding-validation reject test（ADR Compliance 3 行目）** → M-LLM-9 の unit test で yes/no 判定可能（上記）
- **cache determinism test（ADR Compliance 6 行目）** → M-LLM-11 の unit test で yes/no 判定可能（上記）
- **migration check（ADR Compliance 7 行目）** → M-LLM-12 の受入で yes/no 判定可能（上記）
- **LIVE runtime assertion（ADR Compliance 8 行目）** →
  ローカルで `LLM_COACHING_PROVIDER=claude-code` を設定し実 finding を含む録音を
  `pnpm dev` 環境で assess した結果:
  (a) `feedbackLayers.whatJa` が rule-based テンプレと文字列比較で異なること（`!== ruleBasedOutput.whatJa`）
  (b) `feedbackLayers.whatJa` が `detectedTopCandidate` 値（bare IPA）を含む文脈で語っていること
      （観測者が目視確認 → `.agent-evidence/llm-coaching-narrative/commands.txt` に実値を記録）
  (c) `feedbackLayers` のいずれのフィールドにも FINDING / CATALOG に出現しない `/.../ ` 記法 IPA が含まれないこと
  (d) `LLM_COACHING_PROVIDER` 未設定（rule-based 既定）または daemon down または Docker downgrade で
      従来 rule-based 文が出ること（snapshot と一致）
  `.agent-evidence/llm-coaching-narrative/commands.txt` に上記 (a)-(d) の実行コマンドと観測値を記録すること。

- **port 拡張 contract test（ADR Compliance 1 行目）** →
  unit test: `ImprovementMessageGeneratorInput` が `gop` / `detectedTopCandidate` / `nBest` / `functionalLoad` を
  任意で受け付けること（TypeScript 型コンパイル + 値渡しのテスト）。
  `run-assessment-job` が 2 つの generator 呼び出し input にこれらを `findingDraft` から渡していることを
  unit test の呼び出し引数 spy（テストファイル限定）または `pnpm typecheck` で確認すること。

- **rule-based 同期パス不変 test（ADR Compliance 2 行目）** →
  unit test: `provider = "rule-based"` のとき `improvementMessageGenerator.generateFeedbackLayersAsync`
  が `undefined` であることを assert すること。
  `run-assessment-job` に rule-based generator を渡したとき、pre-loop batch がスキップされ
  同期ループが実行されることを（`Map.get` が呼ばれないことで）assert すること。
  `pnpm test --run` 緑。

## Non-goals (今回やらない)

- **metered Anthropic API（ANTHROPIC_API_KEY）経由の Claude 呼び出し**: 確定 4（課金される）が明示禁止。
  env に `ANTHROPIC_API_KEY` を渡すと subscription ではなく metered 経路に切り替わる（`--bare` と同様）ため不採用。
- **worker（Haskell）または python-analyzer での LLM 呼び出し**: ADR-004 が worker は LLM client を embed しないと確定。narrative は frontend ACL の責務。
- **Haskell / python-analyzer / wire contract（AnalysisResponse / AssessmentFinding / EngineFindingDto）の schema 変更**: LLM narrative は既存 feedbackLayers 経路に閉じる（Contract changes 最終 bullet）。
- **ADR-010 が禁じる derivation への LLM 適用**: Training コンテキストの diagnostic→weakness→focus derivation に LLM を使わない（ADR-010 L51/L107-108）。本 ADR は PPC narrative 層のみ。
- **ACOUSTIC grounding フィールドの実装**: formant 偏差方向 / 調音方向アドバイスは未起草の
  acoustic-phonetic 計測 ADR が供給する予定。本 ADR は ACOUSTIC キーを供給されないとき省略するだけで動く。
  ACOUSTIC フィールドの取得・計算ロジックは本 ADR では実装しない。
- **deferred-async second write path（Option D）**: job 成功後に別経路で narrative 生成し次回 read で差し替える二重 write path は採用しない（Alternatives 参照）。
- **provider バッジ / 出所表示の UI 追加**: first slice では narrative の出所を学習者に見せない（D8）。
- **既存 rule-based generator の挙動変更**: `createRuleBasedImprovementMessageGenerator` の `generate` / `generateFeedbackLayers` は本 ADR では変更しない。

## Risk

- level: **high-risk**
- escalate_to_opus: **true**
- 理由（触れる境界領域）:
  - **subprocess spawn（background job の critical path 上）**: `child_process.spawn` で外部 CLI を起動する。
    Node.js サーバプロセスの keychain 継承に依存しており、keychain 不在（Docker）/ PATH 不在 / SIGTERM 失敗で
    `runAssessmentJob` が blocking または silent fail するリスク。M-LLM-7 の downgrade ロジックが正しく動かないと
    narrative が空になる。blast radius = 全 finding の feedbackLayers が空文字列になり UI で空欄が出る。
  - **network egress（Ollama）**: `AbortSignal.timeout` の外で fetch が hang した場合、job runner tick が詰まる。
    connection refused は reject に正しく落ちないと同様に hang する。
  - **新 DB テーブル（assessment critical path）**: `llm_narrative_cache` が migration なしで live DB に
    到達すると "no such table" で `runAssessmentJob` 全体が失敗する（memory: drizzle-migration-regenerate-after-schema）。
    schema.ts 変更後の `pnpm db:generate` 忘れが最大リスク。
  - **LLM 出力の user-facing 露出**: grounding 検証（M-LLM-9）を通過した文のみが学習者に届くが、
    小モデル（Ollama 7B）は hallucinate しうる。IPA 検証を通過した hallucination が混入した場合、
    学習者に誤った発音指導を与える。
  - **registry rewiring（DI / public export）**: registry.ts の `improvementMessageGenerator` 構築点を
    分岐に置換する。`createRunAssessmentJob` の deps bundle を変更しないことの確認が必須。
    hot-reload 環境では `globalThis` container singleton が stale になる
    （memory: nextjs-registry-edit-needs-dev-restart）。

## Open questions

- （なし）ADR-021 は D1–D9 / Compliance / Alternatives / Notes で全判断を確定している。ACOUSTIC grounding の
  実装は本 ADR のスコープ外（Non-goals に明記）。第 2 write path（Option D）は Alternatives で明示棄却済み。
  promptVersion 運用は Should に記載した（ADR Notes の運用リスクは仕様変更を要しない）。
  genuinely unresolved な実装選択点はない。
