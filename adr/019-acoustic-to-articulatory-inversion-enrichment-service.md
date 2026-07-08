# Acoustic-to-articulatory inversion as a GPU-optional enrichment service over a self-contained rule-based articulation floor

ADR-019: ML 調音逆推定（舌・唇位置）を、既存の静的調音コンテンツ floor の上に重ねる GPU-optional エンリッチメントサービス

# Status

Proposed

2026-06-18 起草（リポジトリオーナーがセッション内 grill で「formant だけでなく ML inversion を採る」「GPL なら ADR-006/012 同様 HTTP 隔離」「L2 精度に正直なガードレール」「model 不在/低信頼時は floor へ degrade」を確定）。本 ADR の Decision はその確定判断から導かれるエンジニアリング契約。

Status を Accepted ではなく Proposed としている理由（verifier 指摘 #2 への対応）: 本 ADR は新 service・新コンテナ・新 worker 配線を導入する重い変更であり、(a) articulatory/articulatory の EMA checkpoint が実機 CPU で日本語訛り発話に対し本 ADR D4 の表示適格性プロキシ（NaN/voicing/長さ）をどの頻度で満たすか、(b) EMA→矢状断面 SVG オーバーレイ写像の校正、の 2 点が実装着手前に実機検証を要する。floor（D2）は本 ADR 内で自己完結的に定義され既存実装に存在するため、本 ADR が landed しなくても既存挙動は壊れない。実装スライス着手時に上記検証を満たし次第 Accepted に昇格する。

# Context

## 背景

REQ-105（調音コーチング、Should）は優先音素への矢状断面図と発音手順を求める。現状の調音アフォーダンスは死んでいる: `applications/frontend/src/components/workspace/ArticulationCard.tsx`（75–84 行）は「sagittal-diagram placeholder 320×320 SVG」の縞模様 div を描くだけで、実図解も学習者本人の調音推定も無い。

リポジトリオーナーは grill で**ML 音響→調音逆推定（acoustic-to-articulatory inversion, 以下 AAI）で舌・唇の位置を推定する**ことを明示的に選択した。「formant だけでは /r/-/l/（日本語話者の最高 functional load 対立）の舌先位置に踏み込めない」という動機による。

## floor の所在（verifier 指摘 #2 への対応: 依存先 ADR を実在しない ADR に置かない）

本 ADR の degrade 先（floor）は**既に本リポジトリに存在する production コンテンツ**で自己完結する。具体的には:
- `applications/frontend/src/lib/articulation-data.ts` の `ARTICULATION_DATA`（HIGH_PRIORITY_PHONEME_SET の 11 音素: /r/,/l/,/æ/,/ʌ/,/iː/,/ɪ/,/θ/,/ð/,/v/,/f/,/ə/ に対し `steps`（日本語 3 ステップ以上の調音手順）+ `exampleWord` を持つ固定データ。mock でない）。
- 各音素の静的矢状断面 SVG（CC0 Wikimedia: /θ/,/ð/,/f/,/æ/,/i/(=/iː/,/ɪ/ proxy),/a/(=/ɑ/,/ʌ/ proxy)。/r/(英語接近音),/l/,/v/ は CC0 が無いため自作線画 or labeled placeholder。`public/assets/sagittal/` 配置）。

すなわち floor は「静的 SVG + 既存の固定調音手順テキスト」であり、**ML も新 service も外部 ADR も要らない**。本 ADR が landed しなくても floor は描ける。AAI はこの floor の上に重なる任意の enrichment レイヤである。

> 補足: per-phoneme 音響特徴（F1/F2/F3, spectral centroid, VOT, vowel duration）による formant→調音方向ルールマッピングは、本 ADR の前提ではなく**将来の独立 ADR**で追加されうる別 enrichment である。本 ADR はそれに依存しない。音響特徴が将来追加されれば D4 の表示適格性プロキシの補助シグナル（母音の voicing 連続性など）として再利用しうるが、無くても本 ADR は成立する。

## 制約

- **REQ-NF-101（OSS ライセンス）**: production 同梱は Apache-2.0 / MIT / BSD / CC BY が既定。GPL 系は service 境界で隔離するか置換する（ADR-006 / ADR-012 の前例）。
- **REQ-NF-102（CPU baseline / GPU optional）**: CPU を基線とし、GPU 前提機能は option として分離。GPU backend を Next.js 解析インターフェースに漏らさない。
- **AGENTS.md**: production に stub/test-double を残さない。real entrypoint から到達可能（wire-first）。新 service 導入は同 PR で fitness 関数を追加する（ADR-005）。

## 何がこの決定を引き起こすか（調査根拠）

1. **ML AAI は 2024–2025 に実在する能力**だが、この MVP で価値を足すのは「狭く埋めにくいギャップ」に限る（調査 area "Acoustic-to-Articulatory Inversion" summary）。ML AAI は heavy dependency を足し、L2 speech で精度劣化が文書化され、L2 学習成果への効果の研究は初期段階（small-N, RCT なし）。よって本 ADR は AAI を floor を置換しない enrichment として隔離し、L2 で信頼できないときは floor に degrade する設計を採る。

2. **モデル候補とライセンス**:
   - **SPARC**（Berkeley-Speech-Group/Speech-Articulatory-Coding, Cho et al. 2024, arXiv:2406.12998）: 14ch EMA @50Hz, multilingual `multi` モデルに日本語（JVS）を含む、PCC 0.878（MNGU0）。**ただし LICENSE ファイルが存在しない**（gh API: `license: null`）。REQ-NF-101 の hard stop。
   - **articulatory/articulatory**（Wu et al. ICASSP 2022/2023, arXiv:2210.11723）: **Apache-2.0 確認済**（gh API: `license.key='apache-2.0'`）、MNGU0 学習済 Speech-to-EMA checkpoint 公開、**12-dim EMA @200Hz**（lower incisor + 上下唇 + 舌先/舌体/舌背の各 XY）、線形回帰 path で最速 CPU 推論可。SPARC より旧アーキで精度は劣るが license が permissive。**本 ADR の採用候補。**
   - **bootphon/articulatory_inversion**: GPL-2.0（gh API 確認）。採るなら ADR-006 同様 HTTP 隔離が必要。

3. **L2 精度の正直な評価**: 全 ML AAI 学習コーパス（MNGU0/MOCHA-TIMIT/HPRC）は native English 話者のみ。non-native で RMSE が約 16% 悪化（native 1.08mm vs L1+L2 1.25mm, EMA-MAE, arXiv:2504.13308）。日本語 L2 English の EMA 公開データは存在しない。日本語訛りの調音パターン（epenthetic vowel, /r/→[ɾ]）は学習分布の外。**最も feedback が必要な場面で表示調音が誤りうる。** articulatory/articulatory の MNGU0 checkpoint は単一英国男性話者由来で cross-speaker 汎化が弱い点も同方向のリスク。

