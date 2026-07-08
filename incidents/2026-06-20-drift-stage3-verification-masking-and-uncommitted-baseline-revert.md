# Incident: drift-stage3 (ADR-031 D12) — verification-arg masking + uncommitted-baseline revert

Date: 2026-06-20
Feature: selfeval drift detection / Stage-3 (ADR-031 D12)
Outcome: resolved in proven-done; final verdict `done` (commit 52c4b24). Both defects caught by orchestrator Step 3.5 scrutiny + the 3 verifiers, before merge.

## What happened (two distinct accidents)

### 1. Wired-entrypoint crash masked by passing an explicit arg the entrypoint never passes
`_REPO_ROOT` in `compute_fingerprint.py` and `drift_check.py` used FIVE `..` instead of FOUR, resolving to `/Users/lihs/workspace` instead of `.../native-trace` → `FileNotFoundError` on the Dockerfile. `compute_fingerprint()` is called even on the skip path, so the wired entrypoint `pnpm test:drift` (which passes NO `--repo-root`) crashed on every invocation.

The implementer reported "all green" because its verification passed `--repo-root /Users/lihs/workspace/native-trace` explicitly in EVERY command (commands.txt:11,34) — exercising a convenience path the real entrypoint never takes. The default-arg derivation (the actual production path) was never run. Caught when the orchestrator re-ran the determinism check via the default path and hit the crash.

### 2. Uncommitted fixture re-pin silently reverted by sim `git checkout` cleanups
The manifest's live re-pin (analyzerCommit + gop.band + topNBest, the whole point of M-DRIFT-1) was made as an UNCOMMITTED working-tree edit. The acceptance sims patch the manifest then restore with `git checkout -- manifest.json`, which restores to HEAD (the placeholder), wiping the re-pin. So: the orchestrator's own determinism test wiped the first re-pin; the fix implementer re-pinned; its own sim cleanups wiped it again; the manifest oscillated back to the placeholder `[h,ə,l,oʊ,w,ɜː,l,d]` / `{-16,-5}` / `TODO`.

Every functional sim passed in the working tree (5 exit-code proofs, determinism flicker=0, unit 45 pass), but the COMMITTED/working state had the placeholder — so a fresh clone had a broken sentinel (skip path unreachable; benign always majority-IPA-regresses). static-verifier + spec-grader + runtime-verifier all converged on this single persistence blocker while agreeing the code was correct.

A subtlety surfaced: the old pin `[h,ə,l,oʊ,w,ɜː,l,d]` ≈ reference IPA, but the analyzer's real top-1 (rawTop1Conf=0.0142, diffuse CTC) is `[v,n,l,w,w,ɹ,l,n]`. The old pin was a mis-pin (reference used as observed), so re-pinning corrects it rather than masking a regression — documented honestly in the manifest note.

## Fix
- `_REPO_ROOT` → FOUR `..` in both files; verified the default path (no `--repo-root`) + `pnpm test:drift` resolve correctly.
- Demoted topNBest IPA-change from a HARD exact-match trigger to a majority-gated advisory (escalates only at ≥ ceil(N/2) changed positions); gop sign-flip / out-of-band(ε=2.0) / structural are the HARD triggers. Robust to diffuse-CTC noise (empirically flicker=0, but future-proofed).
- Committed the slice (52c4b24) with the live-pinned manifest → `git checkout` now restores to the committed live baseline, breaking the revert cycle. Re-verified all 5 exit-code proofs + skip on the committed state via the default path.

## Why the harness missed it (self-improve candidates)
1. **Verification that passes convenience args the real entrypoint omits gives a false-green on entrypoint reachability.** The implementer never exercised the default `--repo-root`. Candidate: a rule/checklist that runtime evidence MUST invoke the declared wiring_manifest/package.json entrypoint verbatim (no extra args), and the orchestrator Step 3.5 should grep commands.txt for entrypoint invocations that add args absent from the wired command.
2. **A fixture baseline that sims patch-and-`git checkout`-restore must be committed/staged FIRST**, else the restore reverts to HEAD and the intended re-pin is silently lost — green in working-tree sims, broken in the committed artifact. Candidate: implementer guidance to stage/commit a re-pinned baseline before running patch/restore sims, OR use cp-backup restore instead of `git checkout -- <file>`; and a done-gate check that the committed manifest (not just the working tree) carries the live pin (no "TODO"/"DUMMY"/placeholder in HEAD).
3. **An off-by-one path derivation (`parents[N]`) is invisible to build/unit/lint** — only a real default-path run catches it. Reinforces the mandatory observable-behavior assertion via the REAL entrypoint.

## Promotion
Forward 1–3 to `/self-improve` (failure-miner → harness-maintainer). Highest value: #1 (entrypoint-verbatim verification rule) + #2 (committed-baseline done-gate), since both turn a runtime-only catch into a gate-time catch. Relates to [[verify-scripts-skip-untracked]] (untracked/uncommitted false-green) and [[agent-dev-follow-pipeline-faithfully]].
