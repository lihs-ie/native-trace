# Closed remediation and improvement-measurement loop at the finding level

ADR-022: 所見単位の閉じた是正ループ（部分再生・その場再録音・GOP デルタ表示・ドリル遷移）

# Status

Proposed

# Context

## 背景

現状、所見（finding）詳細パネルには是正の手前で止まっている dead affordance が並ぶ。実機・コードで確認した死配線は4つ:

- **部分再生ボタン**: `applications/frontend/src/components/workspace/DetailPanelV2.tsx`(:396-403) は `finding.audioRange` を表示するが `onClick` が無い。`audioRange{startMilliseconds,endMilliseconds}` は `EngineFindingDto`(api-types.ts:241) に既に届いている。
- **自分で試す録音ボタン**: `ArticulationCard.tsx`(:144-154) は `disabled`。コメント `S-ARTIC-REC: UI のみ配置、実配線は別スライス` 明記。現状の Props は `entry: ArticulationEntry` のみ（ArticulationCard.tsx:6-8）で `finding` を受け取らない。
- **ドリルへ → ボタン**: `DetailPanelV2.tsx`(:369-371) は `disabled`。
- **再録音→再採点→改善表示（verify loop）**: 存在しない。

一方、これらを配線する基盤は既に揃っている（コードで確認済み）:

- HTTP Range（206 partial）対応の録音音声 Route Handler が稼働（`app/api/v1/recording-attempts/[recordingAttemptIdentifier]/audio/route.ts`:53-103、`parseRangeHeader`）。`WorkspaceResultV2.tsx`(:34) は `latestRecordingAttemptIdentifier` を既にプロパティで保持。
- 単語スコープ再採点の実証パターンが既存: `app/api/v1/training/drills/[trainingSessionIdentifier]/attempts/route.ts` が `exampleSentence`（=単一単語 referenceText）で音声を投げ、`submitPracticeAttempt`→`runAssessmentJob` ポーリング（`ANALYSIS_POLL_MAX_WAIT_MS=30000`, route.ts:66）で `AssessmentResult` を取得し、対象音素 GOP を取り出す。worker `/v1/pronunciation-assessments` の `sectionBodyText` は free-text で語数制約なし（`Application.hs`、python-analyzer `schema.py:13`）。
- 改善デルタの「before 値」は `EngineFindingDto.gop`(api-types.ts:237) に既存。所見ごとの GOP が所見オブジェクト自体に載っている。

## 永続化と隔離の事実確認（verifier 指摘の是正）

初版は retry を「ephemeral（DB 書込なし）」と称しつつ D4 で `submitPracticeAttempt` 再利用を指定しており矛盾していた。コードで確認した事実:

- `submitPracticeAttempt`(usecase/submit-practice-attempt/index.ts) は **RecordingAttempt + AnalysisRun を永続化**し、`runAssessmentJob` は **AssessmentResult を永続化**する。drill route(:254-301) も全てを書き込む。よって `submitPracticeAttempt` を通す経路は ephemeral ではない。
- drill route の history 隔離は **synthetic singleton Section**（`drill-section-fixture.ts`: `DRILL_MATERIAL_SINGLETON`/`DRILL_SECTION_*`）に attach することで成立しており、ephemerality でも `analysis_runs.kind` 列でもない。`DRILL_MATERIAL_SINGLETON` は fixture 以外から参照されず（repo grep で確認）、workspace の score/最新結果クエリは実 Section 単位でスコープされるため、synthetic section 配下の attempt は実 Section の history に現れない。

→ 本 ADR は **隔離方式(b): retry を per-finding synthetic single-word section 配下に永続化する**（drill route と同型）を採る。「ephemeral / DB 書込なし」の文言を全廃し、隔離根拠を synthetic section に置く。ADR-008 への適合は「progress_snapshots を書かないこと」のみで足り、assessment_results/analysis_runs を synthetic section 配下に書くこと自体は ADR-008 に違反しない（ADR-008 は progress_snapshots の task_kind のみ制約）。

## low_quality 時に GOP が消える問題（first slice の核心制約）

`Assessment.hs:169-180` で確認: `checkAudioQuality` が true（meanDbfs<-36 / duration<1000ms / 音素検出率<0.25 / median GOP<-18 のいずれか、Scoring.hs:140-171）のとき、worker は `AssessmentStatusLowQuality` を返し **`responsePerPhonemeGop = []`** にする。単語1個の難所を初めて再録音する場面は median GOP が最悪になりやすく、verify loop が最も必要とする録音で per-phoneme GOP が空になり `gopDelta` が計算不能になる。これは fringe risk ではなく retry のコアユースケースを直撃する。

ただし worker は gate 判定の **前に** raw GOP を持っている（`Assessment.hs:143` `gopValues = map gopValue (analyzedPerPhonemeGop analyzerResult)`、:198 `phonemeGops`）。gate は単に破棄しているだけ。本 ADR は **gate を緩める/bypass する production フラグを入れない**（agent-policy 違反になる）。代わりに、品質ステータスに関わらず常に raw 測定値を運ぶ診断フィールドを worker 契約に追加する（D12）。scoring/findings/score は従来どおり low_quality を尊重し 0 のまま。delta 用の raw 測定値だけを貫通させる。

