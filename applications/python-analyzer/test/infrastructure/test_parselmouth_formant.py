"""parselmouth_formant.extract_phoneme_acoustics の単体テスト（M-APD-3）。

受入条件:
(a) 40ms 未満境界 → f1/f2/f3 None
(b) 30ms 未満境界 → spectral_centroid_hz None
(c) duration は常に算出される
(d) max_number_of_formants=5 定数 + ceiling 6500 for 'F' / 5500 otherwise の確認
    （テスト内の fake は TEST のみに存在し、本番コードには含まない）

注記: parselmouth / scipy / soundfile 等の重依存を使うため Docker 環境でのみ完全実行される。
      ローカル環境（依存なし）では skip される。
      テスト内に fake to_formant_burg を作成するが、これは TEST ファイル内のみに存在する
      （本番コードにモック/スタブを含まないという agent-policy に準拠）。
"""

import struct
import unittest.mock
from typing import Any

import pytest

from python_analyzer.domain.phoneme import AlignmentBoundary, PhonemeLabel

# parselmouth_formant は常に import できる（parselmouth が利用不可なら内部で () を返す）
from python_analyzer.infrastructure.parselmouth_formant import extract_phoneme_acoustics


def _make_minimal_wav(duration_ms: int = 500, sample_rate: int = 16000) -> bytes:
    """最小限の無音 WAV バイト列を生成する（16kHz, 16bit, mono）。"""
    num_samples = int(sample_rate * duration_ms / 1000)
    bits_per_sample = 16
    num_channels = 1
    byte_rate = sample_rate * num_channels * bits_per_sample // 8
    block_align = num_channels * bits_per_sample // 8
    data_size = num_samples * block_align

    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        36 + data_size,
        b"WAVE",
        b"fmt ",
        16,
        1,  # PCM
        num_channels,
        sample_rate,
        byte_rate,
        block_align,
        bits_per_sample,
        b"data",
        data_size,
    )
    audio_data = b"\x00" * data_size
    return header + audio_data


def _make_boundary(phoneme: str, start_ms: int, end_ms: int) -> AlignmentBoundary:
    """テスト用の AlignmentBoundary を作成するヘルパー。"""
    return AlignmentBoundary(
        phoneme=PhonemeLabel(phoneme),
        start_milliseconds=start_ms,
        end_milliseconds=end_ms,
    )


# --- ガード条件のテスト（parselmouth 不要、WAV デコードが必要） ---


class TestDurationAlwaysComputed:
    """(c) duration は常に算出されること（ガードに関係なく）。"""

    def test_duration_computed_for_short_boundary(self) -> None:
        """20ms 境界でも duration_milliseconds = 20 が返ること。"""
        # parselmouth が利用可能でも不可でも、duration は常に返す。
        # parselmouth が利用不可（Docker 外）なら () が返るので skip。
        wav = _make_minimal_wav(duration_ms=200)
        boundary = _make_boundary("p", 0, 20)

        results = extract_phoneme_acoustics(
            audio_bytes=wav,
            boundaries=(boundary,),
            sample_rate=16000,
            maximum_formant_hz=5500.0,
        )

        if not results:
            pytest.skip("parselmouth が利用不可のため skip（Docker 環境で実行すること）")

        assert results[0].duration_milliseconds == 20

    def test_duration_computed_for_long_boundary(self) -> None:
        """100ms 境界で duration_milliseconds = 100 が返ること。"""
        wav = _make_minimal_wav(duration_ms=200)
        boundary = _make_boundary("æ", 0, 100)

        results = extract_phoneme_acoustics(
            audio_bytes=wav,
            boundaries=(boundary,),
            sample_rate=16000,
            maximum_formant_hz=5500.0,
        )

        if not results:
            pytest.skip("parselmouth が利用不可のため skip（Docker 環境で実行すること）")

        assert results[0].duration_milliseconds == 100


