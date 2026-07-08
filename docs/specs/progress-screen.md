# Spec: progress-screen

<!-- spec-curator が承認済み ADR + 要件 + 詳細設計から正規化。人間との認識合わせ (grill-me 相当) は ADR-007/008 の Accepted で完了済み。
     設計の正: docs/01-requirements/pronunciation-feedback-requirements.md (REQ-129 進捗可視化と学習継続設計 / REQ-126 ピッチ韻律可視化 参考 / REQ-018 比較再生拡張 / 研究 E-2 統制課題限定),
       adr/007-training-context-bounded-context.md (Training Context BC / 識別子のみ結合),
       adr/008-training-progress-timeseries-data-model.md (progress_snapshots 専用テーブル / controlled-task 限定),
       docs/03-detailed-design/domain.md §14.8.6 (DD-205 ProgressSnapshot / DD-215 / DD-249..253 / DD-268 captureProgressSnapshot / DD-289 / DD-299 / DD-300),
       docs/05-database-design/database-design.md §5b (DB-015 progress_snapshots / idx_progress_snapshots_learner_captured / idx_progress_snapshots_section_captured)。
     デザインの正: applications/frontend/design-reference/screens/progress.html, design-system-v2.html §13 progress / §08 stage。
     再利用契約: diagnostic スライス (DiagnosticSession / WeaknessProfile / weakness_profiles / diagnostic_sessions) 実装済。
       CEFR 3 下位尺度導出 (view-diagnostic-result の deriveCefrSubscalesFromScores) と Stage 判定 (deriveStage) と focus-tile 描画は実装済で再利用する。
       AssessmentResult が録音ごとに CEFR (cefrOverall/cefrSegmental/cefrProsodic) と scores を保持。固定 sentinel LearnerIdentifier (infrastructure/config の diagnosticSentinelLearnerIdentifier) を流用。
     スコープ: NativeTrace v2.0 Phase3「進捗 (progress) 画面」スライス。
       時系列データは現状 diagnostic baseline のみ (training スライス未実装 = training_sessions / hvpt_trials は空)。
       本スライスは ProgressSnapshot 集約 + progress_snapshots テーブル + progress 画面を追加し、
       baseline スナップショットを実データから永続化し、未実装データ領域は fake 値でなく honest empty で出すことを done とする。 -->

## Goal

- 統制課題 (読み上げ再録音 / ドリル) の結果から `ProgressSnapshot` (DD-205) を生成・永続化し、進捗 (progress) 画面で **実スナップショット駆動**で可視化する Training Context の最小実スライスを通す。CEFR 3 下位尺度の推移/レーダー (now/prev)、focus sounds のスコア推移 sparkline、訓練統計 (累計訓練時間/実施間隔)、同一 Section 過去録音との比較再生までを、real public entrypoint (進捗 API + App Router 画面) から到達可能にする。
- 効果測定は統制課題に限定し (研究 E-2: 自発発話への転移を過大評価しない)、scope-note「読み上げ課題での改善 — 自発発話への転移は別計測」を画面に必ず正直表示する。
- 時系列データは現状 diagnostic baseline のみ (training スライス未実装) であることを設計事実として受け入れる。データが存在しないセクション (前回比 / 訓練統計 / 比較再生) は **fake placeholder を入れず honest empty** を描画する。
- 対象 REQ: 129 (進捗可視化と学習継続設計; Must)。参考 REQ: 126 (韻律可視化), REQ-018 拡張 (比較再生)。

## Must (満たさなければ done でない)

