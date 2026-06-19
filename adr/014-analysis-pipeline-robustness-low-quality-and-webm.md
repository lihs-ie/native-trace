# Harden the analysis pipeline against low-quality audio, browser WebM, and cloud-engine outages

# Status: Accepted

Accepted on 2026-06-14 (approved by repository owner via in-session decision: keep `comparison`
default with partial-success display, surface low-quality audio as a re-record prompt).

# Context

In the local MVP a real microphone recording would spin on an infinite "analyzing" state and never
reach a result. Investigation of the running system (worker / analyzer logs, the SQLite job table,
and direct `/v1/analyze` reproduction with the actual recorded audio) surfaced three independent
defects on the record → analyze path:

1. **Browser audio is WebM/Opus, but the prosody path could not decode it.** `MediaRecorder` in the
   browser produces `audio/webm;codecs=opus`. The wav2vec2 aligner already transcodes WebM/OGG to
   WAV PCM through ffmpeg (`Wav2Vec2Aligner._decode_to_pcm`), but the parselmouth prosody path
   (`extract_f0_contour`) passed the raw bytes straight to `soundfile` (libsndfile), which cannot
   read a WebM container. The exception was caught and an empty `F0Contour` returned, so **F0 and
   word-stress were silently empty for every browser recording** — degrading the prosodic CEFR
   subscale and the F0 reference overlay without any error surfacing.

2. **Near-silent / minimal-speech recordings hard-failed instead of prompting a re-record.** A real
   recording with almost no speech (reproduced: 0.76 s of detected speech in a 15 s take,
   `detectedIpa: "w a l"`) makes the worker return `status:"low_quality"` and/or an empty `segments`
   array. The frontend ACL response schema required `segments.min(1)`, so an empty `segments`
   response failed Zod validation as `assessmentSchemaInvalid`. That error never maps to the
   `low_quality_audio` error code, so the workspace never reached its designed `low_quality`
   re-record state; the run just ended as a generic failure.

3. **Comparison mode could lose the OSS result when the cloud engine is unavailable.** `comparison`
   is the default analysis mode (REQ-005 / REQ-010: run cloud + OSS on the same recording). Locally
   the OpenAI engine returns `404 model gpt-4o-audio-preview does not exist or you do not have
   access`. When the OSS job ALSO failed (defects 1/2 above), the run failed wholesale. Even when
   OSS succeeded, the `errorCode` surfaced to the UI was taken from the first failed job (cloud),
   masking the more actionable low-quality signal.

A logger in the job runner and the OSS adaptor serialized `DomainError` plain objects with
`String(error)`, printing `"[object Object]"` and hiding the real cause during diagnosis.

The designed concepts already existed but were not wired end-to-end: the worker response schema has
a `status: "normal" | "low_quality"` field, `run-assessment-job` maps an engine failure whose
`reason === "low_quality_audio"` to the `low_quality_audio` error code, and `deriveWorkspaceState`
renders a `low_quality` re-record state for `failed` + `low_quality_audio`.

# Decision

**D1 — Low-quality audio is a graceful engine outcome, not a schema hard-fail.** The OSS worker ACL
response-mapper maps a worker response with `status === "low_quality"` OR `segments.length === 0`
to an `assessmentEngineFailed(engine, "low_quality_audio", nonRetryable)` engine failure instead of
producing a stored draft or a schema-invalid error. The response schema no longer requires
`segments.min(1)` (an empty `segments` array is valid input that the mapper interprets). `nonRetryable`
because re-analyzing the same bytes cannot produce speech that was not recorded. `run-assessment-job`
then maps `reason === "low_quality_audio"` to error code `low_quality_audio`, and the workspace
renders its `low_quality` state ("発話を検出できませんでした。マイク/音量を確認して録り直してください").

