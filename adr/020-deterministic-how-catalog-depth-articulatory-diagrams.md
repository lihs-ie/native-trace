# Deterministic actionable How: catalog depth, canonicalized substitute matching, and real articulatory diagrams

ADR-020: How 層を具体化する決定論バックボーン — カタログ深化（現象×音素対立×実際の代替音）+ 既存 canonicalizePhoneme 再利用による括弧・エイリアス正規化突合 + 実在 SVG 調音図解

# Status

Proposed

2026-06-18 起票。ADR-021（LLM ナラティブ）/ ADR-022（finding 単位の閉ループ再録音）と同一バッチ（同一 PR / コミット）で提案する proposed sibling。本 ADR は rule+LLM ハイブリッドの決定論バックボーン（rule/catalog 側）を定義する。承認は実装スライス着手前にリポジトリオーナーが行う。ADR-018-022 は同一バッチ（同一 PR）で author 済みであり、本 ADR の dependsOn / amendsExisting が 019/021/022 を参照する箇所は同 PR で同時に land される sibling として解決される。

# Context

## 問題

3 層フィードバック（What/Why/How、ADR-004/REQ-104）の **How 層が actionable でない**。現状の決定論生成器
`applications/frontend/src/acl/improvement-message/rule-based/create-rule-based-improvement-message-generator.ts:171-179`
は、カタログの `articulation.stepsJa` を**現象・実際の代替音に関係なく無条件で `stepsJa.slice(0, 3)` で切って連結**している
（実コード確認済み: :174-176 `const steps = fallbackEntry.articulation.stepsJa; howJa = steps.slice(0, 3).join("。") ...`）。
学習者が実際に何の音を出したか（`detectedTopCandidate`）に分岐していない。

その結果、同じ `/l/` の置換でも、学習者が日本語の弾き音を出した場合と英語の接近音を出した場合とで
**まったく同じ How** を返す。両者は調音的に逆方向の修正を要する（弾き音 for `/l/` は側面気流の付与を教える必要があり、
接近音化した産出は別の指導を要する。Flege SLM / Best PAM により日本語話者は `/l/`・`/r/` を L1 弾き音に同化する —
調査 evidence 〔SLA 文献, area=catalog-depth〕）。

調査（area=deterministic How guidance backbone, area=finding-level closed loop）で確認した構造的欠陥:

- **D-1 dead data**: `detectedTopCandidate` は `EngineFindingDto`（`applications/frontend/src/lib/api-types.ts:249`）と
  `nBest`（同 :250）に既に存在し、`AssessmentFinding` ドメインモデルに格納され DB へ直列化される。`run-assessment-job/index.ts`
  でも `:639-641` で `findingDraft.detectedTopCandidate` / `.nBest` を参照して finding に詰めている（= scope 内）。しかし
  `:581-594`（`generate` 呼び出し）と `:597-614`（`generateFeedbackLayers` 呼び出し）の generator 入力オブジェクトは
  **`detectedTopCandidate` も `nBest` も渡していない**（実コード確認済み: 両呼び出しの入力は phenomenon/expected/detected/
  wordPositionLabel/catalogId/wordPair/expectedPronunciation/insertedVowel/insertionPositionMs まで）。全カタログ項目の
  `confusionSet` データは feedback 時点で完全に死んでいる。
- **D-2 /f/ 欠落**: `/f/` は `HIGH_PRIORITY_PHONEME_SET`（`applications/frontend/src/lib/articulation-data.ts`）と
  `ARTICULATION_DATA` に存在するが、`japanese-l1-catalog.json` に**カタログ項目がない**。`catalogId='f-*'` の finding は
  全て null フォールバックし汎用 How に落ちる。これは現に起きている correctness gap。
- **D-3 placeholder 図解**: `ArticulationCard.tsx:75-84` の `.artic-fig` は斜めストライプの
  「sagittal-diagram placeholder 320×320 · SVG」div を描くだけで実在の調音図解がない（REQ-105/M-105 未充足）。
- **D-4 lookup の実挙動**: `findCatalogEntry`（`domain/error-catalog/index.ts:157-179`）は **単一の `.find` で
  ディスジャンクション**（`entry.contrast === contrast || (entry.id.includes(phenomenon) && entry.contrast.includes(contrast))`）
  を評価する（実コード確認済み: :161-168）。`.find` は配列順で**いずれかの枝**を満たす最初の要素を返すため、配列上で前にある
  fuzzy 一致が、後ろにある厳密 contrast 一致より先に勝ちうる（= 「厳密一致を先に評価する順序」は存在しない）。カタログ拡張に伴い
  ある id が phenomenon 文字列の部分文字列を含むと誤エントリを shadow しうる latent bug（調査 risk）。

## 既存の canonicalize 解決策（本 ADR の突合はこれを再利用する）

リポジトリは**既にこの括弧・エイリアスのギャップを橋渡しする実装を持っている**。
`applications/frontend/src/usecase/complete-diagnostic-session/index.ts:188-209`:
- `normalizeIpaSymbol`（:188-189）: 角括弧 `[ ]` とスラッシュ `/ /` を除去して比較用に正規化。
- `PHONEME_ALIASES`（:198-201）: `ɹ→ɾ`、`r→ɾ` を解決するエイリアスマップ。
- `canonicalizePhoneme`（:206-209）: 括弧除去 + エイリアス解決。
- コメント :184-186 が明記: 「catalog confusionSet は "[ɾ]" 形式 … worker の detectedTopCandidate は括弧なし形式」。

