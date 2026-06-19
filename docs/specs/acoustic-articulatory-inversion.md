# Spec: acoustic-articulatory-inversion

<!-- 設計の正 / 背景:
       adr/019-acoustic-to-articulatory-inversion-enrichment-service.md (Proposed, 2026-06-18)
         D1: engine=articulatory/articulatory (Apache-2.0)。新 GPU-optional 隔離 service `aai`。
             profiles:[aai] / expose 8790 / container native-trace-aai / AAI_URL 既定 http://aai:8790 /
             worker は aai を depends_on しない / AAI_TIMEOUT_SECONDS 既定 120 /
             multipart POST /v1/articulatory-inversion (learner_audio UploadFile + metadata Form JSON) /
             articulatory package + EMA checkpoint は applications/aai/ の中だけ。
         D2: floor (静的 SVG + articulation-data steps + reference TTS) は常に描く。AAI は enrichment。
             ※ floor (D2) は既に landed (gap-analysis 参照)。本スライスは AAI enrichment 層のみ。
         D3-a: 12-dim EMA → 6 wire 座標 (tongueTip/tongueDorsum はそのまま透過;
               lipApertureY=lowerLipY−upperLipY, lipApertureX=(upperLipX+lowerLipX)/2; 下顎切歯+舌体は drop)。
         D3-b: 発話内 z-score 正規化 → [-1,1] クランプ。service が所有 (モデルの機能ではない)。
         D3-c: displayEligibility = validFrameRatio × voicingRatio × durationAdequacy
               (モデル予測分散ではない)。
         D4: ガードレール (全て満たすときのみ表示、1 つでも欠ければ suppress→floor):
             HTTP 200 + timeout / displayEligibility ≥ 0.55 / 音素クラス=vowel/approximant(/r/,/l/) /
             segment ≥ 50ms / L2 disclaimer 併置 / 音響併置 (reference TTS 同一カード、Kocjancic 2025)。
         D5: 境界は既存 analyzedPerPhonemeGop から (新規境界計算なし);
             worker は aai 無効/失敗/ガードレール未達のとき Nothing; floor は常に描く。
     関連 ADR (contract invariant):
         ADR-004: AAI は presentation-only。減点 allow-list (substitution/omission/insertion/epenthesis) 不変。
         ADR-006: GPL 隔離前例。transitive GPL 混入時のみ service 境界隔離 + ast-grep allow を aai に拡張。
         ADR-012: golden-speaker GPU-optional 隔離 service の前例 (profiles ゲート / boundary 環境変数 /
                  depends_on しない / 同 PR fitness rule / HF cache volume / weights 非焼込 /
                  明示 timeout 120s / multipart request 契約)。aai service と AaiClient.hs はこの写し。
         ADR-013: worker→analyzer multipart/form-data 呼出 + analyzedPerPhonemeGop の境界を aai に渡せる前例。
         ADR-017: insertionPositionMs を境界で取りこぼした不具合の再発防止 (新フィールドは必ず mapper に配線)。
     配線点 (agent-policy §wiring):
         aai service: applications/aai/src/aai/interface/http_handler.py (router→app.py の include_router)
         aai service: applications/aai/src/aai/interface/schema.py (ArticulatoryInversionResponse)
         aai service: applications/aai/src/aai/infrastructure/articulatory_inversion.py (articulatory lazy import)
         aai service: applications/aai/src/aai/{usecase,domain}/ + app.py + main.py + Dockerfile + pyproject.toml + test/
         backend: Worker/AaiClient.hs (新 module, GoldenSpeakerClient.hs 雛形, cabal exposed-modules 追加)
         backend: Worker/Types.hs (ArticulatoryEstimate + findingArticulatoryEstimate + ToJSON key)
         backend: Worker/Application.hs assessPronunciation (analyzeAudio 後の aai 配線 + D4 ガードレール)
         frontend: lib/api-types.ts (ArticulatoryEstimateDto + EngineFindingDto.articulatoryEstimate)
         frontend: acl/pronunciation-assessment/oss-worker/{schema.ts,response-mapper.ts} (mapper round-trip)
         frontend: components/workspace/ArticulationCard.tsx (EMA オーバーレイ + elig + disclaimer + layer-tag)
         compose.yaml: aai service (profiles:[aai], expose 8790, hf-cache-aai volume) + worker env AAI_URL/AAI_TIMEOUT_SECONDS
         .ast-grep/rules/no-articulatory-inversion-outside-aai.yml (ADR-005 same-PR fitness)
         wiring_manifest.yml: worker→aai HTTP edge
     強制レイヤ: scripts/verify-no-stub-placeholder.sh / verify-wiring.sh / verify-no-prod-doubles.sh +
                 fitness hook + CI。ast-grep no-articulatory-inversion-outside-aai (新規ルール)。
     rebuild 注意: worker/aai はバイナリ/イメージ焼き込み。コード変更後は
                   `docker compose up -d --build worker` および
                   `docker compose --profile aai up -d --build aai` が必須
                   (memory: docker-rebuild-required-for-code-changes)。 -->

## Goal

- 死んでいる `ArticulationCard.tsx` の調音アフォーダンスに、学習者本人の発音から ML 推定した
  舌・唇位置 (EMA) を矢状断面 SVG に重ねる **GPU-optional 隔離 enrichment service `aai`** を追加する。
  既存の静的調音コンテンツ floor (D2、既に landed) はそのままに、その上に条件付きで重なる層を実装する。
