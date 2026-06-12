---
title: 発音フィードバック改善 調査レポート
version: "1.0.0"
created: 2026-06-12
last_updated: 2026-06-12
status: review
author: lihs
---

# 発音フィードバック改善 調査レポート

本レポートは、現状の NativeTrace が提供する発音フィードバックの課題をコードベース監査により具体的に特定し（§2）、L2 発音習得・CAPT（Computer-Assisted Pronunciation Training）研究のエビデンス（§3）、OSS 実装技術（§4）、商用 CAPT 製品の機能水準（§5）を調査した結果をまとめる。導出された機能要件は [発音フィードバック機能 要件定義書](../01-requirements/pronunciation-feedback-requirements.md) に分離する。

各エビデンスには ID（課題: `C-xx` / 研究知見: `E-xx` / 技術: `T-xx` / 商用ベースライン: `B-xx`）を付与し、要件定義書からトレースできるようにする。

## 1. 調査の目的と方法

プロダクトビジョンは「ネイティブと比較してどこが・なぜ・どう違うかを具体的に示し、反復改善によってネイティブ発音を獲得させる」ことである。しかし現状のフィードバックは抽象的で内容が薄く、このビジョンを達成できない。本調査は次の 3 つを行った。

1. **コードベース監査** — フィードバック生成の全パイプライン（python-analyzer → Haskell worker → frontend ACL → UI）を追跡し、「薄さ」の根拠をファイル:行番号付きで特定
2. **文献調査** — メタ分析・系統的レビューを中心に、多段検証付きリサーチ（117 クレーム抽出 → 25 クレーム 3 票検証 → 23 確証）+ 補完調査 4 本（訓練手法 / 日本語話者課題体系 / OSS 技術 / 商用製品）
3. **ギャップ分析** — 現状 × エビデンス × 商用ベースラインの突合せ（§6）

## 2. 現状プロダクトの課題分析

### 2.1 フィードバック生成パイプラインの現状

```
python-analyzer ── 全音素の GOP 値 + タイミング (per-phoneme)
      ↓
Haskell worker ── GOP 閾値判定で finding 化 / phenomenon 分類 / messageJa は常に null
      ↓
frontend ACL ── phenomenon・gop をそのまま正規化
      ↓
UseCase ── RuleBased generator が固定テンプレートで messageJa を埋める
      ↓
workspace API ── phenomenon・gop・confidence を response から脱落させる
      ↓
UI (DetailPanel) ── messageJa + IPA 対比 + severity + scoreImpact のみ表示
```

### 2.2 課題の具体的根拠

#### C-1: 指摘の種類（phenomenon）が実質 4 種類しかない

OSS Worker が生成する phenomenon は `substitution` / `omission` / `insertion` / `connectedSpeech` の 4 種類のみ（`applications/backend/src/NativeTrace/Worker/Scoring.hs:345-354, 449-462`）。API 型には `weakForm` / `linking` / `flap` / `assimilation` / `reduction` が宣言されている（`applications/frontend/src/lib/api-types.ts:166-173`）が、worker は生成しない。ADR-004 が約束した closed enum 8 種のうち半分以上が未実装である。

#### C-2: 改善メッセージが固定テンプレート 4 パターン + デフォルト文のみ

`applications/frontend/src/acl/improvement-message/rule-based/create-rule-based-improvement-message-generator.ts:28-54` の全文言:

| phenomenon | メッセージ |
|---|---|
| substitution | 「${expected}」の音が「${detected}」に置き換わっています |
| omission | 「${expected}」の音が抜けています |
| insertion | 余分な音が入っています |
| connectedSpeech | ここは連結・弱形にするとネイティブらしくなります |
| default | 発音に改善の余地があります |

「なぜそうなるのか」（L1 干渉メカニズム）と「どう直すか」（調音指示）が一切含まれない。REQ-015 が約束した「具体的な修正方法」は未実装である。

#### C-3: 音素単位の計測結果が UI に届かない

python-analyzer は全音素の GOP を計測する（`applications/python-analyzer/src/python_analyzer/interface/schema.py:18-24`、ADR-001「GOP is computed for every expected phoneme」）。しかし worker は GOP < -8 の音素しか finding 化せず（`Scoring.hs:425-431`）、さらに workspace API が `phenomenon` / `gop` / `confidence` を response から脱落させる（`applications/frontend/src/app/api/v1/sections/[sectionIdentifier]/workspace/route.ts:86-98`）ため、計測した細粒度情報のほとんどが UI に到達しない。

