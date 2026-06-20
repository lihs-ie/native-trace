# Spec: closed-remediation-loop

<!-- 設計の正 / 背景:
       adr/022-closed-remediation-improvement-measurement-loop.md (Proposed, 2026-06-18 / D13-D19 追補 2026-06-19)
         D1: 部分再生 — Web Audio decodeAudioData + AudioBuffer スライス
         D2: 所見スコープ A/B 2-chip (self / model TTS)
         D3: ArticulationCard 自分で試す — MediaRecorder 配線、Props に finding 追加
         D4: POST /api/v1/findings/[findingIdentifier]/retry-recordings 新 Route Handler
             per-finding synthetic single-word section 永続化・実 Section history 隔離
         D5: 音素マッチング — IPA 文字列 + audioRange.startMs 最近傍
         D6: worker が gopDelta + deltaSignal + boundarySignal を計算 (ADR-004 scoring locus)
             [維持] 正常 retry の per-phoneme GOP と finding.gop (originalGop) から計算する
         D7: RetryRecordingResponse 8 フィールド・3 enum 契約
       D13-D19 追補 (2026-06-19) — AFTER パネル再採点フォローアップスライス:
         D13: BEFORE/AFTER 二列状態機械を landed first slice の上に積む新スライス。
              gopSeverity↔gopToSeverity をしきい値 1 元化（3 重コピー禁止）。scoreImpact 不変。
         D14: GopDeltaResponse / RetryRecordingResponse に retrySeverity + retryConfidence 追加 (worker 計算)
         D15: retry クリップ保持 + 所見スコープ A/B を original-vs-retry に拡張 (retryRecordingAttemptIdentifier)
         D16: drill-verdict チップ / 4 ステップトラッカー / two-signal 注記に実描画点。
              供給源未確定チップ (retention / post-retry NBest) は Non-goal 降格 (CSS-only scaffold 禁止)
         D17: 延期された M-CRL-8 を ADR-022 配下に再回収 (ADR-018 は引き受けていない)
         D19: 新規 contract field = retrySeverity / retryConfidence / retryRecordingAttemptIdentifier
              + worker AssessmentResponse responseDiagnosticPerPhonemeGop のみ
     First-slice scoping amendment (2026-06-18) — 【M-CRL-16 で is-overridden】:
       first slice は正常録音の閉ループ（部分再生 + A/B + 再録音 + 正常 retry の GOP delta）に限定し、
       low_quality な再録音は 422 + 再録音プロンプトを返した（gopDelta は normal retry のみ）。
       responseDiagnosticPerPhonemeGop の常時 populate を一旦 ADR-018 に延期したが、
       ADR-018 はこれを引き受けていない（ADR-018 D9/relevance が「前提でも依存でもない」と明示、
       repo 実装ヒット 0）。AFTER パネルスライス (D17/M-CRL-16) で所有を ADR-022 に戻し、本スライスで実装する。
     dead affordance の現状（first slice landed 後）:
       first slice (M-CRL-1〜10) は実機に landed・verify 済み。
       AFTER パネルスライス (M-CRL-11〜17) はこの上に積むフォローアップ。
     worker 現状（grounding 確認済み・このスライスの編集対象）:
       Types.hs:567-598 — AssessmentResponse は responsePerPhonemeGop を持つが
                          responseDiagnosticPerPhonemeGop は未存在（M-CRL-16 で追加）。
       Types.hs:748-762 — GopDeltaResponse は gopDelta/deltaSignal/boundarySignal の 3 フィールドのみ
                          （M-CRL-11 で retrySeverity/retryConfidence を追加）。
       Scoring.hs:1686-1698 — classifyGopDelta は 3 フィールドのみ計算（M-CRL-11 で 5 フィールドへ拡張）。
       Scoring.hs:1668-1672 (gopSeverity) と :1353-1357 (gopToSeverity) は完全重複の同一関数
                          （同じ gop < gopMajorThreshold(-12.0)/gop < gopMinorThreshold(-8.0) strict <）。
                          M-CRL-17 で 1 関数に統一する。
       Scoring.hs:1365-1369 — severityToConfidence は Critical 0.9/Major 0.8/Minor 0.7/Suggestion 0.6
                          （none ケースなし。M-CRL-11/PIN で none→0.6 を maybe で補う）。
       Scoring.hs:1359-1363 — severityToScoreImpact は不変（scoreImpact 不変。M-CRL-17）。
       Assessment.hs:169-183 — low_quality 分岐で responsePerPhonemeGop = []。
       Assessment.hs:143/198 — analyzedPerPhonemeGop は gate 判定前に存在（M-CRL-16 の供給源）。
       AnalyzerClient.hs:65-94 — analyzer PhonemeGop {phoneme,gop,startMs,endMs,nBest,wordPosition} デコード済。
       python-analyzer schema.py:204-263 — AnalysisResponse.perPhonemeGop は常時 populate（追加測定不要）。
     frontend 現状（grounding 確認済み）:
       api-types.ts:346-355 — RetryRecordingResponse は 8 フィールド
                          {findingIdentifier, phoneme, originalGop, retryGop, gopDelta,
                           deltaSignal, boundarySignal, qualityStatus}。
                          retrySeverity/retryConfidence/retryRecordingAttemptIdentifier 未存在。
       api-types.ts:276-307 — EngineFindingDto.phenomenon: FindingPhenomenon | null (:278) /
                          .severity: critical|major|minor|suggestion (:280) / .gop: number|null (:279)。
       gop-delta ACL: src/acl/gop-delta/create-gop-delta-adaptor.ts
                          zod schema:22-26 は 3 フィールド（M-CRL-11 で 5 フィールドへ拡張）。
       route.ts (app/api/v1/findings/[findingIdentifier]/retry-recordings/route.ts):
                          responseDto:300-309、computeGopDelta:283-297、
                          retryGop===null → 422 (:278-279)、ACL 例外 → 422 (:295-296)、
                          200 時 qualityStatus 常に 'normal' (:308)。
                          retry recordingAttemptIdentifier を捕捉/返却していない（M-CRL-13 で追加）。
       既存録音音声 Route Handler: app/api/v1/recording-attempts/[recordingAttemptIdentifier]/audio/route.ts
                          （HTTP Range 対応。M-CRL-13 の retry blob 取得に再利用）。
     配線点 (agent-policy):
       frontend: api-types.ts RetryRecordingResponse 拡張 (retrySeverity/retryConfidence/retryRecordingAttemptIdentifier)
       frontend: src/acl/gop-delta/create-gop-delta-adaptor.ts zod schema 拡張 (5 フィールド)
       frontend: retry-recordings/route.ts responseDto を worker 値で拡張 + retryRecordingAttemptIdentifier 返却
       frontend: ArticulationCard.tsx BEFORE/AFTER 二列状態機械・4 ステップトラッカー・two-signal 注記
       Haskell: Types.hs GopDeltaResponse に retrySeverity/retryConfidence、ToJSON 追加
       Haskell: Scoring.hs classifyGopDelta が両者を計算、gopSeverity↔gopToSeverity 統一
       Haskell: Types.hs AssessmentResponse に responseDiagnosticPerPhonemeGop、ToJSON 追加
       Haskell: Assessment.hs 両分岐で diagnosticPerPhonemeGop を analyzedPerPhonemeGop から populate
       cabal: Scoring/Types は既に exposed（追加配線不要、フィールド追加のみ）
     強制レイヤ: scripts/verify-no-stub-placeholder.sh / verify-wiring.sh + fitness hook + CI
     rebuild 注意: worker はバイナリ焼き込み (memory: docker-rebuild-required-for-code-changes)。
       GopDeltaResponse / AssessmentResponse フィールド追加は worker コード変更のため runtime verify 前に
       `docker compose up -d --build worker` が必須。analyzer 側は変更なしだが diagnostic GOP 経路の
       runtime 検証は worker rebuild 後に行う。
     ADR-008 制約: progress_snapshots.task_kind CHECK は 'rereading'/'drill' のみ。
       retry の AssessmentResult を progress_snapshots に書かない。synthetic section 配下の
       assessment_results/analysis_runs 永続化は ADR-008 の制約外。 -->

