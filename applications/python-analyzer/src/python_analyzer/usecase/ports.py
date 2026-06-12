"""usecase 層のポート定義（依存逆転インターフェース）。

infrastructure 実装はこれを満たす必要がある。
"""

from typing import Protocol

from python_analyzer.domain.audio import AudioInput
from python_analyzer.domain.measurement import (
    InterWordSilence,
    PhonemeGopMeasurement,
    SchwaRealization,
)
from python_analyzer.domain.phoneme import AlignmentBoundary, IpaSequence


class G2PPort(Protocol):
    """g2p（grapheme-to-phoneme）変換ポート。"""

    def convert(self, text: str, accent: str) -> IpaSequence:
        """テキストを IPA 音素列に変換する。"""
        ...


class AlignerPort(Protocol):
    """wav2vec2 + 強制整列ポート。"""

    def align(
        self,
        audio: AudioInput,
        reference_ipa: IpaSequence,
    ) -> tuple[tuple[AlignmentBoundary, ...], tuple[PhonemeGopMeasurement, ...]]:
        """音声を IPA 参照に強制整列し、境界と GOP を返す。"""
        ...

    def detect_ipa(self, audio: AudioInput) -> IpaSequence:
        """音声から IPA 音素列を検出する。"""
        ...

    def measure_audio_quality(self, audio: AudioInput) -> tuple[float, float]:
        """録音品質を計測する。

        16kHz モノラル waveform から RMS を計算して dBFS に変換し、
        forced_align の非 blank フレーム数から実音声長（秒）を推定する。

        Returns:
            (mean_dbfs, speech_duration_seconds)
        """
        ...


class SpeechRatePort(Protocol):
    """話速・無音・シュワ解析ポート。"""

    def analyze(
        self,
        boundaries: tuple[AlignmentBoundary, ...],
        audio_duration_milliseconds: int,
    ) -> tuple[
        tuple[InterWordSilence, ...],
        tuple[SchwaRealization, ...],
        float,
    ]:
        """境界情報から話速・無音・シュワを解析する。

        Returns:
            inter_word_silences, schwa_realizations, speech_rate_phoneme_per_second
        """
        ...