#### C-4: connected speech の指摘が場所を問わず同一文言

connectedSpeech finding のメッセージは一律「ここは連結・弱形にするとネイティブらしくなります」（`Scoring.hs:418`）。どの単語間で・どの現象（linking / weakForm / flap …）が・どう発音されるべきかが示されない。

#### C-5: サマリーが 3 段階の固定文で、しかも UI に表示されない

worker のサマリー生成は overall score の 3 区分 × 条件分岐の固定文（`Scoring.hs:532-580`）。さらに workspace API がサマリーをマッピングしないため、ワークスペース画面には表示すらされない。

#### C-6: 「実際に何と発音したか」の診断情報がない

検出音素は単一の IPA 文字列で返るだけで、商用 API が提供する NBest 候補（Azure: 期待音素ごとに実発話候補 5 件 + 信頼度）や `sound_most_like`（Speechace）に相当する「代わりに何と言ったか」の確率的診断がない。OpenAI 系 adaptor では `phenomenon: null, gop: null`（`applications/frontend/src/acl/pronunciation-assessment/openai/response-mapper.ts:110-112`）。

#### C-7: 評価して終わり — 訓練ループが存在しない

現状は「録音 → 採点 → ハイライト表示」で完結し、弱点に基づく訓練（知覚訓練・ドリル・お手本との比較・再評価）への導線がない。要件定義書 v1.0.0 自体が「模範音声生成」「練習ドリル生成」「口の形・舌位置・息の出し方の詳細指導」を対象外と宣言している（`docs/01-requirements/requirements-specification.md` §2.2）。§3 で見る通り、これらは研究上フィードバック効果の中核であり、対象外設定自体がビジョンと矛盾している。

#### C-8: 採点が誤りの重大度を区別しない

severity は GOP 閾値のみから決まり（major: GOP < -12 / minor: GOP < -8）、その誤りが伝達性をどれだけ損なうか（functional load、§3.4）を考慮しない。/r/-/l/ の混同（高重大度）と /θ/→/s/（低重大度）が同じ扱いになる。

### 2.3 設計書と実装の乖離（要件未達）

| 約束 | 出典 | 実装状況 |
|---|---|---|
| phenomenon 8 種の closed enum | ADR-004:28-31 | 4 種のみ生成（C-1） |
| 全音素 GOP 計測 | ADR-001:25 | 計測はするが閾値未満は捨てる（C-3） |
| 詳細パネルに信頼度・エンジン名・関連スコアリンク | REQ-014 | 3 項目とも未表示 |
| 「具体的な修正方法」の表示 | REQ-015 | 未実装（C-2） |

### 2.4 課題の構造

課題は 2 層ある。**(a) 実装が設計書に追いついていない**（C-1, C-3, C-5, 2.3 の未達）と、**(b) 設計書自体がビジョンに対して浅い**（C-2, C-6, C-7, C-8 — 修正方法・調音指導・ドリル・お手本・優先度付けがそもそも要件化されていない）。(a) は配線・実装の修正で解決するが、(b) は要件の追加・既存「対象外」項目の撤回が必要である。

## 3. 研究エビデンス

確度表記: **[高]** = 複数メタ分析/系統的レビューで一致 / **[中]** = メタ分析 1 本または複数 RCT / **[低]** = 単発研究・対照群なし。

### 3.1 L2 発音習得の基本コンセンサス

#### E-1 [高] 発音指導は成人にも明確に有効

Lee, Jang & Plonsky (2015, 86 研究のメタ分析) で d = 0.89（群内）/ 0.80（群間）、Saito & Plonsky (2019, 77 研究) でも明示的発音指導の広範な有効性を確認。CAPT 研究では年齢差は検出されておらず（Mahdi & Al Khateeb 2019）、臨界期後の成人でも改善可能性は実証されている。

#### E-2 [高] ただし効果は統制された課題上の特定素性に集中する

効果は音読・単語リストなど統制課題で測った特定の分節/超分節素性の改善が最大で、自発発話・全体評価への転移は不明確（Lee et al. 2015、Saito & Plonsky 2019 のモデレータ分析）。**設計含意**: 効果測定は「統制課題での素性別スコア」で行い、自発発話への転移は別途設計（課題多様化）が必要。期待値も控えめに設定すべき。

