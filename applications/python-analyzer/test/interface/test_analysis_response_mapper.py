"""to_analysis_response 純関数のフィールド網羅 unit テスト（W42）。

実 wav2vec2 / torch / soundfile 不要。RawMeasurementResult を dataclass 直組みで与え、
camelCase キーと値変換（snake_case -> camelCase / .value 剥がし / duration 導出）を assert する。
期待値は移設前 app.py（W42 以前）のマッピング式から導出。
"""

from python_analyzer.domain.measurement import (
    F0Contour,
    InsertedVowel,
    InterWordSilence,
    NBestCandidate,
    PhonemeAcousticMeasurement,
    PhonemeGopMeasurement,
    RawMeasurementResult,
    RhythmMeasurement,
    SchwaRealization,
    SyllableMeasurement,
    WeakFormRealization,
    WordStressMeasurement,
)
from python_analyzer.domain.phoneme import GopScore, IpaSequence, PhonemeLabel
from python_analyzer.interface.analysis_response_mapper import to_analysis_response


def _make_full_result() -> RawMeasurementResult:
    """全 optional フィールドを実値で埋めた RawMeasurementResult を直組みする。"""
    return RawMeasurementResult(
        expected_ipa=IpaSequence(phonemes=(PhonemeLabel("h"), PhonemeLabel("ɛ"))),
        detected_ipa=IpaSequence(phonemes=(PhonemeLabel("h"), PhonemeLabel("e"))),
        per_phoneme_gop=(
            PhonemeGopMeasurement(
                phoneme=PhonemeLabel("h"),
                gop=GopScore(-1.25),
                start_milliseconds=10,
                end_milliseconds=90,
                n_best=(
                    NBestCandidate(phoneme="h", confidence=0.8),
                    NBestCandidate(phoneme="x", confidence=0.1),
                ),
                word_position="initial",
            ),
            PhonemeGopMeasurement(
                phoneme=PhonemeLabel("ɛ"),
                gop=GopScore(-3.5),
                start_milliseconds=90,
                end_milliseconds=180,
                n_best=(),
                word_position=None,
            ),
        ),
        inter_word_silences=(InterWordSilence(start_milliseconds=180, end_milliseconds=260),),
        schwa_realizations=(
            SchwaRealization(
                phoneme=PhonemeLabel("ə"),
                start_milliseconds=260,
                end_milliseconds=300,
                realized=True,
            ),
        ),
        speech_rate_phoneme_per_second=7.5,
        mean_dbfs=-21.5,
        speech_duration_seconds=1.25,
        estimated_snr_db=32.0,
        f0_contour=F0Contour(times_milliseconds=(0, 10), values_hz=(120.0, 0.0)),
        word_stresses=(
            WordStressMeasurement(
                word="hello",
                word_index=0,
                start_milliseconds=10,
                end_milliseconds=180,
                expected_stress=1,
                predicted_stress=2,
            ),
        ),
        rhythm=RhythmMeasurement(npvi_vocalic=55.0, reference_npvi_vocalic=60.0),
        weak_form_realizations=(
            WeakFormRealization(
                word="to",
                word_index=1,
                start_milliseconds=300,
                end_milliseconds=350,
                expected_weak=True,
                realized_weak=False,
            ),
        ),
        syllables=(
            SyllableMeasurement(
                word="hello",
                word_index=0,
                expected_syllable_count=2,
                actual_syllable_count=3,
                inserted_vowels=(InsertedVowel(position_milliseconds=150, vowel="ɯ"),),
            ),
        ),
        reference_f0_contour=F0Contour(times_milliseconds=(0, 20), values_hz=(110.0, 115.0)),
        phoneme_acoustics=(
            PhonemeAcousticMeasurement(
                phoneme="ɛ",
                start_milliseconds=90,
                end_milliseconds=180,
                f1_hz=550.0,
                f2_hz=1800.0,
                f3_hz=2500.0,
                spectral_centroid_hz=1200.0,
                duration_milliseconds=90,
            ),
        ),
    )


