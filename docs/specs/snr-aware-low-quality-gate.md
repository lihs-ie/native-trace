# Spec: snr-aware-low-quality-gate

<!-- 設計の正 / 背景:
       adr/032-snr-aware-low-quality-gate.md (Proposed)
         D1: WADA-SNR による reference-free SNR 推定（pure numpy、audio_energy.py または新 module）
         D2: AnalysisResponse.estimatedSnrDb フィールド追加（schema.py、meanDbfs の隣、常時 populate）
         D3: worker checkAudioQuality に SNR-floor 判定 OR 追加（Scoring.hs 新定数 audioQualityMinSnrDb）
         D4: SNR floor は実測 sweep + human sign-off で pin（ADR-031 D11/D12 Loop-B human-gate）
         D5: _KNOWN_FAILURES から noise_monotonicity を除去し metamorphic guard を本物のガードに復活
       Amends: adr/015-low-quality-loudness-over-speech-active-frames.md (Accepted)
         checkAudioQuality に audioQualityMinSnrDb を sibling 追加
         meanDbfs ラウドネスゲートと既存閾値は byte-unchanged
     問題の根拠 (ADR-032 Context より):
       ADR-031 self-eval の noise-monotonicity metamorphic relation が live で
       「5dB SNR でメジアン GOP が逆に上昇する」不整合を検出（-6.61 → -6.89 at 5dB）。
       root-cause: CTC overconfidence-under-noise — 5dB で phoneme `h` が
       nBest `ð=0.6265`（期待音素とは別の音素を高信頼 decode）→ 期待音素 log-posterior が spurious 上昇。
       meanDbfs は SNR に追従しない（5dB でむしろ上昇）ため ADR-015 loudness ゲートは無効。
     Scoring locus (ADR-004): SNR 推定（measurement）は analyzer、gate 判定は worker。
     Aligner/GOP 式 (ADR-001): 不変（境界 ±1 frame 安定 = aligner は原因ではない）。
     配線点 (agent-policy):
       python-analyzer infrastructure:
         applications/python-analyzer/src/python_analyzer/infrastructure/audio_energy.py
           compute_wada_snr(samples, sample_rate) -> float を追加（または新 module）
       python-analyzer interface:
         applications/python-analyzer/src/python_analyzer/interface/schema.py
           AnalysisResponse に estimatedSnrDb: float を追加（meanDbfs の隣、行 :214 付近）
           /v1/analyze ハンドラ（application 層）が発話区間サンプルに対して populate する
       worker contract:
         applications/backend/src/NativeTrace/Worker/AnalyzerClient.hs
           AnalyzerResult に analyzedEstimatedSnrDb :: Double を追加
         applications/backend/src/NativeTrace/Worker/AnalyzerClient.hs
           FromJSON decode で estimatedSnrDb → analyzedEstimatedSnrDb に対応
       worker scoring:
         applications/backend/src/NativeTrace/Worker/Scoring.hs
           audioQualityMinSnrDb :: Double 定数追加（calibratable）
           checkAudioQuality のシグネチャに estimatedSnrDb 追加、SNR-floor OR 判定を追加
         applications/backend/src/NativeTrace/Worker/Assessment.hs
           :170 の checkAudioQuality 呼び出し側を更新（-Werror caller-update 点）
       self-eval harness:
         applications/python-analyzer/test/selfeval/run_selfeval.py
           _KNOWN_FAILURES から noise_monotonicity を除去（D5、SNR gate 着地確認後）
         applications/python-analyzer/test/fixtures/corpus/manifest.json
           noiseMonotonicity.knownDefect を false に戻し observed を再 pin
     強制レイヤ: scripts/verify-no-stub-placeholder.sh / verify-wiring.sh /
       verify-allowlist-expiry.sh + fitness hook (scripts/agent-policy-hook.sh) + CI
       (.github/workflows/pr-gate.yml)
     rebuild 注意: worker/analyzer はバイナリ焼き込み。コード変更後は
                   `docker compose up -d --build` 必須
                   (memory: docker-rebuild-required-for-code-changes)。
     Haskell -Werror 注意: AnalyzerResult への新フィールド追加は missing-fields で
                   Assessment.hs:170 の構築式を更新しないと build が止まる
                   (memory: Haskell-per-edit-hook-burns-subagent-budget)。 -->

