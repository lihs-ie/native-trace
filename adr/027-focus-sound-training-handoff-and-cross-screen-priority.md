# Focus-sound to Training-Context navigation handoff and cross-screen ranked priority

ADR-027: focus sound 訓練 CTA の Training Context 遷移ハンドオフと画面横断 FL ランク付き優先度契約

# Status

Proposed

2026-06-19 起票。`.agent-evidence/v3-design-gap-audit/gap-register.md:126` の cluster `focus-sounds-priority-training-cta`（priority medium / related ADRs 010,007 / target new）を正規化したもの。承認は実装スライス着手前にリポジトリオーナーが行う。

# Context

## 背景

focus sound の優先度付け（ADR-010 の三項 FL モデル：`priority = w1·normalizedFunctionalLoadRank + w2·occurrenceFrequency + w3·(1 − mastery)`、domain.md:1116-1119 の `FocusScore` / DD-239 `PriorityScore`）は診断結果・workspace rail・進捗の各画面にデータ配線済みで、Training Context（ADR-007）とその `/training` ルート（`applications/frontend/src/app/training/page.tsx`）・訓練 API（`src/app/api/v1/training/{drills,hvpt-sessions,schedule,shadowing-lag}`）も実装済みである。しかし診断 / workspace → 訓練のハンドオフがエンドツーエンドで未配線である。

## コードで確認した2つの系統的ギャップ

**GAP 1（訓練 CTA が全て不活性 — 支配的ギャップ）。** 診断結果タイルの `開始`／`予約`／`後で` ボタン（`src/app/diagnostic/[diagnosticSessionIdentifier]/result/page.tsx:355-365`）はいずれも `onClick` を持たない素の `<button type="button">` である。`useRouter`／`router.push` は `src/components/workspace` を含む `src/components/` 配下に存在しない（grep = 0、検証済）。診断・進捗画面は `src/app/diagnostic/.../result/page.tsx` と `src/app/progress/page.tsx` に実装され、`src/components/` 配下には `diagnostic`／`progress` ディレクトリ自体が無い（現存は `audio-recorder`/`chrome`/`engine-result-panel`/`highlighted-text`/`ui`/`workspace`）。遷移先（`/training` と訓練 API）は構築済みでハンドオフのみが欠落している。

**GAP 2（進捗の優先度が位置由来でランク付きでない）。** 進捗画面は Now/Next/Later を `index/total` 比から導出している（`src/app/progress/page.tsx:182-196`、コメント「最新スナップショットの focusScores 順序から推定」）。これは進捗 DTO `ProgressSnapshotDto.focusScores` が `Array<{ contrast: string; score: number }>`（`src/lib/api-types.ts:453`）で優先度フィールドを持たず、DD-252（`FocusScore` = `contrast` + 0〜100 整数スコア、domain.md:1169 / ADR-008）に厳密に一致しているためである。実装は設計に忠実で、設計そのものが進捗にランク付き優先度を持たない。三項 FL 優先度は `WeaknessProfile.FocusSound`（DD-239 `PriorityScore`）にのみ存在し、診断結果タイル（`sound.priority` + FL ランク + focus-why、`result/page.tsx:297-348`）に正しく現れる。

## 所有 ADR の境界

ADR-022 §D8（022:77, 94）は workspace `DetailPanelV2` の単一「ドリルへ →」ボタンのみを決定する：`finding.catalogId !== null` のとき `disabled` を外し、`catalogId` をクエリで渡して `production_drill` を起動する PPC→Training の明示遷移（drill route の流用ではない、ADR-007 分離維持）。closed-remediation-loop.md:304 はこれを当該スライスの Non-goal とし「ボタンは `disabled` のまま据え置く」と明記する。現コードでは `src/components/workspace/DetailPanelV2.tsx:465-467` の「ドリルへ →」が `disabled` のままである。すなわち workspace ドリル CTA は ADR-022 に対して build-only である。なお ADR-022 §D8 / D-list / closed-remediation-loop.md:304 が引用する `DetailPanelV2.tsx`(:369) は現コードでは 465-467 に移動している（検証済の disabled ボタン）。本 ADR は現行行番号を引く。

