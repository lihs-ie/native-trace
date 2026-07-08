# History (Screen 07) review surface DTO contract and run-status mapping

ADR-028: 履歴（Screen 07）レビュー面の DTO 契約・run-status マッピング・エンジン種別・所見内訳の確定

# Status

Proposed

2026-06-19 起票（履歴レビュー面の DTO 契約が API-013 で抽象のまま未確定であり、route が run ステータスを mode 文字列で上書きしている欠陥を含むため、本 ADR で契約とマッピングを確定する）。

# Context

履歴（Screen 07、`applications/frontend/src/app/history/page.tsx`）は SectionSeries 単位の横断レビュー面で、録音試行・各試行の AnalysisRun・エンジン別スコア／所見数・run ステータスピル（succeeded / running / failed / partial）・カテゴリスコアの推移・試行ごとの操作（再表示・再解析・削除・オーバーフロー）を一覧する。この面を所有する ADR も spec も存在しない。ADR-008（`adr/008-training-progress-timeseries-data-model.md`、Accepted）は *progress*（Training Context 時系列）という別画面を扱い、`docs/specs/pronunciation-feedback-v2.md` は履歴上の所見 dismissal 永続化（M-108）だけに触れて attempt-row / trend / エンジン別の契約には踏み込まない。`docs/04-api-specification/api-specification.md` の API-013（916 行 `### API-013: 履歴取得`）は履歴サブオブジェクトを `sectionSeries: {}`（941 行）／ `recordingAttempts: []`（945 行）／ `analysisRuns: []`（946 行）と抽象のまま残し、engineKind / status / per-engine 内訳 / duration / failure-reason / retry / upload-source のフィールド契約を一切定めていない。

このクラスタは性質の異なる二つを含む。

1. **決定不要の純粋なコード欠陥。** `applications/frontend/src/app/api/v1/history/route.ts:72` は `status: ar.mode` を設定している。`ar.mode` は AnalysisMode（ドメイン値 `cloud_only` / `oss_worker_only` / `comparison`、`applications/frontend/src/domain/analysis-run.ts:13`）であって run のステータスではない。run の実ステータスは AnalysisRun ドメイン値（`AnalysisRun.status`、`analysis-run.ts:26`）であり、その値は `deriveAnalysisRunStatus`（`analysis-run.ts:73-85`）／ DB projection（database-design.md DB-006、511 行の派生規則 + `ck_analysis_runs_status` CHECK、500 行）が確定している。usecase（`applications/frontend/src/usecase/review-practice-history/index.ts`）は既にこの正しい `AnalysisRunStatus`（`queued` / `running` / `partial_succeeded` / `succeeded` / `failed` / `canceled`、`analysis-run.ts:14-20`）を `index.ts:108`（`status: runStatus`、`index.ts:133` で `run.status` から渡している）で `status` として forward しているのに、route がそれを mode 文字列で上書きしている。結果として page（`history/page.tsx:460-502`）の succeeded / running / failed ピル判定（`status === "succeeded"` 等）はライブデータで一切一致せず、全ピルが到達不能になる。同 route は usecase が `index.ts:115-120` で算出している `perAxisScores`（accuracy / nativeLikeness / connectedSpeech / prosody）を `route.ts:74-80` のマッピングで落としており、trend-cats コンテナ（`history/page.tsx:439` の `<div className="trend-cats" />`）が恒久的に空になる。さらに `engineKindDotVar`（`history/page.tsx:46-47`）は `openai` else rust の二分岐しか持たず、`engineKindLabel`（`history/page.tsx:40-43`）も `openai` / `oss_worker`(=rust) しか扱わない。usecase が forward する `engineKind`（`index.ts:114` の `result.engineSnapshot.type` ＝ `cloud | oss_worker`、`applications/frontend/src/domain/assessment-result.ts:254`）の `cloud` は、誤った色のドット（`--engine-rust`）＋リテラル文字列で描画される。

2. **真に未設計でデザイン参照（gitignored `design-reference/screens/history.html`）にのみ存在し DTO／ドメインに出所が無いフィールド。** Upload source、is-failed の理由テキスト、retry カウンタ、オーバーフローメニュー、カテゴリ別 trend-cats。これらは契約決定を要する。なおドメイン／DB に出所がある項目もある（後述 D4）。