- [ ] **M-PG-1 (ProgressSnapshot domain + DB が real entrypoint から到達)**: `ProgressSnapshot` 集約 (DD-205; `identifier` / `learner` / `section` / `sourceAssessment` / `taskKind` / `cefrScores` / `focusScores` / `cumulativeTrainingMinutes` / `capturedAt`) と値オブジェクト (DD-249 `ProgressSnapshotIdentifier` / DD-250 `ControlledTaskKind` / DD-251 `CefrSubscaleScores` / DD-252 `FocusScore` / DD-253 `CumulativeTrainingMinutes`)、ドメインサービス DD-268 `captureProgressSnapshot` (作成後不変) が `applications/frontend/src/domain/training/` に実装され、`progress_snapshots` (DB-015) が Drizzle schema (`applications/frontend/src/infrastructure/drizzle/schema.ts`) に追加され、対応 migration (`applications/frontend/drizzle/*.sql`) が同一 PR に存在する。Training Context は PPC を `Section` / `AssessmentResult` 識別子のみで参照し、PPC 集約の内部型を import しない (ADR-007 依存方向検査が緑)。
- [ ] **M-PG-2 (diagnostic 完了時に baseline ProgressSnapshot を実データから生成・永続化)**: diagnostic セッション完了 (既存 `completeDiagnosticSession` 経路 / `complete-diagnostic-session`) 時に、その診断の `AssessmentResult` の CEFR 3 下位尺度・focus 別スコア・累計訓練時間から baseline `ProgressSnapshot` (`taskKind='rereading'`) を `captureProgressSnapshot` 経由で生成し `progress_snapshots` に永続化する。CEFR 値は AssessmentResult の `cefrOverall`/`cefrSegmental`/`cefrProsodic` から導出 (既存 `deriveCefrSubscalesFromScores` 相当のロジックを再利用)、focus スコアは生成済 `WeaknessProfile.focusSounds` から実データで構成する。`cefrScores` は overall/segmental/prosodic 3 尺度をすべて持つ (DD-205 不変条件 2; 欠けたら `IncompleteCefrSubscales`)、`focusScores` は NonEmptyList (不変条件 3; 空は `EmptyFocusScores`)。`task_kind` は `rereading` / `drill` のみ (DB-015 CHECK / DD-299; 自発タスクからスナップショットを作らない)。
- [ ] **M-PG-3 (進捗取得 API が実スナップショット時系列を返す)**: 進捗取得 entrypoint (App Router の進捗 API; 例 `GET /api/v1/progress`) が、固定 sentinel `LearnerIdentifier` の `progress_snapshots` を `idx_progress_snapshots_learner_captured` で時刻順に取得し、(a) CEFR 3 下位尺度の now (最新スナップショット) と prev (1 個前。無ければ null = honest empty)、(b) focus sound 別スコア推移 (時刻順の点列。1 点なら単点)、(c) 訓練統計 (累計訓練時間 = `cumulative_training_minutes` の最新値 / 実施間隔 = スナップショット間隔。training 未実装なら 0)、(d) 同一 Section 過去録音群 (`idx_progress_snapshots_section_captured` 由来。複数なければ honest empty) を実データで返す。返却 DTO は fake 値・固定 placeholder を含まない。training スライス未実装でも 500 やクラッシュにならず、空集合を honest empty として返す。
- [ ] **M-PG-4 (progress 画面が progress.html / design-system-v2 に合致し実スナップショット駆動)**: 進捗画面が `progress.html` のレイアウトに合致し、design-system-v2 の `§13 progress` (`.pg` / `.pg-grid` / `.fs-trend`>`.spark`/`.delta-up`/`.delta-dn` / `.radar-poly--ref`/`--now`/`--prev` / `.stats-row`>`.stat` / `.cum-bar` / `.ab-srcs`+`.player`) と `§08 stage` (`.stage-track`+`.axis-expl`) の部品クラスで実装される。**表示値はすべて M-PG-3 の API が返した実スナップショットから描画する** (静的 HTML の固定数値 86%/71%/64/58/46/184min 等を焼かない)。Stage 二段階トラック・CEFR レーダー・focus 推移・訓練統計・比較再生の各セクションが、データありなら実値、データなしなら honest empty を出す。
- [ ] **M-PG-5 (honest empty が各セクションで正しく出る)**: 以下の「データ無し」状態を fake で埋めず、空であることを明示する UI で描画する: (a) CEFR レーダーの **prev** = スナップショット 1 件のみなら `.radar-poly--prev` を描かず「前回比なし」を示す。(b) focus 推移 sparkline = データ点 1 つなら単点表示 (偽の折れ線を引かない)、0 件ならその focus 行を出さない。(c) 訓練統計 (累計訓練時間/試行数/実施間隔) = training 未実装なら 0 / 「訓練データなし」を示し、`184 min`・`26 h`・`12 日` 等の架空値を出さない。(d) 比較再生 = 同一 Section の過去録音が複数あれば実 `.ab-srcs` + `.player`、無ければ「比較対象なし」を示す。複数スナップショットが蓄積されたら prev/now 比較・推移折れ線が自然に出ること。
- [ ] **M-PG-6 (scope-note 正直表示)**: `.app-top` の `.scope-note`「読み上げ課題での改善 — 自発発話への転移は別計測」(または同義の統制課題限定表現) を進捗画面に必ず表示する (研究 E-2 / RISK-103 対応: 効果は統制課題に集中し自発発話転移を過大評価しない正直表示)。この表示は条件分岐で消えない (データの有無に関わらず常時表示)。
- [ ] **M-PG-7 (agent-policy 厳守 = 本番モックなし・実 endpoint 実行 assert)**: 本番コードに mock/stub/fake/dummy/spy・test-bypass・placeholder stub を入れない (`scripts/verify-*.sh` 緑)。Training Context scoring / 進捗導出経路に LLM 呼び出しが無い (ADR-007/010 制約)。観測可能挙動 (diagnostic 完了 → 進捗 API を叩くと非空 baseline スナップショットが返り、画面に実 CEFR/focus が出る; training 未実装領域は honest empty) を real endpoint で実行 assert できる。`.agent-evidence/` の commands.txt / wiring-map.json / completion-report.md を提出する。

