# Finding-presentation refinements: confidence-register prose, out-of-pattern projection, articulatory descriptor

ADR-026: 所見提示の精緻化（confidence 3 段プロソ・パターン外射影・調音記述子）

# Status

Proposed

2026-06-19 起案（v3 design-gap-audit クラスタ `phenomenon-confidence-projection` の確定スコープより。confidence-register prose を ADR-004 の単一生成 locus と整合させる、out-of-pattern 射影、調音記述子の 3 件を本 ADR に確定。epenthesis 表示は ADR-017 の build-only として再決定しない）。

# Context

design-system-v3.html（§03 confidence・§05 NBest・phoneme-compare メタ行）は所見提示の精緻化を導入するが、現状実装はそれを部分的にしか満たしていない。所見提示の責務は ADR-004（structured-diff + frontend 単一パスの messageJa 生成）、ADR-017（epenthesis 挿入母音 + 位置）、ADR-021（任意の LLM 変換）に分かれており、以下の 3 点はどの ADR も決めていない。

1. **Confidence 3 段プロソ（confidence-tone-variants）。** design-system-v3.html §03 は high=断定「〜います」/ mid=通常「〜聞こえます」/ low=ヘッジ「〜可能性があります」の 3 つの異なる文体を意図する。現状は confidence を CSS の data-level に写すだけ（`DetailPanelV2.tsx:71` の `confidenceToLevel`、`:282` の `data-level={confidenceLevel}`）で、`messageJa` は worker/generator が埋めた文字列を `DetailPanelV2.tsx:490` で逐語表示する。band ごとの文体書き換えは存在しない。`confidenceToLevel`（`applications/frontend/src/lib/phenomenon.ts:73`、high≥0.75 / mid≥0.5 / low<0.5）はしきい値を持つが presentation 文体には使われていない。これは ADR-004 の Decision（`adr/004-scoring-policy-in-haskell-worker-structured-diff.md:29`「frontend の `ImprovementMessageGenerator` が `phenomenon` + `expected` + `detected` をキーに `messageJa` を埋める」単一生成 locus）に直接触れる新ポリシーである。

2. **Out-of-pattern 射影（nbest-projection-badge）。** design-system-v3.html §05 は混同セット外の検出（matchesL1Pattern=false）を `proj-badge--none`「典型パターン外」+ FL-low「なぜ重要度が低いか」カタログリンクで描く意図。現状 `DetailPanelV2.tsx:382` は `finding.matchesL1Pattern && finding.nBest && finding.nBest[0]` のときだけ `proj-badge`「日本語話者典型パターン」を描き、否定分岐とカタログリンクが無い。`matchesL1Pattern`（`api-types.ts:285`）と `nBest`（`api-types.ts:284`、要素型 `NBestCandidateDto` は `api-types.ts:189-192` で `{ phoneme: string; confidence: number }`）は既存の worker フィールドだが、否定分岐の提示は ADR-004/021 が決めていない。

3. **調音記述子 phon-meta（phoneme-compare-expected-detected）。** design は compare メタ行に調音記述子を載せる意図だが、`DetailPanelV2.tsx` の phon-meta（`期待` 側 `:339`・`検出` 側 `:349`）は `finding.expected.text` / `finding.detected.text`（= 単語）にバインドされ、`EngineFindingDto`（`api-types.ts:268-299`）に調音記述子フィールドが存在しない。ADR-018 の `acousticEvidence`（`api-types.ts:296`、`AcousticEvidenceDto` :238、方向ラベル + 実測/目標フォルマント）も ADR-019 の `articulatoryEstimate`（`api-types.ts:298`、`ArticulatoryEstimateDto` :258、EMA 座標）も per-finding の compare 行記述子ではない。

