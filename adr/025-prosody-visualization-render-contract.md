# Prosody visualization render contract (rhythm bands and stress overlay)

ADR-025: 韻律可視化のレンダー契約（リズムバンド + 強勢重畳）と「契約に乗る韻律フィールドは描画先か撤去計画を持つ」原則

# Status

Proposed

# Context

`ProsodyDto`（`applications/frontend/src/lib/api-types.ts:217-227`）は F0 輪郭以外に 3 つのリズム系プロダクトをワイヤ契約として end-to-end で運んでいる: `rhythmNpvi`・`referenceNpvi`・`weakFormRate`（api-types.ts:224-226）。これらは analyzer の `RhythmResponse`（`applications/python-analyzer/src/python_analyzer/interface/schema.py:109-115` の `npviVocalic` / `referenceNpviVocalic`、フィールドは schema.py:112-115）と弱形実現レスポンス（同 schema.py:121 `WeakFormRealizationResponse`）で計測され、worker の `ProsodyOutput`（`applications/backend/src/NativeTrace/Worker/Types.hs:472-484` の `prosodyRhythmNpvi` / `prosodyReferenceNpvi` / `prosodyWeakFormRate`、フィールドは Types.hs:480-483）の ToJSON（同 Types.hs:486-508、キー `rhythmNpvi` / `referenceNpvi` / `weakFormRate` は Types.hs:505-507）から frontend に渡り、ACL の zod schema（`applications/frontend/src/acl/pronunciation-assessment/oss-worker/schema.ts:256-272`）と response-mapper（同 response-mapper.ts:214-216）で `ProsodyDto` まで写像される。出所は REQ-114 / pronunciation-feedback-v2 M-114 の韻律計測である。

しかし、このリズム系プロダクト（nPVI-V・弱形実現率・話速）には**描画先がどこにも無い**。F0 輪郭（`f0Contour` / `referenceF0Contour`）は `F0Chart.tsx`（`applications/frontend/src/components/workspace/F0Chart.tsx`）が `path.f0-ref`（同 F0Chart.tsx:169）と `path.f0-learner`（同 F0Chart.tsx:172）として重ね描きし、`data-blind` トグル（同 F0Chart.tsx:115）も持つ（docs/specs/f0-reference-contour.md M-F0REF-a..e）。だが `F0Chart.tsx` は `f0-stress` / `f0-word` も `rhythm` バンドも一切描画しない。`F0Chart` の唯一の描画先は `WorkspaceResultV2.tsx:510`（`viewMode === \"f0\"` のとき `<F0Chart prosody={engineResult.prosody ?? null} />`）であり、ここがワークスペース F0 ビューの real public entrypoint である。

契約が UI に対して過剰供給している。`prosody.wordStress`（api-types.ts:221-223、`expectedStress` / `predictedStress`）も DTO に在りながら `F0Chart` は `f0-stress` ドットも `f0-word` ラベルも描かない。`docs/specs/f0-reference-contour.md` は Non-goals（同 spec line 62）で「F0 以外の韻律の重ね描き（intensity / duration / リズム nPVI）」を明示的に対象外とし、強勢マーカーは Should `S-F0REF-STRESS`（同 spec line 43）に留めている。

REQ-126 のデザイン（design-system-v3.html:644-658 / design-system-v2.html:627-641）は `.rhythm` バンド（design-system-v3.html:646）に `.rb`（参照バー、同:648-652）と `<em>`（英語参照マーカー）・`<i>`（学習者マーカー）、nPVI-V、話速 wpm、英語参照帯凡例を描く。だが**この描画契約を所有する ADR が無い**。ADR-013（`adr/013-shadowing-lag-measurement.md`）はシャドーイングのラグ計測のみにスコープされ、韻律タイムシリーズの描画は所有しない。ワイヤ契約に 3 フィールドを運びながら描画先ゼロ、という恒常的な過剰供給を解消するには、「サーフェスするか、契約から外すか」の明示判断が要る。

# Decision

ワークスペース F0 ビューの**韻律可視化レンダー契約**を以下の通り定める。本 ADR は描画専用（presentation-only）の決定であり、採点には一切関与しない。