**D2 — Cloud-engine failure must not block the OSS result, and low-quality wins the error code.**
`comparison` stays the default (REQ-005 / REQ-010). Client errors (4xx, including the 404
model-unavailable) are `nonRetryable`, so the cloud job fails fast rather than delaying the run with
retries. When the OSS job succeeds the run is `partial_succeeded` and the OSS result is shown. When
multiple jobs fail, `view-practice-workspace` prioritizes a `low_quality_audio` error code over any
other engine failure so the user sees the actionable re-record prompt rather than the cloud's 404.

**D3 — The prosody F0 path decodes non-PCM audio via ffmpeg, mirroring the aligner.** `extract_f0_contour`
tries `soundfile` first and, on failure, transcodes the bytes to WAV PCM with ffmpeg (format
auto-detected from the stream, so no MIME type is needed) before reading them again. This reuses the
same ffmpeg invocation as `Wav2Vec2Aligner._decode_to_pcm` and keeps the decode self-contained in
the prosody infrastructure module (ADR-005 onion: infrastructure detail, no use-case signature change).

**D4 — Domain errors are logged as objects, not `String(error)`.** The runner logger serializes a
non-`Error` value (e.g. a `DomainError`) by preserving its fields instead of collapsing it to
`"[object Object]"`, so the real failure reason is observable.

## 追補（2026-06-19）— partial-success UI 接地面の確定と録音品質 markup の design 採用

**D5 — partial_succeeded は succeeded と別の UI 状態として接地する（D2 が含意した surface の確定 + read-only な per-engine outcome 射影の追加）。** D2 は「`comparison` 既定 + partial-success display」を決めたが、workspace の状態導出（`deriveWorkspaceState`、`applications/frontend/src/app/materials/[materialIdentifier]/sections/[sectionIdentifier]/page.tsx:59` 起点）は `partial_succeeded` を `succeeded` と同一の `result` 状態に畳む（:79 の `runStatus === "succeeded" || runStatus === "partial_succeeded"`）。`partial_succeeded` のときは plain な succeeded 結果ビューではなく、design-system の `.partial-banner`（`design-components.css:1089-1092`、`.pb-ico` を含む）で「一方のエンジンが失敗し、もう一方の結果を表示している」旨を明示する。

per-engine outcome chip（`.engine-outcome--ok` / `.engine-outcome--fail`、`design-components.css:1093-1096`、`.eo-dot` を含む）を描画するには、失敗エンジン（ローカルの cloud 404）の情報が現行 entrypoint からは取れないことを明示する: `WorkspaceDto`（`api-types.ts:349-363`）は成功結果のみの `resultsByEngine: EngineResultDto[]` と `latestAnalysisRun{status,errorCode}` しか公開せず、失敗 cloud ジョブには `resultsByEngine` のエントリが無い。失敗エンジンの per-engine outcome は use-case 内部（`usecase/view-practice-workspace/index.ts:332-339`、`jobPage.items` の `type: 'failed'|'succeeded'` / `engineKind` / `lastErrorCode`）には既に計算済みだが `WorkspaceDto` に射影されていない。したがって D5 は **既存ジョブ状態に対する read-only な per-engine outcome 射影を `WorkspaceDto` に 1 つ追加する**: `engineOutcomes: { engineKind: 'cloud' | 'oss_worker'; status: 'ok' | 'fail'; errorCode: string | null }[]`（`index.ts:332-339` の `jobPage.items` から導出、`status` は `j.type === 'succeeded' ? 'ok' : 'fail'`）。これは scoring・job 実行・エラーコード優先・analysis mode のいずれも変えない（D2 の `low_quality_audio` 優先＝`index.ts:329-340` の挙動は不変）。本追補が変えるのは「presentation + 既存ジョブ状態の read-only 射影」のみで、新たな採点や job 実行は伴わない。

