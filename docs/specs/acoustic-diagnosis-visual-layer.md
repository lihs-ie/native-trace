# Spec: acoustic-diagnosis-visual-layer

<!-- ADR-024 を正規化。ADR-018 の UI Non-goal (spec acoustic-phonetic-diagnosis.md:449/233) と
     M-APD-16 受入の .tsx ゼロ assert (spec:413-414) を supersede する。
     Open questions Q1/Q2/Q2a/Q3 はすべて解決済みとして本 spec に焼き込む。 -->

## Goal

`ArticulationCard` 配下に独立子コンポーネント `AcousticDiagnosisCard.tsx` を新設し、
ADR-018 が配線済みの `EngineFindingDto.acousticEvidence` を初めて視覚的に描画する。
あわせて、design-system-v3 が要求する数値スカラー（符号付き SD 偏差・スペクトル重心 Hz・
tense 長さ比・ターゲット規範値）を worker `AcousticEvidence` 契約に optional+nullable で追加する。
python-analyzer スキーマは変更しない。scoreImpact も変更しない。

---

## Must（満たさなければ done でない）

### コンポーネント配置・到達性

- [ ] **M-ADVL-1 (コンポーネント配置)**
  `applications/frontend/src/components/workspace/AcousticDiagnosisCard.tsx` が存在すること。
  `ArticulationCard.tsx` が `acousticEvidence: AcousticEvidenceDto | null` を props として受け取り、
  `AcousticDiagnosisCard` へ渡すこと。
  `DetailPanelV2.tsx:479` から `ArticulationCard` → `AcousticDiagnosisCard` への到達経路が実コードとして存在すること。

- [ ] **M-ADVL-2 (null 制御)**
  `acousticEvidence` が `null` のとき `.acoustic` カードが DOM に現れないこと。
  `acousticEvidence` が非 null のとき `.acoustic` カード（`design-components.css:959`）が描画されること。

### カードヘッダ（v3 DOM 契約）

- [ ] **M-ADVL-3 (ヘッダ構成)**
  カードヘッダに以下の 3 要素がすべて存在すること（articulation-card.html:42-46 参照）:
  1. 音素記号（IPA）テキスト
  2. `adr-badge adr-badge--accepted` クラスを持つ「ADR-018 · Accepted」バッジ
  3. `layer-tag layer-tag--enrich` クラスを持つ推定タグ（`components-v3.css:21`）

### 母音四辺形プロット

- [ ] **M-ADVL-4 (母音プロット座標写像)**
  measured 点（`.vp-pt--measured`）と target 点（`.vp-pt--target`）を以下の確定座標式で配置すること:
  - `left% (F2 軸) = clamp((F2Hz − 700) / (2700 − 700), 0, 1) × 100`
  - `top% (F1 軸) = clamp((F1Hz − 200) / (1000 − 200), 0, 1) × 100`
  （F2 大→右=前舌、F1 大→下=低舌。Hillenbrand /iː/ ノルムで left≈80%, top≈18% に着地）

- [ ] **M-ADVL-5 (偏差ベクトル)**
  `.vp-vec` が measured 点から target 点へのベクトルとして描かれること
  （`left`/`top` は measured 点の座標、`width` は 2 点間 px 距離、`transform:rotate()` は向き）。
  プロットの `aspect-ratio: 4/3`, `max-width: 320px`（`components-v3.css:35`）を前提とした px 変換であること。

### 方向チップ + SD/Hz 列

- [ ] **M-ADVL-6 (方向チップ 5 軸)**
  `.dir-grid` 内に以下の 5 軸チップがすべて描画されること（null または "ok" の軸はチップを省略可）:
  `tongueHeight` / `tongueBackness` / `rhoticity` / `sibilantPlace` / `vowelLength`
  各チップは `.dir-k`（軸名）・`.dir-v`（日本語ラベル）・`.dir-hz`（数値）を持つこと
  （articulation-card.html:61-63、components-v3.css:49-59）。

- [ ] **M-ADVL-7 (rhoticity チップ必須 + F3 数値)**
  `rhoticity` が非 null かつ `"ok"` 以外のとき rhoticity チップを必ず表示すること。
  `.dir-hz` 列に `measuredF3Hz`（`api-types.ts:246`）と `targetF3Hz`（`api-types.ts:249`）
  または `signedF3SdDeviation`（新フィールド）を数値として表示すること。
  categorical ラベル文字列のみの表示は不可。