epenthesis 表示（ep-seg / ep-ins / epen-pos の分割 IPA マーカー）は ADR-017（D2/D4、`insertedVowel` `api-types.ts:290` + `insertionPositionMs` `api-types.ts:292`、`insertionPositionMs` は `response-mapper.ts:165` で `?? null` 配線済み）で既に決定済みであり、UI 描画が未実装なだけ。本 ADR では再決定せず、ADR-017 の build-out として受入条件に含める。参照グリッド（phenomenon-taxonomy-grid・traceability-chip-convention）と fb3 横変種は CSS/ドキュメントのみの pixel 適合項目で、本 ADR の意思決定対象ではない。

# Decision

**D1 — confidence-register プロソは presentation 層の変換であり、phonetics の再生成ではない（ADR-004 単一生成 locus を維持）。** `messageJa` / `feedbackLayers` の生成 locus は ADR-004 のまま frontend `ImprovementMessageGenerator`（`adr/004-scoring-policy-in-haskell-worker-structured-diff.md:29`）一箇所に保つ。`applyConfidenceRegister` は `ImprovementMessageGenerator` が**最終 `messageJa` を生成し終えた後段**で走り、ADR-004 の 3 レイヤ（catalogId + phenomenon + 音素対比 + 語内位置）を一切再導出せず、文末の確信度マーカー（〜います / 〜聞こえます / 〜可能性があります）のみを band で書き換える。confidence band → 文体（high=断定 / mid=通常 / low=ヘッジ）の写像は、生成済み `messageJa` に対する**決定論的な presentation-layer transform** として `applications/frontend/src/lib/phenomenon.ts` に純関数 `applyConfidenceRegister(messageJa: string, level: "high" | "mid" | "low"): string` を追加して実装する。`level` は既存 `confidenceToLevel`（high≥0.75 / mid≥0.5 / low<0.5）で導く。`DetailPanelV2.tsx:490` の逐語表示を `applyConfidenceRegister(finding.messageJa, confidenceLevel)` 経由に差し替える。low band の所見は既定で折りたたむ。折りたたみ状態は `DetailPanelV2` の per-finding collapsed state を `confidenceLevel === "low"` で初期化して駆動する（既存の `confidenceLevel`（`DetailPanelV2.tsx:71`）を初期値ソースに使う）。`ImprovementMessageGeneratorInput`（`applications/frontend/src/usecase/port/improvement-message-generator.ts:9`）には `confidence` フィールドを追加しない（生成器は confidence を知らないまま、変換は presentation で行う）。

**D2 — out-of-pattern NBest 射影を描画する。** `DetailPanelV2.tsx:382` の射影分岐を二分岐化する。`finding.matchesL1Pattern === true && finding.nBest?.[0]` のとき現行の `proj-badge`「日本語話者典型パターン」を**不変のまま**描く。`finding.matchesL1Pattern === false && finding.nBest?.[0]` のとき新たに `proj-badge--none` を描き、検出上位候補（`finding.detectedTopCandidate ?? finding.nBest[0].phoneme`、`api-types.ts:283-284`、`NBestCandidateDto.phoneme` は `api-types.ts:190` で確認済み）と「典型パターン外」ラベルを表示し、`feedbackLayers` の FL-low 文脈にエラーカタログ（`finding.catalogId`、`api-types.ts:287`）への「なぜ重要度が低いか」リンクを描く。`catalogId` が null のときリンクは描かない（honest-empty、偽リンクを出さない）。

**D3 — 任意 nullable な調音記述子フィールドを finding 契約に追加し、導出は worker static lookup に置く（presentation-only、scoreImpact 不変）。** worker 由来の `articulatoryDescriptor: string | null` を finding 契約に追加する。これは ADR-018 `acousticEvidence`（方向ラベル列挙）および ADR-019 `articulatoryEstimate`（EMA 座標）とは別物で、compare メタ行に載せる**人間可読な調音記述短文**（例「舌端歯茎接近音」）であり、採点（GOP / scoreImpact）に一切寄与しない。導出 locus は **worker（Haskell `Scoring.hs`/`Types.hs` の期待音素 IPA → 調音記述短文の static lookup）に確定する**。これは ADR-018 D5（方向ラベル等の派生は worker `Scoring.hs` が所有、analyzer は measurement-only）の precedent と整合し、ADR-005 の measurement-only 境界を侵さない（analyzer に新フィールドは追加しない）。`DetailPanelV2` の phon-meta は `articulatoryDescriptor` が非 null のときそれを描き、null のとき `expected.text` / `detected.text`（単語）にフォールバックする（word-text フォールバックは文書化された既定挙動）。