## ユーザー確定事項（grill ロック）

verify loop を first-class 要件にする（修正案内→同一ターゲット再録音→GOP/メトリクス delta→「改善 X→Y」表示）。本 ADR の FIRST SLICE は「A/B 部分再生 + その場再録音 → GOP デルタ表示」の閉じた最小増分。

## 制約

- **ADR-008**: `progress_snapshots` の CHECK 制約は `task_kind IN ('rereading','drill')`（database-design.md:845 / schema.ts:408 で確認）。本 ADR は retry の AssessmentResult を **progress_snapshots に書かない**ことだけで ADR-008 に適合する。assessment_results / analysis_runs を synthetic section 配下に書くことは ADR-008 の制約外。
- **ADR-004**: scoring policy（GOP しきい値→severity 写像を含む）は worker 所有。retry の改善判定（minor/major 境界跨ぎ分類）も worker 由来のしきい値に依存するため、**境界跨ぎ分類は worker が計算し、frontend は presentation のみ**とする（D6/D7、verifier 指摘 ADR-004 の是正）。
- **ADR-007**: PPC Context と Training Context の分離。retry は PPC（workspace）の関心であり、ドリルへの遷移は Training Context への明示的な橋渡しとして扱う（drill route の流用ではなく遷移）。
- **agent-policy**: 本番に stub/test-double/test-bypass を入れない、wire-first、real entrypoint から到達可能であること。low_quality 時の GOP 取得は gate-disable フラグではなく worker 契約の常時診断フィールドで解決する（D12）。

## 教育学的根拠（証跡 §SLA/CAPT）

「改善を見せると学習を助ける」は**直接的な効果量証拠が薄い**。retest-loop 自体を独立変数として測った発音 CAPT の RCT は存在せず（証跡 §3.3 immediate feedback / E-15 設計仮定）、支持は自己決定理論（competence need）・スキル習得理論（feedback-as-reinforcement）・即時 corrective feedback が標準である CAPT 設計パターン（Frontiers 2023, PMC9995700）からの間接推論にとどまる。一方、即時・具体的・誤り説明つき corrective feedback は g=0.86（transcription-only g=0.50, Ngo/Chen/Lai 2024, E-5）と効果が確立している。本 ADR は **delta 表示を「進捗トラッキング」として位置づけ、「改善が加速する」とは謳わない**（証跡 RISK-3 / 推奨「track your progress not see improvement accelerate」）。massed repetition + 即時フィードバックが音素獲得の中核条件という Barcroft (2003) が retry ループの教育的価値を支える。

# Decision

**D1 — 部分再生を Web Audio API スライスで配線する（first slice）。** `DetailPanelV2` に `latestRecordingAttemptIdentifier: string | null` を新プロパティで渡す（`WorkspaceResultV2.tsx` は既に保持、:34）。`audioRange` ボタンの `onClick` で `GET /api/v1/recording-attempts/{latestRecordingAttemptIdentifier}/audio`（Range なし=200 全体）からフル blob を取得し、`AudioContext.decodeAudioData` でデコードし、`[startMilliseconds/1000, endMilliseconds/1000]` 区間を新 `AudioBuffer` にスライスして `AudioBufferSourceNode` で再生する。バイトオフセット近似は使わない（VBR で境界ずれ）。デコード済 `AudioBuffer` は所見切替まで component state にキャッシュする。

**D2 — 所見スコープの A/B（自分 vs お手本 TTS）を部分再生ボタンの隣に置く。** お手本側は既存 `handlePlayTts`（`DetailPanelV2.tsx`:99、`POST /api/v1/tts` に `finding.expected.text`）を再利用。2-chip トグル `自分の音`（D1 のセルフスライス）/ `お手本`（TTS）を新設する。これは WorkspaceResultV2 dock の録音全体 A/B（self/model/golden）とは別の、所見スコープ A/B。golden(RVC, ADR-012) は first slice では non-goal（self / model TTS のみ）。

**D3 — その場再録音を `ArticulationCard` の `自分で試す` ボタンで配線する（first slice）。** `ArticulationCard.tsx`(:144-154) の `disabled` を外し、`page.tsx` の `startRecording`/`stopRecording` と同一の `MediaRecorder` フローを移植する（`isRecording`/`blob`/`mimeType` を component local state に保持、プロップドリル不要）。録音停止後 D4 のルートへ POST する。`finding.expected.text`（無ければ `finding.detected.text`）を再録音ターゲット語とする。これに伴い ArticulationCard の Props を `entry: ArticulationEntry` から `entry: ArticulationEntry; finding: EngineFindingDto` に拡張する（再録音ターゲット語/音素/audioRange.startMilliseconds を渡すため）。

