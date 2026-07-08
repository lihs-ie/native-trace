# Spec: training-screen

<!-- spec-curator が承認済み ADR + 要件 + 詳細設計から正規化。人間との認識合わせ (grill-me 相当) は ADR-007/008/009/011/012 の Accepted で完了済み。
     設計の正: docs/01-requirements/pronunciation-feedback-requirements.md (REQ-122 HVPT / REQ-123 産出ドリル / REQ-125 シャドーイング+ラグ / REQ-127 スケジューラ / REQ-128 golden=別概念),
       adr/007-training-context-bounded-context.md (Training Context BC / 識別子のみ結合 / 採点は worker 再利用),
       adr/008-training-progress-timeseries-data-model.md (training_sessions/hvpt_trials/spacing_schedules 専用テーブル),
       adr/009-hvpt-stimulus-hybrid-natural-tts.md (curated VCTK/LibriTTS subset + Kokoro 補完 / analyzer 内 carve-out / CC BY-NC 禁止),
       adr/011-spacing-scheduler-fixed-interval-mastery-gate.md (24h 等間隔 + 60% ゲート state machine / 決定論 / 永続),
       adr/012-golden-speaker-voice-conversion-rvc.md (RVC=別サービス / training 画面に現れない別概念),
       docs/03-detailed-design/domain.md §14.8.3-5 (DD-202 TrainingSession / DD-203 HvptTrial / DD-204 SpacingSchedule / DD-240..248 / DD-264..267 / DD-284..288),
       docs/05-database-design/database-design.md §5b (DB-012 training_sessions / DB-013 hvpt_trials / DB-014 spacing_schedules)。
     デザインの正: applications/frontend/design-reference/screens/training.html (操作可・JS 有), design-system-v2.html §11 hvpt / §12 sched。
     再利用契約 (diagnostic + progress スライスで実装済の資産を再利用; 重複実装しない):
       Training Context domain (applications/frontend/src/domain/training/index.ts) / WeaknessProfile / FocusSound (contrast 保持) / error-catalog (japanese-l1-catalog),
       固定 sentinel LearnerIdentifier (infrastructure/config), worker GOP/phenomenon/structured-diff (ADR-004; analyzer :8788/v1/analyze + worker :8787/v1/pronunciation-assessments) を産出ドリル評価に再利用,
       Kokoro TTS (analyzer :8788/v1/tts; お手本 / HVPT 補完刺激), capture-progress-snapshot usecase + progress_snapshots (訓練セッション完了 → progress 接続)。
     スコープ: NativeTrace v2.0 Phase3「訓練 (training) 画面」スライス (最重量)。サブスライスに分解して順送りに実装する (本スライスのサブスライス分解節を参照)。 -->

## Goal

- focus sounds の音素対立に対する訓練ループ (知覚 HVPT → 産出ドリル → シャドーイング) を、24h 等間隔 + 60% ゲートの分散スケジューラ (ADR-011) の上で回す Training Context の実スライスを通す。training.html (操作可) のレイアウトに合致する training 画面から、real public entrypoint (訓練 API + App Router 画面) で各機能が**実データ**動作 (偽刺激・偽採点なし) するまでを done とする。
- 採点は ADR-004 の worker/analyzer 契約を再利用し、Training Context に第 2 の採点ポリシーを作らない (ADR-007 制約)。スケジューラ・状態遷移は純ロジックで決定論かつ永続 (ADR-011)。HVPT 刺激は curated natural speech (VCTK/LibriTTS, CC BY 4.0) + Kokoro 補完を analyzer 内で調達する (ADR-009)。訓練セッション完了は既存 `capture-progress-snapshot` 経路で `progress_snapshots` に接続する (REQ-129 / progress スライスと結線)。
- 対象 REQ: 122 (HVPT 知覚訓練; Must), 123 (ミニマルペア産出ドリル; Must), 127 (分散学習スケジューラ; Should→本スライスでは純ロジック tractable のため Must 昇格), 125 (シャドーイング+ラグ; Should)。
- **本スライスは重量級なため、下記「サブスライス分解と推奨順序」に従い (1)→(2)→(3)→(4) の独立サブスライスとして順送りに出荷判断する**。各サブが独立に real entrypoint 到達 + agent-policy 二段門を満たすことを done 単位とする。

