# Spec: diagnostic-screen

<!-- spec-curator が承認済み ADR + 要件 + 詳細設計から正規化。人間との認識合わせ (grill-me 相当) は ADR-007/008/010 の Accepted で完了済み。
     設計の正: docs/01-requirements/pronunciation-feedback-requirements.md (REQ-121/112/113),
       adr/007-training-context-bounded-context.md, adr/008-training-progress-timeseries-data-model.md,
       adr/010-diagnostic-weakness-profile-focus-derivation.md,
       docs/03-detailed-design/domain.md §14 (DD-200 DiagnosticSession / DD-201 WeaknessProfile / FocusSound / DD-260..263),
       docs/05-database-design/database-design.md §5b (DB-010 diagnostic_sessions / DB-011 weakness_profiles).
     デザインの正: applications/frontend/design-reference/screens/diagnostic.html, design-system-v2.html §02/§08/§09。
     再利用契約: ADR-004 の worker GOP/phenomenon/structured-diff、既存 analyzer POST :8788/v1/analyze、worker POST :8787/v1/pronunciation-assessments、frontend の録音→解析パス。
     スコープ: NativeTrace v2.0 Phase3「初回診断 (diagnostic) 画面」スライス。HVPT/ドリル/シャドーイング/スケジューラ/progress は別スライス。 -->

## Goal

- 2〜5 分の読み上げ診断で `WeaknessProfile` を初期化する Training Context の最小実スライスを通す。診断課題の提示 → 既存解析契約での採点 → 誤りカタログ射影 → focus sound 優先度算出 → 永続化 → 診断結果画面 (Stage 判定 / CEFR 初期値 / focus タイル / 推奨訓練) までを、real public entrypoint (診断 API + App Router 画面) から到達可能にする。
- focus sounds は実解析から導出する (seed 直焼きでない)。採点は ADR-004 の worker/analyzer 契約を再利用し、Training Context に第 2 の隠れ採点経路を作らない (ADR-007/010 制約)。
- 対象 REQ: 121 (診断→弱点プロファイル), 112 (focus sound = FL ランク×頻度×習熟度の三項), 113 (習熟度適応; この式で表現)。

## Must (満たさなければ done でない)