## Should (望ましいが必須でない)

- **S-PG-1 (ProgressSnapshot 生成 Port の training 配線点)**: DD-268 `captureProgressSnapshot` の UseCase Port を、将来の training セッション完了 (REQ-122/123 別スライス) からも呼べる形 (統制課題 = drill 結果からのスナップショット生成) に用意する。本スライスでは diagnostic 完了からの baseline 生成を主とし、training からの実駆動生成は別スライスでよい (Non-goal 参照)。
- **S-PG-2 (CEFR バンド表記の推移)**: レーダー/推移にスコア値だけでなく CEFR バンド (B1/B1+/B2 等; 既存 `scoreToCefrBand` 再利用) を併記する。
- **S-PG-3 (実施間隔の可視化)**: スナップショット間 (将来は training セッション間) の平均間隔を `.stat` に出す。training 未実装の現状はスナップショット 1 件で honest empty。

## 受入条件 (acceptance — Must の確認方法)

- **M-PG-1** → (a) `pnpm typecheck` 緑。(b) `applications/frontend/drizzle/` に新 migration SQL が存在し、`pnpm db:generate` 後 新規 DB に `progress_snapshots` が作られる (`SELECT name FROM sqlite_master` に出る; 「no such table」が出ない)。`task_kind IN ('rereading','drill')` / `cefr_*_score BETWEEN 0 AND 100` / `cumulative_training_minutes >= 0` の CHECK が migration に含まれる。(c) ESLint `architecture-import/no-restricted-paths` + ast-grep 緑で、Training Context が PPC 内部型を import せず PPC が Training Context を import しない (grep 上 PPC 内部型の import が 0)。
- **M-PG-2** → `docker compose up` 後、diagnostic を 1 件完了させた直後に `progress_snapshots` を再取得すると、(a) 当該 sentinel learner の baseline 行が 1 件存在し `task_kind='rereading'`、(b) `cefr_overall_score`/`cefr_segmental_score`/`cefr_prosodic_score` が当該 `AssessmentResult` の CEFR から導出された 0–100 整数、(c) `focus_scores_json` が非空配列で各要素の `contrast` が生成 `WeaknessProfile.focusSounds` の対立に一致、(d) `source_assessment` が当該 `AssessmentResult` を、`section` が当該 `Section` を参照。スナップショットが固定 seed でないことを、入力録音 (fixture) を変えると CEFR/focus スコアが変わる contract test で示す。自発タスク (`task_kind` が rereading/drill 以外) を渡すと `NonControlledTaskNotEligible` で拒否される単体 test。
- **M-PG-3** → 進捗取得 API を叩くと、スナップショット 1 件 (baseline のみ) の状態で: now CEFR 3 尺度が実値、prev が `null`、focus 推移が各 1 点、累計訓練時間が `0`、比較再生候補が空配列で返る (200; 500 でない)。スナップショットを fixture で 2 件以上に増やすと prev が非 null になり focus 推移が 2 点以上になる contract test。返却 JSON を grep して固定 placeholder 数値 (184/26/12/86/71 等) が API 由来でなく client 由来でもないこと (= 実データのみ) を確認する。
- **M-PG-4** → Playwright: 進捗画面に `.stage-track` (2 セグメント) / `.pg-grid` 内の `.fs-trend`>`.spark` / `.radar-poly--now` / `.stats-row` (`.stat`×4) / `.cum-bar` / `.ab-srcs`+`.player` が描画される。各値が API レスポンス値と一致する (静的 HTML の固定 86%/71%/64/58/46 でないことを、スナップショット fixture を変えると画面表示値が変わることで assert)。
- **M-PG-5** → Playwright (baseline 1 件状態): (a) `.radar-poly--prev` が DOM に存在しないか「前回比なし」相当の表示が出る。(b) focus 推移行が単点 (`.sdot` のみ / 偽 `.sline` を引かない) で出る。(c) 訓練統計が `0` または「訓練データなし」を示し `184 min`/`26 h`/`12 日` が出ない。(d) 比較再生が「比較対象なし」を示す。別 fixture (スナップショット 2 件 + 同一 Section 複数録音) では prev レーダー・2 点以上の推移・複数 `.ab-src` が出る。
- **M-PG-6** → Playwright: `.scope-note` (または統制課題限定の正直表現) が、スナップショット 0 件/1 件/複数のどの状態でも常に表示される (条件分岐で消えない)。
- **M-PG-7** → `scripts/verify-no-prod-doubles.sh` / `verify-test-bypass.sh` / `verify-no-stub-placeholder.sh` / `verify-wiring.sh` / `verify-allowlist-expiry.sh` が対象差分で緑。Training Context の UseCase / domain ディレクトリに OpenAI SDK / LLM クライアント import が `grep` で 0 件。`.agent-evidence/` に commands.txt (実行コマンド)・wiring-map.json (entrypoint→usecase→repository→table の経路: 進捗 API→view-progress usecase→progress-snapshot-repository→progress_snapshots / diagnostic 完了→capture-progress-snapshot)・completion-report.md がある。