1. **リズムバンドを既存 DTO フィールドからサーフェスする（撤去ではなくレンダー）。** `WorkspaceResultV2.tsx:510` から到達する F0 ビュー（`F0Chart` 配下、または `F0Chart` に隣接するワークスペース韻律セクション）が、`prosody.rhythmNpvi`（nPVI-V）・`prosody.weakFormRate`（弱形実現率）・話速（`wordStress` の語境界から導出するか、worker が運ぶ既存値があればそれ）を design-system-v3 の `.rhythm` / `.rb` 構造で描画する。新しい計測パスは作らない。値は `ProsodyDto` の既存フィールドだけから読む。

2. **各リズムバンドに General American 英語参照マーカーを併記する。** `referenceNpvi`（analyzer の `referenceNpviVocalic`、英語参照帯の代表値）を学習者値と並べて参照マーカー（design-system の `.rb > em`）として描く。弱形・話速の参照表現は契約に運ばれている参照値が在る範囲で描き、無いものは英語参照帯凡例の定性表現に留める（数値を捏造しない）。

3. **null/欠落時は正直な空状態に退化し、既存 F0 描画を退行させない。** あるリズムフィールドが `null`（旧 worker・抽出失敗）のとき、当該バンドは空/準備中の正直な状態を描き、`path.f0-learner`（F0Chart.tsx:172）・`path.f0-ref`（F0Chart.tsx:169）の既存描画は維持される。リズム描画の追加が F0 輪郭描画を壊してはならない。

4. **語強勢ドット / 語ラベルの重畳は既存 Should `S-F0REF-STRESS` を追跡するのみで、本 ADR は Must に昇格しない。** `prosody.wordStress` の `expectedStress` / `predictedStress`（api-types.ts:221-223）から `f0-stress` / `f0-stress--miss` ドットと `f0-word` 時刻ラベルを F0 チャート上に描くのは `docs/specs/f0-reference-contour.md` の Should `S-F0REF-STRESS`（同 spec line 43）である。これは spec 上 Should（必須でない）であり、本 ADR は当該 Should の所在を韻律レンダー契約の一部として**記録・追跡する**だけで、Must には昇格させない（昇格させる場合は別途 spec の Should→Must 改定と受入更新を要する）。本 ADR の必須受入は強勢ドットを含まない。

5. **REQ-125 評価スコープ・ディスクレーマをシャドーイング UI に描く（本 ADR が所有する NEW Must）。** 韻律のみ（リズム/ポーズ/話速、分節の細採点なし）のスコープ宣言文を、シャドーイングセクションに可視テキストとして描く。これは **build-only ではなく本 ADR が新規に所有する描画 Must である**。`docs/specs/training-screen.md` の M-TR-7(c)（training-screen.md:62）は「評価フォーカスがリズム/ポーズ/話速、分節の細評価をしない（REQ-125）」という*評価フォーカス制約*であって、UI へのスコープ宣言文の描画は要求していない。同 spec の `.scope-note` は M-TR-7(d) / 受入（training-screen.md:84）で「週次実施回数」のみを描くと定められ、実装（`applications/frontend/src/app/training/page.tsx:1415-1431`、コメントは M-SHL-4 由来）も週次回数だけを描く。本 Must が要求するスコープ宣言文は、その週次回数行とは別の可視テキストとして追加する新規描画である。

6. **「契約に乗る韻律フィールドは描画先を持つか、撤去計画を持つ」原則。** `ProsodyDto` に運ばれる韻律フィールドは、描画先（上記 1）を持つか、同一 PR で全 3 層（api-types.ts / worker Types.hs の ToJSON / ACL schema + response-mapper）から撤去されるか、のいずれかでなければならない。描画先ゼロのフィールドをワイヤ契約に残す過剰供給を本 ADR は禁ずる。本 ADR は (1)(2)(3) でサーフェスを選択するため、撤去経路は採らない。

