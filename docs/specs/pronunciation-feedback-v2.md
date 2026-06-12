# Spec: pronunciation-feedback-v2

<!-- spec-curator が grill-me 相当の人間合意（pronunciation-engine-design-decisions）から正規化。
     設計の正: docs/01-requirements/pronunciation-feedback-requirements.md, docs/06-research/pronunciation-feedback-research.md,
     adr/001..005。デザインの正: /tmp/nt-handoff/.../design-system-v2.html, components-v2.css, tokens-v2.css, screens/workspace-v2.html。 -->

## Goal

- 計測済みだが UI に届いていない細粒度データ（phenomenon / gop / confidence / サマリー）を実配線し（Phase 1）、日本語話者誤りカタログ駆動の 3 層フィードバック・NBest 診断・F0/韻律実計測・二段階スコア・お手本 TTS を本物の音響解析として実装する（Phase 2 + REQ-124）。
- 偽データを本番経路に入れず（agent-policy 準拠）、`workspace-v2.html` を pixel-perfect に実装する。今回スコープ外の ML が必要な部品は実契約の裏に正直な空状態を置く。
- 対象 REQ: 107, 108, 102, 109, 101, 103, 104, 111, 112, 114, 115, 124（合計 12 要件）。

## Must (満たさなければ done でない)

### 配線・即効（Phase 1）

- [ ] **M-107a（REQ-107 配線）**: `GET /api/v1/sections/{id}/workspace` のレスポンスで、各 `resultsByEngine[].findings[]` に `phenomenon`（非 null、`FindingPhenomenon` 11 値のいずれか）と `gop`（数値）と `confidence`（0–1 数値）が含まれる。現状 `route.ts:86-98` の `findings.map` が `phenomenon`/`gop` を脱落させている欠陥を解消する。
- [ ] **M-107b（REQ-107 サマリー）**: 同レスポンスにエンジン別サマリーメッセージ（非空文字列、複数文の固定 3 段でない）が含まれ、workspace 画面の `.eng-summary` 部品にレンダリングされる。
- [ ] **M-107c（REQ-107 全音素 GOP 保存・到達）**: 閾値未満で finding 化されなかった音素を含む全音素 GOP 系列が解析結果に保存され、API レスポンスから単語単位で参照でき（`.gopmap` ヒートマップが描画できる形）、UI の GOP ヒートマップビューに描画される。
- [ ] **M-107d（REQ-107 highlight messageJa）**: `route.ts:62` の `messageJa: null` ハードコード（C-3 配線断）を解消し、本文ハイライトに対応する finding の `messageJa`（非空）が届く。
- [ ] **M-108（REQ-108 信頼度・ヘッジ・却下）**: finding の信頼度が 3 段階以上で UI に可視化される（`.conf[data-level]`）。低信頼度の指摘はヘッジ表現（「〜の可能性があります」）でかつデフォルト折りたたみ（`.fold`/`.hedge`）になる。ユーザーが指摘を「誤検出として却下」でき、却下が**永続化**され履歴に残る（`POST` または `PATCH` の real endpoint が dismissal を受け、再取得時に却下状態が返る）。
- [ ] **M-102（REQ-102 phenomenon 完全実装）**: worker が connected speech 系 finding を `connectedSpeech` 一律でなく現象別（`weakForm`/`linking`/`flap`/`assimilation`/`reduction`）に分類して生成する。`epenthesis`（母音挿入）と `lexicalStress`（語強勢誤り）が新規 enum 値として `FindingPhenomenon`・ACL スキーマ・`api-types.ts`・ADR-004 で同一 PR 追加され、worker が生成する。
- [ ] **M-109（REQ-109 connected speech 位置特定）**: connected speech 指摘が対象単語ペア（または機能語）を特定し、現象別メッセージと期待発音 IPA（例 "want to" → /wɑnə/）を持つ。固定文「ここは連結・弱形にするとネイティブらしくなります」が rule-based generator から全廃される。

### フィードバックの質（Phase 2）

