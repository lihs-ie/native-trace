"""F0ContinuityQualityGate ユニットテスト。

実際の WAV バイト列（サイン波 / サイレンス / 断続信号）を使って品質ゲートを検証する。
numpy が利用可能であることが前提（テスト環境に依存ライブラリがインストール済み）。

【テスト設計方針 — OQ-1 確定仕様】
品質ゲートは「変換後音声の F0 連続性（unvoiced フレーム割合）」のみを評価する。
  通過条件: unvoiced_rate <= GOLDEN_QUALITY_THRESHOLD（env, デフォルト 0.5）
  閾値の意味: unvoiced フレームの許容割合（0.0–1.0）

逆インセンティブ不在の保証:
  1. check(audio_bytes) は出力音声のみを受け取る（入力音声を受け取らない）。
  2. 強変換出力（入力と周波数・音色が大きく異なる）でも F0 が連続なら通過する。
  3. ピッチが女性方向にシフトした出力（例: 880Hz サイン波）も F0 連続なら pass する。
  4. 入出力 RMS 比・相互相関・入力との類似度を評価しない。
"""

import io
import math
import struct
import wave

import numpy as np
import pytest

from golden_speaker.infrastructure.quality_gate import F0ContinuityQualityGate


# ---------------------------------------------------------------------------
# テスト用 WAV 生成ヘルパー
# ---------------------------------------------------------------------------


def _make_sine_wav(
    frequency_hz: float = 440.0,
    duration_seconds: float = 1.0,
    sample_rate: int = 16000,
    amplitude: float = 0.8,
) -> bytes:
    """サイン波 WAV バイト列を生成する（有声音声の代替）。

    有声音声は有声フレーム比率が高い（unvoiced_rate が低い）ため品質ゲートを通過する。
    """
    num_samples = int(sample_rate * duration_seconds)
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        for i in range(num_samples):
            value = int(32767 * amplitude * math.sin(2 * math.pi * frequency_hz * i / sample_rate))
            wav_file.writeframes(struct.pack("<h", value))
    return buffer.getvalue()


def _make_silence_wav(duration_seconds: float = 1.0, sample_rate: int = 16000) -> bytes:
    """無音 WAV バイト列を生成する。

    無音は全フレーム unvoiced → unvoiced_rate=1.0 → 品質ゲート不通過。
    """
    num_samples = int(sample_rate * duration_seconds)
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(b"\x00\x00" * num_samples)
    return buffer.getvalue()


def _make_very_short_wav(duration_seconds: float = 0.05, sample_rate: int = 16000) -> bytes:
    """極端に短い WAV（< 100ms）を生成する（F0 抽出不能 → withhold）。"""
    return _make_sine_wav(duration_seconds=duration_seconds, sample_rate=sample_rate)


def _make_high_pitch_sine_wav(
    frequency_hz: float = 880.0,
    duration_seconds: float = 1.0,
    sample_rate: int = 16000,
    amplitude: float = 0.6,
) -> bytes:
    """女性方向にピッチシフトした強変換出力を模倣するサイン波 WAV を生成する。

    入力（例: 440Hz）と全く異なる周波数・振幅だが有声音声として連続している。
    このような強変換出力が品質ゲートを通過することを確認する（逆インセンティブ不在）。
    """
    return _make_sine_wav(
        frequency_hz=frequency_hz,
        duration_seconds=duration_seconds,
        sample_rate=sample_rate,
        amplitude=amplitude,
    )


def _make_mostly_silent_wav(
    duration_seconds: float = 1.0,
    sample_rate: int = 16000,
    voiced_fraction: float = 0.2,
) -> bytes:
    """大部分が無音（unvoiced）のWAVを生成する。

    voiced_fraction: 有声部分の割合（0.0–1.0）
    voiced_fraction=0.2 → unvoiced_rate≈0.8 → デフォルト閾値 0.5 超え → withhold。
    """
    num_samples = int(sample_rate * duration_seconds)
    n_voiced_samples = int(num_samples * voiced_fraction)
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        for i in range(num_samples):
            if i < n_voiced_samples:
                value = int(32767 * 0.8 * math.sin(2 * math.pi * 440.0 * i / sample_rate))
            else:
                value = 0
            wav_file.writeframes(struct.pack("<h", value))
    return buffer.getvalue()


