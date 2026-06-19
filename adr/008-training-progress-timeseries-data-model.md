# Persist diagnostic, training, and progress time-series as dedicated normalized tables

ADR-008: training/progress time-series data model

# Status: Accepted

# Context

The current database stores one assessment as a single row in `assessment_results` (DB-008), with the
analysis payload aggregated into JSON BLOB columns (`assessment_result_json`, `raw_response_json`,
`engine_snapshot_json`). The pronunciation-feedback-v2 spec deliberately chose this BLOB route to hold
the full-phoneme GOP, NBest, F0 contour, and two-axis scores (v2 spec §Risk: "`assessment_results` の
JSON BLOB 拡張で全音素 GOP・NBest・F0・2 軸スコアを格納"). That choice is correct for one recording:
the analysis result of a single attempt is a snapshot, write-once, and read back whole.

It is the wrong shape for **Phase 3 progress data**. REQ-129 (進捗可視化と学習継続設計, Must) requires:

- per-focus-sound score trends over time,
- trends across the three CEFR phonological-control sub-scales (overall / segmental / prosodic),
- cumulative training time and training interval,
- effect measurement restricted to controlled tasks (re-reading the same sentence, drill accuracy),
  because the research evidence (E-2) shows gains concentrate in controlled tasks and transfer to
  spontaneous speech is unclear and must not be over-claimed.

None of REQ-129 is answerable from the existing schema. There is **no table for training sessions or
HVPT trials at all**, so cumulative training time and drill accuracy have nowhere to live. And the
per-event time series REQ-129 demands (focus-sound score over many sessions, sub-scale trends over time)
cannot be queried from `assessment_result_json`: each BLOB is one recording, the values are buried inside
opaque JSON, and `idx_assessment_results_scores` indexes only the six top-level integer columns for the
existing history list — not focus-sound-level or sub-scale-level series. The v2 spec left the storage
target for this data explicitly open (v2 spec §Open questions: "全音素 GOP・NBest・F0 の格納先（既存
`assessment_result_json` BLOB 拡張か新テーブルか）— migration 設計で確定"). This ADR resolves that open
question for the diagnostic/training/progress time series.

This ADR therefore **branches from** the v2 BLOB policy rather than contradicting it. The BLOB policy
stays in force for the per-recording assessment payload of a single attempt (the original §2.4 JSON
policy and DB-008 are unchanged). The new tables are an intentional extension for cross-session,
queryable training history — a different data lifecycle (append-many, time-indexed, aggregated) than the
write-once snapshot the BLOB serves.

NativeTrace is a local MVP. The data volume is single-learner, single-machine; query patterns are
trend/aggregate reads over a learner's own history.

# Decision

Persist diagnostic, training, and progress time-series data as a set of **dedicated normalized tables**
in the frontend Drizzle/SQLite schema (better-sqlite3), under a new bounded context **Training Context**.
The existing PPC tables (`materials` … `assessment_results`) and `finding_dismissals` are not changed;
the new tables reference `sections` and `assessment_results` by identifier foreign keys, following the
established naming discipline (the referenced model is the field name, no `Identifier` suffix on the FK
column).

The new tables (snake_case physical names, `identifier` text primary key, FK columns named after the
referenced model):

1. **`diagnostic_sessions`** — one diagnostic run's result metadata plus a reference to the
   `WeaknessProfile` it generated. Anchors REQ-121's "診断結果から focus sounds が生成される" to a
   persisted, replayable record rather than a transient computation.

2. **`weakness_profiles`** — per-learner, per-focus-sound current state: the composite priority score
   (functional-load rank × occurrence frequency × proficiency, per REQ-112). Updated incrementally by
   EWMA so that section-practice analysis results progressively refresh the profile (REQ-112
   "漸進更新", B-4: no separate re-diagnostic test). One row per (learner, focus sound).

3. **`training_sessions`** — one HVPT / drill / shadowing session: kind, start/end timestamps, and the
   minutes that roll up into cumulative training time (REQ-129 累計訓練時間, REQ-121 1 セッション
   20–30 分).

4. **`hvpt_trials`** — one identification trial: references its `training_sessions` row and the stimulus,
   plus the contrast presented, the learner's response, correctness, and reaction time. Supports the
   forced-choice identification format and drill-accuracy effect metric (REQ-121, REQ-129).

5. **`spacing_schedules`** — per-contrast next presentation time and lifecycle state
   (`due` / `gate` / `done` / `rest`) plus recent accuracy. Drives the spacing/scheduler loop (REQ-127)
   and the "実施間隔" axis of REQ-129.

6. **`progress_snapshots`** — a timestamped snapshot: CEFR overall/segmental/prosodic scores, per-focus
   score map, and cumulative training time. Snapshots are recorded **only for controlled tasks**
   (re-reading / drill), per research E-2, so the progress view measures the feature-level gain the
   evidence supports and does not over-claim transfer to spontaneous speech.

Bounded-context vocabulary contract (shared verbatim with the sibling ADRs):

- New BC **Training Context**.
- Aggregates: `DiagnosticSession` / `WeaknessProfile` / `TrainingSession` / `HvptTrial` /
  `SpacingSchedule` / `ProgressSnapshot`.
- Physical table names: the six listed above.
- `progress_snapshots` and `diagnostic_sessions` reference `sections` and `assessment_results` by
  identifier FK. PPC tables are untouched.

**Constraints (must remain true for this decision to hold):**

- The Drizzle schema source of truth stays at
  `applications/frontend/src/infrastructure/drizzle/schema.ts`; migration SQL stays under
  `applications/frontend/drizzle/`. The new tables are added there, not in any other service.
- `progress_snapshots` rows are written only for controlled-task results. A free-speech / spontaneous
  task must not produce a progress snapshot (E-2). If Phase 4 adds spontaneous tasks (RISK-103
  mitigation), the snapshot scope must be re-evaluated, not silently widened.
- The BLOB policy for the per-recording assessment payload (DB-008, §2.4) is unchanged. The new tables
  do not duplicate or replace `assessment_result_json`; they reference the assessment by identifier and
  store only the derived, time-indexed values needed for trends.

## 追補 2026-06-19（v3 設計ギャップ監査 — 比較再生の音声ソースと訓練統計タイルの honest-empty 確定）

cluster `progress-training-stats`（v3 設計ギャップ監査）で、A/B 比較再生プレイヤーの音声ソースがどの ADR でも未決定であることが判明した。REQ-018（過去試行比較 / 録音再生、Must）と REQ-129 受入（同一セクションの過去録音との比較再生ができること）は機能する比較プレイヤーを要求するが、本 ADR §Decision の制約は `progress_snapshots` が「assessment を identifier で参照し、trends に必要な derived, time-indexed values のみを保存する」とだけ定め、比較音声の出所を定義していなかった。現実の進捗画面実装（`applications/frontend/src/app/progress/page.tsx` の比較再生カード、`snapshots.length >= 2` ゲート配下の `.ab-srcs`）は音声ソースボタンを `progress_snapshots` から構築し、ボタンを `snapshot.identifier` でキー付けしている。スナップショットは音声参照を一切持たないため、プレイヤーは構造的に再生不能（波形高さ・再生時刻 `—` ハードコード、source/交互再生/再生ボタンに onClick なし）だった。本追補はこのギャップを本 ADR の所掌内で確定する。

### D-PROG-AB-1: 比較再生 A/B プレイヤーは `recording_attempts` を音声ソースとし、`progress_snapshots` は派生スコア専用のまま維持する

A/B 比較再生プレイヤーの音声実体は、同一 `Section` に紐づく過去の `recording_attempts` 行と、それが参照する `audio_files`（`audio_files.recording_attempt` FK → `recording_attempts.identifier`、`audio_files.storage_key`）から解決する。再生は既存の AudioStorage Route Handler（API-016: `GET /api/v1/recording-attempts/{recordingAttemptIdentifier}/audio`、Range 対応 200/206/416）経由で行い、`progress_snapshots` からは行わない。`progress_snapshots` は本 ADR §Decision 制約のとおり派生スコア（CEFR overall/segmental/prosodic・focus 別スコア・cumulative training time）専用のままとし、音声参照カラムを追加しない。同一 `Section` の過去録音群の取得は既存の `idx_recording_attempts_section_recorded`（`section, deleted_at, created_at` の順）で時刻順に引く。比較対象（同一 Section の録音）が 2 件未満なら honest-empty（「比較対象なし」）を描画する。プレイヤーは実音声に対する実再生（self/reference の交互再生を含む）を行い、ハードコード波形・固定再生時刻・onClick 欠落の見せかけ UI を本番経路に残さない。

採否（Alternatives considered）:
- 採用: 比較音声を `recording_attempts` / `audio_files`（`audio_files.recording_attempt` FK 経由、AudioStorage Route Handler）から解決する。録音実体への参照は既存の FK が唯一の正であり、`progress_snapshots` の write-once-derived ライフサイクル（作成後不変・派生スコアのみ）を保つ。
- 不採用: `progress_snapshots` に音声参照カラムを追加してスナップショットから直接再生する案。`recording_attempts` / `audio_files` が既に保持する音声参照を二重化し、スナップショットの write-once-derived 制約（本 ADR §Decision）を破る。既存の `audio_files.recording_attempt` FK が音声ソースを提供するため、追加カラムは不要。

この決定は提示専用であり、採点経路に一切触れない。比較再生の描画・再生コードパスは worker の scoring locus（ADR-004:27 — worker が `ScoreSet` / `severity` / `scoreImpact` を所有する。注: ADR-004 は Status: Proposed）に到達せず、`AssessmentResult` / `ScoreSet` を mutate しない。frontend は録音の再生のみを担う。

### 訓練統計タイルの honest-empty 確定（spec M-PG-5c の ADR レベル再確認）

訓練統計タイル（累計訓練時間 / 試行数 / 実施間隔 / streak）は、training スライス（本 ADR §Decision の `training_sessions` / `hvpt_trials` / `spacing_schedules`）が未実装である限り honest-empty（`0` / 「訓練データなし」）を描画する。これらのタイルを `progress_snapshots` の件数（snapshot-count）や最新診断日（latest-diagnostic-date）等の代替値へ転用してはならない。代替値転用は progress-screen spec（`docs/specs/progress-screen.md`）の M-PG-5c に対する spec 逸脱であり、ADR ギャップではない。本追補はこの不変条件を spec M-PG-5c を一次ソースとしつつ ADR レベルで再確認する（spec の文言を fork せず back-reference する）。training スライス実装後、`training_sessions` / `hvpt_trials` / `spacing_schedules` の実データが蓄積された時点で同一コードパスが実値に切り替わる。

### 新規 Must（progress スライスの M-PG-* 系列を継続）

- **M-PG-8（比較再生が同一 Section の過去録音から実再生する）**: 同一 `Section` の `recording_attempts` が 2 件以上存在する状態で、進捗画面の比較再生カードが各録音を `.ab-src` として描画し、source ボタンと交互再生ボタンが API-016（`GET /api/v1/recording-attempts/{recordingAttemptIdentifier}/audio`）経由で当該 `audio_files.storage_key` の実音声を再生する。音声ソースは `progress_snapshots` ではなく `recording_attempts` 由来であること（snapshot の identifier ではなく recording_attempt の identifier がプレイヤーへ渡る）を assert する。同一 Section の録音が 2 件未満なら「比較対象なし」を描画する。比較再生は提示専用であり、再生・描画コードパスが worker の scoring locus（ADR-004:27）に到達せず `AssessmentResult` / `ScoreSet` を mutate しないこと（grep + ESLint `architecture-import/no-restricted-paths` で Training Context / 進捗経路が scoring 内部型・worker クライアントを import しないことを確認）を観測可能 assert とする。本番経路に mock/stub/fake/dummy/spy・placeholder stub・ハードコード波形/固定再生時刻を含まない（`scripts/verify-no-prod-doubles.sh` / `verify-no-stub-placeholder.sh` 緑）。real public entrypoint（App Router 進捗画面 + API-016）から観測可能挙動として Playwright で実行 assert できる。

- **M-PG-9（訓練統計タイルが honest-empty で出る・転用しない）**: training スライス未実装の状態で、訓練統計タイル（累計訓練時間 / 試行数 / 実施間隔 / streak）が `0` または「訓練データなし」を描画し、`184 min` / `26 h` / `12 日` 等の架空値、および `progress_snapshots` 件数・最新診断日への転用値を出さない。返却 DTO・画面表示値のいずれにも転用値が現れないことを grep（返却 JSON）/ Playwright（画面）で assert する（spec M-PG-5c の不変条件を本 ADR の決定として再確認）。本タイルは提示専用であり、その描画・導出コードパスが worker の scoring locus（ADR-004:27）に到達せず `AssessmentResult` / `ScoreSet` を mutate しない。

# Consequences

Positive:

- REQ-129 becomes directly answerable. Focus-sound score trends, CEFR sub-scale trends, cumulative
  training time, and training interval are plain indexed queries over `progress_snapshots`,
  `weakness_profiles`, `training_sessions`, and `spacing_schedules` — no per-request JSON re-aggregation.
- Training-loop data (HVPT trials, drill accuracy, spacing state) finally has a home. Cumulative training
  time and drill-accuracy effect metrics are first-class columns, not absent.
- The controlled-task restriction on `progress_snapshots` encodes research finding E-2 in the data model
  itself, keeping the effect-measurement honest by construction.

Negative / trade-offs:

- Six new tables plus their migration enlarge the schema and the surface that future schema changes must
  keep consistent. The database-design document (currently 8 tables on paper, 9 in code) drifts further
  from implementation until it is updated to cover Training Context.
- Writing progress data now spans two stores: the per-recording BLOB in `assessment_results` and the
  derived snapshot in `progress_snapshots`. The use-case layer must keep them coherent (the snapshot
  references the assessment it was derived from); they are not a single transactional aggregate.
- EWMA state in `weakness_profiles` is mutable current-value, not append-only history. The full audit
  trail of how a profile evolved is reconstructed from `progress_snapshots`, not from the profile row.

Alternatives considered:

- **(a) Dedicated normalized tables. [Adopted]** Each time-series concern is a row with indexed,
  queryable columns. REQ-129's trend and aggregate queries are native; training-loop data has explicit
  storage. Cost is six tables and a migration, which is proportionate to a Must requirement.
- **(b) Aggregation views over `assessment_results`. [Rejected]** A view cannot store what does not
  exist: there is no training-session or HVPT-trial data in `assessment_results`, so cumulative training
  time, drill accuracy, and the spacing schedule have no source — REQ-129 is unsatisfiable. Even for the
  score trends it could in principle serve, re-aggregating JSON BLOBs on every progress-view load is
  expensive and defeats the indexed-trend requirement.
- **(c) Append-only event sourcing. [Rejected]** A single event log with projections would capture every
  diagnostic/training/progress event, but it is over-engineered for a single-learner local MVP: the
  projection/replay machinery and the aggregation logic to derive current focus-sound state and
  cumulative time add complexity disproportionate to the requirement. Normalized tables with an EWMA
  current-value column reach the same answers more directly.

# Compliance

- The new tables are defined in `applications/frontend/src/infrastructure/drizzle/schema.ts`. After any
  change to that schema, migration SQL must be regenerated with `pnpm db:generate`; a schema change
  without a matching migration produces a runtime `no such table` even when typecheck is green.
- The co-change is machine-enforced by the `frontend-schema-needs-migration` rule in `wiring_manifest.yml`:
  editing `applications/frontend/src/infrastructure/drizzle/schema.ts` requires a matching
  `applications/frontend/drizzle/*.sql` in the same change, verified by `verify-wiring` at the fitness
  hook and in CI. The migration SQL for these tables must exist in the same PR as the schema change.
- The repository is the only place these tables live: they are added to the frontend Drizzle schema, not
  to the Haskell worker or the python-analyzer service.
- The database-design document (`docs/05-database-design/database-design.md`) must be updated to describe
  Training Context and the six tables, so the design-of-record stops drifting from implementation.
- 比較再生（D-PROG-AB-1）は既存の `recording_attempts` / `audio_files` テーブルと AudioStorage Route Handler（API-016: `applications/frontend/src/app/api/v1/recording-attempts/[recordingAttemptIdentifier]/audio/route.ts`）のみを使い、`progress_snapshots` に音声参照カラムを追加しない。six training tables のスキーマ変更は無く、追加 migration（`pnpm db:generate` 再生成）も不要（`frontend-schema-needs-migration` ルールは `schema.ts` 編集時のみ発火し、本追補は schema.ts を変更しないため対象外）。
- M-PG-8 / M-PG-9 は progress-screen spec（`docs/specs/progress-screen.md` の M-PG-5c / M-PG-5d）の M-PG-* 系列を継続する観測可能 Must であり、spec を一次ソースとしつつ本 ADR の決定として固定する。比較再生・訓練統計タイルはいずれも提示専用のため、その描画・導出コードパスは worker の scoring locus（ADR-004:27; worker が `ScoreSet` / `severity` / `scoreImpact` を計算。ADR-004 は Status: Proposed）に到達せず `AssessmentResult` / `ScoreSet` を mutate しない。frontend は presentation のみを担い、これを grep + ESLint `architecture-import/no-restricted-paths` で確認する。

# Notes

- Author: lihs
- Approval date: 2026-06-13
- Approver:
- Last updated: 2026-06-18 (amended)
- Amended 2026-06-18 (pronunciation-remediation batch): ADR-022 (closed remediation loop) maintains this ADR's `progress_snapshots.task_kind` invariant (controlled tasks only — rereading / drill). Retry-recording `AssessmentResult` rows are explicitly NOT written to `progress_snapshots`; the retry is persisted under a per-finding synthetic single-word section (the `FINDING_RETRY_MATERIAL_SINGLETON` isolation mechanism, same shape as the drill-section fixture), which is outside this ADR's `progress_snapshots` constraint. No schema change to the six training tables.
- Amended 2026-06-19 (v3 設計ギャップ監査 — cluster `progress-training-stats`): A/B 比較再生の音声ソースを `recording_attempts` / `audio_files`（AudioStorage Route Handler API-016 経由）に確定し（D-PROG-AB-1）、`progress_snapshots` を派生スコア専用のまま維持。訓練統計タイルの honest-empty を再確認（snapshot-count / latest-diagnostic-date へ転用禁止、spec M-PG-5c 一次）。新規 Must M-PG-8 / M-PG-9 を追加。six training tables のスキーマ変更なし。
- Open question (OQ-PROG-AB-1): あるスナップショット／Section に対する比較再生の対象録音集合を、(a) 同一 `Section` の全 `recording_attempts` を時刻順に引くか、(b) `progress_snapshots.section` 経由で当該 Section に絞った recording_attempts に限定するか。MVP は (a)（`idx_recording_attempts_section_recorded` で同一 Section を時刻順）で足りる。進捗画面のどのスナップショットを起点に Section を解決するかの規則は progress-screen spec 側（OQ-6 近傍）で確定する。
- Changes: Initial entry. Related: ADR-007 (introduces the Training Context bounded context),
  ADR-004 (scoring policy and the six score dimensions consumed by progress snapshots),
  pronunciation-feedback-v2 spec (the JSON BLOB policy this ADR branches from for time-series data).
  REQ-129 (進捗可視化と学習継続設計) is the originating requirement; research finding E-2 constrains
  the controlled-task scope of `progress_snapshots`.