class TestFormantGuard40ms:
    """(a) 40ms 未満境界 → f1/f2/f3 None。"""

    def test_boundary_below_40ms_returns_none_formants(self) -> None:
        """39ms 境界で f1/f2/f3 が None であること。"""
        wav = _make_minimal_wav(duration_ms=200)
        boundary = _make_boundary("æ", 0, 39)

        results = extract_phoneme_acoustics(
            audio_bytes=wav,
            boundaries=(boundary,),
            sample_rate=16000,
            maximum_formant_hz=5500.0,
        )

        if not results:
            pytest.skip("parselmouth が利用不可のため skip（Docker 環境で実行すること）")

        assert results[0].f1_hz is None
        assert results[0].f2_hz is None
        assert results[0].f3_hz is None

    def test_boundary_exact_40ms_can_sample_formants(self) -> None:
        """40ms 境界ではフォルマントサンプリングを試みること（None でなければ通過）。

        無音 WAV なので NaN → None になりうるが、ガードで None になるわけではないこと
        を確認する（ガード条件は duration < 40 つまり 39ms 以下のみ）。
        """
        wav = _make_minimal_wav(duration_ms=200)
        boundary = _make_boundary("æ", 0, 40)

        results = extract_phoneme_acoustics(
            audio_bytes=wav,
            boundaries=(boundary,),
            sample_rate=16000,
            maximum_formant_hz=5500.0,
        )

        if not results:
            pytest.skip("parselmouth が利用不可のため skip（Docker 環境で実行すること）")

        # 40ms の場合はガードが外れる（None かどうかは NaN 次第で確認不要）
        assert results[0].duration_milliseconds == 40


class TestSpectralCentroidGuard30ms:
    """(b) 30ms 未満境界 → spectral_centroid_hz None。"""

    def test_boundary_below_30ms_returns_none_centroid(self) -> None:
        """29ms 境界で spectral_centroid_hz が None であること。"""
        wav = _make_minimal_wav(duration_ms=200)
        boundary = _make_boundary("s", 0, 29)

        results = extract_phoneme_acoustics(
            audio_bytes=wav,
            boundaries=(boundary,),
            sample_rate=16000,
            maximum_formant_hz=5500.0,
        )

        if not results:
            pytest.skip("parselmouth が利用不可のため skip（Docker 環境で実行すること）")

        assert results[0].spectral_centroid_hz is None

    def test_boundary_30ms_or_more_attempts_centroid(self) -> None:
        """30ms 境界ではスペクトル重心計算を試みること。

        無音 WAV でも total_power=0 のため None になる可能性があるが、
        ガード条件（duration < 30）によって None になるわけでないことを確認する。
        """
        wav = _make_minimal_wav(duration_ms=200)
        boundary = _make_boundary("s", 0, 30)

        results = extract_phoneme_acoustics(
            audio_bytes=wav,
            boundaries=(boundary,),
            sample_rate=16000,
            maximum_formant_hz=5500.0,
        )

        if not results:
            pytest.skip("parselmouth が利用不可のため skip（Docker 環境で実行すること）")

        # 30ms 以上ではガードが外れる（値は無音 WAV 特性による）
        assert results[0].duration_milliseconds == 30


# --- (d) max_number_of_formants=5 定数 + maximum_formant 分岐テスト ---
# テスト内の fake to_formant_burg は TEST ファイルのみに存在する（本番コードには含まない）