API-013 がサブオブジェクトを抽象に残しているため、この面の契約は明文化されていない。本面は読み取り専用の提示面であり、新規スコアリングや LLM 呼び出しを導入しない（ADR-004 の scoreImpact 不変条件を厳守する）。

# Decision

**D1 — route のステータス／perAxisScores 欠陥を修正する（設計曖昧性なし）。** `applications/frontend/src/app/api/v1/history/route.ts` の analysisRun マッピングは、usecase が forward した実 `AnalysisRunStatus`（`ar.status`、`queued` / `running` / `partial_succeeded` / `succeeded` / `failed` / `canceled`。出所はドメイン `AnalysisRun.status`／`deriveAnalysisRunStatus`／DB projection）を `status` フィールドへ forward する。`ar.mode`（AnalysisMode）は別個の `mode` フィールドにのみ載せる（status と mode を混同しない）。同時に各 assessmentResult の `perAxisScores`（`index.ts:115-120` で算出済み）を forward し、`route.ts:74-80` で落とさない。

**D2 — engineKind をドメイン値 `cloud | oss_worker` で公開する。** 履歴 DTO の `engineKind` は `string` ではなく `"cloud" | "oss_worker"` に narrow する（既存 `EngineResultDto.engineKind: "cloud" | "oss_worker"`、`api-types.ts:303` と同一規約）。page のラベル／ドットヘルパーは `cloud → OpenAI 系ラベル＋--engine-openai ドット`、`oss_worker → Rust ラベル＋--engine-rust ドット` に対応付ける（`engineKindLabel`／`engineKindDotVar` の分岐キーを `openai` から `cloud` に揃える）。リテラル `cloud` 文字列が誤色ドットで描画される経路を除去する。

**D3 — エンジン別所見数を提示する。** 所見数は既に usecase で各 assessmentResult ごとに `findingsCount`（`index.ts:113`）として算出され、route が assessmentResults 配列ごとに forward 済み（`route.ts:77`）。欠陥は page 側で `run.assessmentResults.reduce((sum, r) => sum + r.findingsCount, 0)`（`history/page.tsx:530-537`）と全エンジン合算している点。page は各 assessmentResult ごとの `findingsCount` を per-engine 行（`.eres`）に描画し、2 エンジン run で二つの異なる count を示す。

**D4 — 未設計フィールドの帰属を確定する。** 各フィールドについて「現 DTO に追加（ドメイン／DB 出所を明示）」か「正直空（honest-empty）として提示」かを決める。fake placeholder は一切出さない（`verify-no-stub-placeholder.sh` green）。

- **audio duration**: in-scope。出所はドメイン `ReadyRecordingAttempt.duration: RecordingDuration`（`applications/frontend/src/domain/recording-attempt.ts:69`）と DB `recording_attempts.duration_milliseconds`（database-design.md:399、`ck_recording_attempts_ready_duration` で ready 時 NOT NULL を保証、:417）。`RecordingAttemptHistoryOutput`（`index.ts:54-59`）と route の recordingAttempt マッピングに duration を追加し、ready 状態の試行で実値を載せる。ready 以外（saving / failed / deleted）では duration を持たないため null。
- **failure reason**: in-scope。出所はドメイン `FailedRecordingAttempt.failureReason: RecordingFailureReason`（`recording-attempt.ts:79`）と DB `recording_attempts.failure_reason`（database-design.md:402）。failed 試行でのみ failureReason を載せ、それ以外は null。
- **upload source / filename**: in-scope。出所はドメイン `RecordingOrigin`（`recording-attempt.ts:42-53`、`browser_recording` / `uploaded_file`）と DB `recording_attempts.original_file_name`（database-design.md:401、`ck_recording_attempts_uploaded_origin` で uploaded_file ready 時に非空を保証、:419）。ready 試行の origin から source 種別を、`uploaded_file` のとき `originalFileName`（`recording-attempt.ts:51`）を載せる。origin を持たない状態（saving / failed / deleted）では null。
- **retry counter**: ドメインにも DB（DB-006 / recording_attempts に retry 列なし）にも明示フィールドの出所が無い。本 ADR では DTO の専用フィールドとして追加せず、honest-empty とする（page は試行に紐づく analysisRuns 件数を表示するに留め、専用 retry カウンタは描画しない）。新規ドメイン／DB フィールドの導入は本 ADR のスコープ外（# Notes の open question）。