4. **証拠ギャップ**: neural-inverted articulatory animation が L2 日本語学習者の発音成果を音響 feedback 単独より改善する peer-reviewed RCT は無い。改善が確認されているのは物理 EMA / ultrasound バイオフィードバックのみ。さらに Kocjancic et al. 2025（Language and Speech, PMC12638461）は**視覚的調音情報は音響 feedback と併置されたときだけ価値を足す**ことを示す。図解単独の独立効果には根拠が無い。

5. **モデルの出力に「予測分散/不確実度」は確認されていない**（verifier 指摘 #1 の根拠）: 調査 evidence は articulatory/articulatory を「Speech-to-EMA 回帰 checkpoint（+ 線形回帰 path）」とのみ記述し、per-frame の予測分散・不確実度を出力するとは述べていない。したがって信頼度ゲートをモデル内部の予測分散に依存させてはならない。代わりに**モデルが実際に出す EMA 軌跡そのものから導けるプロキシ**（NaN/不正フレーム率・voicing 比率・セグメント長）と決定論ゲート（HTTP 200・音素クラス・長さ）で表示適格性を判定する。

6. **既存資産**: golden-speaker は ADR-012 で profiles:[golden] + GOLDEN_SPEAKER_URL の GPU-optional 隔離 service として確立。worker の `GoldenSpeakerClient.hs` / `AnalyzerClient.hs` は共に **multipart/form-data（audio ファイルパート + JSON metadata パート）**で呼び出し、`responseTimeout` を明示設定する（既定 120s、incident 2026-06-14-worker-http-client-default-30s-timeout）。`compose.yaml` は worker→golden（GOLDEN_SPEAKER_URL, profiles:[golden], depends_on しない, HF cache volume）の前例を持つ。

要するに: **静的調音コンテンツが床（floor、自己完結）、AAI は天井（enrichment、隔離）**。床は常に動く。AAI は option として隔離し、L2 で信頼できないときは床に degrade する。本 ADR はその合成と隔離を確定する。

# Decision

## D1 — エンジンと隔離: articulatory/articulatory (Apache-2.0) を新 GPU-optional 隔離 service `aai` に閉じ込める

ML AAI エンジンは **articulatory/articulatory**（Wu et al. ICASSP 2022/2023, Apache-2.0 確認済）の公開 Speech-to-EMA checkpoint を採る。SPARC は LICENSE 無し（alternatives reject）のため採らない。

新 service `applications/aai/`（コンテナ `native-trace-aai`）を ADR-012 の golden-speaker と同型で導入する:
- `compose.yaml` に `aai` service を追加。`profiles: [aai]` でゲートし、無効時は起動しない。
- worker→aai は `AAI_URL`（既定 `http://aai:8790`）で到達。worker は `aai` を `depends_on` しない（golden の M-GRV-9 と同じ、aai 不在でも worker は動く）。worker の HTTP client は `AAI_TIMEOUT_SECONDS`（既定 **120**、golden と同値）で `responseTimeout` を明示設定する（incident 2026-06-14 と整合。原案の 8000ms は誤りで golden 前例に揃える）。
- **HTTP 契約は golden/analyzer の multipart 前例に厳密に揃える**（verifier 指摘 #3）: `POST /v1/articulatory-inversion`。**multipart/form-data** で `learner_audio`（音声ファイルパート, UploadFile）+ `metadata`（JSON 文字列 Form フィールド）を受ける。`metadata` JSON = `{ mimeType: string, sampleRate: int, boundaries: [{phoneme, startMs, endMs}] }`。audio を JSON に base64 で詰めない（golden は request を multipart、base64 は response の `audioBase64` のみ。同じ非対称を踏襲）。boundaries は呼び出し側 worker が渡す（D5 参照）。
- エンジン import（`articulatory` package）と EMA checkpoint は `applications/aai/` の中だけに存在する。frontend / worker / python-analyzer は一切 import しない。

**ライセンス姿勢**: articulatory/articulatory は Apache-2.0 なので、ADR-006/012 と違い**この service 自体は GPL-free を目指す**。ただし transitive 依存（torch 等）に GPL が混入する場合は実装時に確認し、混入時は ADR-006 前例（service 境界隔離・HTTP のみ・他 service へ import 漏洩なし）で許容して本 ADR を amend する（ADR-012 が rvc-python→parselmouth で行ったのと同じ訂正手順）。MNGU0/MOCHA-TIMIT のコーパス利用条項が weights 再配布を許すかを実装時に確認し、不可なら weights を image に焼かず HF cache volume で扱う（golden の M-GRV-10 と同じ）。

## D2 — 合成: AAI は enrichment、既存の静的調音コンテンツが floor

調音 feedback は二層で構成する:
- **Floor（常に存在・自己完結・本 ADR 内で定義）**: `articulation-data.ts` の 11 音素 `steps`（固定調音手順テキスト）+ 静的矢状断面 SVG（`public/assets/sagittal/`）+ reference TTS 再生。これは AAI の有無に関わらず必ず描かれる。**外部 ADR に依存しない。**
- **Enrichment（条件付き）**: AAI service が返す per-phoneme の正規化 EMA 座標（舌先/舌背/唇 XY）と、それを矢状断面 SVG にオーバーレイする可視化。**AAI 出力は floor を置換しない。** floor の手順テキスト + 静的 SVG を補強する追加レイヤとしてのみ載る。

worker は aai service が有効かつ後述ガードレール（D4）を満たすときのみ AAI enrichment を所見に添付する。それ以外は enrichment を `null` で返し、frontend は floor（静的 SVG + `steps` テキスト）だけを描く。

## D3 — 出力表現・12次元 EMA→6 座標写像・表示適格性プロキシ

### D3-a モデル出力（12-dim EMA）→ wire 6 座標の写像（verifier 指摘 #4）

articulatory/articulatory は 12-dim EMA を出す（6 sensor × XY: lower incisor=下顎切歯, upper lip, lower lip, tongue tip, tongue body, tongue dorsum）。aai service 内部で次のように 6 wire 座標へ縮約する:
- `tongueTipX, tongueTipY` ← tongue tip sensor の XY（そのまま）。
- `tongueDorsumX, tongueDorsumY` ← tongue dorsum sensor の XY（そのまま）。tongue body は wire に出さない（dorsum と高相関で UI 上 1 点に縮約）。
- `lipApertureX, lipApertureY` ← **唇の開き（aperture）を上下唇から導出**する。`lipApertureY = lowerLipY − upperLipY`（唇の縦開き）、`lipApertureX = (upperLipX + lowerLipX)/2`（唇の前後位置中点）。lip aperture は native EMA チャネルではなく上下唇からの導出量である旨を service の docstring に明記する。
- lower incisor（下顎）と tongue body は wire から落とす（MVP の SVG オーバーレイは舌先・舌背・唇の 3 点で足り、下顎・舌体を出すと UI 過負荷）。

### D3-b 話者内正規化（service が所有する追加ステップ）

