# Spec: closed-remediation-loop

<!-- 設計の正 / 背景:
       adr/022-closed-remediation-improvement-measurement-loop.md (Proposed, 2026-06-18)
         D1: 部分再生 — Web Audio decodeAudioData + AudioBuffer スライス
         D2: 所見スコープ A/B 2-chip (self / model TTS)
         D3: ArticulationCard 自分で試す — MediaRecorder 配線、Props に finding 追加
         D4: POST /api/v1/findings/[findingIdentifier]/retry-recordings 新 Route Handler
             per-finding synthetic single-word section 永続化・実 Section history 隔離
         D5: 音素マッチング — IPA 文字列 + audioRange.startMs 最近傍
         D6: worker が gopDelta + deltaSignal + boundarySignal を計算 (ADR-004 scoring locus)
             [維持] 正常 retry の per-phoneme GOP と finding.gop (originalGop) から計算する
         D7: RetryRecordingResponse 8 フィールド・3 enum 契約
         D12: [延期] worker diagnosticPerPhonemeGop 常時 populate は ADR-018 実装時に延期。
              first slice では low_quality retry → 422 + 再録音プロンプトを返す。
              正常 retry の retryGop は retry AssessmentResult の既存 per-phoneme GOP
              (responsePerPhonemeGop heatmap) から取得する（新規 diagnostic フィールド追加なし）。
     First-slice scoping amendment (2026-06-18):
       first slice は正常録音の閉ループ（部分再生 + A/B + 再録音 + 正常 retry の GOP delta）に限定。
       low_quality な再録音は 422 + 再録音プロンプトを返す（gopDelta は normal retry のみ）。
       responseDiagnosticPerPhonemeGop の常時 populate（Types.hs/Assessment.hs 両分岐）は
       ADR-018（acoustic-phonetic diagnosis）実装時に延期する（M-CRL-8 deferred）。
     dead affordance の現状:
       DetailPanelV2.tsx:396 — audioRange ボタンに onClick なし
       DetailPanelV2.tsx:369 — ドリルへ → が always disabled (D8、first slice 外)
       ArticulationCard.tsx:144-154 — 自分で試す録音ボタンが disabled
       WorkspaceResultV2.tsx:514 — <DetailPanelV2> に latestRecordingAttemptIdentifier を渡していない
     worker 現状:
       Assessment.hs:169-180 — low_quality 分岐で responsePerPhonemeGop = [] に設定
       Assessment.hs:143/198 — analyzedPerPhonemeGop は gate 判定前に存在する
       Types.hs:473-504 — AssessmentResponse に responseDiagnosticPerPhonemeGop フィールド未存在
                          (first slice では追加しない — ADR-018 に延期)
       Scoring.hs:116-121 — gopMajorThreshold=-12.0 / gopMinorThreshold=-8.0 確定値
       Scoring.hs:961-962 — gop < gopMajorThreshold / gop < gopMinorThreshold (strict <)
     配線点 (agent-policy):
       frontend: App Router ファイル配置 (app/api/v1/findings/[findingIdentifier]/retry-recordings/route.ts)
       frontend: DetailPanelV2Props に latestRecordingAttemptIdentifier 追加
       frontend: ArticulationCardProps を entry+finding に拡張
       frontend: api-types.ts に RetryRecordingResponse を export type 追加 (EngineResultDto の兄弟)
       frontend: infrastructure/training/finding-retry-section-fixture.ts 新規
       Haskell: Scoring.hs または新モジュールに gopDelta/deltaSignal/boundarySignal 計算関数追加
                (推奨: POST /v1/gop-delta エンドポイント、Api.hs WorkerApi + Application.hs handler
                 + cabal exposed-modules で配線。代替: retry assessment request/response を拡張しても
                 可だが分類は必ず worker に閉じること)
       Haskell: Types.hs/Assessment.hs への responseDiagnosticPerPhonemeGop 追加は first slice では行わない
     強制レイヤ: scripts/verify-no-stub-placeholder.sh / verify-wiring.sh + fitness hook + CI
     rebuild 注意: worker はバイナリ焼き込み (memory: docker-rebuild-required-for-code-changes)。
       /v1/gop-delta エンドポイントの追加は Api.hs 配線変更を伴うため runtime verify 前に
       `docker compose up -d --build worker` が必須。
     ADR-008 制約: progress_snapshots.task_kind CHECK は 'rereading'/'drill' のみ。
       retry の AssessmentResult は progress_snapshots に書かない。synthetic section 配下の
       assessment_results/analysis_runs 永続化は ADR-008 の制約外。 -->

