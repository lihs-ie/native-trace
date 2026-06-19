# Canonical workspace result rail and non-product prototype-tooling scope

ADR-030: workspace 結果レールの正準化（RailV2+WorkspaceResultV2 を唯一とし v1 Gauge/ScoreRows/sevpills を撤去）とプロトタイプ調整ツール群の非プロダクト宣言

# Status

Proposed

2026-06-19 起票（v3 design-gap audit のクラスタ `workspace-v1-dead-rail`（priority low、target=new）由来。22 gap features が(1)死んだ v1 レール・(2)プロトタイプ調整ツール層・(3)部分的なプレイヤー chrome の 3 群に分解され、いずれも既存 ADR/spec が「正準」「非プロダクト」を明示所有していない領域。本 ADR は build ではなく retire/de-scope を記録する）。

# Context

workspace 結果画面（Screen 02）は 2 層の死んだ/未仕様の presentation を抱えている。

(1) 死んだ v1 レール。`applications/frontend/src/app/materials/[materialIdentifier]/sections/[sectionIdentifier]/page.tsx:390` の結果状態分岐（`state === "result" && activeResult ? (...)`）は `WorkspaceResultV2`（同 :411、内部で `RailV2` を `WorkspaceResultV2.tsx:524` でレンダリング）を描画する。RailV2 は二段階軸（`.mini-axis .ma`、明瞭性 / ネイティブ性）・CEFR 3 下位尺度（`.subscale`、`RailV2.tsx:24-26` の cefrOverall/cefrSegmental/cefrProsodic）・focus sounds（`.focus-row`）という v2 構成を持つ。一方 v1 の `Gauge`（`activeResult.scores.overall` を引数に取る）・`ScoreRows`・severity-count-pills（`.sevpill`）は `page.tsx:439` の `<div className="ws-rail">` ブロック内にのみ存在し、コメント（:438）が文字どおり「result rail (v1 — idle/recording/analyzing/failed 状態のみ)」と記す。これらは `page.tsx:442`/`:450` の `{activeResult && (...)}` で gate されているが、この `.ws-rail` ブロックは `state !== "result"` の else 側にしか出ない。`activeResult` が非 null になるのは結果状態だけであり、結果状態ではこの else 分岐自体がレンダリングされない。すなわち v1 の Gauge/ScoreRows/sevpills は live データに配線されているのに、データを伴って描画されることが構造的にありえない（dead with data）。v2 spec `docs/specs/pronunciation-feedback-v2.md:42`（M-WS）は `.mini-axis .ma` / `.subscale` を含む v2 部品を正準として規定するが、v1 の Gauge/ScoreRows/sevpills を明示的に撤去するとは書いていない。

(2) プロトタイプ調整ツール層。design-reference HTML から持ち越された Tweaks パネル React island（`NT_applyTweaks`）、annotation-style プリセット（fill/gutter）、judgment-tone プリセット（calm/sharp）、accent-hue OKLCH remap（`applyAccent`）、番号付き finding-index リストは、`applications/frontend/src`（design-reference 除く）に対する grep で `NT_applyTweaks` / `applyAccent` / `finding-index` / `data-tone="calm"|"sharp"` / `data-annostyle="fill"|"gutter"` の consuming コード・CSS が 0 件であることを確認済み。一方 `page.tsx:355` には `data-annostyle="underline"` と `data-tone="standard"` がハードコードされており、これが現に出ているプロダクトのデフォルトである。プロトタイプ層は製品要件として spec 化されたことがなく、v2 spec の Non-goals（`docs/specs/pronunciation-feedback-v2.md:73-77`）も Phase 3 訓練画面・重い ML 本体を列挙するだけでこのツール層に言及しない。「どのレール構成が正準か」「プロトタイプ調整ツールは非プロダクトか」を所有する ADR は存在しない（ADR-001/004 は GOP 検出と connected-speech severity を所有し、レール構成は所有しない。ADR-012 は golden RVC を所有する）。