**worker は detectedTopCandidate を括弧なしの bare IPA 記号で出す**（検証済み:
`applications/backend/test/NativeTrace/Worker/ScoringSpec.hs:296,303` が `nBestPhoneme = "ɾ"` /
`findingDetectedTopCandidate f == Just "ɾ"` を assert、`Scoring.hs` は wav2vec2 語彙トークン `ɾ`/`ɹ`/`l` をそのまま使う）。
一方カタログ `confusionSet` キーは**括弧付き** `"[ɾ]"`（`japanese-l1-catalog.json:7,30`）。したがって bare `ɾ` と `[ɾ]` の
生文字列を比較しても**決して一致せず**、括弧除去 + エイリアス解決の canonicalize を経て初めて突合できる。本 ADR の突合ロジックは
この既存 `canonicalizePhoneme` を共有モジュールに昇格して再利用し、独自の生文字列一致は導入しない。

## 制約

- ドメイン純粋性（`domain/error-catalog/index.ts` は I/O なし、JSON は import 読み）。`ArticulationGuide` の
  `stepsJa` は flat array なので、後方互換な optional フィールド追加で拡張する（既存 17 項目を壊さない）。
- agent-policy: prod に stub/mock を入れない。LLM 側は ADR-021（同一バッチ sibling）が所有し、本 ADR の決定論バックボーンは
  ADR-021 の deterministic fallback そのもの（real production code）。
- 教育効果の根拠: 調音指導は知覚訓練と併用したときに価値がある。**静的調音図解は音響の併置が前提**
  （Kocjancic et al. 2025: 視覚的調音情報は同時併置される音響信号なしには独立した効果の証拠がない —
  調査 evidence 〔E-13 候補, area=SLA evidence〕）。本 ADR の UI 決定はこの制約に従う。
- 図解アセットのライセンス: 商用利用可能な開放ライセンスに限る。SeeingSpeech / Dynamic Dialects は
  CC BY-NC のため**バンドル不可**（調査 risk）。

## 何が本 ADR をトリガーするか

ユーザー決定（grill ロック）: HOW-GENERATION = 決定論 rule/catalog バックボーン + ユーザーの実録音に
合わせた LLM ナラティブ。本 ADR はその rule/catalog バックボーンの深化を担当する。

# Decision

**D0 — 既存 `canonicalizePhoneme` / `normalizeIpaSymbol` / `PHONEME_ALIASES` を共有モジュールに昇格する。**
現在これらは `usecase/complete-diagnostic-session/index.ts:188-209` にローカル定義されている。新規ファイル
`applications/frontend/src/domain/error-catalog/phoneme-canonicalization.ts`（ドメイン純粋、I/O なし）に
`normalizeIpaSymbol` / `PHONEME_ALIASES` / `canonicalizePhoneme` を移し export する。`complete-diagnostic-session`
はこの共有モジュールから import するよう書き換える（挙動不変、純粋な move + re-export。既存テストはそのまま緑であること）。
これにより catalog 突合と diagnostic 突合が**同一の正規化規則**を共有し、表記揺れ・エイリアスの二重実装を防ぐ。

**D1 — `ImprovementMessageGeneratorInput` に `detectedTopCandidate` と `nBest` を追加し、両呼び出し点で配線する。**
`applications/frontend/src/usecase/port/improvement-message-generator.ts` の `ImprovementMessageGeneratorInput` に
`detectedTopCandidate?: string | null`（worker が出す **bare IPA 記号**。例 `"ɾ"`、`"[ɾ]"` ではない）と
`nBest?: ReadonlyArray<{ phoneme: string; confidence: number }> | null`（同じく bare 記号）を追加する。
`run-assessment-job/index.ts:581-594`（`generate` 呼び出し）と `:597-614`（`generateFeedbackLayers` 呼び出し）の両方に
`detectedTopCandidate: findingDraft.detectedTopCandidate ?? null` と `nBest: findingDraft.nBest ?? null` を渡す
（`findingDraft.detectedTopCandidate` / `.nBest` は同関数の :639-641 で既に参照済み = scope 内）。
port のシグネチャ（`generate`/`generateFeedbackLayers`）は不変。

**D2 — `ArticulationGuide` に `substituteVariants` を追加し、How を canonicalize 済み代替音で分岐させる。**
`domain/error-catalog/index.ts` の `ArticulationGuide` 型に
`substituteVariants?: Readonly<Record<string, ReadonlyArray<string>>>` を追加する。
**キーは canonical bare 形式**（例 `"ɾ"`、`"l"`。`"[ɾ]"` ではない）とし、値はその代替音に固有の修正 step 配列とする
（optional、既存 17 項目は無変更で valid）。`parseEntry`（同 :108-124）を拡張し、`articulation.substituteVariants` が存在すれば
`Record<string, string[]>` として検証（各値が string array、各キーが string）。

ACL `create-rule-based-improvement-message-generator.ts` の howJa 組み立て（:171-199）を以下に置換する:

```
1. fallbackEntry を解決（catalogId 優先、なければ findCatalogEntry）。
2. steps = findStepsForSubstitute(fallbackEntry, input.detectedTopCandidate)（D4 のヘルパ）。
   - detectedTopCandidate を canonicalizePhoneme で正規化し、substituteVariants の各キーも
     canonicalizePhoneme で正規化したうえで照合する。一致すればそのバリアント step 配列。
   - 一致しない / detectedTopCandidate=null / substituteVariants 不在なら articulation.stepsJa。
3. howJa = steps.slice(0, 3).join("。") + (steps.length > 3 ? "。…" : "")（既存の組み立て規則を踏襲）。
```
これにより、worker が bare `ɾ` を出しても canonicalize により catalog の `ɾ` キーへ正しく到達し、
弾き音 for `/l/`（側面気流付与）と弾き音 for `/r/`（D3 の `/r/` 制約参照）が別の How を出す。
**生文字列の完全一致や部分一致は使わない — canonical 形式同士の等価比較のみを使う。**

**D3 — `l-r-substitution` と `r-substitution` に `substituteVariants` を埋め、欠落の `/f/` 項目を追加する。**
`japanese-l1-catalog.json`（**キーは canonical bare 形式**で記述する。confusionSet は表示用に bracketed のままだが、
substituteVariants のキーは突合用に bare とする — 突合時に両辺を canonicalize するので bracketed でも動くが、キーの意図を
明確にするため bare で書く）:
- `l-r-substitution`（`/l/`、confusionSet=`["[ɾ]"]`）の `articulation.substituteVariants` に
  `"ɾ"` キーで「舌先を歯茎にしっかり当て、両脇から息を流す（側面気流）」を主軸とする step 配列を足す。