- [ ] **M-DG-1 (Training Context domain + DB が real entrypoint から到達)**: `DiagnosticSession` (DD-200) と `WeaknessProfile` (DD-201) のドメイン型・Smart Constructor・ドメインサービス (DD-260 `completeDiagnosticSession` / DD-261 `initializeWeaknessProfile` / DD-262 `recomputeFocusPriority` / DD-263 `updateWeaknessProfile`) が実装され、`diagnostic_sessions` (DB-010) と `weakness_profiles` (DB-011) が Drizzle schema (`applications/frontend/src/infrastructure/drizzle/schema.ts`) に追加され、対応 migration (`applications/frontend/drizzle/*.sql`) が同一 PR に存在する。Training Context は PPC を `AssessmentResult` / `Section` 識別子のみで参照し、PPC 集約の内部型を import しない (ADR-007 依存方向検査が緑)。
- [ ] **M-DG-2 (診断課題提示 → 録音 → 既存解析契約で採点)**: 診断用読み上げ課題セット (`DiagnosticPromptSet`; カタログの高 FL 対立・母音挿入・韻律を網羅) を画面に提示し、各読み上げ録音が PPC の録音→解析パスを通って `AssessmentResult` を生成する。採点は既存 analyzer (`POST :8788/v1/analyze` の GOP/NBest/phenomenon) と worker (`POST :8787/v1/pronunciation-assessments` の structured diff / severity / scoreImpact) を再利用する。診断専用の新採点エンドポイントを worker / analyzer に追加しない。
- [ ] **M-DG-3 (解析結果をカタログ射影し WeaknessProfile を初期生成・永続化)**: 診断 findings を `japanese-l1-catalog.json` の `confusionSet` に射影し (検出 substitution を各項目の confusion set と突合)、項目の `functionalLoad` / `intelligibilityImpact` / `recommendedTraining` を担いだ `WeaknessProfile` を Training Context の UseCase 層で初期生成して `weakness_profiles` に永続化する。`focusSounds` は NonEmptyList (DD-201 不変条件 1; 空は `DomainError`)。射影・優先度合成・EWMA は UseCase 層で実行し、worker は focus sounds を合成しない (ADR-010 §5)。
- [ ] **M-DG-4 (focus sound 優先度を三項式で算出)**: 各 focus sound の `priority` を `w1·normalizedFunctionalLoadRank + w2·occurrenceFrequency + w3·(1 − mastery)` で動的算出する (固定リストにしない; DD-262 / DD-291)。`α` / `w1` / `w2` / `w3` は config 由来でドメインロジックに数値リテラルを埋め込まない (DD-293 / ADR-010 制約)。低 FL 対立 (`/θ/`-`/s/`) は `normalizedFunctionalLoadRank` が低いため「検出するが優先度ラベル低」として残る (REQ-112 / E-9)。三項式と EWMA 更新式は詳細設計 (`docs/03-detailed-design/domain.md` §14.8.2) に明文化済 (REQ-113 受入)。
- [ ] **M-DG-5 (診断結果画面が diagnostic.html / design-system-v2 に合致)**: 診断中画面 (本文 passage + phenomenon チップ + 録音ボタン + カバレッジ rail の進捗 `dg-prog` / `cov-row`) と診断結果画面 (Stage 判定トラック `stage-track`、CEFR 3 下位尺度初期値 `subscale`、生成 focus タイル `focus-tile` (`prio--now`/`prio`/`prio--low` + FL ランク `fl[data-rank]`)、推奨訓練) が design-system-v2 の `§02 phenomenon` / `§08 axis2・subscale` / `§09 focus` セクションの部品クラスで実装され、`diagnostic.html` にレイアウト合致する。表示値は M-DG-3/4 で永続化された実プロファイルから描画する (静的 HTML の固定値でない)。
- [ ] **M-DG-6 (agent-policy 厳守 = 本番モックなし・実 endpoint 実行 assert)**: 本番コードに mock/stub/fake/dummy/spy・test-bypass・placeholder stub を入れない (`scripts/verify-*.sh` 緑)。Training Context scoring / focus-derivation 経路に LLM 呼び出しが無い (ADR-010 Compliance)。観測可能挙動 (診断 API を叩くと非空 `WeaknessProfile` が永続し、再取得で focus sounds が返る) を real endpoint で実行 assert できる。`.agent-evidence/` の commands.txt / wiring-map.json / completion-report.md を提出する。

## Should (望ましいが必須でない)

- **S-DG-1 (EWMA 漸進更新の配線点)**: DD-263 `updateWeaknessProfile` (EWMA: `profile_new = α·observation + (1 − α)·profile_old`) の UseCase Port が用意され、PPC のセクション練習解析結果が `WeaknessProfile` を更新できる接続点が存在する。初回生成を主とし、日常解析からの実駆動更新ループ本体は別スライスでよい (Non-goal 参照)。
- **S-DG-2 (Stage 自動判定)**: 診断結果から Stage I (明瞭性) / Stage II (ネイティブ性) の現在段階を二段階ゴールモデル (要件 §2) に基づき自動判定し、結果画面の優先構成 (初中級向け = 韻律 + 母音挿入 + 高 FL 分節) に反映する。
- **S-DG-3 (診断履歴の参照)**: `idx_diagnostic_sessions_learner_created` を介した学習者別診断履歴の取得 API。MVP では最新 1 件解決で足りる。

## 受入条件 (acceptance — Must の確認方法)