(3) 部分的なプレイヤー / メタデータ chrome。dock 波形は装飾的な `<i>` バー（`docs/specs/workspace-residuals.md:40` M-AB-d が「最低 10 本の `<i>` バー」と明示）、scrubbing/seek なし（同 `:57` S-AB-PARTIAL が Range 部分再生を Must 外として defer 済み）、compare 画面（`applications/frontend/src/app/materials/[materialIdentifier]/sections/[sectionIdentifier]/compare/page.tsx`）プレイヤーは `<audio>` 要素を持たない、engine メタデータ footer は latency/confidence の DTO フィールドを持たない（`applications/frontend/src/lib/api-types.ts:268` の `EngineFindingDto` は `scoreImpact:280` / `confidence:281` を持つが engine 単位の latency フィールドは無い）。いずれも低影響で record→analyze→result コア flow には無関係。

ADR-004 は「worker が scoring を所有し scoreImpact/ScoreSet 計算を持つ。presentation は frontend」と定める（`adr/004-scoring-policy-in-haskell-worker-structured-diff.md:27`）。本 ADR の決定は全て presentation/scope のみで、scoring locus・減点 allow-list（substitution/omission/insertion/epenthesis、同 :31）に触れない。

# Decision

**D1 — RailV2 + WorkspaceResultV2 を結果状態の唯一の正準レール構成とする。** `page.tsx:390` の結果状態（`state === "result" && activeResult`）は `WorkspaceResultV2`（内部で `RailV2` を `WorkspaceResultV2.tsx:524` でレンダリング）だけを描画する。v1 の `Gauge` / `ScoreRows` / severity-count-pills（`.sevpill`）が null の `activeResult` に gate された分岐（`page.tsx:442`/`:450` の `{activeResult && (...)}` を `state !== "result"` の `.ws-rail` else 内に置く形）からレンダリングされる経路を残さない。

**D2 — v1 Gauge/ScoreRows/sevpills を撤去する（削除を既定とする）。** `page.tsx:439` の `.ws-rail` 結果ブロック内の `{activeResult && (...)}` で囲まれた `Gauge`/`ScoreRows`/`.sevcount` markup を削除し、`page.tsx:17-18` の `Gauge` / `ScoreRows` import を除去する。`applications/frontend/src/components/workspace/Gauge.tsx`・`ScoreRows.tsx`・`Gauge.test.ts` と `index.ts:3-4` の export（`Gauge, calcGaugeDashOffset` / `ScoreRows`）を削除し、dead component を残さない。代替として「結果以外の状態（idle/recording/analyzing/failed）で live スコアを伴う summary を出したい」という要件は本 ADR スコープ外であり、その状態では `activeResult` が null なので Gauge を出す根拠（描画すべき score）が無い。流用（repurpose）を選ぶ場合に限り、Gauge/ScoreRows を live スコアで描画する非結果 summary に移し、その状態で live scores を伴って描画されることを assert するテストを追加する（このとき `{activeResult && ...}` を unreachable 分岐に置いてはならない）。既定は削除。

**D3 — プロトタイプ調整ツール層を非プロダクトと宣言する。** `data-annostyle="underline"`（`page.tsx:355`）と `data-tone="standard"`（同）を固定の正準プロダクトデフォルトとして文書化する。Tweaks パネル React island（`NT_applyTweaks`）、annotation-style プリセット fill/gutter、judgment-tone プリセット calm/sharp、accent-hue OKLCH remap（`applyAccent`）、番号付き finding-index / gutter モードは design-reference プロトタイプ chrome のみであり、プロダクト機能として実装しない。これらは gap ではなく非プロダクト境界の記録対象である。

**D4 — 部分的なプレイヤー / メタデータ chrome を accepted consequence として記録する。** 装飾的な波形 `<i>` バー（`docs/specs/workspace-residuals.md:40` M-AB-d）と scrubbing 不在は accepted。scrubbing/Range 部分再生は `workspace-residuals.md:57` S-AB-PARTIAL に委譲する（本 ADR で新規に作らない）。ここで対象とする audio プレイヤー不在は compare ルート（`applications/frontend/src/app/materials/[materialIdentifier]/sections/[sectionIdentifier]/compare/page.tsx`）の `<audio>` 不在であり、workspace dock 上の A/B（self/model/golden、ADR-022 D2 が `adr/022-...:60` で所有）とは別ルート・別所有である。compare 画面の audio プレイヤーと engine メタデータの latency/confidence フィールドは、本番経路に mock/stub/偽データを入れず、正直な非機能 / 不在状態を出すか、明示的に named future slice へ defer する（`docs/specs/pronunciation-feedback-v2.md:75` の「偽データ表示の禁止」方針に従う）。

