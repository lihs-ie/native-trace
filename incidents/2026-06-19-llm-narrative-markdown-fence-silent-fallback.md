# Incident: LLM narrative silently fell back — claude -p markdown code-fence not stripped

Date: 2026-06-19
Context: ADR-021 LLM coaching narrative (proven-done pipeline)
Severity: feature observably non-functional through the real entrypoint (caught before merge)

## What happened
`claude -p --output-format json` returns `{type:result, result:<text>}`; the `result` text is the model's
narrative, which claude wraps in a markdown code fence (```json\n{...}\n```) despite the system prompt explicitly
forbidding markdown. The invoker returned the raw fenced `result`; `validateLlmOutput` did `JSON.parse(rawOutput)`
directly → threw on the leading backticks → every finding silently fell back to rule-based, and `llm_narrative_cache`
stayed at 0 rows. With `LLM_COACHING_PROVIDER=claude-code`, all 19 findings' feedbackLayers were byte-identical to the
rule-based run. The learner never saw an LLM narrative.

## Why every static layer missed it
unit tests + static-verifier + spec-grader were ALL green. The unit fixtures fed already-bare JSON
(`JSON.stringify({...})`), not claude's real fenced output shape — a fixture-vs-reality gap. Only the runtime-verifier,
driving the REAL entrypoint with a live `claude -p` subprocess and reading back the persisted DB result, caught it
(verdict FAIL → fix → re-verify PASS). Additional twist: claude's fencing is NON-DETERMINISTIC (one probe returned
fenced, another returned bare) — so a fixture that happened to capture one shape could still pass while production breaks.

## Fix
`grounding-prompt.ts`: added `stripCodeFence()` called inside `validateLlmOutput` BEFORE `JSON.parse` (shared parse layer
so claude AND ollama benefit). Strict M-LLM-9 validation still runs on the inner text (no loosening). Added a regression
test mirroring claude's real fenced shape.

## Promotion candidates (for /self-improve)
1. **Rule/lint or test-template**: any adaptor consuming an external CLI/LLM/worker MUST have at least one fixture that
   mirrors the tool's REAL wrapping (markdown fence, response envelope, trailing newline), not just the idealized payload.
   Reinforces memory unit-fixtures-must-mirror-real-worker-shape (now updated with this case).
2. **Defensive parsing rule**: never `JSON.parse` raw model/CLI stdout directly — strip fences / extract the JSON span
   first. Do not trust "no markdown" prompt instructions; small models and even claude ignore them.
3. **Observability gap**: the timeout→fallback path is SILENT (related residual: live claude ~40s > 30000ms
   LLM_NARRATIVE_TIMEOUT_MS default → SIGTERM → fallback, so only 1/18 findings narrated). A success-vs-fallback counter
   would surface both this and the fence regression class. (cf. 2026-06-14-worker-http-client-default-30s-timeout.md — a
   second 30s-default timeout causing silent degradation; consider a project-wide "no silent fallback without a metric" rule.)
