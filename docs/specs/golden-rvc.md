# Spec: golden-rvc

<!-- 要件: REQ-128 (golden speaker — 自己音声ネイティブ風変換)
     REQ-NF-102 (CPU baseline / GPU optional)
     REQ-NF-101 (OSS license: Apache-2.0 / MIT / BSD / CC BY)
     設計の正: adr/012-golden-speaker-voice-conversion-rvc.md (Accepted)
     研究根拠: docs/06-research/pronunciation-feedback-research.md T-6 / §3.3-7
       (golden speaker: エビデンス弱い — RCT なし / n=6–35 / prosody-only 無効 Felps 2009;
        modern VC MOS ≈ 4.0)
     既存 placeholder:
       applications/frontend/src/components/workspace/WorkspaceResultV2.tsx
         AudioSource = "self" | "model" | "golden" (l.12)
         golden button は disabled + title "GPU 必要 / 準備中" (l.370-375)
         .ab-srcs A/B switch + --src-golden token 既存 (l.350-)
     既存パターン参照:
       compose.yaml: worker(ANALYZER_URL) / analyzer の HTTP 境界パターン (ADR-004)
       ADR-006: parselmouth 封じ込めパターン → RVC 封じ込めに流用
       ADR-005: same-PR fitness-function 規則
     親 spec: docs/specs/pronunciation-feedback-v2.md
     前提完了:
       workspace A/B switch (.ab-srcs / AudioSource) が実装済み
       (WorkspaceResultV2.tsx の golden ボタンが placeholder として描画されていること) -->

## Goal

- 学習者自身の音声を RVC (MIT) で native-style に変換した「golden speaker」音源を、
  workspace の A/B switch 第3音源として提示する (REQ-128)。
- 変換は独立 GPU-optional サービス(golden サービス)が担い、
  worker / python-analyzer / frontend は HTTP 境界越しにのみ接触する (ADR-012)。
- 品質ゲートを通過した変換音声のみ再生可能にし、使用ログを記録して
  エビデンスが弱い機能を検証フェーズとして運用する。
- golden サービスが無効な環境でも、アプリ本体と他機能が一切退行しないこと。

## Must (満たさなければ done でない)

- [ ] **M-GRV-1 (golden サービス: 独立コンテナ + HTTP エンドポイント)**
  `applications/golden-speaker/` に RVC ベースの変換サービスを実装し、
  `compose.yaml` に `golden` サービスを追加する。
  サービスは `POST /v1/convert` を公開し、
  multipart/form-data で `learner_audio` (WAV バイト列) と
  `reference_audio` (WAV バイト列; Kokoro TTS 生成済みお手本) を受け取り、
  `GoldenConversionResponse` (JSON) を返す。
  `GoldenConversionResponse` は次のフィールドを持つ:
  - `audioBase64: string` — 変換済み WAV を Base64 エンコードしたもの
  - `qualityGatePassed: boolean` — 品質ゲート通過可否
  - `withholdReason: string | null` — ゲート不通過の場合の理由 (通過時は null)
  ゲート不通過時は `audioBase64` を空文字または null とし、
  HTTP ステータスは 200 (ゲート判定は業務ロジック; 5xx ではない)。
  エンドポイントは `interface/http_handler.py` の router に定義され
  `app.py` の `include_router` で登録されていること (golden 配線点)。

- [ ] **M-GRV-2 (golden サービス: 実変換 — CPU 推論パス)**
  `POST /v1/convert` は偽値・固定 WAV・サイレンスを返さず、
  RVC 推論によって `learner_audio` と `reference_audio` から導出された
  実変換音声を `audioBase64` に格納すること。
  別の `learner_audio` を投じると `audioBase64` の内容が変わること
  (contract test で assert)。
  CPU のみの環境で推論が完走すること (GPU 不在でも変換が試みられること)。
  事前学習 RVC モデル重みが存在しない場合は、
  HTTP 503 または `qualityGatePassed: false` + `withholdReason: "model_unavailable"` を返し、
  呼び出し元が壊れないこと。