**D5 — presentation-only / scoreImpact 不変。** 本 ADR の D1–D4 は全て presentation/scope のみ。worker の scoring locus（`adr/004-scoring-policy-in-haskell-worker-structured-diff.md:27`）・減点 allow-list（substitution/omission/insertion/epenthesis、同 :31）・per-finding `scoreImpact`（`api-types.ts:280`）は不変。severity→scoreImpact のマッピング（`applications/backend/src/NativeTrace/Worker/Scoring.hs:1285-1289` の `severityToScoreImpact`: Critical=-8.0 / Major=-5.0 / Minor=-2.0 / Suggestion=0.0）も不変。v1 レール撤去は描画する markup を変えるだけで、`activeResult.scores`（RailV2/WorkspaceResultV2 が消費する同じ EngineScores）・scoreImpact 計算には影響しない（ADR-004 不変）。

# Contract changes

本 ADR は presentation/scope 決定であり、cross-layer の型契約を新設・変更しない。明示的に次を記録する:

- **python schema（`applications/python-analyzer/src/python_analyzer/interface/schema.py`）**: 変更なし。本 ADR は analyzer 計測契約に触れない。
- **Haskell ToJSON（`applications/backend/src/NativeTrace/Worker/Types.hs` の `AssessmentFinding` ToJSON 等）**: 変更なし。worker の scoring/finding 契約に触れない。
- **TS api-types + zod（`applications/frontend/src/lib/api-types.ts` の `EngineFindingDto`:268 / `EngineScores`、`acl/pronunciation-assessment/oss-worker/schema.ts`）**: 変更なし。`EngineFindingDto.scoreImpact`（:280）・`confidence`（:281）、`EngineScores.cefrOverall/cefrSegmental/cefrProsodic`（:315-317）、`focusSounds`（:329）は既存のまま消費する。
- **意図的に追加しない契約**: engine メタデータの latency フィールド、compare プレイヤー用 audio handle、annotation-style/judgment-tone/accent プリセットを駆動する DTO フィールドは本 ADR で追加しない（D3/D4）。latency/confidence engine-metadata フィールドの将来追加可否は # Notes の open question として残す。

# Alternatives considered

- **A（採用）: v2 レール構成を正準と宣言し、v1 Gauge/ScoreRows/sevpills を削除して撤去、プロトタイプ調整ツール層を非プロダクトと明示宣言する。** Pros: dead-with-data な v1 レール（live データに配線されているのに描画不能、`page.tsx:438` のコメントが示す stale leftover）を消して二重メンテと混乱を排し、`docs/specs/pronunciation-feedback-v2.md:42`（M-WS）の v2 構成が唯一の正準になる。プロトタイプツール（grep 0 件確認済みの `NT_applyTweaks`/`applyAccent`/`finding-index`）が「未実装の gap」と将来再誤認されるのを止める。実装コストは markup 削除 + component/test 削除 + 非プロダクト境界の文書化のみで安価。Cons: 将来 idle/recording/analyzing/failed 状態に live スコア summary を出したくなった場合、Gauge/ScoreRows を再作成する必要がある（ただしその状態では `activeResult` が null で出す score が無く、再導入は新要件として別途設計すべき）。
- **B（不採用）: v1 レールを生かす — 結果状態でも v1 Gauge/ScoreRows/sevpills を RailV2 と並置レンダリングする、またはプロトタイプ調整ツール（Tweaks パネル/プリセット/accent remap）をプロダクト機能として実装する。** 検討理由: 既存の v1 markup と配線（`activeResult.scores` に繋がる Gauge/ScoreRows）がすでに存在するため、撤去せず生かせば削除作業ゼロで「結果状態でも数値サマリを出す」体験を即座に提供でき、design-reference の探索 chrome もそのまま使えるように見える。不採用理由: v1 と v2 のレールを並置すると同一スコアを 2 表現で出して `docs/specs/pronunciation-feedback-v2.md:42`（M-WS）の v2 正準と矛盾し、表示の二重管理を恒久化する。プロトタイプツールの実装は spec/ADR に製品要件が一切なく（grep 0 件・Non-goals 未記載）、build-only すべき仕様が存在しない（作る対象が無い）。design-reference の探索チューニング用 chrome をプロダクトに昇格させる根拠が無い。
- **C（部分採用）: プレイヤー / メタデータ partial を別 ADR で独立に扱う。** Pros: scrubbing・compare プレイヤー・latency/confidence は本決定（レール正準化）と関心が異なる。Cons: scrubbing/Range 再生は既に `workspace-residuals.md:57` S-AB-PARTIAL が所有・defer 済みで、新 ADR は所有を分散させるだけ。不採用理由: 部分採用。scrubbing は S-AB-PARTIAL へ委譲（既存所有を尊重）、compare プレイヤーと latency/confidence は本 ADR D4 の accepted consequence として記録し（独立 ADR を新設しない）、必要になった時点で named future slice として切り出す。