### measure-bar（スカラー由来 fill）

- [ ] **M-ADVL-8 (measure-bar 2 本)**
  `spectralCentroidHz` が非 null のとき「/s| 重心 Hz」measure-bar を表示すること。
  `tenseLengthRatio` が非 null のとき「tense 長さ比」measure-bar を表示すること。
  各バーの `.mb-target` left% は worker が emit する `targetSpectralCentroidHz`
  または `targetTenseLengthRatio` から算出すること（frontend での規範定数ハードコード禁止）。
  各バーの `.mb-val` left% は measured スカラーから算出すること。
  スカラーが null のとき該当 measure-bar を非表示にすること。

### disclaimer

- [ ] **M-ADVL-9 (disclaimer 単一ブロック)**
  acoustic card 内に `.disclaimer` ブロックが 1 つ存在し、以下の 3 caveat をすべて含むこと:
  1. 発話内 Lobanov 正規化
  2. 母音 3 個未満でスキップ
  3. 音響偏差は減点しない（二重減点回避）
  ADR-019 D4 の L2 disclaimer（`ArticulationCard` 上位に存在）と重複描画しないこと。

### Worker 契約拡張（Haskell → zod → TS）

- [ ] **M-ADVL-10 (AcousticEvidence 新フィールド 7 本)**
  `applications/backend/src/NativeTrace/Worker/Types.hs` の `AcousticEvidence` レコードに
  以下 7 フィールドが追加されていること（全て `Maybe Double`）:

  | Haskell フィールド名 | ToJSON wire key |
  |---|---|
  | `acousticSpectralCentroidHz` | `"spectralCentroidHz"` |
  | `acousticTenseLengthRatio` | `"tenseLengthRatio"` |
  | `acousticSignedF1SdDeviation` | `"signedF1SdDeviation"` |
  | `acousticSignedF2SdDeviation` | `"signedF2SdDeviation"` |
  | `acousticSignedF3SdDeviation` | `"signedF3SdDeviation"` |
  | `acousticTargetSpectralCentroidHz` | `"targetSpectralCentroidHz"` |
  | `acousticTargetTenseLengthRatio` | `"targetTenseLengthRatio"` |

  `-Werror=missing-fields` のため `deriveAcousticEvidence`（`Scoring.hs:743`）を含む全レコード構築箇所を更新すること。

- [ ] **M-ADVL-11 (Scoring.hs 算出ロジック)**
  `deriveAcousticEvidence`（`Scoring.hs:743`）が以下を算出すること:
  - `acousticSpectralCentroidHz`: `PhonemeAcoustic` の重心（`Scoring.hs:834` で既参照）を透過。
  - `acousticTenseLengthRatio`: `measuredDurMs / mean(lax vowel durations)`。lax 母音がない・非 tense 音素のとき `Nothing`。
  - `acousticSignedF1SdDeviation`: `(f1 − normF1) / effectiveSdF1`（既存 `deviationLabel` 中間値）。母音でない・ノルム・SD 未取得のとき `Nothing`。
  - `acousticSignedF2SdDeviation`: F2 版（同上）。
  - `acousticSignedF3SdDeviation`: F3 版（同上）。F3 / ノルム未取得のとき `Nothing`。
  - `acousticTargetSpectralCentroidHz`: /s/ → `4500.0`, /ʃ/ → `3500.0`, それ以外 → `Nothing`。
  - `acousticTargetTenseLengthRatio`: tense 音素 → `1.4`, それ以外 → `Nothing`。
  **scoreImpact は変更しない**（ADR-004/ADR-018 D7）。

- [ ] **M-ADVL-12 (zod スキーマ後方互換)**
  `applications/frontend/src/acl/pronunciation-assessment/oss-worker/schema.ts` の
  `findingSchema` の `acousticEvidence` object（`:112-128`）に以下 7 フィールドが追加されていること:
  ```
  spectralCentroidHz: z.number().nullable().optional().transform(v => v ?? null)
  tenseLengthRatio: z.number().nullable().optional().transform(v => v ?? null)
  signedF1SdDeviation: z.number().nullable().optional().transform(v => v ?? null)
  signedF2SdDeviation: z.number().nullable().optional().transform(v => v ?? null)
  signedF3SdDeviation: z.number().nullable().optional().transform(v => v ?? null)
  targetSpectralCentroidHz: z.number().nullable().optional().transform(v => v ?? null)
  targetTenseLengthRatio: z.number().nullable().optional().transform(v => v ?? null)
  ```
  新フィールド欠如時（旧 worker 出力）に parse が成功し `null` へ縮退すること。