class TestToAnalysisResponseFullResult:
    """全フィールドが camelCase キーで値変換されること。"""

    def test_top_level_keys_are_exactly_the_wire_contract(self) -> None:
        """model_dump のトップレベルキー集合が wire 契約（camelCase）と一致すること。"""
        dumped = to_analysis_response(_make_full_result(), "F").model_dump()
        assert set(dumped.keys()) == {
            "expectedIpa",
            "detectedIpa",
            "perPhonemeGop",
            "interWordSilences",
            "schwaRealizations",
            "speechRatePhonemePerSecond",
            "meanDbfs",
            "estimatedSnrDb",
            "speechDurationSeconds",
            "f0Contour",
            "referenceF0Contour",
            "wordStress",
            "rhythm",
            "weakFormRealizations",
            "syllables",
            "phonemeAcoustics",
            "speakerSex",
        }

    def test_ipa_fields_are_space_joined_strings(self) -> None:
        """expectedIpa / detectedIpa が IpaSequence.to_string()（空白結合）であること。"""
        response = to_analysis_response(_make_full_result(), "F")
        assert response.expectedIpa == "h ɛ"
        assert response.detectedIpa == "h e"

    def test_per_phoneme_gop_unwraps_value_objects(self) -> None:
        """perPhonemeGop が PhonemeLabel.value / GopScore.value を剥がして camelCase 化すること。"""
        dumped = to_analysis_response(_make_full_result(), "F").model_dump()
        assert dumped["perPhonemeGop"] == [
            {
                "phoneme": "h",
                "gop": -1.25,
                "startMs": 10,
                "endMs": 90,
                "nBest": [
                    {"phoneme": "h", "confidence": 0.8},
                    {"phoneme": "x", "confidence": 0.1},
                ],
                "wordPosition": "initial",
            },
            {
                "phoneme": "ɛ",
                "gop": -3.5,
                "startMs": 90,
                "endMs": 180,
                "nBest": [],
                "wordPosition": None,
            },
        ]

    def test_inter_word_silence_duration_is_derived(self) -> None:
        """interWordSilences の durationMs が end - start で導出されること。"""
        dumped = to_analysis_response(_make_full_result(), "F").model_dump()
        assert dumped["interWordSilences"] == [{"startMs": 180, "endMs": 260, "durationMs": 80}]

    def test_scalar_measurements_pass_through(self) -> None:
        """スカラー計測値（話速 / dBFS / SNR / 発話長）が値そのままで camelCase キーに載ること。"""
        response = to_analysis_response(_make_full_result(), "F")
        assert response.speechRatePhonemePerSecond == 7.5
        assert response.meanDbfs == -21.5
        assert response.estimatedSnrDb == 32.0
        assert response.speechDurationSeconds == 1.25

    def test_schwa_and_prosody_collections_map_to_camel_case(self) -> None:
        """schwa / wordStress / weakForm / syllables / phonemeAcoustics の全 camelCase 変換。"""
        dumped = to_analysis_response(_make_full_result(), "F").model_dump()
        assert dumped["schwaRealizations"] == [
            {"phoneme": "ə", "startMs": 260, "endMs": 300, "realized": True}
        ]
        assert dumped["wordStress"] == [
            {
                "word": "hello",
                "wordIndex": 0,
                "startMs": 10,
                "endMs": 180,
                "expectedStress": 1,
                "predictedStress": 2,
            }
        ]
        assert dumped["weakFormRealizations"] == [
            {
                "word": "to",
                "wordIndex": 1,
                "startMs": 300,
                "endMs": 350,
                "expectedWeak": True,
                "realizedWeak": False,
            }
        ]
        assert dumped["syllables"] == [
            {
                "word": "hello",
                "wordIndex": 0,
                "expectedSyllableCount": 2,
                "actualSyllableCount": 3,
                "insertedVowels": [{"positionMs": 150, "vowel": "ɯ"}],
            }
        ]
        assert dumped["phonemeAcoustics"] == [
            {
                "phoneme": "ɛ",
                "startMs": 90,
                "endMs": 180,
                "f1Hz": 550.0,
                "f2Hz": 1800.0,
                "f3Hz": 2500.0,
                "spectralCentroidHz": 1200.0,
                "durationMs": 90,
            }
        ]

    def test_f0_contours_map_times_and_values(self) -> None:
        """f0Contour / referenceF0Contour が timesMs / valuesHz の list に変換されること。"""
        dumped = to_analysis_response(_make_full_result(), "F").model_dump()
        assert dumped["f0Contour"] == {"timesMs": [0, 10], "valuesHz": [120.0, 0.0]}
        assert dumped["referenceF0Contour"] == {"timesMs": [0, 20], "valuesHz": [110.0, 115.0]}

    def test_rhythm_maps_npvi_fields(self) -> None:
        """rhythm が npviVocalic / referenceNpviVocalic に変換されること。"""
        dumped = to_analysis_response(_make_full_result(), "F").model_dump()
        assert dumped["rhythm"] == {"npviVocalic": 55.0, "referenceNpviVocalic": 60.0}

    def test_speaker_sex_is_echoed(self) -> None:
        """speakerSex 引数がそのまま echo されること（M-APD-6 / M-APD-11）。"""
        result = _make_full_result()
        assert to_analysis_response(result, "F").speakerSex == "F"
        assert to_analysis_response(result, "M").speakerSex == "M"
        assert to_analysis_response(result, "unknown").speakerSex == "unknown"


class TestToAnalysisResponseMinimalResult:
    """optional フィールドが欠けた結果（None / 空 tuple）のマッピング。"""

    def _make_minimal_result(self) -> RawMeasurementResult:
        return RawMeasurementResult(
            expected_ipa=IpaSequence(phonemes=(PhonemeLabel("h"),)),
            detected_ipa=IpaSequence(phonemes=(PhonemeLabel("h"),)),
            per_phoneme_gop=(
                PhonemeGopMeasurement(
                    phoneme=PhonemeLabel("h"),
                    gop=GopScore(-0.5),
                    start_milliseconds=0,
                    end_milliseconds=100,
                ),
            ),
            inter_word_silences=(),
            schwa_realizations=(),
            speech_rate_phoneme_per_second=5.0,
        )

    def test_none_optionals_map_to_none(self) -> None:
        """f0Contour / referenceF0Contour / rhythm が None のとき None のままであること。"""
        response = to_analysis_response(self._make_minimal_result(), "unknown")
        assert response.f0Contour is None
        assert response.referenceF0Contour is None
        assert response.rhythm is None

    def test_empty_tuples_map_to_empty_lists(self) -> None:
        """空 tuple のコレクションが空 list に変換されること。"""
        dumped = to_analysis_response(self._make_minimal_result(), "unknown").model_dump()
        assert dumped["interWordSilences"] == []
        assert dumped["schwaRealizations"] == []
        assert dumped["wordStress"] == []
        assert dumped["weakFormRealizations"] == []
        assert dumped["syllables"] == []
        assert dumped["phonemeAcoustics"] == []

    def test_default_measurement_scalars_pass_through(self) -> None:
        """dataclass デフォルト値（0.0）のスカラーがそのまま載ること。"""
        response = to_analysis_response(self._make_minimal_result(), "unknown")
        assert response.meanDbfs == 0.0
        assert response.estimatedSnrDb == 0.0
        assert response.speechDurationSeconds == 0.0