- `r-substitution`（`/r/`、confusionSet=`["[ɾ]","[l]"]`）の `substituteVariants` に
  **`"ɾ"` キー1つ**（舌先を一切接触させず後退・舌中央を盛り上げる、弾き接触を解除する）を足す。
  **重要な制約（D3 限界）**: `PHONEME_ALIASES`（`ɹ→ɾ`、`r→ɾ`、D0 で共有）により、英語の接近音 `ɹ` と日本語の弾き音 `ɾ`、
  ラテン文字 `r` は**すべて canonical `ɾ` に collapse する**。したがって detectedTopCandidate からは「英語 [r] 接近音を
  出したか日本語 [ɾ] 弾き音を出したか」を区別できない。`r-substitution` の `"ɾ"` バリアントは「弾き接触の解除 = 舌先を
  歯茎に当てない」という、両ケースに共通して有効な修正を主軸にする。`[l]`（側面音化）の区別はこの canonical 化では
  detectedTopCandidate から復元できないため、`"[l]"` 専用バリアントは**作らない**（catalog の confusionSet には表示用に
  `[l]` を残すが、substituteVariants には `"l"` キーを足さない）。この限界は `l1MechanismJa` / Notes に明記する。
- 新規エントリ `f-h-substitution` を追加: `kind="segmental"`, `targetPhoneme="/f/"`,
  `contrast="/f/-/h/"`, `confusionSet=["[h]","[ɸ]"]`, `functionalLoad="mid"`,
  `intelligibilityImpact="mid"`, `recommendedTraining=["articulation","perception"]`,
  `evidenceStrength="mid"`, `evidenceIds=["E-8"]`, `l1MechanismJa`（日本語は `/h/` が `/u/` 前で `[ɸ]`
  となり唇歯摩擦 `/f/` が体系にない、ことを記述）, `articulation`（既存 `ARTICULATION_DATA` の `/f/` step を流用、
  `/v/` 項目の構造をミラー）。

**D4 — `findStepsForSubstitute` ヘルパを追加し、突合を canonical 等価比較に閉じる。`findCatalogEntry` の挙動は正しく記述する。**
`domain/error-catalog/index.ts` に新規 export
`findStepsForSubstitute(entry: ErrorCatalogEntry, detectedTopCandidate: string | null): ReadonlyArray<string>` を追加する:
- `entry.articulation` が null または `substituteVariants` 不在、または `detectedTopCandidate` が null なら
  `entry.articulation?.stepsJa ?? []` を返す。
- それ以外は `const c = canonicalizePhoneme(detectedTopCandidate)` を計算し、`substituteVariants` のキー集合を
  各々 `canonicalizePhoneme` で正規化したマップ上で `c` を引く。**一致すればバリアント step、なければ `stepsJa`。**
  これは canonical 形式同士の等価比較であり、部分一致でも生文字列一致でもない。

`findCatalogEntry` 本体（:157-179）については、本 ADR は**新たな substitute step 選択経路（D2/D4）を追加するだけで、
既存 lookup の選択順序は変えない**。本 ADR は「`findCatalogEntry` が厳密一致を先に評価する」とは**主張しない**
（実態は単一 `.find` のディスジャンクションで、配列順に first match を返す — Context D-4 参照）。substitute ベースの
step 選択は `findStepsForSubstitute` という**独立した追加経路**に閉じ、`findCatalogEntry` の fuzzy `id.includes` 挙動には
依存しない。`findCatalogEntry` の latent shadowing bug 自体の修正は本 ADR スコープ外（別 issue 候補として Notes に記録）だが、
本 ADR の substitute 突合はそのバグの影響を受けない（canonical 等価比較に閉じているため）。

**D5 — placeholder を実在の開放ライセンス SVG 調音図解で置換する。**
`applications/frontend/public/assets/sagittal/` を新設し、CC0 の Wikimedia Commons "Sagittal sections"
SVG（Richard Wright & Dan McCloy / UW Linguistics, CC0 — 調査 evidence で確認済み）を格納する。確認済みで入手可能:
`theta.svg`（/θ/）, `eth.svg`（/ð/）, `f.svg`（/f/）, `ae.svg`（/æ/）, `i.svg`, `a.svg`。
`i.svg` は `/iː/` と `/ɪ/` の**近似 proxy**（調査では `/ɪ/` 専用の正確な CC0 SVG が確認できておらず、`i.svg` は近似であることを
UI ラベル / SVG コメントに明示する）。`a.svg` は `/ɑ/` と `/ʌ/` の近似 proxy。CC0 SVG が**存在しない** `/r/`（英語
retroflex/bunched approximant、Wikimedia の `ʁ` は uvular 摩擦音で別音のため使用禁止 — 調査 risk）, `/l/`, `/v/` は、
本リポジトリで線画 SVG を自作し同ディレクトリに置く（`r.svg`, `l.svg`, `v.svg`）。`/ə/` は専用 `schwa.svg` を自作
（`a.svg` を流用しない）。各 SVG の先頭に出典・ライセンス・作者のコメントを埋める。

`articulation-data.ts` の `ArticulationEntry` 型に `sagittalSvgPath?: string`（例 `/assets/sagittal/l.svg`）を追加し、
各 `ARTICULATION_DATA` 項目に解決済みパスを設定する。`ArticulationCard.tsx:75-84` の placeholder div を
`entry.sagittalSvgPath ? <img src={entry.sagittalSvgPath} alt={`/${entry.phoneme}/ の調音断面図`} /> :`
従来 placeholder の条件描画に置換する（アセット未配置の音素は placeholder にフォールバック = 後方互換）。
図解は**必ず TTS 音声と併置**する（既存 `ArticulationCard.tsx:118-159` の `.artic-audio` ブロックが TTS を併置済み）。
Kocjancic 2025 の「音響併置なしには証拠なし」制約を満たす。

