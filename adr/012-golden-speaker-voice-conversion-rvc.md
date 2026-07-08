# Implement golden speaker (self-voice native-style conversion) with RVC as a separate GPU-optional service

ADR-012: golden speaker voice conversion (RVC)

# Status: Accepted

# Context

REQ-128 specifies a **golden speaker** capability: synthesize a native-style pronunciation in the
learner's own voice so the learner hears a reachable target rather than a stranger's voice. Its
acceptance criteria require that the feature is an option enabled **only in a GPU-optional
environment**, that conversion is performed at **segment level** (prosody-only conversion has no
effect — Felps et al. 2009), that the learner can switch and compare **self golden speaker / native
TTS / own recording**, that **usage logs** are recorded for effect verification, and that a synthesis
**quality gate** withholds the result when the output does not reach a usable level. REQ-NF-102
requires CPU to be the baseline and GPU-prerequisite features (golden speaker among them) to be
**separated as options**, and requires the GPU backend not to leak into the Next.js analysis
interface. REQ-NF-101 sets the OSS license rule: production inclusion is Apache-2.0 / MIT / BSD / CC BY
by default, and GPL-family components are isolated at a service boundary or replaced.

The research report records that golden speaker / self-imitation evidence is **weak** — no RCT, only
small before/after comparisons (n=6–35; Ding et al. 2019 and others), with prosody-only conversion
shown ineffective (Felps et al. 2009). The historical bottleneck was synthesis quality (MOS ≈ 2.2);
modern voice conversion reaches MOS around 4.0 (research §3.3-7). For the conversion engine itself,
research T-6 names **RVC** (MIT; trainable on under ten minutes of data; inference runnable on CPU,
training requiring GPU), **kNN-VC** (MOS 4.03, training-free zero-shot, but its WavLM encoder is
GPU-recommended), and flags **seed-vc as GPL-3.0** to watch.

The current product ships only an honest empty-state placeholder for this feature: in
`applications/frontend/src/components/workspace/WorkspaceResultV2.tsx` the audio source can be
`self` / `model` / `golden`, the `golden` source renders a "Golden speaker — GPU 必要 / 準備中"
placeholder, and the `--src-golden` design token already names a third source identity in the
`.ab-srcs` A/B switch. No conversion implementation exists. ADR-001's `python-analyzer` service
(which embeds the GPL-3.0 parselmouth, judged in ADR-006) performs raw acoustic measurement and holds
no synthesis. ADR-009's native TTS (Kokoro, ADR-001) and the learner's own recording are the two
existing audio sources; golden speaker is the third.

Alternatives considered:

- **(1) RVC (MIT) as a separate GPU-optional service.** RVC is permissively licensed (MIT),
  redistributable, and its inference path runs on CPU while only training requires GPU — matching the
  CPU-baseline / GPU-optional split of REQ-NF-102. As a standalone service behind HTTP, it integrates
  into the existing A/B model-example flow without altering the analysis or scoring boundaries.
- **(2) kNN-VC (training-free zero-shot, MOS 4.03).** Its WavLM encoder is GPU-recommended even for
  inference, which is heavy for a local CPU MVP, and the additional encoder dependency enlarges the
  service. Its zero-shot convenience does not outweigh the CPU-inference and dependency cost for this
  stage.
- **(3) Keep golden speaker a Non-goal.** Leaves the honest placeholder in place with no engine. This
  was the prior position; the decision here is to implement the feature, so deferral is no longer the
  choice.

**seed-vc is not adopted**: it is GPL-3.0, and a permissive (MIT) engine that meets the requirement is
available, so taking on a GPL-family conversion engine is unwarranted.

# Decision

**Implement golden speaker (REQ-128) with RVC (MIT), as an independent GPU-optional service separated
from `python-analyzer` by an HTTP boundary.** Inference runs on CPU; training requires GPU. Only
conversions that pass a quality gate are presented, and A/B switching plus usage logs are recorded;
because the research evidence is weak, the feature is treated as a verification phase.

1. **Separate service, separate container.** The RVC engine lives in its own service and container,
   distinct from `python-analyzer`. The frontend and the Haskell worker reach it only over an **HTTP
   boundary**, mirroring how the worker reaches `python-analyzer` through `ANALYZER_URL`. The golden
   speaker service is reached through its own boundary environment variable (the concrete name is
   fixed during implementation), declared as a `compose.yaml` service alongside `worker` and
   `analyzer`. The frontend and worker hold no RVC import.