- **M-DG-1** → (a) `pnpm typecheck` 緑。(b) `applications/frontend/drizzle/` に新 migration SQL が存在し、`pnpm db:generate` 後 `diagnostic_sessions` / `weakness_profiles` がDBに作られる (新規DBで `sqlite` に両テーブルが `SELECT name FROM sqlite_master` で出る; 「no such table」が出ない)。(c) ESLint `architecture-import/no-restricted-paths` + ast-grep が緑で、Training Context が PPC 内部型を import せず PPC が Training Context を import しない (依存方向検査でgrep上 PPC 内部型の import が 0)。
- **M-DG-2** → `docker compose up` 後、診断開始 endpoint を叩き診断課題セットが返ること、診断録音を投げると `analyzer :8788/v1/analyze` と `worker :8787/v1/pronunciation-assessments` が実際に呼ばれ `AssessmentResult` が生成されることを assert (worker/analyzer に診断専用の新 path が `grep` で増えていない = 既存契約再利用)。
- **M-DG-3** → 診断完了 endpoint を叩いた後に `weakness_profiles` を再取得 (`GET` API もしくは repository) すると、(a) 当該 learner の行が 1 件存在し `focus_sounds_json` が非空配列、(b) 各 focus sound の `catalogId` が `japanese-l1-catalog.json` の `id` に一致、(c) `diagnostic_sessions.weakness_profile` が生成プロファイルを参照 (`status='completed'` 行で `weakness_profile IS NOT NULL`)。プロファイルが固定 seed でないことを、入力録音 (fixture) を変えると focus sounds の構成/優先順が変わる contract test で示す。
- **M-DG-4** → 単体 test: 同一 focus sound 候補に対し `mastery` を上げると `priority` が下がる (三項式が動的); `functionalLoad='low'` 項目が高 FL 項目より低い `priority` を持つ; `w1`/`w2`/`w3`/`α` を config から差し替えると算出 priority が変わる (ドメインに数値リテラル埋め込み無し → grep で domain 層に重み literal が無い)。
- **M-DG-5** → Playwright: 診断中画面に `.dg-prog` の進捗 (N / 12) と `.cov-row` のカバレッジ行、`.phen` チップ、`.rec-btn` が描画される。診断結果画面に `.stage-track`、`.subscale` 3 行 (全体/分節/韻律)、`.focus-tile` が「永続化された focus sounds の件数ぶん」描画され、各タイルの `.focus-pair` / `.fl[data-rank]` / `.prio` が API レスポンス値と一致する (固定 4 タイルの静的描画でないことを、プロファイルを変えるとタイル内容が変わることで assert)。
- **M-DG-6** → `scripts/verify-no-prod-doubles.sh` / `verify-test-bypass.sh` / `verify-no-stub-placeholder.sh` / `verify-wiring.sh` / `verify-allowlist-expiry.sh` が対象差分で緑。Training Context の UseCase / domain ディレクトリに OpenAI SDK / LLM クライアント import が `grep` で 0 件 (ADR-010)。`.agent-evidence/` に commands.txt (実行コマンド)・wiring-map.json (entrypoint→usecase→repository→table の経路)・completion-report.md がある。

## Non-goals (今回やらない)

- HVPT 知覚訓練 (REQ-122)、ミニマルペア産出ドリル (REQ-123)、シャドーイング (REQ-125)、分散学習スケジューラ (REQ-127)、progress 画面 / 進捗可視化 (REQ-129)。`training_sessions` / `hvpt_trials` / `spacing_schedules` / `progress_snapshots` (DB-012..015) のテーブル・集約は本スライスで作らない。
- golden speaker / 自分の声の VC (REQ-128)。
- 診断文セットの大規模拡充。カタログの高 FL 対立・母音挿入・韻律を網羅する**最小セット**で可 (DD-290 を満たせばよい)。
- EWMA 漸進更新ループの長期運用。初期生成を主とし、DD-263 の更新 Port (配線点) は用意するが日常解析からの実駆動更新ループ本体・再診断なし運用の検証は別スライス (S-DG-1 で接続点のみ)。
- 採点閾値の本格キャリブレーション (自己録音グラウンドトゥルース蓄積)。ADR-001 の保守的デフォルト + confusion set ルール補完で進める。
- お手本 TTS / 信頼度ヘッジ / 却下 (pronunciation-feedback-v2 スライス側で実装済/実装中)。