## Goal

- ADR-031 self-eval が検出した「低 SNR で GOP が spurious 上昇する CTC overconfidence-under-noise」を、
  python-analyzer での WADA-SNR 推定と worker `checkAudioQuality` への SNR-floor ゲートで遮断し、
  低 SNR 録音を `low_quality` として抑制することでユーザーに誤った発音採点を見せない。
- SNR gate 着地後、ADR-031 self-eval の `noise_monotonicity` metamorphic relation を
  `_KNOWN_FAILURES` から除去し、**self-improvement loop（Loop-A 検出 → Loop-B 修正 → guard 復活）を完結**させる。
- ADR-015 の既存ゲート（loudness / duration / phoneme-rate）と ADR-004 の scoring locus（SNR measurement は
  analyzer、gate 判定は worker）を維持したまま、SNR 次元を最小拡張で追加する。

## Must (満たさなければ done でない)

- [ ] **M-SNR-1 (WADA-SNR 推定関数)**
  `applications/python-analyzer/src/python_analyzer/infrastructure/audio_energy.py`
  （または同パッケージ内の新 module）に
  `compute_wada_snr(samples: np.ndarray, sample_rate: int) -> float` を追加すること。
  実装は pure numpy のみ使用し、追加 pip 依存なしで動作すること。
  発話区間サンプル（`compute_speech_active_rms` が使う VAD seam と同一の発話区間）に対し、
  Waveform Amplitude Distribution Analysis（Kim & Stern 2008）の振幅分布形状から
  reference-free に単一 SNR（dB）を推定し、1 クリップ 1 float で返すこと。

- [ ] **M-SNR-2 (AnalysisResponse.estimatedSnrDb フィールド追加)**
  `applications/python-analyzer/src/python_analyzer/interface/schema.py` の
  `AnalysisResponse`（:204 付近）に `estimatedSnrDb: float` フィールドを追加すること。
  フィールドは `meanDbfs` の隣に配置し、`/v1/analyze` ハンドラの application 層が
  発話区間サンプルに対して `compute_wada_snr` を呼び出して **常時 populate** すること
  （特定条件下での省略・Optional 化をしないこと）。

- [ ] **M-SNR-3 (worker: AnalyzerResult デコード)**
  `applications/backend/src/NativeTrace/Worker/AnalyzerClient.hs` の `AnalyzerResult` に
  `analyzedEstimatedSnrDb :: Double` フィールドを追加すること。
  `applications/backend/src/NativeTrace/Worker/AnalyzerClient.hs` の `FromJSON` インスタンスが
  `estimatedSnrDb` を `analyzedEstimatedSnrDb` にデコードすること。
  `cabal build all` が `-Werror` を含めて通過すること。

- [ ] **M-SNR-4 (worker: SNR-floor ゲート追加)**
  `applications/backend/src/NativeTrace/Worker/Scoring.hs` に
  `audioQualityMinSnrDb :: Double` 定数を追加すること（`audioQualityMinMeanDbfs = -36.0` の sibling）。
  `checkAudioQuality` のシグネチャに `estimatedSnrDb :: Double` 引数を追加し、
  `estimatedSnrDb < audioQualityMinSnrDb` のとき `low_quality` を返すよう OR 判定を追加すること。
  `applications/backend/src/NativeTrace/Worker/Assessment.hs` :170 の呼び出し側を更新すること。
  **既存ゲート（`audioQualityMinMeanDbfs = -36.0` / `audioQualityMinRecordingDurationMs = 1000` /
  `audioQualityMinPhonemeDetectionRate = 0.25`）の定数値は byte-unchanged であること。**

