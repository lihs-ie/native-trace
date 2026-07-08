# Incident: ADR-018 acoustic-phonetic-diagnosis — runtime dead-wiring caught only by runtime-verify

Date: 2026-06-19
Feature: acoustic-phonetic-diagnosis (ADR-018)
Outcome: resolved in proven-done loop 1; final verdict `done`.

## What happened (two distinct dead-wiring events)

### 1. GOP-site dead-`Nothing` (orchestrator hand-editing regression)
While finishing the Haskell worker, the orchestrator hand-edited `Scoring.hs` (instead of delegating to an implementer) and added the `acousticEvidence` let-binding but left the GOP construction site as `findingAcousticEvidence = Nothing`. Result: the binding was unused, every finding emitted `Nothing`, the feature was dead — yet `cabal build all` + `cabal test all` were green (project does NOT have `-Wunused-local-binds` as `-Werror`, so the unused binding did not fail the build). Caught by Step 3.5 grep + static-verifier orphan check. Root lesson reinforces [[agent-dev-follow-pipeline-faithfully]]: the orchestrator taking the keyboard introduced exactly the un-wired-completion accident the pipeline exists to prevent. Fix delegated back to an implementer.

### 2. scipy missing from analyzer Docker image (the decisive one)
`parselmouth_formant.py` (new) imports scipy for the spectral centroid. `scipy>=1.11.0` was declared in `applications/python-analyzer/pyproject.toml` but NOT in the analyzer `Dockerfile`'s hardcoded pip install list. After `docker compose up -d --build`, the image lacked scipy → `ModuleNotFoundError` at request time → swallowed by a broad `except Exception` that returned `()` for the whole utterance → `phonemeAcoustics: []` → worker `acousticEvidence: null` on every finding.

**Every gate except runtime-verify passed green**: `cabal build`, unit tests (they mock parselmouth and `pytest.skip` when deps are absent → the scipy import is never exercised), all four `verify-*.sh`, static-verifier, and spec-grader. Only the runtime-verifier (round 1), by POSTing a real WAV to the live rebuilt worker and asserting `acousticEvidence` non-null, caught it. This is the canonical "build/unit green but dead at runtime" failure and the exact justification for the mandatory observable-behavior assertion.

This is the recurrence of memory `python-analyzer-dockerfile-hardcoded-pip`: pyproject 更新だけでは実機に届かない。

## Fix
- Added `scipy>=1.11.0` to `applications/python-analyzer/Dockerfile` pip list.
- Hardened `parselmouth_formant.py`: scipy import moved to module top (fail-loud at startup, not silent per-request); per-phoneme centroid computation guarded so a centroid failure → `None` for that phoneme without discarding formants or the whole utterance.
- GOP site set to `= acousticEvidence`; M/F Lobanov guard scoped to `'unknown'`.

## Why the harness missed it (self-improve candidates)
1. **`verify-wiring` `python-analyzer-pyproject-needs-dockerfile` rule checks file-level co-change only, not Dockerfile CONTENT.** It reports OK when the Dockerfile is in the diff, but cannot verify the Dockerfile actually installs the new dep. Candidate: a check that parses new third-party imports under `applications/python-analyzer/**` and asserts the backing distribution appears in the Dockerfile pip list (or in an allowlist of base-image deps).
2. **No CI/Docker integration smoke** asserts `phonemeAcoustics` non-empty for a known multi-vowel WAV. The only env with real parselmouth (Docker) is never pytest-run with real deps; local pytest mocks/skips. Candidate: a post-build Docker smoke (`docker compose up -d --build && POST a fixture && assert phonemeAcoustics length >= 1`) wired into backend/analyzer CI.
3. **Broad `except Exception` that downgrades a missing hard dependency to empty output** is a fail-open anti-pattern. Candidate: a lint/ast-grep flag for `except Exception` blocks that swallow `ImportError`/`ModuleNotFoundError` in production infrastructure.
4. **`-Wunused-local-binds` is not `-Werror` in the worker** — an unused computed binding (the GOP-site bug) compiled clean. Candidate: enable it as an error to catch "computed but never consumed" wiring gaps at build time.

## Promotion
Forward 1–4 to `/self-improve` (failure-miner → harness-maintainer). Highest value: #1 (Dockerfile-content dep check) + #2 (Docker integration smoke), since they would have caught this at gate time instead of relying on runtime-verify.
