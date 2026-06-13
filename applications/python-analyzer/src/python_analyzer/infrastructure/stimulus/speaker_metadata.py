"""LibriTTS speaker metadata loader.

Parses SPEAKERS.txt from the LibriTTS archive to provide speaker sex information.
ADR-009: speaker sex (F/M) required for REQ-122 mixed-sex diversity check.
"""

from __future__ import annotations

import io
import tarfile
from pathlib import Path
from typing import Literal


def load_speaker_sex_map(
    corpus_archive_path: Path,
) -> dict[str, Literal["F", "M"]]:
    """Load speaker sex mapping from LibriTTS SPEAKERS.txt.

    Reads the SPEAKERS.txt file from the LibriTTS tar.gz archive.
    Only includes speakers whose subset is 'train-clean-100'.

    Args:
        corpus_archive_path: Path to the train-clean-100.tar.gz archive.

    Returns:
        Dict mapping speaker_id (str) to "F" or "M".

    Raises:
        FileNotFoundError: If the archive does not exist.
        ValueError: If SPEAKERS.txt cannot be found in the archive.
    """
    if not corpus_archive_path.exists():
        raise FileNotFoundError(f"LibriTTS archive not found: {corpus_archive_path}")

    with tarfile.open(corpus_archive_path, "r:gz") as archive:
        speakers_member = None
        for member in archive.getmembers():
            if member.name.lower().endswith("speakers.txt"):
                speakers_member = member
                break

        if speakers_member is None:
            raise ValueError("SPEAKERS.txt not found in LibriTTS archive")

        file_object = archive.extractfile(speakers_member)
        if file_object is None:
            raise ValueError("Cannot extract SPEAKERS.txt from archive")

        content = file_object.read().decode("utf-8")

    return _parse_speakers_txt(content)


def _parse_speakers_txt(content: str) -> dict[str, Literal["F", "M"]]:
    """Parse the pipe-separated SPEAKERS.txt content.

    Format: ID | SEX | SUBSET | MINUTES | NAME
    Comments start with ';'.
    """
    sex_map: dict[str, Literal["F", "M"]] = {}

    for line in io.StringIO(content):
        stripped = line.strip()
        if not stripped or stripped.startswith(";"):
            continue

        parts = [p.strip() for p in stripped.split("|")]
        if len(parts) < 4:
            continue

        speaker_id = parts[0].strip()
        sex = parts[1].strip().upper()
        subset = parts[2].strip()

        if subset == "train-clean-100" and sex in ("F", "M"):
            sex_map[speaker_id] = sex  # type: ignore[assignment]

    return sex_map
