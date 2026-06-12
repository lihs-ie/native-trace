"""機能語弱形実現検出インフラ実装。

英語の機能語（to/of/and/for/a/the/...）について schwa 化 + 短縮を判定する。
外部 I/O なし（純粋ロジック + alignment_boundaries 参照）。
"""

from python_analyzer.domain.measurement import WeakFormRealization
from python_analyzer.domain.phoneme import AlignmentBoundary

# 弱形になりやすい主要英語機能語（小文字）
_FUNCTION_WORDS = frozenset(
    {
        "to",
        "of",
        "and",
        "for",
        "a",
        "the",
        "that",
        "in",
        "at",
        "from",
        "with",
        "as",
        "but",
        "or",
        "an",
        "been",
        "be",
        "have",
        "has",
        "had",
        "can",
        "could",
        "would",
        "should",
        "do",
        "does",
        "am",
        "are",
        "is",
        "was",
        "were",
    }
)

# schwa 音の IPA 記号
_SCHWA_PHONEME = "ə"

# 弱形実現と判定する最大音素持続時間（ミリ秒）: 短縮形を検出する閾値
_WEAK_FORM_MAX_DURATION_MS = 120


def detect_weak_form_realizations(
    words: list[str],
    word_boundaries: list[tuple[int, int]],  # [(start_ms, end_ms), ...]
    alignment_boundaries: tuple[AlignmentBoundary, ...],
) -> tuple[WeakFormRealization, ...]:
    """機能語の弱形実現を検出する。

    各機能語について：
    1. 単語区間の音素列を取得する
    2. schwa (ə) が含まれている、または単語持続時間が短い場合に realized_weak=True
    3. expectedWeak は機能語なので常に True

    Args:
        words: 単語テキストリスト（0始まり）。
        word_boundaries: 各単語の (start_ms, end_ms) タプルリスト。
        alignment_boundaries: 強制整列の音素境界列。

    Returns:
        WeakFormRealization タプル（機能語のみ）。
    """
    realizations: list[WeakFormRealization] = []
    for word_index, (word, (start_ms, end_ms)) in enumerate(
        zip(words, word_boundaries, strict=False)
    ):
        if word.lower() not in _FUNCTION_WORDS:
            continue

        # 単語区間の音素を取得する
        phonemes_in_word = [
            boundary
            for boundary in alignment_boundaries
            if boundary.start_milliseconds >= start_ms and boundary.end_milliseconds <= end_ms
        ]

        realized_weak = _is_realized_as_weak(phonemes_in_word, start_ms, end_ms)

        realizations.append(
            WeakFormRealization(
                word=word,
                word_index=word_index,
                start_milliseconds=start_ms,
                end_milliseconds=end_ms,
                expected_weak=True,  # 機能語は常に弱形が期待される
                realized_weak=realized_weak,
            )
        )
    return tuple(realizations)


def _is_realized_as_weak(
    phonemes_in_word: list[AlignmentBoundary],
    word_start_ms: int,
    word_end_ms: int,
) -> bool:
    """schwa 化または短縮により弱形実現しているか判定する。

    判定基準:
    1. 音素列に ə が含まれる → schwa 化あり
    2. 単語区間の持続時間が _WEAK_FORM_MAX_DURATION_MS 以下 → 短縮あり
    """
    has_schwa = any(_SCHWA_PHONEME in boundary.phoneme.value for boundary in phonemes_in_word)
    word_duration = word_end_ms - word_start_ms
    is_short = word_duration <= _WEAK_FORM_MAX_DURATION_MS

    return has_schwa or is_short