#### E-3 [高] 指導目標の分野コンセンサスは intelligibility 原則

「ネイティブに聞こえること」より「理解されること」を優先し、誤りは重大度（error gravity / functional load）で区別して個別化する（Derwing & Munro 2015）。発音介入は intelligibility そのものを改善する（Hu, Kuo & Dixon 2022: 18 研究で効果量 0.62）。CEFR Companion Volume (2018) も「母語話者度」尺度を廃し intelligibility を主構成概念とする 3 下位尺度（全体的音韻統制 / 分節音の調音 / 韻律）に再設計した。**設計含意**: 「ネイティブ性」をゴールに保ちつつも、採点と優先度付けの第一段階は明瞭性基準で構成するのが研究整合的（→ 二段階ゴール設計）。

#### E-4 [高] CAPT は全体として中程度の効果を持つが、既存システムには体系的な設計ギャップがある

CAPT/ASR ベース訓練の効果は 3 つの独立メタ分析で一致（d = 0.68 / g = 0.69 / medium）。一方で系統的レビュー（Amrate & Tsai 2024, 30 研究）は: (a) 全研究が統制発話練習（主に listen-and-repeat）に留まる、(b) 分節偏重（分節 14 vs 超分節 6）、(c) 多くの CAPT システムが教育学の到達目標（intelligibility）でなく L1 話者比較を実装する pedagogy–technology conflict、を指摘。**設計含意**: 韻律訓練・intelligibility 指標の組み込みは差別化機会である。

### 3.2 フィードバック設計の原則

#### E-5 [高] フィードバックの最重要条件は「明示性」— 誤りの説明を伴うこと

ASR ベース訓練のメタ分析（Ngo, Chen & Lai 2024）で、誤りを説明する明示的訂正フィードバック（g = 0.86）は転写や正誤判定のみ（g = 0.50）を大きく上回る。Lee et al. (2015) でもフィードバック付き介入は効果が増大。**設計含意**: 「どの音が外れた」だけでなく「何が・なぜ・どう直すか」の説明文がフィードバック効果の中核。現状の固定テンプレート（C-2）はこの条件を満たさない。

#### E-6 [中] 素の GOP スコア提示には精度上の上限がある

intelligibility 構成概念で訓練した DNN スコアラー（Cai et al. 2025）は専門家評定と ρ = 0.82 を達成し、古典 GOP（ρ = 0.66）、Whisper confidence（ρ = 0.72）を上回る。注意: 著者は Duolingo 社員で COI があり、ρ = 0.82 はドメイン内訓練時の値。**設計含意**: GOP ベース実装は妥当な出発点だが、採点の正は人間評定との相関であり、将来 construct-aligned モデルへの置換余地を契約（ACL 層）に残すべき。

#### E-7 [低〜中] 誇張・視覚フィードバックは存在証明レベル

PTeacher（CHI 2021、N=80 単発）は誇張音声 + 視覚フィードバックで 1 時間訓練後 14〜28% の改善を報告するが、再現されていない。ピッチ可視化（§3.3-7）の方がエビデンスは厚い。

### 3.3 訓練手法別エビデンス

