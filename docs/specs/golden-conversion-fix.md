# Spec: golden-conversion-fix

<!-- 親 spec / 設計の正:
       docs/specs/golden-rvc.md (M-GRV-1..12 — golden speaker スライス全体)
       adr/012-golden-speaker-voice-conversion-rvc.md (Accepted, RVC / CPU 推論 / license 境界)
     位置づけ:
       本 fix は golden-rvc.md M-GRV-2「実変換 — CPU 推論パス」を *実際に真にする* 後続修正。
       配線 (M-GRV-1/4/6/7) は既に landed 済み。本スライスは「配線は正しいが実質 passthrough」だった
       変換実体を「入力と有意に異なる女性 VCTK 声へのピッチ・音色変換」に引き上げる。
     確定済み背景 (2026-06-14 セッション / grill 済み相当):
       - 既存 golden は配線正常だが実質 passthrough。実測ベースライン (passthrough 不合格例):
         入力 F0 中央値 128Hz → 出力 131Hz (ほぼ不変) / 正規化相互相関 0.93 (ほぼ同一波形)。
         target は p231 (女性 VCTK, F0 期待 約200Hz) なのに上昇しない。
       - 原因3つ (確定): (1) f0up_key 未設定でピッチが動かない (2) retrieval index 未使用で音色が乗らない
         (3) quality_gate が入出力 RMS 比ベースで「変換が弱いほど通過」する逆インセンティブ。
       - implementer 修正済 (adopt 対象 / Step 3 出力, 証跡: .agent-evidence/golden-fix/):
         pyproject を rvc-python==0.1.5 / requires-python>=3.10 / numpy<=1.23.5 にして
         native-trace-golden:fix のビルドを通した (Python 3.10-slim + fairseq 0.12.2 / praat-parselmouth)。
         f0_up_key 引数 + env GOLDEN_F0_UP_KEY=12 を compose→app.py→RvcEngine に配線。
         HF Nekochu/RVC-VCTK_Voice-sample の実在 rmvpe index (F/{voice}/rmvpe/...index) を DL 配線。
         quality_gate を出力妥当性 (非無音/有限/非クリップ) 評価に置換。pytest 25 passed。
     配線点 (agent-policy / 既存実装で確認済):
       golden 実体: applications/golden-speaker/src/golden_speaker/infrastructure/rvc_engine.py
         + .../infrastructure/quality_gate.py + .../app.py (create_app DI)
         + interface/http_handler.py の router → app.py include_router (POST /v1/convert)
       worker proxy: applications/backend/src/NativeTrace/Worker/Api.hs ("golden-speaker" :> "convert")
         + Application.hs handler + GoldenSpeakerClient.hs + Types.hs (GoldenSpeakerConversionDto)
       frontend: applications/frontend/src/app/api/v1/golden-speaker/convert/route.ts
       compose: compose.yaml golden サービス (profiles: [golden], port 8789) + worker GOLDEN_SPEAKER_URL
     強制レイヤ: scripts/verify-no-stub-placeholder.sh / verify-wiring.sh / verify-allowlist-expiry.sh
       + fitness hook (scripts/agent-policy-hook.sh) + CI (.github/workflows/pr-gate.yml) -->

## Goal

- 既に配線済みの golden speaker 変換 (golden-rvc.md M-GRV-2) を、実質 passthrough から
  「入力学習者音声を女性 VCTK ネイティブ声 (p231, F0 期待 約200Hz) へ実際にピッチ・音色変換する」
  状態へ引き上げる。出力が入力の passthrough でないことを定量 assert できることを完了条件とする。
- quality_gate の逆インセンティブ (変換が弱いほど通過) を除去し、強変換出力が pass すること。
- native-trace-golden:fix が :latest 遺産イメージに依存せず再現ビルドできること。

## Must (満たさなければ done でない)

