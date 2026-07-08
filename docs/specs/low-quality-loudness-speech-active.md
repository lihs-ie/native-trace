# Spec: low-quality-loudness-speech-active

<!-- 設計の正 / 背景:
       adr/015-low-quality-loudness-over-speech-active-frames.md (Accepted, 2026-06-17)
       adr/014-analysis-pipeline-robustness-low-quality-and-webm.md
         (D1: low_quality → 再録音配線。本 ADR はその先送り Non-goal 「閾値チューニング」を実現)
       adr/004 (worker が scoring と status フィールドを所有)
       adr/005 (python-analyzer onion レイヤ: 変更は infrastructure 内に封じる)
     背景 (ADR-015 Context より):
       正常な発話が誤って low_quality と判定され再録音（ADR-014 D1）に回される。
       frontend は autoGainControl: false で録音するため絶対デジタルレベルが設計上低い。
       wav2vec2 は do_normalize: true でゲイン不変なのでアライメント/GOP は無影響。
       問題は品質ゲートの loudness 測定が全区間 RMS（先頭・末尾の無音や語間ギャップを含む）であること。
       実測: 01KTT0W1 クラス — 全区間 −35.9 dBFS（棄却）/ ピーク −5.3 dBFS / 発話区間 −29.7 dBFS。
       発話区間フレームで測定し閾値を再較正すれば明瞭発話が通過する。
     配線点 (agent-policy):
       python-analyzer infrastructure:
         applications/python-analyzer/src/python_analyzer/infrastructure/wav2vec2_aligner.py
           (measure_audio_quality — 発話区間フレーム RMS に変更)
         applications/python-analyzer/src/python_analyzer/infrastructure/audio_energy.py
           (energy-VAD フレーミング再利用: 320 サンプル/20ms, ENERGY_SILENCE_RMS_THRESHOLD)
       worker scoring:
         applications/backend/src/NativeTrace/Worker/Scoring.hs
           (audioQualityMinMeanDbfs 定数 — −35.0 から再較正値へ変更)
         applications/backend/test/NativeTrace/Worker/ScoringSpec.hs
           (テストの期待値を定数変更に合わせてミラー更新)
       analyzer→worker 契約:
         applications/backend/src/NativeTrace/Worker/AnalyzerClient.hs
           (analyzedMeanDbfs フィールド — 名前/型は維持、意味を全区間から発話区間ラウドネスへ移行)
     強制レイヤ: scripts/verify-no-stub-placeholder.sh / verify-wiring.sh /
       verify-allowlist-expiry.sh + fitness hook (scripts/agent-policy-hook.sh) + CI
       (.github/workflows/pr-gate.yml) -->

## Goal

- `measure_audio_quality`（python-analyzer infrastructure）が全区間 RMS ではなく
  **発話区間フレームの RMS** で `meanDbfs` を計算するよう変更し、語間ポーズや末尾無音による
  ラウドネス希釈で明瞭発話が誤棄却される問題を解消する。
- `audioQualityMinMeanDbfs`（Scoring.hs の定数、現在 −35.0 dBFS）を発話区間 RMS 基準で
  再較正し、`01KTT0W1` クラスの明瞭発話（全区間 −35.9 dBFS、発話区間 −29.7 dBFS）を通しつつ、
  真の無音・準無音クリップは引き続き既存ゲートで棄却する。
- 変更は ADR-005 に従い python-analyzer の infrastructure 層と Scoring.hs 定数のみに封じ、
  契約（wire 名 `meanDbfs` / Haskell フィールド `analyzedMeanDbfs`）の型・名前は変えない。

## Must (満たさなければ done でない)