7. **採点不変（ADR-004）。** 本 ADR の描画は presentation/advice のみであり、`scoreImpact`・aggregate `ScoreSet`・per-finding `severity` に一切寄与しない。connected-speech / weakForm 系所見が `scoreImpact = 0`（ADR-004 Decision 3）である不変は維持される。リズムバンド・スコープ文の追加で採点は変化しない。

# Contract changes

本 ADR は**ワイヤ契約に新規フィールドを追加しない**。既に 3 層に存在するフィールドへ描画先を与えるのが本決定の本質である。

- **python schema**（`applications/python-analyzer/src/python_analyzer/interface/schema.py`）: `RhythmResponse.npviVocalic` / `RhythmResponse.referenceNpviVocalic`（schema.py:112-115）、`WeakFormRealizationResponse`（schema.py:121-）、`WordStressResponse.expectedStress` / `predictedStress`（schema.py:100-103）。**変更なし**（計測のみ、measurement-only を維持）。
- **Haskell ToJSON**（`applications/backend/src/NativeTrace/Worker/Types.hs`）: `ProsodyOutput` の `prosodyRhythmNpvi` / `prosodyReferenceNpvi` / `prosodyWeakFormRate`（Types.hs:480-483）が ToJSON キー `rhythmNpvi` / `referenceNpvi` / `weakFormRate`（Types.hs:505-507）として既に出力される。`WordStressOutput`（宣言 Types.hs:455-460、ToJSON Types.hs:462-469）も同様。**変更なし**。
- **TS api-types + zod**（`applications/frontend/src/lib/api-types.ts` / `applications/frontend/src/acl/pronunciation-assessment/oss-worker/schema.ts`）: `ProsodyDto` の `rhythmNpvi` / `referenceNpvi` / `weakFormRate`（api-types.ts:224-226）と `wordStress`（api-types.ts:221-223）、対応する zod（schema.ts:256-272、`wordStress` は schema.ts:251-255）と response-mapper（response-mapper.ts:213-216）。**型・スキーマの変更なし**。本 ADR が追加するのは描画コンポーネント側の消費（render site）のみで、ワイヤ契約の型は不変。

撤去経路（採用しない代替、Decision 6 の対偶）を取る場合のみ、上記 3 層から `rhythmNpvi` / `referenceNpvi` / `weakFormRate` を削除する契約変更が発生する。本 ADR はサーフェスを選択したため、この削除は行わない。

# Alternatives considered

- **採用: リズムバンドをサーフェスし、本 ADR が韻律レンダー契約を所有する。** 既存の `rhythmNpvi` / `referenceNpvi` / `weakFormRate` を design-system-v3 の `.rhythm` / `.rb` 構造で描き、英語参照マーカーを併記する。理由: 3 フィールドは REQ-114 / M-114 で既に計測・契約配線され、REQ-126 デザインが描画レイアウトを定義済みで、描画先ゼロが唯一の欠落だった。新計測なしで欠落を閉じられ、ワイヤ契約のデッドフィールドも解消する。

- **不採用: `rhythmNpvi` / `referenceNpvi` / `weakFormRate` を 3 層から撤去し、描画先ができるまで契約に乗せない。** 理由: 計測は analyzer に既に存在し（schema.py:109-115）、REQ-114 / M-114 が計測 + 契約を要求している。撤去すると 3 層を削ってから再追加する往復になり、REQ-126 デザインが描画を要求している事実とも矛盾する。デッドフィールド解消という目的は「描画先を与える」ことでも達成でき、そちらの方が計測資産を捨てない。Decision 6 の撤去経路は「描画もせず計測も使わない」場合のフォールバックとしてのみ残す。

- **不採用: F0 輪郭オーバーレイにリズム/強勢を全部重ね描きする（単一 SVG に統合）。** 理由: `docs/specs/f0-reference-contour.md` Non-goals（同 spec line 62）が F0 チャートへの非 F0 韻律重畳（intensity/duration/nPVI）を明示的に対象外とし、F0 輪郭は F0 に限定する設計である。リズムは別バンド UI（design-system の `.rhythm`）として描くのが既存デザインの意図であり、強勢ドット（`f0-stress`）だけが F0 チャート上の重畳（S-F0REF-STRESS の Should）として許容される。混在は spec の Non-goal に反する。

