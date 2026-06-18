# 録音中の音量メーターをピークホール平滑化し、品質ゲートと整合させる

ADR-016: 録音メーターのピークホール平滑化とゲート整合

# Status

Accepted

2026-06-18 承認（リポジトリオーナーがエビデンスレビュー後にセッション内 AskUserQuestion で決定：
ゲイン下駄ではなくピークホール平滑化で瞬時値バウンスを抑え、ADR-015 の品質ゲートと整合させる）。

# Context

録音画面の音量メーターが、ユーザーが通常の声量で話していても「音量小」
（`volumeLevel < LOW_VOLUME_DISPLAY_THRESHOLD = 43`）を表示する。

実機メーターを実録音 30 件（`applications/frontend/data/audio/`）でシミュレートした結果、原因は
天井の低さではない。発話中のフレーム**ピークは健全**（ファイル毎の中央ピーク 80.7%、多くが
76〜92%）。真因は**平滑化の不在**である。メーターは `AnalyserNode`（`fftSize = 512`）の
`getByteTimeDomainData` を `requestAnimationFrame` ごとに読み、**瞬時の 512 サンプル（48kHz で
約 10.7ms）フレーム RMS** をそのまま表示するため、音節間の低振幅な谷に落ち込む。発話区間
フレームの **26.4% が < 43%** となり「音量小」がちらつく。中央フレーム 59% に対しピーク 80% と
いう乖離が、平滑化なしメーターの指紋である。

`autoGainControl: false`（ADR-015 で意図的）のため実発話の中央値は -24.9 dBFS。300ms の
ピークホールを掛けると < 43% のフレーム割合は 26.4% → 13.4%（コーパス全体）に、最も静かな録音を
除けば ~0〜5% に下がる。dB マッピングは変えない。8bit `getByteTimeDomainData` 量子化は無関係
（量子化フロアは無音付近でしか効かず、そこは VAD が非発話に分類する）。

**整合制約**: 最も静かな 3 録音（-36〜-38 dBFS）は、worker の品質ゲート（ADR-015、
speech-active RMS < -36 dBFS、`Scoring.hs` の `audioQualityMinMeanDbfs`）が `low_quality` として
弾き再録音（ADR-014）に回すのと**同じ録音**である。したがってメーターは、解析が弾く音声を
「音量OK」と表示してはならない（さもなくば「UI は OK → 解析は再録音」と矛盾する）。

# Decision

**D1 — 録音メーターは表示前に ~300ms のピークホール平滑化を適用する。** 瞬時フレーム値の代わりに
減衰ピークを表示する：各フレームで `displayed = max(currentFramePercent, previousDisplayed −
releasePerFrame)`。attack は即時（音節オンセットのピークへ跳ね上がる）、release は緩やか
（音節間の谷を跨いで保持する）。dBFS→% マッピング（`FLOOR_DB = -60`, `CEILING_DB = 0`）は
**変更しない**。平滑化は `volume-meter.ts` に純粋・単体テスト可能な関数として置き、`page.tsx` /
diagnostic `page.tsx` の rAF ループが前回値を ref に保持して適用する。`PEAK_HOLD_RELEASE_RATE_PER_MS`
はバーの応答感を決める調整値であり、「音量小」ラベルの誤発火解消は D4 のラベル debounce が担う（後述）。

**D2 — メーターとゲートの整合を保つ。** メーターは ADR-015 の worker ゲートが弾く音声
（speech-active RMS < -36 dBFS）を「音量OK」と分類してはならない。ピークホールはバウンスを均す
だけでレベルを持ち上げないため、これを保つ（静音は低表示のまま）。入力ゲイン/感度の下駄は履かせない
（静音を閾値超えに持ち上げゲートと矛盾する）。**Should**: `LOW_VOLUME_DISPLAY_THRESHOLD` を
`Scoring.hs` の -36 dBFS に整合させる（現 43%≈-34.2 dBFS → -36 dBFS は現カーブで ≈41%）。
正確値は実装時にカーブで換算し、`Scoring.hs` の定数と一致させる。

**D3 — 両方のメーター消費側に適用する。** 録音画面 `page.tsx` と diagnostic 画面 `page.tsx` は
共有の `volume-meter.ts` を介して同一挙動にする。