- AAI は L2 (日本語訛り) で誤りうるため、表示適格性プロキシ・音素クラス・セグメント長・disclaimer・
  音響併置の **ガードレール (D4)** を全て満たすときだけ表示し、1 つでも欠ければ floor に degrade する。
- AAI は presentation-only であり scoreImpact / ADR-004 減点 allow-list に一切影響しない。
  profiles:[aai] 無効が既定で、aai 不在でも全機能が動く (CPU baseline 維持、REQ-NF-102)。

## Must (満たさなければ done でない)

### aai service — エンジン隔離・HTTP 契約 (D1)

- [ ] **M-AAI-1 (aai service が golden 同型で隔離される — D1)**
  `applications/aai/` を新規作成し、golden-speaker のレイアウト
  (`applications/aai/src/aai/{interface,usecase,domain,infrastructure}/` + `app.py` + `main.py` +
  `Dockerfile` + `pyproject.toml` + `test/`) を踏襲すること。
  `compose.yaml` に service `aai` を追加すること。`profiles: [aai]` でゲートし無効時は起動しないこと、
  `container_name: native-trace-aai`、`expose: ["8790"]` (golden の 57–89 行と同型) であること、
  HF cache volume `hf-cache-aai` を持つこと (weights 非焼込、golden M-GRV-10)。
  worker service の `environment` に `AAI_URL: "http://aai:8790"` と `AAI_TIMEOUT_SECONDS: "120"` を
  追加すること。worker は `aai` を `depends_on` しないこと (golden M-GRV-9 と同型)。

- [ ] **M-AAI-2 (POST /v1/articulatory-inversion が multipart で受ける — D1 / Contract)**
  `applications/aai/src/aai/interface/http_handler.py` に `POST /v1/articulatory-inversion` を
  multipart/form-data で実装すること (golden http_handler.py と同型:
  `learner_audio: UploadFile = File(...)`, `metadata: str = Form(...)`)。
  `metadata` JSON は `{ mimeType: str, sampleRate: int, boundaries: [{phoneme, startMs, endMs}] }`。
  audio を JSON に base64 で詰めないこと (request は multipart; golden の非対称を踏襲)。
  `GET /health` を持ち、`app.py` の Composition Root で `include_router` して到達可能にすること
  (ORPHAN-1 配線点)。

- [ ] **M-AAI-3 (articulatory package + checkpoint が aai 内だけに閉じる — D1 / Compliance)**
  `articulatory` package の Speech-to-EMA checkpoint import は
  `applications/aai/src/aai/infrastructure/articulatory_inversion.py` の内部スコープだけで行うこと
  (golden の rvc_engine.py の `try/except ImportError` 遅延 import パターンを踏襲し、
  torch/checkpoint 不在環境で graceful degrade すること)。
  frontend / worker / python-analyzer は `articulatory` を一切 import しないこと。
  EMA checkpoint は image に焼き込まず HF cache volume で扱うこと (再配布条項が不可の場合; M-GRV-10)。

### aai service — 出力表現・写像・正規化・適格性 (D3)

- [ ] **M-AAI-4 (12-dim EMA → 6 wire 座標写像 — D3-a)**
  `articulatory_inversion.py` 内部で 12-dim EMA (6 sensor × XY: lower incisor / upper lip / lower lip /
  tongue tip / tongue body / tongue dorsum) を 6 wire 座標へ縮約すること:
  - `tongueTipX, tongueTipY` ← tongue tip sensor XY (そのまま透過)。
  - `tongueDorsumX, tongueDorsumY` ← tongue dorsum sensor XY (そのまま透過)。
  - `lipApertureY = lowerLipY − upperLipY`、`lipApertureX = (upperLipX + lowerLipX) / 2`。
  - lower incisor (下顎切歯) と tongue body を wire から落とすこと。
  lip aperture が native EMA チャネルではなく上下唇からの導出量である旨を docstring に明記すること。

- [ ] **M-AAI-5 (発話内 z-score 正規化 → [-1,1] クランプ — D3-b)**
  aai service が当該発話の全 EMA フレームの各チャネル平均・標準偏差で z 化し、その後 [-1.0, 1.0] に
  クランプ写像すること。正規化は service の責務であり**モデルが正規化済み座標を出すわけではない**旨を
  docstring に明記すること (hallucination 防止)。生 mm を wire に出さないこと。

- [ ] **M-AAI-6 (displayEligibility = validFrameRatio × voicingRatio × durationAdequacy — D3-c)**
  per-phoneme に `displayEligibility: float [0.0,1.0]` を返すこと。算出は**モデル内部の予測分散ではなく**、
  当該セグメントの EMA 軌跡から導く合成スコアとすること:
  - `validFrameRatio` = (NaN/不正でない EMA フレーム数) / (セグメント内全フレーム数)。
  - `voicingRatio` = セグメント内で基本周波数が検出された (有声) フレーム比率
    (audio から service 内で軽量に算出、モデル非依存)。
  - `durationAdequacy` = `min(1.0, (endMs − startMs) / 50)`。
  - `displayEligibility = validFrameRatio × voicingRatio × durationAdequacy`。

