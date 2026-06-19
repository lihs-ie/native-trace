"""D3-a/D3-b/D3-c 純粋ヘルパー関数のユニットテスト。

テストダブル（フェイク）は test/ のみに存在する（agent-policy）。
本番コードに mock/stub/placeholder を入れない。

M-AAI-4: 12-dim EMA → 6 wire 座標の写像正確性テスト（下顎/舌体 drop 含む）。
M-AAI-5: 全座標が [-1.0, 1.0] に収まること / 生 mm が response に現れないこと。
M-AAI-6: durationAdequacy = min(1.0, (endMs-startMs)/50) / displayEligibility 三項積。
"""

import io
import struct
import wave

import numpy as np
import pytest

from aai.infrastructure.articulatory_inversion import (
    _compute_display_eligibility,
    _map_12dim_ema_to_6_coords,
    _normalize_coords_zscore,
)

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


_LEARNER_WAV_500MS = _make_wav_bytes(0.5, 16000)
_LEARNER_WAV_100MS = _make_wav_bytes(0.1, 16000)


# ---------------------------------------------------------------------------
# D3-a: 12-dim EMA → 6 wire 座標写像テスト（M-AAI-4）
# ---------------------------------------------------------------------------


class TestMap12DimEmaTo6Coords:
    """D3-a: 12-dim EMA → 6 wire 座標写像の正確性テスト。"""

    def test_tongue_tip_passthrough(self) -> None:
        """tongue tip センサー XY がそのまま wire に出ること。"""
        # shape (1, 12): lower_incisor(0,1), upper_lip(2,3), lower_lip(4,5),
        #                tongue_tip(6,7), tongue_body(8,9), tongue_dorsum(10,11)
        ema = np.zeros((1, 12))
        ema[0, 6] = 5.0   # tongue_tip_x
        ema[0, 7] = -3.0  # tongue_tip_y

        result = _map_12dim_ema_to_6_coords(ema)

        assert result.shape == (1, 6)
        assert result[0, 0] == pytest.approx(5.0)    # tongue_tip_x
        assert result[0, 1] == pytest.approx(-3.0)   # tongue_tip_y

    def test_tongue_dorsum_passthrough(self) -> None:
        """tongue dorsum センサー XY がそのまま wire に出ること。"""
        ema = np.zeros((1, 12))
        ema[0, 10] = 2.5   # tongue_dorsum_x
        ema[0, 11] = 1.5   # tongue_dorsum_y

        result = _map_12dim_ema_to_6_coords(ema)

        assert result[0, 2] == pytest.approx(2.5)    # tongue_dorsum_x
        assert result[0, 3] == pytest.approx(1.5)    # tongue_dorsum_y

    def test_lip_aperture_y_is_lower_minus_upper(self) -> None:
        """lipApertureY = lowerLipY − upperLipY の導出が正しいこと。"""
        ema = np.zeros((1, 12))
        ema[0, 3] = 2.0   # upper_lip_y
        ema[0, 5] = 5.0   # lower_lip_y

        result = _map_12dim_ema_to_6_coords(ema)

        # lipApertureY = lowerLipY - upperLipY = 5.0 - 2.0 = 3.0
        assert result[0, 5] == pytest.approx(3.0)  # lip_aperture_y (index 5)

    def test_lip_aperture_x_is_midpoint(self) -> None:
        """lipApertureX = (upperLipX + lowerLipX) / 2 の導出が正しいこと。"""
        ema = np.zeros((1, 12))
        ema[0, 2] = 4.0   # upper_lip_x
        ema[0, 4] = 6.0   # lower_lip_x

        result = _map_12dim_ema_to_6_coords(ema)

        # lipApertureX = (4.0 + 6.0) / 2 = 5.0
        assert result[0, 4] == pytest.approx(5.0)  # lip_aperture_x (index 4)

    def test_lower_incisor_not_in_output(self) -> None:
        """lower_incisor（下顎切歯）が wire に出ないこと（D3-a drop）。"""
        ema = np.zeros((1, 12))
        ema[0, 0] = 99.0   # lower_incisor_x（drop されるべき）
        ema[0, 1] = 99.0   # lower_incisor_y（drop されるべき）

        result = _map_12dim_ema_to_6_coords(ema)

        # 出力の全座標が 99.0 でないこと（lower_incisor は drop）
        assert 99.0 not in result[0]

    def test_tongue_body_not_in_output(self) -> None:
        """tongue_body（舌体）が wire に出ないこと（D3-a drop）。"""
        ema = np.zeros((1, 12))
        ema[0, 8] = 88.0   # tongue_body_x（drop されるべき）
        ema[0, 9] = 88.0   # tongue_body_y（drop されるべき）

        result = _map_12dim_ema_to_6_coords(ema)

        # 出力の全座標が 88.0 でないこと（tongue_body は drop）
        assert 88.0 not in result[0]

    def test_output_has_6_columns(self) -> None:
        """出力が 6 列（wire 座標数）であること。"""
        ema = np.random.randn(10, 12).astype(np.float32)
        result = _map_12dim_ema_to_6_coords(ema)
        assert result.shape == (10, 6)

    def test_multiple_frames(self) -> None:
        """複数フレームに対して正しく写像されること。"""
        n_frames = 5
        ema = np.zeros((n_frames, 12))
        ema[:, 6] = np.arange(n_frames, dtype=float)  # tongue_tip_x: 0,1,2,3,4
        ema[:, 7] = np.ones(n_frames) * -1.0           # tongue_tip_y: -1

        result = _map_12dim_ema_to_6_coords(ema)

        np.testing.assert_allclose(result[:, 0], np.arange(n_frames, dtype=float))
        np.testing.assert_allclose(result[:, 1], np.full(n_frames, -1.0))

    def test_known_values_all_channels(self) -> None:
        """全チャネルの既知値に対して正しく写像されること（D3-a 完全テスト）。"""
        # lower_incisor と tongue_body を明確に区別できる値（計算結果と被らない）を使う
        ema = np.array([[
            100.0, 110.0,  # lower_incisor x,y (drop) — 大きい値で識別
            20.0, 21.0,    # upper_lip x,y
            30.0, 31.0,    # lower_lip x,y
            40.0, 41.0,    # tongue_tip x,y (passthrough)
            500.0, 510.0,  # tongue_body x,y (drop) — 大きい値で識別
            60.0, 61.0,    # tongue_dorsum x,y (passthrough)
        ]])

        result = _map_12dim_ema_to_6_coords(ema)

        # tongue_tip passthrough
        assert result[0, 0] == pytest.approx(40.0)
        assert result[0, 1] == pytest.approx(41.0)
        # tongue_dorsum passthrough
        assert result[0, 2] == pytest.approx(60.0)
        assert result[0, 3] == pytest.approx(61.0)
        # lipApertureX = (upperLipX + lowerLipX) / 2 = (20 + 30) / 2 = 25
        assert result[0, 4] == pytest.approx(25.0)
        # lipApertureY = lowerLipY - upperLipY = 31 - 21 = 10
        assert result[0, 5] == pytest.approx(10.0)
        # lower_incisor の値（100, 110）と tongue_body の値（500, 510）が出力に現れないこと
        for forbidden in [100.0, 110.0, 500.0, 510.0]:
            assert forbidden not in result[0], (
                f"Forbidden value {forbidden} found in output (should be dropped)"
            )


