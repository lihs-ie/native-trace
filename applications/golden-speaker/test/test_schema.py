"""GoldenConversionResponse スキーマテスト（公開 contract 確認）。

worker / frontend が参照する contract の JSON 形状を assert する。
"""

import json

import pytest

from golden_speaker.interface.schema import GoldenConversionResponse


class TestGoldenConversionResponseSchema:
    """GoldenConversionResponse の JSON シリアライズ形状テスト。"""

    def test_passed_response_shape(self) -> None:
        """品質ゲート通過時のレスポンス形状を確認する。"""
        response = GoldenConversionResponse(
            audioBase64="dGVzdA==",
            qualityGatePassed=True,
            withholdReason=None,
            targetVoice="p225",
        )

        data = json.loads(response.model_dump_json())

        assert data["audioBase64"] == "dGVzdA=="
        assert data["qualityGatePassed"] is True
        assert data["withholdReason"] is None
        assert data["targetVoice"] == "p225"

    def test_withhold_response_shape(self) -> None:
        """品質ゲート不通過時のレスポンス形状を確認する。"""
        response = GoldenConversionResponse(
            audioBase64=None,
            qualityGatePassed=False,
            withholdReason="quality_gate_failed",
            targetVoice="p225",
        )

        data = json.loads(response.model_dump_json())

        assert data["audioBase64"] is None
        assert data["qualityGatePassed"] is False
        assert data["withholdReason"] == "quality_gate_failed"
        assert data["targetVoice"] == "p225"

    def test_model_unavailable_response_shape(self) -> None:
        """モデル不在時のレスポンス形状を確認する。"""
        response = GoldenConversionResponse(
            audioBase64=None,
            qualityGatePassed=False,
            withholdReason="model_unavailable",
            targetVoice="p225",
        )

        data = json.loads(response.model_dump_json())

        assert data["audioBase64"] is None
        assert data["qualityGatePassed"] is False
        assert data["withholdReason"] == "model_unavailable"

    def test_all_required_fields_present(self) -> None:
        """全フィールド（audioBase64/qualityGatePassed/withholdReason/targetVoice）が存在する。"""
        response = GoldenConversionResponse(
            audioBase64=None,
            qualityGatePassed=False,
            withholdReason="quality_gate_failed",
            targetVoice="p225",
        )

        data = json.loads(response.model_dump_json())

        assert "audioBase64" in data
        assert "qualityGatePassed" in data
        assert "withholdReason" in data
        assert "targetVoice" in data

    def test_camel_case_field_names(self) -> None:
        """フィールド名が camelCase であること（contract lock）。"""
        response = GoldenConversionResponse(
            audioBase64="abc",
            qualityGatePassed=True,
            withholdReason=None,
            targetVoice="p225",
        )

        data = json.loads(response.model_dump_json())
        keys = set(data.keys())

        # snake_case のキーが存在しないこと
        assert "audio_base64" not in keys
        assert "quality_gate_passed" not in keys
        assert "withhold_reason" not in keys
        assert "target_voice" not in keys