**D6 — catalog coverage 単体テストと substituteVariants 整合テストを追加する。**
`HIGH_PRIORITY_PHONEME_SET` の各音素に対応するカタログ項目（`targetPhoneme` 一致）が存在することを assert
（D-2 の /f/ 欠落を write-time に検出）。さらに各項目の `substituteVariants` のキーを `canonicalizePhoneme` で正規化したものが、
当該項目 `confusionSet` を `canonicalizePhoneme` で正規化した集合の部分集合であることを assert（孤児バリアント防止 +
括弧揺れの早期検出）。

**D7（D2/D4 の sibling・2026-06-19 追補）— live な決定論 How-branch を feedback UI に分岐カードとして surface する。**
D2/D4 の決定論 How-branch（`canonicalizePhoneme` → `substituteVariants` → `findStepsForSubstitute`、matched detectedTopCandidate vs null/保守フォールバック）は既に実装・配線済みであり、結果 `howJa` は `applications/frontend/src/components/workspace/DetailPanelV2.tsx:424`（fb3 fix 行 `{finding.feedbackLayers!.howJa}`）に**単一の render site として**描画されている。`ArticulationCard.tsx`（Screen 13）は finding 由来の howJa を一切描画せず、静的 articulation-data 由来の `entry.steps` を `.artic-steps` ol（`ArticulationCard.tsx:371-372` の `entry.steps.map(...)`）で描画する別経路であり、D7 の配線対象ではない。本追補は **DetailPanelV2 の How 描画を視覚的に説明可能にする presentation 決定**を D2/D4 の sibling として加える。design-system-v3 の分岐 UI クラス `.canon-note` / `.cn-eq` / `.how-variant` / `.hv-detected` / `.hv-canon` / `.is-matched` は `applications/frontend/src/app/design-components.css:1133-1142` に **CSS だけ存在し JSX 描画先がゼロ**（src 配下に render site なし、確認済み）。D7 はこれらを DetailPanelV2 で活配線する。

**新しい分岐ロジックも新データも新 DTO フィールドも導入しない（D7 の硬い境界）。** UI が surface する値は全て finding DTO に既に届いている入力から再導出する:
- detected 記号: `finding.detectedTopCandidate`（`applications/frontend/src/lib/api-types.ts:283`、worker の bare IPA）。
- canonical 形: `canonicalizePhoneme(finding.detectedTopCandidate)`（`applications/frontend/src/domain/error-catalog/phoneme-canonicalization.ts:38` の共有 export、D0）。
- matched/fallback バリアントとその stepsJa: `findStepsForSubstitute(findCatalogEntryById(finding.catalogId), finding.detectedTopCandidate)`（`applications/frontend/src/domain/error-catalog/index.ts:234` / 同 :219、finding DTO の `catalogId` は `api-types.ts:287`）。これは generator が D2 で How を組み立てるのに使うのと**同一の backbone 関数・同一の入力**であり、UI は同じ入力で同じ関数を呼ぶだけで再生成しない。
- 制約注記: 当該カタログ項目の `l1MechanismJa`（`domain/error-catalog/index.ts:41`、r-substitution は `data/japanese-l1-catalog.json:39`）。`ɹ`/`r`/`ɾ` が canonical `ɾ` に collapse し英語接近音と日本語弾き音を区別できない限界（本 ADR の Negative :216 / Notes :235 で既出）を UI のハードコード文字列ではなく catalog 由来文で描画する。

**UI は `howJa` 文字列を経由しない。** D7 の UI は `finding.detectedTopCandidate` / `finding.catalogId` から `findStepsForSubstitute` を直接呼んで matched variant を再導出する。ADR-018 D6 / M-APD-16（`create-rule-based-improvement-message-generator.ts:281-288` で acousticEvidence 非 null 時に `howJa` を articulatory テキストで上書き）により最終 `howJa` 文字列は必ずしも variant stepsJa と一致しないため、UI の matched variant は generator が D2 で使う `findStepsForSubstitute` の入力（detectedTopCandidate / catalog entry）と同一であることのみを保証し、最終 `howJa` 文字列との一致は保証も assert もしない。

`detectedTopCandidate=null` のときは how-variant カードを出さず、現行の単一 howJa fix-row 表示（`DetailPanelV2.tsx:424`）へ後方互換フォールバックする（孤立した空 how-variant カードを描かない）。本追補は presentation 専用であり、worker の scoring・ScoreSet・`severityToScoreImpact`（`applications/backend/src/NativeTrace/Worker/Scoring.hs:1285`、Critical=-8.0/Major=-5.0/Minor=-2.0）・detectedTopCandidate/nBest の wire 契約・catalog データ・D0〜D6 のいずれも変更しない。ADR-004 の messageJa=null 方針と scoreImpact は不変。

D7 の Alternatives（采否）:
- **採用 — How-branch markup の配線先を DetailPanelV2 単独に絞る。** finding 由来 howJa の render site は `DetailPanelV2.tsx:424` のみであり、ここが How 層の唯一の finding-derived 描画点。CSS-only 孤児クラスを実 finding 値で活配線する最小整合。
- **不採用 — ArticulationCard（Screen 13）にも同 markup を配線する。** ArticulationCard は finding 由来 How を持たず静的 `entry.steps` を描く別データ源（`ArticulationCard.tsx:371-372`）。ここに how-variant カードを足すと finding-derived な再導出経路と静的 articulation-data 経路が二重化し、How 層の単一情報源が崩れる。不採用理由: 配線先二重化と情報源分裂を避ける。Screen 13 で finding 由来 variant を出す必要が将来生じたら別 ADR で扱う。

# Contract changes

