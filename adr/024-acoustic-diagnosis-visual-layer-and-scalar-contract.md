# Acoustic diagnosis visual layer and numeric-scalar contract extension

ADR-024: 音響診断ビジュアルレイヤと数値スカラー契約拡張（ADR-018 の UI Non-goal を supersede）

# Status

Proposed

2026-06-19 起票。ADR-018（Accepted）が音響証拠の DATA パイプライン（analyzer→worker→`EngineFindingDto.acousticEvidence`）を所有し配線済みである一方、その提示レイヤ（Screen-13 articulation card の Acoustic Diagnosis 視覚層）を意図的に Non-goal にしている。本 ADR はその提示判断を引き受け、かつ設計が要求する数値スカラーを追加する契約拡張を確定する。**本 ADR は ADR-018 の Non-goal「新 UI コンポーネント / 画面: …新規 `.tsx` は追加しない」（docs/specs/acoustic-phonetic-diagnosis.md:449、同趣旨の再掲が :233）、および Must M-APD-16（rule-based generator howJa 方向ラベル分岐、spec:225）の受入条件に含まれる .tsx ゼロ assert（`git diff --name-only HEAD -- applications/frontend/src/components/ | grep "\.tsx$"` が 0 件、docs/specs/acoustic-phonetic-diagnosis.md:413-414）を supersede する。** 本レイヤの実装はこの 2 つの制約を in-slice で必ず破るため、本 ADR 承認時に ADR-018 の Status / Notes へ「UI Non-goal（spec:449/233）と M-APD-16 受入の .tsx ゼロ制約（spec:413-414）は ADR-024 が supersede」と追記する（Compliance 受入 8 参照）。M-APD-16 本体の rule-based howJa 分岐 Must（spec:225）自体は supersede 対象ではなく不変であり、本 ADR が supersede するのはその受入条件の一節たる .tsx ゼロ assert のみである。ADR-018 の measurement-only / categorical-enum / scoreImpact 不変（D5/D7）の各不変条件は維持する。

# Context

ADR-018 は per-phoneme 音響証拠を end-to-end で配線した。analyzer は生計測（`PhonemeAcousticResponse`: f1Hz/f2Hz/f3Hz/spectralCentroidHz/durationMs、schema.py:192-198、クラス宣言 schema.py:181）を返し、worker `Scoring.hs` の `deriveAcousticEvidence`（Scoring.hs:743、設定箇所 Scoring.hs:568）が偏差判定して `AcousticEvidence`（Types.hs:278-309）を導出、ToJSON が `acousticEvidence` キーを出し（Types.hs:409、`findingAcousticEvidence` Types.hs:379）、frontend zod `findingSchema` の `acousticEvidence` object（schema.ts:112-128）が parse して `EngineFindingDto.acousticEvidence`（api-types.ts:296、型 `AcousticEvidenceDto` api-types.ts:238-250）に転写する。この証拠は現状 howJa 散文（ADR-018 D6、rule-based generator）でのみ消費されている。

しかし v3 デザインシステムと Screen-13 articulation card は完全な Acoustic Diagnosis 視覚層を仕様化している: ヘッダ（音素記号 + ADR-018 Accepted バッジ + enrich layer-tag）、F1×F2 母音四辺形プロット（measured vs target + Hillenbrand ノルムへの偏差ベクトル）、調音方向 3+ チップグリッド（符号付き SD / Hz 読み出し付き）、スペクトル重心 Hz と tense 長さ比の 2 メーターバー、発話内 Lobanov 正規化 / 母音 <3 スキップ / 二重減点なしの推定 disclaimer。これらに対応する CSS は design-components.css に全て出荷済みである: `.acoustic`(959)、`.acoustic-head`(960)、`.vowel-plot`(963)・`.vp-pt`(969)・`.vp-vec`(974)、`.dir-grid`(978)・`.dir-chip`(979)・`.dir-hz`(987)、`.measure-bar`(990)・`.mb-target`(994)・`.mb-val`(995)、`.layer-tag--enrich`(949)。だが `acousticEvidence` を読んで描画する React コンポーネントは存在しない。ArticulationCard.tsx は ADR-019 の `articulatoryEstimate`（ArticulationCard.tsx:20 で props 宣言、:55 で分解）だけを描画し、`acousticEvidence` を一切読まない（呼び出し元 DetailPanelV2.tsx:479）。