2. **GPU-optional, CPU-baseline.** RVC **inference** runs on CPU, so the conversion service operates in
   a CPU-only environment; **training** of a learner voice model requires GPU and is therefore an
   optional, separately-enabled step. The application body must run with the golden speaker service
   disabled — when it is off, the existing `golden` source keeps its honest "GPU 必要 / 準備中"
   placeholder and no other feature degrades. The GPU backend does not leak into the Next.js analysis
   interface (REQ-NF-102): the frontend sees only the HTTP contract.

3. **Segment-level conversion.** Conversion is performed at segment level, not prosody-only, because
   prosody-only conversion has no effect (Felps et al. 2009). This is a contract requirement of the
   service, not an internal preference.

4. **Quality gate before presentation.** A conversion is presented only after passing a synthesis
   quality gate; conversions that do not reach a usable level are withheld rather than shown. The gate
   threshold (objective metric and/or MOS criterion) is fixed during implementation; this ADR does not
   assert a specific numeric threshold.

5. **Third audio source in the existing A/B switch.** Golden speaker is the third audio source
   alongside native TTS (ADR-009 / Kokoro, ADR-001) and the learner's own recording. It reuses the
   existing `WorkspaceResultV2` `.ab-srcs` A/B switch and the `--src-golden` source-identity design
   token already present. A/B switching among self golden speaker / native TTS / own recording and the
   usage logging required for effect verification are wired through the use-case layer.

**Constraints (must remain true for this decision to hold)**:

- RVC import and its dependencies are confined to the golden speaker service. Any RVC reference inside
  `python-analyzer`, the frontend, or the Haskell worker voids this boundary, mirroring the
  parselmouth confinement of ADR-006.
- The application body must function with the golden speaker service disabled. The GPU-prerequisite
  path (training, and any GPU-only inference acceleration) is an option whose absence does not break
  the rest of the app (REQ-NF-102).
- No conversion is presented without passing the quality gate. A below-gate conversion must be
  withheld, not surfaced.
- seed-vc (GPL-3.0) is not adopted. If RVC is later replaced, the replacement's license is
  re-evaluated against REQ-NF-101 before adoption.

# Consequences

Positive:

- The license posture is contained: RVC itself is MIT (permissive, redistributable). The frontend and
  worker remain permissively licensed, and any GPL encumbrance is confined to the golden speaker
  service at its HTTP boundary.
  **Amendment (2026-06-14):** implementation revealed that the chosen CPU-installable package
  `rvc-python` transitively pulls `praat-parselmouth` (GPL-3.0) as a dependency. The golden speaker
  service is therefore **GPL-isolated at the service boundary — the same posture as the
  python-analyzer service (ADR-006), not GPL-free** as this ADR originally stated. This is acceptable
  under the ADR-006 precedent (GPL contained in a separate service reached only over HTTP, no GPL
  import leaking into frontend/worker/python-analyzer), but the "no GPL-family encumbrance" framing
  above was wrong and is corrected here. The golden service's own code imports `parselmouth` directly
  for the F0-continuity quality gate (with a `numpy` BSD-3 autocorrelation fallback); this direct use
  is permitted because parselmouth is GPL-isolated within the golden-speaker service boundary, the same
  posture as ADR-006. The fitness rule `no-parselmouth-outside-python-analyzer` is extended to allow
  `applications/golden-speaker/**` accordingly. (`librosa` remains pinned only as an rvc-python
  transitive dependency and is not used directly by the golden service code.)
- CPU inference keeps the local MVP usable without GPU; GPU is needed only to train a learner voice
  model, which is the genuinely optional step.
- Reusing the existing `.ab-srcs` switch and `--src-golden` token means the feature lands in the model
  example flow already designed for it, replacing an honest placeholder with a real third source rather
  than adding new UI surface.
- The quality gate and usage logging make the weak-evidence feature a measurable verification phase
  rather than an unconditional claim.

Negative / trade-offs:

- A new standalone service adds a container, an HTTP boundary, and use-case wiring beyond the existing
  `worker` / `analyzer` pair.