生 mm は wire に出さない。aai service は **発話内 z-score 正規化**を自前で行う（モデルの機能ではなく service が追加する step）: 当該発話で得た全 EMA フレームの各チャネルの平均・標準偏差で z 化し、その後 [-1.0, 1.0] にクランプ写像する（話者の vocal tract 長差を吸収するため）。正規化は service の責務であり、モデルが正規化済み座標を出すわけではない旨を明記する（hallucination 防止）。

### D3-c 表示適格性プロキシ（モデルが実際に出す EMA 軌跡から導出。予測分散に依存しない）

per-phoneme に次を返す:
- `tongueTipX/Y, tongueDorsumX/Y, lipApertureX/Y`: 各 [-1.0, 1.0] 発話内 z 正規化座標。
- `displayEligibility`: [0.0, 1.0]。**モデル内部の予測分散ではなく**、当該音素セグメントの EMA 軌跡から計算する合成スコア。構成要素（すべてモデル出力 or 入力境界から観測可能）:
  1. `validFrameRatio` = (NaN/不正でない EMA フレーム数) / (セグメント内全フレーム数)。articulatory/articulatory は無音/非調音フレームで不正値を出しうるため、その除外率を信頼の代理にする。
  2. `voicingRatio` = セグメント内で基本周波数が検出された（有声）フレーム比率。母音/接近音は高有声であるべきで、低有声は推定が当てにならない。voicing は audio から直接計算する（service 内で軽量に算出、モデル非依存）。
  3. `durationAdequacy` = min(1.0, (endMs−startMs)/50)。50ms 未満は EMA 軌跡が不安定。
  `displayEligibility = validFrameRatio × voicingRatio × durationAdequacy`。値は実装時に校正する（しきい値は D4-2 で固定）。

worker→frontend へは per-finding の `articulatoryEstimate` として運ぶ（D4 contract）。生 mm・話者非正規化値・モデル内部 EMA index・下顎/舌体チャネルは wire に出さない。

## D4 — ガードレール: 表示 vs 抑制（L2 精度への正直さ）

AAI enrichment を**表示する**のは次を全て満たすときに限る。1 つでも欠ければ enrichment を suppress し floor に degrade する:

1. **service 到達**: aai service が profiles:[aai] で有効かつ HTTP 200 を返す。timeout（既定 120s, `AAI_TIMEOUT_SECONDS`）超過・接続失敗時は suppress。
2. **表示適格性ゲート**: `displayEligibility >= 0.55`（calibratable, worker の Scoring 層に置く）。未達は suppress。オーバーレイ写像の校正が未成熟な間は実装側で 0.7 に寄せて enrichment を控える（risks 参照）。
3. **音素クラスゲート**: AAI を表示するのは学習分布で扱える音素クラスに限る。**vowel と approximant /r/,/l/ のみ**を許可。stop/fricative の短い閉鎖区間は EMA 予測が不安定なため suppress し、これらは floor（`steps` テキスト + 静的 SVG）に委ねる。
4. **セグメント長ゲート**: 当該音素 `endMs − startMs >= 50ms`。短すぎる区間（reduced vowel/closure）は suppress（D3-c の durationAdequacy と整合、AAI は EMA 安定に 50ms を要する）。
5. **L2 disclaimer**: 表示する enrichment には必ず「推定（native 話者データ由来。訛りでは外れることがある）」の注記を UI に併置する。3D 舌形状を「あなたの舌はここ」と断定しない（調査 risk: non-native で誤りうる。MNGU0 単一英国男性話者由来で日本語訛り /r/→[ɾ] は学習分布外）。

**音響との併置義務（Kocjancic 2025）**: AAI 可視化も floor 静的 SVG も、必ず当該音素の reference TTS 再生ボタンと同一カード内に併置する（`ArticulationCard.tsx` の音声併置 UI を再利用）。音響非併置の調音図解単独は描かない（独立効果の根拠が無いため）。

## D5 — 配線点と degrade 経路・boundaries の出所

- python-analyzer は変更しない。AAI は analyzer の責務外。**alignment 境界は worker が既に analyzer から受け取っている** `AnalyzerResult.analyzedPerPhonemeGop`（`PhonemeGop{gopPhoneme, gopStartMs, gopEndMs, ...}`, AnalyzerClient.hs 64–93 行）から `{phoneme, startMs, endMs}` を抽出して aai に渡す。新たな境界計算は不要。
- worker（`Application.hs` の `assessPronunciation`, 78–85 行）: aai service が有効なら `analyzeAudio` の後に、`analyzedPerPhonemeGop` の境界 + 元の `audioBytes`/`audioContentType` を `learner_audio` + `metadata` の multipart で `AAI_URL/v1/articulatory-inversion` へ POST し、ガードレール(D4)通過分だけ `AssessmentFinding.findingArticulatoryEstimate` を埋める。aai 無効/失敗/未達は `Nothing`（floor は常に揃う）。新 module `NativeTrace/Worker/AaiClient.hs`（cabal exposed-modules 追加）は `GoldenSpeakerClient.hs` の multipart 組み立て + 明示 timeout をそのまま踏襲する。
- frontend: `EngineFindingDto.articulatoryEstimate` が null なら ArticulationCard は floor（`steps` テキスト + `sagittalSvgPath` の静的 SVG）のみ。非 null なら SVG に EMA オーバーレイ + L2 disclaimer。`ArticulationCard.tsx` の死んだ placeholder div（75–84 行）を、floor 静的 SVG（既定）に置換し、enrichment があれば座標オーバーレイを重ねる。

**Non-goal**: AAI 自前 fine-tune、日本語 L2 EMA データ収集、3D avatar、下顎/舌体チャネルの wire 露出、stop/fricative の調音アニメ、formant/VOT 等の音響特徴計測（別 ADR の範囲）、AAI を score(scoreImpact)に反映すること（AAI は presentation-only。減点は ADR-004 の allow-list = substitution/omission/insertion/epenthesis のまま不変）。

## D6 — AAI-conditioned 天井偏差 step と targetArticulation の契約化（2026-06-19 追補）

D3–D5 は AAI を「矢状断面 SVG 上の EMA 座標オーバーレイ + L2 disclaimer」に限定し、推定舌先と目標調音の偏差を文章 step として提示する経路を定義していなかった。v3 デザイン権威（`applications/frontend/design-reference/screens/articulation-card.html` 99 行: 「天井: 破線 = 目標、塗り = あなたの推定舌先。舌先が目標より後退・下降しています。」）はこの偏差方向 step を `.artic-steps` リスト内に置くことを要求する。本追補はこれを D6 として確定し、併せて実装が先行導入した `targetArticulation` フィールドを ADR-019 の正式契約として遡及定義する。