**D4 — 単語スコープの再採点ルートを新設する（first slice、synthetic section 永続化・実 Section history から隔離）。** `POST /api/v1/findings/{findingIdentifier}/retry-recordings` を `drills/[trainingSessionIdentifier]/attempts/route.ts` と同一パターンで実装する。multipart で `audio`(File) / `recordedDurationMs`(positive int) / `referenceText`(= finding.expected.text) / `expectedPhonemeIpa`(= finding.expected.ipa) / `expectedAudioRangeStartMs`(= finding.audioRange.startMilliseconds, 音素整列の disambiguation 用) を受ける。内部で **per-finding synthetic single-word section fixture**（`drill-section-fixture.ts` 同型の `ensureFindingRetrySectionExists`、`FINDING_RETRY_MATERIAL_SINGLETON` 配下、key = findingIdentifier ベース）を ensure し、`submitPracticeAttempt`(synthetic section, mode=`oss_worker_only`) → `runAssessmentJob` を 30s timeout でポーリングし、得られた `AssessmentResult` から retry GOP を取る。**この経路は RecordingAttempt + AnalysisRun + AssessmentResult を永続化するが、synthetic section 配下なので実 Section の workspace history / score history には現れない**（drill singleton と同じ隔離機構、Context「永続化と隔離」参照）。**progress_snapshot は書かない（ADR-008）。** レスポンスは worker が計算した `RetryRecordingResponse`（D7）。「ephemeral / DB 書込なし」とは謳わない。

**D5 — 音素マッチングは IPA 文字列 + 位置 index で行う。** retry の per-phoneme GOP は phoneme IPA 文字列キー。同一 IPA が単語内に複数回出る場合（"that" の /t/ 2回）に備え、original finding の `audioRange.startMilliseconds` に時間的に最も近い retry 音素境界を選ぶ。retry は単一単語スコープなので、対象音素が1個なら index 0 を採る。forced-alignment（wav2vec2, ~20ms 粒度）の境界誤差で複数同一 IPA 時にずれる残余リスクは risks に明記。

**D6 — GOP デルタと「improved」判定は worker が計算する（scoring locus を ADR-004 に従い worker に残す）。** delta の連続量と境界跨ぎの離散量を **worker が Scoring.hs のしきい値で計算**し、frontend は worker が返した signal で表示分岐する。worker 側ロジック（retry 採点ハンドラに置く。Scoring.hs:116-121 の `gopMajorThreshold=-12`/`gopMinorThreshold=-8` と `gop < threshold` の **strict <** をそのまま使う）:
- `gopDelta = retryGop - originalGop`（worker 内部スケール、負の浮動小数の差分）。
- **deltaSignal（連続量）**: `gopDelta > +5` → `improved`、`gopDelta < -2` → `regressed`、その他 → `unchanged`（しきい値 +5 / -2 は calibratable）。
- **boundarySignal（境界跨ぎ・離散量）**: original の severity と retry の severity を Scoring.hs と同一の `gop < gopMinorThreshold`(=`gop < -8`) / `gop < gopMajorThreshold`(=`gop < -12`) で求め、`major→(minor or none)` を `crossedMajor`、`(major or minor)→none` で minor 境界を脱したら `crossedMinor`、跨ぎなしを `none` とする。**`gop == -8` は minor ではない**（strict `<`、Scoring.hs:962 準拠。初版の `gop <= -8` は誤りで修正）。

frontend は `DetailPanelV2`/`ArticulationCard` に `gopDelta` state を持ち、`GOP: {originalGop.toFixed(1)} → {retryGop.toFixed(1)} ({gopDelta >= 0 ? '+' : ''}{gopDelta.toFixed(1)})` を表示し、`deltaSignal==='improved'` を緑、`'regressed'` を赤で、`boundarySignal` が `crossedMinor`/`crossedMajor` のとき「minor を脱しました」/「major を脱しました」を併記する。**両 signal は別フィールドなので同時表示できる**（初版の単一 enum が両立を表現できなかった矛盾を修正）。UI コピーは「進捗」であって「改善が加速」ではない（RISK-3）。

**D7 — `RetryRecordingResponse` 契約を 2 signal フィールドに分離する。** `RetryRecordingResponse { findingIdentifier: string; phoneme: string; originalGop: number; retryGop: number; gopDelta: number; deltaSignal: 'improved' | 'unchanged' | 'regressed'; boundarySignal: 'crossedMajor' | 'crossedMinor' | 'none'; qualityStatus: 'normal' | 'low_quality' }`。`deltaSignal`（magnitude）と `boundarySignal`（boundary crossing）を分け、D6 の「両 signal 併記」要件を契約上表現可能にする。`qualityStatus` は D12 の low_quality 時も delta を返せたか（diagnostic GOP 由来）を frontend に伝える。worker から返るこれら分類は frontend の presentation 分岐のみに使い、しきい値ロジックは worker に閉じる。

**D8 — ドリルへの遷移を配線する（本 ADR、first slice 外）。** `DetailPanelV2.tsx`(:369) の `ドリルへ →` の `disabled` を、`finding.catalogId !== null` のとき外す。クリックで Training Context の drill session 作成へ橋渡しする（`catalogId` をクエリで渡し production_drill を起動）。drill route の流用ではなく、PPC→Training の明示遷移（ADR-007 分離維持）。catalogId が null の所見ではボタンを `disabled` のまま据え置く。