| # | 手法 | 確度 | 主効果と効果量 | 設計条件 |
|---|---|---|---|---|
| 1 | **HVPT**（高変動知覚訓練） | **高**（複数メタ分析） | 知覚 g ≈ 0.67–0.92、長期保持 g ≈ 0.98、産出転移 g ≈ 0.49–0.66（Uchihara et al. 2025; Sakai & Moorman / Zhang & Xu 2024） | 識別課題（多択）> 弁別課題（g 0.95 vs 0.57）。話者 5–8 名・男女混在（単一話者では般化しない: Lively et al. 1993）。試行ごと正誤フィードバック + 正解音再生で産出転移が倍化（g 0.94 vs 0.45）。1 セッション 20–30 分、総訓練 300–400 分で頭打ち。応答ラベルは綴り/キーワード/IPA（画像は低効果）。日本語話者 /r/-/l/ は Logan/Lively/Pisoni–Bradlow 系列で産出転移と 3 ヶ月保持まで実証済み |
| 2 | **ミニマルペア識別訓練** | **強**（メタ + RCT） | ID 訓練 +22.3pp vs DIS 訓練 +11.3pp（Escudero 系列）。知覚→産出の自動転移は限定的（未訓練項目 g = 0.20） | HVPT と統合実装。誇張刺激→自然音への perceptual fading。産出練習を必ず併設 |
| 3 | **シャドーイング** | 中〜やや強（SR 1 本 + 複数 RCT） | comprehensibility・流暢性・韻律に d ≈ 0.8–0.9（Whitworth & Rose 2025 SR、44 研究）。分節への効果は不確定。日本人 EFL での実証あり（Hamada 2016/2018） | 対象は初中級。週 3–4 回 × 10–15 分 × 6 週以上。ラグが大きい学習者には効果がない（スロー再生から開始）。ASR フィードバック併用で増強 |
| 4 | **分散学習**（spacing） | 中（発音特化 RCT 1 本 + 睡眠固化研究群） | 等間隔/拡張スペーシングは集中練習の約 2 倍の効果（Saito & Chen 2025: 遅延 d 0.99–1.21 vs 0.26）。等間隔と拡張に有意差なし | 24h 程度の等間隔で十分（Anki 式拡張間隔に拘らない）。セッション内正答率 >60% に達してから間隔を空ける。夜間学習は睡眠固化に有利 |
| 5 | **ピッチ可視化** | 中〜低（複数の統制実験、メタ分析なし） | 音声+視覚 > 音声のみが一貫（de Bot 1983; Hardison 2004 — 韻律改善 + 未学習文へ般化）。連続 F0 輪郭 > 記号表記（Niebuhr et al. 2017: タイミングエラー 3–10% vs 40–50%） | 学習者と参照音声の F0 輪郭を同一グラフに重ねる。発話直後の事後表示（リアルタイムは認知負荷高）。最終フェーズで表示を隠すブラインドモードで自己モニタリング定着 |
| 6 | **明示的調音指導・調音可視化** | 中（小規模研究群） | 視覚的調音情報は音響フィードバックと併用で価値（Chang 2023: 超音波群と音声のみ群に群間差なし）。EMA 視覚目標で日本語話者の /æ/ 改善（Ouni et al. 2012）。外部構造（唇）の可視化は有効、舌の内部動態は困難 | ブラウザでは矢状断面アニメーション（SVG）+ 口形動画 + テキスト調音指示が現実解。単独機能ではなく音素フィードバックの説明部品として組み込む |
| 7 | **Golden speaker / self-imitation** | **弱**（RCT なし） | 学習者自身の声のネイティブ風変換で comprehensibility・流暢性改善の報告（Ding et al. 2019 ほか、n=6–35 の前後比較のみ）。韻律のみ変換は効果なし（Felps et al. 2009）。当時の合成品質 MOS ≈ 2.2 がボトルネック（現代 VC は MOS 4.0 前後） | 差別化機能候補だがエビデンス薄。導入するなら検証フェーズ付きオプションとして |

**統合的含意**: 投資対効果が最も高いのは「HVPT + 識別課題を中核に、分散学習スケジューラで回す」構成（唯一複数メタ分析で効果・保持・転移が確立）。産出側はシャドーイング + ピッチ可視化で補完する二本立てが妥当。

### 3.4 日本語話者の誤り体系と優先度

#### E-8 [高] 誤りは「日本語音韻体系への射影」として体系的にモデル化できる

母音は英語 11+ カテゴリ → 日本語 5 母音 + 長短への多対一マッピング（/æ/-/ʌ/-/ɑ/ → /a/、/iː/-/ɪ/ → 長短で再解釈）。子音は /r/-/l/ → [ɾ]、/θ/-/ð/ → [s]/[z]、/v/ → [b]、/s/ → [ɕ]（i の前）等の知覚同化。母音挿入（epenthesis）は調音以前に知覚の問題（Dupoux 系列の「錯覚母音」）で、習熟度が上がっても L1 知覚処理は頑健に残る。**設計含意**: 置換先候補（confusion set）を日本語音韻体系から事前生成でき、GOP の誤り分類器・NBest 診断と直接接続できる。

#### E-9 [中] 優先度は functional load（機能負担量）で決める

