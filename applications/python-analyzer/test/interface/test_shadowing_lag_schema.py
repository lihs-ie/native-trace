"""ShadowingLagRequest / ShadowingLagResponse schema テスト（ADR-013 / M-SHL-1）。

espeak / torch 不要。Pydantic モデルの構造を検証する pure unit test。
"""

import pytest

from python_analyzer.interface.schema import (
    PerSegmentLagResponse,
    ShadowingLagMetadata,
    ShadowingLagResponse,
)


class TestShadowingLagMetadata:
    """ShadowingLagMetadata のバリデーションテスト。"""

    def test_valid_metadata_parses_correctly(self) -> None:
        """必須フィールドが揃っているとき Pydantic がパースできること。"""
        metadata = ShadowingLagMetadata(
            referenceText="Hello, world.",
            mimeType="audio/wav",
            durationMilliseconds=1500,
        )
        assert metadata.referenceText == "Hello, world."
        assert metadata.mimeType == "audio/wav"
        assert metadata.durationMilliseconds == 1500

    def test_metadata_from_dict(self) -> None:
        """dict から model_validate でパースできること。"""
        data = {
            "referenceText": "The cat sat on the mat.",
            "mimeType": "audio/wav",
            "durationMilliseconds": 2000,
        }
        metadata = ShadowingLagMetadata.model_validate(data)
        assert metadata.referenceText == "The cat sat on the mat."

    def test_missing_reference_text_raises_error(self) -> None:
        """referenceText が欠けているとき ValidationError が発生すること。"""
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            ShadowingLagMetadata.model_validate(
                {
                    "mimeType": "audio/wav",
                    "durationMilliseconds": 1000,
                }
            )


class TestShadowingLagResponse:
    """ShadowingLagResponse の構造テスト。"""

    def test_full_response_structure(self) -> None:
        """全フィールドが存在するとき正しくシリアライズできること。"""
        response = ShadowingLagResponse(
            lagMilliseconds=350.5,
            perSegmentLag=[
                PerSegmentLagResponse(phoneme="h", lagMilliseconds=200.0),
                PerSegmentLagResponse(phoneme="ɛ", lagMilliseconds=400.0),
                PerSegmentLagResponse(phoneme="l", lagMilliseconds=350.0),
            ],
            speechRateRatio=1.2,
            pauseCountLearner=2,
            pauseCountReference=1,
        )

        serialized = response.model_dump()
        assert serialized["lagMilliseconds"] == 350.5
        assert len(serialized["perSegmentLag"]) == 3
        assert serialized["speechRateRatio"] == 1.2
        assert serialized["pauseCountLearner"] == 2
        assert serialized["pauseCountReference"] == 1

    def test_nullable_fields_can_be_none(self) -> None:
        """speechRateRatio / pauseCountLearner / pauseCountReference が null 許容であること。

        OQ-5: 計算困難なら null 許容（spec 明記）。
        """
        response = ShadowingLagResponse(
            lagMilliseconds=500.0,
            perSegmentLag=[],
            speechRateRatio=None,
            pauseCountLearner=None,
            pauseCountReference=None,
        )

        serialized = response.model_dump()
        assert serialized["speechRateRatio"] is None
        assert serialized["pauseCountLearner"] is None
        assert serialized["pauseCountReference"] is None

    def test_per_segment_lag_response_structure(self) -> None:
        """PerSegmentLagResponse のフィールドが正しいこと。"""
        segment = PerSegmentLagResponse(phoneme="oʊ", lagMilliseconds=-50.0)
        assert segment.phoneme == "oʊ"
        assert segment.lagMilliseconds == -50.0

    def test_json_field_names_are_camel_case(self) -> None:
        """JSON シリアライズ時にフィールド名が camelCase であること。"""
        response = ShadowingLagResponse(
            lagMilliseconds=100.0,
            perSegmentLag=[
                PerSegmentLagResponse(phoneme="h", lagMilliseconds=100.0)
            ],
            speechRateRatio=0.9,
            pauseCountLearner=1,
            pauseCountReference=0,
        )

        serialized = response.model_dump()
        # Pydantic v2 の model_dump はデフォルト python_attribute 名（snake_case）を返すが
        # FastAPI の JSON シリアライズでは alias が使われる。
        # ここでは camelCase フィールド名が定義されていることを確認する。
        assert "lagMilliseconds" in serialized
        assert "perSegmentLag" in serialized
        assert "speechRateRatio" in serialized
        assert "pauseCountLearner" in serialized
        assert "pauseCountReference" in serialized

    def test_response_lag_milliseconds_is_float(self) -> None:
        """lagMilliseconds が float として返されること。"""
        response = ShadowingLagResponse(
            lagMilliseconds=123,  # int を渡しても float に強制される
            perSegmentLag=[],
        )
        assert isinstance(response.lagMilliseconds, float)