## Non-goals (今回やらない)

- **training 画面本体 (別スライス)**: HVPT 知覚訓練 (REQ-122), ミニマルペア産出ドリル (REQ-123), シャドーイング (REQ-125), 分散学習スケジューラ (REQ-127)。`training_sessions` / `hvpt_trials` / `spacing_schedules` (DB-012..014) の集約・テーブル本体・実駆動。本スライスは `cumulative_training_minutes` を写すフィールドは持つが、その値を生む training セッション実装はやらない (現状は 0 / honest empty)。
- **progress の長期時系列が training データで埋まること**: training 実装後に diagnostic 以外のスナップショットが蓄積されて推移が埋まるのは将来。今回は baseline + honest empty で done とする。複数スナップショット時に prev/now 比較・推移折れ線が出ることは contract/Playwright fixture で示せばよく、実 training 由来の蓄積は要求しない。
- golden speaker / 自分の声の VC (REQ-128)。
- 韻律 F0 輪郭の重ね描き (REQ-126) の本実装。progress 画面の CEFR 韻律スコアは出すが、ピッチ可視化グラフ自体は別スライス。
- 採点閾値の本格キャリブレーション。
- diagnostic スライスの再実装。DiagnosticSession / WeaknessProfile / weakness_profiles / diagnostic_sessions・CEFR 導出・Stage 判定・focus-tile は実装済の資産を再利用する (重複実装しない)。

## Risk

- level: **high-risk**
- escalate_to_opus: **true**
- 理由 (触れる境界領域) — 設問の high-risk 判定は妥当:
  - **新 DB / schema / migration**: `progress_snapshots` 1 テーブル新設 (DB-015)。`schema.ts` 変更には `pnpm db:generate` の migration 同梱が必須 (`frontend-schema-needs-migration` 検査; 怠ると実機 no such table)。`task_kind` / CEFR / 累計時間の CHECK 制約と 2 索引 (learner_captured / section_captured) を漏れなく migration に乗せる。`section` / `source_assessment` の FK は PPC テーブル参照で mapper 整合検証。
  - **Training Context (BC) 拡張**: 既存 Training Context (ADR-007) に `ProgressSnapshot` 集約を追加。PPC との識別子のみ結合 (`Section` / `AssessmentResult`) を機械検査 (ESLint no-restricted-paths / ast-grep layer-closure) で守る。新 repository / usecase に対応 fitness 配線を同一 PR で追加 (ADR-005 same-PR rule)。
  - **full-stack 配線 / routing**: 進捗取得 API の App Router 配置、registry の新 usecase (view-progress / capture-progress-snapshot) + progress-snapshot-repository port 配線、diagnostic 完了 usecase への capture 接続 (既存 `complete-diagnostic-session` への追加配線)、進捗画面の App Router ページ追加 (`/progress` 系)。
  - **public export**: 進捗 API の DTO 型 (`ProgressViewDto` / CEFR now/prev / focus 推移点列 / 訓練統計 / 比較再生候補の API 形状) の新規公開シグネチャ。既存 `FocusSoundDto` / diagnostic 結果 DTO との整合。
  - **event subscription / 配線点**: diagnostic 完了 (DD-281 `DiagnosticSessionCompleted`) を契機に baseline スナップショットを生成する配線。将来 training セッション完了 (DD-285) からも `captureProgressSnapshot` を呼ぶ Port を用意 (S-PG-1)。
  - **データ依存 / 導出正当性**: CEFR/focus が実 AssessmentResult / WeaknessProfile からの実導出であること (seed 直焼き禁止)。honest empty を fake で埋めない判断が UI 全体に分散するため、placeholder 混入の検出が要点。