- [ ] **M-LSA-1 (発話区間フレーム RMS への切り替え)**
  `wav2vec2_aligner.py` の `measure_audio_quality` が、全波形 RMS の代わりに
  `audio_energy.py` の energy-VAD フレーミング（320 サンプル / 20ms フレーム、
  `ENERGY_SILENCE_RMS_THRESHOLD`）を再利用して発話区間フレームのみを抽出し、
  `mean_dbfs = 20 * log10(RMS over speech-active frames)` を計算すること。
  発話区間フレームが 0 件のとき（no-speech）は番兵となる低値（例: `−120.0`）を返し、
  空ケースを引き続き棄却できるようにすること。

- [ ] **M-LSA-2 (audioQualityMinMeanDbfs の再較正と定数更新)**
  `Scoring.hs` の `audioQualityMinMeanDbfs`（現在 `−35.0`）を、解析器自身の発話区間計算を
  実録音コーパス `applications/frontend/data/audio/` に適用した計測結果に基づき再設定すること
  （ffmpeg volumedetect プロキシでなく、M-LSA-1 の実装を使った analyzer 自身の数値で導出する）。
  暫定帯 −33〜−38 dBFS の範囲内で確定値を決定し、確定値をこの spec の **注記欄**
  および ADR-015 Notes に記録すること。
  `ScoringSpec.hs` のテスト期待値を同じ確定値にミラー更新すること。

- [ ] **M-LSA-3 (契約フィールドの意味注記)**
  `AnalyzerClient.hs` の `analyzedMeanDbfs` フィールドのコメントに、意味が
  「全区間 RMS」から「発話区間ラウドネス（発話区間フレームの RMS）」へ移行したことを
  明記すること（wire 名 `meanDbfs`、型は変えない）。

- [ ] **M-LSA-4 (agent-policy 厳守: 偽値なし + 実 entrypoint 実行 assert)**
  本番コードに mock/stub/fake/dummy/spy / test-bypass / placeholder stub を入れないこと
  （`scripts/verify-no-stub-placeholder.sh` / `verify-wiring.sh` / `verify-allowlist-expiry.sh` 緑）。
  real public entrypoint（worker `POST /v1/pronunciation-assessments`、port 8787）から到達可能かつ
  A1・A2・A3 の観測可能挙動を実録音で実行 assert できること。
  `.agent-evidence/low-quality-loudness-speech-active/` に
  commands.txt / wiring-map.json / completion-report.md を提出すること。

---

**注記: M-LSA-2 確定値**

> `audioQualityMinMeanDbfs` 再較正値: **−36.0 dBFS**
> 計測日 / 対象コーパス: 2026-06-17、`applications/frontend/data/audio/`（30 件処理、3 件デコードエラー）
> 根拠:
> - analyzer 自身の `compute_speech_active_rms` を実録音コーパスに適用（ffmpeg → float32 → audio_energy.py）
> - 01KTT0W1A46FCACAMANCWVX65Q.webm: speech_active = **−24.7 dBFS** > −36.0 → 通過 ✓ (A1)
> - 01KTV6FJXPP5DRB1HK97Y1VNVC.webm: speech_active = **−39.5 dBFS** < −36.0 → 棄却 ✓ (A2)
> - 全 30 件の正常発話クリップは speech_active ≥ −32.9 dBFS（3.1 dB の余裕）
> - ADR-015 暫定帯 [−33, −38] の中央付近に設定
> 詳細計測結果: `.agent-evidence/calibration-speech-active-rms.txt`

## Should (望ましいが必須でない)

- `measure_audio_quality` に no-speech 番兵値（例: `NO_SPEECH_DBFS = −120.0`）を
  名前付き定数として定義し、数値マジックを避ける
- `audio_energy.py` の energy-VAD フレーミング関数をモジュール公開関数として整備し、
  `wav2vec2_aligner.py` が内部実装ではなく公開 API として再利用できるようにする
- コーパス計測スクリプトを `scripts/` 以下に残し、将来の再較正を再現可能にする
- `ScoringSpec.hs` に「発話区間 RMS 基準の閾値で `01KTT0W1` クラス相当の dBFS 値が通過する」
  境界テストケースを追加する（定数の意図を human-readable に記述）