**D9 — retry の永続化と隔離（first slice は synthetic section のみ、kind 列は将来拡張）。** first slice の隔離は **D4 の per-finding synthetic single-word section** で達成する（drill singleton と同型、実 Section の history クエリに現れない）。`analysis_runs` への `kind` 列追加（CHECK `kind IN ('primary','finding_retry')`）は、将来 retry を実 Section 配下で history 表示・進捗連携したくなった場合の拡張として残すが **first slice の non-goal**。first slice では synthetic section 隔離で十分であり migration を伴わない。

**D10 — FIRST SLICE の確定境界（wire-first 最小増分）。** first slice は **D1（部分再生 self スライス）+ D2（self/model A/B）+ D3（再録音）+ D4（単語再採点 synthetic section 永続化・実 Section history 隔離）+ D5（音素マッチング）+ D6/D7（worker 計算の GOP delta + 2 signal）+ D12（low_quality 時も diagnostic GOP を返す worker 契約）**。D8（ドリル遷移）・D9 の `analysis_runs.kind` 列・golden A/B・0-100 正規化・LLM ナラティブ（D11）は first slice の non-goal。観測可能 assert は D10 末尾 compliance で定義。

**D11 — LLM ナラティブ（ADR-004 LLM 戦略の un-defer）は本 ADR の依存先であり first slice 外。** retry の改善メッセージを LLM で個別化する拡張は別 ADR（LLM coaching narrative）に委ね、本 ADR は決定論的 delta 表示で閉じる。`claude -p` subscription mechanic（`claude -p --output-format json --no-session-persistence --system-prompt ... --model ...`、`--bare` は使わない＝keychain subscription 認証を保ち metered API を使わない）はその ADR で定義する。本 ADR では D6 の delta 表示が rule-based（worker 計算）で完結し LLM 不在でも機能することのみ保証する。

**D12 — low_quality 時も retry の delta を計算可能にする worker 契約追加（agent-policy 準拠、gate-disable しない）。** `Assessment.hs:169-180` は low_quality 時に `responsePerPhonemeGop = []` にするが、raw GOP は gate 判定前に `analyzedPerPhonemeGop analyzerResult`（:143/:198）として存在する。worker の品質ゲートや scoring/findings/score は**一切変えず**（low_quality は従来どおり score 0 / findings 空 / heatmap 空）、`AssessmentResponse` に **常時 populate される診断フィールド** `responseDiagnosticPerPhonemeGop`（品質ステータスに関わらず `analyzedPerPhonemeGop` をそのまま map）を追加する。retry 採点ハンドラ（D6 の delta 計算）はこの診断フィールドから retry GOP を取り、`qualityStatus='low_quality'` でも delta を返す（その旨を `RetryRecordingResponse.qualityStatus` で frontend に伝え、UI は「品質が低い録音ですが測定値の差分です」と注記できる）。これは **production の test-bypass フラグでも gate-disable でもなく**、worker が既に持つ測定値を契約で貫通させる純粋な追加。診断 GOP が空（音素整列が完全失敗）のときのみ delta 計算不能とし、route は 422 で「もう一度はっきり録音してください」を返す。

# Contract changes