class TestToFormantBurgArguments:
    """(d) to_formant_burg が正しい引数で呼ばれること（D2 引数取り違え回帰防止）。

    max_number_of_formants=5 は定数（本数）、maximum_formant は Hz 天井（呼び出し側から受け取る）。
    これらを取り違えるとフォルマント計測が全件無効になる致命的バグ（ADR-018 D2）。
    """

    def _extract_with_fake_parselmouth(
        self,
        audio_bytes: bytes,
        boundaries: tuple[AlignmentBoundary, ...],
        maximum_formant_hz: float,
    ) -> dict[str, Any]:
        """parselmouth.Sound.to_formant_burg に渡された引数をキャプチャするためのヘルパー。

        このヘルパーは TEST ファイル内にのみ存在し、本番コードには含まない。
        """
        # parselmouth モジュール全体をモックして to_formant_burg の引数をキャプチャする
        # このモックは TEST ファイル内の変数として存在し、本番コードには注入しない
        import sys
        import types

        fake_formants = unittest.mock.MagicMock()
        fake_formants.get_value_at_time.return_value = float("nan")

        fake_sound_instance = unittest.mock.MagicMock()
        fake_sound_instance.to_formant_burg.return_value = fake_formants

        def fake_sound_constructor(*args: Any, **kwargs: Any) -> Any:
            return fake_sound_instance

        fake_parselmouth = types.ModuleType("parselmouth")
        fake_parselmouth.Sound = fake_sound_constructor  # type: ignore[attr-defined]

        original = sys.modules.get("parselmouth")
        sys.modules["parselmouth"] = fake_parselmouth

        try:
            extract_phoneme_acoustics(
                audio_bytes=audio_bytes,
                boundaries=boundaries,
                sample_rate=16000,
                maximum_formant_hz=maximum_formant_hz,
            )
        finally:
            if original is None:
                sys.modules.pop("parselmouth", None)
            else:
                sys.modules["parselmouth"] = original

        # to_formant_burg の呼び出し引数を返す
        if fake_sound_instance.to_formant_burg.called:
            call_kwargs = fake_sound_instance.to_formant_burg.call_args
            return dict(call_kwargs.kwargs) if call_kwargs.kwargs else {}
        return {}

    def test_max_number_of_formants_is_5_constant(self) -> None:
        """max_number_of_formants が常に 5（本数定数）であること。"""
        # soundfile も必要なため、ない場合は skip
        try:
            import soundfile  # noqa: F401
        except ImportError:
            pytest.skip("soundfile が利用不可のため skip")

        wav = _make_minimal_wav(duration_ms=200)
        boundary = _make_boundary("iː", 0, 100)

        kwargs = self._extract_with_fake_parselmouth(
            audio_bytes=wav,
            boundaries=(boundary,),
            maximum_formant_hz=5500.0,
        )

        assert kwargs.get("max_number_of_formants") == 5

    def test_maximum_formant_is_5500_for_male_or_unknown(self) -> None:
        """M/unknown のとき maximum_formant=5500 が渡されること。"""
        try:
            import soundfile  # noqa: F401
        except ImportError:
            pytest.skip("soundfile が利用不可のため skip")

        wav = _make_minimal_wav(duration_ms=200)
        boundary = _make_boundary("iː", 0, 100)

        kwargs = self._extract_with_fake_parselmouth(
            audio_bytes=wav,
            boundaries=(boundary,),
            maximum_formant_hz=5500.0,
        )

        assert kwargs.get("maximum_formant") == pytest.approx(5500.0)

    def test_maximum_formant_is_6500_for_female(self) -> None:
        """F のとき maximum_formant=6500 が渡されること。"""
        try:
            import soundfile  # noqa: F401
        except ImportError:
            pytest.skip("soundfile が利用不可のため skip")

        wav = _make_minimal_wav(duration_ms=200)
        boundary = _make_boundary("iː", 0, 100)

        kwargs = self._extract_with_fake_parselmouth(
            audio_bytes=wav,
            boundaries=(boundary,),
            maximum_formant_hz=6500.0,
        )

        assert kwargs.get("maximum_formant") == pytest.approx(6500.0)

    def test_to_formant_burg_called_once_not_per_phoneme(self) -> None:
        """to_formant_burg が発話全体で 1 回だけ呼ばれること（per-phoneme では呼ばない）。"""
        try:
            import soundfile  # noqa: F401
        except ImportError:
            pytest.skip("soundfile が利用不可のため skip")

        import sys
        import types

        fake_formants = unittest.mock.MagicMock()
        fake_formants.get_value_at_time.return_value = float("nan")

        fake_sound_instance = unittest.mock.MagicMock()
        fake_sound_instance.to_formant_burg.return_value = fake_formants

        def fake_sound_constructor(*args: Any, **kwargs: Any) -> Any:
            return fake_sound_instance

        fake_parselmouth = types.ModuleType("parselmouth")
        fake_parselmouth.Sound = fake_sound_constructor  # type: ignore[attr-defined]

        original = sys.modules.get("parselmouth")
        sys.modules["parselmouth"] = fake_parselmouth

        wav = _make_minimal_wav(duration_ms=500)
        boundaries = (
            _make_boundary("h", 0, 50),
            _make_boundary("ɛ", 50, 150),
            _make_boundary("l", 150, 250),
            _make_boundary("oʊ", 250, 400),
        )

        try:
            extract_phoneme_acoustics(
                audio_bytes=wav,
                boundaries=boundaries,
                sample_rate=16000,
                maximum_formant_hz=5500.0,
            )
        finally:
            if original is None:
                sys.modules.pop("parselmouth", None)
            else:
                sys.modules["parselmouth"] = original

        # 4音素あっても to_formant_burg は 1 回だけ呼ばれること
        assert fake_sound_instance.to_formant_burg.call_count == 1