## Goal

- 所見（finding）詳細パネルの dead affordance 4 つ（部分再生・自分で試す・GOP delta 表示・verify loop）を
  real entrypoint から到達可能・観測可能挙動を持つ形で配線し、
  「聞く → 比べる → 出す → 測る」の閉ループを所見単位で成立させる（FIRST SLICE = M-CRL-1〜10、landed 済み）。
- GOP デルタ（before → after）と改善信号（deltaSignal / boundarySignal）を worker が計算して返し、
  frontend は presentation のみ担う（ADR-004 scoring locus 維持）。
- AFTER パネル再採点フォローアップスライス（M-CRL-11〜17）で、retry を再採点した
  severity / confidence / 音声クリップ・BEFORE/AFTER 二列状態機械・low_quality 時の診断 GOP 貫通まで
  閉ループを拡張する。再採点分類はすべて worker に閉じ、frontend は presentation のみ。
- low_quality な再録音も診断 per-phoneme GOP（worker 常時フィールド）から GOP デルタを返す
  （M-CRL-16 で本スライス実装。所有は ADR-022。かつて ADR-018 に延期と記したが ADR-018 は引き受けていない）。
  既存品質ゲートは緩めない（responsePerPhonemeGop heatmap は low_quality で空のまま）。

## Must (満たさなければ done でない)

> **first slice (M-CRL-1〜10) は landed・verify 済み。本スライスでは M-CRL-8 の所有再回収（→ M-CRL-16）を除き、
> M-CRL-1〜7/9/10 のテキストは変更しない。** AFTER パネルスライスとして M-CRL-11〜17 を追加する。

- [ ] **M-CRL-1 (部分再生 — Web Audio スライス)**
  `DetailPanelV2` に `latestRecordingAttemptIdentifier: string | null` プロパティを追加し、
  `WorkspaceResultV2.tsx`(:514 付近) の `<DetailPanelV2>` 呼び出しで渡すこと。
  `finding.audioRange` ボタン(:396)の `onClick` で
  `GET /api/v1/recording-attempts/{latestRecordingAttemptIdentifier}/audio`（Range なし、200 全体）から
  full blob を取得し、`AudioContext.decodeAudioData` でデコードし、
  `[audioRange.startMilliseconds / 1000, audioRange.endMilliseconds / 1000]` 区間のみを
  新 `AudioBuffer` にスライスして `AudioBufferSourceNode` で再生すること。
  バイトオフセット近似（VBR で境界ずれる）は使わない。
  デコード済み `AudioBuffer` は所見切替まで component state にキャッシュすること。

- [ ] **M-CRL-2 (所見スコープ A/B 2-chip)**
  部分再生ボタンの隣に `自分の音` / `お手本` の 2-chip トグルを新設すること。
  `自分の音` は M-CRL-1 の AudioBuffer スライス再生、
  `お手本` は既存 `handlePlayTts`（`DetailPanelV2.tsx`:99 の `POST /api/v1/tts` 再利用）を呼ぶこと。
  golden(RVC) は first slice 外であり、chip は self / model TTS の 2 種のみ。

- [ ] **M-CRL-3 (自分で試す — MediaRecorder 配線)**
  `ArticulationCard.tsx`(:144-154) の `disabled` を外し、`MediaRecorder` フローを component local state
  (`isRecording` / `blob` / `mimeType`) で配線すること。
  `ArticulationCardProps` を `{ entry: ArticulationEntry }` から
  `{ entry: ArticulationEntry; finding: EngineFindingDto }` に拡張すること。
  録音停止後 M-CRL-4 の `POST /api/v1/findings/{findingIdentifier}/retry-recordings` へ送信すること。
  再録音ターゲット語は `finding.expected.text`、なければ `finding.detected.text` とすること。
  `retryState: { originalGop, retryGop, gopDelta, deltaSignal, boundarySignal, qualityStatus } | null` を
  component local state に持ち、成功後に M-CRL-7 の表示を行うこと。

- [ ] **M-CRL-4 (retry-recordings Route Handler)**
  `app/api/v1/findings/[findingIdentifier]/retry-recordings/route.ts` を新規作成し、
  `POST` を実装すること。
  multipart で `audio`(File) / `recordedDurationMs`(正整数) / `referenceText`(string) /
  `expectedPhonemeIpa`(string) / `expectedAudioRangeStartMs`(number) を受けること。
  内部で `ensureFindingRetrySectionExists(database, findingIdentifier, referenceText)` を呼び
  per-finding synthetic single-word section を ensure すること（M-CRL-5）。
  `submitPracticeAttempt(syntheticSection, mode='oss_worker_only')` →
  `runAssessmentJob` を 30s ポーリングで実行すること。
  low_quality な retry（runAssessmentJob が low_quality で失敗 or per-phoneme GOP が取れない）→
  422 と「もう一度はっきり録音してください」再録音プロンプトを返すこと。
  normal な retry → 200 と `RetryRecordingResponse`（M-CRL-6）を返すこと。
  **normal retry の retryGop は retry AssessmentResult の既存 per-phoneme GOP
  （responsePerPhonemeGop heatmap）から取得すること**（新しい diagnostic フィールドは追加しない）。
  ※ M-CRL-16 で low_quality 経路は diagnostic per-phoneme GOP に切り替わる（下記参照）。
  `progress_snapshots` には書き込まないこと（ADR-008）。
  実装様式は `drills/[trainingSessionIdentifier]/attempts/route.ts` と同一バリデーション形式とすること。