- [ ] **M-GCF-1 (実変換: passthrough 否定 — ピッチ上昇)**
  real public entrypoint (最低でも golden `POST /v1/convert`、可能なら worker
  `POST /golden-speaker/convert` 経由) で男性帯域の実学習者音声を変換したとき、
  出力 WAV の有声部 F0 中央値が入力の F0 中央値に対して **+40% 以上** 上昇すること
  (target が女性 p231 = 約200Hz 方向)。
  実測ベースライン (passthrough 不合格例: 入力 128Hz → 出力 131Hz = +2.3%) を明確に超えること。
  GOLDEN_F0_UP_KEY が compose → app.py → RvcEngine.set_params(f0up_key=...) まで配線され、
  実際にピッチに効くこと (env 値を変えると出力 F0 が変わる)。

- [ ] **M-GCF-2 (実変換: passthrough 否定 — 波形非同一)**
  同一エントリポイントで、入力 WAV と出力 WAV の正規化相互相関 (normalized cross-correlation,
  時間整列後のピーク値) が **0.9 未満** であること。
  実測ベースライン (passthrough 不合格例: xcorr 0.93) を明確に下回ること。
  retrieval index (rmvpe 専用 .index) が `RVCInference(index_path=...)` に渡され
  実際に音色移転に使われること (index あり / なしで出力が変わる、または index DL 成功ログが出ること)。

- [ ] **M-GCF-3 (実変換: 入力依存性)**
  2 種類の異なる学習者音声を投じたとき、出力 `audioBase64` の内容が互いに異なること
  (固定 WAV / サイレンス / 入力コピーを返していないことの assert、M-GRV-2 と同条件)。

- [ ] **M-GCF-4 (quality_gate: 逆インセンティブ不在)**
  quality_gate が「入出力 RMS 比」「入力との類似度」を pass 条件に使わないこと
  (変換が弱い = 入力に似ているほど通過する分岐がコードに存在しない)。
  強変換出力 (M-GCF-1/2 を満たす実変換音声) が `qualityGatePassed: true` で通過すること。
  ゲート判定は出力単体の妥当性 (非無音 / 有限値 / 非過剰クリップ、または OQ-GCF-1 で確定する
  F0 連続性指標) のみに基づき、閾値は `GOLDEN_QUALITY_THRESHOLD` (env / config) から読まれること
  (domain literal に閾値を埋め込まない)。
  ゲートを意図的に bypass する分岐 (`if skip_gate` 等) を本番コードに入れないこと。

- [ ] **M-GCF-5 (再現ビルド: 遺産イメージ非依存)**
  `applications/golden-speaker/` を clean 状態から `docker build` したとき
  native-trace-golden 相当イメージのビルドが完走すること。
  ビルドは :latest 既存イメージのレイヤーや稼働中コンテナに依存しないこと
  (pyproject.toml = rvc-python==0.1.5 / requires-python>=3.10 / numpy<=1.23.5、
  Dockerfile の pip list を含む依存固定が再現ビルドを保証すること
  — memory: python-analyzer-dockerfile-hardcoded-pip)。
  ビルド後のイメージで `POST /v1/convert` が起動・応答すること。

- [ ] **M-GCF-6 (agent-policy 厳守: 偽値なし + 実 entrypoint 実行 assert)**
  本番コードに mock/stub/fake/dummy/spy / test-bypass / placeholder stub を入れないこと
  (`scripts/verify-no-stub-placeholder.sh` / `verify-wiring.sh` / `verify-allowlist-expiry.sh` 緑)。
  変換音声に固定 Base64 / サイレンス / 入力コピーを入れないこと。
  real public entrypoint (golden `POST /v1/convert`、可能なら worker `POST /golden-speaker/convert`)
  から到達可能かつ M-GCF-1/2/3 の観測可能挙動を実音声で実行 assert できること。
  `.agent-evidence/golden-fix/` の commands.txt (real endpoint を叩いたコマンドと F0 / xcorr 数値出力) /
  wiring-map.json / completion-report.md を更新提出すること。

## Should (望ましいが必須でない)