- [ ] **M-GRV-3 (golden サービス: 品質ゲート)**
  変換結果は品質ゲートを通過した場合のみ `qualityGatePassed: true` で返す。
  ゲート指標と閾値は OQ-1 (人間確認要) で確定後に実装し、
  domain literal に埋め込まず設定値 (`GOLDEN_QUALITY_THRESHOLD_*` 等の env) として外出しする。
  ゲート不通過時は `audioBase64` を呈示せず `withholdReason` に理由を返す。
  ゲートを意図的に bypassする分岐 (`if skip_gate`) を本番コードに入れないこと。

- [ ] **M-GRV-4 (compose / 境界 env)**
  `compose.yaml` に以下を追加する:
  - `golden` サービス定義 (build context: `applications/golden-speaker/`)
  - 境界環境変数 `GOLDEN_SPEAKER_URL` を `worker` サービスの environment に追加
    (例: `GOLDEN_SPEAKER_URL: "http://golden:8789"`)。
  - `worker` が `depends_on: golden` で golden サービスの起動を待機する
    (golden サービスが起動しない場合はアプリ本体が起動を拒否しないこと — OQ-3 参照)。
  `wiring_manifest.yml` に `frontend/worker → golden /v1/convert` の HTTP エッジを追加し、
  golden サービスが frontend / python-analyzer / worker の内部型を import しないことを assert する。

- [ ] **M-GRV-5 (ast-grep 封じ込めルール: RVC import 隔離)**
  RVC およびその依存ライブラリの import が
  `applications/golden-speaker/` の外側
  (python-analyzer / frontend / backend の Haskell worker) に存在しないことを
  ast-grep ルールで静的に検査し、fitness hook と CI で実行する。
  ルールは ADR-006 の `no-parselmouth-outside-python-analyzer` パターンに倣い、
  同 PR に含める (ADR-005 同 PR 規則)。
  `scripts/verify-wiring.sh` が golden サービス境界を検査対象に含むこと。

- [ ] **M-GRV-6 (worker: golden 変換プロキシ)**
  Haskell worker が `GOLDEN_SPEAKER_URL` 環境変数で golden サービスを参照し、
  `POST /golden-speaker/convert` (worker 外部公開パス) で受け取った
  `learner_audio` + `reference_audio` を golden サービスの `POST /v1/convert` に転送し、
  `GoldenSpeakerConversionDto` (`audioBase64 :: Text` / `qualityGatePassed :: Bool` /
  `withholdReason :: Maybe Text`) を `Types.hs` に追加して `ToJSON` / `FromJSON` 両方を実装する。
  worker の `Api.hs` に `/golden-speaker/convert` ルートが追加され
  `Application.hs` の handler と接続されていること (agent-policy 配線点)。
  golden サービスが起動していない場合、worker は 503 を返し他ルートに影響を与えないこと。

- [ ] **M-GRV-7 (frontend: golden 音源の A/B 再生)**
  `WorkspaceResultV2.tsx` の golden ボタン (現在 `disabled` / title "GPU 必要 / 準備中") を
  機能させる:
  (a) golden ボタンが有効 (`disabled` 解除) になり、クリックで `activeAudioSource` が
      `"golden"` に切り替わること。
  (b) `activeAudioSource === "golden"` の状態で `.pp` 再生ボタンを押すと、
      worker `POST /golden-speaker/convert` を呼び出し、
      `qualityGatePassed: true` の場合は変換音声 (`audioBase64`) を再生すること。
  (c) `qualityGatePassed: false` の場合は `.gs-gate` に `withholdReason` に基づく
      理由メッセージを表示し、変換音声を再生しないこと。
  (d) golden サービスが無効 (503 / ネットワーク不到達) の場合、`.gs-gate` に
      "Golden speaker 準備中" 等のフォールバックメッセージを表示し、
      self / model 音源の再生が継続して動作すること (他機能無退行)。
  表示テキストはすべて API レスポンスから導出し、静的 HTML の固定文字列を焼かないこと。