- [ ] **M-CRL-5 (finding-retry-section-fixture)**
  `infrastructure/training/finding-retry-section-fixture.ts` を新規作成すること。
  `FINDING_RETRY_MATERIAL_SINGLETON` / `FINDING_RETRY_SECTION_SERIES_SINGLETON` 固定識別子と
  `ensureFindingRetrySectionExists(database, findingIdentifier, referenceText): Promise<string>` を export すること。
  section 識別子は `findingIdentifier` 由来で決定論的・idempotent に生成すること。
  `drill-section-fixture.ts`(:23-29) と同型の実装パターンを踏襲すること。
  この material が workspace の実 Section 履歴クエリから参照されないことで history 隔離が成立すること
  （`FINDING_RETRY_MATERIAL_SINGLETON` を fixture 外から参照しないことを grep で確認）。
  Drizzle スキーマの変更（新テーブル・新カラム）はこのスライスでは行わないこと。

- [ ] **M-CRL-6 (RetryRecordingResponse 型定義)**
  `api-types.ts` の `EngineResultDto`(:309 付近) の下（兄弟 export）に以下の型を追加すること。
  `EngineResultDto` のフィールドとして追加してはならない。

  ```
  export type RetryRecordingResponse = {
    findingIdentifier: string;
    phoneme: string;
    originalGop: number;
    retryGop: number;
    gopDelta: number;
    deltaSignal: 'improved' | 'unchanged' | 'regressed';
    boundarySignal: 'crossedMajor' | 'crossedMinor' | 'none';
    qualityStatus: 'normal' | 'low_quality';
  }
  ```

  全フィールドが camelCase であること。`gop` 値は worker 内部スケール（負の浮動小数）であること。
  `deltaSignal` が 3 値 enum・`boundarySignal` が 3 値 enum・`qualityStatus` が 2 値 enum であること
  （単一 enum で両 signal を表現してはならない）。
  ※ AFTER パネルスライスで `retrySeverity` / `retryConfidence` / `retryRecordingAttemptIdentifier` を追加する
  （M-CRL-11 / M-CRL-13）。`qualityStatus` は first slice では 200 で常に `'normal'` だったが、
  M-CRL-16 実装後は low_quality retry でも 200 + `qualityStatus='low_quality'` を返し得る。

- [ ] **M-CRL-7 (worker: gopDelta + deltaSignal + boundarySignal 計算)**
  `Scoring.hs` の `gopMajorThreshold=-12.0` / `gopMinorThreshold=-8.0` を
  strict `<` 演算子で使い、以下のロジックを worker 側に実装すること（frontend では計算しない）:
  - `gopDelta = retryGop - originalGop`（負の浮動小数の差分、worker 内部スケール）。
  - `deltaSignal`: `gopDelta > +5` → `improved` / `gopDelta < -2` → `regressed` / その他 → `unchanged`。
  - `boundarySignal`: original/retry それぞれの severity を `gop < gopMinorThreshold` /
    `gop < gopMajorThreshold` で判定（strict `<`、`gop == -8` は minor ではない、`gop == -12` は major ではない）。
    `major → (minor or none)` を `crossedMajor`、`(major or minor) → none` を `crossedMinor`、
    跨ぎなしを `none` とすること。両 signal は別フィールドで同時表示できること。
  route は normal retry AssessmentResult の per-phoneme GOP を retryGop として、finding の gop（finding.gop）を
  originalGop として worker に渡すこと。
  実装: `POST /v1/gop-delta`（`{ originalGop, retryGop }` を受け
  `{ gopDelta, deltaSignal, boundarySignal }` を返す）を Api.hs の `WorkerApi` 型 +
  `Application.hs` の handler + cabal exposed-modules で配線済み（`classifyGopDelta` Scoring.hs:1686）。
  分類ロジックは必ず worker（Scoring.hs）に閉じること。
  frontend は `deltaSignal` / `boundarySignal` の値を受け取るだけで threshold を再導出してはならない。
  frontend コードに `-8` / `-12` / `gopMinorThreshold` / `gopMajorThreshold` 相当の数値リテラルが
  scoring 判定として現れないこと。

- [ ] **M-CRL-8 (→ M-CRL-16 に再採番・所有 ADR-022 へ再回収)**
  ~~worker: diagnosticPerPhonemeGop 常時フィールド追加 — ADR-018 に延期~~
  **【再回収】** この要件（worker `responseDiagnosticPerPhonemeGop` の常時 populate）は ADR-018 へ延期したが、
  ADR-018（acoustic-phonetic diagnosis）D9 / First-slice relevance が「本機能は前提でも依存でもない」と明示し
  契約に入れない（repo 実装ヒット 0）ため、所有を ADR-022 に戻す。
  本要件は AFTER パネルスライスの **M-CRL-16 として本スライスで実装する**。詳細は M-CRL-16 を参照。
  1 要件に 2 番号を残さないため、以後 M-CRL-8 は M-CRL-16 への参照のみとする。

- [ ] **M-CRL-9 (UI 表示: GOP デルタ + signal)**
  `ArticulationCard`（および `DetailPanelV2` の retryState 表示箇所）が以下を満たすこと:
  - `GOP: {originalGop.toFixed(1)} → {retryGop.toFixed(1)} ({gopDelta >= 0 ? '+' : ''}{gopDelta.toFixed(1)})` を表示すること。
  - `deltaSignal === 'improved'` を緑、`'regressed'` を赤で表示すること。
  - `boundarySignal === 'crossedMinor'` のとき「minor を脱しました」、
    `'crossedMajor'` のとき「major を脱しました」を表示すること（deltaSignal と同時表示可）。
  - UI コピーに「改善が加速」「improvement-acceleration」に相当する文言を含めないこと。
    「進捗トラッキング」相当の表現に限定すること（RISK-3）。
  `qualityStatus` フィールドは `RetryRecordingResponse` に保持すること。
  first slice では 200 レスポンス時の `qualityStatus` は常に `'normal'` であった。
  M-CRL-16 実装後の low_quality 200 経路の表示は M-CRL-14 / M-CRL-17 のコピー制約に従う。