**D4 — 「音量小」ラベルは瞬時値ではなく持続低下で判定する（debounce）。** ピークホール平滑後の
表示値が `LOW_VOLUME_DISPLAY_THRESHOLD`（41）を **連続して `SUSTAINED_LOW_MS`（~500ms 目標、
正確値は実装時シミュレートで確定）下回ったときのみ**「音量小」ラベル（および `volume-meter--low`
スタイル）を発火させる。発話中の瞬間的な谷（無声子音・語尾）では発火しない。**バーは平滑後の瞬時値を
表示し続ける**（応答的・正直な feedback）。判定（ラベル）だけを debounce する。録音開始時は持続低下
タイマー 0（音量OK）で、持続低下が貯まって初めて「音量小」になる。これは ADR-015 の worker ゲートが
録音全体の speech-active RMS（= 持続レベル）で判定する意味論と一致する。`volume-meter.ts` に純粋・
単体テスト可能な helper（例: `accumulateLowDurationMs(prevBelowMs, smoothedValue, threshold, dtMs)`
→ 新しい低下継続 ms）として置き、両 rAF ループが `lowDurationRef` を保持して適用、`cleanupAudioContext`
でリセットする。

**D1 の追補（2026-06-18 改訂）：** 実装中の release-rate sweep（energy-VAD: float RMS > 0.01、
threshold 41）で、pure-decay のバー平滑化だけでは目標に届かないと判明した。release を遅くしても発話中
< 41% フレーム割合は ~10% で頭打ち（rate 0.04 = 2450ms latency でも normal 9.96%、現実的な
0.15 = 653ms でも 13.98%）。energy-VAD が拾う発話フレームの ~10〜16% が本当に低エネルギー
（-35〜-40 dBFS の無声子音・語尾）で近傍にピークが無く、peak-hold では救えないため。よって「音量小」の
誤発火は、バーをさらに平滑化するのではなく **ラベル判定を持続低下で debounce する（D4）** ことで解消する。
sweep の全結果: `.agent-evidence/meter-rate-sweep.txt`。

# Alternatives considered

- **+6 dB の入力ゲイン/感度倍率を dB 計算前に掛ける（全 30 件を OK にする）— 棄却。** 静音で
  worker が弾く音声（≤ -36 dBFS）まで「音量OK」に持ち上げ、ADR-015 ゲートと矛盾し「UI は OK →
  解析は再録音」を生む。
- **`LOW_VOLUME_DISPLAY_THRESHOLD` を 43→35 に下げるだけ — 主修正としては棄却。** バウンスを
  平滑化せず隠すだけ（バーは依然谷でちらつく）で、worker が弾く静音も OK 表示にしてゲート不整合。
  （-36 dBFS ゲートへの小さな整合は D2 の Should として残す。35 への一律引き下げとは別。）
- **`getByteTimeDomainData` → `getFloatTimeDomainData` に変える — 不要として棄却。** 量子化は
  VAD フロア以上では無関係とエビデンスが示す。変更の価値がない。
- **dBFS→% マッピング曲線（FLOOR/CEIL）を変える — 棄却。** ピークは既に健全で、再マッピングは
  正直なレベル関係を歪めゲート不整合のリスクを生む。
- **release rate をさらに遅くして bar 平滑化だけで解決 — 棄却。** sweep で floor ~10%
  （normal 発話、2450ms latency でも 9.96%）と判明。pure-decay では ≤5% に届かず latency も増える。
- **hold-then-release（ピークを ~250ms 保持してから減衰）に bar 機構を変える — 検討したが不採用。**
  ギャップは確実に跨ぐが、バーが実レベルより長く残り正直さが下がる。実際の不満（ラベルのちらつき）は
  ラベル debounce（D4）の方が直接的で、ゲートの持続レベル意味論とも一致する。

# Consequences

- 通常発話では「音量小」ラベルが出ず安定する（D4 の持続低下判定により、発話中の瞬間的な谷では
  発火しない）。バーは平滑後の瞬時値で応答する。
- UI のみの変更で frontend メーター（`volume-meter.ts` + 2 つの rAF ループ）に限定。analyzer /
  worker / 捕捉（`autoGainControl`）は不変。ADR-015 ゲートと ADR-014 再録音配線も不変。
