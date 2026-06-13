# Accept parselmouth (GPL-3.0) as internal dependency of the Python analysis service

ADR-006: parselmouth GPL-3.0 license boundary

# Status: Accepted

# Context

ADR-001 adds a `python-analyzer` service that performs raw acoustic measurement (GOP, forced alignment,
F0 contour, prosody, word stress). ADR-005 structures that service with onion architecture and extends
the fitness functions to Python.

The prosody measurement layer (`infrastructure/parselmouth_prosody.py`) uses **parselmouth**
(`praat-parselmouth`), the Python binding for Praat. parselmouth is licensed under **GPL-3.0**. It is
the only readily available open-source library that exposes Praat's pitch tracking, intensity, and
speech analysis algorithms from Python with CPU-only operation, satisfying REQ-007 (local CPU) and the
F0/intensity measurement required by ADR-001 (GOP + prosody scoring) and the `predictedStress`
computation (M-114R in the pronunciation-feedback-v2-residuals spec).

REQ-NF-101 (OSS license constraint) explicitly names parselmouth as a known GPL-3.0 library and
requires that its license impact be judged in an ADR, with the python-analyzer internal use as the
designated boundary.

NativeTrace is currently a **local MVP**. There is no third-party distribution, no SaaS deployment,
and no binary conveyance to end users outside the development team.

# Decision

Accept **GPL-3.0** for parselmouth under the following reasoning:

1. **Process isolation**: parselmouth exists solely inside the `python-analyzer` Docker container.
   The frontend (Next.js) and the Haskell worker communicate with that container over an **HTTP
   boundary**. They do not link against, embed, or bundle any GPL-3.0 code. Under GPL-3.0 (not
   AGPL-3.0), network interaction does not constitute distribution or derivative work; the HTTP
   boundary is a sufficient process separation.

2. **No conveyance in local MVP**: GPL-3.0 obligations (source disclosure, license propagation)
   are triggered by conveying the software to third parties. In the current local-only deployment,
   no conveying occurs, so no GPL-3.0 source-disclosure obligation is activated.

3. **Scope**: parselmouth is imported only in `applications/python-analyzer/` — specifically
   in `infrastructure/parselmouth_prosody.py`. The frontend and the Haskell worker contain no
   reference to parselmouth and are not GPL derivatives.

**Constraints (must remain true for this decision to hold)**:

- parselmouth import is confined to `applications/python-analyzer/`. Any import outside that
  directory (frontend, Haskell worker, other packages) would void this boundary judgment.
- If the distribution model changes — product bundling with the analyzer binary, SaaS deployment
  serving end users, or any conveyance of the container image to third parties — the GPL-3.0
  obligations must be re-evaluated before release. At minimum, source code of the `python-analyzer`
  service must be offered to recipients.
- If `python-analyzer` is distributed as a standalone binary or container image to parties outside
  the development team, GPL-3.0 requires that the complete corresponding source of the service
  (not of the frontend or worker) be made available.

# Consequences

Positive:

- parselmouth gives direct access to Praat's pitch tracking and intensity algorithms, which are
  the industry reference for F0 measurement in speech science. This satisfies the M-114R
  requirement (F0 peak / intensity / vowel duration integration for `predictedStress`) without
  writing a custom signal-processing pipeline.
- No impact on the frontend or Haskell worker license posture; both remain permissively licensed
  (Apache-2.0 / MIT ecosystem).

Negative / trade-offs:

- The analyzer service itself is now GPL-3.0 encumbered for distribution purposes. Anyone
  distributing the analyzer container image must comply with GPL-3.0 (source availability for
  that service).
- If a non-GPL alternative for F0/intensity measurement becomes viable (e.g., a permissively
  licensed Praat-equivalent Python library), replacing parselmouth would remove this encumbrance.
  The import is isolated to `infrastructure/parselmouth_prosody.py`, so replacement is bounded.

Alternatives considered:

- **(a) Remove parselmouth.** This would require reverting the prosody measurement implementation
  completed in M-114R (F0 contour, word stress prediction, intensity). That feature is done and
  tested; reverting it has no benefit for the local MVP and would degrade pronunciation feedback
  quality.
- **(b) Non-GPL F0 estimation (custom implementation).** Writing a pitch tracker with comparable
  accuracy to Praat's SHS/autocorrelation algorithm is a significant engineering effort
  disproportionate to a local MVP. Accuracy and maintenance cost make this impractical at this stage.

# Compliance

- An **ast-grep rule** (`no-parselmouth-outside-python-analyzer.yml`) statically enforces that
  `import parselmouth` and `from parselmouth import` do not appear outside
  `applications/python-analyzer/`. This rule runs at edit time (fitness hook) and in CI,
  consistent with the layer-closure discipline established in ADR-005.
- parselmouth is listed explicitly in the `applications/python-analyzer/Dockerfile` pip install
  list (`praat-parselmouth`). It is not added to any other service's dependency manifest.
- Any change to the distribution model (SaaS launch, container image conveyance to third parties)
  must include a re-evaluation of GPL-3.0 obligations before that change ships.

# Notes

- Author: lihs
- Approval date: 2026-06-13
- Approver:
- Last updated: 2026-06-13
- Changes: Initial entry. Related: ADR-001 (introduces python-analyzer), ADR-002 (espeak g2p),
  ADR-005 (Python service onion architecture and fitness functions).
  REQ-NF-101 (OSS license constraint) is the originating requirement.