- [ ] **M-CRL-10 (agent-policy: 本番に偽値なし + 証跡)**
  本番コードに mock / stub / fake / dummy / spy / test-bypass / placeholder stub を入れないこと
  (`scripts/verify-no-stub-placeholder.sh` / `verify-wiring.sh` 緑)。
  retry route と再録音ボタンが real public entrypoint（App Router ファイル配置 +
  DetailPanelV2/ArticulationCard 経由）から到達可能であること。
  retry は synthetic section 配下に実 engine を呼んで永続化すること（mock 不可）。
  `.agent-evidence/closed-remediation-loop/commands.txt` /
  `.agent-evidence/closed-remediation-loop/wiring-map.json` /
  `.agent-evidence/closed-remediation-loop/completion-report.md` を提出すること。

### AFTER パネル再採点フォローアップスライス（D13-D19 追補・2026-06-19）

- [ ] **M-CRL-11 (worker 再採点: retrySeverity + retryConfidence を契約に追加)**
  worker `GopDeltaResponse`（Types.hs:748-762）に以下 2 フィールドを追加すること:
  - `gopDeltaResponseRetrySeverity`（wire key `retrySeverity`）: `gopToSeverity retryGop` の写像。
    `gopToSeverity` は `Maybe FindingSeverity`（`Nothing` = しきい値内）を返すため、
    `Nothing → none` とし、`critical` / `major` / `minor` / `suggestion` / `none` の 5 値 enum とすること。
    （`gopToSeverity` は major / minor / none しか返さないが、enum は他経路の severity と整合させ 5 値で定義する）
  - `gopDeltaResponseRetryConfidence`（wire key `retryConfidence`、`Double`）: `severityToConfidence` 由来。
    `severityToConfidence` に none ケースが無いため `maybe 0.6 severityToConfidence (gopToSeverity retryGop)` で計算すること
    （**PIN: none → 0.6**。最下位 tier の再利用であり新リテラルを発明しない。calibratable）。
  `classifyGopDelta`（Scoring.hs:1686-1698）が両フィールドを計算して `GopDeltaResponse` に載せること
  （現状は計算しないため `gopToSeverity` / `severityToConfidence` を delta path に新規配線する変更）。
  worker `ToJSON GopDeltaResponse`（Types.hs:756-762）に `retrySeverity` / `retryConfidence` を追加すること。
  gop-delta ACL zod schema（`src/acl/gop-delta/create-gop-delta-adaptor.ts`:22-26）に
  `retrySeverity: z.enum(['critical','major','minor','suggestion','none'])` と `retryConfidence: z.number()` を追加すること。
  frontend `RetryRecordingResponse`（api-types.ts:346-355）に
  `retrySeverity: 'critical' | 'major' | 'minor' | 'suggestion' | 'none'` と `retryConfidence: number` を追加すること。
  retry-recordings route の `responseDto`（route.ts:300-309）を worker `GopDeltaResponse` 由来の
  `retrySeverity` / `retryConfidence` で埋めること（ハードコード severity/confidence を本番経路に置かない）。
  AFTER 列の severity バッジが retry GOP で再採点された `retrySeverity` を描画すること。
  frontend は `-12.0` / `-8.0`（`gopMajorThreshold` / `gopMinorThreshold`）相当のしきい値を再導出しないこと（grep clean）。

- [ ] **M-CRL-12 (AFTER 列: phenomenon 複製 + confidence インジケータ)**
  AFTER 列は `finding.phenomenon`（`EngineFindingDto.phenomenon`、api-types.ts:278、型 `FindingPhenomenon | null`）を
  **presentation として複製**すること（再判定しない・新 response フィールドを足さない）。
  AFTER 列は `retryConfidence`（M-CRL-11 由来）から confidence インジケータを描画すること。
  phenomenon / confidence をコンポーネント内にハードコードしないこと
  （phenomenon は finding 由来、confidence は live retry の worker `GopDeltaResponse` 由来）。

- [ ] **M-CRL-13 (retry クリップ保持 + 所見スコープ A/B を original-vs-retry に拡張)**
  retry-recordings route が synthetic section（`finding-retry-section-fixture.ts`）配下に永続化した
  retry RecordingAttempt の識別子を捕捉し、`RetryRecordingResponse` に
  `retryRecordingAttemptIdentifier: string`（M-CRL-11 と同じ拡張ブロックで追加）を返すこと
  （現状 route.ts は捕捉/返却していない）。
  frontend は既存録音音声 Route Handler
  （`app/api/v1/recording-attempts/[recordingAttemptIdentifier]/audio/route.ts`、HTTP Range 対応）で
  その retry blob を取得し、M-CRL-2 の所見スコープ A/B（self / model TTS）に
  「今回の録音」（retry）ソースを加えて original-vs-retry の比較再生を可能にすること。
  retry クリップを client 側で破棄しないこと。
  retry が実 Section の score history に現れないこと（synthetic section 隔離、progress_snapshot 書込なし）を維持すること。

- [ ] **M-CRL-14 (BEFORE/AFTER 二列状態機械 + 4 ステップトラッカー + two-signal 注記)**
  `ArticulationCard` が BEFORE/AFTER の 2 列状態機械（state-1=original / state-2=post-retry）を、
  `finding-loop.html` の `.lp` グリッドに沿って所見単位で実描画すること。
  post-retry の gopDelta / retrySeverity / phenomenon / confidence が AFTER 列に出ること。
  4 ステップトラッカー（聞く / 比べる / 出す / 測る、`.loop-steps`）と
  two-signal 注記（`deltaSignal`=magnitude と `boundarySignal`=boundary-crossing の意味差）が、
  retryState 表示（ArticulationCard.tsx:447-491 付近）から到達可能な **実描画点**を持つこと。
  CSS-only scaffold（描画点・データ源のない CSS ブロック）を done としないこと。

- [ ] **M-CRL-15 (drill-verdict チップ: retry-GOP-echo のみ ship、retention / NBest は Non-goal 降格)**
  drill-verdict 診断チップのうち **retry GOP echo チップ**は実フィールド `retryGop` / `gopDelta` から供給され
  描画点を持つこと（本スライスで ship）。
  **retention（✓/l/保持）チップ**と **post-retry NBest チップ**は ADR D14/D19 が追加する契約
  （retrySeverity / retryConfidence / retryRecordingAttemptIdentifier のみ）に供給源を持たないため、
  本スライスでは Non-goal に明示降格すること（dead CSS scaffold を残さない）。
  デザイン（finding-loop.html）は 3 チップを示すが、契約フィールドを持たないチップを描画しないこと
  （契約面を増やさず偽チップを置かない、という M-CRL-15 自身のルールに従う）。