- **targetArticulation を ADR-019 contract フィールドとして正式化**: `applications/frontend/src/lib/articulation-data.ts` の `ArticulationEntry.targetArticulation?: { x: number; y: number; label: string }`（型定義 35–42 行、ARTICULATION_DATA の各音素エントリ 76 行以降）は、矢状断面 SVG（右向き断面・前歯/唇が左・咽頭が右）における目標調音の `sagittal-wrap` ボックス内パーセント座標（x,y は 0–100、前→後 / 上→下）と日本語ラベルを持つ**決定論的な静的 floor データ**である。ML 推定ではない。各 SVG の解剖学ラベル/アーティキュレータ経路座標から導出した目安値で、S-AAI-5(b)（spec acoustic-articulatory-inversion.md S-AAI-5 の EMA→矢状断面 SVG 写像校正項）で精緻化する。これは D2 の floor の一部（静的 SVG に付随する目標位置メタデータ）であり、AAI の有無に依存せず常に存在する。破線目標丸（`.ema-target` クラス、ArticulationCard.tsx 247–256 行で描画）の描画にのみ用い、scoreImpact に一切反映しない（presentation-only、ADR-004 不変）。

- **D6 偏差 step（天井）**: AAI enrichment が D4 ガードレールを全て満たして表示される（`articulatoryEstimate != null` かつ `displayEligibility >= DISPLAY_ELIGIBILITY_THRESHOLD`（= 0.55、ArticulationCard.tsx 50 行/212 行））ときに限り、推定舌先座標と `targetArticulation` の差から偏差方向（前後 = 後退/前進、上下 = 下降/上昇）を**決定論的に worker 非依存の frontend presentation で導出**し、floor 手順 step の末尾に「天井」step として 1 行追記する（design HTML:99 の文言体裁: 「破線 = 目標、塗り = あなたの推定舌先。舌先が目標より{方向}しています。」）。この導出は表示用の方向ラベル生成のみで、score/severity/ScoreSet には触れない。`articulatoryEstimate == null` または `displayEligibility < 0.55` のときは天井 step を出さず floor の `steps` のみを描く（D2/D4 の degrade と整合）。`targetArticulation` 未設定の音素は天井 step を生成しない。

- **デザイン chrome の確定**: 同一カードに次を併置する（design HTML 79, 101, 105 行準拠）。いずれも presentation-only:
  - **ADR ステータスバッジ**: AAI カード見出しに `adr-badge adr-badge--proposed`（「ADR-019 · Proposed」、design HTML:79）を表示し、Status が Proposed である事実を UI 上で開示する。Accepted 昇格時にバッジ文言を更新する。
  - **disclaimer 句の補完**: enrichment 表示時の `.disclaimer` 文言（現状 ArticulationCard.tsx 382–388 行）に、design HTML:101 が持ち frontend で落ちている句を補う: 「生 mm・舌体・下顎は出さず、発話内 z 正規化座標のみ。aai 無効時は床のみ。」これは D3-b/D3-c の wire 非露出契約（生 mm・話者非正規化値・下顎/舌体チャネルを出さない）と D2 の degrade を UI 文言で明示するもの。
  - **ミニマルペアボタン**: `.artic-audio`（ArticulationCard.tsx 398 行以降、現状 reference TTS + 速度切替 + 録音ボタンのみ）に、reference TTS お手本ボタンと並んで「ミニマルペア」再生ボタン（design HTML:105「▸ light · ミニマルペア」）を併置する。reference TTS と同一カード内併置の Kocjancic 2025 義務（D4 音響併置義務）の一部であり、新規スコアリング経路を一切足さない。

- **適用範囲外（Non-goal 追加）**: D6 の天井 step は方向ラベルの**表示**のみで、偏差量を score/severity に変換しない。AAI を score に反映しない D5 Non-goal はそのまま不変。再録音後の「EMA が目標へ動いたか」delta 表示は S-AAI-4 の将来拡張点のままで本追補の範囲外。

# Contract changes

- **applications/aai/src/.../interface/http_handler.py + interface/schema.py（新 service）**: POST /v1/articulatory-inversion を multipart/form-data で受ける（golden の http_handler.py と同型: learner_audio: UploadFile = File(...), metadata: str = Form(...)）。metadata JSON = { mimeType: str, sampleRate: int, boundaries: List[BoundaryInput{phoneme:str, startMs:int, endMs:int}] }。Response 型 ArticulatoryInversionResponse = { perPhoneme: List[ArticulatoryEstimateResponse{ phoneme:str, startMs:int, endMs:int, tongueTipX:float, tongueTipY:float, tongueDorsumX:float, tongueDorsumY:float, lipApertureX:float, lipApertureY:float, displayEligibility:float }] }。全 camelCase（C1/C2 wire 契約準拠）。座標は [-1.0,1.0] 発話内 z 正規化（service が算出）。displayEligibility は EMA 軌跡の validFrameRatio×voicingRatio×durationAdequacy（モデル予測分散ではない）。
- **applications/aai/src/.../infrastructure/articulatory_inversion.py（新 service 内部）**: articulatory package の Speech-to-EMA checkpoint を lazy import（torch/checkpoint が無い環境で graceful degrade。golden の rvc_engine.py 同型）。12-dim EMA を D3-a の写像で 6 wire 座標に縮約（tongueTip/tongueDorsum はそのまま、lipApertureY=lowerLipY−upperLipY / lipApertureX=(upperLipX+lowerLipX)/2、下顎・舌体は drop）。発話内 z-score 正規化→[-1,1] クランプは service が行う（モデル機能ではない旨 docstring 明記）。
- **applications/backend/src/NativeTrace/Worker/Types.hs — AssessmentFinding レコード + ToJSON instance**: フィールド追加 findingArticulatoryEstimate :: Maybe ArticulatoryEstimate（ADR-019）。新 data ArticulatoryEstimate = ArticulatoryEstimate { aeTongueTipX, aeTongueTipY, aeTongueDorsumX, aeTongueDorsumY, aeLipApertureX, aeLipApertureY, aeDisplayEligibility :: Double }。ToJSON で "articulatoryEstimate" .= findingArticulatoryEstimate finding を追加（既存 key 末尾）。null 既定で後方互換。-Werror=missing-fields に留意しレコード生成箇所を全て更新。
- **applications/backend/src/NativeTrace/Worker/AaiClient.hs（新 module, cabal exposed-modules 追加）+ Application.hs assessPronunciation handler**: GoldenSpeakerClient.hs を雛形に新 module。AAI_URL / AAI_TIMEOUT_SECONDS（既定 120）を読み、未設定時は Nothing（golden M-GRV-9 軟無効化と同型）。analyzeAudio 後に analyzedPerPhonemeGop から {phoneme,startMs,endMs} を抽出、learner_audio(=audioBytes) + metadata(JSON: mimeType/sampleRate/boundaries) の multipart で POST /v1/articulatory-inversion。responseTimeout を明示。D4 ガードレール（displayEligibility>=0.55, vowel/approximant のみ, >=50ms, HTTP 200, timeout）を満たす per-phoneme のみ findingArticulatoryEstimate に写像。失敗/未達/無効は Nothing。
- **applications/frontend/src/lib/api-types.ts — EngineFindingDto 型**: フィールド追加 articulatoryEstimate: ArticulatoryEstimateDto | null（既存 feedbackLayers の隣）。新 type ArticulatoryEstimateDto = { tongueTipX:number; tongueTipY:number; tongueDorsumX:number; tongueDorsumY:number; lipApertureX:number; lipApertureY:number; displayEligibility:number }。null は enrichment 不在 = floor のみ描画。
- **applications/frontend/src/acl/pronunciation-assessment/oss-worker/response-mapper.ts（worker JSON→EngineFindingDto 写像）**: worker の "articulatoryEstimate" を EngineFindingDto.articulatoryEstimate に取り込む写像を追加。欠落時は null（ADR-017 の insertionPositionMs を境界で取りこぼした不具合の再発防止として、新フィールドは必ず mapper に配線する）。
- **applications/frontend/src/lib/articulation-data.ts — ArticulationEntry 型**: フィールド追加 sagittalSvgPath?: string（floor 静的 SVG パス。public/assets/sagittal/ に配置）。HIGH_PRIORITY_PHONEME_SET の各音素に floor SVG パスを紐付ける（CC0 が無い /r/,/l/,/v/ は自作線画 or labeled placeholder のパス）。既存 steps/exampleWord は floor テキストとしてそのまま使う。
- **applications/frontend/src/components/workspace/ArticulationCard.tsx**: 75–84 行の死んだ placeholder div を撤去。既定で sagittalSvgPath の <img>（floor）+ 既存 steps テキストを描画。props に articulatoryEstimate?: ArticulatoryEstimateDto | null を追加し、非 null かつ displayEligibility>=0.55 のとき SVG 上に EMA 座標オーバーレイ + L2 disclaimer 注記を重ねる。null なら floor のみ。reference TTS 再生ボタンと同一カード内併置を維持（Kocjancic 2025）。
- **compose.yaml**: service aai 追加（build context applications/aai, container_name native-trace-aai, profiles:[aai], expose 8790, HF cache volume hf-cache-aai — golden の 57–94 行と同型）。worker service の environment に AAI_URL: http://aai:8790 と AAI_TIMEOUT_SECONDS: "120" を追加。worker は aai を depends_on しない（golden M-GRV-9 と同型）。
- **.ast-grep/rules/no-articulatory-inversion-outside-aai.yml（新 fitness rule）**: import articulatory / from articulatory import が applications/aai/ 以外に現れないことを静的強制（no-parselmouth-outside-python-analyzer.yml / no-rvc-outside-golden-speaker.yml と同型）。同 PR で追加（ADR-005 same-PR 規則）。