それ以外のハンドオフ — 診断タイルの `開始`／`予約`／`後で` の挙動、workspace rail の train-this-weakness、進捗タイルの挙動、focus contrast／`catalogId` から訓練セッション種別（HVPT 識別 vs `production_drill`）への対応、`予約`／`後で` が `SpacingSchedule`（ADR-011、DD-204 / DD-248 の `rest`/`due`/`gate`/`done`）に対して持つ意味 — を決定する ADR は存在しない。ADR-007 はコンテキスト分離を、ADR-011 はスケジューラ状態機械を所有するが、いずれも UI→訓練エントリの意味論も `予約`／`後で`→`SpacingSchedule` 対応も決めていない。

GAP 1 の「各訓練タイルが画面横断で何をするか」と GAP 2 の「ランク付き優先度が画面横断でどこに住むか」は同一の優先度サーフェシング決定であり、ADR-008 はストレージ形のみ（`focus_scores_json`、`schema.ts:401`）を所有してこのポリシーを所有しない。よって両 GAP を1つの新規 ADR で扱う。ADR-022 §D8 は workspace ドリルボタンを引き続き所有する（build-only、ここで再決定しない）。

## catalogId の参照元（混同を避けるための明示）

ハンドオフで渡す `catalogId` は2つの別 DTO に由来し、null 性が異なる：

- focus タイル経路（本 ADR が配線する診断結果・進捗 focus タイル）は `DiagnosticFocusSoundDto.catalogId`（非 null `string`、`api-types.ts:678`）を読む。focus タイルは null gating を行わない。
- workspace §D8 ボタン（ADR-022 所有）は `DiagnosticFinding.catalogId`（`string | null`、`api-types.ts:214` および `:287`）に対し `catalogId !== null` で `disabled` を制御する。

本 ADR の focus タイルハンドオフと §D8 の finding ボタンは別の catalogId ソースを用いるため、同一視しない。

# Decision

focus sound → Training Context へのナビゲーションハンドオフを一級の決定として定義する。診断結果・workspace rail・進捗の各 focus タイル／行は、既存 `/training` フローへ遷移する実訓練エントリポイントとし、Next.js App Router の `Link`／`useRouter` で配線する。

**contrast → セッション種別の決定論的対応。** focus contrast（および存在すれば `catalogId`）をハンドオフで渡し、起動する訓練セッションがその contrast を対象とするようにする。focus タイル経路で渡す `catalogId` は非 null の `DiagnosticFocusSoundDto.catalogId`（`api-types.ts:678`）である。対応は決定論的な純関数とし、固定ハードコードリストにしない：`phenomenon`／`functionalLoadRank` 等の既存フィールドから種別を導出する（例：segmental かつ FL `max`/`high` は HVPT 識別 + 産出ドリル、prosodic はシャドーイング系）。focus contrast を変えると起動セッションの対象が変わることをユニット／contract テストで示す。現状 `/training` は `sessionStorage` の `training-weakness-profile-id`（`weaknessProfileIdentifier`）から HVPT を起動する（`training/page.tsx:150` の `sessionStorage.getItem`）が、本決定により contrast／`catalogId` を渡せるエントリパラメータ（クエリ）を追加し、当該 contrast を対象に起動する。

**`予約`／`後で` と SpacingSchedule の整合。** `SpacingSchedule`（ADR-011）への遷移は `due → session → done/gate` のみで開き、セッションを走らせずに将来の contrast を「予約」する遷移は ADR-011 の状態機械に存在しない（011:66-82）。したがって `予約`／`後で` を新たなスケジューラ状態として導入しない。`予約` は当該 contrast を `/training` の対象キューに含めて遷移する明示的な「今は走らせず後で扱う」UI 動作とし、`SpacingSchedule` エントリの作成・前進は行わない（スケジュール前進は ADR-011 の `done` 遷移のみが担う）。`後で`（FL 低優先度の focus、`priority < 0.3` 相当）は遷移を伴わない明示的非スケジューリング動作とし、不活性ラベルではなくその旨を観測可能にする。`SpacingSchedule` の状態（`rest`/`due`/`gate`/`done`）は ADR-011 が引き続き唯一の所有者である。