## サブスライス分解と推奨順序 (最重量スライスの分割; これが本仕様の中核)

各サブスライスは独立に「real entrypoint 到達 + 観測可能挙動 assert + 二段門」を満たす出荷単位。外部依存とブロッカーを明示する。**推奨順序は外部ブロッカーの少ない順 = (1)→(2)→(3)→(4)。** HVPT 刺激調達 (サブ 3 の前提) が最大ブロッカーで、刺激調達自体を独立サブスライス 3a に切り出す。

| 順 | サブスライス | 主 REQ | 外部依存 / ブロッカー | tractability |
|---|---|---|---|---|
| **(1)** | **Training Context foundation + スケジューラ純ロジック** | 127 | **なし** (刺激/RVC/analyzer 不要)。新 DB 3 テーブル + 集約 + 決定論 state machine | 最も tractable。純ロジック中心。**最初に着手** |
| **(2)** | **産出ドリル (worker 採点再利用)** | 123 | worker/analyzer **既存契約** (ADR-004; 新採点経路を作らない)。カタログからミニマルペア生成 | tractable。お手本・刺激は Kokoro (既存 `/v1/tts`) で足りる |
| **(3a)** | **HVPT 刺激調達 (analyzer carve-out)** | 122 / NF-101 | **VCTK/LibriTTS curated subset DL + 切り出しパイプライン (analyzer 内)。数百MB アセット同梱。CC BY-NC 混入禁止 fitness check** | **最大ブロッカー。重い。人間確認要 (OQ-1)** |
| **(3b)** | **HVPT 識別課題 (3a を前提)** | 122 | 3a の実刺激。Kokoro 補完 (long-tail)。多択 forced-choice + 正誤 FB + 正解音再生 | 3a 完了後は tractable |
| **(4)** | **シャドーイング + ラグ計測 (analyzer 追加)** | 125 | **analyzer に時間ずれ計測機能が無い (新規追加)。** お手本同時録音 + ラグ計測 | analyzer 追加分が新規。最後 |

- **(1) が最も tractable で外部依存ゼロ** — `training_sessions`/`hvpt_trials`/`spacing_schedules` の domain+DB+repo と、ADR-011 の決定論 state machine (24h/60%/20-30分) は刺激も RVC も analyzer 追加も要らない。スケジューラは pure function。**ここを最初に通すと、以降のサブが書き込む受け皿と完了条件 (60% ゲート) が揃う。**
- **(3a) HVPT 刺激調達が全体の最大ブロッカー** — 刺激無しでは HVPT 識別課題が agent-policy 下で動かない (偽刺激禁止 = fake/dummy の音源を本番に入れられない)。curated subset の規模・同梱・ライセンス帰属に**人間確認が要る (Open questions OQ-1)**。サブ 3b は 3a 完了が前提。
- **(4) ラグ計測は analyzer に新機能追加が要る** — お手本とのフレーム単位の時間ずれ計測は現状 analyzer (`/health` `/v1/tts` `/v1/analyze` のみ) に無い。Must/Should の判定に**人間確認が要る (OQ-2)**。
- **RVC golden VC (ADR-012) は training 画面スライスの Non-goal** — golden は workspace の A/B 第 3 音源 (`WorkspaceResultV2` の `.ab-srcs` / `--src-golden`) であり、training.html の HVPT/ドリル/シャドーイング画面には現れない。別スライス (workspace golden) に切る (Non-goals 参照; 切り出し可否は OQ-3 で確認済前提)。

## Must (満たさなければ done でない)

### サブ (1) Training Context foundation + スケジューラ

