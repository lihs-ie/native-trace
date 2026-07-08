# Spec: shadowing-lag

<!-- 親 spec: docs/specs/training-screen.md サブスライス (4)
     要件: docs/01-requirements/pronunciation-feedback-requirements.md REQ-125
     研究根拠: docs/06-research/pronunciation-feedback-research.md §3.3-3
       (シャドーイング: comprehensibility・流暢性・韻律に d≈0.8–0.9;
        ラグが大きい学習者には効果がない → スロー再生から開始;
        ASR フィードバック併用で増強; 対象初中級; 週3-4回×10-15分×6週)
     設計パターン参照: adr/010-diagnostic-weakness-profile-focus-derivation.md /
       adr/011-spacing-scheduler-fixed-interval-mastery-gate.md
       (BC 境界・identifier-only 結合・正規化テーブル)
     analyzer 既存資産: parselmouth(F0/extract_f0_contour) /
       wav2vec2 aligner(音素境界) / energy VAD / kokoro_tts.synthesize_speech /
       POST /v1/analyze (referenceF0Contour 実装済) / GET /v1/stimuli (実装済) /
       POST /v1/tts (実装済)
     frontend 既存資産: App Router / Drizzle SQLite / training_sessions (kind='shadowing')
     worker 既存資産: 同期 HTTP Servant / ADR-004 採点契約
     design の正: design-reference/screens/training.html §shadowing
       (.two-col / .passage / .player / .speed / .lag / .lag-needle / .callout / .scope-note)
       design-system-v2.html §12 sched (.lag / .callout)
     前提サブスライス: training-screen sub-1(foundation+scheduler) が done であること
       (training_sessions テーブル + kind='shadowing' 行を書く受け皿)
     確定済 Open questions (training-screen.md):
       OQ-5 = 固定 sentinel LearnerIdentifier を流用 -->

## Goal

- training 画面のシャドーイングモードにおいて、お手本 (Kokoro TTS) と同時に学習者が発話した録音を
  analyzer に送り、お手本との時間ずれ (ラグ、単位 ms) を計測・表示する。
- ラグが閾値を超えた場合にスロー再生 (0.7x) 開始の導線を提示する。
  評価フォーカスはリズム / ポーズ / 話速 (分節の細評価はしない)。
- セッション完了を `training_sessions` (kind='shadowing') に永続し、
  週次実施回数を progress 接続で記録する。
- analyzer の既存計測資産 (parselmouth F0 / energy VAD) を再利用してラグ計測を追加する。
  新規採点ポリシーを Training Context に作らない (ADR-007 制約)。

## Must (満たさなければ done でない)

- [ ] **M-SHL-1 (analyzer: ラグ計測エンドポイント追加)**
  `POST /v1/shadowing-lag` が `interface/http_handler.py` の router に追加され
  `app.py` の `include_router` で登録されていること。
  エンドポイントは multipart/form-data で
  `reference_audio` (WAV バイト列; Kokoro TTS 生成済みお手本) と
  `learner_audio` (WAV バイト列; 学習者録音) を受け取り、
  `ShadowingLagResponse` (JSON) を返す。
  `ShadowingLagResponse` は `lagMilliseconds: int` / `speechRateRatio: float` /
  `pauseCountLearner: int` / `pauseCountReference: int` を持つ。
  (ラグ計測アルゴリズムの選択は OQ-1 で人間確認後に確定する)

- [ ] **M-SHL-2 (analyzer: ラグ計測が実計測値を返す)**
  `lagMilliseconds` は偽値・固定値・乱数ではなく、
  `reference_audio` と `learner_audio` の実音声から導出された観測値であること。
  計測は既存の `energy_vad` / `parselmouth` 資産を再利用する
  (新規アライメントライブラリの追加が必要な場合は OQ-1 で確定してから実装する)。
  別の学習者録音を投げると `lagMilliseconds` が変わること (contract test で確認)。

- [ ] **M-SHL-3 (worker: shadowing ラグ写像)**
  Haskell worker が `POST /v1/shadowing-lag` をプロキシまたは直接呼び出し、
  `ShadowingLagDto` (`lagMilliseconds :: Int` / `speechRateRatio :: Double` /
  `pauseCountLearner :: Int` / `pauseCountReference :: Int`) を
  `Types.hs` に追加し `ToJSON` / `FromJSON` 両方を実装する。
  worker の `Api.hs` に `/v1/pronunciation-assessments/shadowing` ルートが追加され
  `Application.hs` の handler と接続されていること (agent-policy 配線点)。
  analyzer が lag を返さない場合も worker・frontend が割れないこと (後方互換)。

