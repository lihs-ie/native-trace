"""kokoro_tts インフラ実装のユニットテスト（ADR-009 voice 引数対応）。

voice 選択ロジック・バリデーション・デフォルト後方互換・多話者ヘルパーを検証する。
実音声合成（kokoro KPipeline 呼び出し）は kokoro 不在環境ではスキップする。
"""

import pytest

from python_analyzer.infrastructure.kokoro_tts import (
    ALL_KOKORO_VOICES,
    DEFAULT_VOICE,
    KOKORO_FEMALE_VOICES,
    KOKORO_MALE_VOICES,
    select_multi_talker_voices,
    synthesize_speech,
)


class TestVoiceConstants:
    """voice 定数の構造検証。"""

    def test_default_voice_is_in_all_voices(self) -> None:
        """DEFAULT_VOICE が ALL_KOKORO_VOICES に含まれること。"""
        assert DEFAULT_VOICE in ALL_KOKORO_VOICES

    def test_all_voices_total_twenty(self) -> None:
        """ALL_KOKORO_VOICES が 20 声であること（af_* 11 + am_* 9）。"""
        assert len(ALL_KOKORO_VOICES) == 20

    def test_female_voices_count_eleven(self) -> None:
        """KOKORO_FEMALE_VOICES が 11 声であること。"""
        assert len(KOKORO_FEMALE_VOICES) == 11

    def test_male_voices_count_nine(self) -> None:
        """KOKORO_MALE_VOICES が 9 声であること。"""
        assert len(KOKORO_MALE_VOICES) == 9

    def test_female_voices_prefix(self) -> None:
        """KOKORO_FEMALE_VOICES の全要素が af_ で始まること。"""
        for voice in KOKORO_FEMALE_VOICES:
            assert voice.startswith("af_"), f"女性 voice が af_ 以外: {voice}"

    def test_male_voices_prefix(self) -> None:
        """KOKORO_MALE_VOICES の全要素が am_ で始まること。"""
        for voice in KOKORO_MALE_VOICES:
            assert voice.startswith("am_"), f"男性 voice が am_ 以外: {voice}"

    def test_all_voices_union_of_female_and_male(self) -> None:
        """ALL_KOKORO_VOICES が female + male の和集合であること。"""
        expected = frozenset(KOKORO_FEMALE_VOICES) | frozenset(KOKORO_MALE_VOICES)
        assert ALL_KOKORO_VOICES == expected

    def test_af_heart_is_default(self) -> None:
        """DEFAULT_VOICE が af_heart であること。"""
        assert DEFAULT_VOICE == "af_heart"