- [ ] **M-TR-1 (training 3 集約 + DB + repo が real entrypoint から到達)**: `TrainingSession` (DD-202; InProgress/Completed/Aborted の Choice Type, `kind` ∈ `hvpt_identification`/`production_drill`/`shadowing`)、`HvptTrial` (DD-203; 刺激は `StimulusIdentifier` 識別子参照で音声実体を内包しない)、`SpacingSchedule` (DD-204; `state` ∈ `rest`/`due`/`gate`/`done`) の domain 型・Smart Constructor が `applications/frontend/src/domain/training/` に実装され、`training_sessions` (DB-012) / `hvpt_trials` (DB-013) / `spacing_schedules` (DB-014) が Drizzle schema (`applications/frontend/src/infrastructure/drizzle/schema.ts`) に追加され、対応 migration (`applications/frontend/drizzle/*.sql`) が同一 PR に存在する。`hvpt_trials.training_session` FK → `training_sessions`、`spacing_schedules.focus_sound` FK → `weakness_profiles`、`uq_spacing_schedules_learner_contrast` UNIQUE が migration に含まれる。Training Context は PPC を識別子のみで参照し PPC 内部型を import しない (ADR-007 依存方向検査が緑)。既存 Training Context (diagnostic/progress スライスの `WeaknessProfile`/`ProgressSnapshot`) は破壊しない。
- [ ] **M-TR-2 (スケジューラが ADR-011 通り決定論で永続・状態遷移)**: `applySpacingTransition` (DD-267; `SpacingSchedule × Accuracy0To1|null × Date → SpacingSchedule`) が UseCase/domain 層の純関数として実装され、(a) `rest`→`due` は最終セッションから 24h 経過、(b) セッション正答率 ≥ 60% で `done` 遷移し `nextPresentationAt = now + 24h` で `rest` に戻る、(c) 正答率 < 60% で `gate` 遷移し 24h クロックを進めず短間隔で再提示、を満たす。interval=24h / gate=60% / cut-off=20-30分 は REQ-127 由来の固定値 (推定値でない)。全遷移は `spacing_schedules` に書き戻し (メモリ保持にしない; DD-204 不変条件 4)。乱数を含まない決定論 (DD-204 不変条件 3)。
- [ ] **M-TR-3 (訓練セッション完了 → progress_snapshots 生成で progress と接続)**: `completeTrainingSession` (DD-264; 20-30分上限) で完了したセッションが、既存 `capture-progress-snapshot` usecase 経由で `progress_snapshots` に統制課題スナップショット (`task_kind='drill'`) を生成する配線点を持つ (progress スライス S-PG-1 の Port を実駆動する)。`duration_minutes` が累計訓練時間 (`cumulative_training_minutes`) に積み上がり、progress 画面の訓練統計 honest empty が実値に変わる。**この接続の section 実体 (どの統制課題結果からスナップショットを作るか) は OQ-4 で人間確認した規則に従う**。

### サブ (2) 産出ドリル

- [ ] **M-TR-4 (産出ドリルが worker 実採点; 偽採点なし)**: focus sounds に対応するミニマルペア・例文を `japanese-l1-catalog.json` (error-catalog) から生成し、画面で録音した産出を **既存 worker/analyzer 契約 (ADR-004; analyzer `:8788/v1/analyze` の GOP/NBest/phenomenon + worker `:8787/v1/pronunciation-assessments` の structured diff/severity/scoreImpact)** で対象音素に絞って即時 (数秒以内) 評価する。Training Context に GOP 閾値→severity の第 2 採点ポリシーを作らない (ADR-007 制約)。worker/analyzer に産出ドリル専用の新採点 path を追加しない (既存契約再利用)。知覚 → 産出の順でセッションを構成する (REQ-123)。

### サブ (3) HVPT 識別課題 (3a 刺激調達 → 3b 識別)