- [ ] **M-SHL-4 (frontend: シャドーイング画面 + ラグ表示)**
  training 画面のシャドーイングモードが、
  (a) `.player` でお手本再生 (Kokoro TTS を `GET /v1/tts` で取得) と
      `.rec-btn` で同時録音ができること。
  (b) 録音送信後に `.lag` にラグ計測値 (`.lag-needle` の位置が実計測値) と
      `.callout` にスロー再生推奨テキストが表示されること。
  (c) `.speed` コントロールで 0.7x 開始 (ラグ過大時はデフォルトを 0.7x に設定) が動作すること。
  (d) `.scope-note` に週次実施回数 (実 DB 由来) が表示されること。
  表示値はすべて real API レスポンス由来であり、静的 HTML の固定値を焼かないこと。

- [ ] **M-SHL-5 (frontend: shadowing セッション永続)**
  シャドーイングセッション完了時に `training_sessions` に
  `kind='shadowing'`・`session_accuracy IS NULL`・`duration_minutes` の行が書き込まれること。
  `spacing_schedules` の更新は HVPT/産出ドリルのみで行い、
  シャドーイングは `session_accuracy` を用いたゲート遷移の対象外とする
  (ADR-011; ラグ計測値はゲートに使わない)。

- [ ] **M-SHL-6 (スロー再生閾値判定)**
  `lagMilliseconds` が閾値 (OQ-2 で確定する値; 未確定の間は設定値として外出しし
  domain literal 埋め込みしない) を超えた場合に、
  frontend が `.callout` にスロー再生推奨を表示し `.speed` のデフォルトを 0.7x にすること。
  閾値以下の場合は通常速度 (1.0x) を維持し `.callout` を表示しないこと。

- [ ] **M-SHL-7 (agent-policy 厳守: 本番に偽値なし + 実 entrypoint 実行 assert)**
  本番コードに mock/stub/fake/dummy/spy / test-bypass / placeholder stub を入れないこと
  (`scripts/verify-*.sh` 緑)。
  `lagMilliseconds` に偽値・固定値を入れないこと (agent-policy)。
  real public entrypoint (App Router training 画面 → worker `/v1/pronunciation-assessments/shadowing`
  → analyzer `/v1/shadowing-lag`) から到達可能かつ観測可能挙動 (実音声でラグ値が返る、
  `training_sessions` に `kind='shadowing'` 行が永続する) を実行 assert できること。
  `.agent-evidence/` の commands.txt / wiring-map.json / completion-report.md を提出すること。

## Should (望ましいが必須でない)

- **S-SHL-1 (週次推奨ガイド表示)**: `.scope-note` に「週 3–4 回 × 10–15 分の推奨」テキストを
  週次実施回数と合わせて表示する (REQ-125 受入基準の推奨ガイド部分)。
  必須ではないが UX として望ましい。
- **S-SHL-2 (ピッチ輪郭重ね描き)**: シャドーイング後に学習者とお手本の F0 輪郭を
  同一グラフに重ね描きする (REQ-126 / docs/specs/training-screen.md S-TR-3)。
  analyzer の `referenceF0Contour` (実装済) を再利用できるが、
  本スライスでは CEFR 韻律スコアまでで足り、ピッチグラフは別スライス候補とする。
- **S-SHL-3 (ASR フィードバック併用)**: 学習者録音を `POST /v1/analyze` にも送り、
  韻律指標 (speech rate / pause / nPVI) を `.lag` 周辺に補足表示する。
  ラグ計測とは独立した追加情報であり、別スライス候補とする。

## 受入条件 (acceptance — Must の確認方法)

- **M-SHL-1** →
  `docker compose up -d --build` 後、
  `curl -X POST http://localhost:8788/v1/shadowing-lag -F reference_audio=@ref.wav -F learner_audio=@learner.wav`
  が HTTP 200 + `{ "lagMilliseconds": <int>, "speechRateRatio": <float>, "pauseCountLearner": <int>, "pauseCountReference": <int> }`
  を返すこと (フィールドが全て存在する)。
  `grep -r "shadowing.lag" applications/python-analyzer/src/python_analyzer/interface/http_handler.py`
  でルート定義が存在し、`app.py` の `include_router` で登録されていることを確認。

