"""_assign_word_positions 純関数のユニットテスト（M-102R-b）。

単語内位置（"initial" | "medial" | "final"）の計算ロジックを検証する。
また PhonemeGopResponse の JSON key が "wordPosition" になることも確認する。
"""

from python_analyzer.domain.measurement import PhonemeGopMeasurement
from python_analyzer.domain.phoneme import GopScore, PhonemeLabel
from python_analyzer.interface.schema import PhonemeGopResponse
from python_analyzer.usecase.analyze_pronunciation import _assign_word_positions


def _make_gop_measurement(phoneme: str, start_ms: int, end_ms: int) -> PhonemeGopMeasurement:
    return PhonemeGopMeasurement(
        phoneme=PhonemeLabel(phoneme),
        gop=GopScore(value=-1.0),
        start_milliseconds=start_ms,
        end_milliseconds=end_ms,
        n_best=(),
    )


class TestAssignWordPositions:
    """_assign_word_positions() のテスト。"""

    def test_single_phoneme_word_returns_final(self) -> None:
        """1 音素語は "final" を返すこと（仕様: 1音素語は final 優先）。"""
        gop = (_make_gop_measurement("ə", 0, 100),)
        word_boundaries = [(0, 100)]
        result = _assign_word_positions(gop, word_boundaries)
        assert result[0].word_position == "final"

    def test_two_phoneme_word_first_is_initial_last_is_final(self) -> None:
        """2 音素語: 最初が initial、最後が final になること。"""
        gop = (
            _make_gop_measurement("h", 0, 50),
            _make_gop_measurement("ɛ", 50, 100),
        )
        word_boundaries = [(0, 100)]
        result = _assign_word_positions(gop, word_boundaries)
        assert result[0].word_position == "initial"
        assert result[1].word_position == "final"

    def test_three_phoneme_word_middle_is_medial(self) -> None:
        """3 音素語: 中間が medial になること。"""
        gop = (
            _make_gop_measurement("h", 0, 40),
            _make_gop_measurement("ɛ", 40, 80),
            _make_gop_measurement("l", 80, 120),
        )
        word_boundaries = [(0, 120)]
        result = _assign_word_positions(gop, word_boundaries)
        assert result[0].word_position == "initial"
        assert result[1].word_position == "medial"
        assert result[2].word_position == "final"

    def test_two_words_positions_are_independent(self) -> None:
        """2 単語の場合、各単語で独立して位置が計算されること。"""
        # "hi" [0, 100]: h=initial, ɪ=final
        # "there" [100, 250]: ð=initial, ɛ=medial, ɹ=final
        gop = (
            _make_gop_measurement("h", 10, 50),
            _make_gop_measurement("ɪ", 50, 100),
            _make_gop_measurement("ð", 110, 150),
            _make_gop_measurement("ɛ", 150, 190),
            _make_gop_measurement("ɹ", 190, 240),
        )
        word_boundaries = [(0, 100), (100, 250)]
        result = _assign_word_positions(gop, word_boundaries)
        # word 1
        assert result[0].word_position == "initial"  # h
        assert result[1].word_position == "final"  # ɪ
        # word 2
        assert result[2].word_position == "initial"  # ð
        assert result[3].word_position == "medial"  # ɛ
        assert result[4].word_position == "final"  # ɹ

    def test_empty_input_returns_empty_tuple(self) -> None:
        """空入力は空タプルを返すこと。"""
        result = _assign_word_positions((), [])
        assert result == ()

    def test_existing_fields_are_preserved(self) -> None:
        """既存フィールド（gop, startMs 等）が保持されること。"""
        original = _make_gop_measurement("p", 0, 80)
        result = _assign_word_positions((original,), [(0, 80)])
        assert result[0].gop.value == -1.0
        assert result[0].start_milliseconds == 0
        assert result[0].end_milliseconds == 80
        assert result[0].phoneme.value == "p"


class TestPhonemeGopResponseJsonKey:
    """PhonemeGopResponse の JSON 出力に wordPosition キーが含まれることを確認（C-A2W）。

    契約ロック: JSON key は "wordPosition"（camelCase）。worker は `o .:? "wordPosition"` で読む。
    """

    def test_json_key_is_word_position_camel_case(self) -> None:
        """model_dump() の出力キーが "wordPosition" になること（C-A2W 契約確認）。"""
        response = PhonemeGopResponse(
            phoneme="h",
            gop=0.9,
            startMs=0,
            endMs=50,
            nBest=[],
            wordPosition="initial",
        )
        dumped = response.model_dump()
        assert "wordPosition" in dumped, (
            f"'wordPosition' キーが存在しない。実際のキー: {list(dumped.keys())}"
        )
        assert dumped["wordPosition"] == "initial"

    def test_json_key_is_word_position_in_json_string(self) -> None:
        """model_dump_json() の JSON 文字列に \"wordPosition\" が含まれること。"""
        response = PhonemeGopResponse(
            phoneme="h",
            gop=0.9,
            startMs=0,
            endMs=50,
            nBest=[],
            wordPosition="final",
        )
        json_str = response.model_dump_json()
        assert '"wordPosition"' in json_str, (
            f'"wordPosition" が JSON 文字列に含まれない。JSON: {json_str}'
        )

    def test_null_word_position_serializes_as_null(self) -> None:
        """wordPosition が None のとき JSON で null になること。"""
        response = PhonemeGopResponse(
            phoneme="h",
            gop=0.9,
            startMs=0,
            endMs=50,
            nBest=[],
            wordPosition=None,
        )
        dumped = response.model_dump()
        assert dumped["wordPosition"] is None

    def test_word_position_values_are_valid(self) -> None:
        """wordPosition の値が "initial" | "medial" | "final" のいずれかであること。"""
        valid_values = {"initial", "medial", "final", None}
        for value in ["initial", "medial", "final", None]:
            response = PhonemeGopResponse(
                phoneme="t",
                gop=0.5,
                startMs=0,
                endMs=40,
                nBest=[],
                wordPosition=value,
            )
            assert response.wordPosition in valid_values