- [ ] **M-GRV-8 (frontend: 使用ログ記録)**
  学習者が golden 音源を再生した操作を使用ログとして永続する。
  ログエントリは `audioSource: "golden"` / `timestamp` / `qualityGatePassed: boolean` /
  `sessionIdentifier` を含む。
  ログの置き場は OQ-2 (人間確認要) で確定後に実装する。
  A/B 切り替え (golden / model / self) の使用回数が比較可能な形で記録されること。

- [ ] **M-GRV-9 (アプリ本体の無退行: golden サービス無効時)**
  `compose.yaml` から `golden` サービスを除いた状態 (または golden サービスが起動しない状態) で
  `docker compose up worker analyzer` を実行したとき、
  アプリ本体 (workspace 画面の self / model 音源再生、発音解析、採点表示) が
  正常に動作すること。
  `WorkspaceResultV2.tsx` の golden ボタンがフォールバック表示 (M-GRV-7d) になるだけで、
  他機能が 500 / クラッシュしないこと。

- [ ] **M-GRV-10 (ライセンス確認: モデル重み)**
  使用する RVC 事前学習モデル重みのライセンスを REQ-NF-101
  (Apache-2.0 / MIT / BSD / CC BY の範囲) に照らして確認し、
  `docs/license-notes/golden-rvc-model-weights.md` に確認結果を記録すること。
  モデル重みを golden サービスのコンテナイメージに焼き込まず、
  実行時 volume mount または起動時ダウンロードで供給すること (ADR-012 Compliance)。
  ライセンス確認が完了するまでモデル重みを本番経路に含めないこと。

- [ ] **M-GRV-11 (agent-policy 厳守: 本番に偽値なし + 実 entrypoint 実行 assert)**
  本番コードに mock/stub/fake/dummy/spy / test-bypass / placeholder stub を入れないこと
  (`scripts/verify-*.sh` 緑)。
  変換音声に偽値・サイレンス・固定 Base64 を入れないこと (agent-policy)。
  real public entrypoint (App Router workspace 画面 → worker `POST /golden-speaker/convert`
  → golden サービス `POST /v1/convert`) から到達可能かつ観測可能挙動
  (実学習者音声で変換音声または品質ゲート withhold が返る) を実行 assert できること。
  `.agent-evidence/` の commands.txt / wiring-map.json / completion-report.md を提出すること。

## Should (望ましいが必須でない)

- **S-GRV-1 (変換音声プレビュー波形)**: 変換音声再生中に `.wave` ビジュアライザーが
  golden 音源の波形を模擬表示する (現状 self/model と同等のアニメーション)。
  M-GRV-7 達成後の UX 向上として別スライス候補。
- **S-GRV-2 (変換品質スコア表示)**: `.gs-gate` 周辺に品質ゲートスコア
  (MOS 推定値や SNR 等) を数値で補足表示し、学習者が変換品質を把握できるようにする。
- **S-GRV-3 (GPU 学習フロー)**: GPU 環境において学習者自身の音声
  (10 分未満) から RVC モデルを fine-tune する学習フロー。
  本スライスは CPU 推論 (事前学習モデル使用) にとどめ、GPU 学習は別スライスとする。
- **S-GRV-4 (segment-level 変換の並列化)**: 長い発話を segment に分割して
  並列変換し、レイテンシを短縮する。MVP は順次処理でよい。
- **S-GRV-5 (使用ログの集計ビュー)**: A/B 音源の使用回数を progress 画面に
  集計表示し、golden 効果の自己モニタリングを可能にする。

## 受入条件 (acceptance — Must の確認方法)

- **M-GRV-1** →
  `docker compose up -d --build` 後、
  `curl -X POST http://localhost:8789/v1/convert \
    -F learner_audio=@learner.wav \
    -F reference_audio=@reference.wav`
  が HTTP 200 + `{ "audioBase64": "<非空 string>", "qualityGatePassed": true|false, "withholdReason": null|"<string>" }`
  を返すこと (フィールドが全て存在する)。
  `grep -r "convert" applications/golden-speaker/src/.../interface/http_handler.py`
  でルート定義が存在し、`app.py` の `include_router` で登録されていることを確認。

