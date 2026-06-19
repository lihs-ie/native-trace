"""PhonemeAcousticMeasurement dataclass の単体テスト（M-APD-1）。

受入条件:
- frozen dataclass として生成できること（外部ライブラリ依存なし）
- 全フィールドが型どおり格納されること
- vot_ms / frication_energy_ratio フィールドが存在しないこと（Phase 2 Non-goal）
- importable であること（python -c による確認に相当）
"""

import dataclasses

import pytest

from python_analyzer.domain.measurement import (
    PhonemeAcousticMeasurement,
    RawMeasurementResult,
)


class TestPhonemeAcousticMeasurementDataclass:
    """PhonemeAcousticMeasurement の dataclass 定義テスト。"""

    def test_creates_with_all_fields(self) -> None:
        """全フィールドを指定して生成できること。"""
        measurement = PhonemeAcousticMeasurement(
            phoneme="iː",
            start_milliseconds=100,
            end_milliseconds=200,
            f1_hz=350.0,
            f2_hz=2800.0,
            f3_hz=3200.0,
            spectral_centroid_hz=2000.0,
            duration_milliseconds=100,
        )
        assert measurement.phoneme == "iː"
        assert measurement.start_milliseconds == 100
        assert measurement.end_milliseconds == 200
        assert measurement.f1_hz == pytest.approx(350.0)
        assert measurement.f2_hz == pytest.approx(2800.0)
        assert measurement.f3_hz == pytest.approx(3200.0)
        assert measurement.spectral_centroid_hz == pytest.approx(2000.0)
        assert measurement.duration_milliseconds == 100

    def test_creates_with_none_fields(self) -> None:
        """f1/f2/f3/spectral_centroid が None の場合も生成できること（ガード適用時）。"""
        measurement = PhonemeAcousticMeasurement(
            phoneme="p",
            start_milliseconds=0,
            end_milliseconds=30,
            f1_hz=None,
            f2_hz=None,
            f3_hz=None,
            spectral_centroid_hz=None,
            duration_milliseconds=30,
        )
        assert measurement.f1_hz is None
        assert measurement.f2_hz is None
        assert measurement.f3_hz is None
        assert measurement.spectral_centroid_hz is None

    def test_is_frozen_dataclass(self) -> None:
        """frozen=True なので変更しようとすると FrozenInstanceError になること。"""
        measurement = PhonemeAcousticMeasurement(
            phoneme="æ",
            start_milliseconds=50,
            end_milliseconds=120,
            f1_hz=800.0,
            f2_hz=1700.0,
            f3_hz=2600.0,
            spectral_centroid_hz=1800.0,
            duration_milliseconds=70,
        )
        with pytest.raises(dataclasses.FrozenInstanceError):
            measurement.phoneme = "a"  # type: ignore[misc]

    def test_no_vot_ms_field(self) -> None:
        """vot_ms フィールドが存在しないこと（Phase 2 Non-goal）。"""
        field_names = {f.name for f in dataclasses.fields(PhonemeAcousticMeasurement)}
        assert "vot_ms" not in field_names

    def test_no_frication_energy_ratio_field(self) -> None:
        """frication_energy_ratio フィールドが存在しないこと（Phase 2 Non-goal）。"""
        field_names = {f.name for f in dataclasses.fields(PhonemeAcousticMeasurement)}
        assert "frication_energy_ratio" not in field_names


class TestRawMeasurementResultPhonemeAcousticsField:
    """RawMeasurementResult に phoneme_acoustics フィールドが追加されていること（M-APD-1）。"""

    def test_phoneme_acoustics_default_is_empty_tuple(self) -> None:
        """phoneme_acoustics のデフォルトが空 tuple であること（後方互換）。"""
        from python_analyzer.domain.measurement import RawMeasurementResult
        from python_analyzer.domain.phoneme import IpaSequence, PhonemeLabel

        # 最小限の RawMeasurementResult を構築する（phoneme_acoustics を省略）
        result = RawMeasurementResult(
            expected_ipa=IpaSequence(
                phonemes=(PhonemeLabel("h"), PhonemeLabel("ɛ"), PhonemeLabel("l"), PhonemeLabel("oʊ"))
            ),
            detected_ipa=IpaSequence(
                phonemes=(PhonemeLabel("h"), PhonemeLabel("ɛ"), PhonemeLabel("l"), PhonemeLabel("oʊ"))
            ),
            per_phoneme_gop=(),
            inter_word_silences=(),
            schwa_realizations=(),
            speech_rate_phoneme_per_second=0.0,
        )
        assert result.phoneme_acoustics == ()

    def test_phoneme_acoustics_accepts_tuple(self) -> None:
        """phoneme_acoustics に tuple を渡せること。"""
        from python_analyzer.domain.measurement import RawMeasurementResult
        from python_analyzer.domain.phoneme import IpaSequence, PhonemeLabel

        measurement = PhonemeAcousticMeasurement(
            phoneme="æ",
            start_milliseconds=100,
            end_milliseconds=180,
            f1_hz=850.0,
            f2_hz=1700.0,
            f3_hz=2500.0,
            spectral_centroid_hz=None,
            duration_milliseconds=80,
        )

        result = RawMeasurementResult(
            expected_ipa=IpaSequence(phonemes=(PhonemeLabel("æ"),)),
            detected_ipa=IpaSequence(phonemes=(PhonemeLabel("æ"),)),
            per_phoneme_gop=(),
            inter_word_silences=(),
            schwa_realizations=(),
            speech_rate_phoneme_per_second=0.0,
            phoneme_acoustics=(measurement,),
        )
        assert len(result.phoneme_acoustics) == 1
        assert result.phoneme_acoustics[0].phoneme == "æ"
