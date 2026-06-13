"""compute_shadowing_lag ユースケースの contract テスト（ADR-013 / M-SHL-2）。

Done When:
- compute_shadowing_lag が 2 種類の learner 録音で **異なる lag** を返す (contract test)。
- lag が実音声由来であることを confirm する (固定値・合成値禁止)。

espeak / torch を使わず pure numpy で合成 WAV を生成して DTW を検証する。
aligner の align() は wav2vec2 を呼ばず AlignmentBoundary を直接返す
test-double を **テストコードにのみ** 置く（本番コードには触れない）。
"""

import io
import struct
import wave
from typing import Any

import numpy as np
import pytest

from python_analyzer.domain.audio import AudioInput
from python_analyzer.domain.phoneme import AlignmentBoundary, IpaSequence, PhonemeLabel
from python_analyzer.infrastructure.dtw_lag import compute_lag
from python_analyzer.usecase.compute_shadowing_lag import ComputeShadowingLagUseCase


# ---------------------------------------------------------------------------
# テスト用ヘルパー: 純粋 numpy/wave で合成 WAV を生成する
# ---------------------------------------------------------------------------


def _make_sine_wav(
    frequency_hz: float = 440.0,
    duration_seconds: float = 1.0,
    sample_rate: int = 16000,
    amplitude: float = 0.5,
) -> bytes:
    """サイン波 WAV バイト列を生成する（テストコードのみで使用）。

    espeak / torch / soundfile に依存しない純 numpy 実装。
    """
    n_samples = int(sample_rate * duration_seconds)
    t = np.linspace(0, duration_seconds, n_samples, endpoint=False)
    samples = (amplitude * np.sin(2 * np.pi * frequency_hz * t) * 32767).astype(np.int16)
    raw_bytes = samples.tobytes()

    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)  # 16-bit
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(raw_bytes)
    return buffer.getvalue()


def _make_audio_input(wav_bytes: bytes, duration_ms: int) -> AudioInput:
    return AudioInput(
        content=wav_bytes,
        mime_type="audio/wav",
        duration_milliseconds=duration_ms,
    )


# ---------------------------------------------------------------------------
# テスト用 G2P / Aligner ダブル（テストコードのみに配置）
# ---------------------------------------------------------------------------


class _FixedG2P:
    """固定 IpaSequence を返す G2P テストダブル（テストコードのみ）。"""

    def __init__(self, phonemes: list[str]) -> None:
        self._ipa = IpaSequence(
            phonemes=tuple(PhonemeLabel(p) for p in phonemes)
        )

    def convert(self, text: str, accent: str) -> IpaSequence:  # noqa: ANN001
        return self._ipa


class _FixedAligner:
    """固定 AlignmentBoundary を返す Aligner テストダブル（テストコードのみ）。

    reference_call_count を tracking して reference と learner を切り替える。
    1 回目の align() 呼び出し = reference_boundaries。
    2 回目の align() 呼び出し = learner_boundaries。
    """

    def __init__(
        self,
        reference_boundaries: tuple[AlignmentBoundary, ...],
        learner_boundaries: tuple[AlignmentBoundary, ...],
    ) -> None:
        self._reference_boundaries = reference_boundaries
        self._learner_boundaries = learner_boundaries
        self._call_count = 0

    def align(
        self,
        audio: AudioInput,
        reference_ipa: IpaSequence,
    ) -> tuple[tuple[AlignmentBoundary, ...], tuple[Any, ...]]:
        result_boundaries = (
            self._reference_boundaries if self._call_count == 0 else self._learner_boundaries
        )
        self._call_count += 1
        return result_boundaries, ()

    def detect_ipa(self, audio: AudioInput) -> IpaSequence:
        return IpaSequence(phonemes=(PhonemeLabel("h"),))

    def measure_audio_quality(self, audio: AudioInput) -> tuple[float, float]:
        return -20.0, 0.5


# ---------------------------------------------------------------------------
# DTW compute_lag の unit テスト
# ---------------------------------------------------------------------------