- **M-SHL-2** →
  2 種類の学習者録音 (遅い発話 / 速い発話) で `POST /v1/shadowing-lag` を叩き、
  `lagMilliseconds` の値が互いに異なること (contract test で assert)。
  python-analyzer の `test/` に `compute_shadowing_lag(ref_wav, learner_wav)` が
  非ゼロの lag を返す統合テストが green。
  `scripts/verify-no-prod-doubles.sh` 緑 (偽値なし)。

- **M-SHL-3** →
  `cabal test all` が green。
  `grep -r "shadowing" applications/backend/src/` で `Api.hs` と `Application.hs` に
  `/v1/pronunciation-assessments/shadowing` が存在すること。
  `ShadowingLagDto` の `ToJSON` / `FromJSON` round-trip テストが green。
  analyzer が `/v1/shadowing-lag` を返さない場合も worker が 500 を返さず
  null/エラー構造で応答すること (後方互換テスト green)。

- **M-SHL-4** →
  Playwright: training 画面のシャドーイングモードで
  (a) `.player` と `.rec-btn` が描画され、
  (b) 録音送信後に `.lag` に数値 (非固定の lag ms 値) と `.callout` が描画され、
  (c) `.speed` コントロールが存在し、
  (d) `.scope-note` に週次回数 (数値) が描画されること。
  表示値が API レスポンスと一致すること (別録音で lag 値が変わることを E2E で assert)。

- **M-SHL-5** →
  `docker compose up` 後、シャドーイングセッションを 1 件完了させた後に
  `SELECT kind, session_accuracy FROM training_sessions WHERE kind = 'shadowing'`
  を実行し、行が 1 件存在し `session_accuracy IS NULL` であることを assert。
  `spacing_schedules` の `state` が shadowing 完了によって変化しないことを確認。

- **M-SHL-6** →
  閾値を超える lag 値 (OQ-2 確定値) を模した real 録音ペアで
  `POST /v1/shadowing-lag` を叩き、frontend が `.callout` を表示し
  `.speed` のデフォルトが 0.7x になることを Playwright で assert。
  lag が閾値以下の録音ペアで `.callout` が表示されないことを同様に assert。
  閾値が domain literal でなく設定値から読まれることを `grep` で確認 (ドメインコードに数値 literal なし)。

- **M-SHL-7** →
  `scripts/verify-no-prod-doubles.sh` / `verify-test-bypass.sh` /
  `verify-no-stub-placeholder.sh` / `verify-wiring.sh` / `verify-allowlist-expiry.sh`
  が対象差分で緑。
  `.agent-evidence/wiring-map.json` に
  `training 画面 → App Router → worker /v1/pronunciation-assessments/shadowing
  → analyzer /v1/shadowing-lag → ShadowingLagResponse` の経路が記述されていること。
  `.agent-evidence/commands.txt` に real endpoint を叩いたコマンドと出力が記録されていること。

## Non-goals (今回やらない)

- **スロー再生音声の生成**: 0.7x 再生は Kokoro TTS の `speed` パラメータまたは
  ブラウザ `AudioContext.playbackRate` で実現し、スロー版を別音声として合成しない。
- **6 週スケジュール運用・週次通知**: 週次実施回数の記録 (M-SHL-5) はするが、
  6 週プログラムの自動スケジュールや push 通知は対象外。
- **ASR フィードバック併用増強**: 研究 §3.3-3 が指摘する ASR フィードバック併用は
  別スライス候補 (S-SHL-3)。本スライスはラグ計測・表示にとどめる。
- **spacing_schedules ゲート遷移**: シャドーイングは HVPT / 産出ドリルと異なり
  `session_accuracy` を用いたゲート遷移の対象外 (ADR-011; §3.3-3 でゲート条件が未規定)。
- **分節の細評価**: シャドーイングの評価フォーカスはリズム / ポーズ / 話速のみ。
  音素 GOP / NBest / phenomenon の細評価 (sub-2 産出ドリルの責務) はしない。
- **ピッチ可視化 (F0 重ね描き)**: REQ-126 / S-TR-3 の責務。別スライスに切る (S-SHL-2)。
- **Golden speaker (自分の声 VC)**: ADR-012 / workspace golden 別スライス。
  シャドーイングお手本は Kokoro TTS (General American) に限定する。