**D6 — 配線済みの録音品質挙動は design-system の vu-meter / rerecord markup で提示する（閾値・挙動は不変、値は他 ADR が正本所有）。** 録音メーターと low-volume / 再録音表示は、アプリ独自の `volume-meter` / `volume-meter-track` / `volume-meter-bar` / `volume-meter-label` / `volume-meter--low`（現状 `page.tsx:501-507`）および `dock-low-quality`（`page.tsx:650`）ではなく、design-system markup（`.vu-meter` / `.vu-fill` / `.vu-peak` / `.vu-gate` / `.vu-scale` / `.vu-note` / `.vu-low-label` + `.vll-dot` / `.vu--low`、`design-components.css:1065-1077`、および `.rerecord` / `.rr-ico` / `.rr-k` / `.rr-d`、`design-components.css:1080-1086`）で描画する。提示する値の出所は既存の配線済み定数のままとする: peak-hold afterglow は `PEAK_HOLD_RELEASE_RATE_PER_MS = 0.327`（ADR-016 D1、`volume-meter.ts:59`）由来の peak 値、`.vu-gate` の -36dB ゲート線位置は `LOW_VOLUME_DISPLAY_THRESHOLD = 41`（`page.tsx:45`、diagnostic 画面は `diagnostic/[diagnosticSessionIdentifier]/page.tsx:41`、ADR-016 D2/D4 の「-36 dBFS ≈ 41%」整合）、low-volume 判定は `SUSTAINED_LOW_MS = 500`（ADR-016 D4、`volume-meter.ts:100`）、無音棄却ゲートは `autoGainControl: false`（ADR-015:17）下の speech-active RMS。`low_quality` 再録音カードの fire-condition callout が列挙する閾値は worker の `Scoring.hs:236-246`（`audioQualityMinMeanDbfs = -36.0`:237 / `audioQualityMinRecordingDurationMs = 1000`:240 / `audioQualityMinPhonemeDetectionRate = 0.25`:243 / `audioQualityMaxMedianGop = -18.0`:246）を出所として表示する。

**これらの閾値・ゲート・peak-hold・debounce・autoGainControl の正本所有は他決定にある**: peak-hold（0.327）は ADR-016 D1、meter-gate 整合（-36 dBFS ≈ 41%）は ADR-016 D2、持続低下 debounce（500ms / 41%）は ADR-016 D4、gain-invariant ゲート（`autoGainControl: false`）は ADR-015 D3、worker 品質ゲート閾値は `Scoring.hs`（ADR-022:37 にも列挙）。D6 はこれらを **可視化するのみで所有しない**。表示専用であり値は一切変えない（D6 は markup 採用と既存値の可視化のみ）。将来の drift を避けるため、これらの値は本 ADR 内に独立した正規値として再宣言せず cross-reference として保つ。

### Alternatives considered（D5 / D6）

- **D5: succeeded への畳み込みを維持（不採用）。** 現状の `deriveWorkspaceState` は `partial_succeeded` を `succeeded` と同一視するため最小実装だが、D2 が決めた partial-success display が接地せず、ユーザーは cloud 失敗 + OSS 成功を一切知らされない。採用案（distinct なバナー + per-engine chip）を選ぶ。
- **D5: バナーの代わりに inline notice（不採用）。** 結果ビュー内に小さな注記を出す案。surface が弱く partial 状態の視認性が低いため、design-system の `.partial-banner` を採用する。
- **D5: per-engine chip を `WorkspaceDto` 射影なしで描画（採用不能）。** 失敗 cloud は `resultsByEngine` に存在せず現行 entrypoint から fail を導出できないため presentation-only では成立しない。read-only な `engineOutcomes` 射影の追加を採用する（scoring/job 実行は不変）。
- **D6: アプリ独自 `volume-meter` / `dock-low-quality` class を維持（不採用）。** 動作はするが design-system と二重定義になり、vu-meter の peak/gate/scale や rerecord カードの fire-condition callout が表現できない。design markup を採用し、閾値は他 ADR の cross-reference として保つ。
- **D6: 閾値を本 ADR で再宣言（不採用）。** 可視化のため値を本文に固定値として書くと ADR-015/016/Scoring.hs と二重管理になり drift する。cross-reference のみ保持する採用案を選ぶ。