**D4 — epenthesis 分割 IPA 表示は ADR-017 の build-only として実装し、本 ADR で再決定しない。** 既に配線済みの `insertedVowel`（`api-types.ts:290`）+ `insertionPositionMs`（`api-types.ts:292`）から、`DetailPanelV2` に epenthesis 所見の分割 IPA マーカー（音素ごとの ep-seg、挿入母音の ep-ins）と位置ラベル（epen-pos）を描画する。これにより `insertionPositionMs` が UI で消費されない dead downstream field でなくなる。意思決定は ADR-017 のまま、本 ADR は build-out の受入条件のみを持つ。

# Contract changes

- **backend Types.hs AssessmentFinding**: `findingArticulatoryDescriptor :: Maybe Text` を record（`applications/backend/src/NativeTrace/Worker/Types.hs:341` の `data AssessmentFinding`）に追加し、ToJSON object（`Types.hs:384`）に `"articulatoryDescriptor" .= findingArticulatoryDescriptor finding` を加える（`acousticEvidence`/`articulatoryEstimate` の隣に並置）。export list（`Types.hs:11` の `AssessmentFinding (..)`）はワイルドカードなので追加不要。記述子は worker の static lookup（期待音素 IPA → 調音記述短文）で `Scoring.hs` の finding 組み立て経路（`buildGopFinding`、`Scoring.hs:559`/`613` 付近）で導出し、`severityToScoreImpact`（`Scoring.hs:1285-1289`、Critical=-8.0 / Major=-5.0 / Minor=-2.0 / Suggestion=0.0）と `severity` / `ScoreSet` の計算経路には一切影響させない（ADR-004 の scoring locus 不変、二重計上なし）。analyzer schema.py は変更しない（analyzer は per-finding response model を持たず raw measurement のみ返す。findings は worker が組む）。
- **frontend acl/pronunciation-assessment/oss-worker/schema.ts**: `findingSchema` に `articulatoryDescriptor: z.string().nullable().optional().transform((v) => v ?? null)` を追加（既存 `detectedTopCandidate`/`catalogId`/`insertedVowel`（`schema.ts:64-100` 付近）の optional+nullable+transform パターンに合わせる）。
- **frontend acl/pronunciation-assessment/oss-worker/response-mapper.ts**: `articulatoryDescriptor: finding.articulatoryDescriptor ?? null` を転写（`detectedTopCandidate`/`insertionPositionMs`/`acousticEvidence` の転写ブロック、`response-mapper.ts:151-182` と同様）。
- **frontend lib/api-types.ts EngineFindingDto**: `articulatoryDescriptor: string | null` を追加（ADR-018 `acousticEvidence` `api-types.ts:296` / ADR-019 `articulatoryEstimate` `api-types.ts:298` と同列の任意フィールド）。
- **frontend lib/phenomenon.ts**: 純関数 `applyConfidenceRegister(messageJa: string, level: "high" | "mid" | "low"): string` を新規追加（D1）。`confidenceToLevel`（`phenomenon.ts:73`）の戻り値型をそのまま受ける。`ImprovementMessageGeneratorInput`（`usecase/port/improvement-message-generator.ts:9`）は変更しない（confidence は presentation でのみ消費）。
- **frontend components/workspace/DetailPanelV2.tsx**: messageJa 表示（`:490`）を `applyConfidenceRegister` 経由に変更（D1）、射影分岐（`:382`）を `matchesL1Pattern` の二分岐に拡張（D2）、phon-meta（`:339`/`:349`）を `articulatoryDescriptor` 優先 + word-text フォールバックに変更（D3）、epenthesis 分割 IPA + 位置ラベルの描画を追加（D4）。