- [ ] **M-AAI-7 (ArticulatoryInversionResponse contract — Contract / Compliance)**
  `applications/aai/src/aai/interface/schema.py` に
  `ArticulatoryInversionResponse(BaseModel)` = `{ perPhoneme: list[ArticulatoryEstimateResponse] }`、
  `ArticulatoryEstimateResponse` = `{ phoneme: str, startMs: int, endMs: int,
  tongueTipX: float, tongueTipY: float, tongueDorsumX: float, tongueDorsumY: float,
  lipApertureX: float, lipApertureY: float, displayEligibility: float }` を定義すること。
  全フィールド camelCase (golden schema の `# noqa: N815` 同型) であること。座標は [-1.0, 1.0]。
  下顎/舌体チャネル・生 mm・モデル内部 EMA index を絶対に露出しないこと
  (常に 6 座標 + displayEligibility のみ)。

### backend worker — 型・配線・ガードレール (D4 / D5 / Contract)

- [ ] **M-AAI-8 (Types.hs — ArticulatoryEstimate + AssessmentFinding 拡張 — Contract)**
  `applications/backend/src/NativeTrace/Worker/Types.hs` に新規
  `data ArticulatoryEstimate = ArticulatoryEstimate { aeTongueTipX :: Double, aeTongueTipY :: Double,
  aeTongueDorsumX :: Double, aeTongueDorsumY :: Double, aeLipApertureX :: Double, aeLipApertureY :: Double,
  aeDisplayEligibility :: Double }` を追加し ToJSON を実装すること。
  wire key は camelCase: `tongueTipX` / `tongueTipY` / `tongueDorsumX` / `tongueDorsumY` /
  `lipApertureX` / `lipApertureY` / `displayEligibility`。
  `AssessmentFinding` に `findingArticulatoryEstimate :: Maybe ArticulatoryEstimate` を追加し、
  ToJSON で `"articulatoryEstimate" .= findingArticulatoryEstimate finding` を既存 key 末尾に出力すること
  (null 既定で後方互換)。export list に `ArticulatoryEstimate (..)` を追加すること。
  `-Werror=missing-fields` に留意し `AssessmentFinding` の全レコード生成箇所を更新すること
  (memory: haskell-per-edit-hook-burns-subagent-budget — 大 Haskell タスクは subagent 分割推奨)。

- [ ] **M-AAI-9 (AaiClient.hs — 新 module + cabal exposed — D5 / Contract)**
  `applications/backend/src/NativeTrace/Worker/AaiClient.hs` を `GoldenSpeakerClient.hs` を雛形に新規作成すること
  (multipart body 組み立て + `responseTimeout` 明示 + status200 分岐 + 5xx→err502)。
  `AAI_URL` を読み、未設定時は `Nothing` を返すこと (golden M-GRV-9 軟無効化と同型、`err503` ではなく
  worker 側が enrichment を `Nothing` に倒せる形であること)。
  `AAI_TIMEOUT_SECONDS` を読み、未設定/不正時は 120 を返すこと (golden 同値、incident 2026-06-14 と整合)。
  `learner_audio`(=audioBytes) + `metadata`(JSON: mimeType/sampleRate/boundaries) の multipart で
  `AAI_URL/v1/articulatory-inversion` へ POST すること。
  `native-trace-worker.cabal` の `exposed-modules` に `NativeTrace.Worker.AaiClient` を追加すること。

- [ ] **M-AAI-10 (Application.hs assessPronunciation — aai 配線 + 境界は既存 GOP から — D5)**
  `applications/backend/src/NativeTrace/Worker/Application.hs` の `assessPronunciation` で、
  `analyzeAudio` の後に `analyzerResult` の `analyzedPerPhonemeGop`
  (`PhonemeGop{gopPhoneme, gopStartMs, gopEndMs}`) から `{phoneme, startMs, endMs}` を抽出し、
  元の `audioBytes` / `audioContentType` と共に AaiClient へ渡すこと。**新たな境界計算をしないこと**。
  AAI_URL 未設定・aai 失敗・全 per-phoneme がガードレール未達のとき `findingArticulatoryEstimate` を
  全 finding で `Nothing` にすること (floor は常に揃う)。`buildAssessmentResponseFromGop` 経由で
  `findingArticulatoryEstimate` を埋める配線にすること。

- [ ] **M-AAI-11 (D4 ガードレール — 全て満たす finding のみ非 null — D4 / Compliance)**
  AAI enrichment を finding に乗せる (`findingArticulatoryEstimate = Just ...`) のは次を**全て**満たす
  per-phoneme に限ること。1 つでも欠ければ `Nothing` (suppress→floor):
  1. **service 到達**: aai が HTTP 200 を返す。timeout (`AAI_TIMEOUT_SECONDS`, 既定 120s) 超過・
     接続失敗時は suppress。
  2. **表示適格性ゲート**: `displayEligibility >= 0.55` (calibratable, worker の Scoring 層に定数を置く)。
  3. **音素クラスゲート**: vowel と approximant /r/,/l/ のみ許可。stop/fricative は suppress (floor に委譲)。
  4. **セグメント長ゲート**: `endMs − startMs >= 50ms`。
  5. (UI 側で) L2 disclaimer 併置 + 音響併置 (M-AAI-14 で担保)。
  しきい値 0.55 / 50ms はドメインリテラルとして Scoring 層に calibratable 定数で定義し、
  AaiClient.hs / Application.hs にマジックナンバーを散らさないこと。

### frontend — 型・配線・UI (Contract / D4 / D5)