- **S-GCF-1 (spectral 距離の補助 assert)**: F0 / xcorr に加えて spectral centroid シフト
  または MFCC 距離が有意であることを補助指標として記録し、音色変化を裏付ける。
  M-GCF-1/2 の合格線が境界付近の場合の判定補強に使う。
- **S-GCF-2 (GOLDEN_F0_UP_KEY の声域別推奨値)**: 学習者の声域 (男性 / 女性 / 子供) に応じた
  推奨 f0_up_key を doc 化する。現状は env デフォルト 12 半音固定 (証跡 completion-report 残課題3)。
- **S-GCF-3 (ARM64 ビルド時間短縮)**: praat-parselmouth の ARM64 コンパイル約 700 秒を
  BuildKit キャッシュ or linux/amd64 指定で短縮し CI 時間を抑える (証跡 残課題1)。
- **S-GCF-4 (rmvpe index 初回 DL の start_period 延長)**: hf-cache-golden volume 未作成の
  初回起動で index (数百 MB) DL が間に合うよう healthcheck start_period を調整する (証跡 残課題2)。

## 受入条件 (acceptance — Must の確認方法)

> 観測は real entrypoint 経由の実音声変換出力に対して行う。F0 / xcorr は出力 WAV を
> 既存の F0 抽出系 (python-analyzer の parselmouth / rmvpe、または librosa.yin /
> scipy.signal.correlate) で計測する。合格は yes/no で機械判定する。

- **M-GCF-1** →
  既知の男性帯域学習者音声 (F0 中央値 約128Hz) を golden `POST /v1/convert`
  (`-F learner_audio=@learner.wav -F reference_audio=@reference.wav`) に投じ、
  出力 WAV の有声部 F0 中央値 `f0_out` を計測する。
  `f0_out >= f0_in * 1.40` (例: 128Hz → 179Hz 以上) なら pass、`f0_out < f0_in * 1.40` なら fail。
  passthrough ベースライン (131Hz = 128*1.023) は **fail** であることを明示。
  さらに `GOLDEN_F0_UP_KEY=0` で再変換したとき F0 上昇が消える / 縮むことで env が効いていることを確認。
  `grep -n "f0up_key" applications/golden-speaker/src/golden_speaker/infrastructure/rvc_engine.py`
  で `set_params(..., f0up_key=self._f0_up_key)` 配線を確認。

- **M-GCF-2** →
  同じ変換の入力 WAV と出力 WAV を同一 sample rate に揃え、時間整列後の
  正規化相互相関ピーク `xcorr` を計算する。`xcorr < 0.9` なら pass、`xcorr >= 0.9` なら fail。
  passthrough ベースライン (xcorr 0.93) は **fail** であることを明示。
  golden ログまたは contract test で `index_path` が非空文字で `RVCInference` に渡されていること
  (`_get_index_path` が rmvpe .index を DL 成功) を確認。

- **M-GCF-3** →
  2 種類の異なる `learner_audio` で `POST /v1/convert` を叩き、`audioBase64` が互いに異なること
  (golden-speaker `test/` の contract / 統合テストで assert)。
  入力 WAV の Base64 と出力 `audioBase64` が一致しないこと (passthrough = 入力コピー否定)。

- **M-GCF-4** →
  M-GCF-1/2 を満たした強変換出力を quality_gate に通し `qualityGatePassed: true` が返ること。
  `grep -n "rms" applications/golden-speaker/src/golden_speaker/infrastructure/quality_gate.py`
  で「入出力 RMS *比*」「input との相関 / 距離」を pass 条件に使う分岐が存在しないことを確認
  (出力単体 RMS の無音閾値判定は可)。
  閾値が `os.environ.get("GOLDEN_QUALITY_THRESHOLD", ...)` から読まれること、
  数値 literal が pass/fail 境界に直書きされていないことを `grep` で確認。
  `scripts/verify-no-stub-placeholder.sh` で `if skip_gate` / `bypass` 不在を確認。