## Goal

- 所見（finding）詳細パネルの dead affordance 4 つ（部分再生・自分で試す・GOP delta 表示・verify loop）を
  real entrypoint から到達可能・観測可能挙動を持つ形で配線し、
  「聞く → 比べる → 出す → 測る」の閉ループを所見単位で成立させる（FIRST SLICE）。
- GOP デルタ（before → after）と改善信号（deltaSignal / boundarySignal）を worker が計算して返し、
  frontend は presentation のみ担う（ADR-004 scoring locus 維持）。
- low_quality な再録音は本スライスでは GOP デルタを返さず既存の再録音プロンプトを返す。
  low_quality の delta は ADR-018（acoustic-phonetic diagnosis の diagnosticPerPhonemeGop 貫通）
  実装時に延期する。

## Must (満たさなければ done でない)

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
  `api-types.ts` の `EngineResultDto`(:263) の下（兄弟 export）に以下の型を追加すること。
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
  `qualityStatus` は 200 レスポンスでは常に `'normal'`（forward-compat with ADR-018）。

- [ ] **M-CRL-7 (worker: gopDelta + deltaSignal + boundarySignal 計算)**
  `Scoring.hs` の `gopMajorThreshold=-12.0` / `gopMinorThreshold=-8.0`（:116-121）を
  strict `<` 演算子で使い、以下のロジックを worker 側に実装すること（frontend では計算しない）:
  - `gopDelta = retryGop - originalGop`（負の浮動小数の差分、worker 内部スケール）。
  - `deltaSignal`: `gopDelta > +5` → `improved` / `gopDelta < -2` → `regressed` / その他 → `unchanged`。
  - `boundarySignal`: original/retry それぞれの severity を `gop < gopMinorThreshold` /
    `gop < gopMajorThreshold` で判定（strict `<`、`gop == -8` は minor ではない、`gop == -12` は major ではない）。
    `major → (minor or none)` を `crossedMajor`、`(major or minor) → none` を `crossedMinor`、
    跨ぎなしを `none` とすること。両 signal は別フィールドで同時表示できること。
  route は normal retry AssessmentResult の per-phoneme GOP を retryGop として、finding の gop（finding.gop）を
  originalGop として worker に渡すこと。
  推奨実装: `POST /v1/gop-delta`（`{ originalGop: number, retryGop: number }` を受け
  `{ gopDelta, deltaSignal, boundarySignal, originalSeverity?, retrySeverity? }` を返す）を
  Api.hs の `WorkerApi` 型 + `Application.hs` の handler + cabal exposed-modules で配線すること。
  代替として retry assessment の request/response を拡張することも可だが、
  分類ロジックは必ず worker（Scoring.hs）に閉じること。
  retry-baseline を非 retry 側の assessment 挙動に漏らしてはならない（isolation 維持）。
  frontend は `deltaSignal` / `boundarySignal` の値を受け取るだけで threshold を再導出してはならない。
  frontend コードに `-8` / `-12` / `gopMinorThreshold` / `gopMajorThreshold` 相当の数値リテラルが
  scoring 判定として現れないこと。