## D6 contract surface（2026-06-19 追補）

- **applications/frontend/src/lib/articulation-data.ts — ArticulationEntry 型**: 既に存在する `targetArticulation?: { x: number; y: number; label: string }`（型定義 35–42 行、ARTICULATION_DATA の各音素エントリ 76 行以降、例 /r/ `{x:62,y:50}` 行・/l/ `{x:55,y:41}` 行）を ADR-019 の floor 契約フィールドとして正式定義する。x,y は `sagittal-wrap` ボックス内パーセント座標（0–100、前→後 / 上→下）、label は目標調音の日本語説明。決定論的静的データであり ML 推定でない（S-AAI-5(b) 校正で精緻化）。
- **applications/frontend/src/components/workspace/ArticulationCard.tsx — D6 天井 step + chrome**: `articulatoryEstimate != null && displayEligibility >= DISPLAY_ELIGIBILITY_THRESHOLD`（= 0.55、50 行/212 行）のとき、推定舌先座標と `entry.targetArticulation` の差から偏差方向ラベルを frontend presentation で導出し `.artic-steps`（371 行 `<ol className="artic-steps">`）末尾に「天井」step を 1 行追記する（design HTML:99 文言体裁）。`articulatoryEstimate == null`・`displayEligibility < 0.55`・`targetArticulation` 未設定のいずれかでは天井 step を出さない。併せて AAI カード見出しに `adr-badge adr-badge--proposed`（design HTML:79）、enrichment 時 `.disclaimer`（382–388 行）に落ちている句「生 mm・舌体・下顎は出さず、発話内 z 正規化座標のみ。aai 無効時は床のみ。」（design HTML:101）、`.artic-audio`（398 行以降）にミニマルペア再生ボタン（design HTML:105）を併置する。すべて presentation-only で worker 由来 scoreImpact に触れない。既存 `.ema-target` クラス（247–256 行）のみを使い新クラスを命名しない（spec acoustic-articulatory-inversion.md「Design authority」節: 既存クラスのみ）。

# Alternatives considered

