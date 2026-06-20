# 雑音下 GOP overconfidence を SNR-aware 低品質ゲートで遮断する（ADR-015 ラウドネスゲートに SNR 次元を追加）

ADR-032: 発話区間 SNR/noise-floor 推定（WADA-SNR）による低品質ゲート拡張

# Status

Proposed

# Context

## 背景（self-eval が検出した実 analyzer 不整合）

ADR-031 Loop-A self-eval harness（metamorphic noise-monotonicity）が live で「median per-phoneme GOP が**最も雑音の多い 5dB SNR で逆に上昇する**」不整合を検出した（median GOP `-6.61(clean)→-7.25(20dB)→-7.92(10dB)→-6.89(5dB)`）。read-only の根本原因診断（live `/v1/analyze` 実測、`hello_world.wav`）で **CTC overconfidence-under-noise** と確定した:

- **証拠（smoking gun）**: phoneme `h` の 5dB で nBest `ð=0.6265`（期待 `h` に対し**誤った音素を高信頼で decode**）。期待音素の log-posterior（= GOP）が spurious に上昇する。clean では同位置の top 候補がわずか 0.0020（diffuse）。
- phoneme 数は全 SNR で **8 一定**、forced-alignment 境界は **±1 frame で安定**（aligner=ADR-001 は原因ではない）、detectedIpa は実際に**劣化**、`add_pink_noise` の SNR 数学は exact（actual SNR 20/10/5/0 dB、clipping 0）。
- **決定的**: analyzer の `meanDbfs` は SNR に**追従しない**（5dB でむしろ上昇 `-23.1→-22.5`、pink noise がエネルギーを足し speech-active 窓を伸ばす speechDur `0.8→1.34s`）。よって **ADR-015 の loudness ゲートはこの SNR 劣化を一切捕捉できない**。

GOP は ADR-001 の「整列された期待音素の平均 log-posterior」であり、雑音下で CTC が confident-but-wrong な posterior peak を出すと期待音素の log-posterior が押し上げられ、発音の読みが無意味でも GOP が改善する。これは教科書的な overconfidence-under-noise 故障である（証跡: deep-research、End-to-end ASR は低 SNR で 10–20% のトークンを confidence>0.7 で誤予測、arXiv:2509.07195）。

## 現状（既存 seam。greenfield ではない）

- python `applications/python-analyzer/src/python_analyzer/infrastructure/audio_energy.py`: `compute_speech_active_rms`（発話区間 VAD、`ENERGY_SILENCE_RMS_THRESHOLD=0.01`、ADR-015）。
- python `interface/schema.py:214` `AnalysisResponse.meanDbfs`。
- worker `Scoring.hs` `checkAudioQuality`（:16）が `audioQualityMinMeanDbfs=-36.0`（:237）/ `audioQualityMinRecordingDurationMs=1000` / `audioQualityMinPhonemeDetectionRate=0.25` で低品質を binary 判定。`AnalyzerClient.hs` `analyzedMeanDbfs`。
- ADR-031 self-eval `run_selfeval.py` の `_KNOWN_FAILURES` に `noise_monotonicity`（理由「CTC-overconfidence-under-noise, tracked」）が登録され exit code から除外されている。

## 制約

- **ADR-004**: scoring locus は worker。SNR 推定（measurement）は analyzer、gate 判定は worker（既存 `checkAudioQuality` seam）に置く。
- **ADR-001**: aligner / GOP 式は不変（境界が ±1 frame で安定＝aligner 無関係のため触らない）。
- **ADR-031 D11/D12**: production scoring 定数（SNR floor）の変更は human-gated。本 ADR は user が明示承認した Loop-B 作業。
- docker rebuild 必須（worker/analyzer はバイナリ焼き込み、memory: docker-rebuild-required-for-code-changes）。

# Decision

