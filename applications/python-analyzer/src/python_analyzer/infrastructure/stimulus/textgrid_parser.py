"""Praat TextGrid parser for word and phone boundary extraction.

Parses the Praat short-format TextGrid files produced by cdminix/libritts-aligned.
No external dependencies (pure stdlib).

ADR-009: word boundaries sourced from cdminix/libritts-aligned (CC BY 4.0,
pre-computed forced alignments). No local MFA run required.
"""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class WordInterval:
    """A single word interval from the TextGrid word tier."""

    word: str
    start_seconds: float
    end_seconds: float

    def duration_seconds(self) -> float:
        return self.end_seconds - self.start_seconds

    def is_silence(self) -> bool:
        return self.word.strip() == ""


def parse_textgrid_word_intervals(textgrid_content: str) -> list[WordInterval]:
    """Parse word intervals from a Praat TextGrid file.

    Extracts only the 'words' tier (tier 1 in libritts-aligned TextGrids).
    Silence intervals (empty text) are included so callers can identify
    inter-word boundaries.

    Args:
        textgrid_content: Raw UTF-8 content of a .TextGrid file.

    Returns:
        List of WordInterval objects in temporal order.

    Raises:
        ValueError: If the TextGrid cannot be parsed or has no 'words' tier.
    """
    lines = textgrid_content.splitlines()

    # Find the 'words' tier by scanning for 'name = "words"'
    words_tier_start = None
    for index, line in enumerate(lines):
        if re.match(r'\s*name\s*=\s*"words"\s*', line):
            words_tier_start = index
            break

    if words_tier_start is None:
        raise ValueError("No 'words' tier found in TextGrid content")

    # Find the 'phones' tier (or end of file) to bound the words tier
    words_tier_end = len(lines)
    for index in range(words_tier_start + 1, len(lines)):
        if re.match(r'\s*name\s*=\s*"phones"\s*', lines[index]):
            words_tier_end = index
            break

    words_section = lines[words_tier_start:words_tier_end]

    intervals: list[WordInterval] = []
    current_xmin: float | None = None
    current_xmax: float | None = None

    for line in words_section:
        stripped = line.strip()

        xmin_match = re.match(r"xmin\s*=\s*([0-9.eE+\-]+)", stripped)
        if xmin_match:
            current_xmin = float(xmin_match.group(1))
            current_xmax = None
            continue

        xmax_match = re.match(r"xmax\s*=\s*([0-9.eE+\-]+)", stripped)
        if xmax_match and current_xmin is not None:
            current_xmax = float(xmax_match.group(1))
            continue

        text_match = re.match(r'text\s*=\s*"([^"]*)"', stripped)
        if text_match and current_xmin is not None and current_xmax is not None:
            word = text_match.group(1)
            # Skip the tier-level xmin/xmax (they appear before any interval text)
            # Only add after we have seen both xmin and xmax for this interval.
            intervals.append(
                WordInterval(
                    word=word,
                    start_seconds=current_xmin,
                    end_seconds=current_xmax,
                )
            )
            current_xmin = None
            current_xmax = None

    if not intervals:
        raise ValueError("No word intervals found in TextGrid 'words' tier")

    return intervals


def find_word_boundary(
    word_intervals: list[WordInterval],
    target_word: str,
) -> list[WordInterval]:
    """Find all intervals matching the target word (case-insensitive).

    Args:
        word_intervals: Parsed word intervals from parse_textgrid_word_intervals.
        target_word: Word to search for (e.g. "right", "light").

    Returns:
        List of matching WordInterval objects (may be empty).
    """
    target_lower = target_word.lower().strip()
    return [
        interval
        for interval in word_intervals
        if interval.word.lower().strip() == target_lower
    ]
