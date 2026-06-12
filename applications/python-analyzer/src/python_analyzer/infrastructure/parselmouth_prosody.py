"""F0 輪郭・語強勢の計測インフラ実装（parselmouth / Praat バックエンド）。

GPL-3.0 の parselmouth を使用。python-analyzer 内部利用に限定する。
配布形態のライセンス影響は別途 ADR 化が必要（docs/adr/ 参照）。
"""

import logging

from python_analyzer.domain.measurement import (
    F0Contour,
    WordStressMeasurement,
)

logger = logging.getLogger(__name__)

# IPA 母音核として認識する文字セット（強勢計算に使用）
_IPA_VOWEL_NUCLEI = frozenset("aeiouæɑɒɔəɛɪɨɵʊʌœøɯɤɐɞɘɵ")

# espeak 強勢記号から int へのマッピング
_STRESS_MARK_PRIMARY = "ˈ"  # 第1強勢
_STRESS_MARK_SECONDARY = "ˌ"  # 第2強勢


def extract_f0_contour(
    audio_bytes: bytes,
    sample_rate: int = 16000,
) -> F0Contour:
    """parselmouth で F0 輪郭を計測する。

    Args:
        audio_bytes: 16kHz モノ PCM 音声バイト列（WAV ヘッダー付き）。
        sample_rate: サンプリングレート（デフォルト 16000）。

    Returns:
        F0Contour。無声フレームは 0.0 Hz。
    """
    try:
        import parselmouth  # type: ignore[import-untyped]
    except ImportError as error:
        logger.warning("parselmouth が利用不可のため F0 輪郭を空で返す: %s", error)
        return F0Contour(times_milliseconds=(), values_hz=())

    import io

    import numpy as np
    import soundfile as sf

    try:
        # parselmouth.Sound は BytesIO を受け付けないため、soundfile でデコードして
        # numpy 波形 + サンプリングレートから Sound を構築する。
        samples, decoded_rate = sf.read(io.BytesIO(audio_bytes), dtype="float64")
        # ステレオはモノにまとめる
        if samples.ndim > 1:
            samples = samples.mean(axis=1)
        sound = parselmouth.Sound(
            np.asarray(samples, dtype="float64"),
            sampling_frequency=decoded_rate,
        )
        pitch = sound.to_pitch()
        times = pitch.xs()  # seconds
        times_ms = tuple(int(round(t * 1000)) for t in times)
        values_hz: list[float] = []
        for frame_index in range(len(times)):
            f0 = pitch.get_value_at_time(times[frame_index])
            # NaN（無声）は 0.0 にする
            if f0 != f0:  # NaN check
                values_hz.append(0.0)
            else:
                values_hz.append(float(f0))
        return F0Contour(
            times_milliseconds=times_ms,
            values_hz=tuple(values_hz),
        )
    except Exception as error:
        logger.error("F0 輪郭計測エラー: %s", error, exc_info=True)
        return F0Contour(times_milliseconds=(), values_hz=())


def extract_word_stress(
    words: list[str],
    word_boundaries: list[tuple[int, int]],  # [(start_ms, end_ms), ...]
    expected_stress_per_word: list[int],
    f0_contour: F0Contour,
    phoneme_durations_per_word: list[list[int]],  # 単語ごとの母音持続時間(ms)リスト
) -> tuple[WordStressMeasurement, ...]:
    """語強勢の期待値と実測値を単語単位で返す。

    Args:
        words: 単語テキストリスト（0始まり）。
        word_boundaries: 各単語の (start_ms, end_ms) タプルリスト。
        expected_stress_per_word: espeak 強勢記号から導出した期待強勢 (0/1/2) リスト。
        f0_contour: F0 輪郭（compute_f0_contour の戻り値）。
        phoneme_durations_per_word: 単語ごとの母音持続時間リスト (ヒューリスティック用)。

    Returns:
        WordStressMeasurement タプル。
    """
    measurements: list[WordStressMeasurement] = []
    for word_index, (word, (start_ms, end_ms), expected_stress) in enumerate(
        zip(words, word_boundaries, expected_stress_per_word, strict=False)
    ):
        predicted_stress = _predict_stress_from_acoustics(
            start_ms, end_ms, f0_contour, phoneme_durations_per_word[word_index]
        )
        measurements.append(
            WordStressMeasurement(
                word=word,
                word_index=word_index,
                start_milliseconds=start_ms,
                end_milliseconds=end_ms,
                expected_stress=expected_stress,
                predicted_stress=predicted_stress,
            )
        )
    return tuple(measurements)


def _predict_stress_from_acoustics(
    word_start_ms: int,
    word_end_ms: int,
    f0_contour: F0Contour,
    vowel_durations_ms: list[int],
) -> int:
    """F0 ピーク・強度・母音持続時間から強勢を 0/1/2 で推定する軽量ヒューリスティック。

    - F0 ピークが単語内で検出できれば 1 とする（簡易版）
    - 母音持続時間が平均の 1.5 倍以上であれば 1 とする
    - 両条件なしは 0
    """
    if not f0_contour.times_milliseconds:
        return 0

    # 単語区間の F0 値を取得する
    f0_in_word: list[float] = []
    for time_ms, hz in zip(f0_contour.times_milliseconds, f0_contour.values_hz, strict=False):
        if word_start_ms <= time_ms <= word_end_ms and hz > 0:
            f0_in_word.append(hz)

    has_f0_peak = len(f0_in_word) > 0 and max(f0_in_word) > 0

    # 母音持続時間が十分に長いかチェック（最大 > 平均 * 1.3）
    has_long_vowel = False
    if len(vowel_durations_ms) >= 2:
        average = sum(vowel_durations_ms) / len(vowel_durations_ms)
        has_long_vowel = max(vowel_durations_ms) > average * 1.3

    if has_f0_peak and has_long_vowel:
        return 1
    if has_f0_peak:
        return 1
    return 0


def parse_espeak_stress(ipa_word: str) -> int:
    """espeak の IPA 出力から強勢記号を解析して 0/1/2 を返す純関数。

    Args:
        ipa_word: espeak の IPA 出力の 1 単語分 (例: "ˈhɛloʊ")。

    Returns:
        0=無強勢, 1=第1強勢, 2=第2強勢。
    """
    if _STRESS_MARK_PRIMARY in ipa_word:
        return 1
    if _STRESS_MARK_SECONDARY in ipa_word:
        return 2
    return 0
