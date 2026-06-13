"""M-F0REF-a 統合テスト: reference F0 輪郭の抽出と AnalysisResponse への組み込みを検証する。

受入条件（spec: docs/specs/f0-reference-contour.md M-F0REF-a）:
- extract_reference_f0_contour(reference_text) が非空 F0 輪郭を返す。
- POST /v1/analyze の AnalysisResponse.referenceF0Contour に非空の valuesHz が載る。
- reference=None 時に学習者 f0Contour 経路が壊れないこと。

kokoro / parselmouth / soundfile / torch が利用可能な環境（Docker）でのみ実行する。
"""

import json
from pathlib import Path

import pytest

# soundfile / torch 不在環境ではスキップする（ローカル CI 向け）
pytest.importorskip("soundfile")
pytest.importorskip("torch")

from fastapi.testclient import TestClient  # noqa: E402

from python_analyzer.app import app  # noqa: E402
from python_analyzer.infrastructure.prosody_analyzer import ProsodyAnalyzer  # noqa: E402

_FIXTURES_DIR = Path(__file__).parent.parent / "fixtures"
_HELLO_WORLD_WAV = _FIXTURES_DIR / "hello_world.wav"
_REFERENCE_TEXT = "Hello, world."


@pytest.fixture(scope="module")
def client() -> TestClient:
    """TestClient を生成する（モジュール全体で再利用）。"""
    return TestClient(app)


class TestExtractReferenceF0ContourIntegration:
    """ProsodyAnalyzer.extract_reference_f0_contour の統合テスト。

    kokoro と parselmouth が両方利用可能な場合のみ実行する。
    """

    def test_extract_reference_f0_returns_non_empty_contour(self) -> None:
        """extract_reference_f0_contour が非空の F0 輪郭を返すこと。

        受入条件 M-F0REF-a: TTS 合成 + F0 抽出のパイプラインが動作し、
        timesMs / valuesHz が len > 0 であることを確認する。
        """
        try:
            import kokoro  # noqa: F401
        except ImportError:
            pytest.skip("kokoro が利用不可: reference F0 統合テストをスキップする")

        try:
            import parselmouth  # noqa: F401
        except ImportError:
            pytest.skip("parselmouth が利用不可: reference F0 統合テストをスキップする")

        analyzer = ProsodyAnalyzer()
        contour = analyzer.extract_reference_f0_contour(_REFERENCE_TEXT)

        assert contour is not None, "reference F0 が None: TTS 合成または F0 抽出が失敗している"
        assert len(contour.times_milliseconds) > 0, "timesMs が空"
        assert len(contour.values_hz) > 0, "valuesHz が空"
        assert len(contour.times_milliseconds) == len(contour.values_hz), (
            "timesMs と valuesHz の長さが一致しない"
        )
        # voiced フレームが 1 つ以上存在すること（偽の固定配列でないことの確認）
        voiced_frames = [hz for hz in contour.values_hz if hz > 0]
        assert len(voiced_frames) > 0, (
            "voiced フレームが 0: F0 抽出が全て無声または固定 0 を返している"
        )

    def test_extract_reference_f0_contour_changes_with_different_text(self) -> None:
        """reference F0 が referenceText に依存して変わること（偽輪郭でないことの確認）。

        異なるテキストに対して異なる F0 輪郭が返されることを確認する。
        """
        try:
            import kokoro  # noqa: F401
        except ImportError:
            pytest.skip("kokoro が利用不可: smoke テストをスキップする")

        try:
            import parselmouth  # noqa: F401
        except ImportError:
            pytest.skip("parselmouth が利用不可: smoke テストをスキップする")

        analyzer = ProsodyAnalyzer()
        contour_hello = analyzer.extract_reference_f0_contour("Hello")
        contour_long = analyzer.extract_reference_f0_contour(
            "The quick brown fox jumps over the lazy dog."
        )

        assert contour_hello is not None
        assert contour_long is not None
        # テキスト長が異なれば F0 輪郭のフレーム数も異なるはず（長い方が多い）
        assert len(contour_long.times_milliseconds) > len(contour_hello.times_milliseconds), (
            "テキストが長いにもかかわらず F0 輪郭のフレーム数が増えていない: "
            f"hello={len(contour_hello.times_milliseconds)}, "
            f"long={len(contour_long.times_milliseconds)}"
        )


def _is_espeak_available() -> bool:
    """espeak-ng がシステムにインストールされているか確認する。"""
    import shutil

    return shutil.which("espeak-ng") is not None or shutil.which("espeak") is not None