### 受入（新 Must — 既存に M-番号は無いため本クラスタは `M-RQ-` 連番を新設）

- **M-RQ-1**: run が `partial_succeeded` のとき、workspace は plain な succeeded 結果ビューと区別できる partial-success バナー（`.partial-banner`）を描画する。`partial_succeeded` を carry する `WorkspaceDto` fixture を与えた rendered workspace コンポーネントに対し、succeeded 経路と異なるバナー要素（`.partial-banner`）が visible であることを assert する（バナー有無の判定は `latestAnalysisRun.status === 'partial_succeeded'` から導出可能で、現行 entrypoint から成立する）。
- **M-RQ-2**: `partial_succeeded` な `comparison` run で、`WorkspaceDto.engineOutcomes`（D5 で追加する read-only 射影）の各エントリに対し `.engine-outcome--ok` / `.engine-outcome--fail` chip を描画する。`engineOutcomes` に成功 OSS（`status:'ok'`）と失敗 cloud（`status:'fail'`、`errorCode` 付き）を carry する `WorkspaceDto` fixture を rendered workspace コンポーネントに与え、両 chip が正しい ok/fail class で visible であることを assert する（`deriveWorkspaceState` は state 文字列のみ返し chip データを運ばないため、assert は state 関数ではなく rendered component レベルで行う）。
- **M-RQ-3**: 録音 VU メーターは design の `.vu-meter` / `.vu-fill` markup（gradient、`.06s` transition）で描画し、既存 peak-hold 値で駆動される独立した `.vu-peak` afterglow マーカー要素と、`LOW_VOLUME_DISPLAY_THRESHOLD`（41%、`page.tsx:45`）に位置する `-36dB` ラベル付き on-meter `.vu-gate` 線を持つ。録音 DOM に `.vu-peak` と `.vu-gate` 要素が存在し、ゲートが閾値パーセンテージに位置することを assert する。
- **M-RQ-4**: renderer（CSS 専用ではなく）から `.vu-scale` の dB 端点ラベル（-60 / -36 / 0 dB）と `.vu-note` 説明キャプションを描画する。録音画面 DOM に 3 つの scale ラベルと note コピーが現れることを assert する。
- **M-RQ-5**: 持続低下判定（ADR-016 D4、`SUSTAINED_LOW_MS = 500`、`volume-meter.ts:100`）は design の `.vu-low-label` / `.vll-dot` markup で描画し、`volume-meter-label` ではなく `.vu--low` で recolor する。`isLowVolume` が true のとき `.vu-low-label` 要素が present かつメーターが `.vu--low` を帯びることを assert する。
- **M-RQ-6**: `low_quality` 再録音状態は design の `.rerecord` / `.rr-ico` カードで描画し、既存閾値（最小録音長 1000ms / 最小音素検出率 0.25 / median GOP -18 / speech-active loudness -36 dBFS）を列挙する fire-condition callout を持つ。出所は `Scoring.hs:236-246`（`-36` ゲートの正本は ADR-015 D3）。`low_quality` dock（`page.tsx:650`）に `.rerecord` カードと callout テキストが、いかなる閾値も変えずに描画されることを assert する。
- **M-RQ-7**: 挙動・閾値・ゲート・autoGainControl の不変: `PEAK_HOLD_RELEASE_RATE_PER_MS = 0.327`、`SUSTAINED_LOW_MS = 500`、`audioQualityMinMeanDbfs = -36.0`（dBFS）、`autoGainControl: false`、`low_quality → 再録音` 配線は ADR-015 / ADR-016 / ADR-014 D1 の決定どおり。本追補は presentation + read-only な `engineOutcomes` 射影のみで `scoreImpact` に影響せず（ADR-004:31/50：presentation/advice は `scoreImpact = 0`、scoring locus は worker、ADR-004:62：新 finding フィールドは deduction に使わない）、既存 `volume-meter.test.ts` と `page.test.ts`（`deriveWorkspaceState` の state 文字列回帰、`page.test.ts:81-89` の `partial_succeeded` → `result`）と workspace E2E spec は緑を維持する。`engineOutcomes` 射影追加で `deriveWorkspaceState` の戻り値（state 文字列）は変えない。新規バナー/chip/markup/射影に mock/stub/placeholder を本番経路へ入れない。