# Consequences

## Positive

- 結果状態のレール構成が RailV2 + WorkspaceResultV2 の 1 系統に正準化され、`page.tsx:438` の dead-with-data な v1 レールが消えて二重表現・stale markup の混乱が無くなる。
- プロトタイプ調整ツール（`NT_applyTweaks`/`applyAccent`/annotation・tone プリセット/accent remap/finding-index）が「非プロダクト境界」として明文化され、将来「未実装 feature gap」と再誤認されない。`data-annostyle="underline"` / `data-tone="standard"` が固定の正準デフォルトとして確定する。
- 全決定が presentation/scope のみで cross-layer 契約・scoring locus（ADR-004）・scoreImpact に一切触れないため、回帰リスクが markup 層に限局する。
- 削除（D2 既定）により dead component（Gauge/ScoreRows とそのテスト）が消え、コードベースの dead surface が減る。
- scrubbing は S-AB-PARTIAL に、partial プレイヤー chrome は accepted consequence に整理され、所有の重複なく低優先 residual が記録される。

## Negative

- v1 Gauge/ScoreRows を削除すると、将来 idle/recording/analyzing/failed 状態に live スコア summary を出したくなった場合に再作成が要る（ただし当該状態は `activeResult` が null で出す score が無いため、再導入は新要件設計を伴う別作業になる）。
- compare 画面 audio プレイヤーと engine latency/confidence メタデータは本 ADR で機能実装せず、honest 非機能/不在状態のまま残る（偽データ禁止方針の代償として「準備中」相当の体験が残る）。
- annotation-style/judgment-tone/accent プリセットを非プロダクトと宣言するため、design-reference にある探索的な見た目バリエーションはプロダクトでは選べない（固定デフォルトのみ）。

# Compliance