**D5 — partial_succeeded / running のマルチエンジン表示状態を到達可能にする。** D1 で実ステータスが forward されることで、`partial_succeeded` / `running` がライブデータに現れる。この 6 値集合は DB が正本である（database-design.md DB-006 `ck_analysis_runs_status` CHECK、500 行 + 派生規則、511 行）ため、両状態は invented ではなく実在の live state である。page は running／partial に対しデザインの解析中／partial ピルを描画する（`statusPillClass` / `statusLabel`、`history/page.tsx:60-72` を partial_succeeded を含めて拡張する）。

**D6 — オーバーフローメニュー操作を実エンドポイントへ配線する。** 再解析（reassess）は POST `/api/v1/recording-attempts/{recordingAttemptIdentifier}/analysis-runs`（API-011、route handler `applications/frontend/src/app/api/v1/recording-attempts/[recordingAttemptIdentifier]/analysis-runs/route.ts`）、録音試行削除は DELETE `/api/v1/recording-attempts/{recordingAttemptIdentifier}`（API-014、`.../[recordingAttemptIdentifier]/route.ts`）、AnalysisRun 削除は DELETE `/api/v1/analysis-runs/{analysisRunIdentifier}`（API-015、`applications/frontend/src/app/api/v1/analysis-runs/[analysisRunIdentifier]/route.ts`）へ配線する。これらは全て既存の App Router route handler（存在を確認済み）。削除済みの録音試行 / AnalysisRun は API-013 の規約どおり履歴に返さない（api-specification.md:963「削除済み録音、削除済みAnalysisRunは通常返さない」）。再表示（re-show）は既存の比較画面 Link（`history/page.tsx:538-544`）を再利用し、新エンドポイントを増やさない。

**D7 — 本面は読み取り専用の提示面であり、新規スコアリングを導入しない。** status / engineKind / perAxisScores / findingsCount / duration / failureReason / origin は全て既存 usecase・ドメインの値を透過するだけで、worker/analyzer の採点契約（ADR-004）には触れない。scoreImpact は不変。

# Contract changes