class TestSynthesizeSpeechVoiceValidation:
    """synthesize_speech の voice バリデーションテスト（KPipeline 呼び出し前に弾く）。"""

    def test_invalid_voice_raises_value_error(self) -> None:
        """ALL_KOKORO_VOICES にない voice を渡すと ValueError が送出されること。"""
        with pytest.raises(ValueError, match="無効な voice ID"):
            synthesize_speech(text="hello", voice="invalid_voice_xyz")

    def test_empty_voice_raises_value_error(self) -> None:
        """空文字 voice を渡すと ValueError が送出されること。"""
        with pytest.raises(ValueError, match="無効な voice ID"):
            synthesize_speech(text="hello", voice="")

    def test_wrong_case_voice_raises_value_error(self) -> None:
        """大文字混じりの voice（AF_HEART）を渡すと ValueError が送出されること。"""
        with pytest.raises(ValueError, match="無効な voice ID"):
            synthesize_speech(text="hello", voice="AF_HEART")

    def test_valid_voice_does_not_raise_before_kokoro_import(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """有効な voice はバリデーションを通過し、KPipeline 呼び出しまで進むこと。

        kokoro 不在環境では RuntimeError になるが ValueError は送出されないことを確認する。
        """
        import builtins
        import sys

        real_import = builtins.__import__

        def mock_import(name: str, *args: object, **kwargs: object) -> object:
            if name == "kokoro":
                raise ImportError("kokoro not available in test env")
            return real_import(name, *args, **kwargs)

        monkeypatch.setattr(builtins, "__import__", mock_import)
        # kokoro がキャッシュされていれば削除する
        monkeypatch.delitem(sys.modules, "kokoro", raising=False)

        with pytest.raises(RuntimeError, match="kokoro ライブラリが利用できません"):
            synthesize_speech(text="hello", voice="af_heart")


class TestSynthesizeSpeechBackwardCompatibility:
    """synthesize_speech の後方互換テスト（voice 省略時の挙動）。"""

    def test_voice_omitted_uses_default_af_heart(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """voice を省略した呼び出しが af_heart を使うこと。

        voice バリデーションが af_heart で通過し RuntimeError（kokoro 不在）になることで
        ValueError が起きないことを確認する。
        """
        import builtins
        import sys

        real_import = builtins.__import__

        def mock_import(name: str, *args: object, **kwargs: object) -> object:
            if name == "kokoro":
                raise ImportError("kokoro not available in test env")
            return real_import(name, *args, **kwargs)

        monkeypatch.setattr(builtins, "__import__", mock_import)
        monkeypatch.delitem(sys.modules, "kokoro", raising=False)

        # voice 省略でも ValueError が起きず RuntimeError になること
        with pytest.raises(RuntimeError, match="kokoro ライブラリが利用できません"):
            synthesize_speech(text="hello")


class TestSelectMultiTalkerVoices:
    """select_multi_talker_voices のテスト（ADR-009 多話者合成 contract）。"""

    def test_returns_requested_count(self) -> None:
        """返却リストの長さが count と一致すること。"""
        for count in [2, 5, 10, 20]:
            result = select_multi_talker_voices(count=count)
            assert len(result) == count, f"count={count} で長さが違う: {result}"

    def test_mixed_sex_includes_both_female_and_male(self) -> None:
        """require_mixed_sex=True のとき female・male 両方が含まれること。"""
        female_set = set(KOKORO_FEMALE_VOICES)
        male_set = set(KOKORO_MALE_VOICES)

        result = select_multi_talker_voices(count=5, require_mixed_sex=True)
        result_set = set(result)

        has_female = bool(result_set & female_set)
        has_male = bool(result_set & male_set)
        assert has_female, f"女性 voice が含まれない: {result}"
        assert has_male, f"男性 voice が含まれない: {result}"

    def test_five_or_more_talkers_hvpt_requirement(self) -> None:
        """5 名以上の voice を返せること（REQ-122 talker variability）。"""
        result = select_multi_talker_voices(count=5)
        assert len(result) == 5
        # 全て有効な voice であること
        for voice in result:
            assert voice in ALL_KOKORO_VOICES, f"無効な voice: {voice}"

    def test_all_returned_voices_are_valid(self) -> None:
        """返却された全 voice が ALL_KOKORO_VOICES に含まれること。"""
        result = select_multi_talker_voices(count=10)
        for voice in result:
            assert voice in ALL_KOKORO_VOICES, f"無効な voice: {voice}"

    def test_count_below_two_raises_value_error(self) -> None:
        """count < 2 のとき ValueError が送出されること。"""
        with pytest.raises(ValueError, match="count は 2 以上"):
            select_multi_talker_voices(count=1)

    def test_count_zero_raises_value_error(self) -> None:
        """count=0 のとき ValueError が送出されること。"""
        with pytest.raises(ValueError, match="count は 2 以上"):
            select_multi_talker_voices(count=0)

    def test_count_exceeds_twenty_raises_value_error(self) -> None:
        """count > 20 のとき ValueError が送出されること。"""
        with pytest.raises(ValueError, match="count は 20 以下"):
            select_multi_talker_voices(count=21)

    def test_no_mixed_sex_returns_female_first(self) -> None:
        """require_mixed_sex=False のとき female → male の順で詰まること。"""
        result = select_multi_talker_voices(count=3, require_mixed_sex=False)
        female_list = list(KOKORO_FEMALE_VOICES)
        assert result == female_list[:3], f"female 先頭 3 つでない: {result}"

    def test_alternating_pattern_female_even_male_odd(self) -> None:
        """require_mixed_sex=True のとき偶数インデックスが female・奇数が male であること。"""
        female_set = set(KOKORO_FEMALE_VOICES)
        male_set = set(KOKORO_MALE_VOICES)

        result = select_multi_talker_voices(count=6, require_mixed_sex=True)
        for index, voice in enumerate(result):
            if index % 2 == 0:
                assert voice in female_set, f"インデックス {index} が female でない: {voice}"
            else:
                assert voice in male_set, f"インデックス {index} が male でない: {voice}"

    def test_maximum_twenty_voices(self) -> None:
        """count=20 でリスト長が 20 かつ全要素が有効 voice であること。"""
        result = select_multi_talker_voices(count=20)
        assert len(result) == 20
        for voice in result:
            assert voice in ALL_KOKORO_VOICES, f"無効な voice: {voice}"


class TestSynthesizeSpeechSmoke:
    """synthesize_speech の smoke テスト（kokoro 在環境のみ実行）。

    kokoro が利用可能な場合のみ実際に音声合成を呼び出す。
    Docker 環境では kokoro が揃っているため実行される。
    """

    def test_synthesize_with_default_voice_returns_wav_bytes(self) -> None:
        """kokoro 在環境でデフォルト voice の合成が WAV バイト列を返すこと。"""
        try:
            import kokoro  # noqa: F401
        except ImportError:
            pytest.skip("kokoro が利用不可: smoke テストをスキップする")

        result = synthesize_speech(text="test", speed=1.0)
        assert isinstance(result, bytes)
        assert len(result) > 44  # WAV ヘッダー（44 byte）より大きい
        # WAV マジックバイト確認
        assert result[:4] == b"RIFF"
        assert result[8:12] == b"WAVE"
