"""話速・無音区間・シュワ実現の解析インフラ実装。"""

from python_analyzer.domain.measurement import InterWordSilence, SchwaRealization
from python_analyzer.domain.phoneme import SCHWA_PHONEME, AlignmentBoundary

# 無音区間と判定する最小ギャップ（ミリ秒）
_MIN_SILENCE_GAP_MS = 100


class SpeechRateAnalyzer:
    """音素境界情報から話速・無音・シュワを解析する実装。"""

    def analyze(
        self,
        boundaries: tuple[AlignmentBoundary, ...],
        audio_duration_milliseconds: int,
    ) -> tuple[
        tuple[InterWordSilence, ...],
        tuple[SchwaRealization, ...],
        float,
    ]:
        """境界情報から話速・無音・シュワ実現を解析する。

        Args:
            boundaries: forced_align の音素境界列。
            audio_duration_milliseconds: 音声の総時間（ms）。

        Returns:
            (inter_word_silences, schwa_realizations, speech_rate_phoneme_per_second)
        """
        if not boundaries or audio_duration_milliseconds <= 0:
            return (), (), 0.0

        inter_word_silences = self._detect_silences(boundaries)
        schwa_realizations = self._detect_schwas(boundaries)
        speech_rate = self._compute_speech_rate(boundaries, audio_duration_milliseconds)

        return inter_word_silences, schwa_realizations, speech_rate

    def _detect_silences(
        self,
        boundaries: tuple[AlignmentBoundary, ...],
    ) -> tuple[InterWordSilence, ...]:
        """音素境界間の無音区間を検出する。

        隣接する音素境界のギャップが _MIN_SILENCE_GAP_MS 以上のものを無音区間とする。
        """
        silences: list[InterWordSilence] = []
        sorted_boundaries = sorted(boundaries, key=lambda b: b.start_milliseconds)

        for index in range(len(sorted_boundaries) - 1):
            current_end = sorted_boundaries[index].end_milliseconds
            next_start = sorted_boundaries[index + 1].start_milliseconds
            gap_ms = next_start - current_end
            if gap_ms >= _MIN_SILENCE_GAP_MS:
                silences.append(
                    InterWordSilence(
                        start_milliseconds=current_end,
                        end_milliseconds=next_start,
                    )
                )
        return tuple(silences)

    def _detect_schwas(
        self,
        boundaries: tuple[AlignmentBoundary, ...],
    ) -> tuple[SchwaRealization, ...]:
        """シュワ音の実現情報を抽出する。

        IPA /ə/ を含む境界を realized=True として返す。
        """
        schwas: list[SchwaRealization] = []
        for boundary in boundaries:
            if SCHWA_PHONEME in boundary.phoneme.value:
                schwas.append(
                    SchwaRealization(
                        phoneme=boundary.phoneme,
                        start_milliseconds=boundary.start_milliseconds,
                        end_milliseconds=boundary.end_milliseconds,
                        realized=True,
                    )
                )
        return tuple(schwas)

    def _compute_speech_rate(
        self,
        boundaries: tuple[AlignmentBoundary, ...],
        audio_duration_milliseconds: int,
    ) -> float:
        """音素数 / 秒 で話速を計算する。"""
        if audio_duration_milliseconds <= 0:
            return 0.0
        phoneme_count = len(boundaries)
        duration_seconds = audio_duration_milliseconds / 1000.0
        return phoneme_count / duration_seconds
