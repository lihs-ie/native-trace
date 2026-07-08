"""シャドーイングラグ計測ユースケース（ADR-013）。

domain / usecase 層のみに依存。fastapi / torch / numpy を import しない。
infrastructure 実装は ports 経由で注入する（W41: LagComputationPort 依存逆転）。
"""

from python_analyzer.domain.audio import AudioInput
from python_analyzer.domain.phoneme import IpaSequence
from python_analyzer.domain.shadowing_lag import ShadowingLagMeasurement
from python_analyzer.usecase.ports import AlignerPort, G2PPort, LagComputationPort


class ComputeShadowingLagUseCase:
    """シャドーイングラグ計測ユースケース。

    reference_audio と learner_audio の両方を wav2vec2 で整列し、
    DTW でラグを計測して ShadowingLagMeasurement を返す。

    Args:
        g2p_port: referenceText -> IpaSequence 変換ポート。
        aligner_port: 音声 + IpaSequence -> 音素境界 ポート。
        lag_computation_port: 音素境界 + 音声 -> ShadowingLagMeasurement ポート（W41）。
    """

    def __init__(
        self,
        g2p_port: G2PPort,
        aligner_port: AlignerPort,
        lag_computation_port: LagComputationPort,
    ) -> None:
        self._g2p = g2p_port
        self._aligner = aligner_port
        self._lag_computation = lag_computation_port

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

        # ラグ計測は port 経由で infrastructure に委譲する（waveform 抽出は port 実装側の責務）
        return self._lag_computation.compute(
            reference_boundaries=reference_boundaries,
            learner_boundaries=learner_boundaries,
            reference_audio=reference_audio,
            learner_audio=learner_audio,
        )