- [ ] **M-SNR-5 (WADA-SNR 推定の unit test)**
  `applications/python-analyzer/test/` 以下に `compute_wada_snr` の pytest unit test を追加すること。
  清音声ライクな合成信号（正弦波またはホワイトノイズ様の信号）に既知レベルの
  ガウシアンノイズまたはピンクノイズを加算し、既知 SNR（例: 20dB / 10dB / 5dB）に対する
  推定値が `±4 dB` 以内の許容帯に収まることを assert すること。
  テストは pure unit（live analyzer 不要、純粋 numpy）であること。

- [ ] **M-SNR-6 (worker: SNR ゲート + 既存ゲート非退行の unit test)**
  `applications/backend/test/NativeTrace/Worker/ScoringSpec.hs` に以下のテストケースを追加すること:
  - `estimatedSnrDb < audioQualityMinSnrDb` のとき `checkAudioQuality` が `low_quality` を返すこと。
  - 既存の loudness / duration / phoneme-rate の各 failing ケース（既存テスト）が引き続き
    `low_quality` を返すこと（regression 確認）。
  - fixture は実 worker 出力形状（negative GOP 含む）でミラーすること
    （memory: unit-fixtures-must-mirror-real-worker-shape）。

- [ ] **M-SNR-7 (SNR floor を runtime sweep で pin し human sign-off)**
  runtime-verify にて、合成 SNR ladder（clean / 20dB / 10dB / 5dB、`add_pink_noise` 使用）を
  複数 fixture に対して sweep し、confident-misdecode が始まる SNR 点を実測すること。
  その結果から `audioQualityMinSnrDb` の確定値を `5dB < audioQualityMinSnrDb ≤ 10dB` の範囲で
  決定し、lihs の human sign-off を得てから定数値を pin すること。
  確定値と根拠（sweep 結果サマリ）をこの spec の **注記欄** および ADR-032 Notes に記録すること。
  self-eval の信号から自動 tune してはならない（ADR-031 D11/D12 Loop-B human-gate）。

- [ ] **M-SNR-8 (self-improvement loop の完結)**
  M-SNR-4 ゲートが runtime-verify で着地確認された後、以下を実施すること:
  - `applications/python-analyzer/test/selfeval/run_selfeval.py` の `_KNOWN_FAILURES` から
    `noise_monotonicity` エントリを除去すること。
  - `applications/python-analyzer/test/fixtures/corpus/manifest.json` の
    `noiseMonotonicity.knownDefect` を `false` に変更し、`observed` を再 pin すること。
  - `pnpm test:fullcycle gop-delta` を live スタックで実行したとき、
    stdout の `SELFEVAL metamorphic noise_monotonicity` 行が `PASS`（`FAIL[KNOWN]` でないこと）を
    確認すること。

- [ ] **M-SNR-9 (agent-policy 厳守: 偽値なし + 実 entrypoint 実行 assert)**
  本番コードに mock/stub/fake/dummy/spy / test-bypass / placeholder stub を入れないこと
  （`scripts/verify-no-stub-placeholder.sh` / `verify-wiring.sh` / `verify-allowlist-expiry.sh` 緑）。
  real public entrypoint（worker `POST /v1/pronunciation-assessments`、port 8787）から到達可能かつ
  A1・A2・A3 の観測可能挙動を実録音で実行 assert できること。
  `.agent-evidence/snr-aware-gate/` に
  commands.txt / wiring-map.json / completion-report.md を提出すること。

---

**注記: M-SNR-7 確定値**

> `audioQualityMinSnrDb` 確定値: **0.5（WADA estimator-scale floor — 真 dB ではない。PROVISIONAL）**
> sweep（2026-06-20、hello_world.wav、live `/v1/analyze`）: estimatedSnrDb = clean 2.13 / 20dB 2.05 / 10dB 1.27 / 5dB -0.15 / 0dB -2.74。
> WADA 絶対スケールが真 SNR より ~20dB 低く高 SNR 域で圧縮（`K_clean_prior` が合成信号較正、M-SNR-5 は circular test だった）。順序判別は有効（5dB=-0.15 < 10dB=1.27、confident-misdecode 再現）。
> spec の真 dB 前提 `5 < floor ≤ 10` は WADA スケールで不成立 → **estimator 実スケールの 0.5 に rebase**（5dB を gate・10dB/clean を pass、live 実証 floor=1.0 動作）。lihs が M-SNR-7 human-gate で option (A)=rebase を選択（2026-06-20）。複数実録音 clip での sweep 検証を production 昇格前提とする。詳細は ADR-032「D4 補正」。