**D1 — WADA-SNR で発話区間の reference-free SNR を python-analyzer で推定する。** Waveform Amplitude Distribution Analysis（Kim & Stern 2008）で、清音声を Gamma 分布・加性雑音を Gaussian と仮定し振幅分布の形状から単一 SNR（dB）を reference-free に推定する。実装は pure numpy で追加依存なし、`audio_energy.py`（または新 module）に `compute_wada_snr` を置き、発話区間サンプルに対して推定する。1 クリップ 1 値で gate に最適。

**D2 — `AnalysisResponse` に `estimatedSnrDb` 新フィールドを追加する（`meanDbfs` の隣）。** python `schema.py` `AnalysisResponse.estimatedSnrDb: float`。worker `AnalyzerClient.hs` が FromJSON で decode し `AnalyzerResult.analyzedEstimatedSnrDb` として運ぶ。`Types.hs` に追加。`meanDbfs` の DTO は不変。

**D3 — worker `Scoring.hs` `checkAudioQuality` に SNR-floor 判定を追加する。** 新 calibratable 定数 `audioQualityMinSnrDb`（`audioQualityMinMeanDbfs=-36.0` の sibling）を導入し、`estimatedSnrDb < audioQualityMinSnrDb` のとき low_quality とする（findings 抑制、既存ゲートと**同一の binary 挙動**）。既存ゲート（loudness / duration / phoneme-rate）は不変で、SNR 判定を OR で追加する（いずれか満たさない → low_quality）。

**D4 — SNR floor は実測 sweep で確立し human sign-off する（calibratable 暫定値）。** 診断値: 10dB までは GOP が有効（monotone 減）、5dB で confident-misdecode が始まる。よって floor は `5dB < audioQualityMinSnrDb ≤ 10dB` の範囲にある。proven-done の runtime-verify で複数 fixture に SNR ladder sweep を実行し、confident-misdecode が始まる点を実測して初期値を pin し、human sign-off する。`audioQualityMinSnrDb` は `+5/-2` 類の calibratable 暫定値として扱い、ADR-031 D11/D12 の Loop-B human-gate に従う（self-eval の信号から自動 tune しない）。

**D5 — 着地後、ADR-031 self-eval `run_selfeval.py` の `_KNOWN_FAILURES` から `noise_monotonicity` を除去し、metamorphic relation を本物のガードに戻す。** SNR gate が低 SNR クリップを low_quality で弾くことで、self-eval の noise ladder では低 SNR レベルが low_quality（GOP 抑制）になり median 逆転が消える → relation が PASS に戻る。これにより **self-improvement loop が完結する**（Loop-A が検出 → 診断 → Loop-B が修正 → guard 復活）。以後この relation は本物の回帰ガードとして機能する。

# Contract changes

- **python `interface/schema.py` `AnalysisResponse`**: `+estimatedSnrDb: float`（発話区間 WADA-SNR、dB。常時 populate）。
- **python `infrastructure/audio_energy.py`（または新 module）**: `+compute_wada_snr(samples, sample_rate) -> float`（pure numpy）。`/v1/analyze` ハンドラで発話区間に対して呼び、`estimatedSnrDb` に載せる。
- **Haskell `Types.hs` / `AnalyzerClient.hs`**: `AnalyzerResult` に `analyzedEstimatedSnrDb :: Double` 追加 + `FromJSON` で `estimatedSnrDb` を decode。
- **Haskell `Scoring.hs`**: `+audioQualityMinSnrDb :: Double` 定数（runtime sweep で pin、暫定値）。`checkAudioQuality` のシグネチャに `estimatedSnrDb` を渡し、SNR floor 判定を OR 追加（`-Werror` 注意、呼び出し側を更新）。
- **ADR-031 `run_selfeval.py`**: `_KNOWN_FAILURES` から `noise_monotonicity` を除去（D5、SNR gate 着地確認後）。`manifest.json` の `noiseMonotonicity.knownDefect` を false に戻し observed を再 pin。

## D4 補正（2026-06-20 runtime sweep — WADA 絶対スケール無効と floor rebase）