- **自動 ASR 文字起こし採点**: シャドーイング録音の ASR テキスト精度採点は対象外。
- **複数ユーザー対応**: 固定 sentinel LearnerIdentifier (training-screen OQ-5 解決済み) を流用。

## Risk

- level: **high-risk**
- escalate_to_opus: **true**
- 理由 (触れる境界領域):
  - **新規 analyzer エンドポイント (routing + public export)**: `POST /v1/shadowing-lag` が
    `interface/http_handler.py` の router と `app.py` の `include_router` に同時追加される
    (python-analyzer 配線点; 片方だけでは 404)。
    `ShadowingLagResponse` スキーマが新規 public export になる。
  - **新規計測アルゴリズム**: ラグ計測 (cross-correlation / DTW / energy envelope 遅延推定)
    は現状 analyzer に存在しない。アルゴリズム選択 (OQ-1) と実装精度が
    学習効果 (スロー推奨の妥当性) に直結する。
  - **worker 新ルート (routing)**: `Api.hs` の `WorkerApi` 型と `Application.hs` handler の
    両方に `/v1/pronunciation-assessments/shadowing` を追加 (Haskell 配線点)。
    `-Werror=missing-fields` でレコード追加漏れが CI で検出されるが、cabal test 実行が重い
    (memory: haskell-per-edit-hook-burns-subagent-budget)。
  - **Docker rebuild 焼き込み**: analyzer / worker はビルド時焼き込みで bind-mount 無し。
    コード変更後は `docker compose up -d --build` が必須
    (memory: docker-rebuild-required-for-code-changes)。
    新 Python 依存を追加する場合は Dockerfile の pip list も更新が必要
    (memory: python-analyzer-dockerfile-hardcoded-pip)。
  - **3 言語貫通契約**: analyzer `ShadowingLagResponse` / worker `ShadowingLagDto` /
    frontend ACL schema の 3 層が同一 PR で整合している必要がある。
    1 層でも欠けると wire が割れる。
  - **schema 拡張 (config)**: スロー再生閾値が設定値 (domain literal 埋め込み禁止)。
    閾値の出所 (環境変数 / config ファイル / DB) を確定しないと
    テスト用 assert 値が定まらない (OQ-2)。

## Open questions

> **解決済み（2026-06-14, lihs 回答）**
> - **OQ-1 = (b) DTW + 音素境界（高精度）**: wav2vec2 aligner の音素境界を DTW で対応づけ、per-segment lag 列 + 平均 lag を出す。表示・判定対象はフレーム単位の追随ずれ。挿入/脱落でアライメントが崩れるリスクは実装で頑健化（DTW の局所制約・外れ値中央値）。
> - **OQ-2 = 500ms デフォルト + config 外出し**: `lagMilliseconds > 500` でスロー再生(0.7x)推奨。閾値は設定値（`SHADOWING_LAG_THRESHOLD_MS` 等、OQ-8）で外出しし worker 経由でレスポンスに含める。
> - **OQ-3 = (a) 新規 `POST /v1/shadowing-lag`**: reference_audio + learner_audio を受け `{ lagMilliseconds, recommendSlowPlayback, ... }` を返す。既存 analyze 後方互換維持。
> - **OQ-4 = ADR-013 を実装前に起票**: `/adr-author` で algorithm(DTW)/threshold(500ms config)/endpoint(新規) の決定根拠を `adr/013-shadowing-lag-measurement.md` に残してから実装。
> - OQ-5〜8（非ブロッキング）は実装判断: OQ-7 スロー再生はブラウザ `AudioContext.playbackRate`（推奨）、OQ-8 閾値は設定値→worker 経由でレスポンス同梱。

### 人間確認が要る (ブロッキング) — 着手前に lihs の判断を要する

- **OQ-1 (ラグ計測アルゴリズムの選択) — ブロッキング**
  ラグ計測の実装方式として以下が候補:
  (a) **energy envelope 相互相関 (cross-correlation)**: 両音声の RMS エネルギー包絡線を
      フレーム単位で取り、`argmax(cross_correlation)` でシフト量を求める。
      実装が最もシンプル。parselmouth の intensity 機能または librosa の既存実装を再利用可能。
      ただし発話開始前の無音フレームに引きずられやすい。
  (b) **DTW (Dynamic Time Warping) + 音素境界**: wav2vec2 aligner (既存) の音素境界を使い、
      対応音素ペアの開始時刻差の中央値をラグとする。精度が高いが計算コストが上がる。
      音素が 1 対 1 に対応しない発音 (挿入/脱落) でアライメントが崩れるリスクがある。
  (c) **VAD onset 差分**: energy VAD (既存) でお手本と学習者の発話開始時刻を検出し、
      その差をラグとする。最も軽量だが、ポーズ位置のずれや中間部のドリフトを捉えられない。
  **推奨**: MVP は (c) VAD onset 差分 → 不足なら (a) cross-correlation に昇格。
  (b) DTW は精度要件が高い場合の別スライス候補。
  **lihs に確認**: どの粒度のラグ (発話全体の開始ずれのみ / フレーム単位の追随ずれ) を
  表示・判定対象とするか。これがアルゴリズム選択を決める。