Munro & Derwing (2006): 高 FL 誤り（/l/-/r/, /l/-/n/）は低 FL 誤り（/θ/-/f/, /ð/-/d/）より comprehensibility を有意に損ない、低 FL 誤りは数が増えても累積効果がほぼない。Brown (1988) の FL ランキングが標準参照。日本語話者向けの優先度: **最高** /r/-/l/、**高** /æ/-/ʌ/, /iː/-/ɪ/, /s/-/ʃ/, /b/-/v/、**低** /θ/-/s/, /ð/-/z/（目立つが伝達への実害は小さい — 体感優先度と実効優先度が最も乖離する項目）。

#### E-10 [中] 分節 vs 韻律の優先度は習熟度依存

Saito, Trofimovich & Isaacs (2016): 韻律は全習熟度帯で comprehensibility に効くが、分節精度が効くのは上級者のみ。Kang (2010): ピッチレンジと語強勢が韻律変数の中で最も判定を説明。Derwing, Munro & Wiebe (1998): 韻律中心指導は自発発話の comprehensibility に転移するが分節中心指導は転移しない。Saito & Saito (2017) が日本人初級者で明示的韻律指導の効果を追認。**設計含意**: 初中級ユーザーには韻律 + 母音挿入 + /r/-/l/、上級ユーザーには母音の質の精緻化、と優先度を動的に切り替える。

#### E-11 [中] 母音挿入は時間構造の歪みとして独立カテゴリで扱う

母音挿入は音節数（リズム骨格）を破壊するため単一音素置換より語認識への打撃が大きい。Tajima, Port & Dalby (1997): 時間構造の補正だけで明瞭性 39%→58%（+19pt、中国語話者対象の外挿）。模倣時は音読時より挿入が有意に減る（音声先行提示が有効、カタカナ・正書法経由が悪化要因）。

#### E-12 [中] 代替枠組み: Lingua Franca Core と CEFR

LFC（Jenkins 2000）は NNS 聞き手前提で「/θ, ð/ 非コア・母音の質非コア・核強勢コア」とし、NS 聞き手前提の研究（Kang, Saito）と語強勢・弱形の扱いで結論が割れる。CEFR Companion Volume の 3 下位尺度（全体的音韻統制 / 分節 / 韻律）はレベル・進捗表示の枠組みとしてそのまま使える。

### 3.5 検証で棄却された主張（引用禁止）

- 「分節 ASR 訓練 g = 0.82 vs 超分節 g = 0.37 で粒度が効果をモデレートする」（検証 1-2 で棄却）
- 「明示的誤り検出 + 可視化が CAPT 研究の支配的な検証済み設計である」（検証 0-3 で棄却）

## 4. 技術実装の選択肢（OSS）

### T-1: 採点中核 — Kaldi GOP + GOPT

Kaldi `gop_speechocean762` レシピ（Apache-2.0）が古典 GOP の標準実装（音素 PCC = 0.45 with SVR）。GOPT（Gong et al. 2022, BSD-3）は GOP 特徴を Transformer で多アスペクト・多粒度採点し、speechocean762 で音素 PCC ≈ 0.61 / 発話 Total PCC = 0.74、**Prosody PCC = 0.76・Fluency PCC = 0.76 も同時推定**。CPU 完結可能で、Azure 公称（人間評定との PCC > 0.5）と同水準に到達しうる。SSL ベース GOP（HuBERT-large 特徴）は発話レベル PCC 0.77 まで上がる（Kim et al. 2022）。

### T-2: アライメント — MFA、補助に Charsiu

Montreal Forced Aligner（MIT）が音素境界精度最高（平均絶対誤差 13–18ms）。CPU のみで動作。速度報告（RTF 52–194×）は単一論文由来で要自前ベンチ。wav2vec2 系（Charsiu）は textless 可能だが境界精度は劣る（~48ms）。

### T-3: 韻律計測 — parselmouth + De Jong & Wempe + DisVoice + npyvi

parselmouth（GPL-3.0、Praat ラッパー）で F0 輪郭・強度・フォルマント・持続時間。発話速度/休止は De Jong & Wempe (2009) 音節核検出。リズム指標（nPVI 等）は npyvi（MIT）— 英語（高 nPVI-V）vs 日本語（低 nPVI-V）の対比が L1 干渉指標として直接使える。**語強勢検出の汎用 OSS は存在せず**、F0/強度/持続時間から軽量分類器の自作が必要。openSMILE は非商用ライセンスのため注意。

### T-4: MDD（誤発音検出）— wav2vec2-phoneme 系

