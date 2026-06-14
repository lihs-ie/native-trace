# License Notes: golden-rvc model weights

Confirmation against REQ-NF-101 (OSS license: Apache-2.0 / MIT / BSD / CC BY).
Updated: 2026-06-14.
Author: lihs.

## RVC Engine

| Component | Source | License | REQ-NF-101 |
|-----------|--------|---------|------------|
| rvc-python | https://pypi.org/project/rvc-python/ / https://github.com/daswer123/rvc-python | MIT | Compliant |
| torch (CPU wheel) | https://pytorch.org/get-started/locally/ | BSD-3-Clause | Compliant |
| torchaudio | https://pytorch.org/ | BSD-2-Clause | Compliant |

## Content Encoder / Pitch Model

| Component | Source | License | REQ-NF-101 |
|-----------|--------|---------|------------|
| ContentVec / hubert_base | https://github.com/auspicious3000/contentvec | MIT | Compliant |
| rmvpe (pitch extractor) | https://github.com/Dream-High/RMVPE | MIT | Compliant |

## Target Voice Model Weights

| Component | Source | License | REQ-NF-101 |
|-----------|--------|---------|------------|
| Nekochu/RVC-VCTK_Voice-sample | https://huggingface.co/Nekochu/RVC-VCTK_Voice-sample | Apache-2.0 | Compliant |
| VCTK Corpus (training data) | https://datashare.ed.ac.uk/handle/10283/2651 | CC BY 4.0 | Compliant |

### VCTK Attribution

- Dataset: CSTR VCTK Corpus (University of Edinburgh)
- Authors: Christophe Veaux, Junichi Yamagishi, Kirsten MacDonald
- Institution: The Centre for Speech Technology Research (CSTR), University of Edinburgh
- License: Creative Commons Attribution 4.0 International (CC BY 4.0)
- URL: https://datashare.ed.ac.uk/handle/10283/2651
- Citation: Veaux, C., Yamagishi, J., MacDonald, K. (2017). CSTR VCTK Corpus: English Multi-speaker Corpus for CSTR Voice Cloning Toolkit. University of Edinburgh. The Centre for Speech Technology Research (CSTR).

## Quality Gate

| Component | Source | License | REQ-NF-101 |
|-----------|--------|---------|------------|
| librosa (F0 via pyin) | https://librosa.org/ | ISC | Compliant |
| numpy | https://numpy.org/ | BSD-3-Clause | Compliant |

**Note**: the golden-speaker service's **own code** uses librosa pyin (ISC) for F0
extraction in the quality gate, and does **not** import parselmouth directly.

## Transitive GPL dependency (rvc-python → praat-parselmouth)

| Component | Source | License | REQ-NF-101 |
|-----------|--------|---------|------------|
| praat-parselmouth (transitive dep of rvc-python) | https://github.com/YannickJadoul/Parselmouth | GPL-3.0 | Service-isolated |
| fairseq (transitive dep of rvc-python) | https://github.com/facebookresearch/fairseq | MIT | Compliant |

**rvc-python pins `praat-parselmouth>=0.4.2` (GPL-3.0) as a dependency**, so the GPL is
present in the golden-speaker service's dependency tree even though the service code does
not import it. This is handled the same way as parselmouth in the python-analyzer service
(ADR-006): **GPL is isolated inside a single service reached only over an HTTP boundary**, and
no GPL import leaks into the frontend, the Haskell worker, or python-analyzer (enforced by
`.ast-grep/rules/no-rvc-outside-golden-speaker.yml`). ADR-012 was amended (2026-06-14) to
correct its original "no GPL-family encumbrance" claim accordingly.

## Model Weight Supply

Model weights are NOT baked into the Docker image (M-GRV-10 / ADR-012 Compliance).
They are supplied at runtime via:
- `HF_HOME` volume mount (`hf-cache-golden` in compose.yaml)
- HuggingFace Hub download on first use (`huggingface_hub.hf_hub_download`)

## Compliance Summary

The model weights (target voice, content encoder, pitch) and the golden-speaker service's
own runtime code are Apache-2.0 / MIT / BSD / CC BY / ISC, complying with REQ-NF-101. The
one GPL-3.0 component (praat-parselmouth) enters transitively via rvc-python and is
**isolated inside the golden-speaker service at its HTTP boundary** (ADR-006 pattern;
ADR-012 amended 2026-06-14) — it does not leak into the frontend, worker, or python-analyzer.
Any distribution model change (SaaS launch, image conveyance to third parties) must re-confirm
license terms — including the GPL obligations of the isolated golden-speaker service — per the
ADR-012 Compliance section.