- **OQ-2 (スロー再生推奨の閾値) — ブロッキング**
  研究 (§3.3-3) は「ラグが大きい学習者には効果がない → スロー再生から開始」と記述するが、
  具体的な閾値 (ms) は文献に記載なし。
  候補: 500ms / 750ms / 1000ms (典型的な syllable duration ≒ 200-300ms を参照すると
  2–3 音節分のずれを超えたら「ラグ過大」と見なせる)。
  閾値はドメイン literal 埋め込みせず設定値で外出しする (M-SHL-6 制約)。
  **lihs に確認**: 初期閾値として何 ms を設定するか。
  または「実機で観測してから決める」ならその旨を spec に記録し、
  OQ-2 を実装判断に降格して implementer に委ねてよいか。

- **OQ-3 (新規 endpoint か既存 /v1/analyze 拡張か) — ブロッキング**
  シャドーイングラグ計測を:
  (a) **新規 `POST /v1/shadowing-lag`** として独立させる (本 spec の M-SHL-1 が採用):
      入力が reference_audio + learner_audio の 2 音声であり、
      `POST /v1/analyze` の signature (audio + metadata) と合わない。
      分離することで既存 analyze 経路を壊さない。
  (b) **既存 `POST /v1/analyze` を拡張** して `shadow_reference_audio` フィールドを追加:
      1 エンドポイントで完結するが、multipart の形状変更が既存 analyze contract を拡張する
      (training-screen M-TR-4 の「既存契約再利用」制約との整合が要る)。
  **推奨**: (a) 新規エンドポイント。入力 signature の非対称性が大きく、
  既存 analyze の後方互換を守りやすい。
  **lihs に確認**: (a) 採用で合意するか。

- **OQ-4 (専用 ADR を起こすべきか)**
  ラグ計測アルゴリズム (OQ-1) と閾値 (OQ-2) は設計上の決定事項であり、
  後から変更したときに根拠を追えるよう ADR-013 として `/adr-author` で記録することを推奨する。
  **lihs に確認**: ADR-013 を本スライス着手前に起こすか、実装後に事後記録するか。

### 実装判断で非ブロッキング (topology-mapper / implementer が決める)

- **OQ-5 (ShadowingLagResponse の追加フィールド)**
  `speechRateRatio` (学習者発話速度 / お手本発話速度) と
  `pauseCountLearner` / `pauseCountReference` は M-SHL-1 に含めたが、
  parselmouth / VAD で計算可能かは実装時に確認する。
  計算困難なら `null` を許容する設計にして Must の必須フィールドは `lagMilliseconds` のみとする。

- **OQ-6 (worker の proxying vs. direct call)**
  worker が analyzer の `/v1/shadowing-lag` を HTTP プロキシするか、
  Haskell で直接 JSON を再組み立てするかは topology-mapper が決める。
  ADR-004 の `AnalyzerClient.hs` パターン (HTTP GET/POST + JSON decode) を踏襲する。

- **OQ-7 (スロー再生の実装位置)**
  0.7x 再生を Kokoro TTS の `speed` パラメータ (サーバーサイド合成) で実現するか、
  ブラウザの `AudioContext.playbackRate` (クライアントサイド) で実現するかは実装判断。
  ブラウザ側の方がレイテンシが低く追加 API 呼び出しが不要なため推奨。

- **OQ-8 (閾値の設定値出所)**
  OQ-2 で lihs が初期値を確定した後、その値を
  環境変数 (`SHADOWING_LAG_THRESHOLD_MS`) / config ファイル / DB 設定のどれに置くかは
  実装判断。フロントエンドからも参照できる必要があるため、
  worker 経由でレスポンスに含める方式が一貫的。
