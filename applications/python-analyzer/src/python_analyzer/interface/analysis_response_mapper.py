"""RawMeasurementResult -> AnalysisResponse の純関数マッパー（W42）。

/v1/analyze の応答マッピングを http_handler のルート定義から分離する。
採点・判定・IO を含まない純関数。camelCase の wire 契約は schema.py が正（§4.1-3 凍結）。
マッピング式は移設前の app.py（W42 以前）と同一。
"""

from python_analyzer.domain.measurement import RawMeasurementResult
from python_analyzer.interface.schema import (
    AnalysisResponse,
    F0ContourResponse,
    InsertedVowelResponse,
    InterWordSilenceResponse,
    NBestCandidateResponse,
    PhonemeAcousticResponse,
    PhonemeGopResponse,
    RhythmResponse,
    SchwaRealizationResponse,
    SyllableResponse,
    WeakFormRealizationResponse,
    WordStressResponse,
)


def to_analysis_response(result: RawMeasurementResult, speaker_sex: str) -> AnalysisResponse:
    """生計測結果を AnalysisResponse（camelCase wire 契約）に変換する。

    Args:
        result: usecase が返した生計測結果。
        speaker_sex: リクエスト metadata の speakerSex（レスポンスに echo する）。

    Returns:
        AnalysisResponse。フィールド名・値変換は移設前の app.py と同一。
    """
    # C1-b F0 輪郭を schema に変換する
    f0_contour_response: F0ContourResponse | None = None
    if result.f0_contour is not None:
        f0_contour_response = F0ContourResponse(
            timesMs=list(result.f0_contour.times_milliseconds),
            valuesHz=list(result.f0_contour.values_hz),
        )

    # M-F0REF-a: reference F0 輪郭を schema に変換する（既存 F0ContourResponse 型を再利用）
    reference_f0_contour_response: F0ContourResponse | None = None
    if result.reference_f0_contour is not None:
        reference_f0_contour_response = F0ContourResponse(
            timesMs=list(result.reference_f0_contour.times_milliseconds),
            valuesHz=list(result.reference_f0_contour.values_hz),
        )

    # C1-d リズムを schema に変換する
    rhythm_response: RhythmResponse | None = None
    if result.rhythm is not None:
        rhythm_response = RhythmResponse(
            npviVocalic=result.rhythm.npvi_vocalic,
            referenceNpviVocalic=result.rhythm.reference_npvi_vocalic,
        )

    return AnalysisResponse(
        expectedIpa=result.expected_ipa.to_string(),
        detectedIpa=result.detected_ipa.to_string(),
        # C1-a nBest + M-102R-b wordPosition を含む perPhonemeGop
        perPhonemeGop=[
            PhonemeGopResponse(
                phoneme=gop_m.phoneme.value,
                gop=gop_m.gop.value,
                startMs=gop_m.start_milliseconds,
                endMs=gop_m.end_milliseconds,
                nBest=[
                    NBestCandidateResponse(
                        phoneme=candidate.phoneme,
                        confidence=candidate.confidence,
                    )
                    for candidate in gop_m.n_best
                ],
                wordPosition=gop_m.word_position,
            )
            for gop_m in result.per_phoneme_gop
        ],
        interWordSilences=[
            InterWordSilenceResponse(
                startMs=s.start_milliseconds,
                endMs=s.end_milliseconds,
                durationMs=s.duration_milliseconds,
            )
            for s in result.inter_word_silences
        ],
        schwaRealizations=[
            SchwaRealizationResponse(
                phoneme=schwa.phoneme.value,
                startMs=schwa.start_milliseconds,
                endMs=schwa.end_milliseconds,
                realized=schwa.realized,
            )
            for schwa in result.schwa_realizations
        ],
        speechRatePhonemePerSecond=result.speech_rate_phoneme_per_second,
        meanDbfs=result.mean_dbfs,
        estimatedSnrDb=result.estimated_snr_db,
        speechDurationSeconds=result.speech_duration_seconds,
        # C1-b F0
        f0Contour=f0_contour_response,
        # M-F0REF-a: お手本 F0 輪郭（Kokoro TTS + parselmouth）
        referenceF0Contour=reference_f0_contour_response,
        # C1-c 語強勢
        wordStress=[
            WordStressResponse(
                word=ws.word,
                wordIndex=ws.word_index,
                startMs=ws.start_milliseconds,
                endMs=ws.end_milliseconds,
                expectedStress=ws.expected_stress,
                predictedStress=ws.predicted_stress,
            )
            for ws in result.word_stresses
        ],
        # C1-d リズム
        rhythm=rhythm_response,
        # C1-e 弱形実現
        weakFormRealizations=[
            WeakFormRealizationResponse(
                word=wf.word,
                wordIndex=wf.word_index,
                startMs=wf.start_milliseconds,
                endMs=wf.end_milliseconds,
                expectedWeak=wf.expected_weak,
                realizedWeak=wf.realized_weak,
            )
            for wf in result.weak_form_realizations
        ],
        # C1-f 音節
        syllables=[
            SyllableResponse(
                word=syl.word,
                wordIndex=syl.word_index,
                expectedSyllableCount=syl.expected_syllable_count,
                actualSyllableCount=syl.actual_syllable_count,
                insertedVowels=[
                    InsertedVowelResponse(
                        positionMs=iv.position_milliseconds,
                        vowel=iv.vowel,
                    )
                    for iv in syl.inserted_vowels
                ],
            )
            for syl in result.syllables
        ],
        # M-APD-7: per-phoneme 音響計測を AnalysisResponse にマップする（ADR-018 D1）
        phonemeAcoustics=[
            PhonemeAcousticResponse(
                phoneme=acoustic_measurement.phoneme,
                startMs=acoustic_measurement.start_milliseconds,
                endMs=acoustic_measurement.end_milliseconds,
                f1Hz=acoustic_measurement.f1_hz,
                f2Hz=acoustic_measurement.f2_hz,
                f3Hz=acoustic_measurement.f3_hz,
                spectralCentroidHz=acoustic_measurement.spectral_centroid_hz,
                durationMs=acoustic_measurement.duration_milliseconds,
            )
            for acoustic_measurement in result.phoneme_acoustics
        ],
        # M-APD-6 / M-APD-11: speakerSex を echo する（worker が Hillenbrand ノルム照合に使用）
        speakerSex=speaker_sex,
    )