# Alternatives considered

- **A（採用）: confidence-register を生成済み messageJa への presentation-layer transform にする。** Pros: ADR-004 の単一生成 locus（`adr/004-scoring-policy-in-haskell-worker-structured-diff.md:29`、`ImprovementMessageGenerator` が messageJa を 1 箇所で埋める）を侵さない。文体調整は文末マーカーの決定論的な書き換えに閉じ、phonetics の再導出が無いので二重生成にならない。LLM/rule-based どちらの生成戦略（ADR-021）でも同一の変換が後段で効き、戦略非依存。Cons: 文末書き換えが機械的で、生成器が本来出した文末形（体言止め・名詞句終止）とマーカーが噛み合わないケースで不自然になる余地がある。
- **B（不採用）: confidence band ごとに messageJa を再生成する。** 生成器入力に confidence を渡し、band ごとに別文を生成する案。不採用理由: ADR-004 の単一パス生成 locus と衝突し、生成が confidence 依存で分岐すると phonetics（音素対比・How）まで band ごとに再導出され、worker structured-diff → frontend 単一生成という責務境界を崩す。文体差は presentation で表現でき、生成 locus を増やす正当性が無い。
- **C（採用）: 調音記述子を任意 nullable な新フィールドとして finding 契約に追加し、導出を worker に置く。** Pros: design の compare メタ行意図を満たし、phon-meta を単語ではなく調音記述にバインドできる。presentation-only で scoreImpact に寄与しないため ADR-004 の scoring 不変を保てる。worker static lookup は ADR-018 D5（派生は worker `Scoring.hs`、analyzer は measurement-only）と同型で ADR-005 境界を侵さない。null フォールバックで後方互換。Cons: cross-layer（Haskell ToJSON / TS api-types + zod + response-mapper）に新フィールドを 1 本通す配線コストがかかる。
- **D（不採用）: phon-meta を単語バインドのまま維持し調音記述子意図を破棄する。** 不採用理由: design-system-v3 の compare メタ行は調音記述を明示的に意図しており、単語の重複表示（phon-val が IPA、phon-meta が同じ単語）は情報量が低い。新フィールドは全層 optional+nullable で後方互換を保てるため、契約拡張の負担は許容できる。記述子は ADR-018/019 の証拠フィールドと役割が重複しない（acousticEvidence は方向ラベル、articulatoryEstimate は EMA 座標、本記述子は人間可読短文）ため、二重表現にならない。
- **D'（不採用）: 調音記述子の導出を analyzer に置く。** analyzer schema.py に記述子フィールドを追加する案。不採用理由: analyzer には per-finding response model が存在せず（`schema.py` は `AnalysisResponse` `:204` 配下の raw measurement のみを返す）、調音記述短文は音素からの派生でありノルム判定と同じく「測定」ではなく「導出」である。これを analyzer に置くと ADR-005 の measurement-only 境界と ADR-018 D5 の direction-derivation-in-worker precedent を崩す。導出は worker に置く（D3）。
- **E（採用・再決定なし）: epenthesis 分割 IPA 表示は ADR-017 の build-only。** ADR-017 D2/D4 が既に挿入母音 + 位置を契約化済み（`insertedVowel` / `insertionPositionMs` 配線済み）。本 ADR は描画の build-out を受入条件に持つだけで、契約・意思決定は ADR-017 のまま。

# Consequences

## Positive