- [ ] **M-101（REQ-101 誤りカタログ）**: 日本語話者誤りカタログがコードから分離した編集可能データとして存在し、各項目が { 種別(segmental/syllabic/prosodic), 対象音素・対立, confusion set, L1 干渉メカニズム説明文, functional load ランク, intelligibility 影響度, 推奨訓練種別, エビデンス強度 } を持つ。子音 7 + 母音 5 + 母音挿入 + 韻律 4 以上を初期収録する。
- [ ] **M-103（REQ-103 NBest 診断）**: `POST {analyzer}/v1/analyze` のレスポンスに、期待音素ごとの実発話候補（上位 3 件以上 + 信頼度）が含まれる。worker の finding に「検出された最有力候補」と「日本語話者典型パターン（confusion set）に一致するか」の判定が含まれる。
- [ ] **M-104（REQ-104 3 層フィードバック）**: 各 finding の `messageJa` が ①観測（期待音/検出音/単語内位置を含む）②原因（カタログの L1 干渉説明を含む）③修正（調音点・調音法レベルの行動可能な指示）の 3 層で生成される。phenomenon × 音素対立 × 単語内位置の組合せでメッセージが変化する（固定 4 種からの脱却）。日本語必須・英語併記。
- [ ] **M-111（REQ-111 二段階スコア）**: 明瞭性（FL 重み付き集計）とネイティブ性（厳しめ判定継承）の 2 軸スコアが返り、CEFR 音韻統制 3 下位尺度（全体/分節/韻律）の内訳が返る。worker の accuracy/prosody スコアが固定値（現状 accuracy=70 / prosody=65 固定）でなくなる。
- [ ] **M-112（REQ-112 FL 優先度・focus sounds）**: 誤りの優先度が FL ランク × 出現頻度 × 習熟度の三項から動的計算され、focus sounds リストが返る。低 FL 誤り（/θ/ 等）は「検出するが優先度ラベル低 + FL 理由提示」になる。
- [ ] **M-114（REQ-114 韻律実計測）**: `POST {analyzer}/v1/analyze` のレスポンスに、学習者 F0 輪郭、語強勢の期待値（辞書 0/1/2）と実測値（F0/強度/持続時間推定）の単語単位突合、リズム指標（nPVI 等）、機能語の弱形実現率（単語特定付き）が含まれる（parselmouth 実装）。worker の prosody スコアがこれらから算出され固定値でない。
- [ ] **M-115（REQ-115 epenthesis 独立検出）**: 期待音節数と実測音節数の差分が単語単位で検出され、`epenthesis` finding として（substitution/insertion と区別して）返る。挿入位置と挿入母音（[ɯ]/[o]/[i]）が特定される。フィードバック文が「カタカナ読み混入」L1 メカニズムと「音声先行模倣」対策を含む。

### お手本 TTS（REQ-124）

- [ ] **M-124（REQ-124 お手本 TTS）**: General American の OSS TTS（Kokoro-82M）でお手本音声を生成する real endpoint が存在し、指摘箇所（finding の text range）単位の部分お手本の audio bytes を返す。再生速度 0.5–1.0x 調整に対応する。学習者録音とお手本の A/B 交互再生が UI で可能。CPU 実用速度で動く。

### デザイン完全合致（非交渉）

- [ ] **M-DS（components-v2 全移植）**: `tokens-v2.css` の全トークンと `components-v2.css` の全クラスを frontend に移植する（スコープ外画面=HVPT/シャドーイング/進捗の部品 CSS も含めデザインシステム完全合致）。
- [ ] **M-WS（workspace-v2 pixel-perfect）**: `workspace-v2.html` の主要 v2 部品が実 React コンポーネントとして存在し workspace 結果画面でレンダリングされる: `.fb3`（3 層 `.fb3-row--what`/`--why`/`--fix`）、`.nbest`（`.nbest-row.is-top` + 上位 3 件 + `.nb-bar`/`.nb-p`）、`.conf[data-level]`/`.hedge`/`.fold`/`.dismiss-btn`、二段階軸（`.mini-axis .ma`）と CEFR `.subscale`、`.gopmap`（`.gopw`/`.cells`/`.gp[data-h]`）、F0 韻律ビュー、A/B お手本切替（`.ab-srcs`/`.ab-src.is-active`）、phenomenon 表示（`.phen`/`.pi` アイコン + `.pe` ラベル、本文ハイライトは `.hl-ico`）。
- [ ] **M-CODE（多重符号化規約）**: 色 = 重大度の多重符号化（severity は色 + バッジテキスト + アイコン）。phenomenon は色を割り当てずアイコン + ラベルのみ。3 書体（jp/mono/英文）・ダーク基調を厳守する。

## Should (望ましいが必須でない)

- **S-105（REQ-105 調音指導）**: 高優先音素（/r/,/l/,/æ/,/ʌ/,/iː/-/ɪ/,/θ/,/ð/,/v/,/f/,schwa）の矢状断面図 + 調音手順を提供し、詳細パネル ③How からリンクされる。※図版本体（実 SVG）は Non-goal。枠/手順/音響併置のプレースホルダー構造（`.fb3-row--fix` の「調音図解 → /l/」ボタンからのリンク先パネル）は作る。
- **S-112-streaming（REQ-112 漸進更新）**: focus sounds が解析のたびに漸進更新される（再診断テストを別途課さない）。

## 受入条件 (acceptance — Must の確認方法)