**画面横断のランク付き優先度契約。** 進捗画面の focus 優先度は、診断結果と同一の ADR-010 三項 FL ランク優先度とし、位置（`index/total`）由来にしない。`ProgressSnapshotDto.focusScores` の各要素に `priority`（数値、診断結果の `DiagnosticFocusSoundDto.priority`（`api-types.ts:682`）と同一スケール）と `reason`（FL 由来の説明文字列）を追加し、`progress_snapshots.focus_scores_json`（`schema.ts:401`）・ドメインの `FocusScore`（DD-252）・`ProgressDto`（`api-types.ts:465`）に同じ拡張を施す。`progress/page.tsx` の `focusPriorityLabel`／`focusPriorityClass`（:182-196）は `index/total` 比からの導出をやめ、`priority` 値を閾値判定する（診断結果 `priorityToLabel`／`priorityToCssClass`、`result/page.tsx:38-49` と同一の Now ≥ 0.6 / Next ≥ 0.3 / Later 規則）。

**per-row why-line と sparkline + 週次訓練回数。** 進捗 focus 行は FL 説明の per-row why／reason 行を実データ（`reason`）から描画し、診断結果の focus-why と一致させる。focus タイルは推移 sparkline（≥2 スナップショット必須）と週次訓練回数を描画し、スナップショット < 2 件または訓練データ無しのときは偽の折れ線・偽の回数を出さず honest empty にする（progress-screen.md M-PG-5 の honest empty 規則に一致）。

**ADR-022 §D8 の不変。** workspace `DetailPanelV2` の「ドリルへ →」ボタン（`catalogId → production_drill`）は ADR-022 §D8 が所有する。本 ADR はこれを変更せず、重複・矛盾もさせない。workspace ドリルボタンは §D8 が決めた `catalogId → production_drill` 遷移を用いる（本 ADR は build-only として参照する）。

**スコアリング境界の不変。** 本ハンドオフとランク付き優先度はいずれも採点を行わない。contrast → セッション対応と進捗に出すランク付き優先度は、既存の `WeaknessProfile` FL 優先度と worker／analyzer の採点契約（ADR-004：採点ポリシーは Haskell worker に集中、frontend は `messageJa` 補完と識別子付与のみ、004:27-49）を再利用する。Training Context 経路に新規の隠れ採点も LLM 呼び出しも導入しない（ADR-007/010 制約）。これは presentation 寄りの拡張であり、`scoreImpact`／`ScoreSet` の不変性を保つ（ADR-004）。

# Contract changes

進捗の優先度契約は frontend 単層（TypeScript / Drizzle / SQLite）で完結する。worker（Haskell）・analyzer（python、`applications/python-analyzer/src/python_analyzer/interface/schema.py`）は診断採点を担うのみで進捗 DTO を生成しないため、本 ADR で python schema / Haskell ToJSON の変更は不要である（GAP 2 は frontend 契約変更）。