## honest empty のスコープ (どう scope したか)

時系列データが現状 diagnostic baseline のみ (training スライス未実装) という設計事実を、各 UI セクションごとに「実データ or honest empty」で明示的に scope した:

| セクション | データ源 | 現状 (baseline 1 件) | honest empty の出し方 |
|---|---|---|---|
| Stage 二段階トラック | baseline スナップショットの CEFR/overall | 実値 (diagnostic から導出) | データありなので実値 |
| CEFR レーダー now | 最新スナップショット | 実値 | 実値 |
| CEFR レーダー prev | 1 個前のスナップショット | **無し** | `.radar-poly--prev` を描かず「前回比なし」(M-PG-5a) |
| focus 推移 sparkline | スナップショット時系列の focus スコア | **1 点** | 単点表示・偽の折れ線を引かない (M-PG-5b) |
| 訓練統計 (累計時間/試行/間隔) | training_sessions / hvpt_trials | **空 = 0** | `0` / 「訓練データなし」、架空値を出さない (M-PG-5c) |
| 比較再生 | 同一 Section 過去録音群 | **複数なければ無し** | 「比較対象なし」(M-PG-5d) |
| scope-note | 固定文言 | **常時表示** | 条件分岐で消さない (M-PG-6) |

複数スナップショット (将来の再診断 / training 実装) が蓄積されたら、prev レーダー・推移折れ線・訓練統計・比較再生が同じコードパスで自然に埋まる。本スライスは fake を入れずに「埋まる構造」を作り、現状を honest empty で正直に見せることを done とする。

## Open questions

### 人間確認が要る (ブロッキング) — 解決済み

- **OQ-1 (学習者識別)** — **解決 (diagnostic スライスと同一)**: 固定シングルトン `LearnerIdentifier` を流用する。`infrastructure/config` の `diagnosticSentinelLearnerIdentifier` (sentinel ULID) を `progress_snapshots.learner` 全行に用いる。`Learner` 集約・ユーザー管理は本スライスでも作らない。sentinel 値はドメインに literal 埋め込みせず config に隔離 (DD-293 整合)。

### 実装判断で非ブロッキング (topology-mapper / implementer が決める)

- **OQ-2 (baseline スナップショット生成の配線点)**: diagnostic 完了時の baseline `ProgressSnapshot` 生成を、(a) 既存 `complete-diagnostic-session` usecase 内に追記するか、(b) `DiagnosticSessionCompleted` イベントを購読する独立 usecase (`capture-progress-snapshot`) にするか。後者は将来 training セッション完了 (DD-285) からの再利用 (S-PG-1) と相性が良いが、本スライスは MVP として単純な配線でよい。いずれも diagnostic 完了の real entrypoint から到達すること。
- **OQ-3 (進捗 API の path / メソッド)**: 進捗取得の具体 App Router path とメソッド (例 `GET /api/v1/progress` 単一エンドポイントで now/prev/focus 推移/訓練統計/比較再生候補をまとめて返すか、用途別に分割するか)。既存 diagnostic API の usecase 注入パターン (`getContainer().usecases.*`) を踏襲する。
- **OQ-4 (CEFR 導出ロジックの再利用形)**: baseline スナップショットの CEFR は、view-diagnostic-result の `deriveCefrSubscalesFromScores` / `scoreToCefrBand` を共有モジュールに切り出して再利用するか、Training Context 内に再実装するか。重複実装は避け、共有が望ましいが、層境界 (ADR-007 識別子のみ結合) を破らない置き場にする。
- **OQ-5 (focus スコアの算出規則)**: `focusScores` (FocusScore: contrast + 0–100 スコア) を baseline で何から算出するか。生成済 `WeaknessProfile.focusSounds` の各 focus に対し、診断 AssessmentResult のどのスコア (GOP / phenomenon 別) を 0–100 に写すかの規則。診断 1 回の観測から決定論で導出し、固定値にしない。実装スペックで仮置きしてよい。
- **OQ-6 (prev スナップショットの選択)**: now に対する prev を、(a) 同一 learner の captured_at 直前 1 件、(b) 同一 Section の直前 1 件 (REQ-018 比較拡張寄り) のどちらにするか。MVP は learner 直前 1 件で足り、無ければ honest empty。`idx_progress_snapshots_learner_captured` で時刻順取得して 2 件目を prev とする規則を実装スペックで確定する。