- **frontend domain/error-catalog/phoneme-canonicalization.ts — NEW shared module**: move `normalizeIpaSymbol` / `PHONEME_ALIASES` (`ɹ→ɾ`, `r→ɾ`) / `canonicalizePhoneme` from usecase/complete-diagnostic-session/index.ts:188-209 into this domain-pure module and export them. complete-diagnostic-session imports from here (behavior-preserving move). catalog 突合と diagnostic 突合が同一正規化規則を共有する。
- **frontend usecase/port/improvement-message-generator.ts — ImprovementMessageGeneratorInput**: add `detectedTopCandidate?: string | null`（worker が出す BARE IPA 記号。例 "ɾ"、"[ɾ]" ではない）and `nBest?: ReadonlyArray<{ phoneme: string; confidence: number }> | null`（同じく bare 記号、ADR-021 の LLM 接地でも使用）。port の generate/generateFeedbackLayers シグネチャは不変。
- **frontend usecase/run-assessment-job/index.ts:581-594 and :597-614**: 両 generator 呼び出しの入力オブジェクトに `detectedTopCandidate: findingDraft.detectedTopCandidate ?? null` と `nBest: findingDraft.nBest ?? null` を追加（findingDraft の両フィールドは同関数 :639-641 で既に参照され scope 内）。
- **frontend domain/error-catalog/index.ts — ArticulationGuide type**: add optional `substituteVariants?: Readonly<Record<string, ReadonlyArray<string>>>`（key = CANONICAL BARE IPA 記号 例 "ɾ"、"[ɾ]" ではない。value = 代替音固有の修正 step 配列）。parseEntry に検証分岐を追加（存在すれば各値 string[]、キー string）。既存 17 項目は無変更で valid。
- **frontend domain/error-catalog/index.ts — new export findStepsForSubstitute**: add `findStepsForSubstitute(entry: ErrorCatalogEntry, detectedTopCandidate: string | null): ReadonlyArray<string>` — detectedTopCandidate を canonicalizePhoneme で正規化し、substituteVariants の各キーも canonicalizePhoneme で正規化したうえで等価比較。一致すればバリアント step、なければ stepsJa。生文字列一致・部分一致は使わない。
- **frontend domain/error-catalog/data/japanese-l1-catalog.json**: (a) l-r-substitution.articulation.substituteVariants に canonical "ɾ" キー追加（側面気流付与 step）。(b) r-substitution.articulation.substituteVariants に canonical "ɾ" キー1つ追加（弾き接触解除 step）。PHONEME_ALIASES が ɹ/r/ɾ を ɾ に collapse するため [l] 専用バリアントは作らない（detectedTopCandidate から復元不能、l1MechanismJa/Notes に明記）。(c) 新規エントリ f-h-substitution（targetPhoneme="/f/", contrast="/f/-/h/", confusionSet=["[h]","[ɸ]"], functionalLoad="mid", intelligibilityImpact="mid", evidenceIds=["E-8"], articulation は articulation-data.ts の /f/ step を流用）。
- **frontend lib/articulation-data.ts — ArticulationEntry type**: add optional `sagittalSvgPath?: string`（例 "/assets/sagittal/l.svg"）。各 ARTICULATION_DATA 項目に解決済みパスを設定。
- **frontend public/assets/sagittal/ — new asset directory**: CC0 Wikimedia SVG（theta.svg, eth.svg, f.svg, ae.svg, i.svg[=/iː/と/ɪ/の近似proxy], a.svg[=/ɑ/と/ʌ/の近似proxy]）+ 自作線画 SVG（r.svg, l.svg, v.svg, schwa.svg）。各ファイル先頭に出典・ライセンス・作者コメント。
- **frontend components/workspace/ArticulationCard.tsx:75-84**: placeholder div を `entry.sagittalSvgPath ? <img src alt> : placeholder` の条件描画に置換。TTS 併置（既存 .artic-audio :118-159）を維持。
- **NOTE: backend Haskell Types.hs / python-analyzer schema.py**: 本 ADR では変更なし。detectedTopCandidate（bare IPA）/ nBest は worker から既に EngineFindingDto まで届いている（api-types.ts:249-250、worker は ScoringSpec.hs:303 の通り bare "ɾ" を出す）。本 ADR は frontend 内の死配線を活かし frontend 内 canonicalize で突合するのみで wire 契約は不変。

# Alternatives considered