- [ ] **M-TR-5 (HVPT 刺激が実刺激で調達される; 偽刺激なし)**: HVPT 刺激が ADR-009 のハイブリッド戦略で実調達される: 高 FL 中心対立 (`/r/`-`/l/`, `/θ/`-`/s/` 等 confusion set 中心) は **VCTK/LibriTTS の curated subset (CC BY 4.0) を analyzer 内で carve-out** し、long-tail は既存 Kokoro (`:8788/v1/tts`) で補完する。carve-out/前処理は `applications/python-analyzer/` 内に閉じる (ADR-005/009 layer-closure)。刺激は**話者 5 名以上・男女混在・複数音韻文脈 (語頭/語中/クラスター)** を満たす実音声 (REQ-122; 単一話者では般化しない)。**本番に fake/dummy の刺激音源を入れない (agent-policy)。** 各刺激アセットは source corpus のライセンス帰属 manifest を持ち、**CC BY-NC (L2-ARCTIC 等) を混入しない fitness check が緑** (ADR-009 Compliance / REQ-NF-101)。
- [ ] **M-TR-6 (HVPT 識別課題が実刺激で動作)**: training 画面の HVPT セッションが、(a) **多択 forced-choice 識別課題** (弁別課題でない; g 0.95 vs 0.57)、(b) 試行ごとに正誤フィードバック + 正解音再生 (産出転移 g 0.94 vs 0.45)、(c) 応答ラベルが綴り/キーワード/IPA (画像不可; DD-203/DD-245)、(d) 1 セッション 20-30 分で区切り累計訓練時間を記録、を満たす。各試行が `HvptTrial` (DD-203) として `correct = correctLabel と response の一致から導出` (DD-203 不変条件 1) で `hvpt_trials` に永続。セッション正答率は `computeSessionAccuracy` (DD-266) で `HvptTrial` 正誤から算出し、スケジューラの 60% ゲート (M-TR-2) に渡る。刺激は M-TR-5 の実刺激を `StimulusIdentifier` で参照する。

### サブ (4) シャドーイング + ラグ計測

- [ ] **M-TR-7 (シャドーイング + ラグ計測)**: training 画面のシャドーイングモードが、(a) お手本再生 (Kokoro) と同時録音、(b) **お手本との時間ずれ (ラグ) を計測・表示** (ラグ過大時は 0.7x スロー再生から開始する導線)、(c) 評価フォーカスがリズム/ポーズ/話速 (分節の細評価をしない; REQ-125)、(d) 週次実施回数を記録 (`training_sessions` の `kind='shadowing'`; `session_accuracy` は NULL 可)、を満たす。**ラグ計測は analyzer に新規追加する** (現状 analyzer に時間ずれ計測機能が無い; OQ-2 で Must/Should 確定後に実装)。シャドーイングセッション完了が `training_sessions` に積み上がる。

### 全サブ共通

- [ ] **M-TR-8 (training 画面が training.html / design-system-v2 に合致)**: training 画面が `training.html` のレイアウトに合致し、design-system-v2 の `§11 hvpt` (`.choice`/`.trial-fb`/`.cum-bar`/`.spk-chip`/`.drill-pair`/`.choice-grid`) と `§12 sched` (`.lag`/`.sched`/`.gate-note`/`.sched-cell--due`/`--gate`/`--done`/`--rest`) の部品クラスで実装される。窓 1 HVPT セッション (`.tr-body` = `.tr-main` (`.tr-q`+`.play-big`+`.choice-grid#choices`+`.tr-fbslot`) + `.tr-rail` (`.session-meta`+`.cum-bar`+`.sched`+なぜこの訓練) + `.tr-dock` (`.drill-pair`+`.rec-btn`)) と窓 2 シャドーイング (`.two-col` = `.passage`+`.player`+`.speed` / `.lag`+`.callout`) を描画する。**表示値 (trial N/M, 正答率, 累計訓練 min, スケジュールセル状態) はすべて永続化された実データから描画する** (静的 HTML の固定値 78%/184min/`12 / 40` を焼かない)。**訓練画面のみ達成感の演出 (正解時の発光 `.is-correct` 等) を許容する** (design 通り; 他画面は許容しない)。
- [ ] **M-TR-9 (agent-policy 厳守 = 本番モックなし・実 endpoint 実行 assert)**: 本番コードに mock/stub/fake/dummy/spy・test-bypass・placeholder stub を入れない (`scripts/verify-*.sh` 緑)。**HVPT 刺激に偽音源・産出ドリルに偽採点・ラグに偽値を入れない (実刺激/実採点/実計測)。** Training Context scoring 経路に LLM 呼び出しが無い (ADR-007)。RVC import が training/python-analyzer/frontend/worker に無い (ADR-012; golden は別スライス)。観測可能挙動 (訓練 API を叩くと実刺激の HVPT 試行が返り `hvpt_trials` が永続、産出録音が実 worker 採点を返す、セッション完了で `spacing_schedules` が `done`/`gate` 遷移を永続、`training_sessions` が積み上がる) を real endpoint で実行 assert できる。`.agent-evidence/` の commands.txt / wiring-map.json / completion-report.md を提出する。