- **TS api-types（`src/lib/api-types.ts:453`）**: `ProgressSnapshotDto.focusScores` の要素を `{ contrast: string; score: number }` から `{ contrast: string; score: number; priority: number; reason: string }` に拡張する。`priority` は ADR-010 三項合成値で `DiagnosticFocusSoundDto.priority`（`:682`）と同一スケール、`reason` は FL 由来の説明文字列。
- **ドメイン `FocusScore`（domain.md:1116-1119 / DD-252）**: `FocusScore = { contrast: PhonemeContrast; score: Score0To100 }` に `priority: PriorityScore`（DD-239 と同型）と `reason`（FL 由来説明）を追加する。DD-252 の不変条件（`contrast` と 0〜100 整数スコア）は維持し、`priority` は三項合成（固定リスト禁止、DD-239）であることを不変条件に加える。
- **Drizzle スキーマ（`src/infrastructure/drizzle/schema.ts:401`）**: `progress_snapshots.focus_scores_json`（既存 JSON 列、`ck_progress_snapshots_focus_scores_json` で `json_valid` を強制、`schema.ts:421`）の格納形に `priority`／`reason` を含める。列追加は不要（JSON 形拡張）だが、baseline スナップショット生成（`captureProgressSnapshot`、closed-remediation-loop.md M-PG-2 経路）が `WeaknessProfile.focusSounds` の実 `priority` を写すよう更新する。zod／パース層が存在する場合は同形に追従させる。view-progress usecase（`src/usecase/view-progress/index.ts:34` の `focusScores`）も同形に追従させる。
- **訓練エントリパラメータ**: `/training`（`training/page.tsx`）が `weaknessProfileIdentifier` に加え、起動対象を絞る `contrast`（と任意の `catalogId`）をクエリ／パラメータで受け、当該 contrast を対象に HVPT 識別 / `production_drill` を起動できるようにする。これは UI→Training の遷移契約であり、新規ドメインフィールドは増やさない。
- **不変点（変更しない）**: `SpacingScheduleDto.state`（`api-types.ts:622`、`rest`/`due`/`gate`/`done`、DD-248）は ADR-011 が所有し本 ADR で変更しない。`DiagnosticFocusSoundDto`（`:676-683`）も変更しない。

# Alternatives considered

**採用：1つの新規 ADR で画面横断ハンドオフ + ランク付き優先度を扱い、workspace ドリルボタンは ADR-022 §D8 に委譲する。** ハンドオフ意味論と優先度サーフェシングは同一決定であり、ADR-008 はストレージ形のみを所有する。§D8 は既に唯一の workspace ドリル CTA を所有するため重複を避けて参照する。

**不採用：GAP 1（ハンドオフ）と GAP 2（ランク付き優先度）を別 ADR に分割する。** 「各訓練タイルが何をするか」と「ランク付き優先度がどこに住むか」は同一の画面横断優先度サーフェシング決定であり、分割すると進捗 DTO 拡張と CTA 配線が別 ADR に分散して整合性検査が困難になる。不採用。

**不採用：`予約`／`後で` を新規 `SpacingSchedule` 状態（例 `reserved`）として導入する。** ADR-011 の状態機械は `due → session → done/gate` でのみ間隔を開き、セッション非実行の予約遷移を持たない（011:66-82）。新状態を足すと ADR-011 の決定論的・mastery-gated 不変条件（間隔は `done` 遷移でのみ開く）を侵食する。よって `予約` は非スケジューリングの UI 遷移動作に留め、`SpacingSchedule` は変更しない。不採用。

**不採用：進捗の `index/total` 位置由来優先度を presentation のままにし契約を変えない（GAP 2 を build-only とする）。** 進捗の優先度は位置順では ADR-010 三項 FL モデルを反映せず、位置が同じで FL 優先度が異なる2 行が同一ティアに落ちる。設計（DD-252）自体がランク付き優先度を欠くため、契約変更なしでは「見かけ上それらしいが機能負荷モデルではない」状態が固定される。不採用。

**不採用：worker／analyzer に進捗優先度の採点を追加する。** ADR-004 は採点を worker に集中させるが、進捗ランク付き優先度は既存 `WeaknessProfile` FL 優先度の再利用で足り、新規採点経路は ADR-007/010 の「Training 経路に隠れ採点・LLM を入れない」制約に反する。不採用。

# Consequences

## Positive

- 診断結果・workspace rail・進捗の全訓練 CTA が real App Router エントリから到達可能・観測可能挙動を持つ実訓練エントリになり、dead な `<button type="button">` が解消される。
- contrast → セッション種別が決定論的純関数で導出され、focus contrast を変えると起動セッション対象が変わることがユニット／contract テストで再現可能になる。
- 進捗の focus 優先度が ADR-010 三項 FL モデルに一致し、診断結果と同一スケール・同一規則でランク付けされる。位置順の見かけ優先度が排除される。
- `予約`／`後で` が ADR-011 状態機械を侵食せず、スケジューラの決定論性・mastery gate 不変条件が保たれる。
- ADR-004 の採点境界が保たれる（presentation 寄り拡張、`scoreImpact`／`ScoreSet` 不変、Training 経路に隠れ採点・LLM 無し）。