実 hello_world.wav の SNR sweep（live `/v1/analyze`）で WADA-SNR の**絶対スケールが無効**と判明した: `estimatedSnrDb` は clean=2.13 / 20dB=2.05 / 10dB=1.27 / 5dB=-0.15 / 0dB=-2.74 と、真 SNR より ~20dB 低く高 SNR 域で圧縮される（clean≈20dB）。根因は `K_clean_prior=34.0` が合成 `_make_gamma_speech(shape=0.5)` に較正されており、M-SNR-5 unit test も同分布から入力を生成する **circular test**（9/9 green が実音声を一切検証していなかった。self-eval の thesis「合成は合成しか検証しない」の再演を runtime が捕捉）。**順序判別は有効**（5dB=-0.15 が 10dB=1.27 より明確に下、confident-misdecode 再現）。

よって D4 を補正する: spec の真 dB 想定 `5 < floor ≤ 10` は WADA スケールでは不成立（clean=2.13 を gate せず 5dB=-0.15 を gate する値が範囲内に無い）。**`audioQualityMinSnrDb` を estimator 実スケールの ~0.5 に rebase する**（5dB を gate・10dB/clean を pass、live 実証 floor=1.0 動作）。本定数は **WADA estimator-scale floor（真 dB ではない）** であり PROVISIONAL で、複数の実録音 clip での sweep 検証を production 昇格前提とする。M-SNR-5 は circular を廃し実音声の**順序検証**に修正する。D5 の self-eval `noise_monotonicity` は `/v1/analyze` の `estimatedSnrDb` を読み floor 未満レベルを除外して production gate と整合させる（analyzer の `/v1/analyze` 自体は gate しないため）。lihs が M-SNR-7 human-gate で option (A)=rebase を選択（2026-06-20）。

# Alternatives considered

- **SNR-aware gate（WADA-SNR + low_quality、採用）** vs **ADR-001 alignment の修正（不採用）** vs **metamorphic relation を valid-SNR に狭めるだけ（不採用）** vs **GOP の noise calibration（不採用）** — 採用理由: 診断で aligner 境界は ±1 frame で安定し原因は CTC overconfidence と確定したため、既存 quality-gate seam に SNR 次元を足すのが最小・的確。不採用理由（ADR-001）: 境界安定＝aligner 無関係で、ADR-001 再開は構造的に困難かつ誤誘導。不採用理由（relation を狭める）: confident-misdecode の spurious GOP を**本番で**ユーザーに見せたまま放置し、根本対処にならない。不採用理由（GOP noise calibration）: GOP 式自体に雑音補正を入れるのは model 級で困難・高リスク（ADR-001/004 の core を触る）。
- **SNR 推定 = WADA-SNR（採用）** vs **VAD speech-vs-silence energy ratio（不採用）** vs **minimum-statistics noise PSD（不採用）** — 採用理由: WADA-SNR は reference-free で 1 クリップ 1 SNR を返し gate に最適、pure numpy で追加依存なし、加性定常雑音を想定した標準手法。不採用理由（VAD ratio）: 加性雑音は発話区間中にも存在し、無音フレームが無いクリップでは noise floor を推定できない。不採用理由（minimum-statistics）: scipy STFT の per-frame 処理で複雑・コスト高、gate には単一 SNR で十分。
- **gate 挙動 = low_quality 抑制（採用）** vs **confidence 低減アノテーション（不採用）** — 採用理由: 既存 `checkAudioQuality` と同一 binary seam・同一 outcome で一貫し、低 SNR の誤りをユーザーに見せない。不採用理由（confidence 低減）: 新しい partial-trust 経路を導入し ADR-015 の binary gate と不一致、低 SNR の confident-misdecode をなお表示してしまう。

# Consequences

## Positive

- confident-misdecode による spurious GOP がユーザーに出ない（雑音録音は low_quality で弾かれ再録音を促す）。
- self-eval が検出した実 analyzer 不整合が修正され、metamorphic noise-monotonicity guard が本物のガードに復活する（**self-improvement loop 完結**: Loop-A 検出 → Loop-B 修正 → guard 復活）。
- ADR-015 と同一 seam（`checkAudioQuality` + sibling 定数）での最小拡張で、aligner / GOP 式 / scoring locus を一切変えない。
- ADR-004 の scoring locus を尊重（SNR 推定は analyzer の measurement、gate 判定は worker）。

