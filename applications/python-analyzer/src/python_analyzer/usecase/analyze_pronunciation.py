"""発音解析ユースケース。

domain のみに依存。fastapi/torch/phonemizer を import しない。
"""

from python_analyzer.domain.audio import AudioInput
from python_analyzer.domain.measurement import RawMeasurementResult
from python_analyzer.usecase.ports import AlignerPort, G2PPort, SpeechRatePort


class AnalyzePronunciationUseCase:
    """発音解析ユースケース。

    g2p, aligner, speech_rate の 3 ポートをオーケストレートして
    RawMeasurementResult を返す。採点しない。
    """

    def __init__(
        self,
        g2p_port: G2PPort,
        aligner_port: AlignerPort,
        speech_rate_port: SpeechRatePort,
    ) -> None:
        self._g2p = g2p_port
        self._aligner = aligner_port
        self._speech_rate = speech_rate_port

    def execute(
        self,
        audio: AudioInput,
        reference_text: str,
        target_accent: str,
    ) -> RawMeasurementResult:
        """発音解析を実行し生計測結果を返す。

        Args:
            audio: 解析対象の音声入力。
            reference_text: 参照テキスト（"Hello, world." 等）。
            target_accent: アクセント指定（例: "generalAmerican"）。

        Returns:
            RawMeasurementResult。per_phoneme_gop が空の場合は呼び出し元で 500 を返す。
        """
        # g2p で期待 IPA を生成する
        expected_ipa = self._g2p.convert(reference_text, target_accent)

        # wav2vec2 強制整列で境界と GOP を取得する
        boundaries, per_phoneme_gop = self._aligner.align(audio, expected_ipa)

        # CTC デコードで検出 IPA を推定する
        detected_ipa = self._aligner.detect_ipa(audio)

        # 話速・無音・シュワ解析を行う
        inter_word_silences, schwa_realizations, speech_rate = (
            self._speech_rate.analyze(boundaries, audio.duration_milliseconds)
        )

        return RawMeasurementResult(
            expected_ipa=expected_ipa,
            detected_ipa=detected_ipa,
            per_phoneme_gop=per_phoneme_gop,
            inter_word_silences=inter_word_silences,
            schwa_realizations=schwa_realizations,
            speech_rate_phoneme_per_second=speech_rate,
            alignment_boundaries=boundaries,
        )