二つの障害がある。第一に、提示そのものを ADR-018 が Non-goal として明示的に拒んでおり（spec:449、再掲 :233）、M-APD-16 受入の .tsx ゼロ assert が新規 `.tsx` ゼロを assert している（spec:413-414）。これは「未実装の放置」ではなく「実装してはならない」という明示判断であり、本レイヤの実装は ADR-018 を in-slice で破る。第二に、設計が要求する 2 種の数値読み出しが ADR-018 の契約に意図的に含まれていない。方向チップの `.dir-hz` 列は軸ごとの符号付き SD 偏差を要し、2 本の measure-bar はスペクトル重心 Hz スカラーと tense/lax 長さ比スカラーを fill 配置に要する。`AcousticEvidenceDto`（api-types.ts:238-250）は categorical enum（tongueHeight/tongueBackness/rhoticity/sibilantPlace/vowelLength）と生の measured/target F1/F2/F3 のみを運び、スカラーは運ばない。worker は `acousticSpectralCentroidHz`（PhonemeAcoustic）を sibilant 判定（Scoring.hs:834,837）で消費するが `AcousticEvidence` には載せない（Types.hs:299-309 のフィールド集合に重心 Hz / 長さ比 / SD 偏差は無い）。ADR-018 D5/D7 が categorical + measurement-only を保つ判断だからである。

母音四辺形と categorical 方向チップは現契約から導出可能だが、SD 列と measure-bar fill は導出不能である。設計実現には ADR-018 が断った提示判断 AND ADR-018 の不変条件が排除する契約拡張の両方が要る。これはどの既存 ADR も所有していない新規判断であり、Accepted な ADR-018 を書き換えるのではなく、ADR-018 を supersede / amends する兄弟 ADR が保守的に妥当である。

# Decision

**D1 — Acoustic Diagnosis 視覚層を新規 React コンポーネントとして実装することを許可する。** ADR-018 が Non-goal にした提示判断を本 ADR が引き受ける。Screen-13 articulation card 配下に acoustic card を描画する `.tsx` を追加する（ADR-018 の M-APD-16 受入の .tsx ゼロ制約は本 ADR が supersede）。コンポーネントは `EngineFindingDto.acousticEvidence`（api-types.ts:296）を読み、`acousticEvidence` が非 null のときだけ `.acoustic` カード（design-components.css:959）を描画し、null のとき描画しない。配線点は ArticulationCard.tsx（acousticEvidence を props として受け取り未配線の現状を是正）→ DetailPanelV2.tsx:479 の呼び出しに `acousticEvidence` を渡す経路、または acoustic 専用子コンポーネントを ArticulationCard 配下に置く。いずれも App Router 配置済みの DetailPanelV2 から到達する real entrypoint である。**ArticulationCard.tsx は ADR-019（placeholder 撤去 + articulatoryEstimate EMA オーバーレイ + props 追加、adr/019:120,133）と ADR-020（placeholder div 075-084 行→静的 SVG 図解、adr/020:38,166,188）も同ファイルを co-own する。三者の同一ファイル編集はコンフリクトするため、ADR-020 Notes の「同 PR で land」方針（adr/020:9,242）に準じて実装順序を調整する（Notes 実装順序参照）。**

**D2 — 現契約から導出可能な要素は契約拡張なしで描画する。** (a) カードヘッダ（音素記号 + ADR-018 Accepted バッジ + `.layer-tag--enrich` のレイヤタグ、design-components.css:949,960）。(b) 母音四辺形プロット: measured (measuredF1Hz api-types.ts:244, measuredF2Hz :245) と target (targetF1Hz :247, targetF2Hz :248) を `.vp-pt--measured` / `.vp-pt--target`（design-components.css:971,970）座標へ写像し、`.vp-vec`（:974）で Hillenbrand ノルムへの偏差ベクトルを描く。(c) categorical 方向チップ（`.dir-chip`、:979）: tongueHeight / tongueBackness / **rhoticity** / sibilantPlace / vowelLength の enum を矢印 + ラベルで描く。**rhoticity は /r/ の主軸であり描画必須**（design-components.css:977 のコメントが `tongueHeight / Backness / rhoticity / sibilantPlace / vowelLength` の 5 軸を列挙、rhoticity は api-types.ts:241、measuredF3Hz:246 / targetF3Hz:249 が F3 値を運ぶ）。これらは ADR-018 が運ぶ categorical enum + 生 F 値だけで描ける。