- **M-GRV-2** →
  2 種類の `learner_audio` (異なる話者・発音) で `POST /v1/convert` を叩き、
  `audioBase64` の内容が互いに異なること (contract test で assert)。
  golden サービスの `test/` に `convert(learner_wav, ref_wav)` が
  非空 Base64 を返す統合テストが green。
  `scripts/verify-no-prod-doubles.sh` 緑 (偽値なし)。
  モデル不在時に 503 または `{ qualityGatePassed: false, withholdReason: "model_unavailable" }` を返し
  HTTP 4xx/5xx でも呼び出し元が壊れないことを統合テストで確認。

- **M-GRV-3** →
  品質ゲートを意図的に下回る低品質な変換結果 (SNR や MOS が閾値未満を模したテスト音声) を
  サービスに渡したとき、`qualityGatePassed: false` かつ `withholdReason` が非 null で返ること
  (統合テストで assert)。
  閾値が設定値 (`GOLDEN_QUALITY_THRESHOLD_*` 等の env) から読まれることを
  `grep` で確認 (ドメインコードに数値 literal なし)。
  `if skip_gate` / `bypass` 等の本番 bypassがコードに存在しないことを
  `scripts/verify-no-stub-placeholder.sh` で確認。

- **M-GRV-4** →
  `grep "golden:" compose.yaml` で golden サービス定義が存在すること。
  `grep "GOLDEN_SPEAKER_URL" compose.yaml` で worker 側 environment に env が存在すること。
  `cat wiring_manifest.yml` に `frontend/worker → golden /v1/convert` エッジが記述されていること。

- **M-GRV-5** →
  `pnpm fitness` (ast-grep + ESLint) が緑。
  `grep -r "rvc\|rvc_model\|from rvc" applications/python-analyzer/ applications/frontend/ applications/backend/`
  で 0 件であること (RVC import 漏れなし)。
  CI (`pr-gate.yml`) で ast-grep スキャンが緑。

- **M-GRV-6** →
  `cabal test all` が green。
  `grep -r "golden.speaker\|GoldenSpeaker" applications/backend/src/` で
  `Api.hs` と `Application.hs` に `/golden-speaker/convert` が存在すること。
  `GoldenSpeakerConversionDto` の `ToJSON` / `FromJSON` round-trip テストが green。
  golden サービスが起動していない状態で worker に `POST /golden-speaker/convert` を叩いたとき
  HTTP 503 が返り worker が crash しないことを確認。

- **M-GRV-7** →
  Playwright: workspace 画面で golden ボタンをクリックし `activeAudioSource` が `"golden"` になること。
  `.pp` 再生ボタンを押したとき:
  (a) `qualityGatePassed: true` の場合: `<audio>` が再生開始し `.wave` バーがアニメーションすること。
  (b) `qualityGatePassed: false` の場合: `.gs-gate` に withholdReason 由来のメッセージが表示され、
      音声が再生されないこと。
  (c) golden サービス 503 の場合: `.gs-gate` にフォールバックメッセージが表示され、
      self / model ボタンが引き続き動作すること (別 E2E シナリオで assert)。

- **M-GRV-8** →
  golden 音源を 1 回再生した後、OQ-2 で確定したログ置き場を
  `SELECT * FROM <log_table> WHERE audio_source = 'golden'` (または等価クエリ) で確認し、
  `audioSource: "golden"` / `qualityGatePassed` / `timestamp` を含む行が 1 件存在すること。
  A/B 切り替えで model / self を再生したときのログも別行で存在し、
  `audioSource` フィールドで区別可能であること。

- **M-GRV-9** →
  `docker compose up worker analyzer` (golden サービスなし) で起動後、
  Playwright: workspace 画面で発音解析 → 採点表示 → self 音源再生 → model 音源再生 が
  エラーなく動作すること。
  golden ボタンは `.gs-gate` フォールバック表示になるが、他 UI が 500 / クラッシュしないこと。
  `docker compose logs worker` に golden サービス不到達ログはあってよいが、
  worker の process が終了していないこと。

