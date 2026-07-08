# Spec: recording-volume-meter-smoothing

<!-- 設計の正 / 背景:
       adr/016-recording-volume-meter-peak-hold-smoothing.md (Accepted, 2026-06-18)
         (D1: ピークホール平滑化で瞬時値バウンスを抑える。D2: ADR-015 品質ゲートとの整合維持。
          D3: 録音画面 + diagnostic 画面の両消費側に共有 volume-meter.ts を介して適用)
       adr/015-low-quality-loudness-over-speech-active-frames.md
         (worker 品質ゲート: speech-active RMS < −36 dBFS → low_quality 棄却。
          メーターはこのゲートと整合しなければならない)
       adr/014-analysis-pipeline-robustness-low-quality-and-webm.md
         (D1: low_quality → 再録音 UI 配線。ゲート不整合は「UI OK → 解析: 再録音」矛盾を生む)
       adr/005 (frontend レイヤリング: volume-meter.ts は component 層ユーティリティ)
     背景 (ADR-016 Context より):
       録音中の音量メーターが通常声量でも「音量小」を表示する。
       真因は平滑化の不在: AnalyserNode (fftSize=512, ~10.7ms/フレーム) の瞬時 RMS をそのまま
       表示するため、音節間の低振幅な谷で 26.4% のフレームが LOW_VOLUME_DISPLAY_THRESHOLD(43%)
       を下回る。ファイル毎の中央ピークは 80.7% と健全で、天井の低さは真因でない。
       入力ゲイン/感度の下駄は静音録音を「音量OK」に持ち上げ ADR-015 ゲートと矛盾するため棄却。
     配線点 (agent-policy):
       追加:
         applications/frontend/src/components/workspace/volume-meter.ts
           (applyPeakHold 純粋関数を追加)
         applications/frontend/src/components/workspace/volume-meter.test.ts
           (applyPeakHold ユニットテスト追加)
       更新:
         applications/frontend/src/app/materials/[materialIdentifier]/sections/[sectionIdentifier]/page.tsx
           (rAF ループ: previousDisplayedRef を保持し applyPeakHold を適用)
         applications/frontend/src/app/diagnostic/[diagnosticSessionIdentifier]/page.tsx
           (同上)
         LOW_VOLUME_DISPLAY_THRESHOLD (両 page.tsx): 43 → Should で -36 dBFS 整合値へ
     強制レイヤ: scripts/verify-no-stub-placeholder.sh / verify-wiring.sh /
       verify-allowlist-expiry.sh + fitness hook (scripts/agent-policy-hook.sh) + CI
       (.github/workflows/pr-gate.yml) -->

## Goal

- 録音中の音量メーターに ~300ms のピークホール平滑化を適用し、通常声量で話すユーザーが
  音節間の谷で「音量小」がちらつく問題を解消する。
- 平滑化は表示だけを均し、レベルを持ち上げない。これにより ADR-015 の worker 品質ゲート
  （speech-active RMS < −36 dBFS → `low_quality` 棄却）とメーター表示の整合を維持する。
- 変更は `volume-meter.ts` の純粋関数 1 本 + 2 つの rAF ループに限定し、
  analyzer / worker / 録音設定（`autoGainControl`）/ ADR-014 再録音配線は変えない。

## Must (満たさなければ done でない)

- [ ] **M-PH-D4 (ラベル debounce 純粋関数の追加)**
  `applications/frontend/src/components/workspace/volume-meter.ts` に
  純粋・単体テスト可能な関数 `accumulateLowDurationMs` と定数 `SUSTAINED_LOW_MS` を追加すること。
  シグネチャ: `(previousBelowMs: number, smoothedValue: number, threshold: number, dtMs: number): number`。
  算式: `smoothedValue < threshold` なら `previousBelowMs + dtMs`、そうでなければ `0`（リセット）。
  定数 `SUSTAINED_LOW_MS = 500`（ms、`scripts/calibration/simulate_label_debounce.py` でキャリブレーション確定）。
  両 `page.tsx` の rAF ループが `lowDurationRef` を保持して適用し、
  `lowDurationRef.current >= SUSTAINED_LOW_MS` のときのみ `isLowVolume = true` とすること。
  `isLowVolume` の状態と `lowDurationRef` は `cleanupAudioContext` でリセットすること。
  バーは引き続き平滑後の `volumeLevel`（スムージング済み瞬時値）を表示すること（ラベルのみ debounce）。