- **Option A: 最小 — detectedTopCandidate を入力に通し、catalog に substituteVariants（代替音キーの step 配列）を足す。突合は既存 canonicalizePhoneme で正規化** — Pros: スコープが小さく後方互換で、howJa を実際の代替音に応じて分岐させ confusionSet の dead data を活かせる。突合は生文字列一致ではなく既存 canonicalizePhoneme（括弧除去 + エイリアス解決）を共有モジュール化して再利用するため、bare worker 出力 `ɾ` と bracketed catalog キー `[ɾ]` が正しく一致する。/f/ 欠落の修正と図解アセットを別 D で足す。Cons: なし。不採用理由: 棄却しない — これを Decision の中核として採用する。
- **Option A': substituteVariants のキーを bracketed のまま保持し、detectedTopCandidate を bracketed 生文字列で完全一致させる（正規化なし）** — Pros: 実装が単純に見える。Cons: worker は bare `ɾ` を出し catalog キーは bracketed `[ɾ]` なので生文字列完全一致は決して発火せず、バリアント分岐が常に汎用 stepsJa にフォールバックする dead path になる。さらに `ɹ`/`r`/`ɾ` のエイリアスも解決されない。不採用理由: 棄却。これは元案の致命的欠陥であり、突合が一切発火しない。既存 canonicalizePhoneme を再利用する Option A を採る。
- **Option B: substituteVariants に加え wordPosition キーの step override も catalog に持たせる** — Pros: final-consonant-omission の語末位置別（/p#/ vs /t#/ vs /k#/）に固有 step を出せる。Cons: ArticulationGuide に2次元目が増え catalog データ量が倍化、ACL の選択ロジックが (substituteVariant ?? positionOverride ?? default) と複雑化。不採用理由: 部分採用。wordPositionLabel は既に入力にあり What 層で語頭/語中/語末を出している。How の wordPosition 別 step は final-consonant-omission の1項目のみ optional に持たせ、全項目への一般化はしない（過剰）。
- **Option C: nBest 信頼度重み付けで howJa を曖昧化（「弾き音か側面音のどちらかを出しています」）** — Pros: 遷移期の学習者に最も具体的。Cons: 閾値チューニングが usage data なしには根拠薄、ACL が複雑化。不採用理由: 棄却。premature。nBest は入力に通すが（ADR-021 の LLM 接地に使う）、決定論 How の分岐は canonicalize 済み detectedTopCandidate の単一最頻候補のみを使う。
- **Option D: ML 音響→調音インバージョン（SPARC/EMA）で学習者の舌位置を推定して図解** — Pros: 理論上は学習者固有の舌位置を可視化、/r/-/l/ もカバー。Cons: SPARC は LICENSE ファイルなし（REQ-NF-101 違反のハードブロッカー — 調査 risk）、非ネイティブで RMSE +16%劣化、日本語 L2 EMA コーパス皆無、ブラウザ描画コンポーネント不在、L2 学習効果の RCT 証拠なし。不採用理由: 棄却。AAI は本 ADR のスコープ外であり、ADR-019（AAI enrichment service）が別途 enrichment として扱う（本 ADR は静的 SVG + canonicalize の決定論 floor を定義し、その上に ADR-019 が条件付きで EMA オーバーレイを重ねる）。
- **Option E: SeeingSpeech / Dynamic Dialects の超音波・MRI 動画を埋め込む** — Cons: CC BY-NC のため商用バンドル不可。不採用理由: 棄却。ライセンス非互換。外部学習リソースへのリンク（「もっと見る」）としてのみ許容。

# Consequences

## Positive

- worker が bare `ɾ` を出しても既存 canonicalizePhoneme により catalog の `ɾ` キーへ正しく到達し、同じ /l/ 置換でも実音に応じて How が変わり actionable になる。confusionSet の dead data が活きる（元案の括弧不一致で死配線化する欠陥を解消）。
- canonicalize ロジックを catalog 突合と diagnostic 突合で共有モジュール化するため、表記揺れ・エイリアスの二重実装と齟齬を防ぐ。
- /f/ finding が汎用フォールバックではなくカタログ駆動の具体的 How を得る（live correctness gap の解消）。
- REQ-105/M-105 の調音図解が placeholder から実在アセットになり、TTS 併置で Kocjancic 2025 の証拠制約を満たす。
- ADR-021（同一バッチ sibling）の LLM ナラティブが、より具体的な決定論バックボーン（バリアント step）を fallback / 接地素材として利用できる。
- catalog coverage / substituteVariants 整合テストにより HIGH_PRIORITY_PHONEME_SET の欠落と括弧揺れが write-time に検出される。
- backend / wire 契約を一切変えずに frontend 内で完結する（影響範囲が狭い）。

## Negative

- catalog JSON のデータ量が増える（substituteVariants 分）。バリアント step の文言品質は人手で書く必要がある。
- /r/, /l/, /v/, /ə/ の SVG 自作工数が発生（線画、各 1-2 時間）。/r/ は正確な CC0 アセットが存在しないため自作必須で調音的正確性のレビューを要する。
- PHONEME_ALIASES が ɹ/r/ɾ を canonical ɾ に collapse するため、/r/ の detectedTopCandidate からは英語接近音 [r] と日本語弾き音 [ɾ] を区別できない。/r/ の `ɾ` バリアントは両ケース共通の「弾き接触解除」修正に限定され、[l] 側面音化の区別は提供しない（信号の限界、l1MechanismJa/Notes に明記）。
- substituteVariants は detectedTopCandidate に依存するため、worker が detectedTopCandidate を出さない finding では従来の汎用 step に戻る（劣化ではないが恩恵なし）。
- 図解は音素ごとの正準静的アセットであり学習者固有の舌位置ではない（AAI を採らない判断の帰結）。i.svg は /iː/・/ɪ/ の、a.svg は /ɑ/・/ʌ/ の近似 proxy であり厳密な専用図ではない（UI とコメントに明示）。
- canonicalizePhoneme の共有モジュール移設は complete-diagnostic-session の import 書き換えを伴う（挙動不変の move だが既存テストの緑維持を要確認）。

# Compliance

- canonicalize 共有テスト: phoneme-canonicalization.ts の canonicalizePhoneme("ɾ")==="ɾ"、canonicalizePhoneme("[ɾ]")==="ɾ"、canonicalizePhoneme("ɹ")==="ɾ"、canonicalizePhoneme("r")==="ɾ" を assert。move 後も complete-diagnostic-session の既存テストが緑であることを確認。
- catalog coverage 単体テスト: HIGH_PRIORITY_PHONEME_SET の各音素に targetPhoneme 一致のカタログ項目が存在することを assert（/f/ 欠落を検出）。
- substituteVariants 整合テスト: 各項目の substituteVariants キーを canonicalizePhoneme で正規化したものが、当該 confusionSet を canonicalizePhoneme で正規化した集合の部分集合であることを assert（孤児バリアント + 括弧揺れ防止）。
- generator 分岐テスト（実 worker 出力形 fixture 必須）: detectedTopCandidate="ɾ"（BARE、ScoringSpec.hs:303 の実出力形）の /l/ finding が l-r-substitution の `ɾ` バリアント step を選ぶことを assert。detectedTopCandidate="ɾ" の /r/ finding が r-substitution の `ɾ` バリアント step（/l/ とは別文言）を選ぶことを assert。detectedTopCandidate=null では従来の stepsJa[0..2] を返すことを assert（後方互換）。bracketed fixture（"[ɾ]"）は使わない — bare 入力で発火することを検証することで元案の括弧不一致を write-time に捕捉する。
- ランタイム検証（live worker）: /l/ 置換を含む実録音を live worker に通し、worker が bare detectedTopCandidate を出すこと、それを frontend が canonicalize して howJa が detectedTopCandidate に応じて実際に分岐すること（汎用 stepsJa に落ちないこと）、/f/ finding が f-h-substitution の具体 How を得ることを観測 assert。合成 bracketed fixture では再現しない false-green を防ぐため live worker 観測を必須とする。
- ArticulationCard レンダリングテスト: sagittalSvgPath を持つ entry が <img> を描き alt を持つこと、持たない entry が placeholder にフォールバックすること、TTS ボタンが図解と同カード内に併置されることを assert。
- アセットライセンス検査: public/assets/sagittal/ の各 SVG が出典・ライセンスコメントを持つこと、CC BY-NC アセットが含まれないことを CI / レビューで確認。