wav2vec2 ベース MDD は古典 GOP 比で ROC-AUC 0.72→0.85 等の改善報告。ただしベンチマーク（speechocean762 は全員中国語 L1、L2-ARCTIC は日本語話者ゼロ・CC BY-NC で商用不可）に**日本語 L1 データが事実上存在しない**のが最大の構造的制約。ERJ（English Read by Japanese）コーパスはライセンス要確認。日本語話者特化には自前データ + ファインチューニングか、confusion set ベースのルール補完（E-8）が現実解。

### T-5: お手本音声 — Kokoro-82M、高品質枠に StyleTTS2

Kokoro-82M（Apache-2.0、82M、CPU 高速、速度パラメータあり）が第一選択。StyleTTS2（MIT、MOS 4.38 だが重い）。**回避**: XTTS-v2（CPML 商用ライセンス購入先消滅）、Piper 後継（GPL-3.0）、phonemizer（GPL-3.0 伝染）。OSS TTS では「特定音素の強勢強調」制御は標準では難しい。

### T-6: Golden speaker 用 VC — RVC または kNN-VC

RVC（MIT、10 分未満のデータで学習可、推論 CPU 可・学習 GPU 必須）、kNN-VC（MOS 4.03、訓練不要ゼロショット、WavLM エンコーダは GPU 推奨）。GPU 任意環境が前提。seed-vc は GPL-3.0 注意。

### T-7: HVPT 刺激素材 — VCTK / LibriTTS

VCTK（110 名・11 アクセント・CC BY 4.0）、LibriTTS（2,456 名・CC BY 4.0）で多話者ミニマルペア刺激を構成可能。不足分の TTS 合成補完は「合成音声で HVPT 効果が再現されるか」未検証のため自然音声優先。

### T-8: 商用 API との再現性切り分け

OSS で再現可能: 音素正確性（GOP/GOPT）、Omission/Insertion 検出（ASR + アライメント差分）、流暢性指標（speech rate / pause / mean length of run）。再現困難: Prosody 総合スコアの精度、IELTS/CEFR 自動マッピング（独自キャリブレーション必須）。なお「聴者が実際に理解できるか」の直接測定は Azure 含む全システム未解決（フィールド全体の限界）。

## 5. 商用製品ベースライン

### B-1: フィードバック提示の 4 段階モデル

商用製品の「どこが間違っていて、どう直すか」の提示水準は 4 段階に分類できる:

1. スコアのみ（安価アプリ）
2. **誤り位置の特定** — 音素ハイライト + ErrorType（Azure / Speechace の守備範囲）
3. **誤りの中身の診断** — 「代わりに何と言ったか」: Azure NBestPhonemes（期待音素ごとに実発話候補 5 件 + 信頼度）、Speechace `sound_most_like`
4. **修正方法の指示** — 調音点・舌位置レベルのアドバイス + 口腔図/動画（ELSA / BoldVoice のみ。**API 製品はここを返さず、アプリ層が音素→アドバイスの静的マッピングで実現**）

現状の NativeTrace はレベル 2 の途中（位置特定はあるが ErrorType の粒度が粗く、レベル 3・4 が欠落）。

### B-2: ELSA Speak — 調音アドバイスの具体性の参照水準

音素単位の 3 色ハイライト（連続値）。5 スキル分解スコア（Pronunciation / Fluency / Intonation / Word Stress / Listening — 商用アプリで韻律を独立スコア化した稀有な例）。調音指示の実例水準: 「/l/ は舌先を上前歯の裏の歯茎に当て、舌の両脇から息を流す。lllll と数秒伸ばして舌の接触を感じる」。診断テスト 2 分 → 母語と弱点に基づく個別カリキュラム → 1 日 10 分のデイリーレッスン → スコア常時更新。

### B-3: Speechace / Azure — 評価データ構造の参照水準

Speechace: sentence → word → syllable / phone の階層に全て `quality_score`、音節に `stress_level`（期待）+ `predicted_stress_level`（実測）+ `lexical_stress_score`、`sound_most_like`、流暢性指標群、IELTS/CEFR 換算。Azure: Accuracy / Fluency / Completeness / Prosody / PronScore の 5 スコア、ErrorType（Omission / Insertion / Mispronunciation / UnexpectedBreak / MissingBreak / Monotone）、NBestPhonemes。**いずれも修正指示は返さない** — 調音アドバイスはアプリ層の責務であり、日本語話者特化の「音素 → 現象 → アドバイス」辞書が差別化点になる。