- **python schema**: 変更なし。本面は frontend 内（usecase → route → page）で完結する読み取り経路で、python-analyzer の計測契約・schema（`applications/python-analyzer/src/python_analyzer/interface/schema.py`）には一切触れない。
- **Haskell ToJSON**: 変更なし。worker の `AssessmentFinding` / `AnalyzerResult` の ToJSON 契約は不変。run ステータスと履歴集計は frontend の usecase が SQLite から組むため、Haskell 側のシリアライズ契約に影響しない。
- **TS usecase（`applications/frontend/src/usecase/review-practice-history/index.ts`）**: `RecordingAttemptHistoryOutput`（54-59 行）に `durationMilliseconds: number | null`（ready 試行の `duration` 由来）、`failureReason: string | null`（failed 試行の `failureReason` 由来）、`uploadSource: "browser_recording" | "uploaded_file" | null`・`originalFileName: string | null`（ready 試行の `origin` 由来）を追加し、`buildAttemptsSequentially`（139-175 行）で各状態から実値を詰める。`AssessmentResultSummaryOutput.engineKind`（41 行）は型上 `"cloud" | "oss_worker"` に narrow する（実値は既に `result.engineSnapshot.type`、`index.ts:114`）。`status` / `perAxisScores` は既存のまま（status は `index.ts:108`／`:133` で domain `run.status` を forward 済み、perAxisScores は `index.ts:115-120` で算出済み。いずれも変更不要）。
- **TS route（`applications/frontend/src/app/api/v1/history/route.ts`）**: analysisRun マッピング（68-82 行）で `status: ar.status`（`ar.mode` ではなく）に修正、`mode: ar.mode` は別フィールドとして維持、各 assessmentResult に `perAxisScores: r.perAxisScores` を追加。recordingAttempt マッピング（63-67 行）に `durationMilliseconds` / `failureReason` / `uploadSource` / `originalFileName` を forward。
- **TS api-types（`applications/frontend/src/lib/api-types.ts`）**: `AssessmentResultSummaryDto`（478-484 行）の `engineKind: string` を `engineKind: "cloud" | "oss_worker"` に narrow し、`perAxisScores: { accuracy: number; nativeLikeness: number; connectedSpeech: number; prosody: number }` を追加。`HistoryAnalysisRunDto`（486-492 行）の `status: string` を `status: "queued" | "running" | "partial_succeeded" | "succeeded" | "failed" | "canceled"` に narrow。`mode` は route が forward するドメイン値 `ar.mode`（snake_case `"cloud_only" | "oss_worker_only" | "comparison"`、`analysis-run.ts:13`）であり、既存の `api-types.ts:393` の `AnalysisMode`（camelCase `"cloudOnly" | "ossWorkerOnly" | "comparison"`）とはリテラルが異なる。型不整合を避けるため、`mode: string` の narrow は (a) ドメイン snake_case union `"cloud_only" | "oss_worker_only" | "comparison"` をそのまま DTO 型に採用する（route が変換しないので最小差分・推奨）。`api-types.ts:393` の camelCase `AnalysisMode` には narrow しない（runtime 値が snake_case のため型不整合になる）。`HistoryRecordingAttemptDto`（494-498 行）に `durationMilliseconds: number | null` / `failureReason: string | null` / `uploadSource: "browser_recording" | "uploaded_file" | null` / `originalFileName: string | null` を追加。
- **TS zod**: 本面の取得経路は内部 usecase 呼び出し（`route.ts:37` の `container.usecases.reviewPracticeHistory`）であり、acl 経由の外部 worker レスポンス zod parse は介在しない（worker schema 不変のため）。`route.ts:11-16` の入力 `querySchema`（material / sectionSeries / offset / limit）は変更不要。

# Alternatives considered

- **採用案: 既存 usecase が forward 済みの値（status / engineKind）と算出済みの値（perAxisScores / findingsCount）を route が忠実に forward し、duration / failureReason / origin はドメイン／DB の既存フィールドから足す。retry のみ honest-empty。** Pros: status は usecase（`index.ts:108`／`:133`、出所はドメイン `analysis-run.ts:26`／`deriveAnalysisRunStatus:73-85`／DB projection）が forward 済み、perAxisScores（`index.ts:115-120`）・findingsCount（`index.ts:113`）も usecase に存在するため、route の forward 修正と DTO narrow だけで全ステータスピル・trend-cats・エンジン別 count がライブで動く。duration / failureReason / origin はドメイン（`recording-attempt.ts:69,79,42-53`）と DB（database-design.md:399,402,401）に実出所があり fabrication にならない。新規スコアリング・LLM・DB スキーマ追加が不要で ADR-004 の scoreImpact 不変を維持できる。Cons: retry カウンタはドメイン／DB 出所が無いため honest-empty に留まり、デザイン参照の retry 表示は当面出ない。採用理由: 欠陥修正は決定不要かつ最小差分で実害（全ピル・trend 死）を解消し、未設計フィールドは実出所のあるものだけ in-scope にして fake placeholder を避けられる。
- **不採用案 A: route 修正をやめ、page 側で `mode` 文字列から status を推測する。** 不採用理由: page は run の終端状態（succeeded / partial / failed）を mode（cloud_only / comparison）から再導出できない。情報源は AnalysisRun の status であり、ドメイン `deriveAnalysisRunStatus`（`analysis-run.ts:73-85`）／ DB projection が確定し usecase が forward 済み。page で推測すると二重ロジック化し、partial_succeeded / running を表現できず、ステータスの正本が二か所に割れる。
- **不採用案 B: retry カウンタ・upload source 等の未設計フィールド全てに専用ドメイン／DB テーブルを新設して即 in-scope 化する。** 不採用理由: retry はドメインにも DB（DB-006 に retry 列なし）にも出所が無く、新テーブル・マイグレーションは本面の読み取り契約を超える範囲の決定で、AGENTS.md の「in-scope なら実出所と test、無ければ honest-empty」方針に照らし過剰。duration / failureReason / origin は既存ドメイン・DB に出所があるので追加コストなしで足せるが、retry は honest-empty として open question に残すのが正直。
- **不採用案 C: 履歴 DTO を変更せず page の表示だけ調整する（presentation-only fix）。** 不採用理由: status / perAxisScores が DTO に届いていないこと自体が欠陥であり、page だけ直してもデータが無いものは描画できない。DTO contract（route forward + 型 narrow）の修正が必須。