## Risk

- level: **high-risk**
- escalate_to_opus: **true**
- 理由 (触れる境界領域):
  - **新 BC (bounded context)**: Training Context (ADR-007) の新規導入。新ディレクトリと対応 fitness function (ESLint no-restricted-paths / ast-grep layer-closure) を同一 PR で追加する必要 (ADR-005 same-PR rule)。PPC との識別子のみ結合を機械検査で守る。
  - **新 DB / schema / migration**: `diagnostic_sessions` / `weakness_profiles` 2 テーブル新設 (DB-010/011)。schema.ts 変更には `pnpm db:generate` の migration 同梱が必須 (`frontend-schema-needs-migration` 検査; 怠ると実機 no such table)。`assessment_result_json` の配列参照 FK は mapper で整合検証。
  - **full-stack 配線 / routing**: 診断 API の App Router 配置 (診断開始 / 録音取り込み / 完了 → プロファイル生成 / 結果取得)、registry の新 usecase + repository port 配線、worker/analyzer 既存契約への配線 (新採点経路を作らない制約)。診断画面の App Router ページ追加 (`/diagnostic` 系)。
  - **public export**: Training Context の DTO 型 (`WeaknessProfileDto` / `DiagnosticSessionDto` / focus sound API 形状) の新規公開シグネチャ。既存 `FocusSoundDto` (`api-types.ts`) との整合。
  - **データ依存 / 導出正当性**: focus sounds がカタログ射影 + 三項式の実導出であること (seed 直焼き禁止)。confusion set の網羅性・重み調整が誤ると focus ランクが歪む (config 隔離で緩和)。

## Open questions

### 人間確認が要る (ブロッキング) — 解決済み

- **OQ-1 (学習者識別)** — **解決 (2026-06-13, lihs)**: **固定シングルトン `LearnerIdentifier` を採用する。** 世界共通の sentinel ULID 定数を 1 つ用意し、Training Context の全テーブルの `learner` 列はこの単一値を常に取る。schema は将来の多ユーザー拡張余地のため `learner` 列と `uq_weakness_profiles_learner` を保持するが、MVP では `Learner` 集約・ユーザー管理を作らない。sentinel 値はドメインに literal 埋め込みせず config/定数モジュール (`infrastructure/config` 等) に隔離し DD-293 と整合させる。

### 実装判断で非ブロッキング (topology-mapper / implementer が決める)

- **OQ-2 (診断文セットの保持先)**: `DiagnosticPromptSet` を既存 PPC の `Material` / `Section` から流用するか、診断専用 fixture (カタログ網羅を満たす固定文セット) を Training Context に持つか。ADR-007 の識別子のみ参照制約上、PPC 流用時は `Section` 識別子参照になる。MVP は診断専用 fixture が単純で、DD-290 (高 FL 対立・母音挿入・韻律網羅) を満たせばよい。
- **OQ-3 (診断 API の path / メソッド)**: 診断開始・録音取り込み・完了・結果取得の具体 App Router path とメソッド分割。既存 `dismissal/route.ts` の usecase 注入パターン (registry `getContainer().usecases.*`) を踏襲する。
- **OQ-4 (config 値の置き場)**: `α` / `w1` / `w2` / `w3` の具体値と config 配置 (`applications/frontend/src/infrastructure/config/` 等)。値は calibration 可能に隔離する (ADR-010 制約) が、初期値は実装スペックで仮置きしてよい。
- **OQ-5 (occurrenceFrequency / mastery の初期化)**: 初回診断 (1 回の観測) では EWMA の履歴がないため、初期 `occurrenceFrequency` (診断内観測率) と初期 `mastery` (診断スコアからの推定) の初期化規則。三項式が機能する初期値を実装スペックで定義する。
