# Structure the Python analysis service with onion architecture and extend fitness functions to Python

ADR-005: Python analysis service architecture and fitness functions

# Status

Proposed

# Context

ADR-001 adds a Python analysis service (`python-analyzer`) that performs raw measurement (espeak g2p, wav2vec2 phoneme-CTC GOP, forced alignment, detected IPA, inter-word silence, schwa realization, speech rate). This is a new layer and a new toolchain (Python, `torch`, `wav2vec2`, `espeak-ng`, `phonemizer`) in a repository whose architectural order is enforced by fitness functions, not prompts: ast-grep rules and ESLint dependency-direction checks for the frontend, hlint/ast-grep for the Haskell worker, run at edit time (hooks) and in CI. The project rule requires that introducing a new layer or library ships its corresponding fitness functions in the same PR. The existing ast-grep rules target TypeScript and Haskell; Python is outside their scope.

The service is physically isolated behind HTTP, and the domain logic (scoring) lives in the Haskell worker (ADR-004), so the Python service holds no scoring domain of its own.

Alternatives considered:

- **Treat it as a thin measurement service (ruff + a contract schema only), no internal layering.** Lighter for the MVP, but inconsistent with the repository's whole-codebase onion + fitness-function discipline and leaves the new layer's dependency direction unchecked.
- **Minimal (ruff only), defer wiring and docs.** Violates the same-PR rule for new layers and lets un-wired / contract-drift go undetected.

# Decision

Structure the Python analysis service with **onion architecture** — split into domain and infrastructure layers with dependencies pointing inward — and **extend the fitness functions to Python**. The inner-to-outer import direction is enforced with ast-grep (Python rules) and `ruff`, run at edit time and in CI, matching how the frontend and the Haskell worker are governed.

The supporting design documents (`docs/02-system-design`, `docs/03-detailed-design`) are updated in the same change to reflect the `python-analyzer` service and the worker ↔ analyzer contract.

# Consequences

Positive:

- Architectural order is uniform across all three stacks (frontend, Haskell worker, Python service); the dependency direction of the new layer is machine-checked, not assumed.
- Ready for the day the Python side grows real domain logic, without a later restructure.

Negative / trade-offs:

- Higher MVP cost: onion layering and Python-specific ast-grep rules are more setup than a measurement-only service strictly needs today.
- Adds Python to the fitness-function and CI matrix, increasing the surface that must stay green.

# Compliance

- ast-grep rules (Python) plus `ruff` enforce the inner-to-outer import direction inside the Python service; both run in the edit-time fitness hook and in CI.
- `wiring_manifest.yml` registers the `haskell-worker → python-analyzer` edge and asserts the Python service does not import frontend/backend internal types (HTTP contract only).
- `docs/02-system-design` and `docs/03-detailed-design` must be updated in the same PR as the service is introduced (this ADR's own consistency gate).

# Notes

- Author: lihs
- Approval date:
- Approver:
- Last updated: 2026-06-11
- Changes: Initial draft. Related: ADR-001 (introduces the service), ADR-002 (g2p placement), ADR-004 (scoring stays in the Haskell worker).