- **frontend api-types.ts — 新規 export type RetryRecordingResponse（EngineResultDto の兄弟 export。EngineResultDto のフィールドではない、api-types.ts:263 付近）**: `export type RetryRecordingResponse = { findingIdentifier: string; phoneme: string; originalGop: number; retryGop: number; gopDelta: number; deltaSignal: 'improved' | 'unchanged' | 'regressed'; boundarySignal: 'crossedMajor' | 'crossedMinor' | 'none'; qualityStatus: 'normal' | 'low_quality' }` を追加。すべて camelCase、gop は worker 内部スケールの number。deltaSignal/boundarySignal/qualityStatus は worker が計算した値を載せる（frontend は分類しない）。
- **frontend app/api/v1/findings/[findingIdentifier]/retry-recordings/route.ts（新規 Route Handler）**: POST: multipart で audio(File), recordedDurationMs(number), referenceText(string), expectedPhonemeIpa(string), expectedAudioRangeStartMs(number) を受け、ensureFindingRetrySectionExists(per-finding synthetic single-word section) → submitPracticeAttempt(mode=oss_worker_only) → runAssessmentJob ポーリング(30s) → diagnostic per-phoneme GOP から対象音素抽出 → worker が計算した deltaSignal/boundarySignal を含む RetryRecordingResponse を返す。診断 GOP が空のときのみ 422。drills/[id]/attempts/route.ts と同一バリデーション様式。retry は synthetic section 配下に永続化されるが progress_snapshot は書かない。
- **frontend infrastructure/training/finding-retry-section-fixture.ts（新規、drill-section-fixture.ts 同型）**: FINDING_RETRY_MATERIAL_SINGLETON / FINDING_RETRY_SECTION_SERIES_SINGLETON 固定識別子と ensureFindingRetrySectionExists(database, findingIdentifier, referenceText): Promise<string> を追加。key は findingIdentifier 由来で決定論的・idempotent。この material は workspace の実 Section 履歴クエリから参照されないため history 隔離が成立する。
- **frontend components/workspace/DetailPanelV2.tsx DetailPanelV2Props**: latestRecordingAttemptIdentifier: string | null を新プロパティ追加。WorkspaceResultV2.tsx(:514 付近)の <DetailPanelV2 ...> 呼び出しで activeRecordingAttemptIdentifier を渡す。audioRange ボタン(:396)に onClick を付与し Web Audio スライス再生（D1）。所見スコープ A/B 2-chip（D2）を追加。
- **frontend components/workspace/ArticulationCard.tsx ArticulationCardProps + 自分で試すボタン(:144-154)**: 現状 Props は entry: ArticulationEntry のみ（ArticulationCard.tsx:6-8）。entry: ArticulationEntry; finding: EngineFindingDto に拡張する明示的シグネチャ変更（再録音ターゲット語/音素/audioRange.startMilliseconds を渡すため）。disabled を外し MediaRecorder 配線。retryState: { originalGop, retryGop, gopDelta, deltaSignal, boundarySignal, qualityStatus } | null を local state に追加し D6 表示。
- **frontend components/workspace/DetailPanelV2.tsx ドリルへボタン(:369)**: disabled を finding.catalogId === null のとき条件付きに変更。catalogId 非 null で onClick による Training Context drill 起動遷移を付与（D8、first slice 外）。
- **Haskell worker — AssessmentResponse（Types.hs）+ buildAssessmentResponseFromGop（Assessment.hs）+ python-analyzer schema.py AnalysisResponse**: responseDiagnosticPerPhonemeGop（camelCase: diagnosticPerPhonemeGop）を AssessmentResponse に追加。品質ステータスに関わらず analyzedPerPhonemeGop を {phoneme,gop,startMs,endMs} で常時 populate する（low_quality 分岐でも空にしない）。既存 responsePerPhonemeGop（heatmap、low_quality 時空）は据え置き。python-analyzer の perPhonemeGop は既に常時返るため新規測定不要、Haskell ACL デコーダと Types.hs の追加のみ。worker の retry 採点ハンドラ（D6 計算）が deltaSignal/boundarySignal を計算して返す新 endpoint または既存 /v1/pronunciation-assessments レスポンスへの delta 計算は frontend route が diagnostic GOP を使って worker 由来しきい値で行うのではなく、worker 側に薄い delta 計算関数を置く（scoring locus 維持）。
- **frontend infrastructure/drizzle/schema.ts analysis_runs テーブル（D9、first slice 外）**: first slice では変更なし（synthetic section で隔離）。将来拡張として kind TEXT NOT NULL DEFAULT 'primary'、CHECK kind IN ('primary','finding_retry') を追加し得るが、その場合 pnpm db:generate で migration 再生成必須（drizzle migration 再生成漏れ注意）。first slice の non-goal。

# Alternatives considered

- **部分再生を HTTP Range のバイトオフセット近似（CBR 仮定: startByte = floor(startMs/durationMs * sizeBytes)）で実装** — Pros: 既存 Range インフラを直接流用。フルフェッチ不要で軽量。 Cons: VBR の WebM/Opus では音素境界1個分（50-200ms）ずれうる。録音音声に per-frame index が無い（sizeBytes と durationMilliseconds のみ）。 不採用理由: VBR 録音で再生開始位置が音素境界を跨ぎ、ユーザーに別の音を聞かせる。証跡 RISK「byte-range partial playback with VBR」。Web Audio API スライス（decodeAudioData + AudioBuffer）はエンコードに依存せず決定的なので first slice では後者を採る。
- **retry を真に ephemeral（engine を直接呼び DB 行を一切作らない）にする** — Pros: ADR-008 / schema / migration の懸念を一切受けない。score history 汚染の心配がない。 Cons: submitPracticeAttempt / runAssessmentJob / drill route の実証済みパスを再利用できず、audio 保存・analysis run 作成・engine 呼出・GOP 取り出しを route handler 内で手組みする新規経路を全実装する必要がある。usecase 層を迂回し関心分離を壊す。 不採用理由: 初版はこの「ephemeral 経路」を名前だけ挙げて未仕様のまま D4 で submitPracticeAttempt 再利用を指定し自己矛盾していた。実証済みパスを捨てて未配線の新経路を手組みするのは wire-first と再利用の原則に反する。drill route は synthetic singleton section で history 隔離を既に達成しており、同型に per-finding synthetic section へ永続化すれば隔離は満たせる。よって「ephemeral」ではなく「synthetic section 配下に永続化し隔離」を採る。
- **retry を実 Section（所見元の Section）配下に RecordingAttempt + AnalysisRun + AssessmentResult として永続化** — Pros: 履歴トラッキング・進捗メトリクス連携が将来しやすい。 Cons: retry 結果が実 Section の workspace history / score history に現れスコア履歴を歪める。 不採用理由: 実 Section 配下に書くと score history を汚染する。drill route と同型に **per-finding synthetic single-word section** 配下へ書けば、workspace の score/最新結果クエリは実 Section 単位でスコープされるため retry は実 Section の history に現れない（DRILL_MATERIAL_SINGLETON が fixture 外から参照されない事実と同じ隔離機構）。隔離は ephemerality でも analysis_runs.kind 列でもなく synthetic section で達成する。
- **既存 drill-attempt route に findingIdentifier + originalGop を追加して delta を返す** — Pros: 新ルート不要。 Cons: training-drill セマンティクスと workspace-retry セマンティクスを混同。 不採用理由: ADR-007 の PPC Context / Training Context 分離に違反。retry は workspace（PPC）の関心であり、drill route 流用は責務分離を壊す。新ルート `POST /api/v1/findings/{findingIdentifier}/retry-recordings` を立てる。証跡 Option D「Not recommended」。
- **GOP デルタの「improved」判定を frontend で絶対 GOP しきい値（GOP > -8 を超えたら改善）だけで定義** — Pros: 単純。 Cons: frontend が worker の severity しきい値（-8/-12）を再導出し ADR-004 の scoring locus を侵食する。わずかな改善（境界を跨がない -14→-10）を検出できない。 不採用理由: ADR-004 は GOP しきい値→severity 写像を worker 所有とする。境界跨ぎ分類を frontend route handler で行うと scoring を二重化する。本 ADR は **境界跨ぎ分類（crossedMinor/crossedMajor）を worker が計算**し、frontend は worker が返した signal で表示分岐するだけにする（D6/D7/D12）。delta の連続量（improved/regressed）も worker が同じ GOP スケールで計算して返す。
- **worker 内部スケールの生 GOP（負の浮動小数）をそのまま frontend に出し frontend で全判定** — Pros: worker 変更不要。 Cons: 負の浮動小数の意味づけ（境界跨ぎ）を frontend が解釈する必要があり、しきい値が Scoring.hs と二重管理になる。 不採用理由: delta 表示時に worker スケールの差分（before/after の生 GOP 差）を 1 桁小数で出すのは維持するが、improved/regressed/crossedMinor/crossedMajor の **分類自体は worker が Scoring.hs のしきい値で計算**して `RetryRecordingResponse` に載せる。frontend はラベルと方向（↑改善）を presentation するのみ。0-100 正規化は first slice の non-goal。