- **SPARC (Berkeley-Speech-Group/Speech-Articulatory-Coding) を AAI エンジンに採る** — Pros: 14ch EMA @50Hz で全 6 調音器（舌先/blade/dorsum, 唇, 下顎）を覆い vowel と consonant（/r/-/l/ 含む）両対応。multilingual モデルが日本語(JVS)acoustics を見ている。PCC 0.878 で最高精度。RT-VC で CPU real-time 実証（61.4ms, Apple M3）。Cons: LICENSE ファイル無し（gh API license:null）。model weights checkpoint の provenance 不明。日本語 L2 精度データ無し。EMA→sagittal animation の browser component が無く UI が別プロジェクト規模(2–4週)。不採用理由: REQ-NF-101 の hard stop。LICENSE 無しの repo を production 同梱できない。UC Berkeley から permissive license の書面許諾が得られるまで採用不可。将来許諾されれば articulatory/articulatory を置換する候補として再評価する（本 ADR の HOLD 項）。
- **bootphon/articulatory_inversion (GPL-2.0) を採り ADR-006 パターンで HTTP 隔離** — Pros: MNGU0 + MOCHA-TIMIT 対応、GRNN で RMSE 0.926mm。GPL でも service 境界隔離なら ADR-006 前例で許容。Cons: Apache-2.0 の代替(articulatory/articulatory)が存在する状況で GPL を新規に背負う理由が無い。golden-speaker が既に GPL（parselmouth 経由）隔離されており、もう 1 つ GPL service を足すと隔離面が増える。不採用理由: permissive(Apache-2.0)で要件を満たすエンジンがあるとき GPL-family を採るのは不当。隔離面の最小化を優先。
- **ML AAI を採らず 既存の静的調音コンテンツ floor のみで完結** — Pros: 新 service・新モデル・新ライセンス・新コンテナ全て不要。articulation-data.ts の 11 音素手順 + 静的 SVG だけで REQ-105 のアフォーダンスを稼働できる。L2 成果証拠は AAI と同等に薄いが少なくとも誤った 3D 舌形状を見せない。Cons: /r/-/l/ の舌先位置に「あなたの舌はここ」と踏み込めない（一般論手順に留まる）。オーナーが明示的に ML inversion を選択しており、これ単独では指示を満たさない。不採用理由: オーナーが ML inversion を明示選択。ただしこれは本 ADR の degrade 先（floor）として全面採用する。AAI 不在/低信頼/L2/短セグメント時は必ずここに落ちる。
- **AAI を runAssessmentJob のブロッキング同期経路に組み込み、所見ごとに必ず推定を表示** — Pros: 全所見に調音推定が常に付く。Cons: L2 精度劣化(16% RMSE 増)を表示適格性ゲートなしに晒す。CPU 推論 latency(低性能機で 0.5–2s/3s 発話)を同期経路に足す。誤った調音を最も feedback が必要な場面で見せる(pedagogically harmful)。不採用理由: ガードレール(プロキシ・L2 ゲート)無しの常時表示は調査 risk の通り有害。AAI は enrichment であり floor ではない。表示適格性未達時は suppress し floor へ degrade する設計に反する。
- **信頼度ゲートをモデルの per-frame 予測分散の逆数で構成する** — Pros: 概念上は「モデルが自信のある区間だけ出す」が綺麗。Cons: articulatory/articulatory が per-frame 予測分散/不確実度を出力するという根拠が調査 evidence に無い（Speech-to-EMA 回帰 checkpoint としか確認されていない）。存在しない出力に表示契約全体を吊るすことになる。不採用理由: verifier 指摘 #1。モデルが実際に出さないシグナルを前提にできない。D4 はモデルが実際に出す EMA 軌跡から導けるプロキシ（NaN/不正フレーム率・voicing 比率・セグメント長）+ 決定論ゲートで構成し直す。
- **日本語 L2 English EMA データで HuBERT ベース AAI を自前 fine-tune** — Pros: L2 精度劣化を原理的に解消しうる。Cons: 日本語 L2 English EMA 公開データが存在しない。データ収集 or phonetics lab 連携が前提で MVP scope 外。不採用理由: 前提データが無く本 ADR の scope で実行不能。将来 verification phase の選択肢として risks に残す。
- **D6 偏差方向を文章「天井」step ではなく矢印 SVG のみ（コピー無し）で示す / 偏差方向を worker 側で導出する** — Pros: 矢印は言語非依存で多言語化が不要、worker 側導出なら frontend が表示専念で薄くなる。Cons: design 権威（HTML:99）が文章 step（「舌先が目標より後退・下降しています。」）を `.artic-steps` 内に要求しており矢印のみでは v3 デザインと乖離する。worker 側導出は `targetArticulation` が frontend floor データ（articulation-data.ts）であり worker に存在しないため、worker→wire に新フィールドを足す必要が生じ D3-c の wire 最小化と矛盾する。**採用**: 文章「天井」step を `.artic-steps` 末尾に置き、偏差方向は frontend で `articulatoryEstimate`（wire 既存）と `targetArticulation`（frontend floor）から決定論導出する。**不採用**: 矢印のみ表示（design 文言要件を満たさない）／worker 側導出（floor データを wire に漏らし D3-c に反する）。いずれも presentation-only で scoreImpact 不変は両案共通（ADR-004）。

# Consequences

## Positive

- floor が自己完結し外部未着 ADR に依存しない: degrade 先は既存の articulation-data.ts(11 音素手順) + 静的 SVG + reference TTS。本 ADR が landed しなくても floor は描け、AAI 無効/失敗/L2/短セグメントの全ケースで floor に落ちる。
- ライセンス姿勢が最小隔離: articulatory/articulatory は Apache-2.0 なので、ADR-006/012 と異なり service 自体は GPL-free を目指す（transitive GPL 混入時のみ ADR-006 前例で隔離・amend）。frontend/worker/python-analyzer の permissive 姿勢は不変。
- HTTP 契約が golden/analyzer の multipart 前例に厳密一致: learner_audio(File) + metadata(Form JSON)、base64 は使わない。worker 側は GoldenSpeakerClient.hs をほぼそのまま再利用でき配線リスクが小さい。
- 表示適格性がモデルの実出力に基づく: 存在しない予測分散ではなく EMA 軌跡の validFrameRatio×voicingRatio×durationAdequacy で判定するため、実装時に実在しないモデル機能に依存しない。
- CPU baseline 維持(REQ-NF-102): profiles:[aai] 無効時は service が起動せず worker は素通り。aai が無くても全機能が動く。GPU backend は Next.js 解析インターフェースに漏れない（HTTP 契約のみ）。
- 死んだ placeholder の解消: ArticulationCard の縞模様 div が floor 静的 SVG + 既存手順 + 条件付き EMA オーバーレイの実体に置換され、REQ-105 の調音アフォーダンスが初めて稼働する。
- L2 精度への正直さが契約化: 表示適格性・音素クラス・セグメント長ゲート + disclaimer が、native 学習データ由来の誤推定を学習者に断定提示するのを防ぐ。
- scoreImpact 不変: AAI は presentation-only。ADR-004 の減点 allow-list(substitution/omission/insertion/epenthesis)に手を入れないため scoring の整合は保たれる。

## Negative

- 新 service・新コンテナ・新 HTTP 境界・worker 配線が増える（worker/analyzer/golden に続く 4 つ目）。
- ML AAI の L2 成果改善は peer-reviewed RCT で未確認（neural inversion 由来 animation の効果は EMA/ultrasound ハードウェア研究の外）。verification phase 扱いで、usage で効果が出なければ継続を再考する（golden の ADR-012 と同じ姿勢）。
- SPARC を見送るため /r/-/l/ も articulatory/articulatory(MNGU0 単一英国男性話者)の cross-speaker 汎化に依存し、日本語訛り /r/→[ɾ] は学習分布外。ガードレールで suppress されると、動機だった /r/-/l/ 舌先こそ enrichment が出ない場面が残る（motivation と suppress 挙動の緊張。disclose 済）。
- EMA→矢状断面 SVG オーバーレイの UI は off-the-shelf component が無く（DYNARTmo は研究用のみ）、座標→SVG 写像の校正が実装コスト。校正未成熟時は表示適格性しきい値を 0.7 に寄せて enrichment を控える。
- 低性能 CPU で 3s 発話の推論が 0.5–2s かかりうる。同期非ブロッキング + timeout(120s)で job 全体の上限は掛かるが、enrichment が間に合わず suppress される頻度は実機ベンチで確認が要る（Status=Proposed の根拠）。

# Compliance