### B-4: ループ設計の共通パターン

短時間診断 → 弱点音素リスト（focus sounds）抽出 → 母語考慮の個別パス → デイリードリル → **日常ドリルの結果で診断を漸進更新**（再診断テストを別途課さない）。進捗はストリーク + 多軸スコア推移 + focus sounds 消化が共通最小セット。

### B-5: 研究が指摘する商用製品の限界（差別化機会）

- 音素レベル誤検出の精度は依然低い（precision ~60% / recall 40–80%）— 誤フィードバックのリスクを UI 設計（信頼度表示・ヘッジ表現）で吸収する必要
- 大半が分節偏重で韻律軽視
- 全製品が「ネイティブ規範との距離」をスコア定義に置き、intelligibility 基準でない（E-3 / E-4 の pedagogy–technology conflict そのもの）

## 6. ギャップ分析

| 観点 | 現状 (C-xx) | エビデンス・ベースライン | ギャップ |
|---|---|---|---|
| 誤り説明の明示性 | 固定文 4 種 (C-2) | 明示的説明付きフィードバックが効果の中核 (E-5)、ELSA は調音点レベル (B-2) | **最大のギャップ**。誤りカタログ + 調音指示辞書が必要 |
| 誤りの診断 | 単一 IPA のみ (C-6) | NBest / sound_most_like (B-3)、confusion set は日本語音韻体系から導出可能 (E-8) | python-analyzer の NBest 出力 + 日本語話者 confusion set |
| 誤りの優先度 | GOP 閾値のみ (C-8) | functional load × 習熟度 (E-9, E-10) | error gravity 重み付けと focus sounds 抽出 |
| 韻律フィードバック | 一律文言 (C-4)・代理指標のみ | 韻律は全習熟度で comprehensibility に効く (E-10)、ピッチ可視化に効果 (3.3-5)、GOPT で Prosody スコア推定可 (T-1) | 現象別 connected speech 指摘 + F0 可視化 + 語強勢評価 |
| 細粒度データの到達性 | API で脱落 (C-3, C-5) | 計測済みデータを表示するだけで改善 | 配線修正（最小コスト・即効） |
| 訓練ループ | なし (C-7) | HVPT・シャドーイング・spacing に強いエビデンス (3.3)、商用は診断→ドリル→漸進更新 (B-4) | 「評価ツール」から「訓練システム」への拡張。要件定義 v1.0.0 の対象外宣言の撤回が必要 |
| ゴール設計 | ネイティブ模倣の厳しめ判定一本 | intelligibility 原則 + error gravity (E-3)、商用も全製品ネイティブ規範で研究と乖離 (B-5) | 明瞭性 → ネイティブ性の二段階モデル |
| 誤検出リスク | confidence 非表示 | 音素誤検出 precision ~60% (B-5) | 信頼度の UI 表示と低信頼指摘のヘッジ |

## 7. 要件への反映

本調査から導出した機能要件は [発音フィードバック機能 要件定義書](../01-requirements/pronunciation-feedback-requirements.md) に REQ-101 以降として定義する。各要件は本レポートの C-xx / E-xx / T-xx / B-xx を根拠としてトレースする。

## 8. 主要参考文献