**D3 — チップの SD/Hz 列と measure-bar fill が要する数値スカラーを契約拡張する。** 現契約に欠けるのは (i) 軸ごとの符号付き SD 偏差（`.dir-hz` 列、design-components.css:987）、(ii) スペクトル重心 Hz スカラー（measure-bar、design-components.css:990）、(iii) tense/lax 長さ比スカラー（measure-bar）である。**ただし重心 Hz は analyzer 層では既存 `spectralCentroidHz`（schema.py:196）を流用し analyzer に新フィールドを足さない。新規追加はワーカー以降の `AcousticEvidence` 透過のみであり、全 3 層に全スカラーを足すわけではない（層ごとの追加対象は Contract changes 参照）。** これらを python→Haskell→zod の各層に optional+nullable で追加する（後述 Contract changes）。worker `Scoring.hs` が既存 enum 導出と同じ箇所で算出する。重心 Hz は worker が既に `acousticSpectralCentroidHz`（PhonemeAcoustic、Scoring.hs:834 で参照）を持つので新計測経路は不要で、`AcousticEvidence` フィールドへの透過のみを足す。

**D4 — F3 を rhoticity チップの読み出し軸として描画する。** rhoticity（insufficient/overRetroflex/ok、api-types.ts:241）チップの `.dir-hz` 列に measuredF3Hz（api-types.ts:246）/ targetF3Hz（api-types.ts:249）を読み出す。F3 は /r/-/l/ 弁別の load-bearing 軸（ADR-018 D5: /r/ で F3≥2000Hz→insufficient、/l/ で F3<2500Hz→overRetroflex）であり、本 ADR は rhoticity 軸の省略を禁じる。

**D5 — ADR-018 / ADR-004 の不変条件を保つ。** analyzer は引き続き measurement-only（生 Hz のみ、偏差判定なし）。新スカラーは全て optional+nullable で旧 analyzer / 旧 worker と後方互換。scoreImpact は acousticEvidence の有無・新スカラーの有無によらず不変（ADR-004、音響偏差は減点しない、二重減点回避）。本視覚層と新スカラーは presentation/advice 専用。

**D6 — disclaimer を描画する。** acoustic card に ADR-018 D4/D7 の caveat（発話内 Lobanov 正規化 / 母音 3 個未満でスキップ / スコアに二重減点しない）を可視テキストで描く。これは方向文単独提示の教育効果限界（ADR-018 Notes pedagogy 証拠）への提示設計上の守りでもある。**ただし ADR-019 D4 が同一 ArticulationCard 内に「L2 disclaimer 注記」（adr/019:120,133）を既に描く。本 ADR の disclaimer はそれと重複描画にせず、acoustic 固有の caveat を単一の disclaimer ブロックに集約する（Compliance 受入 6 で単一性を assert）。**

**D7 — null 縮退。** acousticEvidence が null のときカード非描画。個別スカラーが null のとき該当 measure-bar / SD 列を非表示にし、母音四辺形や categorical チップなど描画可能要素の描画を阻害しない。新スカラー欠如時も既存 howJa 散文経路（ADR-018 D6）を退行させない。

# Contract changes

クロスレイヤ型は ADR-018 の契約に optional+nullable で追加する（後方互換）。フィールド名は既存 wire 規約（camelCase）に揃える。層ごとの追加対象は D3 のとおり一様ではない（重心 Hz は analyzer 層では既存流用、新規は worker 以降のみ）。