# Consequences

## Positive

- succeeded / running / partial_succeeded / failed のステータスピルがライブデータで到達可能になり、`history/page.tsx:460-502` の死んでいた分岐が動く。
- trend-cats（カテゴリ別推移）が usecase 算出済みの perAxisScores から実描画され、`<div className="trend-cats" />`（`history/page.tsx:439`）の恒久空が解消する。
- `cloud` エンジンが正しいラベル／ドット（`--engine-openai`）で描画され、リテラル文字列＋誤色ドットの表示崩れが消える。
- エンジン別所見数が per-engine で読めるようになり、comparison run で OpenAI / Rust の内訳が区別できる。
- duration / failureReason / upload origin がドメイン・DB の実値から提示され、fake placeholder を出さずに失敗・アップロード文脈が読める。
- 全変更が frontend 内（usecase → route → page）の読み取り経路に閉じ、python-analyzer / worker の契約・scoreImpact に一切触れない（ADR-004 不変）。

## Negative

- retry カウンタはドメイン／DB 出所が無いため honest-empty に留まり、デザイン参照の retry 表示は当面実装されない（open question として残る）。
- `HistoryRecordingAttemptDto` / `AssessmentResultSummaryDto` のフィールド追加で DTO 形が広がり、消費側（page・将来の compare 画面）の型が更新を要する。
- partial_succeeded を page のステータスヘルパーに追加するため、`statusPillClass` / `statusLabel` の分岐が増える（テストで網羅が必要）。

# Compliance