- Training a learner voice model requires GPU and per-learner data, so the full feature is unavailable
  to CPU-only users; only the application body and the non-golden sources work there.
- The underlying evidence for golden speaker is weak (no RCT, small before/after studies), so the
  feature is justified as a verification-phase differentiator, not as an established intervention; if
  the usage logs do not show benefit, the feature's continuation is reconsidered.

Alternatives considered:

- **(2) kNN-VC** is rejected: its WavLM encoder is GPU-recommended even for inference, which is heavy
  for a local CPU MVP and enlarges the dependency surface; its training-free convenience does not
  justify that cost at this stage.
- **(3) Keep golden speaker a Non-goal** is rejected: the decision is to implement REQ-128 now, so
  leaving the placeholder without an engine is no longer the position.
- **seed-vc** is rejected on license grounds: it is GPL-3.0 and a permissive (MIT) engine meeting the
  requirement exists.

# Compliance

- An **ast-grep / grep rule** statically enforces that RVC imports and dependencies do not appear
  outside the golden speaker service — specifically not in `python-analyzer`, the frontend, or the
  Haskell worker — mirroring the `no-parselmouth-outside-python-analyzer` rule of ADR-006. It runs at
  edit time (fitness hook) and in CI.
- The golden speaker service is registered as its own `compose.yaml` service with its own boundary
  environment variable, alongside `worker` and `analyzer`; `wiring_manifest.yml` registers the
  frontend/worker → golden speaker HTTP edge and asserts the service imports no frontend/backend
  internal types (HTTP contract only), consistent with ADR-005's boundary discipline. Per the same-PR
  rule for new layers (ADR-005), introducing the service ships its fitness-function entries in the same
  PR.
- A check asserts that the GPU-prerequisite path is optional: the application body builds and runs with
  the golden speaker service disabled, and the GPU backend is not referenced from the Next.js analysis
  interface (REQ-NF-102).
- The code-review rubric verifies that a conversion is never presented without passing the quality
  gate, and that the use-case layer records A/B usage logs for effect verification (REQ-128).
- RVC's pretrained model weights are not baked into the service image and their license is confirmed at
  implementation time against REQ-NF-101 before inclusion (consistent with ADR-001's not-baked model
  handling); this ADR does not assert a specific weight license.
- Any change to the distribution model (SaaS launch, container image conveyance to third parties) must
  re-confirm the RVC and model-weight license terms before that change ships.

# Notes

- Author: lihs
- Approval date: 2026-06-13
- Approver:
- Last updated: 2026-06-18 (amended)
- Amended 2026-06-18 (pronunciation-remediation batch): ADR-019 (acoustic-to-articulatory inversion) adds an `aai` service that follows this ADR's GPU-optional isolated-service precedent: a compose `profiles` gate, a dedicated `AAI_URL` boundary env var, no `depends_on`, the same-PR fitness-function rule, a Hugging Face cache volume, model weights not baked into the image, an explicit 120s timeout, verification-phase treatment, and a multipart request contract.
- Changes: Initial entry (2026-06-13). Amended 2026-06-14: corrected the license posture — the CPU
  RVC stack (rvc-python) transitively pulls praat-parselmouth (GPL-3.0), so the golden speaker service
  is GPL-isolated at its service boundary (ADR-006 pattern), not GPL-free; the CPU MVP converts to a
  generic VCTK native voice, not the learner's own voice (self-voice requires GPU training, deferred
  per the GPU-only path). Related: ADR-007 (Training Context; golden speaker's usage logs and effect
  verification belong to the training/verification loop), ADR-005 (Python service onion architecture
  and service separation; same-PR fitness-function rule), ADR-006 (license-boundary judgment precedent
  and the no-import-outside enforcement pattern), ADR-001 (native TTS via Kokoro as the first model
  example source; not-baked model handling). Originating requirements: REQ-128 (golden speaker),
  REQ-NF-102 (CPU baseline / GPU optional), REQ-NF-101 (OSS license constraint). Research basis: T-6
  (RVC / kNN-VC / seed-vc engine comparison), §3.3-7 (golden speaker weak evidence; prosody-only
  ineffective per Felps et al. 2009; modern VC MOS ≈ 4.0).