- [ ] **M-ADVL-13 (AcousticEvidenceDto 型拡張)**
  `applications/frontend/src/lib/api-types.ts` の `AcousticEvidenceDto`（`:238-250`）に
  以下 7 フィールドが追加されていること（全て `number | null`）:
  `spectralCentroidHz`, `tenseLengthRatio`, `signedF1SdDeviation`, `signedF2SdDeviation`,
  `signedF3SdDeviation`, `targetSpectralCentroidHz`, `targetTenseLengthRatio`。

### scoreImpact 不変

- [ ] **M-ADVL-14 (scoreImpact 不変アサート)**
  `applications/backend/test/NativeTrace/Worker/ScoringSpec.hs` にて
  `acousticEvidence` の有無・新スカラーの有無によらず
  GOP しきい値（`gopMajorThreshold=-12.0` / `gopMinorThreshold=-8.0`）と
  severity→scoreImpact（`Critical=-8.0` / `Major=-5.0` / `Minor=-2.0`）が不変であることを
  `cabal test all` 緑で維持すること。

### supersede 追記

- [ ] **M-ADVL-15 (ADR-018 supersede 注記)**
  `adr/018-acoustic-phonetic-diagnosis-formant-spectral-vot.md` の Status/Notes に
  「UI Non-goal（spec:449、再掲 :233）と M-APD-16 受入の .tsx ゼロ assert（spec:413-414）は ADR-024 が supersede」
  を追記すること。
  `docs/specs/acoustic-phonetic-diagnosis.md:449` の Non-goal と `:413-414` の .tsx ゼロ assert に
  ADR-024 を指す supersede 注記を追加すること。
  M-APD-16 本体の rule-based howJa 分岐 Must（spec:225）は supersede しないこと。
  確認: `grep -n "ADR-024\|supersede" adr/018-* docs/specs/acoustic-phonetic-diagnosis.md` が各ファイルで 1 件以上ヒットすること。

### fitness / wiring / 証跡

- [ ] **M-ADVL-16 (fitness / verify 緑)**
  `pnpm fitness`（ast-grep + ESLint 層間依存）が緑であること。
  `bash scripts/verify-no-prod-doubles.sh` 緑。
  `bash scripts/verify-no-stub-placeholder.sh` 緑。
  `bash scripts/verify-wiring.sh` 緑。
  本番コード（`applications/frontend/src/` / `applications/backend/src/`）に
  mock/stub/fake/dummy/placeholder が存在しないこと。
  オニオン import 方向・Drizzle/OpenAI/parselmouth のレイヤ閉じ込めが不変であること。

- [ ] **M-ADVL-17 (wiring-map 証跡)**
  `.agent-evidence/wiring-map.json` に以下の 2 経路が記録されていること:
  1. 描画経路: `DetailPanelV2.tsx:479 → ArticulationCard → AcousticDiagnosisCard.tsx → .acoustic`
  2. 契約経路: `Scoring.hs:deriveAcousticEvidence → Types.hs:AcousticEvidence(new 7 fields) → findingSchema(zod) → AcousticEvidenceDto`

---

## Should（望ましいが必須でない）

- 母音四辺形の軸ラベル（`vp-axis-x`: F2 → 舌が前 / `vp-axis-y`: F1 ↑ 舌が低い）を design-system-v3.html:941-942 と一致させる。
- 方向チップの `.dir-v` 日本語ラベルと M-APD-16（spec:225）の howJa テキストを語彙として統一し、散文と視覚表示で矛盾しないようにする。
- measure-bar の左端ラベルを `/s/ 重心 Hz` / `tense 長さ比` とし articulation-card.html:66-67 と一致させる。
- `AcousticDiagnosisCard.tsx` が `null` フォールバック時に何も返さない（fragment `<></>`）ではなく `null` を返す（React コンポーネントの慣例に従う）。
- ADR-019/ADR-020 との `ArticulationCard.tsx` 共有編集衝突を避けるため、実装スライス順序を ADR-020 Notes（adr/020:242）の「同 PR で land」方針に揃える。