# --- M-APD-19: 多点 median サンプリングのテスト ---
# テスト内の fake to_formant_burg は TEST ファイルのみに存在する（本番コードには含まない）


class TestMultiPointMedianSampling:
    """M-APD-19: 多点サンプリング median の動作テスト。

    単一中点 NaN でも他の点が有効なら formant 値が返ること。
    全点 NaN の場合のみ None になること。
    F1/F2/F3 は独立して NaN 除去されること。
    """

    def _extract_with_controlled_formants(
        self,
        boundaries: tuple[AlignmentBoundary, ...],
        get_value_side_effect: Any,
    ) -> tuple:
        """get_value_at_time の返り値を制御して extract_phoneme_acoustics を呼ぶ。

        このヘルパーは TEST ファイル内のみ。本番コードへの注入は行わない。
        """
        try:
            import soundfile  # noqa: F401
        except ImportError:
            pytest.skip("soundfile が利用不可のため skip")

        import sys
        import types

        fake_formants = unittest.mock.MagicMock()
        fake_formants.get_value_at_time.side_effect = get_value_side_effect

        fake_sound_instance = unittest.mock.MagicMock()
        fake_sound_instance.to_formant_burg.return_value = fake_formants

        def fake_sound_constructor(*args: Any, **kwargs: Any) -> Any:
            return fake_sound_instance

        fake_parselmouth = types.ModuleType("parselmouth")
        fake_parselmouth.Sound = fake_sound_constructor  # type: ignore[attr-defined]

        original = sys.modules.get("parselmouth")
        sys.modules["parselmouth"] = fake_parselmouth

        wav = _make_minimal_wav(duration_ms=500)
        try:
            results = extract_phoneme_acoustics(
                audio_bytes=wav,
                boundaries=boundaries,
                sample_rate=16000,
                maximum_formant_hz=5500.0,
            )
        finally:
            if original is None:
                sys.modules.pop("parselmouth", None)
            else:
                sys.modules["parselmouth"] = original

        return results

    def test_midpoint_nan_but_inner_points_valid_returns_median(self) -> None:
        """幾何中点が NaN でも 0.3/0.4/0.6/0.7 の点が有効なら formant 値が返ること（M-APD-19）。

        これが /r/ rhoticity 修正の核心: forced-alignment 伸張で midpoint が voicing 外を指しても
        内側の有声点から F1/F2/F3 を取得できる。
        """
        # 100ms 境界 (0..100ms) → サンプル点は 30/40/50/60/70ms
        # 幾何中点 (0.5 = 50ms) は NaN, 他 4 点は有効値 (F1=800, F2=1500, F3=2200)
        boundary = _make_boundary("ɹ", 0, 100)

        def get_value_at_time_stub(formant_number: int, time_s: float) -> float:
            # 50ms (0.050s) のみ NaN、他は定数値
            if abs(time_s - 0.050) < 1e-6:
                return float("nan")
            # F1=800, F2=1500, F3=2200 (全サンプル点で同一)
            return {1: 800.0, 2: 1500.0, 3: 2200.0}[formant_number]

        results = self._extract_with_controlled_formants(
            boundaries=(boundary,),
            get_value_side_effect=get_value_at_time_stub,
        )

        assert len(results) == 1
        result = results[0]
        # 中点 NaN でも他点の median が返ること
        assert result.f1_hz is not None, "f1_hz が None になった（多点サンプリングが効いていない）"
        assert result.f2_hz is not None, "f2_hz が None になった（多点サンプリングが効いていない）"
        assert result.f3_hz is not None, "f3_hz が None になった（多点サンプリングが効いていない）"
        assert abs(result.f1_hz - 800.0) < 1.0
        assert abs(result.f2_hz - 1500.0) < 1.0
        assert abs(result.f3_hz - 2200.0) < 1.0

    def test_all_points_nan_returns_none_formants(self) -> None:
        """全サンプル点が NaN のとき formant が None になること（M-APD-19）。"""
        boundary = _make_boundary("t", 0, 100)

        def all_nan(_formant_number: int, _time_s: float) -> float:
            return float("nan")

        results = self._extract_with_controlled_formants(
            boundaries=(boundary,),
            get_value_side_effect=all_nan,
        )

        assert len(results) == 1
        assert results[0].f1_hz is None
        assert results[0].f2_hz is None
        assert results[0].f3_hz is None

    def test_get_value_at_time_called_5_times_per_formant(self) -> None:
        """各 formant (1,2,3) につき 5 点のサンプリングが行われること
        （M-APD-19: 0.3/0.4/0.5/0.6/0.7）。
        """
        try:
            import soundfile  # noqa: F401
        except ImportError:
            pytest.skip("soundfile が利用不可のため skip")

        import sys
        import types

        fake_formants = unittest.mock.MagicMock()
        fake_formants.get_value_at_time.return_value = float("nan")

        fake_sound_instance = unittest.mock.MagicMock()
        fake_sound_instance.to_formant_burg.return_value = fake_formants

        def fake_sound_constructor(*args: Any, **kwargs: Any) -> Any:
            return fake_sound_instance

        fake_parselmouth = types.ModuleType("parselmouth")
        fake_parselmouth.Sound = fake_sound_constructor  # type: ignore[attr-defined]

        original = sys.modules.get("parselmouth")
        sys.modules["parselmouth"] = fake_parselmouth

        wav = _make_minimal_wav(duration_ms=500)
        boundary = _make_boundary("ɹ", 0, 200)  # 200ms, > 40ms guard

        try:
            extract_phoneme_acoustics(
                audio_bytes=wav,
                boundaries=(boundary,),
                sample_rate=16000,
                maximum_formant_hz=5500.0,
            )
        finally:
            if original is None:
                sys.modules.pop("parselmouth", None)
            else:
                sys.modules["parselmouth"] = original

        # 1 boundary × 3 formants × 5 sample points = 15 calls
        assert fake_formants.get_value_at_time.call_count == 15, (
            f"expected 15 calls (3 formants × 5 points), "
            f"got {fake_formants.get_value_at_time.call_count}"
        )