- Lee, J., Jang, J., & Plonsky, L. (2015). The effectiveness of second language pronunciation instruction: A meta-analysis. *Applied Linguistics*, 36(3), 345–366.
- Saito, K., & Plonsky, L. (2019). Effects of second language pronunciation teaching revisited: A proposed measurement framework and meta-analysis. *Language Learning*, 69(3), 652–708.
- Hu, X., Kuo, L.-J., & Dixon, L. Q. (2022). The effects of pronunciation intervention on the intelligibility of English language learners. *Language Teaching Research*.
- Derwing, T. M., & Munro, M. J. (2015). *Pronunciation Fundamentals: Evidence-based perspectives for L2 teaching and research*. John Benjamins.
- Munro, M. J., & Derwing, T. M. (2006). The functional load principle in ESL pronunciation instruction. *System*, 34(4), 520–531.
- Brown, A. (1988). Functional load and the teaching of pronunciation. *TESOL Quarterly*, 22(4), 593–606.
- Ngo, T. T.-N., Chen, H. H.-J., & Lai, K. K.-W. (2024). The effectiveness of automatic speech recognition in ESL/EFL pronunciation: A meta-analysis. *ReCALL*, 36(1).
- Mahdi, H. S., & Al Khateeb, A. A. (2019). The effectiveness of computer-assisted pronunciation training: A meta-analysis. *Review of Education*.
- Almusharraf, A. (2024). CAPT effectiveness meta-analysis. *Journal of Computer Assisted Learning*.
- Amrate, M., & Tsai, P. (2024). Computer-assisted pronunciation training: A systematic review. *ReCALL*.
- Cai, R., et al. (2025). Intelligibility-aligned automatic pronunciation scoring. *Language Learning*, 75, 170–203.
- Uchihara, T., Karas, M., & Thomson, R. I. (2025). High variability phonetic training: A meta-analysis of L2 perceptual training studies. *Studies in Second Language Acquisition*.
- Sakai, M., & Moorman, C. / Zhang & Xu (2024). Does perceptual high-variability phonetic training improve L2 speech production? A meta-analysis. *Applied Psycholinguistics*.
- Bradlow, A. R., Pisoni, D. B., Akahane-Yamada, R., & Tohkura, Y. (1997). Training Japanese listeners to identify English /r/ and /l/. *JASA*, 101(4).
- Logan, J. S., Lively, S. E., & Pisoni, D. B. (1991). Training Japanese listeners to identify English /r/ and /l/. *JASA*, 89(2).
- Hamada, Y. (2016, 2018). シャドーイングの発音・韻律効果（日本人 EFL 学習者）. *Language Teaching Research* / *RELC Journal*.
- Whitworth, L., & Rose, H. (2025). Shadowing in L2 pronunciation: A systematic review (44 studies).
- Ding, S., et al. (2019). Golden speaker builder: An interactive tool for pronunciation training. *Speech Communication*.
- Felps, D., Bahari, H., & Hansen, J. H. L. (2009). Foreign accent conversion in computer assisted pronunciation training. *Speech Communication*.
- Saito, K., & Chen, X. (2025). Spacing effects in L2 phonetic training. *Studies in Second Language Acquisition*.
- Hardison, D. M. (2004). Generalization of computer-assisted prosody training. *Language Learning & Technology*, 8(1).
- de Bot, K. (1983). Visual feedback of intonation. *Language Learning*, 33.
- Niebuhr, O., et al. (2017). Pitch visualization method comparison.
- Saito, K., Trofimovich, P., & Isaacs, T. (2016). Second language speech production: Investigating linguistic correlates of comprehensibility and accentedness. *Applied Psycholinguistics*.
- Kang, O. (2010). Relative salience of suprasegmental features on judgments of L2 comprehensibility and accentedness. *System*, 38.
- Saito, Y., & Saito, K. (2017). Differential effects of instruction on the development of second language comprehensibility. *Language Teaching Research*.
- Derwing, T. M., Munro, M. J., & Wiebe, G. (1998). Evidence in favor of a broad framework for pronunciation instruction. *Language Learning*, 48.
- Tajima, K., Port, R., & Dalby, J. (1997). Effects of temporal correction on intelligibility of foreign-accented English. *Journal of Phonetics*, 25.
- Aoyama, K., Flege, J. E., et al. (2004). Perceived phonetic dissimilarity and L2 speech learning: /r/-/l/. *Journal of Phonetics*.
- Dupoux, E., et al. (1999). Epenthetic vowels in Japanese: A perceptual illusion?
- Jenkins, J. (2000). *The Phonology of English as an International Language*. OUP.
- Council of Europe (2018). *CEFR Companion Volume* — Phonological control scales.
- Zhang, J., et al. (2021). speechocean762: An open-source non-native English speech corpus for pronunciation assessment. arXiv:2104.01378.
- Gong, Y., et al. (2022). Transformer-based multi-aspect multi-granularity non-native English speaker pronunciation assessment (GOPT). *ICASSP*. arXiv:2205.03432.
- Kim, E., et al. (2022). Automatic pronunciation assessment using self-supervised speech representation learning. arXiv:2204.03863.
- ELSA Speak / BoldVoice / Speechace API / Azure AI Speech Pronunciation Assessment 各公式ドキュメント（§5 参照）

## 変更履歴

| バージョン | 日付 | 変更者 | 変更内容 |
|---|---|---|---|
| 1.0.0 | 2026-06-12 | lihs | 初版作成 |