- **M-107a** → `docker compose up` 後、解析済みセクションに対し `GET /api/v1/sections/{id}/workspace` を叩き、`.data.resultsByEngine[0].findings[0]` に `phenomenon != null && typeof gop === 'number' && confidence >= 0 && confidence <= 1` を assert。
- **M-107b** → 同レスポンスに `resultsByEngine[].engineSummaryMessageJa`（または同等フィールド、非空文字列）が含まれることを assert。Playwright で workspace 画面に `.eng-summary` がテキスト付きで存在する。
- **M-107c** → 同レスポンスに全音素 GOP 系列（finding 化されなかった音素を含む語×音素配列）が含まれることを assert（finding 数 < 音素総数を確認）。Playwright で「GOP ヒートマップ」ビュー切替時に `.gopmap .gp` が音素数ぶん描画される。
- **M-107d** → 同レスポンスの `highlightRangesByEngine[].highlights[].messageJa` が非 null かつ非空であることを assert（現 `null` ハードコードの回帰防止）。
- **M-108** → (a) Playwright で finding に `.conf[data-level]` が表示される、(b) 低信頼 finding が `.fold` 内 `.hedge` でヘッジ語尾「可能性があります」を含む、(c) `.dismiss-btn` クリック → 却下 endpoint へ POST/PATCH → 同セクション再取得で当該 finding が `dismissed: true`（または却下リストに含まれる）で返る、を assert。
- **M-102** → contract test: 既知の connected speech 含み音声を worker に投げ、レスポンス finding の `phenomenon` に `connectedSpeech` 以外（`weakForm` 等）が現れる。`epenthesis`/`lexicalStress` を含む音声で当該 enum 値が返る。`isValidFindingPhenomenon('epenthesis') === true` の単体 assert。
- **M-109** → connected speech finding に対象単語ペア（`expected.text` または token range が単語対を指す）と期待発音 IPA（`expected.ipa` 非 null）が含まれ、`messageJa` が固定文「ここは連結・弱形にするとネイティブらしくなります」と一致しないことを assert（rule-based generator から該当 string が grep で消えている）。
- **M-101** → カタログデータファイル（JSON/YAML 等、コード外）が存在し、ロード時に子音 7 + 母音 5 + 母音挿入 + 韻律 4 件以上、各項目が 8 必須フィールドを持つことを単体 test で assert。
- **M-103** → `POST {analyzer}/v1/analyze`（固定 wav fixture）のレスポンス JSON に、期待音素ごと `nBest`（length >= 3、各要素に `phoneme` + `confidence`）が含まれることを assert。worker finding に `detectedTopCandidate` と `matchesL1Pattern: boolean` が含まれる。
- **M-104** → finding `messageJa` が 3 セクション構造（①②③ または what/why/how マーカー）を含み、L1 干渉文・調音指示文を含むことを assert。phenomenon・音素対立・位置の異なる 2 finding で `messageJa` が異なる（固定文でない）ことを assert。
- **M-111** → workspace API レスポンスの scores に `intelligibility` と `nativeLikeness`（または 2 軸明示フィールド）+ CEFR 3 下位尺度（overall/segmental/prosodic）が含まれる。同一誤り集合で FL 高誤り混入時のほうが intelligibility 減点が大きいことを worker unit test で assert。accuracy/prosody が入力依存で変動する（固定 70/65 でない）。
- **M-112** → API レスポンスに `focusSounds`（FL/頻度/習熟度由来の優先度付きリスト）が含まれ、低 FL 誤りが優先度低ラベル + FL 理由付きで返ることを assert。Playwright で `.focus-row` に `.prio--now`/`Next` が描画される。
- **M-114** → `POST {analyzer}/v1/analyze` レスポンスに `f0Contour`（学習者、数値配列）、語強勢 `expectedStress`/`predictedStress`（単語単位）、`rhythmNpvi`、`weakFormRealizations`（単語特定付き）が含まれることを assert。worker prosody スコアが固定 65 でなく入力で変動することを assert。
- **M-115** → epenthesis 含み音声 fixture で、analyzer/worker が `expectedSyllableCount != actualSyllableCount` の単語を検出し、`phenomenon: 'epenthesis'` finding に挿入位置 + 挿入母音を含めて返すことを assert。`messageJa` が「カタカナ」「音声を先に聞いて」相当の文言を含む。
- **M-124** → お手本 TTS の real endpoint（例 `GET/POST .../tts` 等、配置は topology-mapper が決定）に finding text range を渡すと `Content-Type: audio/*` の非空バイト列が返ることを assert。`speed=0.5` と `speed=1.0` で異なる長さの音声が返る。Playwright で `.ab-src`（お手本）クリック → 再生可能、`.sp-chip`（0.85x 等）で速度切替が UI 反映。
- **M-DS** → `components-v2.css` 相当が frontend に存在し（`pnpm build` 成功 + `.fb3`/`.nbest`/`.gopmap`/`.subscale`/`.fold`/`.conf`/`.phen`/`.ab-src` 等の v2 クラスが CSS に定義される）、HVPT/シャドーイング/進捗セクションの部品クラスも含まれることを grep で assert。
- **M-WS** → Playwright で workspace 結果画面を開き、列挙した v2 部品セレクタ（`.fb3-row--what`/`--why`/`--fix`、`.nbest-row.is-top`、`.conf[data-level]`、`.hedge`、`.fold`、`.dismiss-btn`、`.mini-axis .ma`、`.subscale`、`.gopmap .gp`、`.ab-src.is-active`、`.phen .pe`、本文 `.hl-ico`）が全て存在することを assert。
- **M-CODE** → ast-grep / Playwright で、severity 表示に色クラス + テキストラベル + アイコンが共存し、phenomenon 表示に重大度色クラスが付かない（`.phen` に `--critical` 等が無い）ことを assert。