- **M-GCF-5** →
  稼働中コンテナを停止し既存 native-trace-golden イメージを削除した clean 環境で
  `docker build -t native-trace-golden:verify applications/golden-speaker` が SUCCESS で完走すること。
  `grep -n "rvc-python\|requires-python\|numpy" applications/golden-speaker/pyproject.toml` で
  `rvc-python==0.1.5` / `requires-python = ">=3.10"` / `numpy<=1.23.5` の固定を確認。
  ビルドしたイメージを `docker compose --profile golden up golden` で起動し
  `curl -fsS http://localhost:8789/health` が 200、`POST /v1/convert` が応答することを確認。

- **M-GCF-6** →
  `scripts/verify-no-stub-placeholder.sh` / `verify-wiring.sh` / `verify-allowlist-expiry.sh`
  が対象差分で緑 (memory: verify-scripts-skip-untracked — untracked は走査されないため
  commit 後 or staged 状態で確認)。
  `.agent-evidence/golden-fix/commands.txt` に real `POST /v1/convert` を叩いたコマンドと
  計測した `f0_in` / `f0_out` / `xcorr` の実数値、passthrough ベースラインとの対比が記録されていること。
  `.agent-evidence/golden-fix/wiring-map.json` に
  `(real entrypoint) → RvcEngine.convert(f0up_key,index) → F0ContinuityQualityGate.check` 経路が記述されていること。
  `pnpm fitness` (ast-grep: RVC import が golden-speaker 外に漏れていない) が緑。

## Non-goals (今回やらない)

- **知覚品質の MOS 評価**: DNSMOS 等での聴感品質スコア化はしない。本 fix は passthrough 否定の
  客観指標 (F0 / xcorr) のみで合否を判定する。
- **話者性の本格 ML 評価**: speaker verification モデルによる「どれだけ p231 らしいか」の
  本格評価はしない (golden-rvc.md / quality_gate.py 既述の通り MVP out of scope)。
- **GPU 必須化**: 推論は CPU パスのまま (REQ-NF-102 / ADR-012)。GPU 学習 (self-voice fine-tune) は
  S-GRV-3 で別スライス。本 fix の golden は学習者自身の声でなく汎用 VCTK 女性声への変換のまま。
- **英語ネイティブ性スコア化**: 変換音声のネイティブ発音度を数値化しない。
- **golden 無効環境での軟無効化の変更**: golden サービスが profiles:[golden] 外でスキップされ
  worker / analyzer / frontend が無退行で動く挙動 (M-GRV-9 / ADR-012) は既存のまま。
  本 fix で退行させない (M-GRV-9 を再検証だけする)。
- **新規 worker ルート / frontend UI の追加**: 配線 (M-GRV-1/4/6/7) は landed 済みで本 fix の対象外。
  変えるのは変換実体 (rvc_engine / quality_gate / pyproject / compose env) のみ。
- **F0_UP_KEY の自動推定**: 学習者声域からの f0_up_key 自動推定はしない (env 固定、S-GCF-2 で doc 化のみ)。

## Risk