# Consequences

## Positive

- ワイヤ契約のデッドフィールド（描画先ゼロの `rhythmNpvi` / `referenceNpvi` / `weakFormRate`）が解消し、「契約に乗る韻律フィールドは描画先か撤去計画を持つ」原則が機械検査可能になる。
- 新しい計測パス・新しい analyzer エンドポイントを足さずに、既存の計測資産（REQ-114 / M-114）をユーザーに見せられる。
- 採点（ADR-004 の scoreImpact / ScoreSet / severity）に一切触れないため、描画追加が採点を退行させるリスクが構造的に無い。
- REQ-125 評価スコープ宣言文（Decision 5、本 ADR 所有の Must）と、強勢ドットの追跡（S-F0REF-STRESS の Should、Decision 4）が ADR として整理され、追跡漏れを防ぐ。

## Negative

- リズムバンドの描画追加は frontend コンポーネント（`F0Chart.tsx` 近傍 / `WorkspaceResultV2.tsx` の F0 ビュー）の変更を要し、F0 輪郭描画を退行させない退行テストの追加コストがある。
- 弱形・話速の英語参照値が契約に運ばれていない場合、参照マーカーは nPVI-V のみ数値併記となり、他バンドは定性表現に留まる（数値捏造を避けるため）。参照値の契約拡張が将来必要になるかは Notes の Open question。
- 強勢ドット（Decision 4）は本 ADR では Should `S-F0REF-STRESS` の追跡のみで本 ADR の必須受入に含めないため、本 ADR 単独では強勢重畳は未実装のまま残りうる（Should の実装判断に依存）。

# Compliance

testable な受入条件（各々が real entrypoint + 観測可能 assert を名指す）:

1. **リズムバンドが既存 DTO フィールドから描画される。** `WorkspaceResultV2.tsx:510` の F0 ビュー（`viewMode === \"f0\"`）から到達するリズム UI が `prosody.rhythmNpvi` / `prosody.weakFormRate` を描く。vitest（`F0Chart` 近傍のユニット）または Playwright（`applications/frontend/e2e/`）で、下層の `rhythmNpvi` を変えるとバンド表示値が変わることを assert（固定値・合成値でないことを実 worker 出力形 fixture または live で確認）。新計測パスを足していないことを、analyzer schema（schema.py）と worker Types.hs に diff が無いことで確認。

2. **各リズムバンドに英語参照マーカーが併記される。** 同 F0 ビューで、`prosody.referenceNpvi` を学習者 `rhythmNpvi` と並べて参照マーカー（`.rb` 内の `em` 要素）として描くことを assert。

3. **null/欠落時の正直な退化 + F0 描画の非退行。** `prosody.rhythmNpvi = null` を渡すと当該バンドが空/準備中状態を描き、かつ `path.f0-learner`（F0Chart.tsx:172）が依然描画されることを vitest で assert（既存 F0 輪郭描画の退行なし）。

4. **REQ-125 評価スコープ・ディスクレーマの描画（本 ADR 所有の NEW Must）。** training 画面のシャドーイングセクションに、韻律のみ（リズム/ポーズ/話速、分節の細採点なし）のスコープ宣言文が、`applications/frontend/src/app/training/page.tsx:1415-1431` の週次セッション回数行とは別の可視テキストとして描かれることを Playwright で assert。この受入は本 ADR が新規に定義する観測可能挙動であり、training-screen.md の既存 Must（M-TR-7c/d）への build-only ではない。

5. **scoreImpact 不変（ADR-004）。** ポリシーテストで、リズムバンド・スコープ文の有無にかかわらず aggregate `ScoreSet` と per-finding `scoreImpact` が変化しないことを assert（connected-speech / weakForm 所見の `scoreImpact = 0` 不変、ADR-004 Decision 3 / Compliance）。

6. **デッドフィールド禁止原則。** `ProsodyDto` のリズムフィールド（`rhythmNpvi` / `referenceNpvi` / `weakFormRate`）が描画先を持つこと、または同一 PR で 3 層（api-types.ts / Types.hs ToJSON / schema.ts + response-mapper.ts）から撤去されることを、レビュー rubric が検査する。