## Should (望ましいが必須でない)

- **S-TR-1 (累計訓練時間プラトー表示)**: training.html の `.cum-bar` に 300-400 分プラトー (`.plateau` マーカー; §3.3-1 で効果頭打ち) を実累計値に対して描画する。累計が未蓄積なら honest empty。
- **S-TR-2 (スケジュール rail の実データ駆動)**: `.sched` の各 `.sched-cell` (`--done`/`--rest`/`--due`/`--gate`) を `spacing_schedules` の実 state から描画する。固定 4 セルの静的描画にしない。
- **S-TR-3 (ピッチ・韻律可視化 REQ-126)**: シャドーイングの F0 輪郭重ね描き。本スライスは CEFR 韻律スコアまでで足り、ピッチグラフ本体は別スライス (progress スライスと同方針)。
- **S-TR-4 (習熟度適応 REQ-113)**: 初中級/上級で訓練対象対立の構成比を変える。MVP は `WeaknessProfile` の focus 優先度順で足りる。

## 受入条件 (acceptance — Must の確認方法)

- **M-TR-1** → (a) `pnpm typecheck` 緑。(b) `applications/frontend/drizzle/` に新 migration SQL が存在し `pnpm db:generate` 後 新規 DB に `training_sessions`/`hvpt_trials`/`spacing_schedules` が作られる (`SELECT name FROM sqlite_master` に 3 テーブルが出る; 「no such table」が出ない)。`kind`/`status`/`state` の CHECK・`duration_minutes BETWEEN 1 AND 30`・FK・`uq_spacing_schedules_learner_contrast` が migration に含まれる。(c) ESLint `architecture-import/no-restricted-paths` + ast-grep 緑で Training Context が PPC 内部型を import しない (grep で 0)。既存 diagnostic/progress テーブルが migration で破壊されない (既存テーブルも `sqlite_master` に残る)。
- **M-TR-2** → 単体 test (ADR-011 Compliance 準拠): (a) 正答率 0.6 ちょうどで `done` 遷移し `nextPresentationAt` が `now + 24h` ちょうど (24h を literal でなく定数で assert)。(b) 正答率 0.59 で `gate` 遷移し `nextPresentationAt` が 24h 後 "でない" (短間隔)。(c) 同一 (lastSessionAt, accuracy, clock) で複数回呼んで next state/time が固定 (決定論; 乱数なし)。(d) 遷移後に repository 経由で `spacing_schedules` 行の `state`/`next_presentation_at` が永続している (メモリ保持でない)。
- **M-TR-3** → `docker compose up` 後、訓練セッションを 1 件完了させた直後に `progress_snapshots` を再取得すると baseline 以外に `task_kind='drill'` のスナップショットが 1 件増え、`cumulative_training_minutes` が完了セッションの `duration_minutes` ぶん増える。progress 画面の訓練統計が `0` から実値に変わる (progress スライス M-PG-5c の honest empty が解消される) ことを Playwright で確認。
- **M-TR-4** → `docker compose up` 後、産出ドリル録音を投げると analyzer `:8788/v1/analyze` と worker `:8787/v1/pronunciation-assessments` が**実際に呼ばれ** (worker/analyzer に産出ドリル専用の新 path が `grep` で増えていない = 既存契約再利用)、対象音素に絞った評価が数秒以内に返る。Training Context の domain/usecase に GOP 閾値→severity の採点ロジックが `grep` で 0 件 (ADR-007; 採点は worker のみ)。
- **M-TR-5** → (a) `applications/python-analyzer/` 配下に curated 刺激アセット (実音声) が存在し、刺激メタデータに話者 ≥ 5・男女混在・文脈 (語頭/語中/クラスター) が含まれる (`grep`/manifest で確認)。(b) **ライセンス manifest が各刺激の source corpus (VCTK/LibriTTS, CC BY 4.0) 帰属を持ち、ADR-009 の CC BY-NC 排除 fitness check が緑** (L2-ARCTIC 等の CC BY-NC source が bundled stimuli に無いことを path/manifest grep で assert)。(c) carve-out パイプラインが `applications/python-analyzer/` の外に存在しない (layer-closure)。(d) 刺激に本番 fake/dummy 音源が無い (`scripts/verify-no-prod-doubles.sh` 緑 + 実音声バイナリ存在)。
- **M-TR-6** → Playwright + API: HVPT 識別課題で (a) `.choice-grid` に 2 択以上の `.choice` (forced-choice) が描画、(b) クリック後 `.trial-fb--ok`/`--ng` と正解音再生ボタンが出る、(c) 応答ラベルが綴り/キーワード/IPA (画像 `img` でない)、(d) `.session-meta` の trial 数/正答率が実 `hvpt_trials` 由来。API で 1 セッション分の試行を投げると `hvpt_trials` に行が永続し `correct` が correctLabel/response の一致から導出 (不一致を投げると `InvalidTrialCorrectness`)。刺激が M-TR-5 の実刺激識別子を参照 (固定 dummy stimulus でないことを、別 contrast で刺激が変わる contract test で示す)。
- **M-TR-7** → Playwright + API: シャドーイングで (a) `.player` お手本再生 + `.rec-btn` 同時録音、(b) `.lag` にラグ計測値 (`.lag-needle` 位置が実計測値) と `.callout` のスロー再生導線、(c) `.speed` で 0.7x 開始、(d) `.scope-note` に週次回数。ラグ計測 API が実音声から時間ずれを返す (固定値でない; 別録音でラグ値が変わる contract test)。シャドーイング完了で `training_sessions` に `kind='shadowing'`・`session_accuracy IS NULL` 行が永続。
- **M-TR-8** → Playwright: training 画面に `.tr-body`/`.tr-main`/`.tr-rail`/`.tr-dock`、`.choice-grid`>`.choice`、`.trial-fb`、`.cum-bar`、`.spk-chip`、`.drill-pair`、`.sched`>`.sched-cell--{due,gate,done,rest}`、`.gate-note`、シャドーイング `.two-col`/`.passage`/`.player`/`.speed`/`.lag`/`.callout` が描画される。trial N/M・正答率・累計 min・スケジュールセル状態が API レスポンス値と一致する (静的 HTML の `12 / 40`/78%/184min でないことを、別セッション fixture で表示値が変わることで assert)。正解時の `.is-correct` 発光演出が training 画面でのみ出る。
- **M-TR-9** → `scripts/verify-no-prod-doubles.sh` / `verify-test-bypass.sh` / `verify-no-stub-placeholder.sh` / `verify-wiring.sh` / `verify-allowlist-expiry.sh` が対象差分で緑。Training Context の UseCase/domain に OpenAI SDK/LLM クライアント import が `grep` で 0。RVC import が training/python-analyzer/frontend/worker に `grep` で 0 (ADR-012)。`.agent-evidence/` に commands.txt・wiring-map.json (entrypoint→usecase→repository→table の経路: 訓練 API→training usecase→training-session/hvpt-trial/spacing-schedule repository→各テーブル / 産出ドリル→worker 契約 / セッション完了→capture-progress-snapshot→progress_snapshots / HVPT 刺激→analyzer 刺激エンドポイント)・completion-report.md がある。