- [ ] **M-CRL-8 (deferred — ADR-018 に延期)**
  ~~worker: diagnosticPerPhonemeGop 常時フィールド追加~~ — このスライスでは実施しない。
  （詳細は Non-goals 参照）

- [ ] **M-CRL-9 (UI 表示: GOP デルタ + signal)**
  `ArticulationCard`（および `DetailPanelV2` の retryState 表示箇所）が以下を満たすこと:
  - `GOP: {originalGop.toFixed(1)} → {retryGop.toFixed(1)} ({gopDelta >= 0 ? '+' : ''}{gopDelta.toFixed(1)})` を表示すること。
  - `deltaSignal === 'improved'` を緑、`'regressed'` を赤で表示すること。
  - `boundarySignal === 'crossedMinor'` のとき「minor を脱しました」、
    `'crossedMajor'` のとき「major を脱しました」を表示すること（deltaSignal と同時表示可）。
  - UI コピーに「改善が加速」「improvement-acceleration」に相当する文言を含めないこと。
    「進捗トラッキング」相当の表現に限定すること（RISK-3）。
  `qualityStatus` フィールドは `RetryRecordingResponse` に保持するが（ADR-018 との forward-compat）、
  first slice では 200 レスポンス時の `qualityStatus` は常に `'normal'` であり
  低品質注記の表示ロジックは追加しないこと（low_quality は 422 で処理されるため表示されない）。

- [ ] **M-CRL-10 (agent-policy: 本番に偽値なし + 証跡)**
  本番コードに mock / stub / fake / dummy / spy / test-bypass / placeholder stub を入れないこと
  (`scripts/verify-no-stub-placeholder.sh` / `verify-wiring.sh` 緑)。
  retry route と再録音ボタンが real public entrypoint（App Router ファイル配置 +
  DetailPanelV2/ArticulationCard 経由）から到達可能であること。
  retry は synthetic section 配下に実 engine を呼んで永続化すること（mock 不可）。
  `.agent-evidence/closed-remediation-loop/commands.txt` /
  `.agent-evidence/closed-remediation-loop/wiring-map.json` /
  `.agent-evidence/closed-remediation-loop/completion-report.md` を提出すること。

## Should (望ましいが必須でない)

- **S-CRL-1 (音素マッチング: 同一 IPA 複数出現の最近傍境界)**: retry per-phoneme GOP の対象音素選択で、
  単語内に同一 IPA が複数回出現する場合（例: "that" の /t/ 2 回）に
  `audioRange.startMilliseconds` に時間的に最も近い retry 音素境界を選ぶ実装とすること（D5）。
  単語スコープかつ対象音素 1 個の場合は index 0 を採れば足りる。
  forced-alignment の ±20ms 誤差で外れる残余リスクは許容する（Risks 参照）。

- **S-CRL-2 (AudioBuffer キャッシュ)**: デコード済み `AudioBuffer` を所見 identifier キーで
  component state にキャッシュし、同一所見の連続再生でフェッチが発生しないこと。
  所見切替（`finding.finding` 変更）でキャッシュを破棄すること。

- **S-CRL-3 (retry レイテンシ表示)**: `runAssessmentJob` ポーリング中（最大 30s）にローディング状態を
  ユーザーに示すスピナー / インジケータを表示すること。

## 受入条件 (acceptance — Must の確認方法)

> worker はバイナリ焼き込みのため `docker compose up -d --build worker` 後に runtime verify を行うこと
> (memory: docker-rebuild-required-for-code-changes)。
> /v1/gop-delta エンドポイントの追加は Api.hs 配線変更を伴うため rebuild が必須。

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
  低品質な単語録音（小声・短い）では 422 と再録音プロンプトを返すこと（gopDelta は normal retry のみ）。

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
  contract テストが `findingIdentifier / phoneme / originalGop / retryGop / gopDelta /
  deltaSignal / boundarySignal / qualityStatus` の 8 フィールドを assert し、
  `deltaSignal` が `'improved' | 'unchanged' | 'regressed'` の 3 値、
  `boundarySignal` が `'crossedMajor' | 'crossedMinor' | 'none'` の 3 値、
  `qualityStatus` が `'normal' | 'low_quality'` の 2 値であることを型レベルで assert すること
  (型のみでよく、runtime assert でもよい)。