- level: **high-risk**
- escalate_to_opus: **true**
- 理由 (触れる境界領域):
  - **ML 変換の正しさ (correctness 境界)**: 「passthrough でない」は数値合格線 (F0 +40% / xcorr<0.9)
    で定義したが、RVC 推論は入力音声 / sample rate / segment 境界に依存して出力形が変わる
    (memory: unit-fixtures-must-mirror-real-worker-shape)。合成 fixture では偽 green になりうるため
    runtime-verify が live worker で実音声を計測 assert する必要がある (high-risk)。
  - **依存スタック (config / build)**: rvc-python==0.1.5 は requires-python>=3.10 / numpy<=1.23.5 /
    fairseq 0.12.2 / praat-parselmouth (GPL-3.0, ADR-012 amendment で service 境界隔離) という
    pin が厳格で、Docker rebuild 焼き込み (memory: docker-rebuild-required-for-code-changes /
    python-analyzer-dockerfile-hardcoded-pip) を伴う。pin 崩れや pip list 未更新で実機が割れる。
  - **GPU 任意サービス (routing / config)**: golden は profiles:[golden] のオプションサービス。
    本 fix が M-GRV-9 (golden 無効時の本体無退行) を退行させると profile 外環境が壊れる。
  - **3 サービス貫通契約の再確認 (public export)**: 変換実体の変更でも
    GoldenConversionResponse / GoldenSpeakerConversionDto / frontend ACL schema の形は不変だが、
    quality_gate の pass セマンティクス変更が `qualityGatePassed` の意味を変えるため
    UI フォールバック (M-GRV-7c/d) の前提を再確認する。
  - **HF モデル DL (config)**: rmvpe .index / .pth を実行時 HF DL (イメージ非焼込, M-GRV-10)。
    初回 DL がネットワーク / volume 状態に依存し runtime verify の再現性に影響する。

## Open questions

- **OQ-GCF-1 (quality_gate の指標が golden-rvc.md / compose.yaml と不整合)**
  golden-rvc.md OQ-1 の解決は「(c+d) F0 連続性 + 設定値外出し」で確定し、compose.yaml の
  `GOLDEN_QUALITY_THRESHOLD: "0.5"` コメントも「F0 連続性品質ゲート閾値 (0.0–1.0, unvoiced 許容割合)」
  と記述している。しかし adopt 対象の実装 quality_gate.py は逆インセンティブ排除のため
  **「出力妥当性 (非無音 / 有限 / 非クリップ)」に置換**され、閾値 `GOLDEN_QUALITY_THRESHOLD`
  のセマンティクスも「F0 unvoiced 許容割合」ではなく「出力 RMS の無音判定閾値 (デフォルト 0.001)」
  に変わっている (クラス名 `F0ContinuityQualityGate` は据え置きで実体と不一致)。
  逆インセンティブ除去という本 fix の目的は満たすが、確定済み設計 (F0 連続性) とは別物。
  **lihs に確認**: (a) 出力妥当性ゲートで確定し golden-rvc.md OQ-1 / compose コメント /
  クラス名 `F0ContinuityQualityGate` を出力妥当性に揃え直すか、
  (b) F0 連続性ゲートに戻す (compose の 0.5 = unvoiced 許容割合に合わせる) か。
  M-GCF-4 の受入条件はどちらでも「逆インセンティブ不在 + 閾値 env 外出し」は満たすが、
  指標名・閾値セマンティクスの正本がどちらかを決めないと文書間の不整合が残る。

- **OQ-GCF-2 (M-GCF-1 の合格線 +40% の妥当性)**
  入力 128Hz → 女性 p231 期待 約200Hz は理論上 +56%。GOLDEN_F0_UP_KEY=12 半音は理論上 +100%
  (1 オクターブ) だが、RVC の rmvpe pitch + index 音色移転後の実出力 F0 中央値が
  どこに着地するかは実測依存。合格線 +40% は passthrough (+2.3%) を確実に弾き、かつ
  女性方向への有意上昇を要求する保守値として置いた。
  **lihs に確認**: runtime-verify の実測で +40% が厳しすぎ / 緩すぎる場合、合格線を実測中央値ベースで
  再調整してよいか (例: 女性帯域下限 165Hz 到達を絶対値で要求する等)。数値は実測 1 周目で確定したい。

- **OQ-GCF-3 (worker 経由 entrypoint を runtime-verify に含めるか)**
  本 fix の最小 real entrypoint は golden `POST /v1/convert`。worker `POST /golden-speaker/convert`
  経由は profiles:[golden] 起動 + worker 配線の両方が要る。
  **lihs に確認**: runtime-verify を golden 単体 `POST /v1/convert` で合格判定してよいか
  (worker 経由は M-GRV-6 で既に landed 済みのため二重検証になる)、
  それとも worker 経由まで実音声を貫通させるか。