## 受入条件 (acceptance — Must の確認方法)

> 観測は real entrypoint 経由の実録音で行う（analyzer `POST /v1/analyze`、port 8788 で `meanDbfs` を、
> worker `POST /v1/pronunciation-assessments`、port 8787 で `status` を観測）。
> analyzer + worker docker rebuild 後（`docker compose up -d --build analyzer worker`）に実施すること。
> 合否は yes/no で機械判定する。

- **M-LSA-1** →
  `grep -nE "ENERGY_SILENCE_RMS_THRESHOLD|speech.active|speech_active" \
    applications/python-analyzer/src/python_analyzer/infrastructure/wav2vec2_aligner.py`
  で energy-VAD フレーミング利用コードが存在すること。
  `grep -n "log10" \
    applications/python-analyzer/src/python_analyzer/infrastructure/wav2vec2_aligner.py`
  で `20 * log10` 計算が全波形 RMS ではなく発話区間フレームに対して適用されていることを確認
  （変数名・コメントで判別）。
  python-analyzer の pytest が全通過すること
  （`docker compose run --rm analyzer pytest` または equivalent で 0 failure）。

- **M-LSA-2** →
  `grep -n "audioQualityMinMeanDbfs" \
    applications/backend/src/NativeTrace/Worker/Scoring.hs`
  で値が `−35.0` から変わっていること（暫定帯 `−33.0` 〜 `−38.0` の範囲内）。
  `grep -n "audioQualityMinMeanDbfs\|MinMeanDbfs" \
    applications/backend/test/NativeTrace/Worker/ScoringSpec.hs`
  で期待値が Scoring.hs と同じ確定値にミラーされていること。
  `cabal test all`（`applications/backend/` で実行）が全通過すること。

- **M-LSA-3** →
  `grep -n "analyzedMeanDbfs\|meanDbfs" \
    applications/backend/src/NativeTrace/Worker/AnalyzerClient.hs`
  で「発話区間」または "speech-active" を含むコメントが存在すること。

- **M-LSA-4** →
  `scripts/verify-no-stub-placeholder.sh` / `verify-wiring.sh` / `verify-allowlist-expiry.sh`
  が対象差分で緑（staged / commit 後に確認 — memory: verify-scripts-skip-untracked）。
  A1・A2・A3 の観測可能挙動（下記）がいずれも pass。
  `.agent-evidence/low-quality-loudness-speech-active/commands.txt` に
  real `POST /v1/analyze`（analyzer, `meanDbfs`）と `POST /v1/pronunciation-assessments`（worker, `status`）
  を叩いたコマンドと実測値・HTTP status を記録。

---

### ランタイム観測 assert（A1 / A2 / A3）

- **A1 (誤棄却の解消)** →
  `01KTT0W1` クラスの実録音（全区間 RMS 〜−35.9 dBFS、発話区間 〜−30 dBFS 相当）を
  worker `POST /v1/pronunciation-assessments`（port 8787）に送信し、レスポンスの `status` が
  `"low_quality"` でないこと（`"normal"`）を確認する。
  修正前の同録音は `status: "low_quality"` で棄却されていたことを回帰軸として記録する。
  注意: ラウドネスゲートを判定軸とするため、reference text は録音の実発話内容に一致させること。
  録音保存時の section reference（長文段落）をそのまま使うと、未変更の phoneme-detection-rate
  ゲート（Non-goal）で `low_quality` になり判定が交絡する（実測: detected 13 vs expected 322）。
  `meanDbfs`（analyzer 計測値）は reference 非依存なので A3 で別途確認する。

- **A2 (無音クリップの棄却維持)** →
  実質無音または no-speech のクリップ（全区間・発話区間ともに極めて低い録音）を
  worker `POST /v1/pronunciation-assessments` に送信し、レスポンスの `status` が
  `"low_quality"` であること（`"normal"` になっていないこと）を確認する。