- **M-GRV-10** →
  `cat docs/license-notes/golden-rvc-model-weights.md` に
  使用モデル重みの名称 / ライセンス名 / REQ-NF-101 適合可否が記載されていること。
  `docker inspect <golden-image>` でモデル重みファイルがイメージレイヤーに含まれていないことを
  確認 (volume または起動時ダウンロード経由であること)。

- **M-GRV-11** →
  `scripts/verify-no-prod-doubles.sh` / `verify-test-bypass.sh` /
  `verify-no-stub-placeholder.sh` / `verify-wiring.sh` / `verify-allowlist-expiry.sh`
  が対象差分で緑。
  `.agent-evidence/wiring-map.json` に
  `workspace 画面 → App Router → worker POST /golden-speaker/convert
  → golden サービス POST /v1/convert → GoldenConversionResponse` の経路が記述されていること。
  `.agent-evidence/commands.txt` に real endpoint を叩いたコマンドと出力が記録されていること。

## Non-goals (今回やらない)

- **GPU 学習フロー (S-GRV-3)**: 学習者音声から RVC モデルを fine-tune する GPU 学習は
  本スライスの対象外。本スライスは CPU 推論 (事前学習モデル使用) に限定する。
- **kNN-VC 採用**: ADR-012 で不採用決定。WavLM エンコーダが GPU 推奨であり CPU MVP に不適。
- **seed-vc 採用**: ADR-012 で GPL-3.0 を理由に不採用決定。
- **prosody-only 変換**: Felps et al. 2009 に基づき無効とする。
  変換は segment-level で行い、prosody のみの変換モードを実装しない。
- **変換音声の発音採点**: 変換済み golden 音声を再度 `POST /v1/analyze` に投じて
  採点に使用することは本スライス対象外。
- **使用ログの集計ビュー / progress 画面連携 (S-GRV-5)**: 記録はするが集計表示は別スライス。
- **SaaS / 第三者配布対応**: ライセンス再確認を要するが本 MVP はローカル動作のみ。
  配布形態変更時は ADR-012 Compliance 節に従い license を再確認する。
- **自己録音キャリブレーション**: golden speaker の音質を学習者の録音環境に
  適応させるキャリブレーションステップは別スライス。
- **シャドーイング画面への golden 音源適用**: training 画面のシャドーイングお手本は
  Kokoro TTS (General American) に限定する (docs/specs/shadowing-lag.md Non-goals)。
- **複数ユーザー対応**: 固定 sentinel LearnerIdentifier を流用。

## Risk

- level: **high-risk**
- escalate_to_opus: **true**
- 理由 (触れる境界領域):
  - **新規サービス + container + compose service (routing / public export)**: golden サービスが
    新規コンテナ / HTTP エンドポイント / compose.yaml サービスとして追加される。
    `POST /v1/convert` の `GoldenConversionResponse` スキーマが新規 public export。
    片方だけ追加されると配線が割れる (M-GRV-1 / M-GRV-4 同時成立が必要)。
  - **GPU / モデル重み + ライセンス (config / public export)**: 推論は CPU 可だが、
    事前学習 RVC モデル重みの入手元とライセンスが REQ-NF-101 の範囲内かは
    実装時に初めて確定する (OQ-3)。ライセンス確認が遅れると PR がブロックされる。
    重みをイメージに焼き込む誤りがあると配布時にライセンス違反になる。
  - **ast-grep 封じ込めルール (新規ルール追加 — fitness function)**: RVC import の
    境界チェックを同 PR で追加しないと CI が封じ込めを保証できない (M-GRV-5 / ADR-005)。
    ルール漏れは境界侵食の検知不能につながる。
  - **worker 新ルート (routing)**: `Api.hs` の `WorkerApi` 型と `Application.hs` handler の
    両方に `/golden-speaker/convert` を追加 (Haskell 配線点)。
    `-Werror=missing-fields` でレコード追加漏れが CI で検出されるが cabal test が重い
    (memory: haskell-per-edit-hook-burns-subagent-budget)。
  - **品質ゲート閾値 (config)**: ゲート指標と閾値が OQ-1 (未確定) のままでは
    M-GRV-3 の受入条件が定まらない。閾値の設定値名が確定するまで contract test が書けない。
  - **使用ログ置き場 (schema / event subscription)**: OQ-2 (未確定) が解決するまで
    M-GRV-8 の受入条件クエリが定まらない。Training Context (ADR-007) への接続が
    必要な場合は schema 変更を伴う。
  - **Docker rebuild 焼き込み**: golden サービスもビルド時焼き込みで bind-mount なし。
    コード変更後は `docker compose up -d --build` 必須
    (memory: docker-rebuild-required-for-code-changes)。
  - **3 サービス貫通契約**: golden サービス `GoldenConversionResponse` /
    worker `GoldenSpeakerConversionDto` / frontend ACL schema の 3 層が
    同一 PR で整合している必要がある。