## Negative

- `progress_snapshots.focus_scores_json` の格納形が拡張されるため、既存 baseline スナップショットは `priority`／`reason` を欠く。後方互換（欠落時の honest empty / 再生成）の扱いを実装スライスで決める必要がある（下記 Notes の Open Question）。
- `/training` が contrast／`catalogId` を受けるエントリ拡張により、起動パスが `weaknessProfileIdentifier` 単独より分岐が増える。決定論性をテストで固定する負担が生じる。
- `予約` を非スケジューリング UI 動作と定義したため、「予約した contrast を後で確実に提示する」永続キューはこのスライスでは持たない（将来 training セッション蓄積に委ねる）。

# Compliance

以下を testable 受入条件とする。各条件は real entrypoint と観測可能な assert を伴う。

1. **全訓練 CTA が実遷移を持つ。** 診断結果タイルの `開始`／`予約`／`後で`（`src/app/diagnostic/[diagnosticSessionIdentifier]/result/page.tsx:355-365`）、進捗 focus タイル（`src/app/progress/page.tsx`）が、Next router／`Link` で既存 `/training`（`src/app/training`）へ遷移する `onClick`／`href` を持つ。Playwright が URL 変化／遷移を assert する。grep ゲートは実在パスを対象とする：`src/app/diagnostic/[diagnosticSessionIdentifier]/result/page.tsx` と `src/app/progress/page.tsx` の focus タイル／行 CTA に `onClick`／`href` を持たない素の `<button type="button">` が残らないことを確認する（`src/components/diagnostic`／`src/components/progress` は存在しないので grep 対象にしない）。workspace 側の CTA は `src/components/workspace/DetailPanelV2.tsx` の §D8 ボタン経由であり、本 ADR の新規配線対象ではない（#4 参照）。
2. **contrast → セッション対応が決定論的かつ非ハードコード。** ハンドオフが focus contrast（と存在すれば非 null の `DiagnosticFocusSoundDto.catalogId`、`api-types.ts:678`）を渡し、起動訓練セッションがその contrast を対象とする。contrast を変えると起動セッション対象が変わることを contract／ユニットテストが示す（固定リストでないこと）。
3. **`予約`／`後で` と ADR-011 の整合が testable。** `予約` は `SpacingSchedule` エントリを作成・前進せず当該 contrast を対象に `/training` へ遷移する明示動作、`後で` は遷移を伴わない明示非スケジューリング動作であること。real entrypoint から、`予約` 後に当該 contrast の `SpacingSchedule`（`GET /api/v1/training/schedule`）が新規作成・状態前進していないことを assert する（`rest`/`due`/`gate`/`done` の状態機械は ADR-011 が所有、不変）。
4. **ADR-022 §D8 の不変。** workspace `DetailPanelV2`「ドリルへ →」（`src/components/workspace/DetailPanelV2.tsx:465-467`、`finding.catalogId !== null` で `DiagnosticFinding.catalogId`（`api-types.ts:214`/`:287`、nullable）に gating して `catalogId → production_drill`）は ADR-022 §D8 が所有する owner として変更されない。本 ADR の配線がこれを重複・上書きせず、workspace ドリルボタンは §D8 の `catalogId → production_drill` 遷移を用いる（grep で本 ADR 由来の二重実装が無いことを確認）。
5. **進捗優先度が三項 FL ランク。** `GET /api/v1/progress`（`src/app/api/v1/progress/route.ts`）が返す `ProgressSnapshotDto.focusScores` の各要素に `priority`（ADR-010 三項合成値）と `reason` が含まれ、`progress/page.tsx` が `index/total` から Now/Next/Later を導出しない（grep：`focusPriorityLabel`／`focusPriorityClass`（`progress/page.tsx:182-196`）が `index/total` 比を使わない）。位置が同じで FL `priority` が異なる2 行が異なるティアを描画することを contract テストが示す。
6. **per-row why-line と sparkline + 週次回数の honest empty。** 進捗 focus 行が実 `reason`（FL 説明）由来の per-row why 行を描画し診断結果 focus-why（`result/page.tsx:348`）と整合する。focus タイルが ≥2 スナップショットで sparkline、訓練データありで週次訓練回数を描画し、< 2 件・訓練データ無しでは偽の折れ線・偽の回数を出さず honest empty にする（progress-screen.md M-PG-5、Playwright で baseline 1 件時の honest empty を assert）。
7. **agent-policy 厳守。** 本番経路に mock/stub/fake/dummy/spy・test-bypass・placeholder stub を入れない（`scripts/verify-no-prod-doubles.sh`／`scripts/verify-no-stub-placeholder.sh`／`scripts/verify-wiring.sh` 緑）。訓練 CTA は real App Router エントリから到達可能で観測可能挙動を実行 assert できる。Training Context scoring／進捗導出経路に LLM 呼び出しが無い（ADR-007/010）。`.agent-evidence/` の `commands.txt`／`wiring-map.json`／`completion-report.md` を提出する。