class TestAnalysisResponseReferenceF0Contour:
    """POST /v1/analyze の referenceF0Contour フィールド統合テスト。

    spec M-F0REF-a の受入条件:
    - referenceF0Contour.valuesHz が非空。
    - reference=None 時に f0Contour 経路が壊れない。

    espeak-ng が必要な aligner を呼び出すため、Docker 環境（espeak-ng インストール済み）でのみ実行する。
    """

    def test_analyze_returns_reference_f0_contour_in_response(
        self, client: TestClient
    ) -> None:
        """POST /v1/analyze が referenceF0Contour フィールドを返すこと。

        kokoro が利用可能な場合、referenceF0Contour が非空の valuesHz を持つことを assert する。
        """
        if not _is_espeak_available():
            pytest.skip("espeak-ng が利用不可: endpoint 統合テストをスキップする")

        try:
            import kokoro  # noqa: F401
        except ImportError:
            pytest.skip("kokoro が利用不可: endpoint 統合テストをスキップする")

        assert _HELLO_WORLD_WAV.exists(), f"fixture が存在しない: {_HELLO_WORLD_WAV}"

        wav_bytes = _HELLO_WORLD_WAV.read_bytes()
        duration_ms = _estimate_wav_duration_ms(wav_bytes)
        metadata = json.dumps(
            {
                "referenceText": _REFERENCE_TEXT,
                "targetAccent": "generalAmerican",
                "mimeType": "audio/wav",
                "durationMilliseconds": duration_ms,
                "includeReferenceF0": True,
            }
        )

        response = client.post(
            "/v1/analyze",
            files={"audio": ("hello_world.wav", wav_bytes, "audio/wav")},
            data={"metadata": metadata},
        )

        assert response.status_code == 200, (
            f"analyze 失敗: status={response.status_code}, body={response.text}"
        )

        data = response.json()

        # M-F0REF-a: referenceF0Contour フィールドが存在すること
        assert "referenceF0Contour" in data, "referenceF0Contour フィールドが存在しない"
        ref_contour = data["referenceF0Contour"]
        assert ref_contour is not None, "referenceF0Contour が null"
        assert "timesMs" in ref_contour, "referenceF0Contour.timesMs が存在しない"
        assert "valuesHz" in ref_contour, "referenceF0Contour.valuesHz が存在しない"
        assert len(ref_contour["valuesHz"]) > 0, "referenceF0Contour.valuesHz が空"
        voiced_frames = [hz for hz in ref_contour["valuesHz"] if hz > 0]
        assert len(voiced_frames) > 0, "referenceF0Contour に voiced フレームが 1 つもない"

    def test_analyze_learner_f0_contour_unaffected_when_reference_f0_disabled(
        self, client: TestClient
    ) -> None:
        """includeReferenceF0=False のとき学習者 f0Contour 経路が退行しないこと。

        M-F0REF-a の退行防止テスト: reference 計算をスキップしても
        f0Contour（学習者）は通常通り返されること。
        """
        if not _is_espeak_available():
            pytest.skip("espeak-ng が利用不可: endpoint 統合テストをスキップする")

        assert _HELLO_WORLD_WAV.exists(), f"fixture が存在しない: {_HELLO_WORLD_WAV}"

        wav_bytes = _HELLO_WORLD_WAV.read_bytes()
        duration_ms = _estimate_wav_duration_ms(wav_bytes)
        metadata = json.dumps(
            {
                "referenceText": _REFERENCE_TEXT,
                "targetAccent": "generalAmerican",
                "mimeType": "audio/wav",
                "durationMilliseconds": duration_ms,
                "includeReferenceF0": False,
            }
        )

        response = client.post(
            "/v1/analyze",
            files={"audio": ("hello_world.wav", wav_bytes, "audio/wav")},
            data={"metadata": metadata},
        )

        assert response.status_code == 200, (
            f"analyze 失敗（includeReferenceF0=False）: "
            f"status={response.status_code}, body={response.text}"
        )

        data = response.json()

        # includeReferenceF0=False のとき referenceF0Contour は null
        assert "referenceF0Contour" in data, "referenceF0Contour フィールドが存在しない"
        assert data["referenceF0Contour"] is None, (
            "includeReferenceF0=False なのに referenceF0Contour が null でない: "
            f"{data['referenceF0Contour']}"
        )

        # 学習者経路（f0Contour / perPhonemeGop 等）は壊れていないこと
        assert data["perPhonemeGop"] is not None, "includeReferenceF0=False で perPhonemeGop が null"
        assert len(data["perPhonemeGop"]) > 0, (
            "includeReferenceF0=False で perPhonemeGop が空: 学習者経路が退行している"
        )
        # f0Contour は prosody_port が注入されているため返るはず
        assert "f0Contour" in data, "f0Contour フィールドが存在しない"

    def test_analyze_backward_compatible_without_include_reference_f0_field(
        self, client: TestClient
    ) -> None:
        """includeReferenceF0 フィールドを省略した旧リクエストで 200 が返ること（後方互換）。

        default=True が適用され、referenceF0Contour フィールドが JSON に存在すること。
        """
        if not _is_espeak_available():
            pytest.skip("espeak-ng が利用不可: endpoint 統合テストをスキップする")

        assert _HELLO_WORLD_WAV.exists(), f"fixture が存在しない: {_HELLO_WORLD_WAV}"

        wav_bytes = _HELLO_WORLD_WAV.read_bytes()
        duration_ms = _estimate_wav_duration_ms(wav_bytes)
        # includeReferenceF0 を含まない旧形式の metadata
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

        assert response.status_code == 200, (
            f"後方互換リクエストで失敗: status={response.status_code}, body={response.text}"
        )

        data = response.json()
        # referenceF0Contour フィールドが JSON に存在すること（null でもフィールドは存在する）
        assert "referenceF0Contour" in data, (
            "後方互換リクエストで referenceF0Contour フィールドが存在しない"
        )


def _estimate_wav_duration_ms(wav_bytes: bytes) -> int:
    """WAV バイナリから再生時間（ms）を推定する簡易実装。"""
    header_size = 44
    data_size = max(0, len(wav_bytes) - header_size)
    sample_rate = 16000
    bytes_per_sample = 2
    samples = data_size // bytes_per_sample
    duration_seconds = samples / sample_rate
    return max(500, int(duration_seconds * 1000))