---

## 受入条件（Must の確認方法）

- **M-ADVL-1** →
  `find applications/frontend/src/components/workspace/ -name "AcousticDiagnosisCard.tsx"` が 1 件ヒットすること。
  `grep -n "acousticEvidence" applications/frontend/src/components/workspace/ArticulationCard.tsx` が props 宣言・呼び出しともヒットすること。
  `grep -n "AcousticDiagnosisCard" applications/frontend/src/components/workspace/ArticulationCard.tsx` が 1 件以上ヒットすること。
  `grep -n "acousticEvidence" applications/frontend/src/app/workspace/components/DetailPanelV2.tsx` が `:479` 周辺で `ArticulationCard` 呼び出しの引数に含まれること。

- **M-ADVL-2** →
  component test: `render(<AcousticDiagnosisCard acousticEvidence={null} />)` で `.acoustic` が DOM に存在しないことを `expect(container.querySelector('.acoustic')).toBeNull()` で assert。
  component test: 非 null fixture で `expect(container.querySelector('.acoustic')).not.toBeNull()` を assert。
  `pnpm test --run` 緑。

- **M-ADVL-3** →
  component test（非 null fixture）: `container.querySelector('.adr-badge--accepted')` が非 null。
  `container.querySelector('.layer-tag--enrich')` が非 null。
  音素記号テキストが DOM 内に存在すること。

- **M-ADVL-4** →
  unit test: `measuredF1Hz=450, measuredF2Hz=1100` を入力したとき
  `left ≈ clamp((1100−700)/2000,0,1)×100 = 20%`、`top ≈ clamp((450−200)/800,0,1)×100 ≈ 31.25%`
  となることを assert（`Math.abs(actual − expected) < 0.5` を許容誤差とする）。
  target 点（targetF1Hz/targetF2Hz）も同式で計算されることを assert。

- **M-ADVL-5** →
  unit test: measured=(62%,46%), target=(80%,18%) のとき `.vp-vec` の
  `width` が `Math.sqrt((dxPx)² + (dyPx)²)` 範囲に入り、`transform` が対応する角度であることを assert
  （プロット幅 320px・高さ 240px を前提とした px 変換で ±2px を許容）。

- **M-ADVL-6** →
  component test: `tongueHeight` が `"tooLow"` を持つ fixture で `.dir-k` テキストに `"tongueHeight"` が含まれることを assert。
  `.dir-hz` テキストが空文字でないことを assert。

- **M-ADVL-7** →
  component test: `rhoticity="insufficient"`, `measuredF3Hz=1800`, `targetF3Hz=2000` を持つ fixture で
  rhoticity チップの `.dir-hz` に `"1800"` か `"2000"` いずれかの数値文字列が含まれることを assert。
  categorical 文字列（`"insufficient"`）だけが表示されていないことを assert。

- **M-ADVL-8** →
  component test: `spectralCentroidHz=3600, targetSpectralCentroidHz=4500` を持つ fixture で
  `.mb-target` の `left` style が `clamp(4500/range, 0, 1)×100` に対応することを assert（±1% 許容）。
  `spectralCentroidHz=null` 時に spectral centroid measure-bar が DOM に存在しないことを assert。
  `tenseLengthRatio=null` 時に tense 長さ比 measure-bar が DOM に存在しないことを assert。

- **M-ADVL-9** →
  component test: `container.querySelectorAll('.disclaimer')` の件数が 1 であることを assert。
  disclaimer テキストに「Lobanov」または「正規化」が含まれること、「3」または「3個」が含まれること、
  「減点」が含まれることを assert。

- **M-ADVL-10** →
  `grep -n "acousticSpectralCentroidHz\|acousticTenseLengthRatio\|acousticSignedF1SdDeviation\|acousticSignedF2SdDeviation\|acousticSignedF3SdDeviation\|acousticTargetSpectralCentroidHz\|acousticTargetTenseLengthRatio" applications/backend/src/NativeTrace/Worker/Types.hs`
  が 7 件以上ヒットすること。
  `grep -n "\"spectralCentroidHz\"\|\"tenseLengthRatio\"\|\"signedF1SdDeviation\"\|\"signedF2SdDeviation\"\|\"signedF3SdDeviation\"\|\"targetSpectralCentroidHz\"\|\"targetTenseLengthRatio\"" applications/backend/src/NativeTrace/Worker/Types.hs`
  が 7 件ヒットすること（ToJSON wire key）。
  `cabal build all` が緑であること（`-Werror=missing-fields` を含む）。

