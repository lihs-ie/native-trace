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

**Note**: parselmouth (GPL-3.0) is NOT used in the golden-speaker service.
F0 extraction uses librosa pyin (ISC license) to maintain license-clean status (ADR-012).

## Model Weight Supply

Model weights are NOT baked into the Docker image (M-GRV-10 / ADR-012 Compliance).
They are supplied at runtime via:
- `HF_HOME` volume mount (`hf-cache-golden` in compose.yaml)
- HuggingFace Hub download on first use (`huggingface_hub.hf_hub_download`)

## Compliance Summary

All components used in the golden-speaker service are Apache-2.0 / MIT / BSD / CC BY,
which complies with REQ-NF-101. No GPL-family component is included.
Any distribution model change (SaaS launch, image conveyance to third parties)
must re-confirm license terms per ADR-012 Compliance section.
