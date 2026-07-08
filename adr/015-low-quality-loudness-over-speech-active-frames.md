# 低品質ラウドネスを全区間 RMS ではなく発話区間フレームで測定する

ADR-015: 低品質ゲート向けの発話区間ラウドネス測定

# Status

Accepted

2026-06-17 承認（リポジトリオーナーがエビデンスレビュー後にセッション内で決定：解析前に音声を
正規化するのではなく、ゲートのラウドネスを発話区間フレームで測定し閾値を再較正する）。

# Context

正常で明瞭な発話が誤って `low_quality` と判定され、再録音（ADR-014 D1）に回される。ユーザーは
「実際に発している声量よりかなり小さく認識される」と報告している。

フロントエンドは `autoGainControl: false` で録音する
（`applications/frontend/src/app/materials/.../[sectionIdentifier]/page.tsx`）。これは意図的で、
単一のマイクゲイン変更はスケール不変であり、AGC は prosody/F0 経路が依存する発話内ダイナミクスを
歪めるためである。したがって絶対デジタルレベルは設計上低い。

この判定はモデル由来ではない。アライナ `facebook/wav2vec2-lv-60-espeak-cv-ft` は
`do_normalize: true` の `Wav2Vec2Processor` をロードし（モデルのキャッシュ済み
`preprocessor_config.json` と `transformers` の既定値で確認）、モデル入力前に発話単位の
ゼロ平均・単位分散正規化を適用する。これはスケール不変であり、上流の任意のゲイン `a` は相殺される
— `(a·x − mean(a·x)) / std(a·x) = (x − mean(x)) / std(x)`。ゆえにアライメント・GOP・音素検出は
既にゲイン不変である。絶対ゲインを消費するのは品質ゲートに渡すラウドネス測定だけである。

そのゲートは波形全区間の RMS を測定する（`wav2vec2_aligner.py` の `measure_audio_quality`：
`mean_dbfs = 20·log10(rms)`）。これは先頭・末尾の無音や語間ギャップを含み、worker は
`meanDbfs < -35.0` を棄却する（`Scoring.hs` の `checkAudioQuality`）。ポーズが RMS をフロア
以下に希釈する。

実測：`applications/frontend/data/audio/` の実録音 27 件に対する `ffmpeg volumedetect` では、
全区間 RMS は −14.7〜−47.1 dBFS に分布し、約 22% が −35 を下回った。決定的な例 `01KTT0W1`：
全区間 **−35.9 dBFS**（棄却）だが **ピーク −5.3 dBFS**、発話区間 RMS（−45 dB 未満の無音を除去）
**−29.7 dBFS** — 大きく明瞭な発話が無音希釈だけで棄却されている。フロア未満のファイル群では
無音除去で約 5〜6 dB 回復し（−38.6→−33.1、−36.4→−34.2）、境界上の実発話がフロアを超える一方、
本当に静かなものは低いまま（−42.1→−40.7、−47.1→−45.9）だった。

ADR-014 は「worker 自身の低品質検出閾値（dBFS / speech-duration）のチューニング」を Non-goal
として意図的に先送りし（ADR-014 Notes）、棄却した「worker で低品質を検出する」案の中で
フォローアップと位置づけた。本 ADR はそのフォローアップを実現する。

# Decision

**D1 — 低品質ゲートのラウドネスは全区間ではなく発話区間フレームで測定する。**
`measure_audio_quality` は `mean_dbfs = 20·log10(発話区間フレームの RMS)` を計算し、既存の
energy-VAD フレーミング（`audio_energy.py`、320 サンプル / 20 ms フレーム、
`ENERGY_SILENCE_RMS_THRESHOLD`）を再利用する。発話区間フレームが 0 件のときは no-speech
（番兵となる低い値）を報告し、空ケースを引き続き棄却する。これはゲート指標に限り全区間 RMS を
置き換える。`meanDbfs` はワイヤ上の名前を維持し、意味は「代表的な発話ラウドネス」になる。
ADR-005 に従い `python-analyzer` の infrastructure 内の詳細に留まり、use-case シグネチャは
変更しない。

**D2 — worker 閾値を発話区間分布から再較正する。** `audioQualityMinMeanDbfs`（`Scoring.hs` の
calibratable 定数、現在 −35.0）を発話区間 RMS 基準で再導出し、`01KTT0W1` クラスの明瞭発話を通し、
真の無音/準無音は引き続き棄却する。暫定帯は **−33〜−38 dBFS**。確定値は実装時に解析器**自身**の
発話区間計算を実録音コーパスに適用して決定し（ffmpeg プロキシではなく）、spec / Notes に記録する。