- **A3 (meanDbfs が発話区間ラウドネスを反映)** →
  明瞭な発話クリップを analyzer `POST /v1/analyze`（port 8788）に送信し、レスポンス
  の生 JSON の `meanDbfs` が全区間 RMS より有意に高い値
  （例: `−35.9 dBFS` に対して `−30 dBFS` 前後）であることを観測する。
  具体的には `meanDbfs > (全区間 RMS + 3 dB)` を満たすことを commands.txt に記録する。

## Non-goals (今回やらない)

- **energy-VAD 閾値の相対化**: `ENERGY_SILENCE_RMS_THRESHOLD`（絶対 0.01 RMS、約 −40 dBFS）の
  フレームフロアをピーク相対化しない。極端に静かだが明瞭な録音（発話区間 〜−40 dBFS）の
  フレーム取り損ねはフォローアップ候補（ADR-015 Notes）。
- **autoGainControl の変更**: 録音設定は `autoGainControl: false` のまま（設計上 false）。
- **解析前の loudness 正規化**: 目標 dBFS への pre-analysis 正規化は棄却済み（ADR-015 Alternatives）。
- **絶対 dBFS ゲートの完全撤廃**: 撤廃せず維持する（ADR-015 Alternatives）。
- **duration / phoneme-detection-rate / median GOP の変更**: 既存のゲイン不変ゲート（最小録音長
  1000ms、最小音素検出率 0.25、median GOP 上限 −18.0）は変更しない（ADR-015 D3）。
- **analyzer use-case シグネチャの変更**: 変更は infrastructure 層（wav2vec2_aligner.py /
  audio_energy.py）と Scoring.hs 定数のみ。use-case インタフェースは不変（ADR-005）。
- **wire 名 / 型の変更**: `meanDbfs`（JSON wire）/ `analyzedMeanDbfs`（Haskell フィールド）は
  名前・型を維持。意味の変化のみを契約コメントに注記する（ADR-015 D1 Consequences）。
- **frontend UI の変更**: ADR-014 D1 の再録音配線は不変。発火する録音の数が変わるだけ。

## Risk

- level: **high-risk**
- escalate_to_opus: **true**
- 理由（触れる境界領域）:
  - **ユーザー向け品質ゲートの変更（偽受理ハザード）**: `audioQualityMinMeanDbfs` の変更は
    閾値を下げる方向（緩和）であり、真の無音/準無音クリップが誤って通過するリスクがある。
    既存の duration / phoneme-detection / GOP ゲートが補完するが、loudness ゲートが唯一の
    ガードではないことを実録音 A2 で確認する必要がある（誤受理 = false-accept が主要ハザード）。
  - **python↔Haskell 契約境界の意味シフト**: `meanDbfs` の semantics が全区間から発話区間ラウドネスへ
    移行する。wire 名・型は維持するが、閾値定数と測定値の対応関係が変わる（Scoring.hs の
    `audioQualityMinMeanDbfs` は旧 semantics の −35.0 から新 semantics の値へ）。
  - **閾値の経験的決定**: 再較正値は実コーパス計測で決まる。コーパスが小さい（27 件）ため、
    分布の外れ値に引きずられるリスクがある。暫定帯（−33〜−38 dBFS）は ADR-015 で合意済みだが、
    確定値は実装時の計測に委ねる（spec 注記欄に記録必須）。
  - **docker rebuild 必須（config / background job）**: python-analyzer は build 焼き込み
    （memory: docker-rebuild-required-for-code-changes）。コード変更後に rebuild しないと
    実機が旧実装のまま動き、runtime-verify が偽 green になる。

## Open questions

なし。ADR-015 で全決定事項が確定している。未確定の再較正確定値は実装フェーズで計測後、
spec 注記欄および ADR-015 Notes に記録する（実装前に人間判断は不要）。
