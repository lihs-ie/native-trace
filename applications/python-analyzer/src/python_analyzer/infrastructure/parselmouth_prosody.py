"""F0 輪郭・語強勢の計測インフラ実装（parselmouth / Praat バックエンド）。

GPL-3.0 の parselmouth を使用。python-analyzer 内部利用に限定する。
配布形態のライセンス影響は別途 ADR 化が必要（docs/adr/ 参照）。
"""

import logging
import statistics

from python_analyzer.domain.measurement import (
    F0Contour,
    WordStressMeasurement,
)

logger = logging.getLogger(__name__)

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
    import subprocess

    import numpy as np
    import soundfile as sf

    def _decode_samples(raw: bytes) -> tuple[object, int]:
        # soundfile(libsndfile) は WAV/FLAC 等しか読めず、ブラウザ録音の WebM/OGG は読めない。
        # まず soundfile を試し、失敗したら ffmpeg で WAV PCM に変換して読み直す
        # (ffmpeg は入力フォーマットをストリームから自動判定するため mime_type 不要)。
        try:
            return sf.read(io.BytesIO(raw), dtype="float64")
        except Exception:
            result = subprocess.run(
                [
                    "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
                    "-i", "pipe:0", "-f", "wav", "-acodec", "pcm_s16le", "pipe:1",
                ],
                input=raw,
                capture_output=True,
                timeout=30,
            )
            if result.returncode != 0:
                raise RuntimeError(
                    f"ffmpeg デコード失敗: {result.stderr.decode(errors='replace')}"
                )
            return sf.read(io.BytesIO(result.stdout), dtype="float64")

    try:
        # parselmouth.Sound は BytesIO を受け付けないため、デコードして
        # numpy 波形 + サンプリングレートから Sound を構築する。
        samples, decoded_rate = _decode_samples(audio_bytes)
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
    # M-114R-a: 発話全体の有声 F0 中央値を計算して _predict_stress_from_acoustics に渡す
    voiced_f0_values = [hz for hz in f0_contour.values_hz if hz > 0]
    global_f0_median = statistics.median(voiced_f0_values) if voiced_f0_values else 0.0

    measurements: list[WordStressMeasurement] = []
    for word_index, (word, (start_ms, end_ms), expected_stress) in enumerate(
        zip(words, word_boundaries, expected_stress_per_word, strict=False)
    ):
        predicted_stress = _predict_stress_from_acoustics(
            start_ms, end_ms, f0_contour, phoneme_durations_per_word[word_index],
            global_f0_median=global_f0_median,
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
    global_f0_median: float = 0.0,
) -> int:
    """F0 ピーク・母音持続時間から強勢を 0/1/2 で推定する軽量ヒューリスティック。

    M-114R-a: has_f0_peak を「単語区間の最大 F0 が発話全体の有声 F0 中央値を超える」に修正。
    旧実装は「有声フレームがあれば常に 1」だったため、ほぼ全単語が強勢判定になる欠陥があった。

    - F0 ピーク: 単語区間の有声フレーム最大 F0 > 発話全体有声 F0 中央値（global_f0_median）
    - 母音持続時間: 単語内最大母音持続時間 > 平均 * 1.3
    - 両条件の OR で強勢 1 を返す
    - 両条件なしは 0
    """
    if not f0_contour.times_milliseconds:
        return 0

    # 単語区間の有声 F0 値を取得する
    f0_in_word: list[float] = []
    for time_ms, hz in zip(f0_contour.times_milliseconds, f0_contour.values_hz, strict=False):
        if word_start_ms <= time_ms <= word_end_ms and hz > 0:
            f0_in_word.append(hz)

    # M-114R-a: 単語区間の最大 F0 が発話全体中央値を超えるかで判定する
    # （旧: max(f0_in_word) > 0 は有声フレームがあれば常に true）
    has_f0_peak = len(f0_in_word) > 0 and max(f0_in_word) > global_f0_median

    # 母音持続時間が十分に長いかチェック（最大 > 平均 * 1.3）
    has_long_vowel = False
    if len(vowel_durations_ms) >= 2:
        average = sum(vowel_durations_ms) / len(vowel_durations_ms)
        has_long_vowel = max(vowel_durations_ms) > average * 1.3

    if has_f0_peak or has_long_vowel:
        return 1
    return 0