## Open questions

> **解決済み（2026-06-14, lihs 回答 + 必須技術調査）**
> - **MVP 範囲 = CPU 実行モデル同梱で実変換**（lihs 選択）。配線だけでなく実 CPU RVC 変換まで出す。
> - **OQ-1 = (c+d) F0 連続性 + 設定値外出し**: 品質ゲートは F0 連続性チェック（変換後 F0 のピッチ崩壊割合）を既定指標とし、閾値は `GOLDEN_QUALITY_THRESHOLD`（env/config）で外出し。withhold 時は A/B に出さず honest placeholder 維持。
> - **OQ-2 = (c) 独立 `ab_usage_logs` テーブル**: `(learner, source ∈ self/model/golden, played_at, qualityGatePassed)` をフラット記録。schema + Drizzle migration 追加。
> - **OQ-3 = (a) `compose profiles: [golden]`**: golden サービスは profile 外でスキップ、worker は golden 不在でも起動（M-GRV-9 充足）。CPU-only で golden を外せる。
> - OQ-4〜8（非ブロッキング）: golden port=8789、segment 境界/重み供給/env 名は実装判断。
>
> **必須技術調査で確定した license-clean CPU スタック**（`adr/012` + REQ-NF-101 内）:
> - 推論: **rvc-python**（MIT, PyPI） / **torch CPU**（BSD-3, `--index-url .../whl/cpu` で CUDA 肥大回避）
> - content encoder: **ContentVec / hubert_base**（MIT, 190MB） / pitch: **rmvpe**（MIT, 181MB）
> - **ターゲット声: `Nekochu/RVC-VCTK_Voice-sample`（Apache-2.0, 学習元 VCTK=CC-BY-4.0）** — 重みは HF DL（イメージ非焼込, M-GRV-10）。Docker ~2.5–3.8GB。CPU 推論は数秒発話で秒オーダー。
> - **self-voice の帰結（重要・要 UI 整合）**: GPU 学習無しのため golden は**学習者自身の声ではなく汎用 VCTK ネイティブ声への音色変換**になる（self-voice は GPU 学習要 = ADR-012 S-GRV-3 で別スライス）。UI は「自分の声で」と誤認させない（M-GRV-7 = 表示は API レスポンス由来）。
> - license-note 必須: `docs/license-notes/golden-rvc-model-weights.md` に VCTK / CSTR-Edinburgh の attribution を残す（M-GRV-10）。

### 人間確認が要る (ブロッキング) — 着手前に lihs の判断を要する