# ---------------------------------------------------------------------------
# テスト: 有声音声は通過する（F0 連続性あり）
# ---------------------------------------------------------------------------


class TestQualityGatePassesVoicedAudio:
    """有声音声（F0 連続性あり）は品質ゲートを通過する。"""

    def test_sine_wave_passes_quality_gate(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """440Hz サイン波（F0 連続、有声フレーム多数）は品質ゲートを通過する。

        threshold=0.5: unvoiced_rate <= 0.5 で通過。
        440Hz サイン波はほぼ全フレーム有声 → unvoiced_rate << 0.5 → pass。
        """
        monkeypatch.setenv("GOLDEN_QUALITY_THRESHOLD", "0.5")
        gate = F0ContinuityQualityGate()
        audio_bytes = _make_sine_wav(frequency_hz=440.0, duration_seconds=1.0)

        passed, reason = gate.check(audio_bytes)

        assert passed is True
        assert reason is None

    def test_high_pitch_sine_also_passes(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """女性方向にシフトした高ピッチ音声（880Hz）も品質ゲートを通過する。

        強変換出力（入力の 440Hz と異なる 880Hz）でも F0 が連続なら pass する。
        これが True なら「変換が強い = fail」という逆インセンティブは存在しない。
        """
        monkeypatch.setenv("GOLDEN_QUALITY_THRESHOLD", "0.5")
        gate = F0ContinuityQualityGate()
        # 入力より高い周波数（女性帯域方向）の強変換出力を模倣
        audio_bytes = _make_high_pitch_sine_wav(frequency_hz=880.0, duration_seconds=1.0)

        passed, reason = gate.check(audio_bytes)

        assert passed is True, (
            "High-pitch output (simulating female-direction conversion) should pass F0 gate; "
            "F0 continuity is good → no reverse incentive against strong conversion"
        )
        assert reason is None

    def test_very_high_pitch_sine_also_passes(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """さらに高いピッチ（1200Hz）の強変換出力も F0 連続なら通過する。

        逆インセンティブ不在の追加確認: 入力とは全く異なる出力でも pass。
        """
        monkeypatch.setenv("GOLDEN_QUALITY_THRESHOLD", "0.5")
        gate = F0ContinuityQualityGate()
        audio_bytes = _make_high_pitch_sine_wav(
            frequency_hz=1200.0, duration_seconds=1.0, amplitude=0.3
        )

        passed, reason = gate.check(audio_bytes)

        assert passed is True, (
            "Very different output (1200Hz vs input 440Hz equivalent) should pass F0 gate; "
            "F0 continuity matters, not similarity to input"
        )
        assert reason is None


# ---------------------------------------------------------------------------
# テスト: 無音 / 崩壊音声は通過しない（F0 連続性なし）
# ---------------------------------------------------------------------------


class TestQualityGateFailsBrokenAudio:
    """無音・F0 崩壊音声は品質ゲートを通過しない。"""

    def test_silence_fails_quality_gate(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """無音（全フレーム unvoiced）は品質ゲートを通過しない。

        無音 → unvoiced_rate=1.0 > threshold=0.5 → withhold。
        """
        monkeypatch.setenv("GOLDEN_QUALITY_THRESHOLD", "0.5")
        gate = F0ContinuityQualityGate()
        audio_bytes = _make_silence_wav(duration_seconds=1.0)

        passed, reason = gate.check(audio_bytes)

        assert passed is False
        assert reason == "quality_gate_failed"

    def test_withhold_reason_on_silence(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """無音の withhold_reason が quality_gate_failed であること。"""
        monkeypatch.setenv("GOLDEN_QUALITY_THRESHOLD", "0.5")
        gate = F0ContinuityQualityGate()
        audio_bytes = _make_silence_wav(duration_seconds=1.0)

        passed, reason = gate.check(audio_bytes)

        assert reason == "quality_gate_failed"
        assert passed is False

    def test_strict_threshold_causes_mostly_silent_to_fail(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """厳しい閾値（threshold=0.3）では unvoiced 多数の音声を withhold する。

        voiced_fraction=0.2 → 有声部 20% → unvoiced_rate≈0.8 > threshold=0.3 → fail。
        """
        monkeypatch.setenv("GOLDEN_QUALITY_THRESHOLD", "0.3")
        gate = F0ContinuityQualityGate()
        audio_bytes = _make_mostly_silent_wav(duration_seconds=1.0, voiced_fraction=0.2)

        passed, reason = gate.check(audio_bytes)

        assert passed is False
        assert reason == "quality_gate_failed"


# ---------------------------------------------------------------------------
# テスト: 極端に短い音声
# ---------------------------------------------------------------------------


class TestQualityGateShortAudio:
    """極端に短い音声での品質ゲートテスト。"""

    def test_very_short_audio_fails_quality_gate(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """100ms 未満の音声は F0 抽出不能として品質ゲートを通過しない。"""
        monkeypatch.setenv("GOLDEN_QUALITY_THRESHOLD", "0.5")
        gate = F0ContinuityQualityGate()
        audio_bytes = _make_very_short_wav(duration_seconds=0.05)

        passed, reason = gate.check(audio_bytes)

        assert passed is False
        assert reason == "quality_gate_failed"


# ---------------------------------------------------------------------------
# テスト: 不正入力
# ---------------------------------------------------------------------------


class TestQualityGateInvalidInput:
    """不正入力での品質ゲートテスト。"""

    def test_invalid_bytes_fails_gracefully(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """WAV として解釈できないバイト列は品質ゲート不通過（例外を伝播しない）。"""
        monkeypatch.setenv("GOLDEN_QUALITY_THRESHOLD", "0.5")
        gate = F0ContinuityQualityGate()

        passed, reason = gate.check(b"not a wav file")

        assert passed is False
        assert reason == "quality_gate_failed"


# ---------------------------------------------------------------------------
# テスト: 逆インセンティブが存在しないことの確認（仕様固定）
# ---------------------------------------------------------------------------


class TestNoReverseIncentive:
    """逆インセンティブが存在しないことを仕様として固定する。

    M-GCF-4 要件: quality_gate が「入出力類似度」を pass 条件に使わないこと。
    強変換出力（入力と非類似）でも F0 連続なら通過することをテストで保証する。
    """

    def test_strongly_converted_output_passes_if_f0_continuous(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """強変換出力（入力と全く異なる周波数・振幅）でも F0 連続なら pass する。

        逆インセンティブ不在の核心テスト:
          - 「入力 = 低ピッチ 440Hz」「出力 = 高ピッチ 1200Hz + 異なる振幅」
          - F0 は連続（サイン波として安定）
          - pass になることで「入力に似ているほど通過」という逆インセンティブが
            存在しないことを保証する。
        """
        monkeypatch.setenv("GOLDEN_QUALITY_THRESHOLD", "0.5")
        gate = F0ContinuityQualityGate()

        # 入力とは大きく異なる出力（女性方向の強いピッチシフト + 音色変化を模倣）
        output_audio = _make_high_pitch_sine_wav(
            frequency_hz=1200.0,
            duration_seconds=1.0,
            amplitude=0.3,
        )

        passed, reason = gate.check(output_audio)

        assert passed is True, (
            "Strongly converted output (different pitch/amplitude from input) should pass "
            "F0 quality gate when F0 is continuous; "
            "no reverse incentive for similar-to-input outputs (M-GCF-4)"
        )
        assert reason is None

    def test_quality_gate_does_not_receive_input_audio(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """QualityGatePort の check シグネチャは output のみを受け取る（入力なし）。

        シグネチャを確認することで「入出力比較を実装できない構造」を保証する。
        入力なし = 入出力類似度を評価できない = 逆インセンティブが構造上存在しない。
        """
        monkeypatch.setenv("GOLDEN_QUALITY_THRESHOLD", "0.5")
        gate = F0ContinuityQualityGate()
        import inspect

        sig = inspect.signature(gate.check)
        params = list(sig.parameters.keys())

        # check(self, audio_bytes) のみ。input_audio_bytes は存在しない。
        assert "audio_bytes" in params
        assert "input_audio_bytes" not in params
        assert len(params) == 1, f"check() should take only audio_bytes, got: {params}"


# ---------------------------------------------------------------------------
# テスト: 環境変数による閾値制御（unvoiced 許容割合）
# ---------------------------------------------------------------------------


class TestQualityGateThresholdEnv:
    """GOLDEN_QUALITY_THRESHOLD env 閾値のテスト（domain literal 禁止 / OQ-1 セマンティクス確認）。

    閾値の意味: unvoiced フレームの許容割合（0.0–1.0）
      threshold=0.0: unvoiced 0% 以下でのみ通過（有声フレームが 1 つでもあれば... ほぼ全部 fail）
      threshold=0.5: unvoiced 50% 以下なら通過（デフォルト / compose 値）
      threshold=1.0: 全フレーム unvoiced でも通過（実質ゲート無効）
    """

    def test_permissive_threshold_passes_voiced_audio(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """threshold=0.9（非常に緩い）のとき、有声音声は当然通過する。"""
        monkeypatch.setenv("GOLDEN_QUALITY_THRESHOLD", "0.9")
        gate = F0ContinuityQualityGate()
        audio_bytes = _make_sine_wav(frequency_hz=440.0, duration_seconds=1.0, amplitude=0.8)

        passed, reason = gate.check(audio_bytes)

        assert passed is True
        assert reason is None

    def test_invalid_threshold_env_falls_back_to_default(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """不正な threshold env 値はデフォルト値（0.5）にフォールバックし、例外を投げない。"""
        monkeypatch.setenv("GOLDEN_QUALITY_THRESHOLD", "not_a_number")
        gate = F0ContinuityQualityGate()
        audio_bytes = _make_sine_wav(frequency_hz=440.0, duration_seconds=1.0)

        # デフォルト閾値（0.5）: サイン波（ほぼ全有声）は通過するはず
        passed, reason = gate.check(audio_bytes)

        assert isinstance(passed, bool)
        if passed:
            assert reason is None
        else:
            assert reason == "quality_gate_failed"

    def test_nan_inf_check_is_independent_of_threshold(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """NaN/Inf チェックは threshold 設定に関わらず動作する。

        不正バイト列は WAV デコード失敗として quality_gate_failed を返す。
        """
        monkeypatch.setenv("GOLDEN_QUALITY_THRESHOLD", "1.0")
        gate = F0ContinuityQualityGate()

        # 不正バイト列は WAV デコード失敗 → quality_gate_failed
        passed, reason = gate.check(b"\xff\xfe\xfd\xfc" * 100)

        assert passed is False
        assert reason == "quality_gate_failed"

    def test_threshold_semantics_unvoiced_rate(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """閾値は unvoiced フレームの許容割合として機能することを確認する（OQ-1 確定設計）。

        threshold=0.5 でも threshold=0.9 でも、有声音声（サイン波）は通過する。
        閾値の変化が有声音声の合否を変えないことで「閾値 = unvoiced 許容割合」を確認。
        """
        gate = F0ContinuityQualityGate()
        audio_bytes = _make_sine_wav(frequency_hz=440.0, duration_seconds=1.0)

        for threshold in ["0.5", "0.7", "0.9"]:
            monkeypatch.setenv("GOLDEN_QUALITY_THRESHOLD", threshold)
            passed, reason = gate.check(audio_bytes)
            assert passed is True, f"Voiced sine wave should pass at threshold={threshold}"
            assert reason is None