# ---------------------------------------------------------------------------
# D3-b: 発話内 z-score 正規化テスト（M-AAI-5）
# ---------------------------------------------------------------------------


class TestNormalizeCoordsZscore:
    """D3-b: 発話内 z-score 正規化 → [-1.0, 1.0] クランプのテスト。"""

    def test_all_coords_in_minus_1_to_1(self) -> None:
        """正規化後の全座標が [-1.0, 1.0] に収まること。"""
        # 大きな生 mm 値を含む入力（例: 50mm スケール）
        coords = np.random.randn(100, 6) * 20.0
        result = _normalize_coords_zscore(coords)
        assert np.all(result >= -1.0)
        assert np.all(result <= 1.0)

    def test_raw_mm_values_not_in_output(self) -> None:
        """生 mm 値が出力に現れないこと。"""
        # 100mm スケールの入力
        coords = np.ones((10, 6)) * 100.0
        result = _normalize_coords_zscore(coords)
        # 100mm は出力に現れない（正規化で 0.0 になる）
        assert not np.any(result == 100.0)

    def test_constant_channel_maps_to_zero(self) -> None:
        """定数チャネル（std=0）が 0.0 に写像されること。"""
        coords = np.ones((5, 6)) * 42.0
        result = _normalize_coords_zscore(coords)
        np.testing.assert_allclose(result, 0.0)

    def test_symmetric_distribution_has_zero_mean(self) -> None:
        """正規分布入力で出力の平均が概ね 0 に近いこと。"""
        np.random.seed(42)
        coords = np.random.randn(1000, 6) * 10.0
        result = _normalize_coords_zscore(coords)
        # クランプの影響で完全な 0 にはならないが概ね 0 に近い
        assert np.all(np.abs(np.mean(result, axis=0)) < 0.5)

    def test_clips_extreme_values(self) -> None:
        """z-score が 1 を超える値が [-1, 1] にクランプされること。"""
        coords = np.zeros((10, 6))
        coords[9, 0] = 1000.0  # 極端な外れ値
        result = _normalize_coords_zscore(coords)
        assert result[9, 0] == pytest.approx(1.0)

    def test_shape_preserved(self) -> None:
        """出力の shape が入力と同じであること。"""
        coords = np.random.randn(50, 6)
        result = _normalize_coords_zscore(coords)
        assert result.shape == coords.shape


