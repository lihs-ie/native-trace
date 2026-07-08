---
name: pronunciation-scoring-debug
description: 採点結果がおかしい・ハイライトが出ない・声量が弾かれる・解説が意味不明、といった発音採点まわりのデバッグ知識。GOP の意味論と band 定数、nBest/CTC の diffuse garbage の実態、audio 品質ゲート（speech-active RMS / silence-dilution）、マイク triage 決定木、espeak 音素注入や say/ffmpeg での fixture 捏造レシピ、WADA SNR gate の現在状態（無効化済み）を含む。「発音スコアが変」「low_quality_audio で弾かれる」「マイクの音量が小さく認識される」「nBest が garbage」の場面で使う。
---

# pronunciation-scoring-debug — 採点・音質のデバッグ知識

## 責務境界

採点 locus は **worker**（`applications/backend/src/NativeTrace/Worker/Scoring.hs`、ADR-004）。analyzer は生計測のみ（GOP/NBest/F0/wordStress/rhythm/weakForm/syllables — 採点しない）。

## GOP の意味論（Scoring.hs の定数が正）

- GOP = 整列された期待音素の平均 log-posterior。**常に負値**。正の GOP を含む fixture は現実に存在しない形（real-shape-fixtures skill）。
- 定数: `gopFloor=-20.0` / `gopCeiling=-2.0` / `gopMinorThreshold=-8.0` / `gopMajorThreshold=-12.0`。score は floor..ceiling 正規化平均（空なら 50）。
- これらは **Loop-B calibratable 定数 = human-gated**。デバッグ中に「通したいから」動かさない。

## CTC/nBest の実態

- CTC は diffuse で、noise 下で overconfident。実測: クリーンな "hello world" でも nBest top-1 が `[v,n,l,w,w,ɹ,l,n]` の garbage、rawTop1Conf 0.014。**nBest garbage は defect でも drift でもない**（drift では advisoryIpaDrift 扱い）。
- gain-invariant な backstop は detRate（音素検出率）と median GOP。絶対 dBFS 系の判断より信頼できる。

## 品質ゲート（worker `checkAudioQuality`）

| ゲート | 閾値 | 注意 |
|---|---|---|
| meanDbfs | ≥ -36.0 | analyzer が **speech-active frames（energy VAD）で計測**。whole-clip volumedetect は無音希釈で誤棄却する（ADR-015: 実測 whole -35.9 棄却 vs speech-active -29.7） |
| duration | ≥ 1000ms | multipart metadata の `durationMilliseconds` 駆動 |
| detRate | ≥ 0.25 | gain-invariant |
| median GOP | ≥ -18.0 | gain-invariant |
| SNR | **無効化済み** | ADR-032 の固定 WADA floor は 13-clip validation で不成立（clip 間 ~11dB オフセット、順序性のみ有効）。`noise_monotonicity` は open defect（SELFEVAL FAIL[KNOWN]） |

## マイク・声量 triage 決定木（「声が小さく認識される」）

1. **OS の入力デバイス**を最初に確認 — macOS Handoff で近くの iPhone がマイクを乗っ取り、ほぼ無音 0.76s 録音になる実績あり。
2. メーター表示の意味論: dBFS log mapping + peak-hold + 500ms debounce（線形 RMS 表示は過小に見えるだけで棄却とは別問題。41% ≈ -36dBFS）。
3. `getUserMedia` constraints は**意図的に all-false**（AGC/noiseSuppression/echoCancellation が formant を破壊し detRate 0.94→0.17）。true に戻さない。
4. それでも棄却されるなら analyzer 側の speech-active RMS 計測値を直接確認（/v1/analyze 直叩き — live-stack-ops skill）。

## fixture 捏造レシピ

```bash
# クリーン正解音声（16kHz WAV）
say -o /tmp/nt.aiff "hello world" && afconvert -f WAVE -d LEI16@16000 /tmp/nt.aiff /tmp/nt.wav
# 非音声（品質ゲート棄却系の検証）
ffmpeg -f lavfi -i "sine=frequency=440:duration=2" -ar 16000 /tmp/nt-sine.wav
# ゲイン操作（gain_invariance 検証: GOP が動かないことを確認）
ffmpeg -i /tmp/nt.wav -af "volume=25dB" /tmp/nt-loud.wav
# 実録音を analyzer コンテナ内で解析
docker cp recording.webm native-trace-analyzer:/tmp/ && docker compose exec -T analyzer python3 ...
```

espeak の `[[音素]]` 注入で誤発音音声を捏造できるが、espeak の formant 合成は wav2vec2 にとって OOD — 結果を過信しない。実録音での再現が最終確認。
