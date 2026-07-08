"""Download the cdminix/libritts-aligned TextGrid archive.

Run manually on a dev host before an out-of-band carve (not invoked from the
Dockerfile carver stage). Kept as a standalone script so it can be re-run
independently ahead of `run_core_carve_pipeline`.
"""

import os
import shutil

from huggingface_hub import hf_hub_download

token = os.environ.get("HF_TOKEN") or None
path = hf_hub_download(
    "cdminix/libritts-aligned",
    "data/train_clean_100.tar.gz",
    repo_type="dataset",
    token=token,
    local_dir="/carve/alignment",
)
print("Alignment archive downloaded to:", path)
shutil.copy(path, "/carve/alignment/train_clean_100.tar.gz")
