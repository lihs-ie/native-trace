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
