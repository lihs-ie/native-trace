"""domain/phoneme.py のユニットテスト。"""

import pytest

from python_analyzer.domain.phoneme import (
    AlignmentBoundary,
    GopScore,
    IpaSequence,
    PhonemeLabel,
)


class TestPhonemeLabel:
    def test_valid_label(self) -> None:
        label = PhonemeLabel("h")
        assert label.value == "h"

    def test_empty_label_raises(self) -> None:
        with pytest.raises(ValueError, match="cannot be empty"):
            PhonemeLabel("")


class TestGopScore:
    def test_valid_score(self) -> None:
        score = GopScore(value=-1.5)
        assert score.value == -1.5


class TestIpaSequence:
    def test_from_string(self) -> None:
        seq = IpaSequence.from_string("h ə l oʊ")
        assert len(seq.phonemes) == 4
        assert seq.phonemes[0].value == "h"

    def test_to_string(self) -> None:
        seq = IpaSequence(phonemes=(PhonemeLabel("h"), PhonemeLabel("ə")))
        assert seq.to_string() == "h ə"

    def test_empty_sequence(self) -> None:
        seq = IpaSequence.from_string("")
        assert len(seq.phonemes) == 0


class TestAlignmentBoundary:
    def test_valid_boundary(self) -> None:
        boundary = AlignmentBoundary(
            phoneme=PhonemeLabel("h"),
            start_milliseconds=0,
            end_milliseconds=100,
        )
        assert boundary.start_milliseconds == 0
        assert boundary.end_milliseconds == 100

    def test_negative_start_raises(self) -> None:
        with pytest.raises(ValueError, match="non-negative"):
            AlignmentBoundary(
                phoneme=PhonemeLabel("h"),
                start_milliseconds=-1,
                end_milliseconds=100,
            )

    def test_end_before_start_raises(self) -> None:
        with pytest.raises(ValueError, match="end_milliseconds"):
            AlignmentBoundary(
                phoneme=PhonemeLabel("h"),
                start_milliseconds=100,
                end_milliseconds=50,
            )