（強勢ドット `f0-stress` / `f0-word` の描画は Should `S-F0REF-STRESS`（f0-reference-contour.md:43）の受入で確認されるべき項目であり、本 ADR の必須受入には含めない。Decision 4 の通り本 ADR は当該 Should を追跡するのみで Must には昇格しない。）

agent-policy（AGENTS.md）遵守:

- すべての Must は real public entrypoint（`WorkspaceResultV2.tsx:510` の F0 ビュー、training 画面のシャドーイングセクション）から観測可能挙動として到達・assert される。テストが緑なだけでは完了としない。
- 本番経路に mock / stub / fake / dummy / placeholder（`notImplemented` / `err501` 等）を入れない。リズム値は実 `ProsodyDto` フィールドからのみ読み、固定/合成値を本番描画に焼き込まない。
- `verify-no-prod-doubles` / `verify-no-stub-placeholder` / `verify-wiring` が green であること。描画専用 PR のため新規 wiring 点は frontend の App Router / コンポーネント配置のみ（worker / analyzer の配線追加なし）。
- `.agent-evidence/` の commands.txt / wiring-map.json / completion-report.md を更新し、F0 ビューのリズムバンド描画 + scope-note 隣接のスコープ宣言文描画の wiring を記録する。
- `pnpm fitness`（ast-grep + ESLint 依存方向）が green（Drizzle / OpenAI SDK / process.env の層閉じ込め、オニオン import 方向を維持）。

# Notes

- Author: lihs
- Approval date: （未承認）
- Approver:
- Last updated: 2026-06-19
- Changes: 初版。Related: ADR-004（採点ロケーション・scoreImpact 不変・connected-speech presentation-only の親 ADR。本 ADR の描画は presentation-only で採点不変）、ADR-013（`adr/013-shadowing-lag-measurement.md`、シャドーイングのラグ計測。韻律描画は所有せず、本 ADR が F0 ビューの韻律レンダー契約を所有して責務境界を補完）。Originating: REQ-114 / pronunciation-feedback-v2 M-114（韻律計測 + 契約）、REQ-125（シャドーイング + ラグ計測。training-screen.md:4/:62/:84）、REQ-126（韻律可視化デザイン）、docs/specs/f0-reference-contour.md（F0 輪郭 + S-F0REF-STRESS の Should）、docs/specs/training-screen.md（シャドーイング Must M-TR-7、`.scope-note` は週次回数）。design の正: design-system-v3.html:644-658（`.rhythm`:646 / `.rb`:648-652 / nPVI-V / 話速 wpm / 英語参照帯）、design-system-v2.html:627-641（同 prosody）。
- Open question（弱形・話速の英語参照値）: `referenceNpvi`（analyzer の `referenceNpviVocalic`）は契約に運ばれているが、弱形実現率（`weakFormRate`）と話速（wpm）の General American 英語参照代表値が契約に運ばれているかは未確定。運ばれていない場合、参照マーカーは nPVI-V のみ数値併記とし、他バンドは英語参照帯凡例の定性表現に留める（数値を捏造しない）。参照値の契約拡張が必要なら別途要件化する。
- Open question（話速 wpm の出所）: design-system は話速 wpm を `.rhythm` バンドに描くが（design-system-v3.html:651）、wpm を `ProsodyDto` のどのフィールドから導出するか（`wordStress` の語境界から frontend 計算するか、worker が別フィールドで運ぶか）は未確定。frontend での導出は新計測パスではなく既存契約フィールドからの表示計算に留める。
- Open question（リズムバンドの DOM 配置）: リズムバンドを `F0Chart.tsx` 内に置くか、`WorkspaceResultV2.tsx` の F0 ビュー直下の別セクションに置くかは実装判断。f0-reference-contour.md Non-goals（F0 チャートへの非 F0 重畳禁止、同 spec line 62）に反しないよう、リズムは F0 SVG とは別の `.rhythm` ブロックとして描く。