- [ ] **M-PH-1 (ピークホール純粋関数の追加)**
  `applications/frontend/src/components/workspace/volume-meter.ts` に
  純粋・単体テスト可能な関数 `applyPeakHold` を追加すること。
  シグネチャ例: `(currentFramePercent: number, previousDisplayed: number, releasePerFrame: number) => number`。
  算式: `displayed = Math.max(currentFramePercent, previousDisplayed − releasePerFrame)`。
  attack は即時（currentFramePercent > previousDisplayed のとき即座に跳ね上がる）、
  release は緩やか（previousDisplayed − releasePerFrame を下回らない）。
  `releasePerFrame` は ~300ms を目標として実装時にサンプル音声シミュレーションで確定する
  （確定値を本 spec 注記欄および ADR-016 Notes に記録すること）。
  `dBFS→% マッピング`（`FLOOR_DB = -60`, `CEILING_DB = 0`）および
  既存関数 `computeRmsLevel` / `rmsLevelToDisplayPercentage` は変更しない。

- [ ] **M-PH-2 (両消費側の rAF ループへの適用)**
  下記 2 ファイルの `requestAnimationFrame` ループが `applyPeakHold` を介して
  平滑後の値を `volumeLevel` に反映すること。
  前回表示値は `useRef` / `React.MutableRefObject` 等で rAF をまたいで保持すること
  （`previousDisplayedRef.current` 等）。
  - `applications/frontend/src/app/materials/[materialIdentifier]/sections/[sectionIdentifier]/page.tsx`
  - `applications/frontend/src/app/diagnostic/[diagnosticSessionIdentifier]/page.tsx`
  両画面は共有の `volume-meter.ts` を介して同一挙動になること。

- [ ] **M-PH-3 (ゲート整合の維持)**
  ピークホールは瞬時値の bounce を均すのみでレベルを持ち上げないこと。
  具体的には: ADR-015 の worker ゲートが `low_quality` として棄却する録音
  （speech-active RMS < −36 dBFS のクリップ）が、平滑化後のメーターで
  `LOW_VOLUME_DISPLAY_THRESHOLD` 以上（「音量OK」）を示さないこと。
  入力ゲイン乗算・感度倍率・`autoGainControl` の変更は行わないこと。

- [ ] **M-PH-4 (agent-policy 厳守: 偽値なし + 実 entrypoint 実行 assert)**
  本番コードに mock/stub/fake/dummy/spy / test-bypass / placeholder stub を入れないこと
  （`scripts/verify-no-stub-placeholder.sh` / `verify-wiring.sh` / `verify-allowlist-expiry.sh` 緑）。
  実ブラウザの録音画面または diagnostic 画面（real public entrypoint）から到達可能であり、
  A1・A2・A3・A4 の観測可能挙動が確認できること。
  `.agent-evidence/recording-volume-meter-smoothing/` に
  commands.txt / wiring-map.json / completion-report.md を提出すること。

---

**注記: M-PH-1 確定値（2026-06-18, シミュレーション確認済み）**

> `PEAK_HOLD_RELEASE_RATE_PER_MS = 0.327` %/ms（全スケール ~300ms 減衰, 60fps で 5.45 %/frame）。
> `LOW_VOLUME_DISPLAY_THRESHOLD = 41`（-36 dBFS → ((-36+60)/60)*98+2 = 41.20% → 41%、`Scoring.hs` audioQualityMinMeanDbfs 整合）。
> シミュレーション A2 PASS: gate-rejected ファイル平滑ピーク 37.9% < 41%（`.agent-evidence/meter-peak-hold-calibration.txt` 参照）。

## Should (望ましいが必須でない)