**D3 — 無音・no-speech の棄却は既存のゲイン不変ゲートで維持する。** ADR-014 の再録音経路は最小
録音長（1000 ms）、最小音素検出率（0.25）、median GOP 上限（−18.0）で引き続き発火する。実発話の
ないクリップは発話区間フレームがほぼ 0、検出音素もほぼ 0 になり、duration / detection / GOP が
捕捉する。ラウドネスフロアは唯一の無音ガードではなく、より早く明確な「too quiet」シグナルとして
機能する。

# Alternatives considered

- **解析前に目標 dBFS へ RMS/ピーク正規化してから dBFS を測定する（当初案）— 棄却。** モデルは
  既に `do_normalize`（ゲイン不変）なので、正規化はアライメント/GOP に何も寄与しない。さらに
  正規化後の波形で dBFS を測るとフロアが空虚になる：全クリップが目標付近に収束し、増幅された無音も
  通ってしまう。意図した利点（モデルのゲイン非依存化）は既に存在し、害（死んだゲート）だけが残る。
- **VAD ゲートなしで −35 閾値を下げるだけ — 棄却。** 雑である：無音希釈と真の低ゲインを区別せず、
  フロアを −45/−47 へ下げると真の無音フロアの上に乗り、準無音テイクの誤受理が増える。
- **絶対 dBFS ゲートを完全に撤廃し phoneme-detection-rate + median GOP に委ねる — 検討したが
  不採用。** 両者ともゲイン不変なので成立する。しかし補正済みのラウドネスフロアは既存の再録音 UI に
  整合した、より早く読み取りやすい「too quiet」の手がかりを与えるため、撤廃せず維持する。

# Consequences

- 通常のポーズを含む明瞭発話の誤 `low_quality` 棄却が減る。`01KTT0W1` クラスのテイクが再録音
  プロンプトではなく結果に到達する。
- ADR-004 は維持：worker は引き続き scoring と `status` フィールドを所有し、変更は解析器の生
  ラウドネス**測定**と worker 閾値定数の再較正のみ。
- ADR-005 のレイヤ閉包は維持：変更は `python-analyzer` の infrastructure（`wav2vec2_aligner.py`、
  `audio_energy.py`）に限定され、use-case シグネチャ/インタフェースは変えない。
- ADR-014 D1 の再録音配線は不変。発火する録音が変わるだけ。
- `meanDbfs` の DTO フィールド（`AnalyzerClient.hs` の `analyzedMeanDbfs`）は型と名前を維持。
  意味は全区間から発話区間ラウドネスへ移るため、契約に明記する。

# Compliance

- 測定変更は `applications/python-analyzer/.../infrastructure/{wav2vec2_aligner.py,audio_energy.py}`
  内に留まる（ADR-005）。`wiring_manifest.yml` の worker→analyzer エッジは不変。
- worker scoring 契約（ADR-004）は `Scoring.hs` の再較正定数を除き不変。閾値変更は `ScoringSpec.hs`
  にも反映する。
- ランタイム検証（実装時、live worker で実コーパスに対し）：`01KTT0W1` クラスの録音が
  `low_quality` を返さなくなり、無音クリップは引き続き返すことを assert する。確定した再較正定数は
  計測後に記録する。

# Notes

- **再較正確定値（2026-06-17）：** `audioQualityMinMeanDbfs` = **−36.0 dBFS**。
  実録音コーパス 30 件（`applications/frontend/data/audio/`）で analyzer 自身の
  `compute_speech_active_rms` を適用して計測。
  - 01KTT0W1A46FCACAMANCWVX65Q.webm: speech_active = −24.7 dBFS（> −36.0, 通過）
  - 01KTV6FJXPP5DRB1HK97Y1VNVC.webm: speech_active = −39.5 dBFS（< −36.0, 棄却）
  - 全正常発話クリップは speech_active ≥ −32.9 dBFS（3.1 dB の余裕）
  - 詳細：`.agent-evidence/calibration-speech-active-rms.txt`
- **Non-goal：** energy-VAD 閾値の相対化。VAD は依然として絶対 `0.01` RMS（約 −40 dBFS）の
  フレームフロアを使うため、極端に静かだが明瞭な録音（発話区間 〜−40）はフレームを拾い損ねうる。
  VAD 閾値をピーク相対化し、それが供給する `dtw_lag` の pause / speech-rate 消費側を再検証する
  ことは本スコープ外で、フォローアップ候補。
- **Non-goal：** `autoGainControl` の録音設定変更（設計上 `false` のまま）。
- Author: lihs
- Approval date: 2026-06-17
- Approver: リポジトリオーナー（セッション内）
- Last updated: 2026-06-17
- Related: ADR-014（低品質再録音の配線。本 ADR はその先送りされた閾値チューニング Non-goal を
  実現）、ADR-004（worker が scoring を所有）、ADR-005（解析器 onion レイヤ）、ADR-001（ゲイン
  不変のバックストップとしての GOP ゲート）。
