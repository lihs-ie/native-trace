"""syllable モジュールの純関数ユニットテスト。

重モデル依存なし。純粋ロジックのテスト。
"""

from python_analyzer.domain.phoneme import AlignmentBoundary, PhonemeLabel
from python_analyzer.infrastructure.syllable import (
    count_vowel_nuclei,
    count_vowel_nuclei_from_phoneme_list,
    detect_syllables,
)


class TestCountVowelNuclei:
    """count_vowel_nuclei() のテスト。"""

    def test_empty_string_returns_zero(self) -> None:
        """空文字列は 0 を返すこと。"""
        assert count_vowel_nuclei("") == 0

    def test_counts_basic_vowels(self) -> None:
        """基本的な IPA 母音を正しくカウントすること。"""
        # "hello" の IPA: h-ɛ-l-oʊ → 母音 2 件
        assert count_vowel_nuclei("hɛloʊ") == 2

    def test_counts_multiple_vowels(self) -> None:
        """複数の母音を正しくカウントすること。"""
        # "banana" IPA: b-ə-n-æ-n-ə → 母音 3 件
        assert count_vowel_nuclei("bənænə") == 3

    def test_no_vowels_returns_zero(self) -> None:
        """母音がない場合は 0 を返すこと。"""
        assert count_vowel_nuclei("str") == 0

    def test_counts_ipa_vowels(self) -> None:
        """IPA 拡張母音（æ/ɑ/ɛ/ɪ/ʊ/ə など）を認識すること。

        連続する母音は二重母音として 1 音節にカウントされる。
        子音で区切られた母音はそれぞれ別音節になる。
        """
        # 子音で区切ることで個別の音節としてカウントさせる
        assert count_vowel_nuclei("æpɑtɛsɪrʊmə") == 6
        # 連続母音は 1 音節
        assert count_vowel_nuclei("æɑɛɪʊə") == 1


class TestCountVowelNucleiFromPhonemeList:
    """count_vowel_nuclei_from_phoneme_list() のテスト。"""

    def test_empty_list_returns_zero(self) -> None:
        """空リストは 0 を返すこと。"""
        assert count_vowel_nuclei_from_phoneme_list([]) == 0

    def test_counts_vowel_phonemes(self) -> None:
        """母音音素を正しくカウントすること。"""
        phonemes = ["h", "ɛ", "l", "oʊ"]
        assert count_vowel_nuclei_from_phoneme_list(phonemes) == 2

    def test_consonants_only_returns_zero(self) -> None:
        """子音のみのリストは 0 を返すこと。"""
        phonemes = ["p", "t", "k", "s"]
        assert count_vowel_nuclei_from_phoneme_list(phonemes) == 0


class TestDetectSyllables:
    """detect_syllables() のテスト。"""

    def _make_boundary(self, phoneme: str, start_ms: int, end_ms: int) -> AlignmentBoundary:
        """テスト用 AlignmentBoundary を生成するヘルパー。"""
        return AlignmentBoundary(
            phoneme=PhonemeLabel(phoneme),
            start_milliseconds=start_ms,
            end_milliseconds=end_ms,
        )

    def test_no_epenthesis_returns_zero_inserted_vowels(self) -> None:
        """挿入母音がない場合は insertedVowels が空であること。"""
        words = ["hello"]
        word_boundaries = [(0, 500)]
        expected_ipa_per_word = ["hɛloʊ"]  # 母音 2 件
        # 検出音素も 2 母音（挿入なし）
        alignment_boundaries = (
            self._make_boundary("h", 0, 50),
            self._make_boundary("ɛ", 50, 150),  # 母音
            self._make_boundary("l", 150, 250),
            self._make_boundary("oʊ", 250, 400),  # 母音
        )
        result = detect_syllables(
            words=words,
            word_boundaries=word_boundaries,
            expected_ipa_per_word=expected_ipa_per_word,
            alignment_boundaries=alignment_boundaries,
        )
        assert len(result) == 1
        assert result[0].expected_syllable_count == 2
        assert result[0].actual_syllable_count == 2
        assert len(result[0].inserted_vowels) == 0

    def test_detects_epenthesis_when_actual_exceeds_expected(self) -> None:
        """実測音節 > 期待音節のとき epenthesis を検出すること。"""
        words = ["milk"]
        word_boundaries = [(0, 400)]
        expected_ipa_per_word = ["mɪlk"]  # 母音 1 件
        # 日本語話者が "miluku" と発音した場合: 音素列に ɯ(挿入)が含まれる
        alignment_boundaries = (
            self._make_boundary("m", 0, 60),
            self._make_boundary("ɪ", 60, 150),  # 期待の母音
            self._make_boundary("l", 150, 230),
            self._make_boundary("ɯ", 230, 300),  # 挿入母音
            self._make_boundary("k", 300, 400),
        )
        result = detect_syllables(
            words=words,
            word_boundaries=word_boundaries,
            expected_ipa_per_word=expected_ipa_per_word,
            alignment_boundaries=alignment_boundaries,
        )
        assert len(result) == 1
        assert result[0].expected_syllable_count == 1
        assert result[0].actual_syllable_count == 2
        assert len(result[0].inserted_vowels) == 1
        assert result[0].inserted_vowels[0].vowel == "ɯ"
        assert result[0].inserted_vowels[0].position_milliseconds == 230

    def test_multiple_words(self) -> None:
        """複数単語を正しく処理すること。"""
        words = ["hello", "world"]
        word_boundaries = [(0, 400), (400, 800)]
        expected_ipa_per_word = ["hɛloʊ", "wɜːld"]  # 2音節, 1音節
        alignment_boundaries = (
            self._make_boundary("h", 0, 40),
            self._make_boundary("ɛ", 40, 120),
            self._make_boundary("l", 120, 200),
            self._make_boundary("oʊ", 200, 320),
            self._make_boundary("w", 400, 440),
            self._make_boundary("ɜː", 440, 580),
            self._make_boundary("l", 580, 660),
            self._make_boundary("d", 660, 720),
        )
        result = detect_syllables(
            words=words,
            word_boundaries=word_boundaries,
            expected_ipa_per_word=expected_ipa_per_word,
            alignment_boundaries=alignment_boundaries,
        )
        assert len(result) == 2
        assert result[0].word == "hello"
        assert result[1].word == "world"