- **python-analyzer interface/schema.py**: `PhonemeAcousticResponse`（クラス schema.py:181、フィールド群 schema.py:192-198）に新規 nullable スカラーを追加: `signedF1SdDeviation: float | None`, `signedF2SdDeviation: float | None`, `signedF3SdDeviation: float | None`, `tenseLengthRatio: float | None`。**D3-(ii) スペクトル重心 Hz は schema.py:196 の既存 `spectralCentroidHz` をそのまま流用し新設しない**（重複規約回避）。SD 偏差を analyzer 側で出すか worker 側で出すかは Notes Open question 1 参照（measurement-only 原則上は worker 側導出が ADR-018 D5 と整合）。**Open question 1 で worker 一元導出に寄せた場合は、この 4 スカラーを analyzer schema から落とし worker 内導出に閉じる（下記 Notes Open question 1 と相互参照）。**
- **backend Types.hs `AcousticEvidence`**（Types.hs:278-309）: 新規 nullable フィールド `acousticSpectralCentroidHz :: Maybe Double`, `acousticTenseLengthRatio :: Maybe Double`, `acousticSignedF1SdDeviation :: Maybe Double`, `acousticSignedF2SdDeviation :: Maybe Double`, `acousticSignedF3SdDeviation :: Maybe Double` を追加。ToJSON（Types.hs:296-309 の object）に wire key を追加: `"spectralCentroidHz"`, `"tenseLengthRatio"`, `"signedF1SdDeviation"`, `"signedF2SdDeviation"`, `"signedF3SdDeviation"`。`-Werror=missing-fields` のためレコード構築箇所（`deriveAcousticEvidence` Scoring.hs:743、設定箇所 Scoring.hs:568）を全て更新する。
- **backend Scoring.hs `deriveAcousticEvidence`**（Scoring.hs:743）: 既存 enum 導出と同じ位置で新スカラーを算出。`acousticSpectralCentroidHz` は入力 `PhonemeAcoustic` の重心（Scoring.hs:834 で既に参照）を透過。符号付き SD 偏差は既存しきい値判定（`acousticF1SdThreshold` Scoring.hs:666 / `acousticF2SdThreshold` Scoring.hs:668 等）の中間値（z-score）を符号付きで載せる。tenseLengthRatio は既存 `tenseLaxDurationRatio`（Scoring.hs:692-693）判定の中間値（実測長 / lax ノルム長）を載せる。**scoreImpact は変更しない**（ADR-004/ADR-018 D7）。
- **frontend acl/.../oss-worker/schema.ts**: `findingSchema` の `acousticEvidence` object（schema.ts:112-128）に `spectralCentroidHz: z.number().nullable().optional()`, `tenseLengthRatio: z.number().nullable().optional()`, `signedF1SdDeviation: z.number().nullable().optional()`, `signedF2SdDeviation: z.number().nullable().optional()`, `signedF3SdDeviation: z.number().nullable().optional()` を追加。`.transform((v) => v ?? null)` の後方互換挙動（schema.ts:128）を維持。response-mapper.ts でそのまま転写。
- **frontend lib/api-types.ts `AcousticEvidenceDto`**（api-types.ts:238-250）: `spectralCentroidHz: number | null`, `tenseLengthRatio: number | null`, `signedF1SdDeviation: number | null`, `signedF2SdDeviation: number | null`, `signedF3SdDeviation: number | null` を追加。

# Alternatives considered