## Non-goals (今回やらない)

- **RVC golden speaker / 自分の声の VC (REQ-128 / ADR-012) — 別スライス (workspace golden)**: golden は workspace の A/B 第 3 音源 (`WorkspaceResultV2` の `.ab-srcs` / `--src-golden`) であり、training.html の HVPT/ドリル/シャドーイング画面には現れない別概念。RVC サービス・GPU 任意・quality gate・A/B 利用ログは training 画面スライスでは作らない。**workspace golden スライスとして分離する** (切り出し前提は OQ-3 で確認済とする)。
- **HVPT corpus の全面調達**: VCTK/LibriTTS の全コーパス DL (数 GB) はやらない。**高 FL 対立中心の curated subset (数百 MB) で MVP 可** (ADR-009 scoped extraction)。long-tail は Kokoro 補完で足りる。
- **golden 以外の達成感演出の他画面展開**: 正解時発光等の達成感演出は**訓練画面のみ許容** (design 通り)。workspace/progress/library 等の他画面には持ち込まない。
- **スケジューラの拡張間隔 (SRS/Anki ease factor)**: ADR-011 通り固定 24h 等間隔で足り、拡張間隔は実装しない (等間隔と拡張に有意差なし; §3.3-4)。
- **採点閾値の本格キャリブレーション**: ADR-001 の保守的デフォルト + confusion set ルール補完で進める。
- **diagnostic/progress スライスの再実装**: `WeaknessProfile`/`weakness_profiles`/`DiagnosticSession`/`diagnostic_sessions`/`ProgressSnapshot`/`progress_snapshots`・CEFR 導出・Stage 判定・focus-tile・sentinel LearnerIdentifier・error-catalog・`capture-progress-snapshot` usecase は実装済資産を再利用する (重複実装しない)。
- **多ユーザー / Learner 集約**: diagnostic/progress スライスと同一の固定 sentinel `LearnerIdentifier` を流用 (OQ-5; 解決済)。