- confidence の確信度が CSS の濃淡だけでなく日本語の文体（断定/通常/ヘッジ）にも反映され、low-confidence 所見が過度に断定的に読まれない。ADR-004 の単一生成 locus を侵さず presentation で完結するため、生成戦略（rule-based / LLM、ADR-021）に非依存。
- matchesL1Pattern の否定分岐が描かれ、「典型パターン外」の検出が射影バッジ + FL-low カタログリンクで提示される。肯定分岐（既存 proj-badge）は不変なので回帰しない。
- phon-meta が単語の重複表示から調音記述子に置き換わり、compare メタ行の情報量が上がる。記述子は presentation-only で scoreImpact に寄与しないので、GOP との二重計上が発生しない。ADR-018 acousticEvidence / ADR-019 articulatoryEstimate と役割が分離される。
- 配線済みだが UI 未消費だった `insertionPositionMs` が分割 IPA + 位置ラベルとして描画され、dead downstream field でなくなる。
- 新フィールド `articulatoryDescriptor` は全層 optional+nullable（worker ToJSON は `Maybe`、zod `.optional()`）なので、旧 worker と後方互換。

## Negative

- confidence-register transform は文末マーカーの機械的書き換えで、生成器が出した文の文末形がマーカーと噛み合わないケース（体言止め・名詞句終止）で不自然になる余地がある。calibratable な変換ルールとして残す。
- `articulatoryDescriptor` の static lookup（音素 → 調音記述短文）の網羅範囲が限定的で、未登録音素では null になり phon-meta が単語フォールバックに戻る。design の意図を全所見で満たすわけではない。
- cross-layer に新フィールドを 1 本通すため、Haskell Types.hs ToJSON + Scoring.hs 導出 / TS api-types + zod schema + response-mapper の各箇所を同時に更新する必要がある（後方互換は保つが配線点が増える）。
- low-confidence 所見の既定折りたたみは、ユーザーが low-confidence 所見を見落とす導線になりうる（折りたたみ見出しに件数を出すなど presentation 設計で緩和が必要）。

# Compliance

1. **Confidence-register（D1）— real entrypoint: `DetailPanelV2` レンダリング。** confidence が high band の finding は断定プロソ（例 文末「〜います」）、mid は通常（例「〜聞こえます」）、low はヘッジ（例「〜可能性があります」）で `messageJa` が描画され、low band の所見は既定で折りたたまれることを `DetailPanelV2` の component test で assert。band → register の写像は `applyConfidenceRegister` の unit test で決定論的（同入力同出力）であることを assert。生成 locus が ADR-004 のまま `ImprovementMessageGenerator` 一箇所であり、`ImprovementMessageGeneratorInput`（`usecase/port/improvement-message-generator.ts:9`）に confidence フィールドが追加されていない（変換は presentation 層のみ）ことを grep / 型で確認。
2. **scoreImpact 不変（ADR-004）— policy/contract test.** `applyConfidenceRegister` 適用前後および `articulatoryDescriptor` の有無で `finding.scoreImpact`（`api-types.ts:280`）が変わらないことを assert（confidence-register と調音記述子はいずれも presentation-only、GOP との二重計上なし）。worker 側 Scoring spec で `findingArticulatoryDescriptor` の有無が `severityToScoreImpact`（`Scoring.hs:1285-1289`）の出力・`severity`・`ScoreSet` を変えないことを assert。
3. **Out-of-pattern 射影（D2）— real entrypoint: `DetailPanelV2`.** `finding.matchesL1Pattern === false && finding.nBest?.[0]` の finding で `proj-badge--none`（「典型パターン外」+ 検出上位候補）が描かれ、`catalogId` が非 null のとき FL-low カタログリンクが描かれること、`catalogId` が null のときリンクが描かれない（偽リンク無し）ことを component test で assert。`finding.matchesL1Pattern === true` の肯定分岐（既存 `proj-badge`「日本語話者典型パターン」、`DetailPanelV2.tsx:382-391`）が不変であることを既存/追加 component test で assert（両分岐被覆）。
4. **調音記述子契約（D3）— contract test.** worker `AssessmentFinding` ToJSON（`Types.hs:384`）が `articulatoryDescriptor` キーを出し（非 null/null 双方）、frontend zod `findingSchema` が parse して `EngineFindingDto.articulatoryDescriptor` に転写されることを `applications/frontend/src/acl/pronunciation-assessment/oss-worker/__tests__/schema-and-response-mapper.test.ts` で assert。`DetailPanelV2` の phon-meta が `articulatoryDescriptor` 非 null のときそれを描き、null のとき `expected.text` / `detected.text`（単語）にフォールバックすることを component test で assert。
5. **Epenthesis 分割 IPA 表示（D4、ADR-017 build-only）— real entrypoint: `DetailPanelV2`.** epenthesis 所見（`phenomenon === "epenthesis"`、`insertedVowel` 非 null、`insertionPositionMs` 非 null）で分割 IPA マーカー（音素ごと ep-seg + 挿入母音 ep-ins）と位置ラベル（epen-pos）が描画され、`insertionPositionMs` が UI で消費される（dead field でない）ことを component test で assert。
6. **agent-policy — 決定論ゲート緑 + 証跡.** 全フィールドは real public entrypoint（App Router の workspace route → `DetailPanelV2`、worker→analyzer の HTTP 契約）から到達可能で観測 assert される。本番経路に mock/stub/fake/placeholder（`err501` / `notImplemented` / `NotImplementedError`）を入れない。`verify-no-prod-doubles` / `verify-no-stub-placeholder` / `verify-wiring` が緑であること、build/lint/typecheck/test 通過、`.agent-evidence/`（commands.txt / wiring-map.json / completion-report.md）更新を確認。runtime-verify は live worker→analyzer に実録音を通し `articulatoryDescriptor` と分割 IPA 描画を実出力で観測（unit fixture でなく実 worker 出力形、MEMORY『unit fixture は実 worker 出力形で書く』に従う）。