- **OQ-1 (品質ゲートの指標と閾値) — ブロッキング**
  ADR-012 は品質ゲートの通過条件を「usable level」と記述するが、
  数値指標と閾値を確定していない。候補:
  (a) **SNR (Signal-to-Noise Ratio)**: 変換後の S/N 比が閾値 (例: 15 dB) 以上であること。
      計算が軽量で CPU のみで計算可能。ただし「聴きやすさ」との相関は弱い。
  (b) **MOS 推定 (DNSMOS 等)**: 事前学習 MOS 推定モデルで変換音声の品質スコアを推定し
      閾値 (例: 3.0 以上) と比較。精度が高いが追加モデルが必要。
  (c) **F0 連続性チェック**: 変換後の F0 抽出で非連続点 (ピッチ崩壊) が一定割合を超えたら withhold。
      専用モデル不要。
  (d) **実装者判断に委ねる**: 指標と閾値を設定値で外出しし初期値を実装者が決める。
  **lihs に確認**: どの指標を採用するか。または (d) で implementer に委ねるか。
  これが M-GRV-3 の受入条件を決める。

- **OQ-2 (使用ログの置き場) — ブロッキング**
  A/B 切り替え使用ログ (M-GRV-8) の永続先の候補:
  (a) **Training Context (ADR-007)** のログテーブルに `ab_source_usage_logs` として追加する。
      effect verification と training 画面の集計ビュー (S-GRV-5) への接続が自然。
      schema 変更 + Drizzle migration が必要 (memory: drizzle-migration-regenerate-after-schema)。
  (b) **workspace テーブルに列追加**: 既存 workspace スキーマに
      `golden_play_count` / `model_play_count` / `self_play_count` 列を追加。
      スキーマ変更は最小だが、時系列ログとしての粒度が失われる。
  (c) **独立 `ab_usage_logs` テーブル**: セッション・音源・timestamp・qualityGatePassed を
      フラットに記録するシンプルテーブル。集計クエリが直接書ける。
  **lihs に確認**: (a) / (b) / (c) のどれか。
  これが M-GRV-8 の受入条件クエリを決める。

- **OQ-3 (golden サービス無効時の compose 依存関係) — ブロッキング**
  M-GRV-9 「golden サービスが無効でもアプリ本体が動く」と
  M-GRV-4 「worker が depends_on: golden で起動を待機する」は矛盾する可能性がある。
  解決候補:
  (a) **depends_on を条件付き (service_healthy / optional)**: golden サービスが
      `profiles: [golden]` で profile 外ではスキップ、
      worker は golden 不在でも起動する (compose profiles 機能)。
  (b) **depends_on なし + worker が golden に軟依存**: worker が起動時に
      `GOLDEN_SPEAKER_URL` が設定されているかをチェックし、
      未設定の場合は golden ルートを無効化して他ルートで動く。
  (c) **golden サービスを常時起動必須にする**: M-GRV-9 を緩和して
      「golden サービスが起動しない場合のフォールバックは不要」とする。
  **lihs に確認**: (a) / (b) / (c) のどれか。
  CPU-only MVP で golden サービスをオプションにするなら (a) または (b)。

### 実装判断で非ブロッキング (topology-mapper / implementer が決める)

- **OQ-4 (golden サービスのポート番号)**: `compose.yaml` の golden サービスが
  使用するポートは 8789 (worker:8787 / analyzer:8788 との重複回避) で実装者が確定。
- **OQ-5 (RVC 推論の segment 分割境界)**: ADR-012 が要求する segment-level 変換の
  segment 境界 (文単位 / 音素境界 / エネルギー VAD) は実装者が決める。
  prosody-only 変換でないことだけが契約条件。
- **OQ-6 (worker の proxying vs. direct call)**: ADR-004 の `AnalyzerClient.hs` パターンを踏襲し、
  HTTP POST + JSON decode で golden サービスを呼ぶ方式を基本とする。
  実装詳細は topology-mapper が決める。
- **OQ-7 (モデル重みの供給方法)**: volume mount か起動時 curl ダウンロードかは実装判断。
  ただしイメージ焼き込み禁止は M-GRV-10 で拘束。
- **OQ-8 (品質ゲート設定値の名前)**: `GOLDEN_QUALITY_THRESHOLD_SNR_DB` 等の具体的な
  env 変数名は実装者が決める。OQ-1 で指標が確定してから命名する。