- **M-ADVL-11** →
  `grep -n "acousticSpectralCentroidHz\|acousticTenseLengthRatio\|acousticSignedF1SdDeviation\|acousticTargetSpectralCentroidHz\|acousticTargetTenseLengthRatio" applications/backend/src/NativeTrace/Worker/Scoring.hs`
  が `deriveAcousticEvidence` 付近（`:743` 前後）でヒットすること。
  unit test: `cabal test all` 内の `ScoringSpec.hs` で各スカラーの算出値が既知入力から期待値に一致することを assert。

- **M-ADVL-12** →
  `grep -n "spectralCentroidHz\|tenseLengthRatio\|signedF1SdDeviation\|signedF2SdDeviation\|signedF3SdDeviation\|targetSpectralCentroidHz\|targetTenseLengthRatio" applications/frontend/src/acl/pronunciation-assessment/oss-worker/schema.ts`
  が 7 件以上ヒットすること。
  `applications/frontend/src/acl/pronunciation-assessment/oss-worker/__tests__/schema-and-response-mapper.test.ts` にて:
  - 新 7 フィールドを含む Haskell ToJSON 相当の JSON オブジェクトが zod parse を通過し `AcousticEvidenceDto` の各フィールドに転写されることを assert。
  - 新 7 フィールドを省いた旧 worker 相当の JSON が parse 成功し各フィールドが `null` になることを assert（後方互換）。
  `pnpm test --run` 緑。

- **M-ADVL-13** →
  `grep -n "spectralCentroidHz\|tenseLengthRatio\|signedF1SdDeviation\|signedF2SdDeviation\|signedF3SdDeviation\|targetSpectralCentroidHz\|targetTenseLengthRatio" applications/frontend/src/lib/api-types.ts`
  が 7 件以上ヒットすること。
  `pnpm typecheck` 緑。

- **M-ADVL-14** →
  `grep -n "gopMajorThreshold\|gopMinorThreshold" applications/backend/src/NativeTrace/Worker/Scoring.hs`
  で `-12.0` / `-8.0` が不変であることを確認。
  `grep -n "Critical\|Major\|Minor" applications/backend/src/NativeTrace/Worker/Scoring.hs` で
  `-8.0` / `-5.0` / `-2.0` が不変であることを確認。
  `cabal test all` 緑（`ScoringSpec.hs` の scoreImpact 不変テストを含む）。

- **M-ADVL-15** →
  `grep -n "ADR-024\|supersede" adr/018-acoustic-phonetic-diagnosis-formant-spectral-vot.md` が 1 件以上ヒットすること。
  `grep -n "ADR-024\|supersede" docs/specs/acoustic-phonetic-diagnosis.md` が `:449` 周辺と `:413-414` 周辺の両方でヒットすること。
  `grep -n "M-APD-16.*howJa\|rule-based.*howJa" docs/specs/acoustic-phonetic-diagnosis.md` で Must M-APD-16（`:225`）本体が削除されていないことを確認。

- **M-ADVL-16** →
  `pnpm fitness` 終了コードが 0。
  `bash scripts/verify-no-prod-doubles.sh` 終了コードが 0。
  `bash scripts/verify-no-stub-placeholder.sh` 終了コードが 0。
  `bash scripts/verify-wiring.sh` 終了コードが 0。
  `grep -rn "mock\|stub\|fake\|dummy\|placeholder\|notImplemented\|err501" applications/frontend/src/components/workspace/AcousticDiagnosisCard.tsx` が 0 件。

- **M-ADVL-17** →
  `cat .agent-evidence/wiring-map.json | python3 -c "import sys,json; d=json.load(sys.stdin); assert any('AcousticDiagnosisCard' in str(v) for v in d.values()); assert any('deriveAcousticEvidence' in str(v) for v in d.values()); print('ok')"` が `ok` を出力すること。

---

## Non-goals（今回やらない）