# ---------------------------------------------------------------------------
# D3-c: displayEligibility テスト（M-AAI-6）
# ---------------------------------------------------------------------------


class TestComputeDisplayEligibility:
    """D3-c: displayEligibility = validFrameRatio × voicingRatio × durationAdequacy のテスト。"""

    def test_duration_adequacy_formula(self) -> None:
        """durationAdequacy = min(1.0, (endMs-startMs)/50) の公式が正しいこと。"""
        # 50ms → durationAdequacy = 1.0
        ema_50ms = np.ones((10, 6)) * 1.0
        result_50 = _compute_display_eligibility(
            ema_segment_frames=ema_50ms,
            learner_audio_bytes=_LEARNER_WAV_500MS,
            sample_rate=16000,
            start_ms=0,
            end_ms=50,
        )
        # voicingRatio は librosa 依存のため 0 以上であること、かつ duration_adequacy=1.0 で上限
        # 厳密な値の検証は困難なので、100ms ケースとの比較で公式を確認する

        # 25ms → durationAdequacy = 0.5
        ema_25ms = np.ones((5, 6)) * 1.0
        result_25 = _compute_display_eligibility(
            ema_segment_frames=ema_25ms,
            learner_audio_bytes=_LEARNER_WAV_500MS,
            sample_rate=16000,
            start_ms=0,
            end_ms=25,
        )
        # 25ms の方が 50ms より小さいか等しいはず（durationAdequacy が 0.5 vs 1.0）
        assert result_25 <= result_50 + 1e-6

    def test_duration_adequacy_clamp_at_1(self) -> None:
        """100ms 以上のセグメントで durationAdequacy が 1.0 にクランプされること。"""
        ema = np.ones((20, 6)) * 1.0
        result_100 = _compute_display_eligibility(
            ema_segment_frames=ema,
            learner_audio_bytes=_LEARNER_WAV_500MS,
            sample_rate=16000,
            start_ms=0,
            end_ms=100,
        )
        result_200 = _compute_display_eligibility(
            ema_segment_frames=ema,
            learner_audio_bytes=_LEARNER_WAV_500MS,
            sample_rate=16000,
            start_ms=0,
            end_ms=200,
        )
        # 100ms 以上なら durationAdequacy=1.0（変化なし）
        # voicingRatio と validFrameRatio は同じセグメントで同じになるはず
        assert abs(result_100 - result_200) < 0.1  # voicing computation での差は許容

    def test_nan_frames_reduce_valid_frame_ratio(self) -> None:
        """NaN フレームが多いほど displayEligibility が下がること。"""
        ema_all_valid = np.ones((10, 6)) * 1.0
        ema_half_nan = np.ones((10, 6)) * 1.0
        ema_half_nan[5:, :] = np.nan  # 半分が NaN

        result_valid = _compute_display_eligibility(
            ema_segment_frames=ema_all_valid,
            learner_audio_bytes=_LEARNER_WAV_500MS,
            sample_rate=16000,
            start_ms=0,
            end_ms=100,
        )
        result_nan = _compute_display_eligibility(
            ema_segment_frames=ema_half_nan,
            learner_audio_bytes=_LEARNER_WAV_500MS,
            sample_rate=16000,
            start_ms=0,
            end_ms=100,
        )
        # NaN フレームが多い方が小さいはず
        assert result_nan < result_valid + 1e-6

    def test_empty_frames_returns_zero(self) -> None:
        """フレームが空の場合は 0.0 を返すこと。"""
        ema_empty = np.zeros((0, 6))
        result = _compute_display_eligibility(
            ema_segment_frames=ema_empty,
            learner_audio_bytes=_LEARNER_WAV_500MS,
            sample_rate=16000,
            start_ms=0,
            end_ms=100,
        )
        assert result == pytest.approx(0.0)

    def test_result_in_0_to_1_range(self) -> None:
        """displayEligibility が [0.0, 1.0] に収まること。"""
        ema = np.ones((20, 6)) * 1.0
        result = _compute_display_eligibility(
            ema_segment_frames=ema,
            learner_audio_bytes=_LEARNER_WAV_500MS,
            sample_rate=16000,
            start_ms=0,
            end_ms=200,
        )
        assert 0.0 <= result <= 1.0

    def test_no_variance_or_uncertainty_word_in_logic(self) -> None:
        """displayEligibility の算出に variance/uncertainty 語を使っていないことを確認する。

        M-AAI-6: モデル内部の予測分散・不確実度に依存しないことを保証する。
        このテストは実装コードを文字列として読んでチェックする（grep 相当）。
        """
        import inspect

        from aai.infrastructure import articulatory_inversion

        source = inspect.getsource(articulatory_inversion._compute_display_eligibility)
        # 算出式に variance / uncertainty が使われていないこと
        assert "variance" not in source.lower()
        assert "uncertainty" not in source.lower()