## How-branch UI surfacing amendment (2026-06-19)

D7（How-branch の feedback UI surface）の受入。全 Must は real entrypoint（App Router 経由で到達する DetailPanelV2 の render）から観測可能挙動を実行 assert し、新 render 経路に mock/stub/placeholder を入れない。配線先は finding 由来 howJa の唯一の render site である DetailPanelV2.tsx:424 のみとする（ArticulationCard は finding-derived How を持たないため対象外）。

- **M-HOW-1（canon-note 等価表示）**: DetailPanelV2 で `.canon-note` / `.cn-eq` を CSS-only から live JSX へ置換し、worker の `detectedTopCandidate` と `canonicalizePhoneme(detectedTopCandidate)` の結果（例 `ɹ → ɾ`）を finding にバインドして描画する。render テスト（@testing-library/react で DetailPanelV2 を mount）で、表示される canonical 値が `canonicalizePhoneme(detectedTopCandidate)` の戻り値に等しいこと（bare-IPA fixture `detectedTopCandidate='ɾ'` で `'ɾ'`、`'ɹ'` で `'ɾ'`）を assert する。ハードコード文字列は使わない。
- **M-HOW-2（matched/fallback バリアントカード）**: matched/fallback How-branch を `.how-variant` カードとして DetailPanelV2 に描画する。`findStepsForSubstitute(findCatalogEntryById(catalogId), detectedTopCandidate)` が選んだバリアントカードに `.is-matched` を付け、その stepsJa を列挙し、generic/fallback stepsJa を非 matched バリアントとして並置する。`.hv-detected` に detected 記号、`.hv-canon` に canonical 形をバインドする。render テストで、`detectedTopCandidate='ɾ'`（BARE、ScoringSpec.hs:358 の実出力形 `findingDetectedTopCandidate f == Just "ɾ"`）の l-r-substitution finding で `ɾ` バリアントカードが `.is-matched` を持ちそのバリアント step を列挙すること、`detectedTopCandidate=null` では generic stepsJa バリアントが `.is-matched` 強調なしで描画されることを assert する。
- **M-HOW-3（制約注記）**: r-substitution / how-constraints 経路で、`ɹ`/`r`/`ɾ` が canonical `ɾ` に collapse し英語接近音と日本語弾き音を区別できない・r-substitution に `[l]` バリアントを作らない、という本 ADR 既出（Negative :216 / Notes :235）の限界を制約注記として描画する。注記文は UI ハードコードではなく catalog の `l1MechanismJa`（`data/japanese-l1-catalog.json:39`）由来とする。render テストで r-substitution finding のカードに当該 catalog 由来注記文が存在することを assert する。
- **M-HOW-4（新ロジック・新データ皆無の不変条件 / howJa を経由しない再導出）**: 本 UI Must 群は新しい分岐ロジックも新データも導入しないことを明示する。surface する detected/canonical/variant/stepsJa は feedback layer に既に届いている `detectedTopCandidate`（api-types.ts:283）/ `catalogId`（:287）と、共有 `canonicalizePhoneme`・`findStepsForSubstitute` の出力のみから来る。UI は `finding.feedbackLayers.howJa` 文字列を経由せず `findStepsForSubstitute` を直接呼ぶ。render テストで、UI が描く matched バリアントが decision backbone（generator が D2 で `findStepsForSubstitute` に渡すのと同一の catalog entry + detectedTopCandidate）の選んだバリアントと一致することを証明する。M-APD-16（acousticEvidence による howJa 上書き、generator :281-288）の存在により最終 `howJa` 文字列とは一致しない場合があるため、`howJa` 文字列との一致は assert しない。FeedbackLayersDto / EngineFindingDto に新フィールドを足さない（`git diff` で `api-types.ts:194-197` の FeedbackLayersDto 形と :283/:287 の EngineFindingDto 形が不変であることを確認）。
- **M-HOW-5（render site と後方互換フォールバック）**: 新 markup を finding 由来 howJa の唯一の render site である `DetailPanelV2.tsx:424`（現 `howJa` 描画点）に配線する。ArticulationCard は対象外。`detectedTopCandidate=null` のとき UI は現行の単一 howJa fix-row 表示へ縮退し、空・孤立した how-variant カードを描かない。受入: `grep` で `.canon-note` / `.cn-eq` / `.how-variant` / `.hv-detected` / `.hv-canon` / `.is-matched` の CSS-only 孤児が src 配下にゼロ（各クラスが最低 1 つの JSX render site を DetailPanelV2 で持つ）であることを確認する。
- **M-HOW-6（agent-policy + scoreImpact 不変）**: 新 render 経路に mock/stub/placeholder を入れない。`pnpm fitness` / `verify-no-stub-placeholder` / `verify-wiring` 緑。本機能は presentation 専用であり、worker の `severityToScoreImpact`（`applications/backend/src/NativeTrace/Worker/Scoring.hs:1285`、Critical=-8.0/Major=-5.0/Minor=-2.0）と ScoreSet が `detectedTopCandidate` の有無・本 surface の有無と独立（ADR-004 不変）であることを、既存の worker scoring 単体テスト（ScoringSpec.hs）が D7 の frontend 変更後も無変更で緑であることで担保する。`.agent-evidence/` に DetailPanelV2 の canon-note・matched how-variant 強調・制約注記が実パイプライン値で populate された live render（または component test）の証跡を残す。