- **M-CRL-7** →
  Haskell worker ユニットテスト（`cabal test all`）が以下を assert して緑であること:
  (a) `gopDelta > 5.0` のとき `deltaSignal = improved`、
      `gopDelta < -2.0` のとき `deltaSignal = regressed`、
      `-2.0 <= gopDelta <= 5.0` のとき `deltaSignal = unchanged`。
  (b) `gop == -8` は minor ではない（strict `<` 確認）、`gop == -12` は major ではない。
  (c) original=major(gop=-15) / retry=minor(gop=-10) → `boundarySignal = crossedMajor`。
      original=minor(gop=-10) / retry=none(gop=-6) → `boundarySignal = crossedMinor`。
      original=major / retry=major → `boundarySignal = none`。
  fixture は負 GOP / phenomenon 文字列の実 worker 出力形で書くこと（unit-fixtures-must-mirror-real-worker-shape）。
  対象テスト対象は `/v1/gop-delta` エンドポイントの分類関数（または同等の retry assessment 拡張）とすること。
  `grep -rn "\-8\|\-12\|gopMinorThreshold\|gopMajorThreshold" applications/frontend/src/`
  で scoring 判定として使われる数値が 0 件であること（frontend に漏れていないこと）。

- **M-CRL-8** → deferred。受入条件なし（このスライスでは実施しない）。

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
  `commands.txt` に `POST /api/v1/findings/{id}/retry-recordings` の実行コマンドと
  観測した `gopDelta` / `deltaSignal` / `boundarySignal` / `qualityStatus` の実値が記録されていること。
  `wiring-map.json` に `ArticulationCard(MediaRecorder) → retry-recordings/route.ts →
  ensureFindingRetrySectionExists → submitPracticeAttempt → runAssessmentJob →
  responsePerPhonemeGop(normal) → worker:/v1/gop-delta → RetryRecordingResponse → ArticulationCard(retryState)` の経路が記述されること。

## Non-goals (今回やらない)

- **D8 ドリルへ → 遷移の配線**: `DetailPanelV2.tsx`(:369) の `ドリルへ →` ボタン配線（`catalogId !== null` 条件付き有効化 + Training Context drill 起動）は first slice 外。ボタンは `disabled` のまま据え置く。
- **D9 analysis_runs.kind 列追加**: `kind TEXT NOT NULL DEFAULT 'primary'` + CHECK 制約 migration は first slice 外。first slice は synthetic section 隔離のみで migration を回避する。
- **golden(RVC) A/B**: 所見スコープ A/B の golden chip（ADR-012）は first slice 外。self / model TTS の 2 chip のみ。
- **0-100 GOP 正規化**: worker 内部スケール（負の浮動小数）の 0-100 変換は first slice 外。delta 表示は worker 内部スケールのまま。
- **LLM ナラティブ（D11）**: retry 改善メッセージの LLM 個別化は別 ADR に委ねる。delta 表示は決定論的（worker 計算）で完結。
- **ADR-018 音響診断 / ADR-019 AAI / ADR-020 catalog/diagram 深化 / ADR-021 LLM ナラティブ**: 本 ADR の依存先・後続 ADR の範囲外。
- **retry データの GC**: `FINDING_RETRY_MATERIAL_SINGLETON` 配下の RecordingAttempt / AnalysisRun / AssessmentResult / audio ファイルのクリーンアップ方針は別途定義。
- **speakerSex UI**: 話者性別の UI 選択機能は対象外。
- **progress_snapshots への書き込み（ADR-008 禁止）**: retry の AssessmentResult を `progress_snapshots` に書くことは行わない。`task_kind` CHECK に `'finding_retry'` を追加しない。
- **本番コードへの test-double / gate-disable フラグ**: `NODE_ENV === 'test'` 分岐・low_quality gate bypass フラグ・stub 経路は一切追加しない（agent-policy）。
- **M-CRL-8 deferred to ADR-018**: worker の `responseDiagnosticPerPhonemeGop` 常時 populate フィールド（`Types.hs` / `Assessment.hs` 両分岐への追加）は本スライスでは実施しない。このフィールドは low_quality retry で gopDelta を返すためのみ必要だが、low_quality retry 自体が本スライスから除外されたため延期する。正常 retry の delta は既存の `responsePerPhonemeGop`（heatmap）から取得するため新規診断フィールドは不要。実装時期は ADR-018（acoustic-phonetic diagnosis の diagnosticPerPhonemeGop 貫通）に従う。