- **採用: 兄弟 ADR で ADR-018 の UI Non-goal を supersede し、視覚層を新規 `.tsx` で実装 + 数値スカラーを optional 追加。** Pros: Accepted な ADR-018 のスコープ宣言を破壊的に書き換えず、提示判断と契約拡張を新規判断として明示記録できる。母音四辺形・categorical チップ（rhoticity 含む）は既存契約から描け、SD/Hz 列と measure-bar だけが契約拡張を要するため拡張面が最小。全新フィールドが optional+nullable で旧 worker と後方互換。scoreImpact 不変（ADR-004）を保てる。Cons: ADR-018 の Non-goal と M-APD-16 受入の .tsx ゼロ制約を supersede する明示作業（ADR-018 Status/Notes 追記）が要る。採用理由: gap-register Decision summary の保守的方針（Accepted ADR の scope 書き換えより sibling ADR）と一致し、契約拡張面が最小。
- **不採用: ADR-018 本体を編集して UI Non-goal を削除し contract をその場で拡張する。** Pros: ADR が 1 本に収まる。Cons: ADR-018 は Accepted で、自身の Non-goal（spec:449）と measurement-only/categorical-enum 契約スタンス（D5/D7）を自己矛盾なく削除できない。承認済み判断の改変は履歴の追跡性を損なう。不採用理由: Accepted ADR のスコープを後から書き換えると「当時何を決めたか」が失われ、supersede 関係も不明瞭になる。
- **不採用: スカラーを足さず、SD 列と measure-bar を frontend で生 F 値から再計算する。** Pros: 契約拡張ゼロ。Cons: 符号付き SD 偏差は発話内 Lobanov 正規化（全母音の平均・SD）を要し、単一 finding の DTO には正規化母集団が無い。frontend が偏差を再導出すると ADR-018 D5（偏差導出は worker のしきい値 = scoring policy）を破り、worker と frontend で二重実装・規約分岐が生じる。不採用理由: 偏差導出の所在を worker に一元化する ADR-018 D5 と矛盾し、正規化母集団を frontend が持たない。
- **不採用: categorical チップから rhoticity 軸を省く（F1/F2 由来の母音軸だけ描く）。** Pros: 母音プロットと整合し実装が単純。Cons: rhoticity（api-types.ts:241）と F3（measuredF3Hz:246 / targetF3Hz:249）は日本語学習者で最も機能負荷の高い /r/-/l/ の load-bearing 軸であり、省くと最重要弁別が画面から消える。不採用理由: 採点・診断の主目的に直結する軸の欠落は提示価値を損なう（adversarial critic 指摘）。

# Consequences

## Positive

- 所見が howJa 散文だけでなく、母音四辺形・方向チップ・measure-bar・disclaimer を備えた視覚的な音響診断として提示される。ADR-018 が配線済みの `acousticEvidence` データに初めて描画サイトが付き、契約フィールドの dead-render が解消される。
- rhoticity + F3 を方向チップの読み出し軸として明示描画するため、/r/-/l/ の調音方向が数値（measuredF3Hz/targetF3Hz）付きで可視化される。
- 新スカラーは全て optional+nullable で、旧 worker / 旧 analyzer 出力でも zod parse が成功し（`.transform((v) => v ?? null)` 維持）、measure-bar は null で非表示に縮退する。
- scoreImpact が acousticEvidence・新スカラーの有無によらず不変（ADR-004/ADR-018 D7）を policy test で固定し、presentation-only であることを機械強制する。具体的には GOP しきい値（gopMajorThreshold=-12.0 Scoring.hs:213 / gopMinorThreshold=-8.0 Scoring.hs:217）と severity→scoreImpact（Critical=-8.0 / Major=-5.0 / Minor=-2.0、Scoring.hs:1286-1288）が不変であることを固定する。

## Negative

- ADR-018 の Non-goal「新規 `.tsx` 追加禁止」（spec:449/233）と M-APD-16 受入の .tsx ゼロ assert（spec:413-414）を supersede するため、ADR-018 の Status/Notes 追記という追補作業が発生し、ADR-018 と本 ADR の supersede 関係を読者が辿る必要がある。
- 符号付き SD 偏差の算出位置（analyzer か worker か）が ADR-018 の measurement-only 原則と提示要件の境界に触れる。worker 側導出が D5 と整合するが、Open question として残す（Notes 1）。
- 母音四辺形 / measure-bar の座標写像はデザイン CSS の前提（プロット範囲、Hillenbrand ノルム基準点）に依存し、写像レンジが未文書化なら誤配置リスクがある（Notes 2）。
- presentation/advice 専用のためスコアに寄与せず、視覚層を足してもスコアリングの精度は変わらない（ADR-018 D7 を踏襲した制約）。

# Compliance

agent-policy（AGENTS.md）に従い、各受入は real entrypoint から観測可能挙動で testable とする。本番経路に mock/stub/placeholder を入れない。`scripts/verify-no-prod-doubles.sh` / `verify-no-stub-placeholder.sh` / `verify-wiring.sh` 緑。`.agent-evidence/` 更新。