# Notes

- Risks:
  - canonicalize 突合の正規化規則と worker 出力形が将来ずれるリスク: worker が新しい IPA トークン（例 syllabic 記号付き）を出すと canonical 化で取りこぼす。テストは実 worker 出力形（bare、ScoringSpec.hs を真とする）を fixture に使い、合成 bracketed 値で偽 green を作らない（調査 lesson: unit fixture は実 worker 出力形で書く）。runtime-verify が live worker で実分岐を観測する。
  - /r/ の信号限界: PHONEME_ALIASES（ɹ→ɾ, r→ɾ）により英語接近音と日本語弾き音が canonical ɾ に collapse し、detectedTopCandidate から区別できない。/r/ の ɾ バリアントは両ケース共通の修正に限定する。この限界を l1MechanismJa/Notes に明記し、UI コピーで「区別できる」と過大に約束しない。
  - /r/（英語接近音）の正確な CC0 sagittal SVG が Wikimedia に存在しない。Wikimedia の `ʁ` は uvular 摩擦音で別音のため使うと誤誘導になる（調査 risk）。自作 SVG の調音的正確性をレビューで担保する必要がある。
  - substituteVariants の文言品質は人手依存。バリアント step が誤った調音指示を含むと逆効果。音声学レビューを要する。
  - detectedTopCandidate は worker の MDD/nBest 由来。日本語 L1 ベンチマークデータがなく、商用システムでも precision ~60% / recall 40-80% が現実的（調査 evidence 〔RISK-6, area=SLA evidence〕）。誤った detectedTopCandidate でバリアント分岐すると誤った How を出すため、本 ADR は detectedTopCandidate 非 null かつ canonical 一致のときのみ分岐し、不一致・null では保守的に汎用 stepsJa に留める（取りこぼし側に倒す）。
  - 調音図解の L2 学習効果は「音響併置時のみ」の証拠（Kocjancic 2025）であり、図解単体の効果は証拠薄。UI は必ず TTS と併置する制約で対応するが、効果は過大評価しない。i.svg/a.svg は近似 proxy であり厳密な専用図ではないことを明示する。
  - canonicalizePhoneme の共有モジュール移設で complete-diagnostic-session の挙動が変わらないこと（純粋 move）を既存テストで担保する。move 漏れ・import 循環に注意。
  - findCatalogEntry 本体の latent shadowing bug（単一 .find ディスジャンクションで配列順 first match）は本 ADR では修正しない。本 ADR の substitute 突合は findStepsForSubstitute の canonical 等価比較に閉じておりこのバグの影響を受けないが、catalog 拡張時に findCatalogEntry が誤エントリを返すリスクは残る（別 issue 候補として Notes 記録）。
- First-slice relevance: 本 ADR は first slice（ADR-022 の finding 単位 A/B 部分再生 + その場再録音 → GOP delta）には直接必須ではない。first slice は閉ループ最小（再生・再録音・delta 表示）であり、How 層の深化は並行スライス。ただし ADR-022 の「自分で試す」録音導線（ArticulationCard.tsx:144-154 の disabled ボタン）と本 ADR の図解 D5 は同じ ArticulationCard を触るため、実装順序の調整が必要（D5 の図解置換が録音ボタン配線とコンフリクトしないよう、ArticulationCard 変更は両 ADR の slice をまとめて入れるのが安全）。D0（canonicalize 共有モジュール化）と D1（detectedTopCandidate 配線）は ADR-021 の LLM 接地にも必要なため、ADR-021 着手前に landing しておくと下流が楽になる。なお ADR-021/022 は本バッチで同時に author 済みであり、本 ADR と同 PR で land される。
- Amends:
  - ADR-004: How 層の組み立て規則を具体化する。ADR-004 は messageJa=null を frontend が埋める契約と structured-diff FindingDto を定めるが、How の中身（stepsJa 無条件連結）は未規定だった。本 ADR は frontend 内の決定論 How を canonicalize 済み detectedTopCandidate × substituteVariants で分岐させると定める（worker の scoring/契約は不変、ADR-004 の messageJa=null 方針も不変）。
  - ADR-017: epenthesis の位置文契約に整合させたまま、substitution/omission/insertion 系の How 具体化を補完する（ADR-017 は epenthesis 単体の What/位置を扱い、本 ADR は How 層全体のバリアント分岐を扱う。衝突なし）。
  - ADR-021（同一バッチ sibling）: 本 ADR の substituteVariants と canonicalize 突合が ADR-021 の deterministic fallback / 接地素材になる。
- Depends on:
  - ADR-004（messageJa=null frontend 充填・structured-diff FindingDto。本 ADR の前提、land 済み）
  - ADR-002（espeak/IPA。detectedTopCandidate / confusionSet の IPA 記号系の供給元、land 済み）
  - ADR-021（LLM ナラティブ。同一バッチ sibling。本 ADR の決定論バックボーンが ADR-021 の fallback / 接地素材になる。本 ADR は ADR-021 なしでも単独で機能する）
  - ADR-022（finding 単位閉ループ。同一バッチ sibling。ArticulationCard 共有のため実装順序調整。firstSliceRelevance 参照）
- Author: lihs
- Last updated: 2026-06-18
- Related: ADR-004（messageJa=null / structured-diff / 減点 allow-list）、ADR-002（espeak / IPA 記号系）、ADR-017（epenthesis 位置文契約）、ADR-021（LLM ナラティブ、同一バッチ sibling）、ADR-022（finding 単位閉ループ、同一バッチ sibling）、ADR-019（AAI enrichment service — Option D が棄却した ML インバージョンを条件付き enrichment として別途扱う）
