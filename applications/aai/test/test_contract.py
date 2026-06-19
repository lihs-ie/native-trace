"""契約テスト（M-AAI-2 / M-AAI-7）。

- POST /v1/articulatory-inversion が multipart を受け付けること。
- JSON base64 body を投げると拒否されること。
- response が常に 6 座標 + displayEligibility を返すこと。
- 下顎・舌体チャネル・生 mm が露出しないこと。
- 全 key が camelCase であること。
- GET /health が 200 を返すこと。

テストダブル（フェイク）は test/ のみに存在する（agent-policy）。
本番コードに mock/stub/placeholder を入れない。
"""

import io
import json
import struct
import wave

import pytest
from fastapi.testclient import TestClient

from aai.app import create_app
from aai.domain.articulatory_estimate import (
    ArticulatoryInversionResult,
    PhonemeArticulatoryEstimate,
)
from aai.interface import http_handler
from aai.usecase.invert_articulation import InvertArticulationUseCase

# ---------------------------------------------------------------------------
# テスト用 WAV バイト列生成ヘルパー
# ---------------------------------------------------------------------------


def _make_wav_bytes(duration_seconds: float = 0.5, sample_rate: int = 16000) -> bytes:
    """テスト用の単純なサイン波 WAV バイト列を生成する。"""
    import math

    num_samples = int(sample_rate * duration_seconds)
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        for i in range(num_samples):
            value = int(32767 * math.sin(2 * math.pi * 440 * i / sample_rate))
            wav_file.writeframes(struct.pack("<h", value))
    return buffer.getvalue()


_LEARNER_WAV = _make_wav_bytes(0.5)

_METADATA_JSON = json.dumps({
    "mimeType": "audio/wav",
    "sampleRate": 16000,
    "boundaries": [
        {"phoneme": "r", "startMs": 0, "endMs": 150},
        {"phoneme": "ae", "startMs": 150, "endMs": 350},
    ],
})

_EXPECTED_RESPONSE = ArticulatoryInversionResult(
    per_phoneme=[
        PhonemeArticulatoryEstimate(
            phoneme="r",
            start_ms=0,
            end_ms=150,
            tongue_tip_x=0.1,
            tongue_tip_y=-0.2,
            tongue_dorsum_x=0.3,
            tongue_dorsum_y=-0.1,
            lip_aperture_x=0.0,
            lip_aperture_y=0.4,
            display_eligibility=0.8,
        ),
        PhonemeArticulatoryEstimate(
            phoneme="ae",
            start_ms=150,
            end_ms=350,
            tongue_tip_x=-0.1,
            tongue_tip_y=-0.5,
            tongue_dorsum_x=-0.3,
            tongue_dorsum_y=-0.2,
            lip_aperture_x=0.1,
            lip_aperture_y=0.7,
            display_eligibility=0.9,
        ),
    ]
)


# ---------------------------------------------------------------------------
# テストダブル（test/ のみ存在、本番コードに入れない — agent-policy）
# ---------------------------------------------------------------------------


class _FakeArticulatoryEngine:
    """既知の結果を返すフェイクエンジン（test/ のみ）。"""

    def __init__(self, result: ArticulatoryInversionResult) -> None:
        self._result = result
        self.calls: list[dict] = []

    def invert(
        self,
        learner_audio_bytes: bytes,
        sample_rate: int,
        boundaries: list[dict],
    ) -> ArticulatoryInversionResult:
        self.calls.append({
            "learner_audio_bytes": learner_audio_bytes,
            "sample_rate": sample_rate,
            "boundaries": boundaries,
        })
        return self._result


# ---------------------------------------------------------------------------
# フィクスチャ
# ---------------------------------------------------------------------------


@pytest.fixture
def client_with_fake_engine() -> TestClient:
    """フェイクエンジンを DI した TestClient を返す。"""
    app = create_app()
    fake_engine = _FakeArticulatoryEngine(result=_EXPECTED_RESPONSE)
    use_case = InvertArticulationUseCase(engine=fake_engine)
    http_handler.set_invert_articulation_use_case(use_case)
    return TestClient(app)


@pytest.fixture
def client_with_degraded_engine() -> TestClient:
    """degrade 結果（per_phoneme=[]）を返すフェイクエンジンの TestClient。"""

    class _DegradedEngine:
        def invert(
            self,
            learner_audio_bytes: bytes,
            sample_rate: int,
            boundaries: list[dict],
        ) -> ArticulatoryInversionResult:
            return ArticulatoryInversionResult(per_phoneme=[])

    app = create_app()
    use_case = InvertArticulationUseCase(engine=_DegradedEngine())
    http_handler.set_invert_articulation_use_case(use_case)
    return TestClient(app)


# ---------------------------------------------------------------------------
# テスト
# ---------------------------------------------------------------------------


class TestHealthEndpoint:
    """GET /health テスト。"""

    def test_health_returns_200(self, client_with_fake_engine: TestClient) -> None:
        """GET /health が 200 を返すこと。"""
        response = client_with_fake_engine.get("/health")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"