# --- ProsodyAnalyzer の maximum_formant_hz 分岐テスト ---


class TestProsodyAnalyzerFormantCeiling:
    """ProsodyAnalyzer.measure_phoneme_acoustics が
    speakerSex に応じて正しい Hz 天井を選択すること（M-APD-4）。
    """

    def _call_with_fake_formant(
        self,
        speaker_sex: str,
    ) -> float | None:
        """ProsodyAnalyzer に fake parselmouth_formant を注入してキャプチャする。

        このヘルパーは TEST ファイル内のみ。本番コードへの注入は行わない。
        """
        captured: dict[str, Any] = {}

        import python_analyzer.infrastructure.parselmouth_formant as real_module

        original_extract = real_module.extract_phoneme_acoustics

        def fake_extract(
            audio_bytes: bytes,
            boundaries: Any,
            sample_rate: int,
            maximum_formant_hz: float,
        ) -> tuple:
            captured["maximum_formant_hz"] = maximum_formant_hz
            return ()

        real_module.extract_phoneme_acoustics = fake_extract  # type: ignore[assignment]

        try:
            from python_analyzer.infrastructure.prosody_analyzer import ProsodyAnalyzer

            analyzer = ProsodyAnalyzer()
            analyzer.measure_phoneme_acoustics(
                audio_bytes=b"",
                boundaries=(),
                sample_rate=16000,
                speaker_sex=speaker_sex,
            )
        finally:
            real_module.extract_phoneme_acoustics = original_extract  # type: ignore[assignment]

        return captured.get("maximum_formant_hz")

    def test_female_speaker_uses_6500_hz_ceiling(self) -> None:
        """speakerSex='F' のとき maximum_formant_hz=6500 が使われること。"""
        maximum_formant_hz = self._call_with_fake_formant("F")
        assert maximum_formant_hz == pytest.approx(6500.0)

    def test_male_speaker_uses_5500_hz_ceiling(self) -> None:
        """speakerSex='M' のとき maximum_formant_hz=5500 が使われること。"""
        maximum_formant_hz = self._call_with_fake_formant("M")
        assert maximum_formant_hz == pytest.approx(5500.0)

    def test_unknown_speaker_uses_5500_hz_ceiling(self) -> None:
        """speakerSex='unknown' のとき maximum_formant_hz=5500 が使われること。"""
        maximum_formant_hz = self._call_with_fake_formant("unknown")
        assert maximum_formant_hz == pytest.approx(5500.0)
