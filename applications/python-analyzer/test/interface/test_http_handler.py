"""real public entrypoint テスト: POST /v1/analyze の観測可能挙動を assert する。

Done When 1: hello_world.wav + "Hello, world." を POST し、
  - perPhonemeGop 非空 (len > 0)
  - detectedIpa 非null非空
  - expectedIpa 非null非空
を確認する。
"""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from python_analyzer.app import app


# fixture ファイルのパス
_FIXTURES_DIR = Path(__file__).parent.parent / "fixtures"
_HELLO_WORLD_WAV = _FIXTURES_DIR / "hello_world.wav"
_REFERENCE_TEXT = "Hello, world."


@pytest.fixture(scope="module")
def client() -> TestClient:
    """TestClient を生成する（モジュール全体で再利用）。"""
    return TestClient(app)


class TestHealthEndpoint:
    """GET /health の基本動作テスト。"""

    def test_health_returns_ok(self, client: TestClient) -> None:
        """GET /health が {"status": "ok"} を返すこと。"""
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"


class TestAnalyzeEndpoint:
    """POST /v1/analyze の real entrypoint テスト。

    espeak-ng TTS 合成した hello_world.wav で real モデルを呼び出し、
    観測可能挙動（perPhonemeGop 非空 / IPA 非空）を assert する。
    """

    def test_analyze_returns_non_empty_per_phoneme_gop(
        self, client: TestClient
    ) -> None:
        """POST /v1/analyze が perPhonemeGop 非空のレスポンスを返すこと。

        Done When 1 の主要 assert。
        """
        assert _HELLO_WORLD_WAV.exists(), (
            f"fixture が存在しない: {_HELLO_WORLD_WAV}\n"
            "Dockerfile の RUN espeak-ng コマンドで生成されているか確認してください。"
        )

        wav_bytes = _HELLO_WORLD_WAV.read_bytes()
        # duration を推定する（espeak-ng TTS 生成なので ~1-2秒程度）
        duration_ms = _estimate_wav_duration_ms(wav_bytes)

        metadata = json.dumps(
            {
                "referenceText": _REFERENCE_TEXT,
                "targetAccent": "generalAmerican",
                "mimeType": "audio/wav",
                "durationMilliseconds": duration_ms,
            }
        )

        response = client.post(
            "/v1/analyze",
            files={"audio": ("hello_world.wav", wav_bytes, "audio/wav")},
            data={"metadata": metadata},
        )

        # 解析成功を確認する
        assert response.status_code == 200, (
            f"analyze 失敗: status={response.status_code}, body={response.text}"
        )

        data = response.json()

        # Done When 1 の必須 assert
        assert data["perPhonemeGop"] is not None, "perPhonemeGop が null"
        assert len(data["perPhonemeGop"]) > 0, (
            f"perPhonemeGop が空: detectedIpa={data.get('detectedIpa')}, "
            f"expectedIpa={data.get('expectedIpa')}"
        )
        assert data["detectedIpa"] is not None, "detectedIpa が null"
        assert len(data["detectedIpa"]) > 0, "detectedIpa が空文字"
        assert data["expectedIpa"] is not None, "expectedIpa が null"
        assert len(data["expectedIpa"]) > 0, "expectedIpa が空文字"

    def test_analyze_per_phoneme_gop_structure(self, client: TestClient) -> None:
        """perPhonemeGop の各要素が正しい構造を持つこと。"""
        assert _HELLO_WORLD_WAV.exists(), f"fixture が存在しない: {_HELLO_WORLD_WAV}"

        wav_bytes = _HELLO_WORLD_WAV.read_bytes()
        duration_ms = _estimate_wav_duration_ms(wav_bytes)
        metadata = json.dumps(
            {
                "referenceText": _REFERENCE_TEXT,
                "targetAccent": "generalAmerican",
                "mimeType": "audio/wav",
                "durationMilliseconds": duration_ms,
            }
        )

        response = client.post(
            "/v1/analyze",
            files={"audio": ("hello_world.wav", wav_bytes, "audio/wav")},
            data={"metadata": metadata},
        )
        assert response.status_code == 200

        data = response.json()
        for entry in data["perPhonemeGop"]:
            assert "phoneme" in entry, f"phoneme フィールドなし: {entry}"
            assert "gop" in entry, f"gop フィールドなし: {entry}"
            assert "startMs" in entry, f"startMs フィールドなし: {entry}"
            assert "endMs" in entry, f"endMs フィールドなし: {entry}"
            assert isinstance(entry["gop"], float), f"gop が float でない: {entry}"
            assert entry["endMs"] >= entry["startMs"], f"endMs < startMs: {entry}"

    def test_analyze_speech_rate_is_positive(self, client: TestClient) -> None:
        """speechRatePhonemePerSecond が正の値であること。"""
        assert _HELLO_WORLD_WAV.exists(), f"fixture が存在しない: {_HELLO_WORLD_WAV}"

        wav_bytes = _HELLO_WORLD_WAV.read_bytes()
        duration_ms = _estimate_wav_duration_ms(wav_bytes)
        metadata = json.dumps(
            {
                "referenceText": _REFERENCE_TEXT,
                "targetAccent": "generalAmerican",
                "mimeType": "audio/wav",
                "durationMilliseconds": duration_ms,
            }
        )

        response = client.post(
            "/v1/analyze",
            files={"audio": ("hello_world.wav", wav_bytes, "audio/wav")},
            data={"metadata": metadata},
        )
        assert response.status_code == 200

        data = response.json()
        assert data["speechRatePhonemePerSecond"] > 0, (
            f"speechRatePhonemePerSecond が 0 以下: {data['speechRatePhonemePerSecond']}"
        )


def _estimate_wav_duration_ms(wav_bytes: bytes) -> int:
    """WAV バイナリからおおよその再生時間（ms）を推定する。

    WAV ヘッダーを解析せず、ファイルサイズから推定する簡易実装。
    16kHz, 16bit, mono を仮定する。
    """
    # WAV ヘッダー（44 バイト）を除いたデータサイズからサンプル数を計算する
    header_size = 44
    data_size = max(0, len(wav_bytes) - header_size)
    # 16bit = 2 bytes/sample, 16000 samples/sec
    sample_rate = 16000
    bytes_per_sample = 2
    samples = data_size // bytes_per_sample
    duration_seconds = samples / sample_rate
    # 最低 500ms を保証する
    return max(500, int(duration_seconds * 1000))