## Should (望ましいが必須でない)

- `compute_wada_snr` に発話区間サンプルが空のとき（VAD frames = 0）番兵値（例: `-120.0`）を返し、
  空ケースを gate 側でも low_quality 判定できるようにする
- `audioQualityMinSnrDb` 定数に「5dB < floor ≤ 10dB の診断根拠・calibration 由来」をコメントで明記し、
  将来の再較正者が文脈を失わないようにする
- sweep スクリプト（`scripts/snr-sweep.py` 等）を repo に残し、floor 再較正を再現可能にする
- `ScoringSpec.hs` に「SNR floor の境界値（ちょうど `audioQualityMinSnrDb` dB）が low_quality に転じる」
  境界テストケースを追加し、定数の意図を human-readable に記述する

## 受入条件 (acceptance — Must の確認方法)

> worker/analyzer はバイナリ焼き込みのため、runtime verify 前に
> `docker compose up -d --build` 必須（memory: docker-rebuild-required-for-code-changes）。
> 合否は yes/no で機械判定する。

- **M-SNR-1** →
  `grep -n "compute_wada_snr" \
    applications/python-analyzer/src/python_analyzer/infrastructure/audio_energy.py`
  （または追加 module のパス）で関数定義が存在すること。
  `grep -rn "import librosa\|import scipy\|pip install" \
    applications/python-analyzer/src/python_analyzer/infrastructure/audio_energy.py`
  が 0 件であること（pure numpy 確認）。

- **M-SNR-2** →
  `grep -n "estimatedSnrDb" \
    applications/python-analyzer/src/python_analyzer/interface/schema.py`
  で `AnalysisResponse` クラス内にフィールド定義が存在すること。
  `docker compose up -d --build` 後、`POST /v1/analyze` に任意の音声 clip を送信したとき、
  レスポンス JSON に `estimatedSnrDb` キーが存在し値が float であること
  （`curl -s -X POST http://localhost:8788/v1/analyze ... | jq '.estimatedSnrDb | type'`
  が `"number"` を返すこと）。

- **M-SNR-3** →
  `grep -n "analyzedEstimatedSnrDb" \
    applications/backend/src/NativeTrace/Worker/AnalyzerClient.hs`
  でフィールド定義が存在すること。
  `grep -n "estimatedSnrDb\|analyzedEstimatedSnrDb" \
    applications/backend/src/NativeTrace/Worker/AnalyzerClient.hs`
  で FromJSON デコード対応が確認できること。
  `cabal build all`（`applications/backend/` で実行）が exit 0 で終了すること。

- **M-SNR-4** →
  `grep -n "audioQualityMinSnrDb" \
    applications/backend/src/NativeTrace/Worker/Scoring.hs`
  で定数定義と `checkAudioQuality` 内での参照が存在すること。
  `grep -n "audioQualityMinMeanDbfs\s*=" \
    applications/backend/src/NativeTrace/Worker/Scoring.hs`
  の値が `-36.0` から変化していないこと（byte-unchanged）。
  `grep -n "audioQualityMinRecordingDurationMs\|audioQualityMinPhonemeDetectionRate" \
    applications/backend/src/NativeTrace/Worker/Scoring.hs`
  の値が `1000` / `0.25` から変化していないこと（byte-unchanged）。
  `cabal test all`（`applications/backend/` で実行）が全通過すること。

- **M-SNR-5** →
  `grep -rn "compute_wada_snr" applications/python-analyzer/test/` でテストファイルが存在すること。
  `docker compose run --rm analyzer pytest applications/python-analyzer/test/`
  （または equivalent）が exit 0 で終了し、WADA-SNR unit test が PASSED と出力されること。
  テスト内に `assert abs(estimated - known_snr) <= 4.0` 相当の band assert が存在することを
  `grep -n "assert\|±\|<= 4\|<= 4.0" <test file>` で確認すること。

