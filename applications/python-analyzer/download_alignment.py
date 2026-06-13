"""Download the cdminix/libritts-aligned TextGrid archive at Docker build time.

Run inside the Dockerfile carver stage (see Dockerfile). Kept as a standalone
script because a multi-line `RUN python -c "..."` is misparsed by the Dockerfile
front-end (each newline is read as a separate instruction).
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
