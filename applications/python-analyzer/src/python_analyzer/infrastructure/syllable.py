"""音節カウント・epenthesis 検出インフラ実装。

espeak IPA 母音核カウントで expected/actual 音節数を比較し、
挿入母音（[ɯ]/[o]/[i]）と位置を特定する純粋ロジック。
"""

from python_analyzer.domain.measurement import InsertedVowel, SyllableMeasurement
from python_analyzer.domain.phoneme import VOWEL_NUCLEI, AlignmentBoundary

# 日本語話者が挿入しやすい母音（epenthesis の典型）
# ɪ/ʊ は英語正規母音として除外; ɯ/o/i が日本語母語話者の典型的挿入母音
_TYPICAL_EPENTHETIC_VOWELS = frozenset({"ɯ", "o", "i", "ɨ"})


def count_vowel_nuclei(ipa_string: str) -> int:
    """IPA 文字列の母音核数をカウントする純関数。

    連続する母音文字（二重母音 oʊ/aɪ/eɪ 等）は 1 音節としてカウントする。
    espeak の出力では二重母音が隣接する母音文字として表現されるため、
    直前文字も母音である場合はカウントしない（greedy 先読み）。

    Args:
        ipa_string: IPA 文字列（例: "hɛloʊ"）。

    Returns:
        母音核の数（0 以上）。
    """
    count = 0
    previous_was_vowel = False
    for char in ipa_string:
        is_vowel = char in VOWEL_NUCLEI
        if is_vowel and not previous_was_vowel:
            count += 1
        previous_was_vowel = is_vowel
    return count


def count_vowel_nuclei_from_phoneme_list(phonemes: list[str]) -> int:
    """音素ラベルリストから母音核数をカウントする純関数。

    Args:
        phonemes: 音素 IPA ラベルリスト（例: ["h", "ɛ", "l", "oʊ"]）。

    Returns:
        母音核の数（0 以上）。
    """
    return sum(1 for phoneme in phonemes if any(char in VOWEL_NUCLEI for char in phoneme))


def detect_syllables(
    words: list[str],
    word_boundaries: list[tuple[int, int]],  # [(start_ms, end_ms), ...]
    expected_ipa_per_word: list[str],  # espeak IPA（単語ごと）
    alignment_boundaries: tuple[AlignmentBoundary, ...],
) -> tuple[SyllableMeasurement, ...]:
    """単語ごとの期待音節数と実測音節数を比較し epenthesis を検出する。

    Args:
        words: 単語テキストリスト（0始まり）。
        word_boundaries: 各単語の (start_ms, end_ms) タプルリスト。
        expected_ipa_per_word: 単語ごとの espeak IPA 文字列リスト。
        alignment_boundaries: 強制整列の音素境界列。

    Returns:
        SyllableMeasurement タプル。
    """
    measurements: list[SyllableMeasurement] = []
    for word_index, (word, (start_ms, end_ms), expected_ipa) in enumerate(
        zip(words, word_boundaries, expected_ipa_per_word, strict=False)
    ):
        expected_count = count_vowel_nuclei(expected_ipa)

        # 単語区間の音素を取得する
        phonemes_in_word = [
            boundary
            for boundary in alignment_boundaries
            if boundary.start_milliseconds >= start_ms and boundary.end_milliseconds <= end_ms
        ]
        actual_phoneme_labels = [b.phoneme.value for b in phonemes_in_word]
        actual_count = count_vowel_nuclei_from_phoneme_list(actual_phoneme_labels)

        # 挿入母音を検出する（実測 > 期待のときのみ）
        inserted_vowels = _find_inserted_vowels(phonemes_in_word, expected_count, actual_count)

        measurements.append(
            SyllableMeasurement(
                word=word,
                word_index=word_index,
                expected_syllable_count=expected_count,
                actual_syllable_count=actual_count,
                inserted_vowels=inserted_vowels,
            )
        )
    return tuple(measurements)


def _find_inserted_vowels(
    phonemes_in_word: list[AlignmentBoundary],
    expected_count: int,
    actual_count: int,
) -> tuple[InsertedVowel, ...]:
    """期待音節数より多い音節に相当する挿入母音を特定する。

    差分 > 0 のとき、実音素列から典型的な挿入母音候補を検出する。
    日本語話者の epenthesis パターン: [ɯ]/[o]/[i] が子音の後に挿入される。
    """
    if actual_count <= expected_count:
        return ()

    inserted: list[InsertedVowel] = []
    for boundary in phonemes_in_word:
        phoneme_str = boundary.phoneme.value
        # 典型的な挿入母音候補かチェックする
        is_epenthetic = any(char in _TYPICAL_EPENTHETIC_VOWELS for char in phoneme_str)
        if is_epenthetic and len(inserted) < (actual_count - expected_count):
            # 挿入母音の IPA 記号を取得する（音素内の最初の挿入候補文字）
            vowel_char = next(
                (char for char in phoneme_str if char in _TYPICAL_EPENTHETIC_VOWELS),
                phoneme_str,
            )
            inserted.append(
                InsertedVowel(
                    position_milliseconds=boundary.start_milliseconds,
                    vowel=vowel_char,
                )
            )
    return tuple(inserted)