- [ ] **M-AAI-12 (api-types.ts — ArticulatoryEstimateDto + EngineFindingDto — Contract)**
  `applications/frontend/src/lib/api-types.ts` に新規
  `export type ArticulatoryEstimateDto = { tongueTipX: number; tongueTipY: number;
  tongueDorsumX: number; tongueDorsumY: number; lipApertureX: number; lipApertureY: number;
  displayEligibility: number };` を追加すること。
  `EngineFindingDto` に `articulatoryEstimate: ArticulatoryEstimateDto | null` を
  既存 `feedbackLayers` / `acousticEvidence` の隣に追加すること (null は enrichment 不在 = floor のみ描画)。

- [ ] **M-AAI-13 (response-mapper.ts — articulatoryEstimate を取りこぼさない — Contract / ADR-017)**
  `applications/frontend/src/acl/pronunciation-assessment/oss-worker/schema.ts` の `findingSchema` に
  `articulatoryEstimate` を optional+nullable (`acousticEvidence` と同型の `.nullable().optional()
  .transform(v => v ?? null)`) で追加すること。
  `response-mapper.ts` の `findings.map(...)` で worker の `articulatoryEstimate` を
  `EngineFindingDto.articulatoryEstimate` に写像すること。**欠落時は `null`** にすること
  (ADR-017 の insertionPositionMs 境界落ち再発防止 — mapper に必ず配線する)。

- [ ] **M-AAI-14 (ArticulationCard.tsx — EMA オーバーレイ + disclaimer + 音響併置 — D4 / D5)**
  `applications/frontend/src/components/workspace/ArticulationCard.tsx` に
  props `articulatoryEstimate?: ArticulatoryEstimateDto | null` を追加すること。
  `articulatoryEstimate` が非 null かつ `displayEligibility >= 0.55` のとき、既に landed 済みの floor 静的
  SVG (`.sagittal-wrap` の `<img>`) の上に EMA 座標オーバーレイ (`.ema-layer` / `.ema-pt--tip` /
  `--dorsum` / `--lip` / `.ema-target`) と適格性メーター (`.elig`、55% ゲート) と L2 disclaimer
  注記 (`.disclaimer`) と layer-tag (`.layer-tag--enrich`) を重ねること。
  null または `displayEligibility < 0.55` のときは floor (静的 SVG + steps テキスト) のみ描くこと。
  reference TTS 再生ボタンとの同一カード併置を維持すること (Kocjancic 2025、音響非併置の図解単独を描かない)。
  既存の design-components.css §0/§2 / globals.css v3 トークンの**既存クラスを使う**こと (新クラス命名禁止)。
  floor 描画は既に landed 済みのため**回帰させない**こと。

### compliance — fitness / wiring / 証跡 (Compliance / agent-policy)

- [ ] **M-AAI-15 (ast-grep no-articulatory-inversion-outside-aai — Compliance / ADR-005)**
  `.ast-grep/rules/no-articulatory-inversion-outside-aai.yml` を新規追加すること
  (`no-parselmouth-outside-python-analyzer.yml` / `no-rvc-outside-golden-speaker.yml` と同型)。
  `import articulatory` / `from articulatory import` が `applications/aai/` 以外に現れることを禁止すること。
  同 PR で追加すること (ADR-005 same-PR 規則)。

- [ ] **M-AAI-16 (wiring_manifest.yml — worker→aai HTTP edge — Compliance)**
  `wiring_manifest.yml` に worker→aai の HTTP edge rule を追加すること
  (golden の `golden-speaker-*` rule 群と同型: aai http_handler→app.py の include_router、
  `applications/aai/**` 変更時の compose.yaml/wiring_manifest 共変更、aai schema→compose 一致)。
  aai service が frontend/worker の内部型を import しない (HTTP 契約のみ) ことを assert する記述を残すこと。

- [ ] **M-AAI-17 (scoreImpact 不変アサート — Non-goal / ADR-004)**
  `cabal test all` で、`findingArticulatoryEstimate` が `Just` の finding と `Nothing` の finding で
  同一 GOP に対し同一 `scoreImpact` が返ることを unit test で assert すること。
  ADR-004 減点 allow-list (substitution/omission/insertion/epenthesis) と
  GOP しきい値 / severity→scoreImpact が `articulatoryEstimate` 追加で変わらないことを確認すること。

- [ ] **M-AAI-18 (agent-policy: 証跡 + 決定論ゲート — agent-policy)**
  本番コードに mock / stub / fake / dummy / spy / test-bypass / placeholder stub
  (`err501` / `notImplemented` / `raise NotImplementedError`) を含まないこと
  (`scripts/verify-no-stub-placeholder.sh` / `verify-no-prod-doubles.sh` 緑)。
  `scripts/verify-wiring.sh` 緑。`pnpm fitness` (ast-grep + ESLint 層間依存) 緑。
  `cabal build all` / `cabal test all` 緑。`pnpm lint` / `pnpm typecheck` / `pnpm test --run` 緑。
  `.agent-evidence/acoustic-articulatory-inversion/{commands.txt,wiring-map.json,completion-report.md}`
  を提出すること。`wiring-map.json` に
  `articulatory_inversion.py → schema.ArticulatoryInversionResponse → http_handler → app.py →
  AaiClient.hs → Application.hs assessPronunciation (D4 guardrails) → Types.hs ArticulatoryEstimate →
  findingSchema (zod) → response-mapper → ArticulatoryEstimateDto → ArticulationCard.tsx EMA overlay`
  の経路を記述すること。

## Should (望ましいが必須でない)

