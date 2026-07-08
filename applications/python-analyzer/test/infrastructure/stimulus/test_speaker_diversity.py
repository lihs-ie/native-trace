"""Tests for speaker diversity requirements (REQ-122).

Tests ContrastCarveSummary.satisfies_req122() and the speaker metadata
loader against a synthetic SPEAKERS.txt.
"""

from __future__ import annotations

from python_analyzer.infrastructure.stimulus.domain import (
    ContrastCarveSummary,
    PhonologicalContext,
    StimulusSource,
)
from python_analyzer.infrastructure.stimulus.speaker_metadata import (
    _parse_speakers_txt,
)

_SAMPLE_SPEAKERS_TXT = """; Sample SPEAKERS.txt for testing.
;ID  |SEX| SUBSET           |MINUTES| NAME
19   | F | train-clean-100  | 25.19 | Kara Shallenberg
26   | M | train-clean-100  | 25.08 | Denny Sayers
27   | M | train-clean-100  | 20.14 | Sean McKinley
32   | F | train-clean-100  | 24.01 | Betsie Bush
40   | M | train-clean-100  | 22.30 | Test Male
60   | F | train-clean-360  | 25.00 | Other Subset
100  | M | train-other-500  | 30.00 | Wrong Subset
"""


class TestParseSpeakersTxt:
    """Tests for _parse_speakers_txt."""

    def test_parses_train_clean_100_speakers(self) -> None:
        result = _parse_speakers_txt(_SAMPLE_SPEAKERS_TXT)
        # Only train-clean-100 speakers should be included.
        assert "19" in result
        assert "26" in result
        assert "27" in result
        assert "32" in result
        assert "40" in result

    def test_excludes_other_subsets(self) -> None:
        result = _parse_speakers_txt(_SAMPLE_SPEAKERS_TXT)
        assert "60" not in result  # train-clean-360
        assert "100" not in result  # train-other-500

    def test_sex_values(self) -> None:
        result = _parse_speakers_txt(_SAMPLE_SPEAKERS_TXT)
        assert result["19"] == "F"
        assert result["26"] == "M"
        assert result["32"] == "F"
        assert result["40"] == "M"


class TestContrastCarveSummaryReq122:
    """Tests for ContrastCarveSummary.satisfies_req122."""

    def test_satisfies_with_5_speakers_mixed_sex_multi_context(self) -> None:
        summary = ContrastCarveSummary(contrast="r-l", source=StimulusSource.LIBRITTS)
        summary.speaker_identifiers = ["19", "26", "27", "32", "40"]
        summary.speaker_sexes = ["F", "M", "M", "F", "M"]
        summary.contexts = [
            PhonologicalContext.WORD_INITIAL,
            PhonologicalContext.CLUSTER,
        ]
        assert summary.satisfies_req122() is True

    def test_fails_with_fewer_than_5_speakers(self) -> None:
        summary = ContrastCarveSummary(contrast="r-l", source=StimulusSource.LIBRITTS)
        summary.speaker_identifiers = ["19", "26", "27", "32"]  # only 4
        summary.speaker_sexes = ["F", "M", "M", "F"]
        summary.contexts = [
            PhonologicalContext.WORD_INITIAL,
            PhonologicalContext.CLUSTER,
        ]
        assert summary.satisfies_req122() is False

    def test_fails_without_mixed_sex(self) -> None:
        summary = ContrastCarveSummary(contrast="r-l", source=StimulusSource.LIBRITTS)
        summary.speaker_identifiers = ["19", "26", "27", "32", "40"]
        summary.speaker_sexes = ["F", "F", "F", "F", "F"]  # all female
        summary.contexts = [
            PhonologicalContext.WORD_INITIAL,
            PhonologicalContext.CLUSTER,
        ]
        assert summary.satisfies_req122() is False

    def test_fails_with_only_one_context(self) -> None:
        summary = ContrastCarveSummary(contrast="r-l", source=StimulusSource.LIBRITTS)
        summary.speaker_identifiers = ["19", "26", "27", "32", "40"]
        summary.speaker_sexes = ["F", "M", "M", "F", "M"]
        summary.contexts = [
            PhonologicalContext.WORD_INITIAL,
            PhonologicalContext.WORD_INITIAL,  # same context repeated
        ]
        assert summary.satisfies_req122() is False

    def test_speaker_count_deduplicates(self) -> None:
        """Duplicate speaker IDs should count as one speaker."""
        summary = ContrastCarveSummary(contrast="r-l", source=StimulusSource.LIBRITTS)
        summary.speaker_identifiers = ["19", "19", "19", "19", "19"]  # same speaker 5x
        summary.speaker_sexes = ["F", "F", "F", "F", "F"]
        summary.contexts = [
            PhonologicalContext.WORD_INITIAL,
            PhonologicalContext.CLUSTER,
        ]
        # 1 unique speaker — fails >=5 check
        assert summary.satisfies_req122() is False
