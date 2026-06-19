"""graceful degrade テスト（M-AAI-3）。

articulatory package が不在の環境でも import error にならず、
InvertArticulationUseCase が ArticulatoryInversionResult(per_phoneme=[]) を返すこと。
"""

import pytest

from aai.domain.articulatory_estimate import ArticulatoryInversionResult
from aai.usecase.invert_articulation import InvertArticulationUseCase

# ---------------------------------------------------------------------------
# テストダブル（test/ のみ存在、本番コードに入れない — agent-policy）
# ---------------------------------------------------------------------------


class _AlwaysFailEngine:
    """articulatory package 不在をシミュレートするフェイクエンジン（test/ のみ）。

    invert() が RuntimeError を送出することで、articulatory 不在状態を模倣する。
    本番コードに入れない（agent-policy）。
    """

    def invert(
        self,
        learner_audio_bytes: bytes,
        sample_rate: int,
        boundaries: list[dict],
    ) -> ArticulatoryInversionResult:
        raise RuntimeError("articulatory package is not installed (simulated for test)")


class _EmptyResultEngine:
    """空の EMA を返すフェイクエンジン（test/ のみ）。"""

    def invert(
        self,
        learner_audio_bytes: bytes,
        sample_rate: int,
        boundaries: list[dict],
    ) -> ArticulatoryInversionResult:
        return ArticulatoryInversionResult(per_phoneme=[])


# ---------------------------------------------------------------------------
# テスト
# ---------------------------------------------------------------------------


class TestGracefulDegradedWhenEngineUnavailable:
    """articulatory engine 不在 → per_phoneme=[] degrade テスト。"""

    def test_usecase_returns_empty_when_engine_raises(self) -> None:
        """エンジンが RuntimeError を送出したとき per_phoneme=[] を返すこと。"""
        engine = _AlwaysFailEngine()
        use_case = InvertArticulationUseCase(engine=engine)

        result = use_case.execute(
            learner_audio_bytes=b"\x00" * 100,
            sample_rate=16000,
            boundaries=[{"phoneme": "r", "startMs": 0, "endMs": 100}],
        )

        assert isinstance(result, ArticulatoryInversionResult)
        assert result.per_phoneme == []

    def test_usecase_does_not_raise_on_engine_failure(self) -> None:
        """エンジン失敗時に例外が伝播しないこと（HTTP 200 を維持する）。"""
        engine = _AlwaysFailEngine()
        use_case = InvertArticulationUseCase(engine=engine)

        # 例外が発生しないこと
        try:
            result = use_case.execute(
                learner_audio_bytes=b"\x00" * 100,
                sample_rate=16000,
                boundaries=[{"phoneme": "l", "startMs": 100, "endMs": 250}],
            )
        except Exception as error:
            pytest.fail(f"InvertArticulationUseCase raised unexpected exception: {error}")

        assert result.per_phoneme == []

    def test_empty_engine_returns_empty_per_phoneme(self) -> None:
        """エンジンが空リストを返したとき per_phoneme=[] であること。"""
        engine = _EmptyResultEngine()
        use_case = InvertArticulationUseCase(engine=engine)

        result = use_case.execute(
            learner_audio_bytes=b"\x00" * 100,
            sample_rate=16000,
            boundaries=[{"phoneme": "ae", "startMs": 0, "endMs": 200}],
        )

        assert result.per_phoneme == []

    def test_articulatory_inversion_engine_import_does_not_raise(self) -> None:
        """ArticulatoryInversionEngine のクラス定義 import が例外を送出しないこと（M-AAI-3）。

        articulatory package が不在でもクラスを import できること。
        実際の invert() 呼び出しは別テストで RuntimeError を期待して検証する。
        """
        try:
            from aai.infrastructure.articulatory_inversion import ArticulatoryInversionEngine

            _ = ArticulatoryInversionEngine()
        except ImportError as error:
            pytest.fail(
                f"ArticulatoryInversionEngine import raised ImportError: {error}. "
                "articulatory package が不在でも import error にならないこと（M-AAI-3）。"
            )

    def test_articulatory_engine_raises_runtime_error_not_import_error(self) -> None:
        """articulatory package 不在時に RuntimeError が送出されること（ImportError ではない）。

        usecase が RuntimeError をキャッチして graceful degrade する設計のため、
        engine は ImportError を内包した RuntimeError を送出すること。
        """
        from aai.infrastructure.articulatory_inversion import ArticulatoryInversionEngine

        engine = ArticulatoryInversionEngine()

        # articulatory が実際にインストールされていない場合のみ検証する
        try:
            import articulatory  # noqa: F401, PLC0415
            pytest.skip("articulatory is installed; degrade test not applicable")
        except ImportError:
            pass

        with pytest.raises(RuntimeError):
            engine.invert(
                learner_audio_bytes=b"\x00" * 100,
                sample_rate=16000,
                boundaries=[{"phoneme": "r", "startMs": 0, "endMs": 100}],
            )