1. **acoustic card 描画 + null 制御**: DetailPanelV2.tsx:479 から到達する acoustic コンポーネントが `EngineFindingDto.acousticEvidence`（api-types.ts:296）を読み、`.acoustic` カード（design-components.css:959）をヘッダ（音素記号 + ADR-018 Accepted バッジ + `.layer-tag--enrich` 一致、:949,960）付きで描く。component test: acousticEvidence 非 null で `.acoustic` が DOM に現れ、null で現れないことを assert。
2. **母音四辺形プロット**: measured (measuredF1Hz api-types.ts:244, measuredF2Hz :245) と target (targetF1Hz :247, targetF2Hz :248) を `.vp-pt--measured` / `.vp-pt--target`（design-components.css:971,970）座標へ写像し `.vp-vec`（:974）で偏差ベクトルを描く。test: 既知 F 値の measured 点が期待正規化座標に着地することを assert。
3. **方向チップ + SD/Hz 列（rhoticity 含む）**: `.dir-grid`/`.dir-chip`（:978,979）が tongueHeight / tongueBackness / **rhoticity**（api-types.ts:241）/ sibilantPlace / vowelLength を矢印 + ラベル + `.dir-hz`（:987）数値で描く。test: rhoticity チップの `.dir-hz` 列が measuredF3Hz/targetF3Hz（api-types.ts:246,249）または signedF3SdDeviation を契約供給値として表示し、categorical ラベル単独でないことを assert。
4. **契約拡張ラウンドトリップ**: schema.ts:112-128 の zod に追加した spectralCentroidHz / tenseLengthRatio / signedF1..F3SdDeviation が、Haskell `AcousticEvidence` ToJSON（Types.hs:296-309）の出力を parse し EngineFindingDto へ転写されることを applications/frontend/src/acl/pronunciation-assessment/oss-worker/__tests__/schema-and-response-mapper.test.ts で assert。新スカラー欠如時に null へ縮退し parse が失敗しない後方互換も assert。
5. **measure-bar スカラー由来 fill**: `.measure-bar`（:990）2 本がスペクトル重心 Hz と tenseLengthRatio を `.mb-target`（:994）/ `.mb-val`（:995）で描く。test: marker 位置がスカラー値から計算されること、スカラーが null のとき該当バーが非表示になることを assert。
6. **disclaimer 描画（単一ブロック）**: acoustic card に ADR-018 D4/D7 の caveat（発話内 Lobanov 正規化 / 母音 <3 スキップ / 二重減点なし）が可視テキストで存在することを test で assert。**かつ ADR-019 D4 の L2 disclaimer（adr/019:120,133）と重複しない単一 disclaimer ブロックであること**（同一カード内に同趣旨 disclaimer が二重描画されないこと）を assert。
7. **scoreImpact 不変（ADR-004/ADR-018 D7）**: applications/backend/test/NativeTrace/Worker/ScoringSpec.hs で scoreImpact が acousticEvidence・新スカラーの有無によらず不変であることを `cabal test all` 緑で維持。具体的には GOP しきい値（gopMajorThreshold=-12.0 Scoring.hs:213 / gopMinorThreshold=-8.0 Scoring.hs:217）と severity→scoreImpact（Critical=-8.0 / Major=-5.0 / Minor=-2.0、Scoring.hs:1286-1288）が不変であることを assert。
8. **ADR-018 supersede 追記**: 本 ADR 承認時に ADR-018（adr/018-acoustic-phonetic-diagnosis-formant-spectral-vot.md）の Status / Notes に「UI Non-goal（spec:449、再掲 :233）と M-APD-16 受入の .tsx ゼロ assert（spec:413-414）は ADR-024 が supersede」を追記し、docs/specs/acoustic-phonetic-diagnosis.md:449 の Non-goal と :413-414 の .tsx ゼロ assert に supersede 注記を入れる。grep で本 ADR への参照が ADR-018 / spec に存在することを確認。M-APD-16 本体の rule-based howJa 分岐 Must（spec:225）は supersede しない。
9. **fitness / wiring / 証跡**: `pnpm fitness`（ast-grep + ESLint 層間依存）緑、オニオン import 方向と parselmouth/DTO レイヤ閉じ込め不変。`scripts/verify-no-prod-doubles.sh` / `verify-no-stub-placeholder.sh` / `verify-wiring.sh` 緑。`.agent-evidence/` の wiring-map.json に `acousticEvidence → acoustic component（新 .tsx）→ DetailPanelV2` の描画経路と `Scoring.hs deriveAcousticEvidence → Types.hs AcousticEvidence(new scalars) → findingSchema(zod) → AcousticEvidenceDto` の契約経路を記録。本番経路に mock/stub/placeholder なし。