# Consequences

## Positive

- dead だった4 affordance（部分再生・自分で試す・GOP delta・ドリルへ）が real entrypoint から到達可能・観測可能挙動を持つ。
- 所見単位で「聞く→比べる→出す→測る」の閉ループが成立し、即時具体 corrective feedback（E-5, g=0.86）の構造を満たす。
- GOP しきい値→severity 写像と境界跨ぎ分類が worker に集約され、ADR-004 の scoring locus を侵食しない。frontend は worker が返した deltaSignal/boundarySignal を presentation するのみ。
- retry を per-finding synthetic section 配下に永続化することで、実証済みの submitPracticeAttempt/runAssessmentJob パスを再利用しつつ実 Section の history/score を汚染しない（drill singleton と同じ隔離機構）。ephemeral 経路の新規手組みを避ける。
- low_quality な retry でも diagnostic per-phoneme GOP（worker 契約常時フィールド）から delta を計算でき、verify loop が最も必要とする「難所の初回再録音」で delta が消えない。gate-disable フラグを入れないため agent-policy に適合。
- 部分再生が Web Audio スライスなので VBR/CBR どちらのエンコードでも音素境界が決定的。

## Negative

- retry の再採点が full pipeline を単語に流すため 1 所見あたり最大 30s（runAssessmentJob ポーリング）かかる。複数所見の連続 retry は逐次。
- retry が synthetic section 配下に RecordingAttempt+AnalysisRun+AssessmentResult を永続化するため、DB 行は増える（隔離されてはいるが ephemeral ではない）。これらの synthetic section データの GC/クリーンアップ方針は別途定める必要がある。
- worker 内部スケールの生 GOP 差分を表示するため、学習者向けの絶対的な読みやすさは劣る（0-100 正規化は別スライス）。deltaSignal/boundarySignal で方向と境界は補う。
- 「改善を見せる」効果の独立した効果量証拠が無いため、UI コピーは進捗トラッキングに限定され、学習加速を主張できない。
- D12 の diagnostic per-phoneme GOP 追加は Haskell worker（Types.hs + Assessment.hs）と Haskell per-edit hook（cabal test）を伴い、backend 編集コストが上がる。worker delta 計算関数の追加も同様。
- low_quality 録音で diagnostic GOP を delta に使う場合、その値の信頼性は低い（録音品質が悪い）ため、UI は「品質が低い録音の測定値」と注記する必要があり、純粋な改善指標として扱えない。

# Compliance

