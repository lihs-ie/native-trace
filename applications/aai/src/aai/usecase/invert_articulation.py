"""調音逆推定ユースケース。

domain / usecase/port のみに依存。articulatory / fastapi / torch を直接 import しない。
モデル不在・推論失敗時は per_phoneme=[] の graceful degrade を返す（HTTP 200 業務ロジック）。
"""

import logging

from aai.domain.articulatory_estimate import ArticulatoryInversionResult
from aai.usecase.port.articulatory_inversion import ArticulatoryInversionPort

logger = logging.getLogger(__name__)


class InvertArticulationUseCase:
    """学習者音声から調音軌跡を推定するユースケース。

    articulatory エンジンをポート経由で利用し、
    ArticulatoryInversionResult を返す。

    モデル不在・推論失敗時は per_phoneme=[] を返す（graceful degrade）。
    HTTP ステータスは常に 200（ゲート判定は worker 側の責務）。
    """

    def __init__(self, engine: ArticulatoryInversionPort) -> None:
        self._engine = engine

    def execute(
        self,
        learner_audio_bytes: bytes,
        sample_rate: int,
        boundaries: list[dict],
    ) -> ArticulatoryInversionResult:
        """調音逆推定を実行し ArticulatoryInversionResult を返す。

        Args:
            learner_audio_bytes: 学習者音声バイト列。
            sample_rate: 音声サンプルレート (Hz)。
            boundaries: 音素境界リスト。各要素は {"phoneme": str, "startMs": int, "endMs": int}。

        Returns:
            ArticulatoryInversionResult。モデル利用不可時は per_phoneme=[]。
        """
        try:
            return self._engine.invert(
                learner_audio_bytes=learner_audio_bytes,
                sample_rate=sample_rate,
                boundaries=boundaries,
            )
        except RuntimeError as engine_error:
            logger.warning("Articulatory inversion engine failed: %s", engine_error)
            return ArticulatoryInversionResult(per_phoneme=[])
        except Exception as unexpected_error:
            logger.error("Unexpected error in articulatory inversion: %s", unexpected_error)
            return ArticulatoryInversionResult(per_phoneme=[])