- **M-SNR-6** →
  `grep -n "audioQualityMinSnrDb\|estimatedSnrDb\|low_quality" \
    applications/backend/test/NativeTrace/Worker/ScoringSpec.hs`
  で SNR gate テストケースが存在すること。
  `cabal test all` が全通過すること。
  既存の loudness / duration / phoneme-rate ケースがいずれも `low_quality` を返すこと（regression）を
  上記 `cabal test all` の PASS が担保すること。

- **M-SNR-7** →
  この spec 注記欄（上記「M-SNR-7 確定値」セクション）に `audioQualityMinSnrDb` の確定値と
  根拠サマリが記入されていること。
  `grep -n "audioQualityMinSnrDb\s*=" \
    applications/backend/src/NativeTrace/Worker/Scoring.hs`
  の値が `5.0` より大きく `10.0` 以下であること（範囲: `5dB < floor ≤ 10dB`）。
  `.agent-evidence/snr-aware-gate/commands.txt` に sweep 実行コマンドと
  各 SNR ladder での観測値（median GOP / estimatedSnrDb）が記録されていること。
  human sign-off（lihs）が completion-report.md に記録されていること。

- **M-SNR-8** →
  `grep -n "noise_monotonicity" \
    applications/python-analyzer/test/selfeval/run_selfeval.py`
  が `_KNOWN_FAILURES` への登録として 0 件であること
  （コメント / ドキュメント文字列としての出現は除く）。
  `grep -n "noiseMonotonicity" \
    applications/python-analyzer/test/fixtures/corpus/manifest.json`
  で `"knownDefect": false` であること。
  live スタック（`docker compose up -d --build` 済み）で
  `pnpm test:fullcycle gop-delta` を実行したとき、stdout に
  `SELFEVAL metamorphic noise_monotonicity PASS` を含む行が出力されること
  （`FAIL[KNOWN]` ではないこと）。

- **M-SNR-9** →
  `bash scripts/verify-no-stub-placeholder.sh` 緑。
  `bash scripts/verify-wiring.sh` 緑。
  `bash scripts/verify-allowlist-expiry.sh` 緑。
  A1・A2・A3 の観測可能挙動（下記）がいずれも pass。
  `ls .agent-evidence/snr-aware-gate/commands.txt \
       .agent-evidence/snr-aware-gate/wiring-map.json \
       .agent-evidence/snr-aware-gate/completion-report.md`
  で 3 ファイルが存在すること。

---

### ランタイム観測 assert（A1 / A2 / A3）

- **A1 (低 SNR 録音が low_quality で弾かれること)** →
  SNR が `audioQualityMinSnrDb` を下回るクリップ（`add_pink_noise` で SNR 5dB 相当に劣化させた
  合成 clip、または実録音 + 実測 SNR 確認済みの低 SNR clip）を
  worker `POST /v1/pronunciation-assessments`（port 8787）に送信し、
  レスポンスの `status` が `"low_quality"` であること。
  analyzer `POST /v1/analyze` の同 clip レスポンスに `estimatedSnrDb` が存在し、
  値が `audioQualityMinSnrDb` 未満であることを commands.txt に記録すること。

- **A2 (SNR 十分な明瞭発話が low_quality にならないこと)** →
  SNR が `audioQualityMinSnrDb` 以上の clip（clean speech または SNR 20dB 相当）を
  worker `POST /v1/pronunciation-assessments` に送信し、
  レスポンスの `status` が `"low_quality"` でないこと（他のゲートで弾かれていないことを前提として `"normal"` になること）。
  analyzer の `estimatedSnrDb` が `audioQualityMinSnrDb` 以上であることを commands.txt に記録すること。

- **A3 (既存ゲートが非退行であること)** →
  実質無音クリップ（loudness ゲートが `meanDbfs < -36.0` を満たすクリップ）を
  worker `POST /v1/pronunciation-assessments` に送信し、
  レスポンスの `status` が引き続き `"low_quality"` であること
  （SNR gate 追加前から low_quality だったクリップが引き続き弾かれること）。