- [ ] **M-CRL-16 (= legacy M-CRL-8 再回収・OPTION a: low_quality diagnosticPerPhonemeGop 貫通を本スライスで実装)**
  worker `AssessmentResponse`（Types.hs:567-598）に `responseDiagnosticPerPhonemeGop`
  （wire key `diagnosticPerPhonemeGop`）を追加すること。
  `analyzedPerPhonemeGop`（Assessment.hs:143/198）から **normal / low_quality の両分岐で常時 populate** すること
  （low_quality 分岐で空にしない）。
  既存 `responsePerPhonemeGop` heatmap は low_quality で `[]` のまま据え置くこと
  （ゲートを緩めていない証拠。Assessment.hs:180）。
  ゲート無効化フラグ / test-bypass を本番に入れないこと（agent-policy）。
  worker `ToJSON AssessmentResponse`（Types.hs:584-598）に `diagnosticPerPhonemeGop` を追加すること。
  retry route は retryGop の供給源を diagnostic GOP に切り替え、low_quality retry でも
  200 + gopDelta + `qualityStatus: 'low_quality'` を返すこと
  （422 は diagnostic GOP が空＝音素整列が完全失敗のときのみ）。
  worker unit test: low_quality 分岐で `diagnosticPerPhonemeGop` が非空（`analyzedPerPhonemeGop` 反映）であり、
  同時に `responsePerPhonemeGop` が `[]` のまま据え置かれることを assert すること。
  **stale spec テキストの是正（同一変更で実施）**: 本 spec から「M-CRL-8 は ADR-018 に延期 / ADR-018 が所有」の記述を
  全て除去し、所有を ADR-022・本スライス実装に是正すること。対象（修正前行番号）:
  ヘッダコメント `D12 延期`・`responseDiagnosticPerPhonemeGop 常時 populate は ADR-018 に延期`（旧:14/旧:21-22）、
  Must の M-CRL-8（旧:164-166）、acceptance の M-CRL-8（旧:280）、Non-goals の `M-CRL-8 deferred to ADR-018`（旧:314）。
  Goal の low_quality 延期記述（旧:61-63）も ADR-022 所有・本スライス実装に整合させること。

- [ ] **M-CRL-17 (scoring locus 維持 + しきい値 1 元化 + scoreImpact 不変 + コピー制約)**
  すべての再採点分類（`retrySeverity` / `deltaSignal` / `boundarySignal`）が worker で計算されること（ADR-004 locus）。
  frontend route handler / component に scoring しきい値リテラル
  （`-12.0` / `-8.0` / `gopMinorThreshold` / `gopMajorThreshold`）が漏れないこと（grep clean）。
  `gopSeverity`（Scoring.hs:1668-1672）と `gopToSeverity`（Scoring.hs:1353-1357）が**完全重複の同一関数**であるため、
  これを 1 関数に統一すること（`gopToSeverity` を共通参照とし `gopSeverity` をエイリアス/置換にする。
  M-CRL-11 の retrySeverity 計算とあわせ、severity しきい値の 3 重コピーを作らない）。
  `severityToScoreImpact`（Scoring.hs:1359-1363、Critical=-8.0 / Major=-5.0 / Minor=-2.0 / Suggestion=0.0）と
  `ScoreSet` 計算を変更しないこと（scoreImpact 不変。delta / 再採点表示は presentation のみ）。
  AFTER パネルの UI コピーを進捗トラッキングに限定し、「改善が加速」/ improvement-acceleration を謳わないこと（RISK-3）。

## Should (望ましいが必須でない)

- **S-CRL-1 (音素マッチング: 同一 IPA 複数出現の最近傍境界)**: retry per-phoneme GOP の対象音素選択で、
  単語内に同一 IPA が複数回出現する場合（例: "that" の /t/ 2 回）に
  `audioRange.startMilliseconds` に時間的に最も近い retry 音素境界を選ぶ実装とすること（D5）。
  単語スコープかつ対象音素 1 個の場合は index 0 を採れば足りる。
  forced-alignment の ±20ms 誤差で外れる残余リスクは許容する（Risks 参照）。

- **S-CRL-2 (AudioBuffer キャッシュ)**: デコード済み `AudioBuffer` を所見 identifier キーで
  component state にキャッシュし、同一所見の連続再生でフェッチが発生しないこと。
  所見切替（`finding.finding` 変更）でキャッシュを破棄すること。
  M-CRL-13 の retry blob も同様に所見切替までキャッシュしてよい。

- **S-CRL-3 (retry レイテンシ表示)**: `runAssessmentJob` ポーリング中（最大 30s）にローディング状態を
  ユーザーに示すスピナー / インジケータを表示すること。

## 受入条件 (acceptance — Must の確認方法)

> worker はバイナリ焼き込みのため `docker compose up -d --build worker` 後に runtime verify を行うこと
> (memory: docker-rebuild-required-for-code-changes)。
> M-CRL-11 / M-CRL-16 の `GopDeltaResponse` / `AssessmentResponse` フィールド追加は worker コード変更を伴うため
> rebuild 必須。rebuild 前の runtime verify は stale イメージで偽 green になる。

- **M-CRL-1** →
  `grep -n "latestRecordingAttemptIdentifier" applications/frontend/src/components/workspace/DetailPanelV2.tsx`
  でプロパティ定義・受け取り・onClick 内の使用の 3 箇所が存在すること。
  `grep -n "latestRecordingAttemptIdentifier" applications/frontend/src/components/workspace/WorkspaceResultV2.tsx`
  で `<DetailPanelV2>` への prop 渡しが存在すること。
  `grep -n "AudioContext\|decodeAudioData\|AudioBuffer\|AudioBufferSourceNode" applications/frontend/src/components/workspace/DetailPanelV2.tsx`
  でスライス再生の実装が確認できること。
  live 環境で所見の部分再生ボタンをクリックしたとき、`audioRange.startMilliseconds`〜`audioRange.endMilliseconds`
  の区間のみが再生されること（DevTools の Audio タブまたは手動聴取で確認）。

- **M-CRL-2** →
  `grep -n "自分の音\|お手本\|chip" applications/frontend/src/components/workspace/DetailPanelV2.tsx`
  で 2-chip トグルの実装が確認できること。
  `pnpm typecheck` 緑。live 環境で `自分の音` chip がセルフスライス、`お手本` chip が TTS 再生を行うこと。

- **M-CRL-3** →
  `grep -n "disabled" applications/frontend/src/components/workspace/ArticulationCard.tsx`
  で自分で試すボタンの `disabled` が条件付き（録音中のみ等）または除去されていること。
  `grep -n "finding: EngineFindingDto" applications/frontend/src/components/workspace/ArticulationCard.tsx`
  で Props 拡張が確認できること。
  `grep -n "MediaRecorder\|isRecording\|retryState" applications/frontend/src/components/workspace/ArticulationCard.tsx`
  で配線実装が確認できること。
  `pnpm test --run` で ArticulationCard 関連テストが緑。