- 録音画面と diagnostic 画面が共有 `volume-meter.ts` で同一挙動になる。
- メーターが `low_quality` ゲートと一致する：通常発話 → 音量OK 安定、worker が弾く静音 → 音量小。
- リスク：ピークホールは表示に ~300ms の残光（発話停止後バーが少し残る）を加える。レベルメーター
  として許容範囲だが明記する。

# Compliance

- 変更は frontend メーター（`applications/frontend/src/components/workspace/volume-meter.ts` +
  `materials/.../[sectionIdentifier]/page.tsx` / `diagnostic/.../page.tsx` の rAF ループ）に留まる
  （ADR-005：component 層ユーティリティ、layer 違反なし）。
- 平滑化関数は `volume-meter.test.ts` のスタイルに合わせ純粋関数として単体テストする
  （ピーク保持・谷での減衰・attack 即時を assert）。
- ランタイム検証：サンプル録音に対し、通常発話では「音量小」ラベルが（~`SUSTAINED_LOW_MS` 連続
  低下しないため）出ないこと、ゲートが弾く静音（≤ -36 dBFS）では「音量小」が出ることをシミュレートで
  確認。バー平滑ピークが静音で < 41（A2）も確認。加えてブラウザで持続発話中にラベルがちらつかないことを
  目視確認。

# Notes

- **確定値（2026-06-18, シミュレーション確認済み）：**
  `PEAK_HOLD_RELEASE_RATE_PER_MS = 0.327` %/ms（≈ 98% / 300ms = 全スケール 300ms 減衰）、
  60fps 時 5.45 %/frame。`LOW_VOLUME_DISPLAY_THRESHOLD = 41`（-36 dBFS = ((-36+60)/60)*98+2 = 41.20% → 41%）。
  シミュレーション結果（scripts/simulate_meter_peak_hold.py、corpus 30 件）:
  A2 PASS: gate-rejected ファイル（speech_active = -39.5 dBFS）の平滑ピーク = 37.9% < 41%（「音量小」維持）。
  判定基準の改訂（2026-06-18, D4）: 当初の per-frame「発話中 < 41% が ≤5%」目標は pure-decay バー
  平滑化では達成不可（release-rate sweep で floor ~10%、2450ms latency でも normal 9.96%、現実的な
  0.15=653ms で 13.98%。`.agent-evidence/meter-rate-sweep.txt`）、かつ瞬時フレームを判定軸にしていた
  点が誤り。D4 で「音量小」を持続低下（`SUSTAINED_LOW_MS` 連続）判定に変更し、受入を『通常発話でラベルが
  出ない / ゲート棄却の静音（≤ -36 dBFS）でラベルが出る』に改めた。A2（バー平滑ピーク 37.9% < 41）は確認済み。
  **D4 確定値（2026-06-18, `scripts/simulate_label_debounce.py` キャリブレーション済み）：**
  `SUSTAINED_LOW_MS = 500`（ms）。gate-rejected ファイル（01KTV6FJ, -39.5 dBFS）:
  label_on_at_end = True, label_time_pct = 100%（「音量小」常時 ON）。通常〜大きい声（>= -25 dBFS）:
  瞬間的な谷では SUSTAINED_LOW_MS に達せずラベルが即時フリックしない（per-frame ちらつき解消）。
  `.agent-evidence/meter-label-debounce-calibration.txt` 参照。
- **Non-goal：** dBFS→% マッピング曲線の変更、`autoGainControl` の変更、ADR-015 の解析ゲートや
  ADR-014 の再録音フローの変更、`getFloatTimeDomainData` への切り替え。
- Author: lihs
- Approval date: 2026-06-18
- Approver: リポジトリオーナー（セッション内）
- Last updated: 2026-06-18（改訂: D4 ラベル debounce を追加。release-rate sweep で pure-decay
  バー平滑化だけでは「音量小」誤発火が解消しない（floor ~10%）と判明したため）
- Related: ADR-015（worker speech-active ラウドネスゲート -36 dBFS。メーターはこれと整合）、
  ADR-014（low_quality → 再録音 UI）、ADR-005（frontend レイヤ）。