class TestMultipartAcceptance:
    """POST /v1/articulatory-inversion multipart 受け付けテスト（M-AAI-2）。"""

    def test_multipart_request_accepted_200(self, client_with_fake_engine: TestClient) -> None:
        """learner_audio File + metadata Form の multipart リクエストが 200 を返すこと。"""
        response = client_with_fake_engine.post(
            "/v1/articulatory-inversion",
            files={"learner_audio": ("audio.wav", _LEARNER_WAV, "audio/wav")},
            data={"metadata": _METADATA_JSON},
        )
        assert response.status_code == 200

    def test_json_base64_body_rejected(self, client_with_fake_engine: TestClient) -> None:
        """JSON body（base64 audio を含む）は拒否されること（contract: multipart only）。"""
        import base64

        json_body = json.dumps({
            "audio": base64.b64encode(_LEARNER_WAV).decode("ascii"),
            "metadata": _METADATA_JSON,
        })
        response = client_with_fake_engine.post(
            "/v1/articulatory-inversion",
            content=json_body,
            headers={"Content-Type": "application/json"},
        )
        # multipart でなければ 422 (Unprocessable Entity) を返す
        assert response.status_code == 422

    def test_missing_audio_part_rejected(self, client_with_fake_engine: TestClient) -> None:
        """learner_audio パートが欠如したリクエストは拒否されること。"""
        response = client_with_fake_engine.post(
            "/v1/articulatory-inversion",
            data={"metadata": _METADATA_JSON},
        )
        assert response.status_code == 422

    def test_missing_metadata_part_rejected(self, client_with_fake_engine: TestClient) -> None:
        """metadata パートが欠如したリクエストは拒否されること。"""
        response = client_with_fake_engine.post(
            "/v1/articulatory-inversion",
            files={"learner_audio": ("audio.wav", _LEARNER_WAV, "audio/wav")},
        )
        assert response.status_code == 422


class TestResponseContract:
    """ArticulatoryInversionResponse 契約テスト（M-AAI-7）。"""

    def test_response_has_per_phoneme_key(self, client_with_fake_engine: TestClient) -> None:
        """レスポンスに perPhoneme キーが存在すること。"""
        response = client_with_fake_engine.post(
            "/v1/articulatory-inversion",
            files={"learner_audio": ("audio.wav", _LEARNER_WAV, "audio/wav")},
            data={"metadata": _METADATA_JSON},
        )
        data = response.json()
        assert "perPhoneme" in data

    def test_per_phoneme_has_6_coords_and_eligibility(
        self, client_with_fake_engine: TestClient
    ) -> None:
        """per_phoneme の各要素が 6 座標 + displayEligibility を持つこと。"""
        response = client_with_fake_engine.post(
            "/v1/articulatory-inversion",
            files={"learner_audio": ("audio.wav", _LEARNER_WAV, "audio/wav")},
            data={"metadata": _METADATA_JSON},
        )
        data = response.json()
        per_phoneme = data["perPhoneme"]
        assert len(per_phoneme) > 0

        for estimate in per_phoneme:
            # 6 座標
            assert "tongueTipX" in estimate
            assert "tongueTipY" in estimate
            assert "tongueDorsumX" in estimate
            assert "tongueDorsumY" in estimate
            assert "lipApertureX" in estimate
            assert "lipApertureY" in estimate
            # displayEligibility
            assert "displayEligibility" in estimate
            # phoneme + timing
            assert "phoneme" in estimate
            assert "startMs" in estimate
            assert "endMs" in estimate

    def test_no_jaw_or_tongue_body_channels(self, client_with_fake_engine: TestClient) -> None:
        """下顎切歯・舌体チャネルが response に含まれないこと（D3-a drop）。"""
        response = client_with_fake_engine.post(
            "/v1/articulatory-inversion",
            files={"learner_audio": ("audio.wav", _LEARNER_WAV, "audio/wav")},
            data={"metadata": _METADATA_JSON},
        )
        data = response.json()
        per_phoneme = data["perPhoneme"]

        for estimate in per_phoneme:
            # 下顎切歯チャネルが含まれないこと
            assert "lowerIncisorX" not in estimate
            assert "lowerIncisorY" not in estimate
            # 舌体チャネルが含まれないこと
            assert "tongueBodyX" not in estimate
            assert "tongueBodyY" not in estimate

    def test_all_keys_are_camel_case(self, client_with_fake_engine: TestClient) -> None:
        """全 key が camelCase であること（contract lock）。"""
        response = client_with_fake_engine.post(
            "/v1/articulatory-inversion",
            files={"learner_audio": ("audio.wav", _LEARNER_WAV, "audio/wav")},
            data={"metadata": _METADATA_JSON},
        )
        data = response.json()
        per_phoneme = data["perPhoneme"]

        for estimate in per_phoneme:
            for key in estimate.keys():
                # snake_case でないこと（アンダースコアがないこと）
                if key not in ("phoneme",):  # phoneme は単語なので OK
                    assert "_" not in key, f"Key {key!r} is not camelCase"

    def test_degraded_response_has_empty_per_phoneme(
        self, client_with_degraded_engine: TestClient
    ) -> None:
        """degrade 時（モデル不在）は perPhoneme=[] で 200 を返すこと。"""
        response = client_with_degraded_engine.post(
            "/v1/articulatory-inversion",
            files={"learner_audio": ("audio.wav", _LEARNER_WAV, "audio/wav")},
            data={"metadata": _METADATA_JSON},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["perPhoneme"] == []

    def test_invalid_metadata_returns_400(self, client_with_fake_engine: TestClient) -> None:
        """不正な metadata JSON は 400 を返すこと。"""
        response = client_with_fake_engine.post(
            "/v1/articulatory-inversion",
            files={"learner_audio": ("audio.wav", _LEARNER_WAV, "audio/wav")},
            data={"metadata": "not valid json"},
        )
        assert response.status_code == 400
