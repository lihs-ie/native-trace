"""parse_espeak_stress 純関数のユニットテスト。

重モデル依存なし。
"""

from python_analyzer.infrastructure.parselmouth_prosody import parse_espeak_stress


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