1. **受入（D1 唯一の正準レール）**: real entrypoint = workspace 結果画面（`page.tsx`）。観測可能 assert = grep が `page.tsx` の結果状態（`state === "result" && activeResult`、:390）で `WorkspaceResultV2`（→ `RailV2`）のみを描画し、`Gauge`/`ScoreRows`/`.sevpill` を `state !== "result"` の `.ws-rail` else 分岐内の `{activeResult && ...}`（現 :442/:450）に持つ経路が存在しないことを示す（v1 markup が削除済み、または非結果 summary へ移設済み）。
2. **受入（D2 dead component 撤去）**: 削除を選んだ場合、`applications/frontend/src/components/workspace/Gauge.tsx`・`ScoreRows.tsx`・`Gauge.test.ts` と `index.ts:3-4` の `Gauge`/`calcGaugeDashOffset`/`ScoreRows` export がリポジトリに存在しないこと（`ls` / grep で 0 件）。流用を選んだ場合、Gauge/ScoreRows が新しい非結果状態で live `activeResult.scores`（実データ）を伴って描画されることを assert する Vitest テストが存在し、`{activeResult && ...}` が unreachable 分岐に置かれていないこと。
3. **受入（D3 非プロダクト境界の機械確認）**: 観測可能 assert = `applications/frontend/src`（design-reference 除く）への grep が `NT_applyTweaks` / `applyAccent` / `finding-index` / `data-annostyle="fill"` / `data-annostyle="gutter"` / `data-tone="calm"` / `data-tone="sharp"` を 0 件返し、`page.tsx:355` の `data-annostyle="underline"` / `data-tone="standard"` のみが残る（固定デフォルト）。
4. **受入（D4 偽データ禁止）**: real entrypoint = compare 画面（`compare/page.tsx`）と engine メタデータ footer。観測可能 assert = compare 画面 audio プレイヤーと latency/confidence engine-metadata は本番経路に mock/stub/fake/dummy を持たず（`verify-no-prod-doubles.sh` green）、honest な非機能/不在状態を出すか named future slice へ defer されている。scrubbing/Range 部分再生は `workspace-residuals.md:57` S-AB-PARTIAL へ委譲され本 ADR で新規実装しない。
5. **受入（D5 scoreImpact 不変・presentation-only）**: real entrypoint = worker の ScoringSpec（`applications/backend/test/NativeTrace/Worker/ScoringSpec.hs`、対象ロジックは `applications/backend/src/NativeTrace/Worker/Scoring.hs` の `severityToScoreImpact`）/ frontend の既存 scoreImpact テスト。観測可能 assert = v1 レール撤去前後で per-finding `scoreImpact`（`api-types.ts:280`、Scoring.hs の Critical=-8.0/Major=-5.0/Minor=-2.0）と ScoreSet が不変（ADR-004 の scoring locus・減点 allow-list 不変）。レール撤去は presentation markup のみを変更し scoring に影響しない。
6. **受入（M-WS / M-AB-d / M-REGRESSION 緑維持）**: real entrypoint = Playwright `applications/frontend/e2e/workspace-v2.spec.ts`。観測可能 assert = `docs/specs/pronunciation-feedback-v2.md:68`（M-WS）が列挙する v2 セレクタ（`.mini-axis .ma`/`.subscale`/`.gopmap .gp`/`.ab-src.is-active`/`.phen .pe` 等）と `workspace-residuals.md:75`（M-AB-d）の `.player .wave i.on` / `.player .tt` が v1 撤去後も全て存在する。`pnpm typecheck` / `pnpm test` / 当該 Playwright spec が pass。
7. **agent-policy**: 本番経路に mock/stub/placeholder を入れない（`verify-no-prod-doubles.sh` / `verify-no-stub-placeholder.sh` green）。配線は real public entrypoint（workspace 結果画面・compare 画面・worker ScoringSpec）から到達可能で `verify-wiring.sh` green。`.agent-evidence/`（commands.txt / wiring-map.json / completion-report.md）を更新する。test-bypass（`NODE_ENV==='test'` 等）を本番経路に入れない。

# Notes

- Open questions:
  - engine メタデータの latency/confidence フィールドを将来追加するか、追加する場合どの層の契約に乗せるか（python schema / Haskell ToJSON / TS EngineFindingDto いずれか、または engine 単位の別 DTO）は未決。`EngineFindingDto` には finding 単位の `confidence`（`api-types.ts:281`）があるが engine 単位 latency フィールドは現状存在しない。本 ADR は追加しないと決め、追加可否は future slice の product 判断とする（open）。
  - compare 画面 audio プレイヤーを実装する named future slice の番号/名称は未定（open）。本 ADR は honest 非機能状態の維持のみ規定する。
  - D2 で削除と流用のいずれを採るかは実装時に確定する。本 ADR は削除を既定とし、流用は受入条件 2 のテスト追加を条件に許可する。
- Scope: 本 ADR は build ではなく retire/de-scope を記録する小規模 ADR（gap-register priority low）。新規に作る product feature は無い。
- Amends:
  - ADR-004: 変更なし（参照のみ）。本 ADR の全決定は presentation/scope であり、worker scoring locus・structured-diff・減点 allow-list・scoreImpact は不変。
- Depends on: ADR-004（scoring locus / scoreImpact 不変の根拠）。
- Author: lihs
- Approval date: （Proposed・未承認）
- Related: ADR-004（scoring locus・scoreImpact 不変）、ADR-001（GOP 検出、レール構成は非所有）、ADR-012（golden RVC、レール構成は非所有）、ADR-022（workspace dock A/B 所有、`adr/022-...:60`）。spec: docs/specs/pronunciation-feedback-v2.md（M-WS 正準 v2 部品 / Non-goals / 偽データ禁止）、docs/specs/workspace-residuals.md（M-AB-d 装飾波形 / S-AB-PARTIAL scrubbing 委譲先）。