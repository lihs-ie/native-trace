"""parselmouth_prosody 純関数のユニットテスト。

重モデル依存なし。
"""

from python_analyzer.domain.measurement import F0Contour
from python_analyzer.infrastructure.parselmouth_prosody import (
    _predict_stress_from_acoustics,
    extract_word_stress,
    parse_espeak_stress,
)


class TestParseEspeakStress:
    """parse_espeak_stress() のテスト。"""

    def test_primary_stress_mark_returns_one(self) -> None:
        """第1強勢記号 ˈ が含まれる場合は 1 を返すこと。"""
        assert parse_espeak_stress("ˈhɛloʊ") == 1

    def test_secondary_stress_mark_returns_two(self) -> None:
        """第2強勢記号 ˌ が含まれる場合は 2 を返すこと。"""
        assert parse_espeak_stress("ˌwɜːld") == 2

    def test_no_stress_mark_returns_zero(self) -> None:
        """強勢記号がない場合は 0 を返すこと。"""
        assert parse_espeak_stress("hɛloʊ") == 0

    def test_primary_takes_precedence_over_secondary(self) -> None:
        """第1強勢が第2強勢より優先されること。"""
        assert parse_espeak_stress("ˈhɛˌloʊ") == 1

    def test_empty_string_returns_zero(self) -> None:
        """空文字列は 0 を返すこと。"""
        assert parse_espeak_stress("") == 0


class TestPredictStressFromAcoustics:
    """_predict_stress_from_acoustics() の M-114R-a 改善後テスト。"""

    def _make_f0_contour(
        self, times_ms: list[int], values_hz: list[float]
    ) -> F0Contour:
        return F0Contour(
            times_milliseconds=tuple(times_ms),
            values_hz=tuple(values_hz),
        )

    def test_f0_peak_above_global_median_returns_one(self) -> None:
        """単語区間の最大 F0 が発話全体中央値を超える場合は強勢 1 を返すこと。

        M-114R-a: 旧実装は有声フレームがあれば常に 1 → 新実装は中央値比較。
        """
        # 全体 F0: [100, 100, 100, 200] → 中央値 = 100.0
        # 単語区間 [200, 400ms] の F0: [200] → 200 > 100 で強勢あり
        f0_contour = self._make_f0_contour(
            [0, 100, 200, 300, 400],
            [100.0, 100.0, 200.0, 100.0, 0.0],
        )
        result = _predict_stress_from_acoustics(
            word_start_ms=200,
            word_end_ms=400,
            f0_contour=f0_contour,
            vowel_durations_ms=[50],
            global_f0_median=100.0,
        )
        assert result == 1

    def test_f0_peak_below_global_median_without_long_vowel_returns_zero(self) -> None:
        """単語区間の最大 F0 が中央値以下かつ長母音なしは 0 を返すこと。

        M-114R-a: 旧実装では有声フレームがあれば 1 を返す欠陥があった。
        """
        # 全体 F0: [200, 200, 200, 200] → 中央値 = 200.0
        # 単語区間 [0, 100ms] の F0: [100] → 100 <= 200 で強勢なし
        f0_contour = self._make_f0_contour(
            [0, 100, 200, 300],
            [100.0, 200.0, 200.0, 200.0],
        )
        result = _predict_stress_from_acoustics(
            word_start_ms=0,
            word_end_ms=100,
            f0_contour=f0_contour,
            vowel_durations_ms=[50],
            global_f0_median=200.0,
        )
        assert result == 0

    def test_empty_f0_contour_returns_zero(self) -> None:
        """F0 輪郭が空の場合は 0 を返すこと。"""
        f0_contour = self._make_f0_contour([], [])
        result = _predict_stress_from_acoustics(
            word_start_ms=0,
            word_end_ms=100,
            f0_contour=f0_contour,
            vowel_durations_ms=[],
            global_f0_median=0.0,
        )
        assert result == 0

    def test_long_vowel_without_f0_peak_returns_one(self) -> None:
        """長母音がある場合（F0 ピークなし）は強勢 1 を返すこと。"""
        # F0 は中央値以下
        f0_contour = self._make_f0_contour(
            [0, 100, 200],
            [80.0, 80.0, 0.0],
        )
        # 母音持続時間: [100, 60] → 最大100 > 平均80 * 1.3 = 104 → False
        # → [200, 50] → 最大200 > 平均125 * 1.3 = 162.5 → True
        result = _predict_stress_from_acoustics(
            word_start_ms=0,
            word_end_ms=200,
            f0_contour=f0_contour,
            vowel_durations_ms=[200, 50],
            global_f0_median=100.0,
        )
        assert result == 1


class TestExtractWordStressGlobalMedian:
    """extract_word_stress() が global_f0_median を使って全単語 0 にならないテスト（M-114R-c）。

    強勢パターンが既知の fixture: "RECORD"（名詞: 第1音節強勢）相当の2単語を想定。
    第1単語の F0 が発話全体中央値を超えるよう設計し、predictedStress >= 1 になることを確認。
    """

    def _make_f0_contour_for_two_words(self) -> F0Contour:
        """2単語発話を模した F0 輪郭。

        第1単語 [0, 300ms]: F0 高い（200Hz）
        第2単語 [300, 600ms]: F0 低い（80Hz）
        全体中央値 = median([200, 200, 200, 80, 80, 80]) = 140Hz
        第1単語 max F0 = 200 > 140 → 強勢あり
        第2単語 max F0 = 80 <= 140 → 強勢なし（長母音もなし）
        """
        return F0Contour(
            times_milliseconds=(0, 100, 200, 300, 400, 500),
            values_hz=(200.0, 200.0, 200.0, 80.0, 80.0, 80.0),
        )

    def test_predicted_stress_not_all_zero_for_known_stress_pattern(self) -> None:
        """強勢既知 fixture で predictedStress が全単語 0 にならないこと（M-114R-c）。

        少なくとも 1 単語で predicted_stress >= 1 であることを assert する。
        """
        f0_contour = self._make_f0_contour_for_two_words()
        words = ["record", "this"]
        word_boundaries = [(0, 300), (300, 600)]
        expected_stress_per_word = [1, 0]
        # 単音節語のため長母音なし（各1母音）
        phoneme_durations_per_word = [[80], [60]]

        measurements = extract_word_stress(
            words=words,
            word_boundaries=word_boundaries,
            expected_stress_per_word=expected_stress_per_word,
            f0_contour=f0_contour,
            phoneme_durations_per_word=phoneme_durations_per_word,
        )

        predicted_stresses = [m.predicted_stress for m in measurements]
        assert any(s >= 1 for s in predicted_stresses), (
            f"全単語の predicted_stress が 0: {predicted_stresses}。"
            "M-114R-c: 強勢既知 fixture で少なくとも 1 単語が強勢判定されること。"
        )