- **M-CRL-4** →
  `ls applications/frontend/src/app/api/v1/findings/[findingIdentifier]/retry-recordings/route.ts`
  でファイルが存在すること。
  `grep -n "submitPracticeAttempt\|runAssessmentJob\|ensureFindingRetrySectionExists" applications/frontend/src/app/api/v1/findings/*/retry-recordings/route.ts`
  で 3 関数の使用が確認できること。
  `grep -n "progress_snapshot\|progress_snapshots" applications/frontend/src/app/api/v1/findings/*/retry-recordings/route.ts`
  で進捗スナップショットへの書き込みが 0 件であること。
  live worker が起動した状態で `curl -X POST http://localhost:3000/api/v1/findings/{実findingIdentifier}/retry-recordings`
  に multipart で実音声を投じ、200 と `RetryRecordingResponse` の JSON が返ること。

- **M-CRL-5** →
  `ls applications/frontend/src/infrastructure/training/finding-retry-section-fixture.ts`
  でファイルが存在すること。
  `grep -n "FINDING_RETRY_MATERIAL_SINGLETON\|ensureFindingRetrySectionExists" applications/frontend/src/infrastructure/training/finding-retry-section-fixture.ts`
  で定数と関数の export が確認できること。
  `grep -rn "FINDING_RETRY_MATERIAL_SINGLETON" applications/frontend/src/` |
  `grep -v "finding-retry-section-fixture.ts"` の結果が 0 件（fixture 外から参照されないこと）。
  `pnpm test --run` で fixture の idempotent 動作テストが緑。

- **M-CRL-6** →
  `grep -n "RetryRecordingResponse" applications/frontend/src/lib/api-types.ts`
  で `export type RetryRecordingResponse` が `EngineResultDto` の外部（兄弟 export）に存在すること。
  `pnpm typecheck` 緑。
  contract テストが first-slice 8 フィールドを assert し、
  `deltaSignal` が 3 値 / `boundarySignal` が 3 値 / `qualityStatus` が 2 値であることを型レベルで assert すること。
  AFTER パネルスライスの追加フィールド（`retrySeverity` / `retryConfidence` / `retryRecordingAttemptIdentifier`）の
  assert は M-CRL-11 / M-CRL-13 で行う。

- **M-CRL-7** →
  Haskell worker ユニットテスト（`cabal test all`）が以下を assert して緑であること:
  (a) `gopDelta > 5.0` で `improved`、`gopDelta < -2.0` で `regressed`、`-2.0 <= gopDelta <= 5.0` で `unchanged`。
  (b) `gop == -8` は minor ではない（strict `<`）、`gop == -12` は major ではない。
  (c) original=major(gop=-15) / retry=minor(gop=-10) → `crossedMajor`、
      original=minor(gop=-10) / retry=none(gop=-6) → `crossedMinor`、
      original=major / retry=major → `none`。
  fixture は負 GOP / phenomenon 文字列の実 worker 出力形で書くこと（unit-fixtures-must-mirror-real-worker-shape）。
  `grep -rn "\-8\|\-12\|gopMinorThreshold\|gopMajorThreshold" applications/frontend/src/`
  で scoring 判定として使われる数値が 0 件であること。

- **M-CRL-8** → M-CRL-16 を参照（所有 ADR-022・本スライス実装）。独立受入条件は M-CRL-16 に統合。

- **M-CRL-9** →
  `pnpm test --run` で ArticulationCard の retryState 表示テストが緑で、
  `GOP: X.X → Y.Y (+Z.Z)` または `(−Z.Z)` 形式の文字列が生成されること。
  `deltaSignal=improved` で緑 CSS class / `regressed` で赤 CSS class が適用されること。
  `grep -rn "改善.*加速\|improvement.*accelerat\|see.*improvement" applications/frontend/src/components/workspace/`
  が 0 件であること（コピー制約）。
  live 環境で実録音 → retry 後に `GOP: X.X → Y.Y` と delta 色分けが UI に表示されること。

- **M-CRL-10** →
  `bash scripts/verify-no-stub-placeholder.sh` が対象差分で緑
  (memory: verify-scripts-skip-untracked — staged / commit 後に確認)。
  `bash scripts/verify-wiring.sh` 緑。
  `pnpm fitness` (ast-grep + ESLint 層間依存) 緑。
  `.agent-evidence/closed-remediation-loop/` の 3 ファイルが存在し、
  `commands.txt` に retry-recordings の実行コマンドと観測した
  `gopDelta` / `deltaSignal` / `boundarySignal` / `qualityStatus` の実値が記録されていること。

### AFTER パネルスライスの受入条件

- **M-CRL-11** →
  `grep -n "gopDeltaResponseRetrySeverity\|gopDeltaResponseRetryConfidence\|retrySeverity\|retryConfidence" applications/backend/src/NativeTrace/Worker/Types.hs`
  で `GopDeltaResponse` の 2 フィールド定義と ToJSON への wire key 追加が存在すること。
  `grep -n "retrySeverity\|retryConfidence\|maybe 0.6 severityToConfidence" applications/backend/src/NativeTrace/Worker/Scoring.hs`
  で `classifyGopDelta` が両者を計算し、none→0.6 の `maybe` パターンが存在すること。
  `grep -n "retrySeverity\|retryConfidence" applications/frontend/src/acl/gop-delta/create-gop-delta-adaptor.ts`
  で zod schema が 5 フィールド（3 既存 + 2 追加）を検証すること。
  `grep -n "retrySeverity\|retryConfidence" applications/frontend/src/lib/api-types.ts`
  で `RetryRecordingResponse` に 2 フィールドが追加されていること（`retrySeverity` が 5 値 enum）。
  `grep -n "retrySeverity\|retryConfidence" applications/frontend/src/app/api/v1/findings/*/retry-recordings/route.ts`
  で `responseDto` が worker 値で埋められ、ハードコードでないこと。
  `grep -rn "\-12\.0\|\-8\.0\|gopMinorThreshold\|gopMajorThreshold" applications/frontend/src/`
  が scoring 判定として 0 件（frontend 非導出）。
  `cabal test all` 緑で、`gopToSeverity retryGop` 写像 + `Nothing→none→0.6` を assert すること。
  worker rebuild 後の live retry で `POST /api/v1/findings/{id}/retry-recordings` の 200 body に
  worker 由来の `retrySeverity` / `retryConfidence` が現れ、AFTER 列 severity バッジが描画されること
  （コンポーネントテスト + live）。

- **M-CRL-12** →
  `pnpm test --run` で AFTER 列が `finding.phenomenon` を複製描画し、`retryConfidence` から confidence
  インジケータを描画するテストが緑であること（phenomenon は props 由来、confidence は response 由来で
  ハードコード文字列でないことを assert）。
  `grep -rn "phenomenon" applications/frontend/src/components/workspace/ArticulationCard.tsx`
  で finding 由来 phenomenon の参照が存在し、ハードコード phenomenon 文字列が無いこと。

