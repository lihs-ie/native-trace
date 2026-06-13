"""発音解析ユースケース。

domain のみに依存。fastapi/torch/phonemizer を import しない。
"""

import io
import re
import wave
from dataclasses import replace

from python_analyzer.domain.audio import AudioInput
from python_analyzer.domain.measurement import PhonemeGopMeasurement, RawMeasurementResult
from python_analyzer.domain.phoneme import AlignmentBoundary
from python_analyzer.usecase.ports import AlignerPort, G2PPort, ProsodyPort, SpeechRatePort

# IPA 母音核として認識する文字セット（音節・母音持続時間の算出に使用）
_VOWEL_NUCLEI = frozenset("aeiouæɑɒɔəɛɪɨɵʊʌœøɯɤɐɞɘ")

# espeak 強勢記号
_STRESS_MARKS = frozenset({"ˈ", "ˌ"})


class AnalyzePronunciationUseCase:
    """発音解析ユースケース。

    g2p, aligner, speech_rate, prosody の 4 ポートをオーケストレートして
    RawMeasurementResult を返す。採点しない。
    """

    def __init__(
        self,
        g2p_port: G2PPort,
        aligner_port: AlignerPort,
        speech_rate_port: SpeechRatePort,
        prosody_port: ProsodyPort | None = None,
    ) -> None:
        self._g2p = g2p_port
        self._aligner = aligner_port
        self._speech_rate = speech_rate_port
        self._prosody = prosody_port

    def execute(
        self,
        audio: AudioInput,
        reference_text: str,
        target_accent: str,
        include_reference_f0: bool = True,
    ) -> RawMeasurementResult:
        """発音解析を実行し生計測結果を返す。

        Args:
            audio: 解析対象の音声入力。
            reference_text: 参照テキスト（"Hello, world." 等）。
            target_accent: アクセント指定（例: "generalAmerican"）。
            include_reference_f0: True のとき reference_text を Kokoro TTS で合成して
                reference F0 を抽出する。False のときスキップして None を返す（default True）。

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
        inter_word_silences, schwa_realizations, speech_rate = self._speech_rate.analyze(
            boundaries, audio.duration_milliseconds
        )

        # 録音品質計測（dBFS / 実音声長）
        mean_dbfs, speech_duration_seconds = self._aligner.measure_audio_quality(audio)

        # C1 韻律計測（prosody_port が注入されている場合のみ実行する）
        f0_contour = None
        reference_f0_contour = None
        word_stresses = ()
        rhythm = None
        weak_form_realizations = ()
        syllables = ()

        if self._prosody is not None:
            # 単語分割と境界情報を導出する
            words = _tokenize_words(reference_text)
            word_boundaries = _estimate_word_boundaries(words, boundaries)
            expected_ipa_per_word = _get_expected_ipa_per_word(
                words, reference_text, expected_ipa.to_string()
            )

            # C1-b F0 輪郭（PCM バイト列が必要）
            pcm_bytes = _extract_pcm_bytes(audio)
            sample_rate = _estimate_sample_rate(audio)
            f0_contour = self._prosody.measure_f0_contour(pcm_bytes, sample_rate)

            # C1-c 語強勢（espeak 強勢記号 + F0 ヒューリスティック）
            expected_stress_per_word = _parse_stress_per_word(words, expected_ipa_per_word)
            vowel_durations_per_word = _extract_vowel_durations_per_word(
                words, word_boundaries, boundaries
            )
            word_stresses = self._prosody.measure_word_stress(
                words=words,
                word_boundaries=word_boundaries,
                expected_stress_per_word=expected_stress_per_word,
                f0_contour=f0_contour,
                phoneme_durations_per_word=vowel_durations_per_word,
            )

            # C1-d リズム nPVI（全母音持続時間を結合して算出）
            all_vowel_durations: list[float] = []
            for durations in vowel_durations_per_word:
                all_vowel_durations.extend(float(d) for d in durations)
            rhythm = self._prosody.measure_rhythm(all_vowel_durations)

            # C1-e 弱形実現
            weak_form_realizations = self._prosody.detect_weak_forms(
                words=words,
                word_boundaries=word_boundaries,
                alignment_boundaries=boundaries,
            )

            # C1-f 音節数と epenthesis
            syllables = self._prosody.detect_syllables(
                words=words,
                word_boundaries=word_boundaries,
                expected_ipa_per_word=expected_ipa_per_word,
                alignment_boundaries=boundaries,
            )

            # M-F0REF-a: referenceText を Kokoro TTS で合成して F0 を抽出する
            # include_reference_f0=False のときスキップして None を維持する
            if include_reference_f0:
                reference_f0_contour = self._prosody.extract_reference_f0_contour(reference_text)

        # M-102R-b: 音素ごとの単語内位置（wordPosition）を付与する
        words_for_position = _tokenize_words(reference_text)
        word_boundaries_for_position = _estimate_word_boundaries(words_for_position, boundaries)
        per_phoneme_gop_with_position = _assign_word_positions(
            per_phoneme_gop, word_boundaries_for_position
        )

        return RawMeasurementResult(
            expected_ipa=expected_ipa,
            detected_ipa=detected_ipa,
            per_phoneme_gop=per_phoneme_gop_with_position,
            inter_word_silences=inter_word_silences,
            schwa_realizations=schwa_realizations,
            speech_rate_phoneme_per_second=speech_rate,
            alignment_boundaries=boundaries,
            mean_dbfs=mean_dbfs,
            speech_duration_seconds=speech_duration_seconds,
            f0_contour=f0_contour,
            word_stresses=word_stresses,
            rhythm=rhythm,
            weak_form_realizations=weak_form_realizations,
            syllables=syllables,
            reference_f0_contour=reference_f0_contour,
        )


# --- 内部ヘルパー（usecase 内純粋ロジック）---


def _tokenize_words(text: str) -> list[str]:
    """テキストを単語トークンリストに分割する。

    句読点を除去してから空白で分割する。
    """
    cleaned = re.sub(r"[^\w\s'-]", "", text)
    return [w for w in cleaned.split() if w]


def _estimate_word_boundaries(
    words: list[str],
    alignment_boundaries: tuple[AlignmentBoundary, ...],
) -> list[tuple[int, int]]:
    """単語数分の時間境界を音素境界から等分割で推定する。

    完全な単語境界検出は G2P 情報がなければ難しいため、
    整列された音素列全体を単語数で等分する簡易実装とする。
    単語数 0 または境界なしの場合は空リストを返す。
    """
    if not words or not alignment_boundaries:
        return [(0, 0)] * len(words)

    total_start = alignment_boundaries[0].start_milliseconds
    total_end = alignment_boundaries[-1].end_milliseconds
    total_duration = total_end - total_start

    word_count = len(words)
    segment_duration = total_duration // word_count if word_count > 0 else 0

    boundaries: list[tuple[int, int]] = []
    for index in range(word_count):
        start = total_start + index * segment_duration
        end = total_start + (index + 1) * segment_duration
        boundaries.append((start, end))

    # 最後の単語は音素列の末尾まで含める
    if boundaries:
        boundaries[-1] = (boundaries[-1][0], total_end)

    return boundaries


def _get_expected_ipa_per_word(
    words: list[str],
    reference_text: str,
    full_expected_ipa: str,
) -> list[str]:
    """単語ごとの期待 IPA 文字列リストを返す。

    espeak の出力は単語単位のセグメント分けが困難なため、
    全体の IPA を単語数で等分する簡易実装とする。
    母音核カウントによる音節対応は各関数内で行う。
    """
    ipa_chars = full_expected_ipa.split()
    word_count = len(words)
    if word_count == 0:
        return []
    if not ipa_chars:
        return [""] * word_count

    # IPA トークンを単語数で等分する
    chunk_size = max(1, len(ipa_chars) // word_count)
    result: list[str] = []
    for index in range(word_count):
        start_idx = index * chunk_size
        end_idx = start_idx + chunk_size if index < word_count - 1 else len(ipa_chars)
        result.append(" ".join(ipa_chars[start_idx:end_idx]))

    return result


def _parse_stress_per_word(
    words: list[str],
    expected_ipa_per_word: list[str],
) -> list[int]:
    """単語ごとの期待強勢（0/1/2）リストを IPA 文字列から導出する。

    espeak の IPA 出力には強勢記号（ˈ/ˌ）が含まれるが、
    _get_expected_ipa_per_word で取り除かれている場合もある。
    ここでは入力 IPA に強勢記号があれば解析し、なければ多音節語に 1 を設定する。
    """
    stress_list: list[int] = []
    for ipa_word in expected_ipa_per_word:
        if "ˈ" in ipa_word:
            stress_list.append(1)
        elif "ˌ" in ipa_word:
            stress_list.append(2)
        else:
            # 多音節語（母音核 >= 2）は第1強勢あり（デフォルト推定）
            vowel_count = sum(1 for char in ipa_word if char in _VOWEL_NUCLEI)
            stress_list.append(1 if vowel_count >= 2 else 0)
    return stress_list


def _extract_vowel_durations_per_word(
    words: list[str],
    word_boundaries: list[tuple[int, int]],
    alignment_boundaries: tuple[AlignmentBoundary, ...],
) -> list[list[int]]:
    """単語ごとの母音音素持続時間リストを返す。"""
    result: list[list[int]] = []
    for _word, (start_ms, end_ms) in zip(words, word_boundaries, strict=False):
        vowel_durations: list[int] = []
        for boundary in alignment_boundaries:
            if boundary.start_milliseconds < start_ms or boundary.end_milliseconds > end_ms:
                continue
            # 音素が母音核を含む場合
            if any(char in _VOWEL_NUCLEI for char in boundary.phoneme.value):
                duration = boundary.end_milliseconds - boundary.start_milliseconds
                if duration > 0:
                    vowel_durations.append(duration)
        result.append(vowel_durations)
    return result


def _assign_word_positions(
    per_phoneme_gop: tuple[PhonemeGopMeasurement, ...],
    word_boundaries: list[tuple[int, int]],
) -> tuple[PhonemeGopMeasurement, ...]:
    """各音素 GOP に単語内位置（"initial" | "medial" | "final"）を付与して返す。

    単語境界（start_ms, end_ms）を使って各音素がどの単語に属するかを判定し、
    単語内インデックスから位置ラベルを決定する。

    - 単語内最初の音素 → "initial"
    - 単語内最後の音素 → "final"
    - それ以外         → "medial"
    - 1 音素しかない語  → "final"（仕様: 1音素語は "final" 優先）

    音素が単語区間のいずれにも属さない場合は word_position = None を維持する。
    """
    if not per_phoneme_gop or not word_boundaries:
        return per_phoneme_gop

    # 単語ごとに属する音素インデックスリストを収集する
    word_phoneme_indices: list[list[int]] = [[] for _ in word_boundaries]
    for phoneme_index, gop_measurement in enumerate(per_phoneme_gop):
        phoneme_mid_ms = (
            gop_measurement.start_milliseconds + gop_measurement.end_milliseconds
        ) // 2
        for word_index, (word_start, word_end) in enumerate(word_boundaries):
            if word_start <= phoneme_mid_ms <= word_end:
                word_phoneme_indices[word_index].append(phoneme_index)
                break

    # 各音素に位置ラベルを付与する
    result = list(per_phoneme_gop)
    for phoneme_indices in word_phoneme_indices:
        if not phoneme_indices:
            continue
        word_size = len(phoneme_indices)
        for position_in_word, phoneme_index in enumerate(phoneme_indices):
            if word_size == 1:
                # 1 音素語は "final" 優先（仕様 C-A2W 実装判断）
                word_position = "final"
            elif position_in_word == 0:
                word_position = "initial"
            elif position_in_word == word_size - 1:
                word_position = "final"
            else:
                word_position = "medial"
            result[phoneme_index] = replace(result[phoneme_index], word_position=word_position)

    return tuple(result)


def _extract_pcm_bytes(audio: AudioInput) -> bytes:
    """AudioInput のバイト列を PCM バイト列として返す。

    WAV 形式の場合はそのまま返す（parselmouth が WAV を直接読める）。
    非 WAV 形式（WebM 等）は parselmouth が読めないため
    バイト列をそのまま渡す（parselmouth 側で失敗時は空 F0 を返す）。
    """
    return audio.content


def _estimate_sample_rate(audio: AudioInput) -> int:
    """WAV ヘッダーからサンプリングレートを取得する。

    取得できない場合は 16000 を返す。
    """
    mime_normalized = audio.mime_type.split(";")[0].strip().lower()
    if mime_normalized not in {"audio/wav", "audio/x-wav", "audio/wave"}:
        return 16000

    try:
        with wave.open(io.BytesIO(audio.content)) as wav_file:
            return wav_file.getframerate()
    except Exception:
        return 16000