## Risk

- level: **high-risk**
- escalate_to_opus: **true**
- 理由（触れる境界領域）:
  - **Haskell worker 新エンドポイント**: `POST /v1/gop-delta`（推奨）または retry assessment レスポンス拡張で
    gopDelta/deltaSignal/boundarySignal 計算関数を Scoring.hs 配下に追加する。
    Api.hs `WorkerApi` 型 + Application.hs handler + cabal exposed-modules の配線が必要。
    per-edit hook が `cabal test` を実行するためsubagent budget を消費しやすい
    (memory: haskell-per-edit-hook-burns-subagent-budget)。
    `-Werror=missing-fields` による未設定フィールドの build エラーリスクあり。
    `responseDiagnosticPerPhonemeGop` フィールドは追加しないため Types.hs/Assessment.hs の
    両分岐 populate リスクはこのスライスでは発生しない（ADR-018 に延期）。
  - **新規公開 Route Handler**: `POST /api/v1/findings/[findingIdentifier]/retry-recordings` が
    新設される public entrypoint。multipart / バリデーション / 30s ポーリング / 422 ハンドリングを
    全て実装する必要がある。low_quality 時は 422 を返し delta は計算しない。
  - **DB 隔離の正確性**: synthetic section が実 Section の workspace history / score history クエリに
    混入しないことは `FINDING_RETRY_MATERIAL_SINGLETON` が fixture 外から参照されないことに依存する。
    grep による確認が必須。
  - **ADR-004 scoring locus**: frontend が `-8` / `-12` の threshold を再導出しないことを
    機械強制する fitness rule が現状存在しない（Compliance 参照）。レビュー rubric でのコードレビュー
    + grep ゲートで補う必要がある。
  - **ADR-008 compliance**: `progress_snapshots` への書き込みを行わないことは
    route handler のコードレビューと grep で確認する（機械強制なし）。
  - **docker rebuild 必須**: worker コード変更後（/v1/gop-delta エンドポイント追加含む）は
    `docker compose up -d --build worker` が必要。
    rebuild 前の runtime verify は stale イメージで偽 green になる
    (memory: docker-rebuild-required-for-code-changes)。
  - **low_quality スコープ除外の整合性**: low_quality retry が 422 を返すことで
    `RetryRecordingResponse.qualityStatus='low_quality'` の 200 ケースは first slice では
    発生しない。ADR-018 実装時に retryGop 取得を responsePerPhonemeGop から
    diagnosticPerPhonemeGop に切り替える差分が生じる（設計上の継ぎ目）。

## Open questions

なし。ADR-022 D1〜D7（D12 は延期確定）および First-slice scoping amendment (2026-06-18) が
全て確定しており、未確定点は存在しない。
`+5` / `-2` の `deltaSignal` 閾値は ADR-022 にて "calibratable な暫定値" と明記されており、
first slice は暫定値で実装を開始することが D6 に明示されている。