- 契約テスト: RetryRecordingResponse が { findingIdentifier, phoneme, originalGop, retryGop, gopDelta, deltaSignal, boundarySignal, qualityStatus } を持ち、deltaSignal が 3 値・boundarySignal が 3 値・qualityStatus が 2 値の enum であることを assert（単一 enum で両 signal を表せない初版の欠陥が再発しないことを保証）。
- ユニットテスト(worker, Haskell): delta/境界判定ロジックが Scoring.hs の gopMinorThreshold=-8 / gopMajorThreshold=-12 を strict < で使うことを assert。境界等値ケース: gop == -8 は minor ではない、gop == -12 は major ではない（Scoring.hs:961-962 と整合）。deltaSignal は gopDelta>+5=improved / <-2=regressed を assert。fixture は実 worker 出力形（負 GOP、phenomenon 文字列）で書く。
- ユニットテスト(worker): D12 の diagnosticPerPhonemeGop が low_quality 分岐（checkAudioQuality=true）でも空にならず analyzedPerPhonemeGop を反映することを assert。既存 responsePerPhonemeGop（heatmap）は low_quality で空のまま据え置かれることも併せて assert（gate を緩めていない証拠）。
- ユニットテスト(frontend): D5 の音素マッチングが、同一 IPA 複数出現時に audioRange.startMilliseconds 最近傍境界を選ぶことを assert。frontend は分類しないため deltaSignal/boundarySignal は worker 出力をそのまま表示することを assert。
- ランタイム検証(live worker): 実所見で (a) 部分再生が audioRange 区間のみ鳴る、(b) POST /api/v1/findings/{id}/retry-recordings が 200 と RetryRecordingResponse を返す、(c) originalGop≠retryGop の実録音で gopDelta と deltaSignal/boundarySignal が UI に観測される、(d) わざと低品質の単語録音で qualityStatus='low_quality' でも diagnostic GOP 由来の gopDelta が返ることを assert。テストが緑なだけでは完了としない（二段門）。
- agent-policy verify: retry route と再録音ボタンが real public entrypoint（App Router ファイル配置 + DetailPanelV2/ArticulationCard 経由）から到達可能であること。本番に stub/test-bypass/gate-disable フラグを入れない。retry は synthetic section 配下に実 engine を呼んで永続化する（mock 不可）。D12 は gate-disable ではなく契約フィールド追加であることをレビューで確認。
- ADR-008 compliance: retry の AssessmentResult を progress_snapshots に書き込まない（task_kind CHECK に retry 値を追加しない）ことを検証。synthetic section 配下の assessment_results/analysis_runs 永続化は ADR-008 制約外であることを明記。retry が実 Section の score history クエリに現れないことを assert（synthetic section 隔離の検証）。
- ADR-004 compliance: GOP しきい値→severity 写像と境界跨ぎ分類が worker でのみ行われ、frontend route handler / component が -8/-12 のしきい値を再導出していないことをコードレビューと grep で確認（frontend に gopMinorThreshold/gopMajorThreshold 相当の数値が現れないこと）。注: 現状 .ast-grep/rules や scripts/verify-*.sh に scoring-locus を機械強制するルールは存在しないため、本 compliance はレビュー rubric（rubric/core/spec.md）での目視ゲートであり「既存 fitness check が通る」とは主張しない。

# Notes

- Risks:
  - 「改善を見せると学習が進む」の retest-loop 効果は独立変数として測った発音 CAPT の RCT が無く（E-15 設計仮定）、自己決定理論・skill acquisition theory・CAPT 設計パターンからの間接支持にとどまる。UI コピーは「進捗トラッキング」に限定し「改善が加速する」とは謳わない（証跡 RISK-3）。
  - 単語スコープ再録音（1-2 秒）が LQAS gate（meanDbfs / 音素検出率 / median GOP、Scoring.hs:140-171、ADR-015）を誤発火し low_quality を返しうる。これは fringe ではなく retry のコアケース（難所の初回再録音は median GOP が最悪）。本 ADR は D12 で gate を緩めず diagnostic per-phoneme GOP を worker 契約に常時追加して delta を計算可能にすることで対処する（gate-disable フラグは agent-policy 違反のため採らない）。残余: 診断 GOP は低品質録音の値なので信頼性が低く、UI 注記が必要。音素整列が完全失敗し diagnostic GOP が空のケースは 422 で再録音を促す。
  - forced-alignment（wav2vec2、~20ms フレーム粒度）の短子音境界誤差 ±20ms が D5 の音素選択を乱す。単語スコープなら対象音素 1 個で回避できるが、複数同一 IPA 時は audioRange 最近傍ヒューリスティックが外れうる（単語内 index ずれ）。
  - worker 内部 GOP スケール（ceiling≈-2 は Scoring.hs heatmap の gop>=-2→heat0 と整合。floor の -20 近辺は worker 定数ではなく unit-fixture コメント由来の近似であり worker fact ではない）。+5 しきい値や境界値 -8/-12 のうち -8/-12 は Scoring.hs 由来の確定値、+5/-2 は calibratable な暫定値で実録音再現性は未検証。
  - runAssessmentJob ポーリング 30s timeout が retry の体感レイテンシを支配する。複数所見連続 retry は逐次で待ち時間が積む。
  - retry を synthetic section 配下に永続化するため DB 行が蓄積する。synthetic（FINDING_RETRY_MATERIAL_SINGLETON 配下）の RecordingAttempt/AnalysisRun/AssessmentResult/audio file の GC 方針が未定義で、放置すると storage が膨らむ。クリーンアップジョブを別途定める。
  - D9 の analysis_runs.kind 列追加は将来拡張（first slice non-goal）。導入時は migration（pnpm db:generate 再生成必須）を伴い drizzle 再生成漏れに注意。first slice は synthetic section 隔離で migration を回避する。