# Notes

- Amends:
  - **ADR-004**: structured-diff 契約に presentation-only の `articulatoryDescriptor`（人間可読調音記述短文、worker static lookup 由来）を追加。worker が scoring を所有し frontend が `messageJa` を単一パスで生成する分担は不変。confidence-register は生成済み `messageJa` への presentation-layer transform であって再生成ではないため、ADR-004 の単一生成 locus を侵さない。`articulatoryDescriptor` は減点に寄与しない（scoreImpact 不変・二重計上なし）。ADR-004 の現 Status は `Proposed` で Amendments 節（既存）を持つため、Status は変更せず Amendments 節に本 ADR を参照する bullet を追記する。
  - **ADR-017**: epenthesis 分割 IPA 表示（ep-seg / ep-ins / epen-pos）は ADR-017 D2/D4 の presentation tail の build-out であり、本 ADR は再決定せず受入条件として持つ。契約（`insertedVowel` / `insertionPositionMs`）は ADR-017 のまま不変。ADR-017 の現 Status は `Accepted`、build-only のため Status 変更は不要。
- 関連: ADR-018（`acousticEvidence` 方向ラベル、本記述子と役割分離。D5 の direction-derivation-in-worker precedent が本 ADR D3 の worker 導出 locus を支える）、ADR-019（`articulatoryEstimate` EMA 座標、本記述子と役割分離）、ADR-021（LLM 生成戦略、confidence-register transform は戦略非依存で後段に効く）、ADR-005（python-analyzer measurement-only 境界、本 ADR は analyzer を変更せず境界を保つ）。
- Open questions:
  - confidence-register transform の文末書き換え規則（体言止め・名詞句終止の扱い）の正規表現/形態素境界処理は calibratable とし、具体ルールは実装時に unit test で固定する（本 ADR では文末書き換えの具体正規表現を断定しない）。
- Depends on: ADR-004, ADR-005, ADR-017, ADR-018, ADR-019, ADR-021
- Author: lihs
- 起案日: 2026-06-19