- ast-grep rule no-articulatory-inversion-outside-aai.yml が import articulatory を applications/aai/ 以外で禁止（edit hook + CI）。no-parselmouth-outside-python-analyzer / no-rvc-outside-golden-speaker と同型。同 PR 追加（ADR-005）。
- wiring_manifest.yml に worker→aai の HTTP edge を登録し、aai service が frontend/worker 内部型を import しない（HTTP 契約のみ）ことを assert（golden の ADR-012 compliance と同型）。
- 契約テスト: aai service が multipart（learner_audio File + metadata Form JSON）を受け、JSON-base64 body は受けないこと（golden 前例との request 形一致）を assert。
- 契約テスト: ArticulatoryEstimateResponse が常に 6 座標（tongueTip/tongueDorsum/lipAperture XY）+ displayEligibility を返し、下顎・舌体チャネルや生 mm を露出しないこと、lipApertureY が上下唇差から導出されること（D3-a）を assert。
- 契約テスト: worker レスポンスの articulatoryEstimate が、ガードレール(D4)未達の finding で必ず null であること、displayEligibility>=0.55 かつ vowel/approximant かつ >=50ms かつ HTTP 200 の finding でのみ非 null であることを assert。
- 契約テスト: response-mapper が worker の articulatoryEstimate を EngineFindingDto に取りこぼさず写像すること（ADR-017 の insertionPositionMs 境界落ち再発防止）。欠落時 null を assert。
- optional ゲート: application body が profiles:[aai] 無効（aai service 停止）でビルド・稼働し、worker が findingArticulatoryEstimate=Nothing を返して frontend が floor（静的 SVG + articulation-data steps）のみ描くことを assert（REQ-NF-102）。floor は本 ADR 内定義の既存実装なので外部 ADR 未着でも検証可能。
- ランタイム検証: AAI 有効時に実録音を live worker→aai に通し、(a) vowel/approximant の高適格性セグメントで articulatoryEstimate が非 null かつ ArticulationCard に EMA オーバーレイ + disclaimer が出る、(b) stop/fricative・短セグメント・低適格性で null かつ floor(静的 SVG + steps)のみ描く、(c) aai 停止時に同じ floor に degrade することを観測 assert。
- code-review rubric: AAI 出力が scoreImpact に反映されない(presentation-only)こと、生 mm/話者非正規化値/下顎・舌体チャネルが wire に出ないこと、displayEligibility がモデル予測分散でなく EMA 軌跡プロキシで算出されること、調音図解が必ず reference TTS と同一カード併置であること(Kocjancic 2025)を検証。
- ライセンス確認: articulatory/articulatory の Apache-2.0 と EMA checkpoint/コーパス(MNGU0)条項を実装時に確認。transitive GPL 混入時は本 ADR を amend し ast-grep allow を aai に拡張(ADR-012 の rvc-python→parselmouth 訂正手順)。weights は条項が再配布を許さなければ image 非焼込・HF cache volume(golden M-GRV-10)。

## D6 compliance（2026-06-19 追補）

- 単体テスト（M-AAI-19）: `ArticulationCard` が `articulatoryEstimate != null && displayEligibility >= 0.55` かつ `targetArticulation` 設定済みの音素で天井偏差 step（design HTML:99 体裁の偏差方向文）を `.artic-steps` に 1 行追加して描くことを assert（実 component を render し DOM の step テキストを観測）。
- 単体テスト（M-AAI-20）: `articulatoryEstimate == null` または `displayEligibility < 0.55` または `targetArticulation` 未設定のとき天井 step を描かず floor の `steps` のみを描くことを assert（D2/D4 degrade。実 component render + DOM 観測）。
- 単体テスト（M-AAI-21a — バッジ）: AAI カード見出しに `adr-badge--proposed`（「ADR-019 · Proposed」）が描かれることを assert（実 component render + DOM 観測）。
- 単体テスト（M-AAI-21b — disclaimer 句）: enrichment 表示時 `.disclaimer` に「生 mm・舌体・下顎は出さず…aai 無効時は床のみ。」句が含まれることを assert（実 component render + DOM テキスト観測）。
- 単体テスト（M-AAI-21c — ミニマルペアボタン）: `.artic-audio` にミニマルペア再生ボタンが reference TTS お手本ボタンと同一カード内に併置されること（Kocjancic 2025）を assert（実 component render + DOM 観測）。
- policy テスト（M-AAI-22）: M-AAI-17（`findingArticulatoryEstimate` Just/Nothing で同一 GOP の scoreImpact が同値、`grep -n "substitution\|omission\|insertion\|epenthesis" applications/backend/src/NativeTrace/Worker/Scoring.hs` で減点 allow-list 不変）の不変アサート対象を D6 presentation 経路へ拡張し、D6 天井 step / `targetArticulation` / chrome のいずれも scoreImpact・severity・ScoreSet に波及しないことを assert（並行した別個の不変テストではなく M-AAI-17 のカバレッジ拡張。presentation-only、ADR-004 allow-list 不変）。
- ランタイム検証（M-AAI-23）: AAI 有効・高適格性 vowel/approximant の実録音で、live worker→aai→frontend を通し ArticulationCard に EMA オーバーレイ + 破線目標（`.ema-target`）+ 天井偏差 step + Proposed バッジ + 補完済 disclaimer + ミニマルペアボタンが出ること、低適格性/null/aai 停止で天井 step が消え floor のみへ degrade することを観測 assert（.agent-evidence の commands.txt に実値）。
- production に mock/stub/placeholder を入れない: 偏差方向導出は実 `articulatoryEstimate` と実 `targetArticulation` から計算し、固定文言のダミーを返さない（AGENTS.md no-prod-doubles）。

# Notes

- Risks:
  - L2 精度劣化(調査 risk 確定): 全 AAI 学習コーパスが native English のみで non-native RMSE が約 16% 悪化(EMA-MAE, arXiv:2504.13308)。articulatory/articulatory の MNGU0 checkpoint は単一英国男性話者由来で cross-speaker 汎化が弱い。日本語訛り /r/→[ɾ]・epenthetic vowel は学習分布外で、最も feedback が必要な場面で表示調音が誤りうる。D4 表示適格性+音素クラス+disclaimer ゲートで緩和するが、根本は学習データ不在であり完全には消えない。
  - 表示適格性プロキシが信頼度の真の代理か未検証: validFrameRatio×voicingRatio×durationAdequacy は『推定の安定性』の代理であって『正しさ』の保証ではない。安定だが誤った EMA を高適格性と誤判定しうる。実装時に既知音素の手動 EMA と突き合わせて校正し、未校正のうちはしきい値を 0.7 に寄せる。
  - L2 学習成果への効果が未実証(調査 risk): neural-inverted articulatory animation が音響 feedback 単独より日本語 L2 発音を改善する RCT は無い。証拠は物理 EMA/ultrasound のみ。verification-phase 扱いとし usage で効果不明なら継続再考（Status=Proposed の一因）。
  - SPARC license blocker(調査 risk hard stop): Berkeley repo に LICENSE 無し(gh API license:null)。許諾を得ない採用は REQ-NF-101 違反。本 ADR は articulatory/articulatory(Apache-2.0)を採り SPARC は HOLD。将来許諾されれば置換候補として再評価。
  - CPU latency(調査 risk): RT-VC の 61.4ms は Apple M3。低性能 CPU で 3s 発話が 0.5–2s かかりうる。同期非ブロッキング + timeout(120s)で上限を掛けるが、suppress 頻度は実機ベンチ必須（Status=Proposed の一因）。
  - transitive GPL 混入の可能性: articulatory/articulatory の依存(torch 等)に GPL が紛れる場合、ADR-012 が rvc-python→parselmouth で経験したのと同じ訂正(service 境界隔離 + ast-grep allow 拡張 + ADR amend)が要る。実装時に依存ツリーを確認する。
  - EMA→sagittal SVG 写像の校正リスク: off-the-shelf の browser-ready 調音アニメ component が無い(DYNARTmo は研究用のみ)。正規化 EMA 座標 + 上下唇差由来 lipAperture を矢状断面 SVG に正しく重ねる写像の校正を誤ると、disclaimer があっても誤った位置を示す。floor 静的 SVG は常に正しいので、オーバーレイ校正が未成熟な間は表示適格性ゲートを高めに(例 0.7)寄せて enrichment を控える。
  - コーパス再配布条項: MNGU0/MOCHA-TIMIT は academic-use 条項で標準 OSS license ではない。MNGU0 学習 weights を product 配布できるかを実装時に確認。不可なら image 非焼込・HF cache(golden M-GRV-10)で扱い、配布形態変更時に再確認(ADR-006/012 と同じ distribution-model 再評価)。