## Non-goals (今回やらない)

- **GOP 式自体の雑音補正**: GOP 計算式または CTC posterior への雑音補正を加えない（ADR-001 不変）。
- **非定常雑音の高度推定**: ミニマム統計量法や STFT per-frame 推定など、WADA-SNR より複雑な手法を使わない。
- **confidence-reduction アノテーション経路**: 低 SNR を binary gate 以外の partial-trust 経路で扱わない
  （ADR-015 の binary seam を維持）。
- **SNR floor の自動 tuning**: self-eval の信号から `audioQualityMinSnrDb` を自動調整しない（ADR-031 D11/D12）。
- **aligner の変更**: ADR-001 の aligner/GOP 供給元は不変（境界 ±1 frame 安定が確認済み）。
- **frontend / UI の変更**: ADR-014 D1 の再録音 UI 配線は不変。発火する録音の数が変わるだけ。
- **meanDbfs の semantics 変更**: wire 名 `meanDbfs`、Haskell フィールド `analyzedMeanDbfs` の型・名前・意味は
  ADR-015 で確定した発話区間ラウドネスのまま。SNR は独立フィールド `estimatedSnrDb` で追加する。
- **python-analyzer の use-case シグネチャ変更**: 変更は infrastructure 層と interface/schema.py に封じる（ADR-005）。
- **drizzle schema / migration 変更**: analyzer レスポンスの `estimatedSnrDb` は worker が gate 判定に使用するのみで
  DB には persist しない（scoring locus は worker、DB スキーマ変更なし）。

## Risk

- level: **high-risk**
- escalate_to_opus: **true**
- 理由（触れる境界領域）:
  - **production scoring 変更（Scoring.hs checkAudioQuality + 新定数）**: 本番ゲートに新しい棄却軸を追加する。
    過剰厳格化（正当な録音を false low_quality で弾く）と過少厳格化（低 SNR の confident-misdecode を通す）
    の両方向のハザードがある。SNR floor は empirical sweep + human sign-off（ADR-031 D11/D12）で制御する。
  - **cross-layer 契約変更（python → Haskell）**: `AnalysisResponse.estimatedSnrDb`（python schema）→
    `AnalyzerResult.analyzedEstimatedSnrDb`（Haskell AnalyzerClient.hs）の新フィールドが cross-layer で追加される。
    `FromJSON` デコードのフィールド名不一致はビルド時に検出されないため、runtime-verify での実測 assert が必須。
  - **Haskell -Werror / missing-fields**: `AnalyzerResult` に新フィールドを追加すると、
    `Assessment.hs:170` のレコード構築式で `-Werror=missing-fields` が発火する。
    呼び出し側の同時更新を忘れると build が止まる（memory: Haskell-per-edit-hook-burns-subagent-budget）。
  - **docker rebuild 必須**: worker/analyzer はバイナリ焼き込み。`docker compose up -d --build` を
    runtime-verify 前に必ず実行しないと stale image で偽 green になる
    （memory: docker-rebuild-required-for-code-changes）。
  - **WADA-SNR の加性定常雑音仮定**: 非定常雑音（突発音・音楽）では推定誤差が大きい。
    実録音での挙動は calibration sweep で確認が必要。

## Open questions

なし。ADR-032 D1〜D5 で全決定事項が確定している。

以下は確定済みの PIN 値（open question ではない）:
- SNR floor の数値は `5dB < audioQualityMinSnrDb ≤ 10dB` の範囲で runtime sweep + human sign-off が先行必須。
  M-SNR-7 の注記欄に記録する前提で先行実装は進めてよいが、定数の最終 commit は sign-off 後に行うこと。
- WADA-SNR の unit test 許容帯は `±4 dB`（診断値から calibratable）。
- SNR ladder sweep 対象 SNR 値は ADR-031 で使用済みの `{clean, 20dB, 10dB, 5dB}` を再利用する。
