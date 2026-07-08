"""シャドーイングラグ計測ユースケース（ADR-013）。

domain / usecase 層のみに依存。fastapi / torch を import しない。
infrastructure 実装は ports 経由で注入する。
"""

import io
import wave

import numpy as np

from python_analyzer.domain.audio import AudioInput
from python_analyzer.domain.phoneme import IpaSequence
from python_analyzer.domain.shadowing_lag import ShadowingLagMeasurement
from python_analyzer.infrastructure.dtw_lag import compute_lag
from python_analyzer.usecase.ports import WAV_MIME_TYPES, AlignerPort, G2PPort


class ComputeShadowingLagUseCase:
    """シャドーイングラグ計測ユースケース。

    reference_audio と learner_audio の両方を wav2vec2 で整列し、
    DTW でラグを計測して ShadowingLagMeasurement を返す。

    Args:
        g2p_port: referenceText -> IpaSequence 変換ポート。
        aligner_port: 音声 + IpaSequence -> 音素境界 ポート。
    """

    def __init__(
        self,
        g2p_port: G2PPort,
        aligner_port: AlignerPort,
    ) -> None:
        self._g2p = g2p_port
        self._aligner = aligner_port

    def execute(
        self,
        reference_audio: AudioInput,
        learner_audio: AudioInput,
        reference_text: str,
        target_accent: str = "generalAmerican",
    ) -> ShadowingLagMeasurement:
        """ラグ計測を実行して ShadowingLagMeasurement を返す。

        Args:
            reference_audio: お手本音声（Kokoro TTS 生成済み WAV）。
            learner_audio: 学習者録音（WAV / WebM 等）。
            reference_text: 両音声が発話しているテキスト（アライナーが要求）。
            target_accent: アクセント指定（デフォルト generalAmerican）。

        Returns:
            ShadowingLagMeasurement。強制整列に失敗した場合は lag_milliseconds=0.0。
        """
        # g2p で期待 IPA を取得する（両音声で共通）
        expected_ipa: IpaSequence = self._g2p.convert(reference_text, target_accent)

        # reference_audio を整列する
        reference_boundaries, _ = self._aligner.align(reference_audio, expected_ipa)

        # learner_audio を整列する
        learner_boundaries, _ = self._aligner.align(learner_audio, expected_ipa)

        # waveform を VAD 計測用に取得する（audio_energy 純関数に渡す）
        reference_waveform = _load_waveform_numpy(reference_audio)
        learner_waveform = _load_waveform_numpy(learner_audio)

        return compute_lag(
            reference_boundaries=reference_boundaries,
            learner_boundaries=learner_boundaries,
            reference_waveform=reference_waveform,
            learner_waveform=learner_waveform,
        )


def _load_waveform_numpy(audio: AudioInput) -> np.ndarray | None:
    """AudioInput の WAV バイト列から 16kHz モノラル float32 numpy 配列を取得する。

    WAV 形式以外または読み込み失敗時は None を返す（VAD はスキップ）。
    soundfile / torch は使わず wave モジュールのみで読む（VAD は純 numpy）。
    """
    mime_normalized = audio.mime_type.split(";")[0].strip().lower()
    if mime_normalized not in WAV_MIME_TYPES:
        return None

    try:
        with wave.open(io.BytesIO(audio.content)) as wav_file:
            n_channels = wav_file.getnchannels()
            sample_width = wav_file.getsampwidth()
            n_frames = wav_file.getnframes()
            raw_bytes = wav_file.readframes(n_frames)

        # PCM サンプルを float32 に変換する
        if sample_width == 2:
            samples = np.frombuffer(raw_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        elif sample_width == 1:
            samples = (
                np.frombuffer(raw_bytes, dtype=np.uint8).astype(np.float32) - 128.0
            ) / 128.0
        else:
            return None

        # ステレオをモノラルに変換する
        if n_channels > 1:
            samples = samples.reshape(-1, n_channels).mean(axis=1)

        return samples
    except Exception:
        return None