## Non-goals (今回やらない)

- **Phase 3 訓練画面の画面実装**: HVPT/ドリル/シャドーイング/スケジューラ（REQ-121/122/123/125/127）、progress.html（REQ-129）、diagnostic.html（REQ-121）の**画面**は作らない。
- **重い ML 本体（今回スコープ外）**: golden speaker VC（REQ-128）、LLM 個別化（REQ-106）、調音図解の実 SVG 図版本体（REQ-105 の図版そのもの。枠/手順/音響併置プレースホルダー構造は M-WS/S-105 の範囲で作る）、習熟度適応の動的切替実体（REQ-113）、採点器 contract 抽象化の GOPT 差し替え実体（REQ-116）。
- **偽データ表示の禁止**: 上記スコープ外 ML が必要な部品（golden speaker A/B の Golden ソース、HVPT 刺激音源、LLM 文、SVG 図版）は本番経路に mock/stub/偽データを入れず、実契約の裏に正直な空状態 / プレースホルダー構造（「準備中」「GPU 必要」等）を置く。
- **components-v2.css の HVPT/シャドーイング/進捗セクションは CSS のみ全移植する（画面は作らない）** — これは Non-goal の例外として M-DS に含む。
- 採点閾値の本格キャリブレーション（自己録音グラウンドトゥルース蓄積）は対象外。MVP は ADR-001 の保守的デフォルト + confusion set ルール補完で進める。

## Risk

- level: **high-risk**
- escalate_to_opus: **true**
- 理由（触れる境界領域）:
  - **migration / schema**: 却下永続化（REQ-108）の新テーブル追加 + `assessment_results` の JSON BLOB（`assessment_result_json` / `raw_response_json`）拡張で全音素 GOP・NBest・F0・2 軸スコアを格納。Drizzle schema + migration。
  - **schema（公開契約横断）**: `FindingPhenomenon` への `epenthesis`/`lexicalStress` 追加、`api-types.ts` の `EngineFindingDto`/`EngineResultDto` 拡張（nBest/focusSounds/2 軸スコア/CEFR 内訳）、analyzer の `interface/schema.py`（nBest/f0Contour/stress/nPVI/weakForm）と worker ↔ analyzer HTTP 契約、ACL 正規化 — frontend/worker/analyzer の 3 層公開契約に同時に触れる。
  - **routing**: お手本 TTS の新 endpoint（REQ-124）、却下 endpoint（REQ-108）の App Router 配置。worker の WorkerApi 型（`Api.hs`）↔ Application handler の配線点。
  - **public export**: ドメイン enum / DTO 型の公開シグネチャ変更（ADR-004 と同一 PR 更新が受入条件）。
  - **config / DI**: Kokoro-82M モデル導入（HF cache volume）、parselmouth 導入（REQ-NF-101 で GPL-3.0 → python-analyzer 内利用に限定、ライセンス影響を ADR 判断）、compose.yaml の TTS 配線、registry/container の新 usecase・port 配線。

## Open questions (あれば)

- なし（grill-me 相当の Q1–Q8 で責務境界・contract 型・MVP 範囲・espeak 統一・キャリブレーション方針は確定済み）。実装着手前に topology-mapper が決める論点（解決不要・実装判断）として記録のみ:
  - お手本 TTS / 却下 endpoint の具体 path とメソッド（App Router 配置 + worker 経由か frontend 直か）。
  - parselmouth（GPL-3.0）の配布形態に対するライセンス影響の ADR 化（REQ-NF-101 の指示どおり ADR で判断する手続きは残る）。
  - 全音素 GOP・NBest・F0 の格納先（既存 `assessment_result_json` BLOB 拡張か新テーブルか）— migration 設計で確定。
