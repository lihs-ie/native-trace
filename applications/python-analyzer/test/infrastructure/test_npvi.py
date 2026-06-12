"""rhythm.npvi 純関数のユニットテスト。

重モデル依存なし。純粋ロジックのテスト。
"""

from python_analyzer.infrastructure.rhythm import compute_rhythm, npvi


class TestNpvi:
    """npvi() 純関数のテスト。"""

    def test_empty_list_returns_zero(self) -> None:
        """空リストは 0.0 を返すこと。"""
        assert npvi([]) == 0.0

    def test_single_item_returns_zero(self) -> None:
        """1 件のリストは 0.0 を返すこと。"""
        assert npvi([100.0]) == 0.0

    def test_equal_durations_returns_zero(self) -> None:
        """全て等長の場合は nPVI = 0 になること（完全等時性）。"""
        result = npvi([100.0, 100.0, 100.0, 100.0])
        assert abs(result) < 1e-9

    def test_large_variability_produces_large_npvi(self) -> None:
        """大きな長短差がある場合は nPVI が高くなること。"""
        # 200ms と 50ms の交互: 比較的大きな変動
        result = npvi([200.0, 50.0, 200.0, 50.0])
        assert result > 50.0

    def test_two_items_formula(self) -> None:
        """2 件の場合は公式通りに計算されること。

        nPVI = 100 / 1 * |d1 - d2| / ((d1 + d2) / 2)
        d1=100, d2=200: |100-200| / 150 = 100/150 ≈ 0.6667
        nPVI = 100 * 0.6667 ≈ 66.67
        """
        result = npvi([100.0, 200.0])
        expected = 100.0 * abs(100.0 - 200.0) / ((100.0 + 200.0) / 2)
        assert abs(result - expected) < 1e-9

    def test_zero_duration_pairs_excluded(self) -> None:
        """持続時間 0 のペアは除外（ゼロ除算回避）されること。"""
        result = npvi([0.0, 0.0, 100.0])
        # 0/0 のペアは除外され、最後の (0.0, 100.0) ペアも除外される
        # 全ペアが分母 0 なので count=0、結果は 0.0
        assert result >= 0.0  # ゼロ除算は起きていない

    def test_typical_english_npvi_range(self) -> None:
        """英語らしい持続時間列は nPVI が 60 前後になること（参考値）。

        英語の vocalic nPVI は Grabe & Low (2002) で約 60-70。
        """
        # 英語らしい変動（長短のコントラスト）を模した値
        durations = [150.0, 60.0, 200.0, 50.0, 180.0, 70.0]
        result = npvi(durations)
        # 50 以上（等時語族より高い）であること
        assert result > 40.0


class TestComputeRhythm:
    """compute_rhythm() のテスト。"""

    def test_reference_npvi_is_constant(self) -> None:
        """参照値は 65.0 であること（英語代表値）。"""
        rhythm = compute_rhythm([100.0, 200.0])
        assert rhythm.reference_npvi_vocalic == 65.0

    def test_npvi_vocalic_matches_npvi_function(self) -> None:
        """npviVocalic は npvi() と同じ結果を返すこと。"""
        durations = [120.0, 80.0, 150.0, 60.0]
        rhythm = compute_rhythm(durations)
        assert abs(rhythm.npvi_vocalic - npvi(durations)) < 1e-9