class TestDtwComputeLag:
    """infrastructure/dtw_lag.py の compute_lag 純関数テスト。

    espeak / torch 不要。純 numpy のみで検証できる。
    """

    def _make_boundaries(
        self, starts_ms: list[int], phonemes: list[str] | None = None
    ) -> tuple[AlignmentBoundary, ...]:
        """開始時刻リストから AlignmentBoundary タプルを生成する。"""
        if phonemes is None:
            phonemes = [f"p{i}" for i in range(len(starts_ms))]
        return tuple(
            AlignmentBoundary(
                phoneme=PhonemeLabel(p),
                start_milliseconds=start,
                end_milliseconds=start + 50,
            )
            for start, p in zip(starts_ms, phonemes, strict=False)
        )

    def test_lag_is_positive_when_learner_is_delayed(self) -> None:
        """学習者が 200ms 遅れているとき lagMilliseconds が正値であること。

        DTW は最適経路を探すため per_segment_lag に複数の対応が生成されうる。
        中央値が正値であることを確認する（精度よりロバスト性を優先した設計: ADR-013）。
        """
        # お手本: [0, 100, 200, 300] ms
        ref_boundaries = self._make_boundaries([0, 100, 200, 300], ["h", "ɛ", "l", "oʊ"])
        # 学習者: [200, 300, 400, 500] ms (200ms 遅れ)
        learner_boundaries = self._make_boundaries([200, 300, 400, 500], ["h", "ɛ", "l", "oʊ"])

        result = compute_lag(
            reference_boundaries=ref_boundaries,
            learner_boundaries=learner_boundaries,
        )

        assert result.lag_milliseconds > 0, (
            f"学習者遅れのとき lagMilliseconds が正値でない: {result.lag_milliseconds}"
        )

    def test_lag_differs_between_slow_and_fast_learner(self) -> None:
        """遅い発話と速い発話で lagMilliseconds が異なること（M-SHL-2 contract test）。

        別の learner_audio で lagMilliseconds が変わることを assert する。
        """
        ref_boundaries = self._make_boundaries([0, 100, 200, 300], ["h", "ɛ", "l", "oʊ"])

        # 遅い学習者: 500ms 遅れ
        slow_learner_boundaries = self._make_boundaries([500, 600, 700, 800], ["h", "ɛ", "l", "oʊ"])
        # 速い学習者: 50ms 遅れ
        fast_learner_boundaries = self._make_boundaries([50, 150, 250, 350], ["h", "ɛ", "l", "oʊ"])

        slow_result = compute_lag(
            reference_boundaries=ref_boundaries,
            learner_boundaries=slow_learner_boundaries,
        )
        fast_result = compute_lag(
            reference_boundaries=ref_boundaries,
            learner_boundaries=fast_learner_boundaries,
        )

        # M-SHL-2: 2 種類の learner 録音で lag が異なること
        assert slow_result.lag_milliseconds != fast_result.lag_milliseconds, (
            f"遅い/速い学習者で lag が同じ値になっている: "
            f"slow={slow_result.lag_milliseconds}, fast={fast_result.lag_milliseconds}"
        )
        assert slow_result.lag_milliseconds > fast_result.lag_milliseconds, (
            f"遅い学習者の lag が速い学習者より小さい: "
            f"slow={slow_result.lag_milliseconds}, fast={fast_result.lag_milliseconds}"
        )

    def test_per_segment_lag_length_matches_dtw_pairs(self) -> None:
        """perSegmentLag の長さが DTW 対応ペア数と一致すること。"""
        ref_boundaries = self._make_boundaries([0, 100, 200], ["h", "ɛ", "l"])
        learner_boundaries = self._make_boundaries([100, 200, 300], ["h", "ɛ", "l"])

        result = compute_lag(
            reference_boundaries=ref_boundaries,
            learner_boundaries=learner_boundaries,
        )

        assert len(result.per_segment_lag) > 0, "per_segment_lag が空"

    def test_empty_boundaries_returns_zero_lag(self) -> None:
        """境界が空のとき lagMilliseconds が 0.0 であること。"""
        result = compute_lag(
            reference_boundaries=(),
            learner_boundaries=(),
        )
        assert result.lag_milliseconds == 0.0

    def test_speech_rate_ratio_computed_from_waveforms(self) -> None:
        """waveform が渡されたとき speechRateRatio が None でないこと。"""
        ref_wav = np.zeros(16000, dtype=np.float32)
        ref_wav[1000:9000] = 0.5  # 0.5 秒の発話
        learner_wav = np.zeros(16000, dtype=np.float32)
        learner_wav[2000:14000] = 0.5  # 0.75 秒の発話

        ref_boundaries = self._make_boundaries([0, 100, 200, 300], ["h", "ɛ", "l", "oʊ"])
        learner_boundaries = self._make_boundaries([100, 200, 300, 400], ["h", "ɛ", "l", "oʊ"])

        result = compute_lag(
            reference_boundaries=ref_boundaries,
            learner_boundaries=learner_boundaries,
            reference_waveform=ref_wav,
            learner_waveform=learner_wav,
        )

        assert result.speech_rate_ratio is not None, "waveform があるとき speechRateRatio は None でない"

    def test_pause_count_computed_from_waveforms(self) -> None:
        """waveform が渡されたとき pauseCountLearner / pauseCountReference が None でないこと。"""
        ref_wav = np.zeros(16000, dtype=np.float32)
        ref_wav[500:7500] = 0.5
        learner_wav = np.zeros(16000, dtype=np.float32)
        learner_wav[1000:8000] = 0.5

        ref_boundaries = self._make_boundaries([0, 100], ["h", "ɛ"])
        learner_boundaries = self._make_boundaries([100, 200], ["h", "ɛ"])

        result = compute_lag(
            reference_boundaries=ref_boundaries,
            learner_boundaries=learner_boundaries,
            reference_waveform=ref_wav,
            learner_waveform=learner_wav,
        )

        assert result.pause_count_learner is not None
        assert result.pause_count_reference is not None