- **S-AAI-1 (校正未成熟時のしきい値引き上げ)**: EMA→矢状断面 SVG オーバーレイ写像の校正が未成熟な間は、
  表示適格性しきい値を 0.55 ではなく 0.7 に寄せて enrichment を控えること (calibratable、ADR Notes risk)。
  しきい値変更が 1 定数で済むよう Scoring 層に集約しておくこと。
- **S-AAI-2 (motivation と suppress 挙動の緊張を明記)**: /r/-/l/ が articulatory/articulatory
  (MNGU0 単一英国男性話者) の cross-speaker 汎化に依存し、日本語訛り /r/→[ɾ] は学習分布外でガードレール
  により suppress されうる旨をコード/docstring/ADR risk に残すこと (動機だった音素ほど出ない場面が残る)。
- **S-AAI-3 (transitive GPL 確認手順コメント)**: `articulatory_inversion.py` または Dockerfile 付近に、
  torch 等 transitive 依存に GPL が混入した場合は ADR-006 前例 (service 境界隔離 + ast-grep allow を aai に
  拡張 + ADR amend) で対処する旨をコメントで残すこと (実装時に依存ツリー確認)。
- **S-AAI-4 (re-record delta 拡張点コメント)**: `ArticulatoryEstimate` ToJSON 付近に、将来 re-record 後の
  「EMA が目標調音へ動いたか」delta 表示への拡張点をコメントで残すこと。
- **S-AAI-5 (Status=Proposed の実機検証 TODO)**: 実装着手スライスで (a) checkpoint が実機 CPU で日本語訛り
  発話に対し displayEligibility ガードレールをどの頻度で満たすか、(b) EMA→SVG 写像の校正、を実機検証し
  ADR を Accepted に昇格する手順を completion-report に記すこと。

## 受入条件 (acceptance — Must の確認方法)

> worker/aai はバイナリ/イメージ焼き込みのため、コード変更後は
> `docker compose up -d --build worker` および `docker compose --profile aai up -d --build aai` が必須
> (memory: docker-rebuild-required-for-code-changes)。

- **M-AAI-1** →
  `ls applications/aai/src/aai/interface/http_handler.py applications/aai/app.py applications/aai/Dockerfile`
  でファイルが存在すること。
  `grep -n "native-trace-aai\|profiles\|8790\|hf-cache-aai" compose.yaml` で service 定義が確認できること。
  `grep -n "AAI_URL\|AAI_TIMEOUT_SECONDS" compose.yaml` で worker env への追加が確認できること
  (`AAI_URL: "http://aai:8790"` / `AAI_TIMEOUT_SECONDS: "120"`)。
  `grep -n "depends_on" compose.yaml` の worker ブロックに `aai` が含まれないこと。

- **M-AAI-2** →
  `grep -n "articulatory-inversion\|UploadFile\|Form\|include_router" applications/aai/src/aai/interface/http_handler.py applications/aai/src/aai/app.py`
  で multipart endpoint と Composition Root の include_router が確認できること。
  live: `docker compose --profile aai up -d --build aai && curl -fsS localhost:8790/health` が 200。
  contract test: base64 JSON body を投げると拒否され、`learner_audio` File + `metadata` Form JSON が
  受理されること (golden 前例との request 形一致)。

- **M-AAI-3** →
  `grep -rn "import articulatory\|from articulatory" applications/ | grep -v "applications/aai/"` が 0 件。
  `grep -n "try:\|ImportError\|import articulatory" applications/aai/src/aai/infrastructure/articulatory_inversion.py`
  で遅延 import が確認できること。
  torch/checkpoint 不在環境で import error にならず graceful degrade する unit test が緑であること。

- **M-AAI-4** →
  `grep -n "lipApertureY\|lipApertureX\|lowerLipY\|upperLipY\|tongue body\|lower incisor\|tongueTip\|tongueDorsum" applications/aai/src/aai/infrastructure/articulatory_inversion.py`
  で写像が確認できること (`lipApertureY = lowerLipY − upperLipY` / `lipApertureX = (upperLipX+lowerLipX)/2`、
  下顎切歯・舌体を drop)。
  unit test: 既知の 12-dim EMA 入力に対し 6 wire 座標が D3-a の式どおりに計算されること、
  出力に下顎/舌体チャネルが含まれないこと。

- **M-AAI-5** →
  `grep -n "z-score\|zscore\|mean\|std\|clamp\|-1.0\|1.0\|service が\|モデルが正規化" applications/aai/src/aai/infrastructure/articulatory_inversion.py`
  で発話内 z 化 + [-1,1] クランプと docstring 注記が確認できること。
  unit test: 全座標が [-1.0, 1.0] に収まること。生 mm 値が response に現れないこと。