- **S-PH-1 (`LOW_VOLUME_DISPLAY_THRESHOLD` の -36 dBFS 整合)**
  両 `page.tsx` のハードコード値 `43`（現カーブ換算: ≈−34.2 dBFS）を
  `Scoring.hs` の `audioQualityMinMeanDbfs`（−36 dBFS、ADR-015 で確定）に
  対応する % 値（現カーブ換算: ≈41%）に合わせること。
  正確な換算値は実装時に `rmsLevelToDisplayPercentage` の計算式
  `((dbfs - FLOOR_DB) / (CEILING_DB - FLOOR_DB)) * (100 - MIN_DISPLAY_PERCENTAGE) + MIN_DISPLAY_PERCENTAGE`
  で導出し、両 `page.tsx` を同じ定数に揃えること。

- **S-PH-2 (`releasePerFrame` の名前付き定数化)**
  `volume-meter.ts` 内で `releasePerFrame` を名前付き定数として定義し、
  コメントで目標 release 時間（~300ms）と実測 ms/フレームの対応を明示すること。

- **S-PH-3 (シミュレーションスクリプトの保存)**
  `releasePerFrame` の決定に用いたサンプル音声シミュレーションスクリプトを
  `scripts/` 以下に残し、将来の再調整を再現可能にすること。

## 受入条件 (acceptance — Must の確認方法)

> 合否は yes/no で機械判定する。

- **M-PH-1** →
  `grep -n "applyPeakHold" applications/frontend/src/components/workspace/volume-meter.ts`
  で関数定義が存在すること。
  `grep -n "Math.max" applications/frontend/src/components/workspace/volume-meter.ts`
  で `max(currentFramePercent, previousDisplayed − releasePerFrame)` 相当のコードが存在すること。
  `pnpm test --run` で `volume-meter.test.ts` の `applyPeakHold` テストが全通過すること（0 failure）。

- **M-PH-2** →
  `grep -n "applyPeakHold\|previousDisplayed" \
    "applications/frontend/src/app/materials/[materialIdentifier]/sections/[sectionIdentifier]/page.tsx"`
  で `applyPeakHold` 呼び出しと前回値 ref の保持コードが存在すること。
  `grep -n "applyPeakHold\|previousDisplayed" \
    "applications/frontend/src/app/diagnostic/[diagnosticSessionIdentifier]/page.tsx"`
  で同様に存在すること。
  `pnpm typecheck` が緑であること。

- **M-PH-3** →
  サンプル音声コーパス（`applications/frontend/data/audio/`）の実録音を
  `applyPeakHold` を組み込んだシミュレーションで処理し、
  下記を commands.txt に記録すること:
  (a) 通常〜大きい声（≥−25 dBFS クラス）の発話クリップで、
      `LOW_VOLUME_DISPLAY_THRESHOLD` 未満になるフレーム割合が 0〜5% 以下であること（修正前: 26.4%）。
  (b) worker ゲートが棄却するクリップ（speech-active RMS ≤−36 dBFS）で、
      平滑後のメーターが `LOW_VOLUME_DISPLAY_THRESHOLD` 未満のまま維持されること
      （「音量OK」になっていないこと）。

- **M-PH-4** →
  `bash scripts/verify-no-stub-placeholder.sh` / `verify-wiring.sh` / `verify-allowlist-expiry.sh`
  が対象差分で緑（memory: verify-scripts-skip-untracked — staged/commit 後に確認）。
  `pnpm fitness` が緑であること。
  wiring-map.json に
  `(録音画面 rAF ループ) → applyPeakHold(volume-meter.ts) → setVolumeLevel` および
  `(diagnostic 画面 rAF ループ) → applyPeakHold(volume-meter.ts) → setVolumeLevel` を記述すること。

---

### ランタイム観測 assert（A1 / A2 / A3 / A4）

- **A1 (通常発話でのちらつき解消 — ラベル状態基準 D4)** →
  `accumulateLowDurationMs` + `SUSTAINED_LOW_MS` を使ったラベル debounce シミュレーション
  （`scripts/calibration/simulate_label_debounce.py`）で下記を確認すること:
  (a) gate-rejected 録音（01KTV6FJ、speech_active = -39.5 dBFS）で `label_on_at_end = True`
      かつ `label_time_pct = 100%`（持続低下 → ラベル常時 ON）。
  (b) 通常〜大きい声の録音（speech_active >= -25 dBFS）で、発話中の瞬間的な谷では
      `SUSTAINED_LOW_MS` に達しないためラベルが即時フリックしないこと（per-frame 割合 0/26.4% 問題の解消）。
  commands.txt にシミュレーション出力サマリと SUSTAINED_LOW_MS 確定値を記録すること（yes/no: gate-rejected label ON）。
  注: per-frame ≤5% 基準は pure-decay バー平滑化では達成不能（rate-sweep で floor ~10%）と判明。
      D4 でラベル判定を持続低下 debounce に変更し、本 A1 もラベル状態基準に改めた（ADR-016 D4）。