## Risk

- level: **high-risk**
- escalate_to_opus: **true**
- 理由 (触れる境界領域) — 設問の high-risk 判定は妥当。本スライスは Phase3 最重量:
  - **新 DB / schema / migration**: `training_sessions`/`hvpt_trials`/`spacing_schedules` 3 テーブル新設 (DB-012/013/014)。`schema.ts` 変更には `pnpm db:generate` の migration 同梱が必須 (`frontend-schema-needs-migration` 検査; 怠ると実機 no such table)。CHECK (`kind`/`status`/`state`/`duration_minutes 1..30`)・FK (`hvpt_trials→training_sessions` / `spacing_schedules→weakness_profiles`)・`uq_spacing_schedules_learner_contrast` を漏れなく migration に乗せる。
  - **full-stack 配線 / routing**: 訓練 API の App Router 配置 (セッション開始/HVPT 試行記録/産出ドリル評価/シャドーイング/スケジューラ提示候補/完了)、registry の新 usecase + repository port 配線、worker/analyzer 既存契約への配線 (新採点経路を作らない制約)、訓練画面の App Router ページ追加 (`/training` 系)、`capture-progress-snapshot` への接続。
  - **外部 corpus 依存 (最大ブロッカー)**: VCTK/LibriTTS curated subset DL + analyzer 内 carve-out パイプライン (数百 MB アセット同梱)。CC BY 4.0 帰属 manifest + CC BY-NC 排除 fitness check (ADR-009)。Docker image への焼き込み (memory: analyzer Dockerfile はハードコード pip + build 焼き込みで bind-mount 無し → 刺激アセットも build 同梱が要る)。
  - **analyzer 追加 (background/新 endpoint)**: HVPT 刺激配信エンドポイント新設 (`interface/http_handler.py` の router→`app.py` の登録)、ラグ計測機能新設 (現状 analyzer に無い)。python-analyzer 配線点 (router→include_router) を ADR-005 オニオンに沿って追加。
  - **public export**: 訓練 API の DTO 型 (`TrainingSessionDto`/`HvptTrialDto`/`SpacingScheduleDto`/HVPT 刺激形状/ラグ計測形状) の新規公開シグネチャ。既存 `FocusSoundDto`/`ProgressViewDto` との整合。
  - **データ依存 / 導出正当性**: HVPT 刺激が実音声 (偽刺激禁止)・産出ドリルが実 worker 採点 (偽採点禁止)・ラグが実計測 (偽値禁止)・スケジューラ遷移が実 `hvpt_trials` 正答率からの実導出であること。偽データ混入の検出が UI/analyzer 両面に分散する。

## Open questions

### 人間確認が要る (ブロッキング) — 着手前に lihs の判断を要する