- python-analyzer（`interface/schema.py`）のスキーマ変更。SD 偏差の算出は worker（`Scoring.hs:deriveAcousticEvidence`）が一元所有する。
- `scoreImpact` の変更。音響偏差は presentation/advice 専用であり減点に使わない（ADR-004/ADR-018 D7）。
- 既存 howJa 散文経路（ADR-018 D6 / M-APD-16）の変更・退行。
- `speakerSex` UI 入力の追加（ADR-009 で別途扱う）。
- 新 categorical enum の追加（`TongueHeightLabel` など既存型以外の enum 型を足さない）。
- 上記 7 フィールド以外の `AcousticEvidence` 契約フィールド追加。
- ADR-019（EMA オーバーレイ）・ADR-020（静的 SVG 図解）の実装（共存するが本 ADR が実装しない）。

---

## Risk

- **level**: high-risk
- **escalate_to_opus**: true
- **理由**:
  - クロスレイヤ契約変更（Haskell `AcousticEvidence` ToJSON ↔ zod schema ↔ `AcousticEvidenceDto`）: スキーマ境界
  - Accepted ADR（ADR-018）の UI Non-goal を supersede する: 承認済み判断の更新
  - 新規本番 UI コンポーネント（`AcousticDiagnosisCard.tsx`）追加: public render entrypoint
  - `ArticulationCard.tsx` を ADR-019/ADR-020 と co-own: 同一ファイルの並行編集リスク

---

## 座標写像・ノルム定数（実装上の確定値）

本 spec に焼き込む確定定数（Open question Q2/Q2a 解決済み）:

### 母音四辺形プロット（`vowel-plot`、aspect-ratio 4/3、max-width 320px）

```
left%  = clamp((F2Hz − 700)  / (2700 − 700),  0, 1) × 100   // F2 軸: 高→右(前舌)
top%   = clamp((F1Hz − 200)  / (1000 − 200), 0, 1) × 100    // F1 軸: 高→下(低舌)
```

Hillenbrand /iː/ ノルム（F1≈437Hz, F2≈2761Hz）を代入すると `left≈100%, top≈29%`（範囲端）。
デザイン参照 target left=80%, top=18% はより保守的な値（F2≈2300Hz, F1≈344Hz）。
実装は上式を使用し、target 点が `(80%,18%)` 付近に着地することを受入条件 M-ADVL-4 で確認する。

`.vp-vec` の pixel 変換:
- プロット描画幅 `pw = min(containerWidth, 320)`、描画高 `ph = pw × 3/4`
- measured 点 `(mx, my)` 単位: pixel = `(left% × pw / 100, top% × ph / 100)`
- target 点 `(tx, ty)` 同上
- `width = sqrt((tx−mx)² + (ty−my)²)` px
- `transform = rotate(atan2(ty−my, tx−mx) rad)`

### measure-bar マーカー位置

bar の表示レンジ（left 0% ≈ 最小、left 100% ≈ 最大）は以下で正規化する:
- スペクトル重心 Hz: レンジ `[1000, 8000]`。`left% = clamp((Hz − 1000) / 7000, 0, 1) × 100`
- tense 長さ比: レンジ `[0.5, 2.5]`。`left% = clamp((ratio − 0.5) / 2.0, 0, 1) × 100`

### worker 規範値（Q2 解決済み: frontend ハードコード禁止、worker が emit）

| フィールド (`AcousticEvidence`) | 値 |
|---|---|
| `acousticTargetSpectralCentroidHz` for /s/ | `4500.0` |
| `acousticTargetSpectralCentroidHz` for /ʃ/ | `3500.0` |
| `acousticTargetTenseLengthRatio` for tense | `1.4` |

---

## 関連 ADR / Spec

- **ADR-018** (`adr/018-acoustic-phonetic-diagnosis-formant-spectral-vot.md`): 本 ADR が supersede する UI Non-goal の出典。データパイプライン・`AcousticEvidence` 契約の正本。
- **ADR-004**: scoreImpact 不変原則。
- **ADR-019** (`adr/019-acoustic-to-articulatory-inversion-enrichment-service.md`): `ArticulationCard.tsx` co-owner、L2 disclaimer。
- **ADR-020** (`adr/020-deterministic-how-catalog-depth-articulatory-diagrams.md`): `ArticulationCard.tsx` co-owner、静的 SVG 図解。
- **docs/specs/acoustic-phonetic-diagnosis.md**: M-APD-16（spec:225）の howJa 分岐は不変。`:449`・`:413-414` に本 ADR-024 の supersede 注記を入れる（M-ADVL-15）。