- **A2 (静音クリップの「音量小」維持)** →
  worker ゲートが棄却する実録音（speech-active RMS ≤−36 dBFS）に `applyPeakHold` をシミュレートし、
  平滑後のピーク表示値が `LOW_VOLUME_DISPLAY_THRESHOLD` 未満のまま維持されること
  （「音量OK」になっていないこと）。commands.txt に録音ファイル名・平滑後ピーク % を記録すること
  （yes/no: peak < threshold）。

- **A3 (ユニットテストによるアルゴリズム検証)** →
  `volume-meter.test.ts` の `applyPeakHold` テストが下記 3 条件を assert すること:
  (i) attack: `currentFramePercent > previousDisplayed` のとき返値 = `currentFramePercent`（即時跳ね上がり）
  (ii) 谷でのホールド: `currentFramePercent < previousDisplayed − releasePerFrame` のとき
      返値 = `previousDisplayed − releasePerFrame`（monotonic release）
  (iii) 連続呼び出しで前回値から単調に減衰し、特定フレーム数後に `currentFramePercent` まで
      降下すること（release が速くなりすぎないこと）。
  `pnpm test --run` で 0 failure（yes/no）。

- **A4 (実ブラウザでの目視確認)** →
  実ブラウザの録音画面（`/materials/.../sections/...`）で持続発話中にメーターバーが
  `LOW_VOLUME_DISPLAY_THRESHOLD` 付近でちらつかず安定していることを目視確認し、
  completion-report.md に観測ブラウザ・確認 URL・結果（安定 / ちらつきあり）を記録すること
  （yes/no: 安定）。
  発話停止後バーが ~300ms 残光ののち降下することを確認すること（ピークホールの期待動作）。

## Non-goals (今回やらない)

- **dBFS→% マッピング曲線の変更**: `FLOOR_DB = -60` / `CEILING_DB = 0` の変更、
  マッピング式の差し替えはしない（ADR-016 Non-goal）。
- **`autoGainControl` の変更**: 録音設定は `autoGainControl: false` のまま（ADR-015 で意図的）。
- **ADR-015 の解析ゲート変更**: worker の speech-active RMS 閾値 / `audioQualityMinMeanDbfs` は変えない。
- **ADR-014 の再録音フロー変更**: `low_quality` → 再録音 UI の配線は変えない。
- **`getByteTimeDomainData` → `getFloatTimeDomainData` の切り替え**:
  量子化は発話振幅レンジで無関係（ADR-016 Alternatives で棄却）。
- **analyzer / worker / python-analyzer の変更**: フロントエンド表示のみ。

## Risk

- level: **low-risk**
- escalate_to_opus: **false**
- 理由:
  - 変更は frontend 表示のみ（`volume-meter.ts` 純粋関数 1 本 + 2 つの rAF ループ更新）。
    analyzer / worker との契約（DTO / wire / schema）は不変。
    `DI` / `routing` / `auth` / `config` / `migration` / `schema` / `public export` /
    `background job` / `event subscription` のいずれにも触れない。
  - ゲート整合制約（M-PH-3）は要注意だが、ピークホールはレベルを持ち上げないため
    整合は自動的に保たれる構造。シミュレーションで数値確認（A1/A2）することで
    確定的に検証可能。
  - `pnpm typecheck` / `pnpm test` / `pnpm fitness` で全確認が閉じ、
    docker rebuild や実 worker 起動が不要。

## Open questions

なし。ADR-016 で全決定事項が確定している。
未確定の `releasePerFrame` 確定値および `LOW_VOLUME_DISPLAY_THRESHOLD` 整合値は
実装フェーズでのシミュレーション計測後に spec 注記欄および ADR-016 Notes に記録する
（実装前に人間判断は不要）。