## Negative

- SNR floor 未満の難所録音（雑音環境）が low_quality で弾かれ findings が出ない。ユーザーは静かな環境での再録音が必要になる。
- SNR 閾値の calibration が要り、過剰に厳しいと正当な録音も弾く（false low_quality）。初期値は暫定で実測 sweep + human sign-off が前提。
- WADA-SNR は加性定常雑音を仮定するため、非定常雑音（突発音・音楽）では推定誤差が出る。
- worker / analyzer の rebuild コスト（バイナリ焼き込み）と Haskell `-Werror` の呼び出し側更新。

# Compliance

- **self-improvement loop 完結の検証**: SNR gate 着地後に ADR-031 `pnpm test:fullcycle`（noise ladder）で `noise_monotonicity` が **PASS** に戻る（低 SNR レベルが low_quality で弾かれ median 逆転が消える）ことを runtime で確認。`_KNOWN_FAILURES` から除去されていることを grep で確認。
- **threshold は human-gated**（D4）: `audioQualityMinSnrDb` は runtime sweep で実測して pin し human sign-off。self-eval の信号から自動 tune しない（D11/D12）。
- **WADA-SNR の正当性**: 既知 SNR の合成信号（清音声 + 既知レベル雑音）に対し `compute_wada_snr` の推定誤差を unit test で assert（±数 dB の許容帯）。
- **scoring locus 維持（ADR-004）**: SNR 推定が analyzer、gate 判定が worker `checkAudioQuality` であることをレビューで確認。aligner / GOP 式不変（ADR-001）。
- **既存ゲート不変**: loudness（`audioQualityMinMeanDbfs=-36.0`）/ duration / phoneme-rate の判定は変えず、SNR を OR 追加（既存の low_quality 振る舞いを回帰させない）ことを worker unit test で確認。

# Notes

- Risks:
  - WADA-SNR の加性定常雑音仮定。非定常雑音で推定がぶれ、gate が誤発火/見逃しうる。実録音での挙動は calibration sweep で確認が要る。
  - SNR floor の過剰厳格化リスク（正当な録音を false low_quality で弾く）。初期値は保守的に置き、実測で調整。
  - calibration 値（`audioQualityMinSnrDb`）は暫定。診断は単一 fixture（hello_world.wav, TTS clean baseline）由来であり、複数の実録音 fixture での sweep が確定に必要。
- First-slice relevance: D1–D5 全てが first slice（self-improvement loop を閉じる最小増分）。non-goal: GOP 式自体の雑音補正、非定常雑音の高度推定、confidence-annotation 経路、SNR floor の自動 tuning。観測可能 assert: SNR gate 着地後に self-eval noise_monotonicity が PASS、既知 SNR 合成信号で WADA-SNR 推定誤差が許容帯、低 SNR 実クリップで `estimatedSnrDb < floor → low_quality`。
- Amends: **ADR-015**（speech-active loudness low-quality gate に SNR 次元を追加する。`checkAudioQuality` に `audioQualityMinSnrDb` を sibling 追加し、`meanDbfs` loudness gate と既存閾値は不変。ADR-015 は SNR 非追従の loudness のみを測るため、雑音劣化は本 ADR が補完する）。
- Depends on: ADR-001（GOP/aligner の供給元・不変）、ADR-004（scoring locus worker）、ADR-014/015（low_quality gate の枠組み）、ADR-031（self-eval が検出元。D5 で `_KNOWN_FAILURES` 除去により loop を完結）。
- Author: lihs
- Last updated: 2026-06-20
- Related: ADR-001（GOP/aligner）、ADR-004（scoring locus）、ADR-014（low_quality robustness）、ADR-015（loudness gate、本 ADR が amend）、ADR-031（self-eval harness、検出元）。