1. **受入: status が実 AnalysisRunStatus である。** GET `/api/v1/history?sectionSeries=<id>`（`applications/frontend/src/app/api/v1/history/route.ts` の `GET`）に対し、succeeded な run を持つ系列を投入すると `analysisRuns[].status === "succeeded"` を返し、AnalysisMode（`cloud_only` / `comparison` 等）は別フィールド `mode` にのみ現れることを route の contract test（`route.test.ts`、route handler を fetch で叩き JSON を assert）で検証する（`status` に mode 文字列が入らない回帰を固定）。
2. **受入: perAxisScores が forward され trend-cats が描画される。** 同エンドポイントのレスポンスで各 assessmentResult が `perAxisScores`（accuracy / nativeLikeness / connectedSpeech / prosody）を持ち、値が usecase 算出（`index.ts:115-120`）と一致し fabrication でないことを route contract test で assert。trend-cats の描画は `history/page.tsx` の RSC render test（React Server Component を render して DOM を assert）で `.trend-cats` がカテゴリ別バー要素を含み空 `<div>` でないことを assert する。
3. **受入: engineKind が `cloud | oss_worker` で公開され正しく描画される。** レスポンスの `engineKind` が `"cloud" | "oss_worker"` のみであることを route contract test で assert。`history/page.tsx` の RSC render test で `cloud` が OpenAI 系ラベル＋`--engine-openai` ドット、`oss_worker` が Rust ラベル＋`--engine-rust` ドットで描画され、リテラル `cloud` 文字列＋誤色（`--engine-rust`）ドットが出ないことを assert。
4. **受入: エンジン別所見数が per-engine で描画される。** 2 エンジン（comparison）の run を投入した `history/page.tsx` の RSC render test で `.eres` 行が二つ描画され、それぞれ異なる `findingsCount` を示す（合算単一表示でない）ことを assert。
5. **受入: 未設計フィールドは実出所か honest-empty。** ready 試行で `durationMilliseconds` が `RecordingDuration`／`recording_attempts.duration_milliseconds` 由来の実値、failed 試行で `failureReason` が `RecordingFailureReason`／`recording_attempts.failure_reason` 由来、`uploaded_file` 試行で `uploadSource="uploaded_file"` と `originalFileName` を返すことを route contract test で assert。retry は専用フィールドを出さず honest-empty であることを確認し、いずれのフィールドも fake placeholder を出さない（`scripts/verify-no-stub-placeholder.sh` green）。
6. **受入: partial_succeeded / running がライブ到達し描画される。** 一方のエンジンが succeeded、他方が running の run を投入すると status が `running` または `partial_succeeded`（DB-006 の派生規則どおり、database-design.md:511）で返り、`history/page.tsx` の RSC render test が解析中／partial ピルを描画することを assert。
7. **受入: オーバーフロー操作が実エンドポイントへ配線される。** 再解析が POST `/api/v1/recording-attempts/{id}/analysis-runs`（API-011）、録音試行削除が DELETE `/api/v1/recording-attempts/{id}`（API-014）、AnalysisRun 削除が DELETE `/api/v1/analysis-runs/{id}`（API-015）の既存 route handler を呼ぶことを Playwright E2E（`applications/frontend/e2e/`）で assert し、削除後はその試行／run が GET `/api/v1/history` に現れない（API-013 規約、api-specification.md:963）ことを route contract test で assert。
8. **agent-policy: real entrypoint 到達と決定論ゲート。** 全 Must が実 App Router エントリ（GET `/api/v1/history` および API-011/014/015 の route handler）から到達可能で観測可能挙動を assert する。`scripts/verify-no-prod-doubles.sh` / `scripts/verify-no-stub-placeholder.sh` / `scripts/verify-wiring.sh` を green に保ち、本番経路に mock / stub / fake / placeholder を入れない。`.agent-evidence/`（commands.txt / wiring-map.json / completion-report.md）を更新する。
9. **policy: scoreImpact 不変（ADR-004）。** 本面は読み取り専用の提示変更であり、新規スコアリング・LLM 呼び出しを導入しない。worker/analyzer の採点契約と scoreImpact が本変更の前後で不変であることを既存 ScoringSpec / 採点テストの維持で確認する（提示専用機能の scoreImpact 不変条件、ADR-004）。

# Notes

- Open questions:
  - retry カウンタの正本: ドメインにも DB（DB-006 に retry 列なし）にも出所が無く、本 ADR では honest-empty とした。試行の「やり直し回数」を独立に永続化するか、AnalysisRun 件数から導出表示に留めるかは product 判断による未確定事項。専用フィールド／テーブルを導入する場合は別 ADR でドメイン・DB スキーマを定義する。
  - upload source の表示文言（`browser_recording` → 「録音」、`uploaded_file` → ファイル名表示）の i18n／デザイン仕様は本 ADR では契約のみを定義し、page の最終文言は実装時にデザイン参照と突き合わせる。
- API-013（`docs/04-api-specification/api-specification.md`、916 行以降、サブオブジェクトは 941/945/946 行で `{}` / `[]` の抽象）はサブオブジェクトを抽象に残しているが、本 ADR が履歴 GET レスポンスのフィールド契約の正本となる。API-013 のスキーマ本文を本 ADR のフィールドへ具体化する更新は同 PR で行う。
- 本面の取得は内部 usecase（`route.ts:37`）経由で、worker レスポンス zod parse は介在しない。worker schema・Haskell ToJSON は不変。
- Amends:
  - ADR-004: 不変（本 ADR は scoreImpact / 採点契約に触れない読み取り専用の提示契約。scoreImpact 不変条件を継承して遵守する）。
  - ADR-008: 不変（progress 画面の時系列モデルとは別画面。履歴面は本 ADR が所有する）。
- Author: lihs
- Last updated: 2026-06-19
- Related: ADR-004（worker scoring 所有・scoreImpact 不変条件。本 ADR は提示専用で scoreImpact に触れない）、ADR-008（progress 時系列データモデル。本 ADR は別画面の履歴レビュー面を所有）。