- **M-CRL-13** →
  `grep -n "retryRecordingAttemptIdentifier" applications/frontend/src/lib/api-types.ts`
  で `RetryRecordingResponse` に `retryRecordingAttemptIdentifier: string` が存在すること。
  `grep -n "retryRecordingAttemptIdentifier\|recordingAttemptIdentifier" applications/frontend/src/app/api/v1/findings/*/retry-recordings/route.ts`
  で route が永続化した retry RecordingAttempt 識別子を捕捉し responseDto に載せること。
  `grep -n "今回の録音\|recording-attempts/.*audio\|retryRecordingAttemptIdentifier" applications/frontend/src/components/workspace/DetailPanelV2.tsx`
  で所見スコープ A/B が retry ソースを加え、既存音声 Route Handler で blob を取得することが確認できること。
  live retry 後に A/B トグルで original / retry を切替再生でき、retry クリップが残ること（手動聴取 + DevTools）。
  `pnpm test --run` で synthetic section 隔離（実 Section score history に retry が現れない）の既存テストが緑のままであること。

- **M-CRL-14** →
  `grep -n "\.lp\|loop-steps\|聞く\|比べる\|出す\|測る" applications/frontend/src/components/workspace/ArticulationCard.tsx`
  で BEFORE/AFTER 二列グリッドと 4 ステップトラッカーの実描画が確認できること。
  `pnpm test --run` で state-1=original / state-2=post-retry の 2 状態と、AFTER 列に
  gopDelta / retrySeverity / phenomenon / confidence が出ることを assert するテストが緑であること。
  two-signal 注記（deltaSignal=magnitude / boundarySignal=boundary-crossing）が retryState 表示から
  到達可能な実描画点を持つこと（CSS-only でないことをテストが render-assert すること）。

- **M-CRL-15** →
  `grep -n "retryGop\|gopDelta\|echo" applications/frontend/src/components/workspace/ArticulationCard.tsx`
  で retry-GOP-echo チップが実フィールドから供給されることが確認できること。
  `grep -rn "retention\|NBest\|nBest" applications/frontend/src/components/workspace/ArticulationCard.tsx`
  で retention / post-retry NBest チップの CSS-only scaffold が存在しないこと（描画されないこと）。
  Non-goals に retention / post-retry NBest チップの明示降格が記載されていること（本 spec の Non-goals 参照）。

- **M-CRL-16** →
  `grep -n "responseDiagnosticPerPhonemeGop\|diagnosticPerPhonemeGop" applications/backend/src/NativeTrace/Worker/Types.hs`
  で `AssessmentResponse` のフィールド定義と ToJSON の wire key `diagnosticPerPhonemeGop` が存在すること。
  `grep -n "responseDiagnosticPerPhonemeGop\|diagnosticPerPhonemeGop\|analyzedPerPhonemeGop" applications/backend/src/NativeTrace/Worker/Assessment.hs`
  で normal / low_quality の両分岐が `analyzedPerPhonemeGop` から populate していることが確認できること
  （low_quality 分岐で `responseDiagnosticPerPhonemeGop` が空でないこと）。
  `grep -n "responsePerPhonemeGop = \[\]" applications/backend/src/NativeTrace/Worker/Assessment.hs`
  で heatmap が low_quality で `[]` のまま据え置かれること（ゲート不緩和の証拠）。
  本番に gate-disable / test-bypass フラグが無いこと（`bash scripts/verify-no-stub-placeholder.sh` 緑、
  `grep -rn "NODE_ENV === 'test'\|gate.*disable\|bypass" applications/` で retry 経路に 0 件）。
  `cabal test all` 緑で、low_quality 分岐の `diagnosticPerPhonemeGop` が非空 かつ `responsePerPhonemeGop` が `[]` で
  あることを同一テストで assert すること（実 worker 出力形 fixture、unit-fixtures-must-mirror-real-worker-shape）。
  worker rebuild 後の live: わざと低品質の単語録音（小声・短い）で `POST /api/v1/findings/{id}/retry-recordings` が
  **422 ではなく** 200 + `qualityStatus='low_quality'` + diagnostic GOP 由来の `gopDelta` を返すこと、
  かつ同録音の heatmap（responsePerPhonemeGop）が空のままであること（ADR Compliance line 154(d) と整合）。
  diagnostic GOP が空（音素整列の完全失敗）のときのみ 422 を返すこと。

- **M-CRL-17** →
  `grep -rn "\-12\.0\|\-8\.0\|gopMinorThreshold\|gopMajorThreshold" applications/frontend/src/`
  が scoring 判定として 0 件（frontend route handler / component にしきい値リテラル不在）。
  Scoring.hs に `gopSeverity` と `gopToSeverity` の 2 定義が残らないこと
  （`grep -n "^gopSeverity ::\|^gopToSeverity ::" applications/backend/src/NativeTrace/Worker/Scoring.hs`
  で severity しきい値判定関数が 1 つに統一されていること。`gopSeverity` がエイリアス/削除済み）。
  `git diff` で `severityToScoreImpact`（Scoring.hs:1359-1363）と ScoreSet 計算が無変更であること
  （`grep -n "severityToScoreImpact" applications/backend/src/NativeTrace/Worker/Scoring.hs`
  で Critical=-8.0 / Major=-5.0 / Minor=-2.0 / Suggestion=0.0 が不変）。
  `grep -rn "改善.*加速\|improvement.*accelerat\|see.*improvement\|加速" applications/frontend/src/components/workspace/`
  が 0 件（AFTER パネル含むコピー制約）。
  `cabal test all` 緑（しきい値統一後も既存 severity 判定テストが回帰しないこと）。

## Non-goals (今回やらない)

