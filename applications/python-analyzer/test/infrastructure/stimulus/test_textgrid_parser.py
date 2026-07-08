"""Tests for the Praat TextGrid parser.

Tests parse_textgrid_word_intervals and find_word_boundary against a
minimal synthetic TextGrid that mirrors the cdminix/libritts-aligned format.
"""

from __future__ import annotations

import pytest

from python_analyzer.infrastructure.stimulus.textgrid_parser import (
    find_word_boundary,
    parse_textgrid_word_intervals,
)

# Minimal TextGrid with 'words' and 'phones' tiers (same structure as libritts-aligned)
_SAMPLE_TEXTGRID = """
File type = "ooTextFile"
Object class = "TextGrid"

xmin = 0
xmax = 2.5
tiers? <exists>
size = 2
item []:
    item [1]:
        class = "IntervalTier"
        name = "words"
        xmin = 0
        xmax = 2.5
        intervals: size = 5
        intervals [1]:
            xmin = 0
            xmax = 0.05
            text = ""
        intervals [2]:
            xmin = 0.05
            xmax = 0.35
            text = "right"
        intervals [3]:
            xmin = 0.35
            xmax = 0.55
            text = ""
        intervals [4]:
            xmin = 0.55
            xmax = 0.85
            text = "light"
        intervals [5]:
            xmin = 0.85
            xmax = 2.5
            text = ""
    item [2]:
        class = "IntervalTier"
        name = "phones"
        xmin = 0
        xmax = 2.5
        intervals: size = 10
        intervals [1]:
            xmin = 0
            xmax = 0.05
            text = ""
"""


class TestParseTextgridWordIntervals:
    """Tests for parse_textgrid_word_intervals."""

    def test_returns_all_intervals_including_silence(self) -> None:
        intervals = parse_textgrid_word_intervals(_SAMPLE_TEXTGRID)
        assert len(intervals) == 5

    def test_non_silence_words_are_parsed(self) -> None:
        intervals = parse_textgrid_word_intervals(_SAMPLE_TEXTGRID)
        words = [i.word for i in intervals if not i.is_silence()]
        assert words == ["right", "light"]

    def test_timing_is_correct(self) -> None:
        intervals = parse_textgrid_word_intervals(_SAMPLE_TEXTGRID)
        right_interval = next(i for i in intervals if i.word == "right")
        assert right_interval.start_seconds == pytest.approx(0.05)
        assert right_interval.end_seconds == pytest.approx(0.35)

    def test_silence_intervals_identified(self) -> None:
        intervals = parse_textgrid_word_intervals(_SAMPLE_TEXTGRID)
        silence = [i for i in intervals if i.is_silence()]
        assert len(silence) == 3

    def test_raises_value_error_for_missing_words_tier(self) -> None:
        bad_textgrid = """
File type = "ooTextFile"
Object class = "TextGrid"
xmin = 0
xmax = 1.0
tiers? <exists>
size = 1
item []:
    item [1]:
        class = "IntervalTier"
        name = "phones"
        xmin = 0
        xmax = 1.0
        intervals: size = 1
        intervals [1]:
            xmin = 0
            xmax = 1.0
            text = "R"
"""
        with pytest.raises(ValueError, match="words"):
            parse_textgrid_word_intervals(bad_textgrid)

    def test_duration_seconds(self) -> None:
        intervals = parse_textgrid_word_intervals(_SAMPLE_TEXTGRID)
        right_interval = next(i for i in intervals if i.word == "right")
        assert right_interval.duration_seconds() == pytest.approx(0.30, abs=1e-6)


class TestFindWordBoundary:
    """Tests for find_word_boundary."""

    def test_finds_exact_match(self) -> None:
        intervals = parse_textgrid_word_intervals(_SAMPLE_TEXTGRID)
        matches = find_word_boundary(intervals, "right")
        assert len(matches) == 1
        assert matches[0].word == "right"

    def test_case_insensitive(self) -> None:
        intervals = parse_textgrid_word_intervals(_SAMPLE_TEXTGRID)
        matches = find_word_boundary(intervals, "RIGHT")
        assert len(matches) == 1

    def test_returns_empty_for_absent_word(self) -> None:
        intervals = parse_textgrid_word_intervals(_SAMPLE_TEXTGRID)
        matches = find_word_boundary(intervals, "cat")
        assert matches == []

    def test_finds_both_pair_members(self) -> None:
        intervals = parse_textgrid_word_intervals(_SAMPLE_TEXTGRID)
        right_matches = find_word_boundary(intervals, "right")
        light_matches = find_word_boundary(intervals, "light")
        assert len(right_matches) == 1
        assert len(light_matches) == 1