## Alternatives considered

- **Detect low-quality in the Haskell worker and short-circuit there (rejected for this slice).** The
  worker is the natural owner of "was there speech", and it already emits `status:"low_quality"`.
  But the break was the frontend rejecting that response, and a worker rebuild is heavy. We keep the
  worker contract and fix the consumer; tightening the worker's own low-quality threshold is a
  follow-up (Non-goal).
- **Keep `segments.min(1)` and map the schema error to low-quality (rejected).** Overloading a schema
  validation failure to mean "low quality" is fragile — any other empty-array cause would be
  misreported. Allowing empty `segments` and branching explicitly on `status`/length is precise.
- **Map `status:"low_quality"` to a stored successful draft (rejected, replaced prior behavior).** The
  previous response-mapper turned `low_quality` into an `Ok` draft with `status:"low_quality"`, but
  nothing downstream rendered a re-record prompt from a *result*; it showed an empty result view.
  Routing it through the existing `low_quality_audio` error-code path reuses wired UI behavior.
- **Default the local mode to `oss_worker_only` (rejected by owner).** Simplest way to drop the cloud
  dependency, but the owner chose to keep `comparison` and rely on partial-success display.
- **Decode once at the use-case and share PCM with both aligner and prosody (deferred).** Cleaner but a
  larger refactor of analyzer signatures; the localized ffmpeg fallback fixes the defect with less risk.

# Consequences

- Minimal-speech recordings produce a re-record prompt instead of an infinite spinner or an opaque
  failure. Verified end-to-end: the OSS job reports `errorCode=low_quality_audio` and the workspace
  API returns `status:failed, errorCode:low_quality_audio` for the reproduced low-speech recording.
- Browser WebM recordings now yield a populated F0 contour and word stress. Verified: F0 frame count
  went from 0 to 855 (251 voiced frames) for the same WebM after the analyzer rebuild.
- With the cloud engine unavailable, a normal recording still returns a result via `partial_succeeded`.
- The analyzer `/v1/analyze` latency rises modestly for WebM (the ffmpeg transcode runs in both the
  aligner and the prosody fallback); measured ~12 s for an ~9 s recording on CPU, within timeouts.
- The OSS adaptor response contract changes: `segments` may be empty, and `status:"low_quality"` is an
  engine failure rather than a draft. Covered by two regression tests in
  `schema-and-response-mapper.test.ts`.

# Compliance

- The prosody ffmpeg fallback stays inside `applications/python-analyzer/.../infrastructure/parselmouth_prosody.py`
  (ADR-005 layer closure; no use-case or interface change). It reuses the same ffmpeg command shape as
  the aligner.
- Worker scoring contract (ADR-004) is unchanged: the worker still owns scoring and the `status` field;
  the frontend only changes how it consumes a `low_quality` / empty-`segments` response.
- Regression guard: `applications/frontend/src/acl/pronunciation-assessment/oss-worker/__tests__/schema-and-response-mapper.test.ts`
  asserts that `status:"low_quality"` and empty `segments` both map to a `low_quality_audio`,
  `nonRetryable` engine failure, and that the schema accepts empty `segments`.
- `pnpm typecheck`, vitest (affected suites), and `pnpm fitness` pass before commit.

# Notes

- Non-goals: tuning the worker's own low-quality detection threshold (dBFS / speech-duration), and
  changing or provisioning the cloud (OpenAI) model name. The cloud job remains best-effort under
  `comparison` and may keep returning 404 locally; the OSS result is what the user sees.
- Follow-up worth considering: pre-warm the analyzer model at startup so the first analysis after
  `docker compose up` does not risk a cold-start timeout, and decode audio once per request to share
  PCM between the aligner and the prosody analyzer.