- First-slice relevance: 本 ADR は first slice（closed-loop minimal: A/B 部分再生 + その場再録音 → GOP デルタ → 改善表示）の**直接の構成要素ではない**。first slice は本 ADR の floor すら必須としない（GOP デルタは既存 perPhonemeGop で計算でき、A/B は self 録音スライス + 既存 TTS で足りる）。AAI service は GPU-optional な enrichment であり、profiles:[aai] 無効が既定なので first slice の CPU 経路を一切ブロックしない。実装順序は first slice(GOP デルタ closed loop) → 本 ADR の aai service が後続スライス。first slice の ArticulationCard 改修（死んだ placeholder の floor SVG + 既存 articulation-data steps への置換と「自分で試す」録音配線）は本 ADR の floor 部分（既存 production データ + 静的 SVG）と first slice の再録音経路で完結し、AAI オーバーレイは articulatoryEstimate=null で無効化されたまま（後でガードレール通過時に上書き表示される）後付けできる設計。したがって本 ADR は first slice の後に独立して追加でき、first slice の closed loop を遅延させない。なお floor が本 ADR 内で自己完結定義（articulation-data.ts は既存 production 実装）であるため、本 ADR を landed しなくても first slice の ArticulationCard 改修は静的 SVG + 既存 steps だけで成立する。
- D6 実装ステータス・M-AAI-23 runtime-pending（2026-06-20 追補）: D6（天井偏差 step + targetArticulation 契約化 + chrome）の presentation 層を proven-done で実装・検証した（8 段 PASS: 決定論ゲート / static-verifier / runtime-verifier / spec-grader / done-evaluator）。変更は frontend 4 ファイル（`ArticulationCard.tsx` / `articulation-data.ts` / 同 test / spec）のみで worker / aai / wire は不変。Must M-AAI-19 / 20 / 21a / 21b / 21c / 22 は実コンポーネントの DOM assert（40 tests）で検証済み。`targetArticulation` を D6 正式契約 floor フィールドとして遡及定義し、`minimalPair` floor フィールド（drill-content.ts confusionSet 由来の 6 音素 /r//l//æ//iː//θ//v/）を追加した。
  - **M-AAI-23 ライブ runtime は runtime-pending**: aai コンテナ未起動のため component-level render assert で代替した。worker→aai→articulatoryEstimate のライブ往復は D1–D5 スライスで実機検証済み（`.agent-evidence/acoustic-articulatory-inversion/runtime-verify.json`）であり、D6 はその proven wire 上の frontend レンダリングのみを追加するため component assert が妥当な代替となる（spec の M-AAI-23 acceptance が明示的に許容、ADR-024 前例）。実機で天井 step + chrome 6 要素が live worker→aai→frontend に出ることの観測は未実施。再開手順: `docker compose --profile aai up -d --build aai` の後に高適格性 vowel/approximant の実録音を投入する。
  - **Proposed→Accepted 昇格ゲートは不変**: Status は Proposed のまま。M-AAI-23 ライブ観測 + S-AAI-5(b)（EMA→矢状断面 SVG 写像校正）+ 適格性充足頻度の実機ベンチが昇格前提として残る。
- Amends: ADR-004（AAI(articulatoryEstimate)は presentation-only であり減点しないことを明記。body-range-pinned deductions allow-list(substitution/omission/insertion/epenthesis)は不変。AssessmentFinding の structured-diff に新 optional フィールド findingArticulatoryEstimate を追加するが、scoring policy(threshold→severity→scoreImpact→ScoreSet が worker のみに在る)は不変）、ADR-006（GPL 隔離前例の対象に新 service aai を加える参照を残す。articulatory/articulatory は Apache-2.0 のため原則 GPL-free だが、transitive GPL 混入時は ADR-006 の service 境界隔離パターンを適用し ast-grep allow を applications/aai/ に拡張する旨を記す（ADR-012 が parselmouth 混入で行った訂正と同型））、ADR-012（GPU-optional 隔離 service の前例として aai が同パターン(profiles ゲート + 専用 boundary 環境変数 AAI_URL + depends_on しない + 同 PR fitness rule + HF cache volume + weights 非焼込 + 明示 timeout 120s + verification-phase 扱い + multipart request 契約)を踏襲する旨の相互参照を追加）
- Depends on: ADR-012（golden-speaker の GPU-optional 隔離 service パターン: profiles ゲート・boundary 環境変数・depends_on しない・同 PR fitness rule・HF cache volume・weights 非焼込・明示 timeout・multipart request 契約。本 ADR の aai service と worker AaiClient.hs はこの前例の写し）、ADR-006（parselmouth GPL-3.0 の service 境界隔離前例。transitive GPL 混入時の隔離手順の根拠）、ADR-004（scoring を worker に集約・structured-diff 契約。AAI フィールド追加先かつ presentation-only の根拠）、ADR-013（worker→analyzer の multipart/form-data 呼出 + analyzedPerPhonemeGop の境界がそのまま aai に渡せる前例）
- Author: lihs
- Last updated: 2026-06-20
- Related: ADR-004（scoring/allow-list）、ADR-006（GPL 隔離パターン）、ADR-012（GPU-optional service 前例）、ADR-013（multipart/form-data worker→analyzer 前例）、ADR-018（音響音声学的診断 formant/spectral/VOT — 本 ADR の前段 acoustic-phonetic 診断層）、ADR-020（決定論的調音方向ルール/カタログ/canonicalize/実図解 — 本 ADR の後続 deterministic-How 層）、ADR-021（LLM コーチングナラティブ生成 — 本 ADR の後続 coaching 層）、ADR-022（改善ループ — closed remediation & improvement loop）