- First-slice relevance: 本 ADR は first slice そのものを定義する。FIRST SLICE = D1(部分再生 self スライス, Web Audio decodeAudioData+AudioBuffer スライス) + D2(self/model TTS の所見スコープ A/B、golden は除外) + D3(自分で試す MediaRecorder 再録音、ArticulationCard Props を entry+finding に拡張) + D4(POST /api/v1/findings/{findingIdentifier}/retry-recordings で per-finding synthetic single-word section 配下に永続化・実 Section history から隔離、progress_snapshot 書込なし) + D5(音素マッチング) + D6/D7(worker が計算する GOP delta・deltaSignal+boundarySignal の 2 フィールド・X→Y 表示) + D12(low_quality 時も diagnostic per-phoneme GOP を worker 契約で常時返し delta を計算可能にする、gate-disable しない)。non-goal: D8 ドリル遷移、D9 analysis_runs.kind 列/実 Section 永続化版、golden RVC A/B、0-100 正規化、LLM ナラティブ(D11、別 ADR)。観測可能 assert: 実所見で部分再生が audioRange 区間のみ鳴る / 再録音→retry-recordings が RetryRecordingResponse を返す / originalGop≠retryGop の実録音で gopDelta と deltaSignal/boundarySignal が live で UI に出る / 低品質単語録音で qualityStatus='low_quality' でも diagnostic GOP 由来の delta が返る。wire-first: 4 dead affordance のうち D1/D3 を real entrypoint から到達可能にし、synthetic section 隔離で実 Section history 汚染と ADR-008 snapshot 制約を同時に回避する最小増分。初版の「ephemeral / DB 書込なし」矛盾、単一 improvedSignal enum の両立不能、frontend での scoring 境界再導出、gop<=-8 の境界誤り、存在しない fitness check への依拠、low_quality で GOP が消える未対処はいずれも本版で解消済み。
- First-slice scoping amendment (2026-06-18): first slice は **正常録音の閉ループ（部分再生 + A/B + 再録音 + 正常 retry の GOP delta）に限定**する。low_quality な再録音で diagnostic per-phoneme GOP から delta を返す要件（D12 / M-CRL-8、`responseDiagnosticPerPhonemeGop` の常時 populate）は **ADR-018（acoustic-phonetic diagnosis）実装時に延期**する。first slice では low_quality な再録音は既存の「もう一度はっきり録音してください」再録音プロンプト（422）を返し、gopDelta は正常 retry のみで返す。D6（worker が delta/signal を Scoring.hs のしきい値で計算）は維持し、worker は正常 retry の per-phoneme GOP と finding 由来の originalGop から delta・境界跨ぎ分類を計算する。ADR-014 の low_quality 振る舞い（workspace 側）は不変。
- Amends: ADR-004（scoring locus を worker に集中する原則を維持・補強する。retry（finding 再録音）の GOP delta と minor/major 境界跨ぎ分類は worker が Scoring.hs のしきい値で計算し RetryRecordingResponse に載せる（frontend は presentation のみ）。これにより境界跨ぎ分類が frontend に漏れない。delta 表示は frontend の presentation であり scoreImpact/ScoreSet 計算には影響しない。LLM feedback 戦略の un-defer 自体は別 ADR に切り出すが、本 ADR の delta が rule-based（worker 計算）で完結し LLM 不在で機能する前提は ADR-004 の「LLM 無しでも REQ-104 が機能」方針と整合。注: ADR-004 の scoring-locus アサーションは現状機械強制されていない（.ast-grep/verify-*.sh に該当ルール無し）ため、本追補は将来の scoring-locus fitness rule 追加を推奨として残す）、ADR-008（progress_snapshots の task_kind 不変条件（rereading/drill のみ）は維持。retry 由来 AssessmentResult を progress_snapshot にしないことを本 ADR が明示宣言する。retry を per-finding synthetic section 配下に永続化することは ADR-008 の制約外（ADR-008 は progress_snapshots のみ制約し assessment_results/analysis_runs を制約しない）であることを明確化し、初版が ADR-008 を「完全 ephemeral を強制する根拠」と誤って援用していた点を是正する。隔離は synthetic section で達成する）。
- Depends on: ADR-001 (GOP 検出・gop の供給元。delta は同一 GOP スケール上の差分。diagnostic per-phoneme GOP も同一供給元)、ADR-004 (scoring policy worker 集中。delta/境界分類を worker で計算する根拠。structured-diff の gop/audioRange/expected/detected/catalogId フィールド)、ADR-007 (PPC/Training Context 分離。ドリルへの遷移は流用でなく明示遷移)、ADR-008 (progress_snapshots task_kind 制約。retry を snapshot にしない根拠。synthetic section 永続化は制約外)、ADR-015 (low_quality loudness gate。D12 が gate を緩めずに diagnostic GOP を貫通させる対象)、ADR-017 (insertionPositionMs 等の所見契約。retry 対象音素 disambiguation に audioRange を使う)。
- Author: lihs
- Last updated: 2026-06-18
- Related: ADR-001（GOP/detected IPA の供給元）、ADR-004（worker が scoring を所有・structured-diff・減点 allow-list）、ADR-007（PPC/Training Context 分離）、ADR-008（progress_snapshots task_kind 制約）、ADR-012（golden RVC。golden A/B は first slice 外）、ADR-015（low_quality loudness gate）、ADR-017（所見契約・insertionPositionMs・audioRange）。
