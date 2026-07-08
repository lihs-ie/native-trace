"""AnalysisMetadata.speakerSex バリデーションテスト（M-APD-6）。

受入条件:
- AnalysisMetadata(speakerSex="unknown") が正常に生成されること
- AnalysisMetadata(speakerSex="invalid") が validation error を発生させること（pydantic 型制約）
- 値集合は 'F' / 'M' / 'unknown' のみ（'male'/'female' は使用しないこと）
"""

import pytest
from pydantic import ValidationError

from python_analyzer.interface.schema import AnalysisMetadata, PhonemeAcousticResponse


class TestAnalysisMetadataSpeakerSex:
    """AnalysisMetadata.speakerSex の pydantic バリデーションテスト。"""

    def _make_base_metadata(self, **kwargs: object) -> dict[str, object]:
        """最小限の valid metadata dict を返すヘルパー。"""
        return {
            "referenceText": "Hello world.",
            "mimeType": "audio/wav",
            "durationMilliseconds": 1000,
            **kwargs,
        }

    def test_speaker_sex_unknown_is_valid(self) -> None:
        """speakerSex='unknown' が正常に生成されること（デフォルト値）。"""
        meta = AnalysisMetadata(**self._make_base_metadata(speakerSex="unknown"))
        assert meta.speakerSex == "unknown"

    def test_speaker_sex_default_is_unknown(self) -> None:
        """speakerSex を省略したときデフォルト 'unknown' になること。"""
        meta = AnalysisMetadata(**self._make_base_metadata())
        assert meta.speakerSex == "unknown"

    def test_speaker_sex_female_is_valid(self) -> None:
        """speakerSex='F' が正常に生成されること。"""
        meta = AnalysisMetadata(**self._make_base_metadata(speakerSex="F"))
        assert meta.speakerSex == "F"

    def test_speaker_sex_male_is_valid(self) -> None:
        """speakerSex='M' が正常に生成されること。"""
        meta = AnalysisMetadata(**self._make_base_metadata(speakerSex="M"))
        assert meta.speakerSex == "M"

    def test_speaker_sex_invalid_raises_validation_error(self) -> None:
        """speakerSex='invalid' が ValidationError を発生させること（pydantic Literal 制約）。"""
        with pytest.raises(ValidationError):
            AnalysisMetadata(**self._make_base_metadata(speakerSex="invalid"))

    def test_speaker_sex_male_string_raises_validation_error(self) -> None:
        """speakerSex='male' が ValidationError を発生させること（'male'/'female' 禁止）。"""
        with pytest.raises(ValidationError):
            AnalysisMetadata(**self._make_base_metadata(speakerSex="male"))

    def test_speaker_sex_female_string_raises_validation_error(self) -> None:
        """speakerSex='female' が ValidationError を発生させること（'male'/'female' 禁止）。"""
        with pytest.raises(ValidationError):
            AnalysisMetadata(**self._make_base_metadata(speakerSex="female"))


class TestPhonemeAcousticResponse:
    """PhonemeAcousticResponse の Pydantic モデルテスト（M-APD-6）。"""

    def test_creates_with_all_fields(self) -> None:
        """全フィールドを指定して生成できること。"""
        response = PhonemeAcousticResponse(
            phoneme="iː",
            startMs=100,
            endMs=200,
            f1Hz=350.0,
            f2Hz=2800.0,
            f3Hz=3200.0,
            spectralCentroidHz=2000.0,
            durationMs=100,
        )
        assert response.phoneme == "iː"
        assert response.startMs == 100
        assert response.endMs == 200
        assert response.f1Hz == pytest.approx(350.0)
        assert response.f2Hz == pytest.approx(2800.0)
        assert response.f3Hz == pytest.approx(3200.0)
        assert response.spectralCentroidHz == pytest.approx(2000.0)
        assert response.durationMs == 100

    def test_creates_with_none_formants(self) -> None:
        """f1Hz/f2Hz/f3Hz/spectralCentroidHz が None の場合も生成できること。"""
        response = PhonemeAcousticResponse(
            phoneme="p",
            startMs=0,
            endMs=20,
            f1Hz=None,
            f2Hz=None,
            f3Hz=None,
            spectralCentroidHz=None,
            durationMs=20,
        )
        assert response.f1Hz is None
        assert response.f2Hz is None
        assert response.f3Hz is None
        assert response.spectralCentroidHz is None

    def test_json_keys_are_camelcase(self) -> None:
        """JSON 出力キーが camelCase であること（Haskell worker FromJSON 契約）。"""
        response = PhonemeAcousticResponse(
            phoneme="æ",
            startMs=50,
            endMs=150,
            f1Hz=800.0,
            f2Hz=1700.0,
            f3Hz=2600.0,
            spectralCentroidHz=1800.0,
            durationMs=100,
        )
        serialized = response.model_dump()
        # camelCase キーが存在すること
        assert "phoneme" in serialized
        assert "startMs" in serialized
        assert "endMs" in serialized
        assert "f1Hz" in serialized
        assert "f2Hz" in serialized
        assert "f3Hz" in serialized
        assert "spectralCentroidHz" in serialized
        assert "durationMs" in serialized
        # snake_case キーが存在しないこと
        assert "start_ms" not in serialized
        assert "end_ms" not in serialized
        assert "f1_hz" not in serialized
        assert "spectral_centroid_hz" not in serialized
        assert "duration_ms" not in serialized