- **M-AAI-6** →
  `grep -n "validFrameRatio\|voicingRatio\|durationAdequacy\|displayEligibility" applications/aai/src/aai/infrastructure/articulatory_inversion.py`
  で 3 構成要素の積が確認できること。
  unit test: `durationAdequacy = min(1.0, (endMs−startMs)/50)`、
  `displayEligibility = validFrameRatio × voicingRatio × durationAdequacy` が成り立つこと。
  予測分散/不確実度に依存する語 (`variance` / `uncertainty`) を eligibility 算出に使っていないこと
  (grep で 0 件、verifier 指摘 #1)。

- **M-AAI-7** →
  `grep -n "ArticulatoryInversionResponse\|ArticulatoryEstimateResponse\|displayEligibility\|tongueTipX" applications/aai/src/aai/interface/schema.py`
  で contract が確認できること。
  contract test: response が常に 6 座標 (tongueTip/tongueDorsum/lipAperture XY) + displayEligibility を
  返し、下顎・舌体チャネル・生 mm を露出しないこと。全 key が camelCase であること。

- **M-AAI-8** →
  `grep -n "ArticulatoryEstimate\|findingArticulatoryEstimate\|aeTongueTipX\|aeDisplayEligibility" applications/backend/src/NativeTrace/Worker/Types.hs`
  で data 定義・ToJSON・AssessmentFinding フィールド追加・export が確認できること。
  `grep -n "tongueTipX\|tongueDorsumX\|lipApertureX\|displayEligibility" applications/backend/src/NativeTrace/Worker/Types.hs`
  で wire key (camelCase) が確認できること。`cabal build all` 緑 (`-Werror=missing-fields` を含む)。

- **M-AAI-9** →
  `ls applications/backend/src/NativeTrace/Worker/AaiClient.hs` でファイルが存在すること。
  `grep -n "AAI_URL\|AAI_TIMEOUT_SECONDS\|responseTimeout\|articulatory-inversion\|multipart" applications/backend/src/NativeTrace/Worker/AaiClient.hs`
  で URL/timeout 読み込みと multipart POST が確認できること。
  `grep -n "NativeTrace.Worker.AaiClient" applications/backend/native-trace-worker.cabal` で exposed-modules
  追加が確認できること。AAI_URL 未設定時に `Nothing`/軟無効化となる挙動の unit test が緑であること。
  `cabal build all` 緑。

- **M-AAI-10** →
  `grep -n "AaiClient\|articulatoryEstimate\|analyzedPerPhonemeGop\|findingArticulatoryEstimate" applications/backend/src/NativeTrace/Worker/Application.hs`
  で analyzeAudio 後の aai 配線と境界抽出が確認できること。
  `grep -n "gopStartMs\|gopEndMs\|gopPhoneme" applications/backend/src/NativeTrace/Worker/Application.hs`
  で既存 GOP 境界からの抽出 (新規境界計算なし) が確認できること。
  unit test: AAI_URL 未設定/失敗のとき全 finding の `findingArticulatoryEstimate = Nothing`。
  `cabal test all` 緑。

- **M-AAI-11** →
  `grep -n "0.55\|displayEligibility\|>= 50\|vowel\|approximant" applications/backend/src/NativeTrace/Worker/Scoring.hs`
  で D4 calibratable しきい値と音素クラス分岐が Scoring 層に確認できること。
  unit test (label/gate test):
  (a) vowel/approximant かつ displayEligibility=0.6 かつ 60ms かつ HTTP 200 の per-phoneme で
      `findingArticulatoryEstimate = Just ...`。
  (b) displayEligibility=0.5 (<0.55) で `Nothing`。
  (c) stop/fricative 音素で `Nothing`。
  (d) 40ms (<50ms) セグメントで `Nothing`。
  4 ケースを unit test で assert すること。`cabal test all` 緑。

- **M-AAI-12** →
  `grep -n "ArticulatoryEstimateDto\|articulatoryEstimate" applications/frontend/src/lib/api-types.ts`
  で型定義と `EngineFindingDto` フィールド追加が確認できること。`pnpm typecheck` 緑。

- **M-AAI-13** →
  `grep -n "articulatoryEstimate" applications/frontend/src/acl/pronunciation-assessment/oss-worker/schema.ts applications/frontend/src/acl/pronunciation-assessment/oss-worker/response-mapper.ts`
  で zod スキーマと mapper 写像が確認できること。
  unit test: worker が `articulatoryEstimate: { tongueTipX: 0.1, ..., displayEligibility: 0.6 }` を含む
  JSON を返すと `findingSchema.parse(...)` 成功かつ mapper が `EngineFindingDto.articulatoryEstimate` を
  保持すること (round-trip)。
  unit test: `articulatoryEstimate` キー absent な旧フォーマット JSON も成功し `null` に写像されること
  (ADR-017 取りこぼし再発防止 + 後方互換)。`pnpm test --run` 緑。

- **M-AAI-14** →
  `grep -n "articulatoryEstimate\|ema-layer\|ema-pt\|elig\|disclaimer\|layer-tag" applications/frontend/src/components/workspace/ArticulationCard.tsx`
  で props 追加と既存 v3 クラスでのオーバーレイ・disclaimer・適格性メーター描画が確認できること。
  `grep -n "class .ema\|class .artic\|\.new-" applications/frontend/src/styles/` 等で**新規 CSS クラスを
  定義していない**こと (既存 design-components.css §0/§2 / globals.css v3 トークンのみ使用)。
  unit/component test: `articulatoryEstimate=null` のとき floor (静的 SVG + steps) のみ描画され、
  `displayEligibility>=0.55` の非 null のとき `.ema-layer` + `.disclaimer` が描画されること。
  floor 描画 (既 landed) が回帰しないこと。reference TTS ボタンが同一カード内に残ること。
  `pnpm test --run` 緑。

- **M-AAI-15** →
  `ls .ast-grep/rules/no-articulatory-inversion-outside-aai.yml` でファイルが存在すること。
  `pnpm fitness` (= `ast-grep scan` + ESLint) 緑。
  検証: `applications/aai/` 外に `import articulatory` を一時的に置くと ast-grep が違反を出すこと
  (ルールが実効であることの確認)。

- **M-AAI-16** →
  `grep -n "aai" wiring_manifest.yml` で worker→aai edge / aai entrypoint→app wiring /
  aai compose edge の rule が確認できること。`bash scripts/verify-wiring.sh` 緑。

- **M-AAI-17** →
  `grep -n "scoreImpact\|articulatoryEstimate" applications/backend/test/` 等で不変アサートテストが
  確認できること。
  unit test: `findingArticulatoryEstimate` が Just/Nothing で同一 GOP の `scoreImpact` が同値
  (少なくとも major / minor の 2 ケース)。
  `grep -n "substitution\|omission\|insertion\|epenthesis" applications/backend/src/NativeTrace/Worker/Scoring.hs`
  で減点 allow-list が不変であること。`cabal test all` 緑。

- **M-AAI-18** →
  `bash scripts/verify-no-stub-placeholder.sh` / `bash scripts/verify-no-prod-doubles.sh` /
  `bash scripts/verify-wiring.sh` 緑 (staged または working-tree mode)。
  `pnpm fitness` 緑。`cabal build all` / `cabal test all` 緑。
  `pnpm lint` / `pnpm typecheck` / `pnpm test --run` 緑。
  `.agent-evidence/acoustic-articulatory-inversion/` の 3 ファイル (commands.txt / wiring-map.json /
  completion-report.md) が存在すること。
  `commands.txt` に live worker→aai への実録音投入コマンドと、(a) vowel/approximant 高適格性で
  `articulatoryEstimate` 非 null + UI オーバーレイ + disclaimer 観測、(b) stop/fricative・短セグメント・
  低適格性で null + floor のみ、(c) aai 停止時に floor へ degrade、の観測実値を記録すること
  (runtime-verify、ADR Compliance ランタイム検証)。

### Compliance 項目 (ADR Compliance 節 → 受入条件への翻訳)

- **ast-grep (no-articulatory-inversion-outside-aai)** → M-AAI-3 の grep + M-AAI-15 の `pnpm fitness` で判定可能。
- **wiring_manifest worker→aai edge** → M-AAI-16 の `verify-wiring.sh` で判定可能。
- **contract test (multipart, not base64)** → M-AAI-2 の contract test で判定可能。
- **contract test (常に 6 座標 + displayEligibility, 下顎/舌体/生 mm なし)** → M-AAI-7 の contract test で判定可能。
- **contract test (D4 ガードレール null/非 null 挙動)** → M-AAI-11 の unit test (a)–(d) で判定可能。
- **contract test (response-mapper round-trip + 欠落時 null)** → M-AAI-13 の unit test で判定可能。
- **optional ゲート (profiles:[aai] 無効 → build+run / worker Nothing / frontend floor-only, REQ-NF-102)**
  → M-AAI-10 の unit test (AAI_URL 未設定 → Nothing) + M-AAI-14 の floor-only test + M-AAI-18 の
  runtime-verify (c) で判定可能。
- **runtime assert (vowel/approximant 高適格性 → 非 null overlay+disclaimer; stop/fricative/短/低適格性
  → null floor-only; aai 停止 → floor degrade)** → M-AAI-18 の commands.txt 観測実値で判定可能。
- **code-review rubric (scoreImpact 不変 / 生 mm・話者非正規化値・下顎・舌体 wire 非露出 /
  displayEligibility が予測分散でなく EMA 軌跡プロキシ / 図解は reference TTS 同一カード併置)**
  → M-AAI-17 (scoreImpact) + M-AAI-5/M-AAI-7 (mm/チャネル) + M-AAI-6 (proxy) + M-AAI-14 (併置) で判定可能。

## Non-goals (今回やらない)

- **AAI 自前 fine-tune**: 日本語 L2 English EMA データが存在しないため scope 外 (将来 verification phase)。
- **日本語 L2 EMA データ収集**: phonetics lab 連携前提で MVP scope 外。
- **3D avatar / 3D 舌形状**: 2D 矢状断面 SVG オーバーレイのみ。断定的 3D 提示はしない。
- **下顎/舌体チャネル・生 mm の wire 露出**: 意図的に drop。常に 6 正規化座標 + displayEligibility のみ。
- **stop/fricative の調音アニメ**: EMA 予測が不安定なため suppress し floor (steps + 静的 SVG) に委譲。
- **音響特徴計測 (formant / VOT / spectral centroid)**: ADR-018 / 別 ADR の範囲。本 ADR は依存しない。
- **AAI を scoreImpact に反映すること**: AAI は presentation-only。ADR-004 減点 allow-list
  (substitution/omission/insertion/epenthesis) は不変。二重減点しない。
- **floor (D2) の再実装**: floor (articulation-data.ts steps + 静的 SVG + reference TTS + ArticulationCard
  の floor 描画) は既に landed 済み (gap-analysis 参照)。本スライスは AAI enrichment 層のみ。
- **SPARC エンジン採用**: LICENSE 無し (gh API license:null) で REQ-NF-101 hard stop。HOLD
  (将来許諾されれば置換候補)。
- **first slice (ADR-022 閉ループ) への依存/ブロック**: 本 ADR は first slice の直接構成要素ではなく、
  profiles:[aai] 無効が既定で CPU 経路を一切ブロックしない (独立後付け可能)。

## Risk

- level: **high-risk**
- escalate_to_opus: **true**
- 理由 (触れる境界領域):
  - **新 service + 新コンテナ + 新 HTTP 境界 (worker/analyzer/golden に続く 4 つ目)**: `aai` service・
    `native-trace-aai` コンテナ・`POST /v1/articulatory-inversion` を新設する。配線点 (compose.yaml /
    AaiClient.hs / cabal exposed-modules / wiring_manifest / app.py include_router) のいずれか 1 つの
    漏れで unreachable / silent suppress になる。agent-policy 二段門の wiring ゲート対象。
  - **ML モデル + license / transitive-GPL 懸念 (REQ-NF-101)**: articulatory/articulatory は Apache-2.0
    だが torch 等 transitive 依存に GPL 混入の可能性があり、実装時に依存ツリー確認 + 混入時 ADR-006 隔離
    + ast-grep allow 拡張 + ADR amend が要る。MNGU0/MOCHA-TIMIT コーパス条項が weights 再配布を許すかも
    実装時に確認 (不可なら HF cache volume・image 非焼込)。
  - **クロス言語 wire 契約 (python→Haskell→TypeScript)**: `ArticulatoryInversionResponse (python/camelCase)`
    → `ArticulatoryEstimate (Haskell/ToJSON)` → `ArticulatoryEstimateDto (TS/zod)` の 3 層接点で
    一致を保証する必要がある。ADR-017 の insertionPositionMs 取りこぼし前例があり、response-mapper への
    配線漏れで silent null になる。
  - **L2 精度の正直さ (誤推定の断定提示リスク)**: 全 AAI 学習コーパスが native English のみで non-native
    RMSE が約 16% 悪化、MNGU0 checkpoint は単一英国男性話者由来で日本語訛り /r/→[ɾ] は学習分布外。
    最も feedback が必要な場面で表示調音が誤りうる。D4 ガードレール (適格性 + 音素クラス + 長さ + disclaimer
    + 音響併置) が機械検証の要。表示適格性プロキシは「安定性」の代理であって「正しさ」の保証ではない
    (安定だが誤った EMA を高適格性と誤判定しうる)。
  - **ADR-004 scoring 契約境界 (additive のみ)**: `AssessmentFinding` に `findingArticulatoryEstimate` を
    追加する。scoreImpact への波及を防ぐ policy test (M-AAI-17) が必須。
    `-Werror=missing-fields` で未設定レコードがあれば build error
    (memory: haskell-per-edit-hook-burns-subagent-budget — 大 Haskell タスクは subagent 分割推奨)。
  - **CPU latency + Status=Proposed**: 低性能 CPU で 3s 発話の推論が 0.5–2s かかりうる。timeout 120s で
    上限は掛かるが suppress 頻度は実機ベンチ必須。ADR は Accepted ではなく Proposed であり、実装着手
    スライスで (a) 適格性充足頻度、(b) EMA→SVG 写像校正の実機検証を経て Accepted に昇格する前提。
  - **docker rebuild 必須**: worker/aai はバイナリ/イメージ焼き込み。rebuild 忘れは runtime-verify で
    stale イメージの偽 green になる (memory: docker-rebuild-required-for-code-changes)。
  - **drizzle migration 不要 (今回は該当しない)**: 型変更は python/Haskell/TypeScript のみで SQLite schema
    は不変。migration 忘れリスクはこのスライスでは発生しない。

## Design authority

- Claude Design connector (design-system-v3.html) は auth-gated (403) で MCP 利用不可。
- v3 デザインは既に live CSS に逐語移植済みで、これがオーバーレイ合成の権威:
  - `globals.css` (v3 トークン): `--ema-tongue` / `--ema-lip` / `--ema-track` /
    `--aai-elig-ok` / `--aai-elig-low` / `--sagittal-size: 264px` / floor=確定・enrichment=推定 軸。
  - `design-components.css` §0: `.layer-tag--floor` / `.layer-tag--enrich` / `.disclaimer`。
  - `design-components.css` §2「AAI 矢状断面 + EMA 重畳 (ADR-019)」:
    `.artic--aai` / `.sagittal-wrap` / `.sag-ph` / `.ema-layer` / `.ema-pt--tip` / `--dorsum` / `--lip` /
    `.ema-lbl` / `.ema-target` / `.elig` (メーター, 55% ゲート) / `.elig.is-low` / `.layer-tag`。
- `ArticulationCard.tsx` のオーバーレイは上記**既存クラスのみ**を使うこと (新クラス命名禁止)。
  floor 静的 SVG は `.sagittal-wrap` 内 `<img>`、EMA オーバーレイは `.ema-layer`、適格性メーターは
  55% ゲートの `.elig`、L2 注記は `.disclaimer` という CSS コメント記載の構造に従うこと。

## Open questions

なし。ADR-019 の D1–D5 / Contract changes / Compliance / Alternatives / Notes / 関連 ADR amend が
全エンジニアリング判断を確定している (D1–D5 はセッション内 grill で settled、decision tree は再オープンしない)。
calibratable しきい値の初期値 (displayEligibility>=0.55、>=50ms、校正未成熟時 0.7) は ADR D4 / Notes に
列挙済み。floor (D2) は既に landed (gap-analysis) で本スライス scope 外。Status=Proposed は実装後の
実機検証 (適格性充足頻度・EMA→SVG 校正) を経て Accepted に昇格する手順上のものであり、実装着手の
未確定ブロッカーではない (S-AAI-5 で completion-report に記す)。