# Notes

- ADR-022 §D8（022:77, 94 / closed-remediation-loop.md:304）が workspace `DetailPanelV2` の単一ドリル CTA（`catalogId → production_drill`、現状 `DetailPanelV2.tsx:465-467` で `disabled`）を所有する。本 ADR はこれを再決定せず build-only として参照する。ADR-022 / closed-remediation-loop.md が引く `DetailPanelV2.tsx`(:369) は現コードでは 465-467 に移動している（将来読者が stale 行を追わないための注記、検証済）。
- ADR-011（011:66-82）が `SpacingSchedule` 状態機械（`rest`/`due`/`gate`/`done`、間隔は `done` 遷移でのみ開く）を唯一所有する。`予約`／`後で` はこの状態を作らない。
- 関連 ADR：007（PPC/Training 分離）、008（progress_snapshots / `FocusScore` DD-252）、010（三項 FL 優先度）、004（採点を worker に集中・presentation の `scoreImpact=0` 不変）。
- 起票根拠：`.agent-evidence/v3-design-gap-audit/gap-register.md:126`（cluster `focus-sounds-priority-training-cta`）。
- **Open Question OQ-1**: 進捗 focus 行の reason フィールド名。診断結果側の focus-why は DTO フィールドではなくクライアント導出テキスト（`getRecommendedTraining`、`result/page.tsx:76-92`、`functionalLoadRank`+`contrast` から生成）であり、`DiagnosticFocusSoundDto` に `reasonJa` フィールドは存在しない（DTO は `functionalLoadRank`/`occurrenceFrequency`/`mastery`/`priority` のみ、`api-types.ts:676-683`）。なお `reasonJa` は `DiagnosticFinding`（`api-types.ts:213` 付近）には存在する別 DTO のフィールドであり focus DTO のものではない。進捗側の `reason` を (a) 同じ FL 由来クライアント導出ロジックの共有とするか、(b) `progress_snapshots` 永続化時に実 `WeaknessProfile` 由来の説明文字列を焼くか、を実装スライスで確定する。本 ADR は「FL 由来・診断結果と整合・実データ起点」までを決め、正確なフィールド名／生成箇所は実装スライスの決定とする。
- **Open Question OQ-2**: 既存 baseline スナップショット（`priority`／`reason` を欠く `focus_scores_json`）の後方互換。欠落時 honest empty とするか、`WeaknessProfile` から再生成するかを実装スライスで決める。
- **Open Question OQ-3**: 「週次訓練回数」の集計源。`training_sessions` は現状未実装（progress-screen.md:53、`cumulative_training_minutes` は 0 / honest empty）。回数集計に用いる実テーブル／クエリの確定は training セッション実装に依存し、それまでは honest empty とする。
