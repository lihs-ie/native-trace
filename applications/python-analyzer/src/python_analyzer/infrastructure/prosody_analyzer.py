"""ProsodyPort の infrastructure 実装。

parselmouth / rhythm / weak_form / syllable の各モジュールをオーケストレートし、
usecase 層の ProsodyPort プロトコルを満たす。
"""

import logging

from python_analyzer.domain.measurement import (
    F0Contour,
    PhonemeAcousticMeasurement,
    RhythmMeasurement,
    SyllableMeasurement,
    WeakFormRealization,
    WordStressMeasurement,
)
from python_analyzer.domain.phoneme import AlignmentBoundary
from python_analyzer.infrastructure import parselmouth_formant
from python_analyzer.infrastructure.kokoro_tts import synthesize_speech
from python_analyzer.infrastructure.parselmouth_prosody import (
    extract_f0_contour,
    extract_word_stress,
)
from python_analyzer.infrastructure.rhythm import compute_rhythm
from python_analyzer.infrastructure.syllable import detect_syllables
from python_analyzer.infrastructure.weak_form import detect_weak_form_realizations

logger = logging.getLogger(__name__)


class ProsodyAnalyzer:
    """韻律計測 infrastructure 実装（ProsodyPort を満たす）。

    parselmouth / rhythm / weak_form / syllable を内部で呼び出す。
    """

    def measure_f0_contour(self, audio_bytes: bytes, sample_rate: int) -> F0Contour:
        """F0 輪郭を計測する（parselmouth）。"""
        return extract_f0_contour(audio_bytes=audio_bytes, sample_rate=sample_rate)

    def measure_word_stress(
        self,
        words: list[str],
        word_boundaries: list[tuple[int, int]],
        expected_stress_per_word: list[int],
        f0_contour: F0Contour,
        phoneme_durations_per_word: list[list[int]],
    ) -> tuple[WordStressMeasurement, ...]:
        """語強勢を計測する。"""
        return extract_word_stress(
            words=words,
            word_boundaries=word_boundaries,
            expected_stress_per_word=expected_stress_per_word,
            f0_contour=f0_contour,
            phoneme_durations_per_word=phoneme_durations_per_word,
        )

    def measure_rhythm(self, vowel_durations_ms: list[float]) -> RhythmMeasurement:
        """nPVI リズム指標を計算する。"""
        return compute_rhythm(vowel_durations_ms)

    def detect_weak_forms(
        self,
        words: list[str],
        word_boundaries: list[tuple[int, int]],
        alignment_boundaries: tuple[AlignmentBoundary, ...],
    ) -> tuple[WeakFormRealization, ...]:
        """機能語の弱形実現を検出する。"""
        return detect_weak_form_realizations(
            words=words,
            word_boundaries=word_boundaries,
            alignment_boundaries=alignment_boundaries,
        )

    def detect_syllables(
        self,
        words: list[str],
        word_boundaries: list[tuple[int, int]],
        expected_ipa_per_word: list[str],
        alignment_boundaries: tuple[AlignmentBoundary, ...],
    ) -> tuple[SyllableMeasurement, ...]:
        """音節数と epenthesis を検出する。"""
        return detect_syllables(
            words=words,
            word_boundaries=word_boundaries,
            expected_ipa_per_word=expected_ipa_per_word,
            alignment_boundaries=alignment_boundaries,
        )

    def measure_phoneme_acoustics(
        self,
        audio_bytes: bytes,
        boundaries: tuple[AlignmentBoundary, ...],
        sample_rate: int,
        speaker_sex: str,
    ) -> tuple[PhonemeAcousticMeasurement, ...]:
        """音素ごとのフォルマント・スペクトル重心・持続時間を計測する（ADR-018 D1–D3）。

        speaker_sex が 'F' のとき maximum_formant_hz=6500、
        'M' または 'unknown' のとき 5500 を parselmouth_formant に渡す。
        """
        maximum_formant_hz = 6500.0 if speaker_sex == "F" else 5500.0
        return parselmouth_formant.extract_phoneme_acoustics(
            audio_bytes=audio_bytes,
            boundaries=boundaries,
            sample_rate=sample_rate,
            maximum_formant_hz=maximum_formant_hz,
        )

    def extract_reference_f0_contour(self, reference_text: str) -> F0Contour | None:
        """M-F0REF-a: referenceText を Kokoro TTS で合成し F0 輪郭を抽出して返す。

        既存 synthesize_speech（Kokoro）と extract_f0_contour（parselmouth）を再利用する。
        合成・抽出のいずれかが失敗した場合は None を返す（学習者経路を壊さない）。
        """
        try:
            wav_bytes = synthesize_speech(reference_text)
        except Exception as synthesis_error:
            logger.warning(
                "reference TTS 合成に失敗したため reference F0 を None にする: %s",
                synthesis_error,
            )
            return None

        try:
            # Kokoro は 24kHz WAV を返す。extract_f0_contour は WAV ヘッダーを soundfile で読む
            # ため sample_rate 引数は実質的には WAV ヘッダーより上書きされるが、
            # 念のため Kokoro のデフォルト 24000 を渡す。
            contour = extract_f0_contour(audio_bytes=wav_bytes, sample_rate=24000)
        except Exception as extraction_error:
            logger.warning(
                "reference F0 抽出に失敗したため None にする: %s",
                extraction_error,
            )
            return None

        # voiced フレームがひとつもない（無音・完全無声）場合は None を返す
        if not contour.times_milliseconds:
            logger.warning("reference F0 輪郭が空: reference を None にする")
            return None

        return contour