- **OQ-1 (HVPT 刺激をどこまで調達するか) — ブロッキング・最大ブロッカー**: ADR-009 は「curated subset (数百 MB) + Kokoro 補完」を decision として持つが、**具体的にどの対立まで natural speech を carve-out し、どこから Kokoro 補完に落とすか / curated subset の正確な規模・同梱方法 (Docker image 焼き込み or 別配布) / CC BY 4.0 帰属 manifest の運用**は人間判断が要る。刺激無しでは HVPT (サブ 3) が agent-policy 下で動かない (偽刺激禁止) ため、サブ 3 着手前に確定が必要。**サブ 3a (刺激調達) を独立サブスライスに切り、ここを最初の人間レビュー対象にすることを推奨。**
- **OQ-2 (ラグ計測を Must / Should どちらにするか) — ブロッキング**: REQ-125 (シャドーイング) は Should、ラグ計測はその受入基準の一部。**ラグ計測機能は現状 analyzer に無く新規追加**が要る (analyzer に時間ずれ計測を足す = サブ 4 の重み)。シャドーイング+ラグ (サブ 4) を本スライスの Must に含めるか、別スライス送り (Should 据え置き) にするかは出荷判断で人間確認を要する。**推奨: スケジューラ/HVPT/産出ドリル (サブ 1-3) を本スライス Must、シャドーイング+ラグ (サブ 4) は分離して Should 据え置き** (analyzer 追加の重みと REQ-125 が元々 Should である整合から)。
- **OQ-3 (RVC golden を別スライスに切るか) — 確認**: 本仕様は golden を training 画面スライスの Non-goal とし workspace golden 別スライスに分離する判断を採った (golden は training.html に現れないため設計上妥当)。この分離方針の最終承認を人間に求める。**承認されれば本スライスでは RVC に一切触れない。**
- **OQ-4 (訓練セッション → progress_snapshot 生成の section 実体) — 確認 (progress debt 解消)**: progress スライスは `cumulative_training_minutes` の受け皿と `capture-progress-snapshot` Port (S-PG-1) を用意済だが、training 未実装ゆえ honest empty (0) だった。本スライスで訓練セッション完了から `task_kind='drill'` スナップショットを生成する際、**どの統制課題結果 (産出ドリルの GOP / セッション正答率) をどの `section`/`source_assessment` に紐付けてスナップショット化するか**の規則を確認する。`ProgressSnapshot` の `section`/`sourceAssessment` は PPC 識別子参照必須 (DD-205 不変条件 4) のため、産出ドリルが PPC の `Section`/`AssessmentResult` を生成する経路か、診断由来の section を流用するかを人間確認する。

### 実装判断で非ブロッキング (topology-mapper / implementer が決める)

- **OQ-5 (学習者識別)** — **解決 (diagnostic/progress スライスと同一)**: 固定シングルトン `LearnerIdentifier` を流用する。`infrastructure/config` の sentinel ULID を `training_sessions`/`hvpt_trials`/`spacing_schedules` の `learner` 全行に用いる。`Learner` 集約・ユーザー管理は本スライスでも作らない。sentinel 値はドメインに literal 埋め込みせず config に隔離 (DD-293 整合)。
- **OQ-6 (訓練 API の path / メソッド)**: セッション開始・HVPT 試行記録・産出ドリル評価・シャドーイング・スケジューラ提示候補取得・セッション完了の具体 App Router path とメソッド分割。既存 diagnostic API の usecase 注入パターン (`getContainer().usecases.*`) と `app/api/v1/diagnostic-sessions/...` の配置を踏襲する。
- **OQ-7 (HVPT 刺激配信の analyzer endpoint 形状)**: curated 刺激を training 画面に配信する analyzer エンドポイント (例 `GET /v1/stimuli?contrast=...`) の path・刺激メタ (話者/性別/文脈/provenance) の返却形状。`interface/http_handler.py` の router → `app.py` の登録を踏襲する。
- **OQ-8 (ミニマルペア・例文の生成規則)**: 産出ドリルの focus sound 対応ミニマルペア・例文を `japanese-l1-catalog.json` の `confusionSet` からどう生成するか。実装スペックで仮置きしてよい。
- **OQ-9 (セッション cut-off の実装位置)**: 20-30 分打ち切りを usecase (`completeTrainingSession`) と training UI のどちらで強制するか。ADR-011 Compliance は両方で enforce を求める (上限上界 30 分を assert)。実装スペックで確定する。