# Notes

- Open questions（値が未確定のため推測せず明記する）:
  1. 符号付き SD 偏差（signedF1/F2/F3SdDeviation）の算出を analyzer（measurement-only 原則上は不適）と worker（ADR-018 D5 の偏差導出 = worker 所有と整合）のどちらに置くか。本 ADR は worker 導出を推奨する。Contract changes の python-analyzer 節は両論併記で optional フィールドを記載したが、worker 一元導出へ寄せる構成では python schema 側の 4 スカラー追加は落とす（Contract changes python-analyzer 節の条件付き削除注記と相互参照）。実装スライス着手時にどちらかへ確定する。
  2. 母音四辺形プロットの座標写像レンジ（F1/F2 の min/max、Hillenbrand ノルム基準点の正規化方法）は design-components.css に未文書化。実装前に `.vowel-plot`（design-components.css:963）のレンジ規約を確定する必要がある。
  3. 新規 acoustic コンポーネントを ArticulationCard 内に統合するか独立 `.tsx` にするかは実装判断。いずれも DetailPanelV2.tsx:479 から到達する。
- 実装順序（ArticulationCard.tsx 共有）: ArticulationCard.tsx は ADR-019（EMA オーバーレイ + L2 disclaimer、adr/019:120,133）/ ADR-020（静的 SVG 図解、placeholder 075-084 行置換、adr/020:38,166,188）と本 ADR が同一ファイルを編集する。三者の編集衝突を避けるため、ADR-020 Notes の「同 PR で land」方針（adr/020:9,242）に準じて実装順序を調整する（disclaimer は D6 のとおり ADR-019 と重複させない）。
- Supersedes / Amends:
  - ADR-018: UI Non-goal（spec:449「新 UI コンポーネント / 画面: …新規 `.tsx` は追加しない」、再掲 :233）と Must M-APD-16（spec:225）の受入条件に含まれる .tsx ゼロ assert（spec:413-414）を supersede。M-APD-16 本体の rule-based howJa 分岐 Must（spec:225）は不変。ADR-018 の measurement-only / categorical-enum / scoreImpact 不変（D5/D7）も維持。承認時に ADR-018 Status/Notes へ supersede 注記を追記（Compliance 受入 8）。
  - ADR-004: structured-diff 契約に音響数値スカラー（spectralCentroidHz / tenseLengthRatio / signedF1..F3SdDeviation）を追加。worker が scoring を所有し scoreImpact を不変に保つ分担は不変。新スカラーは presentation/advice 専用で減点に使わない。
- Depends on: ADR-004（scoring locus / scoreImpact 不変）、ADR-018（音響証拠データパイプライン・AcousticEvidence 契約・howJa 分担）、ADR-019（articulatoryEstimate を描画する ArticulationCard.tsx と同居・L2 disclaimer 併存）。
- Author: lihs
- Last updated: 2026-06-19
- Related: ADR-001（GOP / forced-alignment 境界）、ADR-004（worker scoring 所有・structured-diff・messageJa=frontend）、ADR-006（parselmouth GPL-3.0 境界、analyzer 内のみ）、ADR-009（speakerSex 値集合）、ADR-018（本 ADR が supersede / amends する音響診断 DATA パイプライン）、ADR-019（EMA 調音推定の描画コンポーネント ArticulationCard）、ADR-020（ArticulationCard の静的 SVG 図解で同ファイル co-own）。