- **D8 ドリルへ → 遷移の配線**: `DetailPanelV2.tsx`(:369) の `ドリルへ →` ボタン配線（`catalogId !== null` 条件付き有効化 + Training Context drill 起動）は本スライス外。ボタンは `disabled` のまま据え置く。
- **D9 analysis_runs.kind 列追加**: `kind TEXT NOT NULL DEFAULT 'primary'` + CHECK 制約 migration は本スライス外。synthetic section 隔離のみで migration を回避する。
- **golden(RVC) A/B**: 所見スコープ A/B の golden chip（ADR-012）は本スライス外。self / model TTS + retry（M-CRL-13）の 3 ソースまで。
- **0-100 GOP 正規化**: worker 内部スケール（負の浮動小数）の 0-100 変換は本スライス外。delta / 再採点表示は worker 内部スケールのまま。
- **LLM ナラティブ（D11）**: retry 改善メッセージの LLM 個別化は別 ADR に委ねる。delta / 再採点表示は決定論的（worker 計算）で完結。
- **retention（✓/l/保持）チップ・post-retry NBest チップ（M-CRL-15 降格）**: ADR D14/D19 が追加する契約（`retrySeverity` / `retryConfidence` / `retryRecordingAttemptIdentifier`）に供給源を持たないため本スライスでは Non-goal に明示降格する。デザイン（finding-loop.html）は 3 チップを示すが、契約フィールドの無いチップを描画しない（「未定義の契約面を作らない」ため。供給源が確定するまで CSS scaffold も置かない）。本スライスで ship する drill-verdict チップは **retry-GOP-echo チップ 1 種のみ**。
- **追加 contract field**: 本スライスが導入する契約フィールドは `retrySeverity` / `retryConfidence` / `retryRecordingAttemptIdentifier`（frontend `RetryRecordingResponse` + worker `GopDeltaResponse`）と `responseDiagnosticPerPhonemeGop`（worker `AssessmentResponse`）のみ。`nBest` / `retryDetectedIpa` 等の追加レスポンスフィールドは導入しない。
- **ADR-018 音響診断 / ADR-019 AAI / ADR-020 catalog/diagram 深化 / ADR-021 LLM ナラティブ**: 本 ADR の後続 ADR の範囲外。**M-CRL-8（low_quality diagnosticPerPhonemeGop 貫通）は ADR-018 に延期しない**。所有は ADR-022 に戻し、M-CRL-16 として本スライスで実装する（ADR-018 D9 / First-slice relevance が本機能を「前提でも依存でもない」と明示し契約に入れないため）。
- **retry データの GC**: `FINDING_RETRY_MATERIAL_SINGLETON` 配下の RecordingAttempt / AnalysisRun / AssessmentResult / audio ファイルのクリーンアップ方針は別途定義。M-CRL-13 で retry クリップを保持するため蓄積は増える。
- **speakerSex UI**: 話者性別の UI 選択機能は対象外。
- **progress_snapshots への書き込み（ADR-008 禁止）**: retry の AssessmentResult を `progress_snapshots` に書くことは行わない。`task_kind` CHECK に `'finding_retry'` を追加しない。
- **本番コードへの test-double / gate-disable フラグ**: `NODE_ENV === 'test'` 分岐・low_quality gate bypass フラグ・stub 経路は一切追加しない（agent-policy）。M-CRL-16 の low_quality diagnostic GOP は gate-disable ではなく worker 契約フィールド追加で実現する。
- **drizzle schema 変更**: 本スライスは新テーブル・新カラムを追加しない。diagnostic GOP 経路は worker→route の in-memory pass-through で完結する想定（Risk の条件付きリスク参照）。

## Risk

- level: **high-risk**
- escalate_to_opus: **true**
- 理由（触れる境界領域）:
  - **Haskell worker 契約拡張（schema / public export）**: `GopDeltaResponse`（Types.hs）に `retrySeverity` / `retryConfidence`、
    `AssessmentResponse`（Types.hs）に `responseDiagnosticPerPhonemeGop` を追加する。ToJSON 両方に wire key 追加が必要。
    `-Werror=missing-fields` による未設定フィールドの build エラーリスクあり（両分岐で populate 必須）。
    per-edit hook が `cabal test` を実行するため subagent budget を消費しやすい
    (memory: haskell-per-edit-hook-burns-subagent-budget)。フィールド追加は Scoring/Types 既 exposed のため新規 module 配線は不要。
  - **新 low_quality route path（routing / auth 境界に隣接）**: M-CRL-16 で retry route の retryGop 供給源を
    diagnostic GOP に切り替え、low_quality でも 200 を返す新経路が生じる。422 は diagnostic GOP 空のときのみに縮退する。
    既存 422 経路（retryGop===null / ACL 例外）の振る舞いを壊さないこと。
  - **scoring locus 二重化リスク（ADR-004）**: frontend が `-8` / `-12` の threshold を再導出しないことを
    機械強制する fitness rule が現状存在しない（ADR Compliance 参照）。レビュー rubric（rubric/core/spec.md）+ grep ゲートで補う。
    `gopSeverity`↔`gopToSeverity` 統一を怠ると severity しきい値が 3 重コピーになる（M-CRL-17）。
  - **scoreImpact 不変の保証**: `severityToScoreImpact` / `ScoreSet` を誤って変更すると採点に波及する。
    delta / 再採点は presentation のみであり scoreImpact に影響しないことを git diff + テストで保証する（M-CRL-17）。
  - **DB 隔離の正確性（migration / schema）**: synthetic section が実 Section の history / score クエリに混入しないことは
    `FINDING_RETRY_MATERIAL_SINGLETON` が fixture 外から参照されないことに依存する。grep 確認が必須。
    **条件付きリスク**: diagnostic GOP 経路が永続化を要すると topology が証明した場合のみ drizzle schema 変更を検討する。
    それまでは in-memory pass-through を優先し、本スライスでは schema 変更を Must としない。
  - **ADR-008 compliance**: `progress_snapshots` への書き込みを行わないことを route handler のコードレビューと grep で確認（機械強制なし）。
  - **docker rebuild 必須**: worker コード変更後（`GopDeltaResponse` / `AssessmentResponse` フィールド追加）は
    `docker compose up -d --build worker` が必要。rebuild 前の runtime verify は stale イメージで偽 green になる
    (memory: docker-rebuild-required-for-code-changes)。
  - **stale spec / ADR 所有の整合**: M-CRL-8 の所有を ADR-018 から ADR-022 に戻す是正を本 spec・本 ADR で同時に行う。
    1 要件に 2 番号（M-CRL-8 / M-CRL-16）を残さないこと、ADR-018 を所有 ADR と誤指定しないことを確認する。

## Open questions

なし。ADR-022 D1〜D7（first slice landed）+ D13-D19 追補（AFTER パネルスライス、M-CRL-11〜17）+
After-panel scoping amendment (2026-06-19) が全て確定しており、未確定点は存在しない。
calibratable な暫定値（open question ではなく PIN 済みデフォルト）:
- `deltaSignal` の `+5` / `-2` 閾値は ADR-022 D6 にて calibratable な暫定値と明記済み。
- `retryConfidence` の `retrySeverity = none` ケースは `severityToConfidence` に none 定義が無いため
  **PIN: none → 0.6**（最下位 tier の再利用、`maybe 0.6 severityToConfidence (gopToSeverity retryGop)`）。
  新リテラルを発明せず既存最下位値を使う。+5/-2 と同様 calibratable とする。
- M-CRL-15 の retention / post-retry NBest チップは Non-goal に降格（PIN 済み。供給源が無いため）。
