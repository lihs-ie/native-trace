"""ConvertVoiceUseCase ユニットテスト。

テストダブル（FakeRvcEngine / FakeQualityGate）は test/ のみに存在する（agent-policy）。
本番コードに mock/stub/placeholder を入れない。

品質ゲート通過 / withhold 両分岐を検証する。
"""

import io
import struct
import wave

import pytest

from golden_speaker.domain.conversion_result import ConversionResult
from golden_speaker.usecase.convert_voice import ConvertVoiceUseCase


# ---------------------------------------------------------------------------
# テスト用 WAV バイト列生成ヘルパー
# ---------------------------------------------------------------------------


def _make_wav_bytes(duration_seconds: float = 0.5, sample_rate: int = 16000) -> bytes:
    """テスト用の単純なサイン波 WAV バイト列を生成する。"""
    import math

    num_samples = int(sample_rate * duration_seconds)
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        for i in range(num_samples):
            value = int(32767 * math.sin(2 * math.pi * 440 * i / sample_rate))
            wav_file.writeframes(struct.pack("<h", value))
    return buffer.getvalue()


_LEARNER_WAV = _make_wav_bytes(0.5)
_CONVERTED_WAV = _make_wav_bytes(0.5)


# ---------------------------------------------------------------------------
# テストダブル（test/ のみ存在、本番コードに入れない — agent-policy）
# ---------------------------------------------------------------------------


class _FakeRvcEngine:
    """RvcEnginePort のテスト用フェイク実装（test/ のみ）。

    converted_bytes が None の場合は RuntimeError を送出してモデル不在をシミュレートする。
    """

    def __init__(self, converted_bytes: bytes | None = _CONVERTED_WAV) -> None:
        self._converted_bytes = converted_bytes
        self.calls: list[dict] = []

    def convert(self, learner_audio_bytes: bytes, target_voice: str) -> bytes:
        self.calls.append({"learner_audio_bytes": learner_audio_bytes, "target_voice": target_voice})
        if self._converted_bytes is None:
            raise RuntimeError("Model not available (fake)")
        return self._converted_bytes


class _FakeQualityGate:
    """QualityGatePort のテスト用フェイク実装（test/ のみ）。

    passed=True / False を制御可能にする。
    """

    def __init__(self, *, passed: bool = True, withhold_reason: str | None = None) -> None:
        self._passed = passed
        self._withhold_reason = withhold_reason
        self.calls: list[bytes] = []

    def check(self, audio_bytes: bytes) -> tuple[bool, str | None]:
        self.calls.append(audio_bytes)
        if self._passed:
            return True, None
        return False, self._withhold_reason or "quality_gate_failed"


# ---------------------------------------------------------------------------
# テスト
# ---------------------------------------------------------------------------


class TestConvertVoiceUseCaseQualityGatePassed:
    """品質ゲート通過分岐のテスト。"""

    def test_returns_conversion_result_with_audio_bytes(self) -> None:
        """品質ゲート通過時: audio_bytes に変換音声、quality_gate_passed=True を返す。"""
        engine = _FakeRvcEngine(converted_bytes=_CONVERTED_WAV)
        gate = _FakeQualityGate(passed=True)
        use_case = ConvertVoiceUseCase(engine=engine, quality_gate=gate, target_voice="p225")

        result = use_case.execute(learner_audio_bytes=_LEARNER_WAV)

        assert isinstance(result, ConversionResult)
        assert result.quality_gate_passed is True
        assert result.withhold_reason is None
        assert result.audio_bytes == _CONVERTED_WAV
        assert result.target_voice == "p225"

    def test_engine_receives_learner_audio(self) -> None:
        """engine.convert に learner_audio_bytes と target_voice が正しく渡される。"""
        engine = _FakeRvcEngine(converted_bytes=_CONVERTED_WAV)
        gate = _FakeQualityGate(passed=True)
        use_case = ConvertVoiceUseCase(engine=engine, quality_gate=gate, target_voice="p226")

        use_case.execute(learner_audio_bytes=_LEARNER_WAV)

        assert len(engine.calls) == 1
        assert engine.calls[0]["learner_audio_bytes"] == _LEARNER_WAV
        assert engine.calls[0]["target_voice"] == "p226"

    def test_quality_gate_receives_converted_bytes(self) -> None:
        """quality_gate.check に変換済み音声バイト列が渡される。"""
        engine = _FakeRvcEngine(converted_bytes=_CONVERTED_WAV)
        gate = _FakeQualityGate(passed=True)
        use_case = ConvertVoiceUseCase(engine=engine, quality_gate=gate, target_voice="p225")

        use_case.execute(learner_audio_bytes=_LEARNER_WAV)

        assert len(gate.calls) == 1
        assert gate.calls[0] == _CONVERTED_WAV


class TestConvertVoiceUseCaseQualityGateFailed:
    """品質ゲート不通過（withhold）分岐のテスト。"""

    def test_returns_withhold_result_when_gate_fails(self) -> None:
        """品質ゲート不通過時: audio_bytes=None, quality_gate_passed=False, withholdReason 設定。"""
        engine = _FakeRvcEngine(converted_bytes=_CONVERTED_WAV)
        gate = _FakeQualityGate(passed=False, withhold_reason="quality_gate_failed")
        use_case = ConvertVoiceUseCase(engine=engine, quality_gate=gate, target_voice="p225")

        result = use_case.execute(learner_audio_bytes=_LEARNER_WAV)

        assert result.quality_gate_passed is False
        assert result.audio_bytes is None
        assert result.withhold_reason == "quality_gate_failed"
        assert result.target_voice == "p225"

    def test_no_audio_bytes_on_withhold(self) -> None:
        """品質ゲート不通過時に audio_bytes が None であること（偽値返却禁止）。"""
        engine = _FakeRvcEngine(converted_bytes=_CONVERTED_WAV)
        gate = _FakeQualityGate(passed=False)
        use_case = ConvertVoiceUseCase(engine=engine, quality_gate=gate, target_voice="p225")

        result = use_case.execute(learner_audio_bytes=_LEARNER_WAV)

        assert result.audio_bytes is None


class TestConvertVoiceUseCaseModelUnavailable:
    """モデル不在（RuntimeError）分岐のテスト。"""

    def test_returns_model_unavailable_when_engine_raises(self) -> None:
        """RVC エンジンが RuntimeError を送出した場合: model_unavailable withhold を返す。"""
        engine = _FakeRvcEngine(converted_bytes=None)  # None → RuntimeError
        gate = _FakeQualityGate(passed=True)
        use_case = ConvertVoiceUseCase(engine=engine, quality_gate=gate, target_voice="p225")

        result = use_case.execute(learner_audio_bytes=_LEARNER_WAV)

        assert result.quality_gate_passed is False
        assert result.audio_bytes is None
        assert result.withhold_reason == "model_unavailable"

    def test_quality_gate_not_called_when_engine_raises(self) -> None:
        """RVC 推論失敗時: 品質ゲートは呼ばれない。"""
        engine = _FakeRvcEngine(converted_bytes=None)
        gate = _FakeQualityGate(passed=True)
        use_case = ConvertVoiceUseCase(engine=engine, quality_gate=gate, target_voice="p225")

        use_case.execute(learner_audio_bytes=_LEARNER_WAV)

        assert len(gate.calls) == 0