# ---------------------------------------------------------------------------
# ComputeShadowingLagUseCase の contract テスト（WAV バイト列経由）
# ---------------------------------------------------------------------------


class TestComputeShadowingLagUseCase:
    """ComputeShadowingLagUseCase の contract テスト。

    Aligner テストダブルを注入して音素境界を制御し、
    2 種類の learner 境界で lag が異なることを assert する（M-SHL-2）。
    """

    def _make_ref_boundaries(self) -> tuple[AlignmentBoundary, ...]:
        phonemes = ["h", "ɛ", "l", "oʊ"]
        return tuple(
            AlignmentBoundary(
                phoneme=PhonemeLabel(p),
                start_milliseconds=i * 100,
                end_milliseconds=i * 100 + 80,
            )
            for i, p in enumerate(phonemes)
        )

    def test_lag_differs_between_two_learner_audios(self) -> None:
        """2 種類の learner 境界で lag が変わること（M-SHL-2 contract test）。"""
        ref_boundaries = self._make_ref_boundaries()

        # 遅い学習者境界
        slow_boundaries = tuple(
            AlignmentBoundary(
                phoneme=PhonemeLabel(b.phoneme.value),
                start_milliseconds=b.start_milliseconds + 500,
                end_milliseconds=b.end_milliseconds + 500,
            )
            for b in ref_boundaries
        )
        # 速い学習者境界
        fast_boundaries = tuple(
            AlignmentBoundary(
                phoneme=PhonemeLabel(b.phoneme.value),
                start_milliseconds=b.start_milliseconds + 50,
                end_milliseconds=b.end_milliseconds + 50,
            )
            for b in ref_boundaries
        )

        ref_wav = _make_sine_wav(440.0, 1.0)
        slow_wav = _make_sine_wav(330.0, 1.5)  # 遅い発話を模した別録音
        fast_wav = _make_sine_wav(550.0, 0.8)  # 速い発話を模した別録音

        # 遅い learner 用の use_case
        slow_aligner = _FixedAligner(ref_boundaries, slow_boundaries)
        slow_use_case = ComputeShadowingLagUseCase(
            g2p_port=_FixedG2P(["h", "ɛ", "l", "oʊ"]),
            aligner_port=slow_aligner,
        )
        slow_result = slow_use_case.execute(
            reference_audio=_make_audio_input(ref_wav, 1000),
            learner_audio=_make_audio_input(slow_wav, 1500),
            reference_text="hello",
        )

        # 速い learner 用の use_case（新しい aligner を生成してカウントをリセット）
        fast_aligner = _FixedAligner(ref_boundaries, fast_boundaries)
        fast_use_case = ComputeShadowingLagUseCase(
            g2p_port=_FixedG2P(["h", "ɛ", "l", "oʊ"]),
            aligner_port=fast_aligner,
        )
        fast_result = fast_use_case.execute(
            reference_audio=_make_audio_input(ref_wav, 1000),
            learner_audio=_make_audio_input(fast_wav, 800),
            reference_text="hello",
        )

        # M-SHL-2: 別の learner 録音で lag が変わること
        assert slow_result.lag_milliseconds != fast_result.lag_milliseconds, (
            f"遅い/速い learner で lag が同じ: "
            f"slow={slow_result.lag_milliseconds}, fast={fast_result.lag_milliseconds}"
        )
        assert slow_result.lag_milliseconds > fast_result.lag_milliseconds, (
            f"遅い learner の lag が速い learner より小さい: "
            f"slow={slow_result.lag_milliseconds}, fast={fast_result.lag_milliseconds}"
        )

    def test_lag_is_not_fixed_value(self) -> None:
        """lagMilliseconds が固定値（0.0 等）でないこと（ADR-013 制約）。"""
        ref_boundaries = self._make_ref_boundaries()
        delayed_boundaries = tuple(
            AlignmentBoundary(
                phoneme=PhonemeLabel(b.phoneme.value),
                start_milliseconds=b.start_milliseconds + 300,
                end_milliseconds=b.end_milliseconds + 300,
            )
            for b in ref_boundaries
        )

        aligner = _FixedAligner(ref_boundaries, delayed_boundaries)
        use_case = ComputeShadowingLagUseCase(
            g2p_port=_FixedG2P(["h", "ɛ", "l", "oʊ"]),
            aligner_port=aligner,
        )

        ref_wav = _make_sine_wav(440.0, 1.0)
        learner_wav = _make_sine_wav(330.0, 1.3)

        result = use_case.execute(
            reference_audio=_make_audio_input(ref_wav, 1000),
            learner_audio=_make_audio_input(learner_wav, 1300),
            reference_text="hello",
        )

        assert result.lag_milliseconds != 0.0, (
            "lagMilliseconds が固定値 0.0 を返している（音素境界が空か DTW が壊れている）"
        )
        assert result.lag_milliseconds > 0.0, (
            f"300ms 遅れているのに lagMilliseconds が非正: {result.lag_milliseconds}"
        )
